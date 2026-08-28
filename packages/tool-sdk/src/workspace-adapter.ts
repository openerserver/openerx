import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  NormalizedToolResult,
  ToolOperation,
  WorkspaceGrant,
  WorkspaceInstructionSource,
} from "@openerx/contracts";
import type {
  ToolRepository,
  WorkspaceChangeRecord,
  WorkspaceChangeSetRecord,
} from "@openerx/storage";
import type { ToolAdapter, ToolExecutionContext } from "./types";

const MAX_TEXT_BYTES = 5_000_000;
const MAX_LIST_ENTRIES = 5_000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizedRelative(value: string): string {
  if (value.includes("\0") || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  const segments = value.split(/[\\/]+/u).filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) throw new Error("WORKSPACE_PATH_ESCAPE");
  return segments.length === 0 ? "." : segments.join("/");
}

function textFile(filePath: string): string {
  const size = statSync(filePath).size;
  if (size > MAX_TEXT_BYTES) throw new Error("WORKSPACE_FILE_TOO_LARGE");
  const content = readFileSync(filePath, "utf8");
  if (content.includes("\0")) throw new Error("WORKSPACE_BINARY_FILE_UNSUPPORTED");
  return content;
}

function unifiedDiff(relativePath: string, before: string | null, after: string): string {
  const beforeLines = before === null ? [] : before.split("\n");
  const afterLines = after.split("\n");
  return [
    `--- ${before === null ? "/dev/null" : `a/${relativePath}`}`,
    `+++ b/${relativePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ]
    .join("\n")
    .slice(0, 5_000_000);
}

function result(
  summary: string,
  data: unknown,
  content: NormalizedToolResult["content"] = [{ type: "text", text: summary }],
  sideEffectCommitted = false,
): NormalizedToolResult {
  return { summary, content, data, sources: [], artifacts: [], sideEffectCommitted, durationMs: 0 };
}

export class WorkspaceToolAdapter implements ToolAdapter {
  readonly operations = [
    "workspace_list",
    "workspace_search",
    "workspace_read",
    "workspace_instructions",
    "workspace_apply_patch",
    "workspace_diff",
    "workspace_changes",
    "workspace_undo",
    "workspace_change_set_review",
    "workspace_change_set_apply",
    "workspace_change_set_discard",
    "workspace_change_set_undo",
  ] as const;

  constructor(
    private readonly repository: ToolRepository,
    private readonly profileDirectory: string,
  ) {}

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    switch (operation.operation) {
      case "workspace_list":
        return this.#list(operation, context);
      case "workspace_search":
        return this.#search(operation, context);
      case "workspace_read":
        return this.#read(operation, context);
      case "workspace_instructions":
        return this.#instructions(operation, context);
      case "workspace_apply_patch":
        return this.#applyPatch(operation, context);
      case "workspace_diff":
        return this.#diff(operation.workspaceGrantId, operation.workspaceChangeId, context);
      case "workspace_changes":
        return this.#changes(operation.workspaceGrantId, operation.limit, context);
      case "workspace_undo":
        return this.#undo(operation.workspaceGrantId, operation.workspaceChangeId, context);
      case "workspace_change_set_review":
        return this.#changeSetReview(
          operation.workspaceGrantId,
          operation.workspaceChangeSetId,
          context,
        );
      case "workspace_change_set_apply":
        return this.#changeSetApply(
          operation.workspaceGrantId,
          operation.workspaceChangeSetId,
          context,
        );
      case "workspace_change_set_discard":
        return this.#changeSetDiscard(
          operation.workspaceGrantId,
          operation.workspaceChangeSetId,
          context,
        );
      case "workspace_change_set_undo":
        return this.#changeSetUndo(
          operation.workspaceGrantId,
          operation.workspaceChangeSetId,
          context,
        );
      default:
        throw new Error("WORKSPACE_OPERATION_NOT_SUPPORTED");
    }
  }

  instructionSources(grant: WorkspaceGrant, relativePath = "."): WorkspaceInstructionSource[] {
    const sources: WorkspaceInstructionSource[] = [];
    const globalPath = path.join(this.profileDirectory, "AGENTS.md");
    if (existsSync(globalPath) && !lstatSync(globalPath).isSymbolicLink()) {
      const content = textFile(globalPath);
      sources.push({
        kind: "global",
        workspaceGrantId: null,
        relativePath: "AGENTS.md",
        appliesTo: "*",
        digest: sha256(`global\0${content}`),
        content,
      });
    }

    const root = realpathSync(grant.rootPath);
    const relative = normalizedRelative(relativePath);
    const lexicalTarget = path.resolve(root, relative);
    if (!inside(root, lexicalTarget)) throw new Error("WORKSPACE_PATH_ESCAPE");
    const targetDirectory =
      existsSync(lexicalTarget) && statSync(lexicalTarget).isDirectory()
        ? lexicalTarget
        : path.dirname(lexicalTarget);
    const relativeDirectory = path.relative(root, targetDirectory);
    const directories = [root];
    if (relativeDirectory) {
      let current = root;
      for (const segment of relativeDirectory.split(path.sep)) {
        current = path.join(current, segment);
        if (!inside(root, current)) throw new Error("WORKSPACE_PATH_ESCAPE");
        directories.push(current);
      }
    }
    for (const [index, directory] of directories.entries()) {
      const instructionPath = path.join(directory, "AGENTS.md");
      if (!existsSync(instructionPath) || lstatSync(instructionPath).isSymbolicLink()) continue;
      if (!inside(root, realpathSync(instructionPath))) throw new Error("WORKSPACE_SYMLINK_ESCAPE");
      const content = textFile(instructionPath);
      const instructionRelative = path.relative(root, instructionPath).split(path.sep).join("/");
      const appliesTo = path.relative(root, directory).split(path.sep).join("/") || ".";
      sources.push({
        kind: index === 0 ? "project" : "nested",
        workspaceGrantId: grant.id,
        relativePath: instructionRelative,
        appliesTo,
        digest: sha256(`${grant.id}\0${instructionRelative}\0${content}`),
        content,
      });
    }
    return sources;
  }

  #grant(context: ToolExecutionContext, grantId: string): WorkspaceGrant {
    const conversationId = context.projection?.conversationId;
    if (!conversationId) throw new Error("WORKSPACE_RUN_CONTEXT_REQUIRED");
    return this.repository.activeWorkspaceGrant(grantId, conversationId);
  }

  #existing(
    grant: WorkspaceGrant,
    relativePath: string,
  ): { root: string; target: string; relative: string } {
    const root = realpathSync(grant.rootPath);
    const relative = normalizedRelative(relativePath);
    const lexical = path.resolve(root, relative);
    if (!inside(root, lexical)) throw new Error("WORKSPACE_PATH_ESCAPE");
    if (!existsSync(lexical)) throw new Error("WORKSPACE_PATH_NOT_FOUND");
    if (lstatSync(lexical).isSymbolicLink()) throw new Error("WORKSPACE_SYMLINK_DENIED");
    const target = realpathSync(lexical);
    if (!inside(root, target)) throw new Error("WORKSPACE_SYMLINK_ESCAPE");
    return { root, target, relative };
  }

  #writeTarget(
    grant: WorkspaceGrant,
    relativePath: string,
  ): { root: string; target: string; relative: string } {
    const root = realpathSync(grant.rootPath);
    const relative = normalizedRelative(relativePath);
    if (relative === ".") throw new Error("WORKSPACE_FILE_PATH_REQUIRED");
    const target = path.resolve(root, relative);
    if (!inside(root, target)) throw new Error("WORKSPACE_PATH_ESCAPE");
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink()) throw new Error("WORKSPACE_SYMLINK_DENIED");
      if (!inside(root, realpathSync(target))) throw new Error("WORKSPACE_SYMLINK_ESCAPE");
      if (!statSync(target).isFile()) throw new Error("WORKSPACE_FILE_REQUIRED");
    }
    const parent = realpathSync(path.dirname(target));
    if (!inside(root, parent)) throw new Error("WORKSPACE_SYMLINK_ESCAPE");
    return { root, target, relative };
  }

  #list(
    operation: Extract<ToolOperation, { operation: "workspace_list" }>,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const grant = this.#grant(context, operation.workspaceGrantId);
    const { root, target } = this.#existing(grant, operation.relativePath);
    if (!statSync(target).isDirectory()) throw new Error("WORKSPACE_DIRECTORY_REQUIRED");
    const entries: Array<{
      path: string;
      type: "file" | "directory" | "symlink";
      sizeBytes: number;
    }> = [];
    const visit = (directory: string, depth: number): void => {
      if (depth > operation.maxDepth || entries.length >= MAX_LIST_ENTRIES) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entries.length >= MAX_LIST_ENTRIES) break;
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        const type = entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : "file";
        entries.push({
          path: relative,
          type,
          sizeBytes: type === "file" ? statSync(absolute).size : 0,
        });
        if (type === "directory") visit(absolute, depth + 1);
      }
    };
    visit(target, 1);
    return result(`${entries.length} 个工作区条目`, {
      entries,
      truncated: entries.length >= MAX_LIST_ENTRIES,
    });
  }

  #search(
    operation: Extract<ToolOperation, { operation: "workspace_search" }>,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const grant = this.#grant(context, operation.workspaceGrantId);
    const { root, target } = this.#existing(grant, operation.relativePath);
    if (!statSync(target).isDirectory()) throw new Error("WORKSPACE_DIRECTORY_REQUIRED");
    const query = operation.query.toLocaleLowerCase();
    const matches: Array<{ path: string; line: number; excerpt: string }> = [];
    const visit = (directory: string): void => {
      if (matches.length >= operation.maxResults) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (matches.length >= operation.maxResults) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolute);
          continue;
        }
        if (!entry.isFile() || statSync(absolute).size > 2_000_000) continue;
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        if (entry.name.toLocaleLowerCase().includes(query)) {
          matches.push({ path: relative, line: 0, excerpt: entry.name });
        }
        if (matches.length >= operation.maxResults) break;
        const content = readFileSync(absolute, "utf8");
        if (content.includes("\0")) continue;
        for (const [index, line] of content.split("\n").entries()) {
          if (!line.toLocaleLowerCase().includes(query)) continue;
          matches.push({ path: relative, line: index + 1, excerpt: line.slice(0, 500) });
          if (matches.length >= operation.maxResults) break;
        }
      }
    };
    visit(target);
    return result(`${matches.length} 个工作区匹配项`, {
      matches,
      truncated: matches.length >= operation.maxResults,
    });
  }

  #read(
    operation: Extract<ToolOperation, { operation: "workspace_read" }>,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const grant = this.#grant(context, operation.workspaceGrantId);
    const { target, relative } = this.#existing(grant, operation.relativePath);
    if (!statSync(target).isFile()) throw new Error("WORKSPACE_FILE_REQUIRED");
    const content = textFile(target);
    const lines = content.split("\n");
    const selected = lines.slice(
      operation.startLine - 1,
      operation.startLine - 1 + operation.maxLines,
    );
    const text = selected
      .map((line, index) => `${operation.startLine + index}: ${line}`)
      .join("\n");
    return result(
      `已读取 ${relative} 第 ${operation.startLine} 行起 ${selected.length} 行`,
      {
        relativePath: relative,
        sha256: sha256(content),
        totalLines: lines.length,
        text,
      },
      [{ type: "text", text }],
    );
  }

  #instructions(
    operation: Extract<ToolOperation, { operation: "workspace_instructions" }>,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const grant = this.#grant(context, operation.workspaceGrantId);
    const sources = this.instructionSources(grant, operation.relativePath);
    if (context.projection)
      this.repository.addRunInstructionSources(context.projection.runId, sources);
    const text =
      sources.length === 0
        ? "该路径没有项目指令。"
        : sources
            .map((source) => `[${source.kind}] ${source.relativePath}\n${source.content}`)
            .join("\n\n");
    return result(`${sources.length} 个适用项目指令`, { sources }, [{ type: "text", text }]);
  }

  #applyPatch(
    operation: Extract<ToolOperation, { operation: "workspace_apply_patch" }>,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const projection = context.projection;
    if (!projection) throw new Error("WORKSPACE_RUN_CONTEXT_REQUIRED");
    const grant = this.#grant(context, operation.workspaceGrantId);
    if (grant.access !== "read_write") throw new Error("WORKSPACE_WRITE_NOT_GRANTED");
    const { target, relative } = this.#writeTarget(grant, operation.relativePath);
    const before = existsSync(target) ? textFile(target) : null;
    const beforeSha256 = before === null ? null : sha256(before);
    if (beforeSha256 !== operation.expectedSha256) throw new Error("WORKSPACE_CONTENT_CHANGED");
    const requiredInstructions = this.instructionSources(grant, relative);
    const requiredDigests = requiredInstructions.map(({ digest }) => digest).sort();
    const suppliedDigests = [...new Set(operation.instructionDigests)].sort();
    if (JSON.stringify(requiredDigests) !== JSON.stringify(suppliedDigests)) {
      throw new Error("WORKSPACE_INSTRUCTIONS_NOT_ACKNOWLEDGED");
    }
    this.repository.addRunInstructionSources(projection.runId, requiredInstructions);
    let after = before ?? "";
    for (const replacement of operation.replacements) {
      if (replacement.oldText === "") {
        if (after !== "" || operation.replacements.length !== 1) {
          throw new Error("WORKSPACE_PATCH_AMBIGUOUS");
        }
        after = replacement.newText;
        continue;
      }
      const first = after.indexOf(replacement.oldText);
      if (
        first < 0 ||
        after.indexOf(replacement.oldText, first + replacement.oldText.length) >= 0
      ) {
        throw new Error("WORKSPACE_PATCH_CONTEXT_MISMATCH");
      }
      after = `${after.slice(0, first)}${replacement.newText}${after.slice(first + replacement.oldText.length)}`;
    }
    if (Buffer.byteLength(after, "utf8") > MAX_TEXT_BYTES)
      throw new Error("WORKSPACE_FILE_TOO_LARGE");
    if (after === before) throw new Error("WORKSPACE_PATCH_NO_CHANGE");
    const afterSha256 = sha256(after);
    const diff = unifiedDiff(relative, before, after);
    const change = this.repository.createWorkspaceChange({
      workspaceGrantId: grant.id,
      runId: projection.runId,
      relativePath: relative,
      beforeSha256,
      afterSha256,
      beforeText: before,
      afterText: after,
      diff,
    });
    try {
      this.#atomicWrite(target, after);
    } catch (error) {
      this.repository.markWorkspaceChange(change.id, "failed");
      throw error;
    }
    this.repository.markWorkspaceChange(change.id, "applied");
    return this.#changeResult(this.repository.workspaceChange(change.id), true);
  }

  #diff(grantId: string, changeId: string, context: ToolExecutionContext): NormalizedToolResult {
    const change = this.repository.workspaceChange(changeId);
    if (change.workspaceGrantId !== grantId) throw new Error("WORKSPACE_CHANGE_SCOPE_MISMATCH");
    this.#grant(context, change.workspaceGrantId);
    return this.#changeResult(change, false);
  }

  #changes(grantId: string, limit: number, context: ToolExecutionContext): NormalizedToolResult {
    this.#grant(context, grantId);
    const changes = this.repository.listWorkspaceChanges(grantId, limit).map((change) => ({
      id: change.id,
      runId: change.runId,
      relativePath: change.relativePath,
      status: change.status,
      beforeSha256: change.beforeSha256,
      afterSha256: change.afterSha256,
      createdAt: change.createdAt,
      updatedAt: change.updatedAt,
    }));
    const changeSets = this.repository.listWorkspaceChangeSets(grantId, limit).map((changeSet) => ({
      id: changeSet.id,
      runId: changeSet.runId,
      status: changeSet.status,
      changeCount: changeSet.entries.length,
      baselineRevision: changeSet.baselineRevision,
      finalRevision: changeSet.finalRevision,
      createdAt: changeSet.createdAt,
      updatedAt: changeSet.updatedAt,
    }));
    const text =
      changes.length === 0 && changeSets.length === 0
        ? "该工作区没有已记录的修改。"
        : [
            ...changes.map(
              (change) =>
                `${change.id} · ${change.status} · ${change.relativePath} · ${change.updatedAt}`,
            ),
            ...changeSets.map(
              (changeSet) =>
                `${changeSet.id} · change-set:${changeSet.status} · ${changeSet.changeCount} changes · ${changeSet.updatedAt}`,
            ),
          ].join("\n");
    return result(
      `${changes.length} 个文件修改，${changeSets.length} 个隔离变更集`,
      { changes, changeSets },
      [{ type: "text", text }],
    );
  }

  #undo(grantId: string, changeId: string, context: ToolExecutionContext): NormalizedToolResult {
    const change = this.repository.workspaceChange(changeId);
    if (change.workspaceGrantId !== grantId) throw new Error("WORKSPACE_CHANGE_SCOPE_MISMATCH");
    const grant = this.#grant(context, change.workspaceGrantId);
    if (grant.access !== "read_write") throw new Error("WORKSPACE_WRITE_NOT_GRANTED");
    if (change.status === "reverted") return this.#changeResult(change, false);
    if (change.status !== "applied" && change.status !== "outcome_unknown") {
      throw new Error("WORKSPACE_CHANGE_NOT_APPLIED");
    }
    const { target } = this.#writeTarget(grant, change.relativePath);
    if (!existsSync(target)) {
      if (change.beforeText === null && change.status === "outcome_unknown") {
        return this.#changeResult(
          this.repository.markWorkspaceChange(change.id, "reverted"),
          false,
        );
      }
      throw new Error("WORKSPACE_UNDO_CONTENT_CHANGED");
    }
    const currentSha256 = sha256(textFile(target));
    if (change.status === "outcome_unknown" && currentSha256 === change.beforeSha256) {
      return this.#changeResult(this.repository.markWorkspaceChange(change.id, "reverted"), false);
    }
    if (currentSha256 !== change.afterSha256) {
      throw new Error("WORKSPACE_UNDO_CONTENT_CHANGED");
    }
    if (change.beforeText === null) unlinkSync(target);
    else this.#atomicWrite(target, change.beforeText);
    return this.#changeResult(this.repository.markWorkspaceChange(change.id, "reverted"), true);
  }

  #atomicWrite(target: string, content: string): void {
    const temporary = path.join(path.dirname(target), `.openerx-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, content, {
        encoding: "utf8",
        mode: existsSync(target) ? statSync(target).mode : 0o600,
      });
      renameSync(temporary, target);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  #changeSet(
    grantId: string,
    changeSetId: string,
    context: ToolExecutionContext,
  ): WorkspaceChangeSetRecord {
    this.#grant(context, grantId);
    const changeSet = this.repository.workspaceChangeSet(changeSetId);
    if (changeSet.workspaceGrantId !== grantId) {
      throw new Error("WORKSPACE_CHANGE_SET_SCOPE_MISMATCH");
    }
    return changeSet;
  }

  #changeSetReview(
    grantId: string,
    changeSetId: string,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const changeSet = this.#changeSet(grantId, changeSetId, context);
    if (changeSet.status !== "pending_review") return this.#changeSetResult(changeSet, false);
    return this.#changeSetResult(
      this.repository.markWorkspaceChangeSet(changeSet.id, "reviewed"),
      true,
    );
  }

  #changeSetDiscard(
    grantId: string,
    changeSetId: string,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const changeSet = this.#changeSet(grantId, changeSetId, context);
    if (changeSet.status === "discarded") return this.#changeSetResult(changeSet, false);
    if (
      changeSet.status !== "pending_review" &&
      changeSet.status !== "reviewed" &&
      changeSet.status !== "blocked"
    ) {
      throw new Error("WORKSPACE_CHANGE_SET_NOT_DISCARDABLE");
    }
    return this.#changeSetResult(
      this.repository.markWorkspaceChangeSet(changeSet.id, "discarded"),
      true,
    );
  }

  #changeSetApply(
    grantId: string,
    changeSetId: string,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const changeSet = this.#changeSet(grantId, changeSetId, context);
    if (changeSet.status === "applied") return this.#changeSetResult(changeSet, false);
    if (changeSet.status === "blocked") throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
    if (changeSet.status !== "reviewed") {
      throw new Error("WORKSPACE_CHANGE_SET_NOT_APPLICABLE");
    }
    this.#validateChangeSetState(changeSet, "before", context);
    this.repository.markWorkspaceChangeSet(changeSet.id, "applying");
    try {
      this.#writeChangeSet(changeSet, "apply", context);
    } catch (error) {
      try {
        this.#writeChangeSet(changeSet, "undo", context, false);
      } finally {
        this.repository.markWorkspaceChangeSet(changeSet.id, "apply_failed");
      }
      throw error;
    }
    return this.#changeSetResult(
      this.repository.markWorkspaceChangeSet(changeSet.id, "applied"),
      true,
    );
  }

  #changeSetUndo(
    grantId: string,
    changeSetId: string,
    context: ToolExecutionContext,
  ): NormalizedToolResult {
    const changeSet = this.#changeSet(grantId, changeSetId, context);
    if (changeSet.status === "reverted") return this.#changeSetResult(changeSet, false);
    if (changeSet.status !== "applied" && changeSet.status !== "outcome_unknown") {
      throw new Error("WORKSPACE_CHANGE_SET_NOT_APPLIED");
    }
    if (changeSet.status === "outcome_unknown") {
      this.#validateRecoverableChangeSetState(changeSet, context);
    } else {
      this.#validateChangeSetState(changeSet, "after", context);
    }
    this.#writeChangeSet(changeSet, "undo", context);
    return this.#changeSetResult(
      this.repository.markWorkspaceChangeSet(changeSet.id, "reverted"),
      true,
    );
  }

  #validateChangeSetState(
    changeSet: WorkspaceChangeSetRecord,
    side: "before" | "after",
    context: ToolExecutionContext,
  ): void {
    for (const entry of changeSet.entries) {
      if (!entry.applySupported || entry.entryType !== "file") {
        throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
      }
      if (
        entry.relativePath.split("/").includes(".git") ||
        entry.previousRelativePath?.split("/").includes(".git")
      ) {
        throw new Error("WORKSPACE_CHANGE_SET_PROTECTED_PATH");
      }
      const grant = this.#grant(context, entry.workspaceGrantId);
      if (grant.access !== "read_write") throw new Error("WORKSPACE_WRITE_NOT_GRANTED");
      const relativePath =
        side === "before" && entry.kind === "renamed"
          ? (entry.previousRelativePath ?? entry.relativePath)
          : entry.relativePath;
      const { target } = this.#writeTarget(grant, relativePath);
      const expected = side === "before" ? entry.beforeSha256 : entry.afterSha256;
      const actual = existsSync(target) ? sha256(textFile(target)) : null;
      if (actual !== expected) throw new Error("WORKSPACE_CHANGE_SET_CONFLICT");
      if (entry.kind === "renamed") {
        const otherRelative = side === "before" ? entry.relativePath : entry.previousRelativePath;
        if (!otherRelative) throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
        const { target: otherTarget } = this.#writeTarget(grant, otherRelative);
        if (existsSync(otherTarget)) throw new Error("WORKSPACE_CHANGE_SET_CONFLICT");
      }
    }
  }

  #writeChangeSet(
    changeSet: WorkspaceChangeSetRecord,
    direction: "apply" | "undo",
    context: ToolExecutionContext,
    strict = true,
  ): void {
    const entries = direction === "apply" ? changeSet.entries : [...changeSet.entries].reverse();
    for (const entry of entries) {
      try {
        const grant = this.#grant(context, entry.workspaceGrantId);
        const applying = direction === "apply";
        if (entry.kind === "renamed") {
          const fromRelative = applying
            ? (entry.previousRelativePath ?? entry.relativePath)
            : entry.relativePath;
          const toRelative = applying
            ? entry.relativePath
            : (entry.previousRelativePath ?? entry.relativePath);
          const { target: from } = this.#writeTarget(grant, fromRelative);
          const { target: to } = this.#writeTarget(grant, toRelative);
          const content = applying ? entry.afterText : entry.beforeText;
          if (content === null) throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
          this.#atomicWrite(to, content);
          if (existsSync(from)) unlinkSync(from);
          continue;
        }
        const { target } = this.#writeTarget(grant, entry.relativePath);
        const content = applying ? entry.afterText : entry.beforeText;
        if (content === null) {
          if (existsSync(target)) unlinkSync(target);
        } else {
          this.#atomicWrite(target, content);
        }
      } catch (error) {
        if (strict) throw error;
      }
    }
  }

  #validateRecoverableChangeSetState(
    changeSet: WorkspaceChangeSetRecord,
    context: ToolExecutionContext,
  ): void {
    for (const entry of changeSet.entries) {
      if (!entry.applySupported || entry.entryType !== "file") {
        throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
      }
      const grant = this.#grant(context, entry.workspaceGrantId);
      if (entry.kind === "renamed") {
        const previous = entry.previousRelativePath;
        if (!previous) throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
        const { target: beforeTarget } = this.#writeTarget(grant, previous);
        const { target: afterTarget } = this.#writeTarget(grant, entry.relativePath);
        const beforeHash = existsSync(beforeTarget) ? sha256(textFile(beforeTarget)) : null;
        const afterHash = existsSync(afterTarget) ? sha256(textFile(afterTarget)) : null;
        const atBefore = beforeHash === entry.beforeSha256 && afterHash === null;
        const atAfter = beforeHash === null && afterHash === entry.afterSha256;
        if (!atBefore && !atAfter) throw new Error("WORKSPACE_CHANGE_SET_CONFLICT");
        continue;
      }
      const { target } = this.#writeTarget(grant, entry.relativePath);
      const actual = existsSync(target) ? sha256(textFile(target)) : null;
      if (actual !== entry.beforeSha256 && actual !== entry.afterSha256) {
        throw new Error("WORKSPACE_CHANGE_SET_CONFLICT");
      }
    }
  }

  #changeSetResult(
    changeSet: WorkspaceChangeSetRecord,
    sideEffectCommitted: boolean,
  ): NormalizedToolResult {
    const diffs = changeSet.diffs.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const diff = value as Record<string, unknown>;
      if (typeof diff.relativePath !== "string" || typeof diff.patch !== "string") return [];
      const workspaceChangeId =
        typeof diff.workspaceChangeId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          diff.workspaceChangeId,
        )
          ? diff.workspaceChangeId
          : changeSet.id;
      return [
        {
          type: "diff" as const,
          workspaceChangeId,
          relativePath: diff.relativePath,
          patch: diff.patch,
        },
      ];
    });
    return result(
      `WorkspaceChangeSet ${changeSet.id} · ${changeSet.status} · ${changeSet.entries.length} changes`,
      {
        changeSet: {
          id: changeSet.id,
          workspaceGrantId: changeSet.workspaceGrantId,
          runId: changeSet.runId,
          status: changeSet.status,
          baselineRevision: changeSet.baselineRevision,
          finalRevision: changeSet.finalRevision,
          manifest: changeSet.manifest,
          applySupported: changeSet.entries.every(({ applySupported }) => applySupported),
          createdAt: changeSet.createdAt,
          updatedAt: changeSet.updatedAt,
        },
      },
      [{ type: "text", text: `WorkspaceChangeSet ${changeSet.status}` }, ...diffs],
      sideEffectCommitted,
    );
  }

  #changeResult(change: WorkspaceChangeRecord, sideEffectCommitted: boolean): NormalizedToolResult {
    return result(
      `${change.status === "reverted" ? "已撤销" : "已记录"} ${change.relativePath} 的差异`,
      {
        change: {
          id: change.id,
          workspaceGrantId: change.workspaceGrantId,
          runId: change.runId,
          relativePath: change.relativePath,
          status: change.status,
          beforeSha256: change.beforeSha256,
          afterSha256: change.afterSha256,
          createdAt: change.createdAt,
          updatedAt: change.updatedAt,
        },
      },
      [
        { type: "text", text: `${change.relativePath} · ${change.status}` },
        {
          type: "diff",
          workspaceChangeId: change.id,
          relativePath: change.relativePath,
          patch: change.diff,
        },
      ],
      sideEffectCommitted,
    );
  }
}
