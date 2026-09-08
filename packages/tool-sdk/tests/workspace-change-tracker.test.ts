import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureWorkspaceWriteBaseline,
  collectWorkspaceWriteChanges,
  type PlatformSandboxRoot,
} from "../src";

const directories: string[] = [];

function temporaryRoot(): PlatformSandboxRoot {
  const rootPath = mkdtempSync(path.join(tmpdir(), "openerx-pbash-changes-"));
  directories.push(rootPath);
  return {
    grantId: crypto.randomUUID(),
    logicalName: "workspace",
    rootPath,
    access: "read_write",
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("workspace write change evidence", () => {
  it("reports create, modify, delete and rename without absolute host paths", () => {
    const root = temporaryRoot();
    writeFileSync(path.join(root.rootPath, "modified.txt"), "before\n");
    writeFileSync(path.join(root.rootPath, "deleted.txt"), "deleted\n");
    writeFileSync(path.join(root.rootPath, "renamed.txt"), "rename\n");
    const baseline = captureWorkspaceWriteBaseline([root]);

    writeFileSync(path.join(root.rootPath, "modified.txt"), "after\n");
    unlinkSync(path.join(root.rootPath, "deleted.txt"));
    renameSync(path.join(root.rootPath, "renamed.txt"), path.join(root.rootPath, "moved.txt"));
    writeFileSync(path.join(root.rootPath, "created.txt"), "created\n");

    const changes = collectWorkspaceWriteChanges(baseline);
    expect(changes).toMatchObject({
      mode: "DIRECT_WORKSPACE_WRITE",
      attribution: "workspace_delta_during_execution",
      undo: "NOT_AVAILABLE_FOR_DIRECT_WRITE",
      manifestTruncated: false,
      diffTruncated: false,
    });
    expect(changes.finalRevision).not.toBe(changes.baselineRevision);
    expect(changes.manifest.map(({ kind, relativePath }) => [kind, relativePath])).toEqual([
      ["created", "created.txt"],
      ["deleted", "deleted.txt"],
      ["modified", "modified.txt"],
      ["renamed", "moved.txt"],
    ]);
    expect(changes.manifest.find(({ kind }) => kind === "renamed")).toMatchObject({
      previousRelativePath: "renamed.txt",
    });
    expect(changes.diffs).toHaveLength(3);
    expect(
      changes.diffs.find(({ relativePath }) => relativePath.endsWith("modified.txt"))?.patch,
    ).toContain("-before");
    expect(JSON.stringify(changes)).not.toContain(root.rootPath);
  });

  it("keeps binary and oversized changes in the manifest without exposing their contents", () => {
    const root = temporaryRoot();
    const baseline = captureWorkspaceWriteBaseline([root]);
    writeFileSync(path.join(root.rootPath, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(root.rootPath, "large.txt"), "x".repeat(1_000_001));

    const changes = collectWorkspaceWriteChanges(baseline);
    expect(changes.manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "binary.dat", diffStatus: "binary" }),
        expect.objectContaining({ relativePath: "large.txt", diffStatus: "too_large" }),
      ]),
    );
    expect(changes.diffs).toHaveLength(0);
  });

  it("keeps deletion and creation separate when an inode is reused", ({ skip }) => {
    const root = temporaryRoot();
    writeFileSync(path.join(root.rootPath, "deleted.txt"), "same contents\n");
    const baseline = captureWorkspaceWriteBaseline([root]);
    unlinkSync(path.join(root.rootPath, "deleted.txt"));
    writeFileSync(path.join(root.rootPath, "created.txt"), "same contents\n");
    const replacement = captureWorkspaceWriteBaseline([root]).roots[0]?.entries.get("created.txt");
    const previous = baseline.roots[0]?.entries.get("deleted.txt");
    if (!previous || !replacement) throw new Error("Snapshot fixture missing");
    if (replacement.birthtimeNs === null) return skip();
    // Model inode reuse deterministically, including distinct births within one millisecond.
    previous.inodeKey = replacement.inodeKey;
    previous.birthtimeNs = String(BigInt(replacement.birthtimeNs) - 1n);

    const changes = collectWorkspaceWriteChanges(baseline);
    expect(changes.manifest.map(({ kind, relativePath }) => [kind, relativePath])).toEqual([
      ["created", "created.txt"],
      ["deleted", "deleted.txt"],
    ]);
    expect(changes.diffs).toHaveLength(2);
  });

  it("requires matching contents when birth time cannot distinguish inode generations", () => {
    const root = temporaryRoot();
    writeFileSync(path.join(root.rootPath, "deleted.txt"), "deleted\n");
    const baseline = captureWorkspaceWriteBaseline([root]);
    unlinkSync(path.join(root.rootPath, "deleted.txt"));
    writeFileSync(path.join(root.rootPath, "created.txt"), "created\n");
    const replacement = captureWorkspaceWriteBaseline([root]).roots[0]?.entries.get("created.txt");
    const previous = baseline.roots[0]?.entries.get("deleted.txt");
    if (!previous || !replacement) throw new Error("Snapshot fixture missing");
    previous.inodeKey = replacement.inodeKey;
    previous.birthtimeNs = null;

    expect(
      collectWorkspaceWriteChanges(baseline).manifest.map(({ kind, relativePath }) => [
        kind,
        relativePath,
      ]),
    ).toEqual([
      ["created", "created.txt"],
      ["deleted", "deleted.txt"],
    ]);
  });

  it("still recognizes a rename when the same file is edited afterwards", ({ skip }) => {
    const root = temporaryRoot();
    writeFileSync(path.join(root.rootPath, "before.txt"), "before\n");
    const baseline = captureWorkspaceWriteBaseline([root]);
    if (baseline.roots[0]?.entries.get("before.txt")?.birthtimeNs === null) return skip();
    renameSync(path.join(root.rootPath, "before.txt"), path.join(root.rootPath, "after.txt"));
    writeFileSync(path.join(root.rootPath, "after.txt"), "after\n");

    expect(collectWorkspaceWriteChanges(baseline).manifest).toEqual([
      expect.objectContaining({
        kind: "renamed",
        previousRelativePath: "before.txt",
        relativePath: "after.txt",
      }),
    ]);
  });

  it("excludes .git at every depth from change evidence", () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root.rootPath, ".git"));
    mkdirSync(path.join(root.rootPath, "nested", ".git"), { recursive: true });
    writeFileSync(path.join(root.rootPath, ".git", "config"), "before");
    writeFileSync(path.join(root.rootPath, "nested", ".git", "config"), "before");
    const baseline = captureWorkspaceWriteBaseline([root]);
    writeFileSync(path.join(root.rootPath, ".git", "config"), "after");
    writeFileSync(path.join(root.rootPath, "nested", ".git", "config"), "after");

    const changes = collectWorkspaceWriteChanges(baseline);
    expect(changes.manifest).toEqual([]);
    expect(changes.diffs).toEqual([]);
  });

  it("marks overlap with a preexisting Git dirty path as a conflict", () => {
    const root = temporaryRoot();
    const tracked = path.join(root.rootPath, "tracked.txt");
    writeFileSync(tracked, "committed\n");
    for (const args of [
      ["init", "-q"],
      ["add", "tracked.txt"],
      [
        "-c",
        "user.name=PBASH Test",
        "-c",
        "user.email=pbash@example.invalid",
        "commit",
        "-qm",
        "baseline",
      ],
    ]) {
      const result = spawnSync(
        process.platform === "win32" ? "git.exe" : "/usr/bin/git",
        ["-C", root.rootPath, ...args],
        {
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
    }
    writeFileSync(tracked, "user-dirty\n");
    const baseline = captureWorkspaceWriteBaseline([root]);
    writeFileSync(tracked, "command-and-user-overlap\n");

    expect(collectWorkspaceWriteChanges(baseline)).toMatchObject({
      baselineGitStatus: "dirty",
      finalGitStatus: "dirty",
      conflictStatus: "preexisting_dirty_overlap",
    });
  });
});
