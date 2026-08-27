import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { ShellToolAdapter, WorkspaceToolAdapter } from "../src";

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
    symlinkSync(path.join(outside, "secret.txt"), path.join(workspace, "secret-link"));
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
          relativePath: "secret-link",
          startLine: 1,
          maxLines: 20,
          idempotencyKey: "workspace-symlink-0001",
        },
        context,
      ),
    ).rejects.toThrow("WORKSPACE_SYMLINK_DENIED");
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
    await expect(execution).rejects.toThrow(
      process.platform === "darwin" ? /SHELL_EXIT_/u : "SHELL_OS_SANDBOX_UNAVAILABLE",
    );
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
});
