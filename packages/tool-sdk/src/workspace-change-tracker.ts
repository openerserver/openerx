import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import type {
  PlatformSandboxRoot,
  PlatformSandboxWorkspaceChangeEntry,
  PlatformSandboxWorkspaceChanges,
  PlatformSandboxWorkspaceDiff,
  PlatformSandboxWorkspaceMaterializationEntry,
} from "./platform-sandbox-engine";

const MAX_ENTRIES = 250_000;
const MAX_TEXT_FILE_BYTES = 1_000_000;
const MAX_SNAPSHOT_TEXT_BYTES = 20_000_000;
const MAX_TOTAL_DIFF_BYTES = 5_000_000;
const MAX_MANIFEST_ENTRIES = 10_000;

interface SnapshotEntry {
  relativePath: string;
  entryType: PlatformSandboxWorkspaceChangeEntry["entryType"];
  size: number;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  inodeKey: string;
  birthtimeNs: string | null;
  digest: string;
  text: string | null;
  textStatus: "text" | "binary" | "too_large" | "not_applicable";
}

interface RootSnapshot {
  root: PlatformSandboxRoot;
  entries: Map<string, SnapshotEntry>;
  revision: string;
  gitStatus: PlatformSandboxWorkspaceChanges["baselineGitStatus"];
  dirtyPaths: Set<string>;
}

export interface WorkspaceWriteBaseline {
  roots: RootSnapshot[];
  revision: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function posixRelative(rootPath: string, entryPath: string): string {
  return path.relative(rootPath, entryPath).split(path.sep).join("/") || ".";
}

function snapshotEntry(
  entryPath: string,
  relativePath: string,
  textBudget: { used: number },
): SnapshotEntry {
  const stats = lstatSync(entryPath, { bigint: true });
  const common = {
    relativePath,
    size: Number(stats.size),
    mode: Number(stats.mode),
    mtimeMs: Number(stats.mtimeNs) / 1_000_000,
    ctimeMs: Number(stats.ctimeNs) / 1_000_000,
    inodeKey: `${stats.dev}:${stats.ino}`,
    birthtimeNs: stats.birthtimeNs > 0n ? String(stats.birthtimeNs) : null,
  };
  if (stats.isSymbolicLink()) {
    return {
      ...common,
      entryType: "symlink",
      digest: sha256(`symlink\0${readlinkSync(entryPath)}`),
      text: null,
      textStatus: "not_applicable",
    };
  }
  if (stats.isDirectory()) {
    return {
      ...common,
      entryType: "directory",
      digest: sha256(`directory\0${stats.mode}`),
      text: null,
      textStatus: "not_applicable",
    };
  }
  if (!stats.isFile()) {
    return {
      ...common,
      entryType: "other",
      digest: sha256(`other\0${stats.mode}\0${stats.size}\0${stats.mtimeNs}`),
      text: null,
      textStatus: "not_applicable",
    };
  }
  if (stats.size > MAX_TEXT_FILE_BYTES) {
    return {
      ...common,
      entryType: "file",
      digest: sha256(`large\0${stats.size}\0${stats.mtimeNs}\0${stats.ctimeNs}`),
      text: null,
      textStatus: "too_large",
    };
  }
  const content = readFileSync(entryPath);
  const digest = sha256(content);
  if (content.includes(0)) {
    return { ...common, entryType: "file", digest, text: null, textStatus: "binary" };
  }
  if (textBudget.used + content.byteLength > MAX_SNAPSHOT_TEXT_BYTES) {
    return { ...common, entryType: "file", digest, text: null, textStatus: "too_large" };
  }
  textBudget.used += content.byteLength;
  return {
    ...common,
    entryType: "file",
    digest,
    text: content.toString("utf8"),
    textStatus: "text",
  };
}

function gitStatus(rootPath: string): {
  status: RootSnapshot["gitStatus"];
  dirtyPaths: Set<string>;
} {
  const result = spawnSync(
    process.platform === "win32" ? "git.exe" : "/usr/bin/git",
    [
      "-c",
      "core.fsmonitor=false",
      "-C",
      rootPath,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 5_000_000,
      env: {
        PATH: process.platform === "win32" ? process.env.PATH : "/usr/bin:/bin",
        ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  );
  if (result.error) return { status: "unavailable", dirtyPaths: new Set() };
  if (result.status !== 0) {
    return /not a git repository/iu.test(result.stderr)
      ? { status: "not_repository", dirtyPaths: new Set() }
      : { status: "unavailable", dirtyPaths: new Set() };
  }
  const dirtyPaths = new Set<string>();
  const records = result.stdout.split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const relative = record.slice(3);
    if (relative) dirtyPaths.add(relative.split(path.sep).join("/"));
    if ((record.startsWith("R") || record.startsWith("C")) && records[index + 1]) {
      dirtyPaths.add(records[index + 1] as string);
      index += 1;
    }
  }
  return { status: dirtyPaths.size === 0 ? "clean" : "dirty", dirtyPaths };
}

function snapshotRoot(root: PlatformSandboxRoot, textBudget: { used: number }): RootSnapshot {
  const entries = new Map<string, SnapshotEntry>();
  const pending = [root.rootPath];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const dirent of readdirSync(directory, { withFileTypes: true })) {
      if (dirent.name === ".git") continue;
      if (entries.size >= MAX_ENTRIES) throw new Error("BROKERED_BASH_WORKSPACE_PREFLIGHT_LIMIT");
      const entryPath = path.join(directory, dirent.name);
      const relativePath = posixRelative(root.rootPath, entryPath);
      const entry = snapshotEntry(entryPath, relativePath, textBudget);
      entries.set(relativePath, entry);
      if (entry.entryType === "directory") pending.push(entryPath);
    }
  }
  const revision = sha256(
    [...entries.values()]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((entry) => `${entry.relativePath}\0${entry.entryType}\0${entry.digest}\0${entry.mode}`)
      .join("\n"),
  );
  const git = gitStatus(root.rootPath);
  return { root, entries, revision, gitStatus: git.status, dirtyPaths: git.dirtyPaths };
}

function combinedRevision(roots: RootSnapshot[]): string {
  return sha256(roots.map(({ root, revision }) => `${root.grantId}\0${revision}`).join("\n"));
}

export function captureWorkspaceWriteBaseline(
  roots: PlatformSandboxRoot[],
): WorkspaceWriteBaseline {
  const textBudget = { used: 0 };
  const snapshots = roots.map((root) => snapshotRoot(root, textBudget));
  return { roots: snapshots, revision: combinedRevision(snapshots) };
}

function changed(before: SnapshotEntry, after: SnapshotEntry): boolean {
  return (
    before.entryType !== after.entryType ||
    before.digest !== after.digest ||
    before.mode !== after.mode
  );
}

function sameFileIdentity(before: SnapshotEntry, after: SnapshotEntry): boolean {
  if (before.entryType !== after.entryType || before.inodeKey !== after.inodeKey) return false;
  // Unlinking a file can free its inode for an unrelated creation before the final snapshot.
  // Birth time distinguishes those generations while surviving a rename and subsequent edits.
  if (before.birthtimeNs !== null && after.birthtimeNs !== null) {
    return before.birthtimeNs === after.birthtimeNs;
  }
  // Without birth-time support, only infer a rename when the contents also match.
  return before.digest === after.digest;
}

function unifiedDiff(relativePath: string, before: string | null, after: string | null): string {
  const beforeLines = before === null ? [] : before.split("\n");
  const afterLines = after === null ? [] : after.split("\n");
  return [
    `--- ${before === null ? "/dev/null" : `a/${relativePath}`}`,
    `+++ ${after === null ? "/dev/null" : `b/${relativePath}`}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
}

function aggregateGitStatus(roots: RootSnapshot[]): RootSnapshot["gitStatus"] {
  if (roots.some(({ gitStatus: status }) => status === "unavailable")) return "unavailable";
  if (roots.some(({ gitStatus: status }) => status === "dirty")) return "dirty";
  if (roots.every(({ gitStatus: status }) => status === "not_repository")) return "not_repository";
  return "clean";
}

export function collectWorkspaceWriteChanges(
  baseline: WorkspaceWriteBaseline,
): PlatformSandboxWorkspaceChanges {
  const textBudget = { used: 0 };
  const finalRoots = baseline.roots.map(({ root }) => snapshotRoot(root, textBudget));
  const manifest: PlatformSandboxWorkspaceChangeEntry[] = [];
  const diffs: PlatformSandboxWorkspaceDiff[] = [];
  const materialization: PlatformSandboxWorkspaceMaterializationEntry[] = [];
  let diffBytes = 0;
  let diffTruncated = false;
  let preexistingDirtyOverlap = false;

  for (const beforeRoot of baseline.roots) {
    const afterRoot = finalRoots.find(({ root }) => root.grantId === beforeRoot.root.grantId);
    if (!afterRoot) continue;
    const deleted = [...beforeRoot.entries.values()].filter(
      (entry) => !afterRoot.entries.has(entry.relativePath),
    );
    const created = [...afterRoot.entries.values()].filter(
      (entry) => !beforeRoot.entries.has(entry.relativePath),
    );
    const renamedCreated = new Set<string>();
    const renamedDeleted = new Set<string>();
    for (const previous of deleted) {
      const next = created.find(
        (candidate) =>
          !renamedCreated.has(candidate.relativePath) && sameFileIdentity(previous, candidate),
      );
      if (!next) continue;
      renamedDeleted.add(previous.relativePath);
      renamedCreated.add(next.relativePath);
      manifest.push({
        workspaceGrantId: beforeRoot.root.grantId,
        workspaceLogicalName: beforeRoot.root.logicalName,
        relativePath: next.relativePath,
        previousRelativePath: previous.relativePath,
        kind: "renamed",
        entryType: next.entryType,
        beforeBytes: previous.size,
        afterBytes: next.size,
        diffStatus: "not_applicable",
      });
      materialization.push({
        workspaceGrantId: beforeRoot.root.grantId,
        workspaceLogicalName: beforeRoot.root.logicalName,
        relativePath: next.relativePath,
        previousRelativePath: previous.relativePath,
        kind: "renamed",
        entryType: next.entryType,
        beforeSha256: previous.entryType === "file" ? previous.digest : null,
        afterSha256: next.entryType === "file" ? next.digest : null,
        beforeText: previous.text,
        afterText: next.text,
        applySupported:
          previous.entryType === "file" &&
          next.entryType === "file" &&
          previous.textStatus === "text" &&
          next.textStatus === "text",
      });
    }
    const pairs: Array<{
      before: SnapshotEntry | null;
      after: SnapshotEntry | null;
      kind: PlatformSandboxWorkspaceChangeEntry["kind"];
    }> = [];
    for (const [relativePath, previous] of beforeRoot.entries) {
      const next = afterRoot.entries.get(relativePath);
      if (next && changed(previous, next))
        pairs.push({ before: previous, after: next, kind: "modified" });
      else if (!next && !renamedDeleted.has(relativePath))
        pairs.push({ before: previous, after: null, kind: "deleted" });
    }
    for (const next of created) {
      if (!renamedCreated.has(next.relativePath))
        pairs.push({ before: null, after: next, kind: "created" });
    }
    for (const pair of pairs) {
      const entry = pair.after ?? pair.before;
      if (!entry) continue;
      const dirtyPath = pair.before?.relativePath ?? pair.after?.relativePath ?? "";
      if (beforeRoot.dirtyPaths.has(dirtyPath)) preexistingDirtyOverlap = true;
      let diffStatus: PlatformSandboxWorkspaceChangeEntry["diffStatus"] = "not_applicable";
      if (entry.entryType === "file") {
        const textStatuses = [pair.before?.textStatus, pair.after?.textStatus].filter(Boolean);
        if (textStatuses.includes("binary")) diffStatus = "binary";
        else if (textStatuses.includes("too_large")) diffStatus = "too_large";
        else if (textStatuses.every((status) => status === "text")) diffStatus = "available";
      }
      const manifestEntry: PlatformSandboxWorkspaceChangeEntry = {
        workspaceGrantId: beforeRoot.root.grantId,
        workspaceLogicalName: beforeRoot.root.logicalName,
        relativePath: entry.relativePath,
        previousRelativePath: null,
        kind: pair.kind,
        entryType: entry.entryType,
        beforeBytes: pair.before?.size ?? null,
        afterBytes: pair.after?.size ?? null,
        diffStatus,
      };
      manifest.push(manifestEntry);
      materialization.push({
        workspaceGrantId: beforeRoot.root.grantId,
        workspaceLogicalName: beforeRoot.root.logicalName,
        relativePath: entry.relativePath,
        previousRelativePath: null,
        kind: pair.kind,
        entryType: entry.entryType,
        beforeSha256: pair.before?.entryType === "file" ? pair.before.digest : null,
        afterSha256: pair.after?.entryType === "file" ? pair.after.digest : null,
        beforeText: pair.before?.text ?? null,
        afterText: pair.after?.text ?? null,
        applySupported:
          entry.entryType === "file" &&
          (pair.before === null || pair.before.textStatus === "text") &&
          (pair.after === null || pair.after.textStatus === "text"),
      });
      if (diffStatus === "available") {
        const patch = unifiedDiff(
          entry.relativePath,
          pair.before?.text ?? null,
          pair.after?.text ?? null,
        );
        const bytes = Buffer.byteLength(patch, "utf8");
        if (diffBytes + bytes <= MAX_TOTAL_DIFF_BYTES) {
          diffs.push({
            workspaceChangeId: randomUUID(),
            workspaceGrantId: beforeRoot.root.grantId,
            relativePath: `${beforeRoot.root.logicalName}/${entry.relativePath}`,
            patch,
          });
          diffBytes += bytes;
        } else {
          manifestEntry.diffStatus = "too_large";
          diffTruncated = true;
        }
      }
    }
  }
  manifest.sort((left, right) =>
    `${left.workspaceLogicalName}/${left.relativePath}`.localeCompare(
      `${right.workspaceLogicalName}/${right.relativePath}`,
    ),
  );
  const baselineGitStatus = aggregateGitStatus(baseline.roots);
  const finalGitStatus = aggregateGitStatus(finalRoots);
  return {
    mode: "DIRECT_WORKSPACE_WRITE",
    hostWorkspaceMutated: true,
    baselineRevision: baseline.revision,
    finalRevision: combinedRevision(finalRoots),
    baselineGitStatus,
    finalGitStatus,
    conflictStatus:
      baselineGitStatus === "unavailable" || finalGitStatus === "unavailable"
        ? "git_status_unavailable"
        : preexistingDirtyOverlap
          ? "preexisting_dirty_overlap"
          : "none",
    attribution: "workspace_delta_during_execution",
    undo: "NOT_AVAILABLE_FOR_DIRECT_WRITE",
    manifest: manifest.slice(0, MAX_MANIFEST_ENTRIES),
    diffs,
    materialization: materialization.slice(0, MAX_MANIFEST_ENTRIES),
    excludedPathCount: 0,
    manifestTruncated: manifest.length > MAX_MANIFEST_ENTRIES,
    diffTruncated,
  };
}
