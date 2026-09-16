import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexWindowsSandboxReady, ShellToolAdapter, WorkspaceToolAdapter } from "../src";

const directories: string[] = [];

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-workspace-tool-"));
  directories.push(root);
  const profile = path.join(root, "profile");
  const workspace = path.join(root, "project");
  const outside = path.join(root, "outside");
  mkdirSync(profile);
  mkdirSync(workspace);
  mkdirSync(outside);
  mkdirSync(path.join(workspace, "src"));
  writeFileSync(path.join(profile, "AGENTS.md"), "global instruction\n");
  writeFileSync(path.join(workspace, "AGENTS.md"), "project instruction\n");
  writeFileSync(path.join(workspace, "src", "AGENTS.md"), "nested instruction\n");
  writeFileSync(path.join(workspace, "src", "app.ts"), "export const value = 1;\n");
  writeFileSync(path.join(outside, "secret.txt"), "outside-secret\n");
  const databasePath = path.join(profile, "openerx.sqlite");
  const chat = new ChatRepository(databasePath, { ownerProfileId: "profile-a" });
  const repository = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
  const generation = chat.createGeneration({
    text: "修复项目",
    idempotencyKey: "workspace-chat-0001",
  });
  const run = repository.createProjection({
    conversationId: generation.receipt.conversationId,
    messageId: generation.receipt.assistantMessageId,
    branchId: generation.receipt.branchId,
    title: "修复项目",
    selectedModelRef: generation.selectedModelRef,
    thinkingLevel: generation.thinkingLevel,
    piPackageVersion: "0.84.3",
    piHostContractVersion: 2,
  });
  const grant = repository.grantWorkspace({
    conversationId: generation.receipt.conversationId,
    displayName: "project",
    rootPath: workspace,
    access: "read_write",
    allowNetwork: false,
    expiresAt: null,
  });
  const context = {
    signal: new AbortController().signal,
    toolCallId: "workspace-call",
    update: () => undefined,
    projection: {
      generationId: "00000000-0000-4000-8000-000000000801",
      workItemId: run.workItem.id,
      runId: run.run.id,
      conversationId: generation.receipt.conversationId,
      assistantMessageId: generation.receipt.assistantMessageId,
      piToolCallId: "workspace-call",
      toolName: "openerx_workspace",
    },
  };
  return {
    root,
    profile,
    workspace,
    outside,
    chat,
    repository,
    grant,
    context,
    adapter: new WorkspaceToolAdapter(repository, profile),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Workspace context patch integration", () => {
  async function prepared() {
    const f = fixture();
    const { toolCall } = f.repository.createToolCall({
      runId: f.context.projection.runId,
      piCallRef: "context-patch",
      toolName: "openerx_workspace_apply_patch",
      source: "openerx",
      risk: "L3",
      idempotencyKey: "context-patch-call",
      inputSummary: "context patch",
      targetSummary: f.grant.id,
    });
    const context = { ...f.context, toolCallId: toolCall.id };
    await f.adapter.execute(
      {
        operation: "workspace_instructions",
        workspaceGrantId: f.grant.id,
        relativePath: "src/app.ts",
        idempotencyKey: "instructions-context",
      },
      context,
    );
    const read = async (relativePath: string) =>
      await f.adapter.execute(
        {
          operation: "workspace_read",
          workspaceGrantId: f.grant.id,
          relativePath,
          startLine: 1,
          maxLines: 500,
          idempotencyKey: "read-context",
        },
        context,
      );
    await read("src/app.ts");
    const patch = async (body: string) =>
      await f.adapter.execute(
        {
          operation: "workspace_patch",
          workspaceGrantId: f.grant.id,
          patch: `*** Begin Patch\n${body}\n*** End Patch`,
          idempotencyKey: "patch-context",
        },
        context,
      );
    const close = () => {
      f.chat.close();
      f.repository.close();
    };
    return { ...f, context, read, patch, close };
  }

  it("applies and undoes multi-file additions, edits, deletion and executable rename", async () => {
    const f = await prepared();
    writeFileSync(path.join(f.workspace, "src/run.sh"), "echo old\n");
    chmodSync(path.join(f.workspace, "src/run.sh"), 0o751);
    const executableMode = statSync(path.join(f.workspace, "src/run.sh")).mode & 0o777;
    writeFileSync(path.join(f.workspace, "src/obsolete.txt"), "obsolete\n");
    await f.read("src/run.sh");
    await f.read("src/obsolete.txt");
    await f.patch(
      "*** Update File: src/app.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** Add File: src/new/sub/file.txt\n+created\n*** Update File: src/run.sh\n*** Move to: src/bin/run.sh\n@@\n-echo old\n+echo new\n*** Delete File: src/obsolete.txt",
    );
    expect(readFileSync(path.join(f.workspace, "src/app.ts"), "utf8")).toContain("value = 2");
    expect(readFileSync(path.join(f.workspace, "src/new/sub/file.txt"), "utf8")).toBe("created\n");
    expect(existsSync(path.join(f.workspace, "src/obsolete.txt"))).toBe(false);
    expect(statSync(path.join(f.workspace, "src/bin/run.sh")).mode & 0o777).toBe(executableMode);
    const edits = f.repository.workItemDetail(f.context.projection.workItemId).workspaceEdits;
    expect(edits).toHaveLength(1);
    expect(edits[0]?.relativePaths).toHaveLength(4);
    f.adapter.undoRunEdits(f.context.projection.runId, edits[0]?.id, f.context);
    expect(readFileSync(path.join(f.workspace, "src/app.ts"), "utf8")).toContain("value = 1");
    expect(existsSync(path.join(f.workspace, "src/new/sub/file.txt"))).toBe(false);
    expect(readFileSync(path.join(f.workspace, "src/obsolete.txt"), "utf8")).toBe("obsolete\n");
    expect(readFileSync(path.join(f.workspace, "src/run.sh"), "utf8")).toBe("echo old\n");
    expect(statSync(path.join(f.workspace, "src/run.sh")).mode & 0o777).toBe(executableMode);
    expect(existsSync(path.join(f.workspace, "src/bin/run.sh"))).toBe(false);
    f.close();
  });

  it("recovers a rename interrupted after removing its original path", async () => {
    const f = await prepared();
    await f.patch("*** Update File: src/app.ts\n*** Move to: src/renamed.ts");
    const changeSet = f.repository.runWorkspaceChanges(f.context.projection.runId).changeSets[0];
    if (!changeSet) throw new Error("change set missing");
    // A rename is two file mutations; a process may exit between them.
    rmSync(path.join(f.workspace, "src/renamed.ts"));
    f.repository.markWorkspaceChangeSet(changeSet.id, "outcome_unknown");
    await f.adapter.execute(
      {
        operation: "workspace_change_set_undo",
        workspaceGrantId: f.grant.id,
        workspaceChangeSetId: changeSet.id,
        idempotencyKey: "rename-recovery-test",
      },
      f.context,
    );
    expect(readFileSync(path.join(f.workspace, "src/app.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(existsSync(path.join(f.workspace, "src/renamed.ts"))).toBe(false);
    expect(f.repository.workspaceChangeSet(changeSet.id).status).toBe("reverted");
    f.close();
  });

  it("rejects an unread or externally changed file before writing anything", async () => {
    const f = await prepared();
    writeFileSync(path.join(f.workspace, "src/other.txt"), "other\n");
    await expect(
      f.patch(
        "*** Add File: created.txt\n+new\n*** Update File: src/other.txt\n@@\n-other\n+changed",
      ),
    ).rejects.toThrow("WORKSPACE_READ_REQUIRED");
    expect(existsSync(path.join(f.workspace, "created.txt"))).toBe(false);
    writeFileSync(path.join(f.workspace, "src/app.ts"), "export const value = 1;\n// external\n");
    await expect(
      f.patch(
        "*** Update File: src/app.ts\n@@\n-export const value = 1;\n+export const value = 2;",
      ),
    ).rejects.toThrow("WORKSPACE_CONTENT_CHANGED");
    expect(f.repository.runWorkspaceChanges(f.context.projection.runId).changeSets).toHaveLength(0);
    f.close();
  });

  it("binds current instructions and rejects traversal, symlinks, metadata and duplicate paths", async () => {
    const f = await prepared();
    await expect(f.patch("*** Add File: ../escape.txt\n+bad")).rejects.toThrow(
      "WORKSPACE_PATH_ESCAPE",
    );
    await expect(f.patch("*** Add File: .git/config\n+bad")).rejects.toThrow(
      "WORKSPACE_PATCH_PROTECTED_PATH",
    );
    symlinkSync(f.outside, path.join(f.workspace, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(f.patch("*** Add File: linked/escape.txt\n+bad")).rejects.toThrow(
      "WORKSPACE_SYMLINK_DENIED",
    );
    await expect(
      f.patch("*** Add File: src/new.txt\n+one\n*** Add File: src/./new.txt\n+two"),
    ).rejects.toThrow("WORKSPACE_PATCH_DUPLICATE_PATH");
    writeFileSync(path.join(f.workspace, "src/AGENTS.md"), "changed instructions\n");
    await expect(
      f.patch(
        "*** Update File: src/app.ts\n@@\n-export const value = 1;\n+export const value = 2;",
      ),
    ).rejects.toThrow("WORKSPACE_INSTRUCTIONS_NOT_ACKNOWLEDGED");
    f.close();
  });

  it("preflights full-run undo and reverses successive edits to the same file", async () => {
    const f = await prepared();
    const target = path.join(f.workspace, "src/app.ts");
    await f.patch(
      "*** Update File: src/app.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** Add File: src/new.txt\n+created",
    );
    await f.patch(
      "*** Update File: src/app.ts\n@@\n-export const value = 2;\n+export const value = 3;",
    );
    writeFileSync(path.join(f.workspace, "src/new.txt"), "user edit\n");
    expect(() => f.adapter.undoRunEdits(f.context.projection.runId, undefined, f.context)).toThrow(
      "WORKSPACE_UNDO_CONTENT_CHANGED",
    );
    expect(readFileSync(target, "utf8")).toContain("value = 3");
    writeFileSync(path.join(f.workspace, "src/new.txt"), "created\n");
    f.adapter.undoRunEdits(f.context.projection.runId, undefined, f.context);
    expect(readFileSync(target, "utf8")).toContain("value = 1");
    expect(existsSync(path.join(f.workspace, "src/new.txt"))).toBe(false);
    expect(
      f.repository
        .workItemDetail(f.context.projection.workItemId)
        .workspaceEdits.every(({ status }) => status === "reverted"),
    ).toBe(true);
    expect(() =>
      f.adapter.undoRunEdits(f.context.projection.runId, undefined, f.context),
    ).not.toThrow();
    f.close();
  });

  it.each(["partial", "complete"])(
    "resumes a %s full-run undo from its journal after reopening storage",
    async (interruption) => {
      const f = await prepared();
      const target = path.join(f.workspace, "src/app.ts");
      await f.patch(
        "*** Update File: src/app.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** Add File: src/new.txt\n+created",
      );
      await f.patch(
        "*** Update File: src/app.ts\n@@\n-export const value = 2;\n+export const value = 3;",
      );
      const begin = f.repository.beginWorkspaceUndo.bind(f.repository);
      vi.spyOn(f.repository, "beginWorkspaceUndo").mockImplementationOnce((input) => {
        begin(input);
        // Simulate a process exit after an atomic file write, before journal completion.
        for (const mutation of interruption === "partial"
          ? input.mutations.slice(0, 1)
          : input.mutations) {
          const destination = path.join(f.workspace, mutation.relativePath);
          if (mutation.afterText === null) rmSync(destination);
          else writeFileSync(destination, mutation.afterText);
        }
        throw new Error("SIMULATED_PROCESS_EXIT");
      });
      expect(() =>
        f.adapter.undoRunEdits(f.context.projection.runId, undefined, f.context),
      ).toThrow("SIMULATED_PROCESS_EXIT");
      f.close();
      const reopened = new ToolRepository(path.join(f.profile, "openerx.sqlite"), {
        ownerProfileId: "profile-a",
      });
      reopened.recoverInterrupted();
      const adapter = new WorkspaceToolAdapter(reopened, f.profile);
      adapter.undoRunEdits(f.context.projection.runId, undefined, f.context);
      expect(readFileSync(target, "utf8")).toContain("value = 1");
      expect(existsSync(path.join(f.workspace, "src/new.txt"))).toBe(false);
      expect(reopened.pendingWorkspaceUndo(f.context.projection.runId)).toBeNull();
      expect(
        reopened
          .workItemDetail(f.context.projection.workItemId)
          .workspaceEdits.every(({ status }) => status === "reverted"),
      ).toBe(true);
      reopened.close();
    },
  );
});

describe("WorkspaceToolAdapter", () => {
  it("loads layered instructions and applies, reviews, and undoes an atomic patch", async () => {
    const { adapter, chat, repository, grant, context, workspace } = fixture();
    const instructionResult = await adapter.execute(
      {
        operation: "workspace_instructions",
        workspaceGrantId: grant.id,
        relativePath: "src/app.ts",
        idempotencyKey: "workspace-instructions-0001",
      },
      context,
    );
    const sources = (instructionResult.data as { sources: Array<{ kind: string; digest: string }> })
      .sources;
    expect(sources.map(({ kind }) => kind)).toEqual(["global", "project", "nested"]);

    const before = readFileSync(path.join(workspace, "src", "app.ts"), "utf8");
    const patched = await adapter.execute(
      {
        operation: "workspace_apply_patch",
        workspaceGrantId: grant.id,
        relativePath: "src/app.ts",
        expectedSha256: digest(before),
        replacements: [{ oldText: "value = 1", newText: "value = 2" }],
        instructionDigests: sources.map(({ digest: value }) => value),
        idempotencyKey: "workspace-patch-0001",
      },
      context,
    );
    expect(readFileSync(path.join(workspace, "src", "app.ts"), "utf8")).toContain("value = 2");
    const diff = patched.content.find((part) => part.type === "diff");
    expect(diff).toMatchObject({ relativePath: "src/app.ts" });
    if (diff?.type !== "diff") throw new Error("diff missing");
    expect(diff.patch).toContain("-export const value = 1;");
    expect(repository.run(context.projection.runId).instructionSources).toHaveLength(3);

    await adapter.execute(
      {
        operation: "workspace_undo",
        workspaceGrantId: grant.id,
        workspaceChangeId: diff.workspaceChangeId,
        idempotencyKey: "workspace-undo-0001",
      },
      context,
    );
    expect(readFileSync(path.join(workspace, "src", "app.ts"), "utf8")).toBe(before);
    expect(repository.workspaceChange(diff.workspaceChangeId).status).toBe("reverted");
    chat.close();
    repository.close();
  });

  it("denies traversal, symlink reads, stale patches, and subprocess filesystem escape", async () => {
    const { adapter, chat, repository, grant, context, workspace, outside } = fixture();
    symlinkSync(
      outside,
      path.join(workspace, "secret-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      adapter.execute(
        {
          operation: "workspace_read",
          workspaceGrantId: grant.id,
          relativePath: "../outside/secret.txt",
          startLine: 1,
          maxLines: 20,
          idempotencyKey: "workspace-escape-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_PATH_ESCAPE");
    await expect(
      adapter.execute(
        {
          operation: "workspace_read",
          workspaceGrantId: grant.id,
          relativePath: "secret-link/secret.txt",
          startLine: 1,
          maxLines: 20,
          idempotencyKey: "workspace-symlink-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_SYMLINK_ESCAPE");
    await expect(
      adapter.execute(
        {
          operation: "workspace_apply_patch",
          workspaceGrantId: grant.id,
          relativePath: "src/app.ts",
          expectedSha256: "0".repeat(64),
          replacements: [{ oldText: "value = 1", newText: "value = 2" }],
          instructionDigests: [],
          idempotencyKey: "workspace-stale-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_CONTENT_CHANGED");

    const instructionResult = await adapter.execute(
      {
        operation: "workspace_instructions",
        workspaceGrantId: grant.id,
        relativePath: "src/app.ts",
        idempotencyKey: "workspace-instructions-stale-0001",
      },
      context,
    );
    const instructionDigests = (
      instructionResult.data as { sources: Array<{ digest: string }> }
    ).sources.map(({ digest: value }) => value);
    writeFileSync(path.join(workspace, "src", "AGENTS.md"), "changed nested instruction\n");
    await expect(
      adapter.execute(
        {
          operation: "workspace_apply_patch",
          workspaceGrantId: grant.id,
          relativePath: "src/app.ts",
          expectedSha256: digest(readFileSync(path.join(workspace, "src", "app.ts"), "utf8")),
          replacements: [{ oldText: "value = 1", newText: "value = 2" }],
          instructionDigests,
          idempotencyKey: "workspace-instructions-stale-patch-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_INSTRUCTIONS_NOT_ACKNOWLEDGED");

    const shell = new ShellToolAdapter([], (id, conversationId) =>
      repository.activeWorkspaceGrant(id, conversationId),
    );
    const execution = shell.execute(
      {
        operation: "shell_execute",
        workspaceGrantId: grant.id,
        relativeCwd: ".",
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(path.join(outside, "secret.txt"))}, 'utf8'))`,
        ],
        timeoutMs: 10_000,
        background: false,
        allowNetwork: false,
        idempotencyKey: "workspace-shell-escape-0001",
      },
      context,
    );
    try {
      if (process.platform === "win32" && codexWindowsSandboxReady()) {
        // Windows workspaceWrite is a write/network boundary, not a read sandbox.
        // Keep this explicit so release documentation cannot promise read isolation.
        await expect(execution).resolves.toMatchObject({
          summary: expect.stringContaining("outside-secret"),
          data: { isolation: "codex-windows-restricted-token" },
        });
      } else {
        await expect(execution).rejects.toThrow(
          process.platform === "darwin"
            ? /SHELL_EXIT_/u
            : process.platform === "win32"
              ? "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE"
              : "SHELL_OS_SANDBOX_UNAVAILABLE",
        );
      }
    } finally {
      await shell.stopAll();
    }
    chat.close();
    repository.close();
  });

  it("recovers and undoes a write whose database commit was interrupted", async () => {
    const { adapter, chat, repository, grant, context, workspace } = fixture();
    const target = path.join(workspace, "src", "app.ts");
    const before = readFileSync(target, "utf8");
    const after = before.replace("value = 1", "value = 9");
    const change = repository.createWorkspaceChange({
      workspaceGrantId: grant.id,
      runId: context.projection.runId,
      relativePath: "src/app.ts",
      beforeSha256: digest(before),
      afterSha256: digest(after),
      beforeText: before,
      afterText: after,
      diff: `--- a/src/app.ts\n+++ b/src/app.ts\n-${before}+${after}`,
    });
    writeFileSync(target, after);

    repository.recoverInterrupted();
    expect(repository.workspaceChange(change.id).status).toBe("outcome_unknown");
    const listed = await adapter.execute(
      {
        operation: "workspace_changes",
        workspaceGrantId: grant.id,
        limit: 50,
        idempotencyKey: "workspace-crash-list-0001",
      },
      context,
    );
    expect(listed.data).toMatchObject({
      changes: [expect.objectContaining({ id: change.id, status: "outcome_unknown" })],
    });
    await adapter.execute(
      {
        operation: "workspace_undo",
        workspaceGrantId: grant.id,
        workspaceChangeId: change.id,
        idempotencyKey: "workspace-crash-undo-0001",
      },
      context,
    );
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(repository.workspaceChange(change.id).status).toBe("reverted");
    chat.close();
    repository.close();
  });

  it("reviews, atomically applies, and undoes a persisted isolated change set", async () => {
    const { adapter, chat, repository, grant, context, workspace } = fixture();
    const existingPath = path.join(workspace, "src", "app.ts");
    const createdPath = path.join(workspace, "src", "generated.ts");
    const deletedPath = path.join(workspace, "src", "remove.ts");
    const renamedBeforePath = path.join(workspace, "src", "old-name.ts");
    const renamedAfterPath = path.join(workspace, "src", "new-name.ts");
    writeFileSync(deletedPath, "remove-me\n");
    writeFileSync(renamedBeforePath, "rename-me\n");
    const before = readFileSync(existingPath, "utf8");
    const after = before.replace("value = 1", "value = 7");
    const { toolCall } = repository.createToolCall({
      runId: context.projection.runId,
      piCallRef: "pi-isolated-bash-call",
      toolName: "bash",
      source: "openerx",
      risk: "L3",
      idempotencyKey: "isolated-bash-call-0001",
      inputSummary: "isolated command",
      targetSummary: grant.id,
    });
    const changeSet = repository.createWorkspaceChangeSet({
      workspaceGrantId: grant.id,
      runId: context.projection.runId,
      toolCallId: toolCall.id,
      baselineRevision: "a".repeat(64),
      finalRevision: "b".repeat(64),
      manifest: [
        { relativePath: "src/app.ts", kind: "modified" },
        { relativePath: "src/generated.ts", kind: "created" },
        { relativePath: "src/remove.ts", kind: "deleted" },
        {
          relativePath: "src/new-name.ts",
          previousRelativePath: "src/old-name.ts",
          kind: "renamed",
        },
      ],
      diffs: [
        {
          relativePath: "workspace/src/app.ts",
          patch: `--- a/src/app.ts\n+++ b/src/app.ts\n-${before}+${after}`,
        },
      ],
      entries: [
        {
          workspaceGrantId: grant.id,
          workspaceLogicalName: "workspace",
          relativePath: "src/app.ts",
          previousRelativePath: null,
          kind: "modified",
          entryType: "file",
          beforeSha256: digest(before),
          afterSha256: digest(after),
          beforeText: before,
          afterText: after,
          applySupported: true,
        },
        {
          workspaceGrantId: grant.id,
          workspaceLogicalName: "workspace",
          relativePath: "src/remove.ts",
          previousRelativePath: null,
          kind: "deleted",
          entryType: "file",
          beforeSha256: digest("remove-me\n"),
          afterSha256: null,
          beforeText: "remove-me\n",
          afterText: null,
          applySupported: true,
        },
        {
          workspaceGrantId: grant.id,
          workspaceLogicalName: "workspace",
          relativePath: "src/new-name.ts",
          previousRelativePath: "src/old-name.ts",
          kind: "renamed",
          entryType: "file",
          beforeSha256: digest("rename-me\n"),
          afterSha256: digest("rename-me\n"),
          beforeText: "rename-me\n",
          afterText: "rename-me\n",
          applySupported: true,
        },
        {
          workspaceGrantId: grant.id,
          workspaceLogicalName: "workspace",
          relativePath: "src/generated.ts",
          previousRelativePath: null,
          kind: "created",
          entryType: "file",
          beforeSha256: null,
          afterSha256: digest("generated\n"),
          beforeText: null,
          afterText: "generated\n",
          applySupported: true,
        },
      ],
      blocked: false,
    });

    await expect(
      adapter.execute(
        {
          operation: "workspace_change_set_apply",
          workspaceGrantId: grant.id,
          workspaceChangeSetId: changeSet.id,
          idempotencyKey: "change-set-unreviewed-apply-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_CHANGE_SET_NOT_APPLICABLE");

    const reviewed = await adapter.execute(
      {
        operation: "workspace_change_set_review",
        workspaceGrantId: grant.id,
        workspaceChangeSetId: changeSet.id,
        idempotencyKey: "change-set-review-0001",
      },
      context,
    );
    expect(reviewed.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "diff" })]),
    );
    await adapter.execute(
      {
        operation: "workspace_change_set_apply",
        workspaceGrantId: grant.id,
        workspaceChangeSetId: changeSet.id,
        idempotencyKey: "change-set-apply-0001",
      },
      context,
    );
    expect(readFileSync(existingPath, "utf8")).toBe(after);
    expect(readFileSync(createdPath, "utf8")).toBe("generated\n");
    expect(existsSync(deletedPath)).toBe(false);
    expect(existsSync(renamedBeforePath)).toBe(false);
    expect(readFileSync(renamedAfterPath, "utf8")).toBe("rename-me\n");
    expect(repository.workspaceChangeSet(changeSet.id).status).toBe("applied");

    await adapter.execute(
      {
        operation: "workspace_change_set_undo",
        workspaceGrantId: grant.id,
        workspaceChangeSetId: changeSet.id,
        idempotencyKey: "change-set-undo-0001",
      },
      context,
    );
    expect(readFileSync(existingPath, "utf8")).toBe(before);
    expect(existsSync(createdPath)).toBe(false);
    expect(readFileSync(deletedPath, "utf8")).toBe("remove-me\n");
    expect(readFileSync(renamedBeforePath, "utf8")).toBe("rename-me\n");
    expect(existsSync(renamedAfterPath)).toBe(false);
    expect(repository.workspaceChangeSet(changeSet.id).status).toBe("reverted");
    chat.close();
    repository.close();
  });

  it("rejects stale change-set baselines and allows blocked sets to be discarded", async () => {
    const { adapter, chat, repository, grant, context, workspace } = fixture();
    const target = path.join(workspace, "src", "app.ts");
    const before = readFileSync(target, "utf8");
    const { toolCall } = repository.createToolCall({
      runId: context.projection.runId,
      piCallRef: "pi-change-set-conflict",
      toolName: "bash",
      source: "openerx",
      risk: "L3",
      idempotencyKey: "isolated-bash-conflict-0001",
      inputSummary: "isolated command",
      targetSummary: grant.id,
    });
    const entry = {
      workspaceGrantId: grant.id,
      workspaceLogicalName: "workspace",
      relativePath: "src/app.ts",
      previousRelativePath: null,
      kind: "modified" as const,
      entryType: "file" as const,
      beforeSha256: digest(before),
      afterSha256: digest("isolated\n"),
      beforeText: before,
      afterText: "isolated\n",
      applySupported: true,
    };
    const conflict = repository.createWorkspaceChangeSet({
      workspaceGrantId: grant.id,
      runId: context.projection.runId,
      toolCallId: toolCall.id,
      baselineRevision: "c".repeat(64),
      finalRevision: "d".repeat(64),
      manifest: [],
      diffs: [],
      entries: [entry],
      blocked: false,
    });
    writeFileSync(target, "user-concurrent-edit\n");
    await adapter.execute(
      {
        operation: "workspace_change_set_review",
        workspaceGrantId: grant.id,
        workspaceChangeSetId: conflict.id,
        idempotencyKey: "change-set-conflict-review-0001",
      },
      context,
    );
    await expect(
      adapter.execute(
        {
          operation: "workspace_change_set_apply",
          workspaceGrantId: grant.id,
          workspaceChangeSetId: conflict.id,
          idempotencyKey: "change-set-conflict-apply-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_CHANGE_SET_CONFLICT");
    expect(repository.workspaceChangeSet(conflict.id).status).toBe("reviewed");
    expect(readFileSync(target, "utf8")).toBe("user-concurrent-edit\n");

    const blocked = repository.createWorkspaceChangeSet({
      workspaceGrantId: grant.id,
      runId: context.projection.runId,
      toolCallId: toolCall.id,
      baselineRevision: "e".repeat(64),
      finalRevision: "f".repeat(64),
      manifest: [{ relativePath: "asset.bin", diffStatus: "binary" }],
      diffs: [],
      entries: [{ ...entry, relativePath: "asset.bin", applySupported: false }],
      blocked: true,
    });
    await expect(
      adapter.execute(
        {
          operation: "workspace_change_set_apply",
          workspaceGrantId: grant.id,
          workspaceChangeSetId: blocked.id,
          idempotencyKey: "change-set-blocked-apply-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_CHANGE_SET_BLOCKED");
    await adapter.execute(
      {
        operation: "workspace_change_set_discard",
        workspaceGrantId: grant.id,
        workspaceChangeSetId: blocked.id,
        idempotencyKey: "change-set-blocked-discard-0001",
      },
      context,
    );
    expect(repository.workspaceChangeSet(blocked.id).status).toBe("discarded");

    const recoveryBefore = readFileSync(target, "utf8");
    const recoveryAfter = "partially-applied-before-crash\n";
    const recovering = repository.createWorkspaceChangeSet({
      workspaceGrantId: grant.id,
      runId: context.projection.runId,
      toolCallId: toolCall.id,
      baselineRevision: "1".repeat(64),
      finalRevision: "2".repeat(64),
      manifest: [{ relativePath: "src/app.ts", kind: "modified" }],
      diffs: [],
      entries: [
        {
          ...entry,
          beforeSha256: digest(recoveryBefore),
          afterSha256: digest(recoveryAfter),
          beforeText: recoveryBefore,
          afterText: recoveryAfter,
        },
      ],
      blocked: false,
    });
    repository.markWorkspaceChangeSet(recovering.id, "applying");
    writeFileSync(target, recoveryAfter);
    repository.recoverInterrupted();
    expect(repository.workspaceChangeSet(recovering.id).status).toBe("outcome_unknown");
    await adapter.execute(
      {
        operation: "workspace_change_set_undo",
        workspaceGrantId: grant.id,
        workspaceChangeSetId: recovering.id,
        idempotencyKey: "change-set-recover-undo-0001",
      },
      context,
    );
    expect(readFileSync(target, "utf8")).toBe(recoveryBefore);
    expect(repository.workspaceChangeSet(recovering.id).status).toBe("reverted");
    chat.close();
    repository.close();
  });
});
