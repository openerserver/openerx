import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedToolResult } from "@openerx/contracts";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BuiltinToolAdapter,
  CapabilityBroker,
  capabilityRequirement,
  WebSearchAdapter,
  WorkspaceToolAdapter,
} from "../src";

const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-tool-broker-"));
  directories.push(directory);
  const databasePath = path.join(directory, "openerx.sqlite");
  const chat = new ChatRepository(databasePath, { ownerProfileId: "profile-a" });
  const repository = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
  const generation = chat.createGeneration({
    text: "使用工具",
    idempotencyKey: "chat-broker-0001",
  });
  const projection = repository.createProjection({
    conversationId: generation.receipt.conversationId,
    messageId: generation.receipt.assistantMessageId,
    branchId: generation.receipt.branchId,
    title: "使用工具",
    selectedModelRef: "platform/auto",
    thinkingLevel: generation.thinkingLevel,
    piPackageVersion: "0.84.3",
    piHostContractVersion: 2,
  });
  return {
    chat,
    directory,
    repository,
    projection: {
      generationId: "00000000-0000-4000-8000-000000000010",
      workItemId: projection.workItem.id,
      runId: projection.run.id,
      conversationId: generation.receipt.conversationId,
      assistantMessageId: generation.receipt.assistantMessageId,
      piToolCallId: "pi-call-1",
      toolName: "openerx_tool",
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("CapabilityBroker", () => {
  it("uses a dedicated permission capability for image generation", () => {
    expect(
      capabilityRequirement({
        operation: "image_generate",
        prompt: "fixture",
        aspectRatio: "1:1",
        count: 1,
        idempotencyKey: "image-capability-0001",
      }).capability,
    ).toBe("image.generate");
  });

  it("requires per-call approval before applying or undoing an isolated change set", () => {
    const base = {
      workspaceGrantId: "11111111-1111-4111-8111-111111111111",
      workspaceChangeSetId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "workspace-change-set-policy-0001",
    };
    expect(
      capabilityRequirement({ operation: "workspace_change_set_review", ...base }),
    ).toMatchObject({ risk: "L0", approval: "automatic", actions: ["read"] });
    expect(
      capabilityRequirement({ operation: "workspace_change_set_apply", ...base }),
    ).toMatchObject({ risk: "L3", approval: "per_call", actions: ["patch"] });
    expect(
      capabilityRequirement({ operation: "workspace_change_set_undo", ...base }),
    ).toMatchObject({ risk: "L3", approval: "per_call", actions: ["patch"] });
  });

  it("executes deterministic L0 tools without approval and replays by idempotency key", async () => {
    const { chat, repository, projection } = fixture();
    const adapter = new BuiltinToolAdapter();
    const execute = vi.spyOn(adapter, "execute");
    const broker = new CapabilityBroker(repository, [adapter]);
    const operation = {
      operation: "compute" as const,
      expression: "(12 + 3) * 4 ^ 2",
      idempotencyKey: "compute-dedupe-0001",
    };

    const first = await broker.execute(projection, operation);
    const second = await broker.execute(projection, operation);

    expect(first).toMatchObject({
      status: "completed",
      replayed: false,
      result: { summary: "240" },
    });
    expect(second).toMatchObject({
      status: "completed",
      replayed: true,
      result: { summary: "240" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("rejects payload substitution under a completed side-effect idempotency key", async () => {
    const { chat, repository, projection } = fixture();
    const adapter = new BuiltinToolAdapter();
    const execute = vi.spyOn(adapter, "execute");
    const broker = new CapabilityBroker(repository, [adapter]);
    const first = {
      operation: "compute" as const,
      expression: "2 + 2",
      idempotencyKey: "compute-payload-conflict-0001",
    };
    await expect(broker.execute(projection, first)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(
      broker.execute(projection, { ...first, expression: "3 + 3" }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_IDEMPOTENCY_CONFLICT" });
    expect(execute).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("does not ask again for a patch inside an explicitly granted workspace", async () => {
    const { chat, directory, repository, projection } = fixture();
    const workspace = path.join(directory, "workspace");
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    const target = path.join(workspace, "src", "example.ts");
    writeFileSync(target, "before\n");
    const grant = repository.grantWorkspace({
      conversationId: projection.conversationId,
      displayName: "workspace",
      rootPath: workspace,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const broker = new CapabilityBroker(repository, [
      new WorkspaceToolAdapter(repository, directory),
    ]);

    await expect(
      broker.execute(projection, {
        operation: "workspace_apply_patch",
        workspaceGrantId: grant.id,
        relativePath: "src/example.ts",
        expectedSha256: createHash("sha256").update("before\n").digest("hex"),
        replacements: [{ oldText: "before", newText: "after" }],
        instructionDigests: [],
        idempotencyKey: "workspace-patch-auto-0001",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(repository.listPermissions()).toHaveLength(0);
    expect(readFileSync(target, "utf8")).toBe("after\n");
    chat.close();
    repository.close();
  });

  it("runs first-party Web search automatically and keeps sources", async () => {
    const { chat, repository, projection } = fixture();
    const expected: NormalizedToolResult = {
      summary: "两条结果",
      content: [{ type: "text", text: "两条结果" }],
      data: { count: 2 },
      sources: [
        {
          title: "Current source",
          url: "https://example.com/current",
          publishedAt: "2026-08-26T00:00:00.000Z",
          retrievedAt: "2026-08-26T01:00:00.000Z",
          excerpt: "current",
        },
      ],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    };
    const transport = { search: vi.fn(async () => expected) };
    const broker = new CapabilityBroker(repository, [new WebSearchAdapter(transport)]);
    const operation = {
      operation: "web_search" as const,
      query: "latest protocol",
      recencyDays: 7,
      idempotencyKey: "web-search-dedupe-0001",
    };

    const completed = await broker.execute(projection, operation);
    expect(completed).toMatchObject({ status: "completed", result: { sources: expected.sources } });
    expect(repository.activeScopes("web.search")).toHaveLength(0);
    expect(transport.search).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("executes a read-only MCP tool but stops a write tool before its adapter", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "mcp result",
      content: [{ type: "text" as const, text: "mcp result" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [
      { operations: ["mcp_call"] as const, execute },
    ]);
    const readAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    };

    await expect(
      broker.execute(projection, {
        operation: "mcp_call",
        serverId: "00000000-0000-4000-8000-000000000601",
        tool: "read_fixture",
        arguments: { query: "fixture" },
        annotations: readAnnotations,
        descriptorDigest: "a".repeat(64),
        idempotencyKey: "mcp-read-broker-0001",
      }),
    ).resolves.toMatchObject({ status: "completed" });

    const write = await broker.execute(
      { ...projection, piToolCallId: "pi-call-mcp-write", toolName: "mcp__fixture__write" },
      {
        operation: "mcp_call",
        serverId: "00000000-0000-4000-8000-000000000601",
        tool: "write_fixture",
        arguments: { value: "fixture" },
        annotations: { ...readAnnotations, readOnlyHint: false, idempotentHint: false },
        descriptorDigest: "b".repeat(64),
        idempotencyKey: "mcp-write-broker-0001",
      },
    );
    expect(write).toMatchObject({
      status: "permission_required",
      permission: { capability: "mcp", risk: "L4", actions: ["invoke"] },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("derives session scope from the pending request and does not reuse it in another conversation", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "desktop screenshot",
      content: [{ type: "text" as const, text: "desktop screenshot" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [{ operations: ["desktop"], execute }]);
    const firstOperation = {
      operation: "desktop" as const,
      action: "screenshot" as const,
      application: "Notes",
      idempotencyKey: "conversation-a-capture",
    };
    const blocked = await broker.execute(projection, firstOperation);
    if (blocked.status !== "permission_required") throw new Error("expected permission");
    expect(() =>
      broker.resolvePermission({
        permissionRequestId: blocked.permission.id,
        decision: "session",
        payloadDigest: blocked.permission.payloadDigest,
        scopeConversationId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow("PERMISSION_SCOPE_MISMATCH");
    broker.resolvePermission({
      permissionRequestId: blocked.permission.id,
      decision: "session",
      payloadDigest: blocked.permission.payloadDigest,
    });
    expect((await broker.execute(projection, firstOperation)).status).toBe("completed");

    const secondGeneration = chat.createGeneration({
      text: "另一个对话",
      idempotencyKey: "chat-broker-0002",
    });
    const secondProjection = repository.createProjection({
      conversationId: secondGeneration.receipt.conversationId,
      messageId: secondGeneration.receipt.assistantMessageId,
      branchId: secondGeneration.receipt.branchId,
      title: "另一个对话",
      selectedModelRef: "platform/auto",
      thinkingLevel: secondGeneration.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    const second = await broker.execute(
      {
        generationId: "00000000-0000-4000-8000-000000000011",
        workItemId: secondProjection.workItem.id,
        runId: secondProjection.run.id,
        conversationId: secondGeneration.receipt.conversationId,
        assistantMessageId: secondGeneration.receipt.assistantMessageId,
        piToolCallId: "pi-call-2",
        toolName: "openerx_tool",
      },
      {
        ...firstOperation,
        idempotencyKey: "conversation-b-capture",
      },
    );
    expect(second.status).toBe("permission_required");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.activeScopes("desktop")[0]?.conversationId).toBe(projection.conversationId);
    chat.close();
    repository.close();
  });

  it("grants revocable full access to one conversation and bypasses later per-call approvals", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "desktop action",
      content: [{ type: "text" as const, text: "desktop action" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [{ operations: ["desktop"], execute }]);
    const selected = repository.setPermissionMode({
      conversationId: projection.conversationId,
      mode: "full_access",
    });
    expect(selected).toMatchObject({ mode: "full_access", scopeId: expect.any(String) });
    const scope = repository.activeScopes("full_access")[0];
    expect(scope).toMatchObject({
      conversationId: projection.conversationId,
      maxRisk: "L5",
      revokedAt: null,
    });

    expect(
      (
        await broker.execute(projection, {
          operation: "desktop",
          action: "submit",
          application: "Notes",
          idempotencyKey: "full-access-high-impact-0001",
        })
      ).status,
    ).toBe("completed");

    const secondGeneration = chat.createGeneration({
      text: "另一个对话",
      idempotencyKey: "full-access-other-conversation-0001",
    });
    const secondProjection = repository.createProjection({
      conversationId: secondGeneration.receipt.conversationId,
      messageId: secondGeneration.receipt.assistantMessageId,
      branchId: secondGeneration.receipt.branchId,
      title: "另一个对话",
      selectedModelRef: "platform/auto",
      thinkingLevel: secondGeneration.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    const otherConversation = await broker.execute(
      {
        generationId: "00000000-0000-4000-8000-000000000012",
        workItemId: secondProjection.workItem.id,
        runId: secondProjection.run.id,
        conversationId: secondGeneration.receipt.conversationId,
        assistantMessageId: secondGeneration.receipt.assistantMessageId,
        piToolCallId: "pi-call-full-access-other",
        toolName: "openerx_desktop",
      },
      {
        operation: "desktop",
        action: "submit",
        application: "Notes",
        idempotencyKey: "full-access-other-submit-0001",
      },
    );
    expect(otherConversation.status).toBe("permission_required");

    expect(
      repository.setPermissionMode({
        conversationId: projection.conversationId,
        mode: "ask",
      }),
    ).toEqual({
      conversationId: projection.conversationId,
      mode: "ask",
      scopeId: null,
    });
    const afterRevoke = await broker.execute(projection, {
      operation: "desktop",
      action: "submit",
      application: "Notes",
      idempotencyKey: "full-access-after-revoke-0001",
    });
    expect(afterRevoke.status).toBe("permission_required");
    chat.close();
    repository.close();
  });

  it("runs isolated Browser observation automatically but keeps submit per-call", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "browser screenshot",
      content: [{ type: "text" as const, text: "browser screenshot" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [
      { operations: ["browser"] as const, execute },
    ]);
    const screenshot = {
      operation: "browser" as const,
      action: "screenshot" as const,
      sessionId: crypto.randomUUID(),
      idempotencyKey: "browser-screenshot-automatic-0001",
    };
    await expect(broker.execute(projection, screenshot)).resolves.toMatchObject({
      status: "completed",
    });
    const submit = await broker.execute(
      { ...projection, piToolCallId: "pi-call-browser-submit" },
      {
        operation: "browser",
        action: "submit",
        sessionId: screenshot.sessionId,
        selector: "form",
        idempotencyKey: "browser-submit-per-call-0001",
      },
    );
    expect(submit).toMatchObject({
      status: "permission_required",
      permission: { capability: "browser", risk: "L4", actions: ["external_write"] },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("keeps a denied Browser submit out of the Host adapter", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "browser submitted",
      content: [{ type: "text" as const, text: "browser submitted" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [
      { operations: ["browser"] as const, execute },
    ]);
    const operation = {
      operation: "browser" as const,
      action: "submit" as const,
      sessionId: crypto.randomUUID(),
      selector: "form",
      idempotencyKey: "browser-submit-denied-0001",
    };
    const blocked = await broker.execute(projection, operation);
    if (blocked.status !== "permission_required") throw new Error("expected permission");
    broker.resolvePermission({
      permissionRequestId: blocked.permission.id,
      decision: "deny",
      payloadDigest: blocked.permission.payloadDigest,
    });
    await expect(broker.execute(projection, operation)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(execute).not.toHaveBeenCalled();
    chat.close();
    repository.close();
  });

  it("requires Desktop capture approval again after its persistent scope is revoked", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "desktop screenshot",
      content: [{ type: "text" as const, text: "desktop screenshot" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [
      { operations: ["desktop"] as const, execute },
    ]);
    const operation = {
      operation: "desktop" as const,
      action: "screenshot" as const,
      application: "Notes",
      idempotencyKey: "desktop-screenshot-approved-0001",
    };
    const blocked = await broker.execute(projection, operation);
    if (blocked.status !== "permission_required") throw new Error("expected permission");
    broker.resolvePermission({
      permissionRequestId: blocked.permission.id,
      decision: "persistent",
      payloadDigest: blocked.permission.payloadDigest,
    });
    const desktopScope = repository.activeScopes("desktop")[0];
    expect(desktopScope).toMatchObject({ capability: "desktop", actions: ["capture"] });
    await expect(broker.execute(projection, operation)).resolves.toMatchObject({
      status: "completed",
    });
    if (!desktopScope) throw new Error("desktop scope missing");
    repository.revokeScope(desktopScope.id);

    const afterRevoke = await broker.execute(
      { ...projection, piToolCallId: "pi-call-desktop-after-revoke" },
      { ...operation, idempotencyKey: "desktop-screenshot-after-revoke-0001" },
    );
    expect(afterRevoke).toMatchObject({
      status: "permission_required",
      permission: { capability: "desktop", actions: ["capture"] },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("keeps a denied Desktop capture out of the Host adapter", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => ({
      summary: "desktop screenshot",
      content: [{ type: "text" as const, text: "desktop screenshot" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const broker = new CapabilityBroker(repository, [
      { operations: ["desktop"] as const, execute },
    ]);
    const operation = {
      operation: "desktop" as const,
      action: "screenshot" as const,
      application: "Notes",
      idempotencyKey: "desktop-screenshot-denied-0001",
    };
    const blocked = await broker.execute(projection, operation);
    if (blocked.status !== "permission_required") throw new Error("expected permission");
    broker.resolvePermission({
      permissionRequestId: blocked.permission.id,
      decision: "deny",
      payloadDigest: blocked.permission.payloadDigest,
    });
    await expect(broker.execute(projection, operation)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(execute).not.toHaveBeenCalled();
    chat.close();
    repository.close();
  });

  it("does not replay an external action whose outcome became unknown", async () => {
    const { chat, repository, projection } = fixture();
    const execute = vi.fn(async () => {
      throw new Error("HOST_DISCONNECTED_AFTER_ACTION");
    });
    const broker = new CapabilityBroker(repository, [{ operations: ["browser"], execute }]);
    const operation = {
      operation: "browser" as const,
      action: "open" as const,
      url: "https://example.com/current",
      idempotencyKey: "browser-unknown-outcome-0001",
    };

    await expect(broker.execute(projection, operation)).rejects.toThrow(
      "HOST_DISCONNECTED_AFTER_ACTION",
    );
    await expect(broker.execute(projection, operation)).rejects.toMatchObject({
      code: "SIDE_EFFECT_OUTCOME_UNKNOWN",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.sideEffectAttempt(operation.idempotencyKey)?.status).toBe("outcome_unknown");
    chat.close();
    repository.close();
  });
});
