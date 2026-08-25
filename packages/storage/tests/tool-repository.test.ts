import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository, ToolRepository } from "../src";

const temporaryDirectories: string[] = [];

function fixture(): { databasePath: string; chat: ChatRepository; tools: ToolRepository } {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-tool-repository-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "openerx.sqlite");
  return {
    databasePath,
    chat: new ChatRepository(databasePath, { ownerProfileId: "profile-a" }),
    tools: new ToolRepository(databasePath, { ownerProfileId: "profile-a" }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ToolRepository", () => {
  it("persists the Pi projection, exact once permission, and idempotent side effect", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "运行工具",
      idempotencyKey: "chat-tool-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      title: "运行工具",
      selectedModelRef: "platform/auto",
      piPackageVersion: "0.84.3",
      piHostContractVersion: 1,
      piSessionRef: "session-a",
    });
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-call-1",
      toolName: "openerx_shell",
      source: "openerx",
      risk: "L5",
      idempotencyKey: "tool-side-effect-0001",
      inputSummary: "pwd",
      targetSummary: "/workspace",
    });
    const request = tools.createPermission({
      workItemId: projection.workItem.id,
      runId: projection.run.id,
      toolCallId: toolCall.id,
      capability: "shell",
      risk: "L5",
      resourceType: "workspace",
      resource: "/workspace",
      actions: ["execute"],
      reason: "执行本地命令",
      payloadDigest: "a".repeat(64),
    });

    expect(tools.workItem(projection.workItem.id).status).toBe("waiting_for_permission");
    expect(() =>
      tools.resolvePermission({
        permissionRequestId: request.id,
        decision: "once",
        payloadDigest: "b".repeat(64),
      }),
    ).toThrow("PERMISSION_PAYLOAD_CHANGED");
    expect(() =>
      tools.resolvePermission({
        permissionRequestId: request.id,
        decision: "persistent",
        payloadDigest: request.payloadDigest,
      }),
    ).toThrow("PERMISSION_DECISION_NOT_ALLOWED");

    const resolved = tools.resolvePermission({
      permissionRequestId: request.id,
      decision: "once",
      payloadDigest: request.payloadDigest,
    });
    expect(resolved.permission.status).toBe("approved");
    expect(resolved.scope).toBeNull();
    expect(tools.activeScopes("shell")).toEqual([]);

    tools.markToolCall(toolCall.id, "running");
    const result = {
      summary: "ok",
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 3,
    };
    tools.commitSideEffect(toolCall.idempotencyKey, toolCall.id, result);
    tools.markToolCall(toolCall.id, "completed", { resultSummary: result.summary });
    expect(tools.sideEffect(toolCall.idempotencyKey)).toEqual(result);

    tools.completeRun(projection.run.id, "completed");
    expect(tools.workItem(projection.workItem.id).status).toBe("completed");
    chat.close();
    tools.close();
  });

  it("fails interrupted runs and revokes temporary grants on recovery", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({ text: "长任务", idempotencyKey: "chat-tool-0002" });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      title: "长任务",
      selectedModelRef: "platform/auto",
      piPackageVersion: "0.84.3",
      piHostContractVersion: 1,
    });
    tools.createScope({
      capability: "browser",
      resourceType: "domain",
      resource: "example.com",
      actions: ["navigate"],
      maxRisk: "L2",
      sessionOnly: true,
      expiresAt: null,
    });
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-call-long",
      toolName: "openerx_browser",
      source: "openerx",
      risk: "L2",
      idempotencyKey: "tool-side-effect-0002",
      inputSummary: "open",
      targetSummary: "example.com",
    });
    tools.markToolCall(toolCall.id, "running");

    expect(tools.recoverInterrupted()).toEqual({
      toolCalls: 1,
      runs: 1,
      scopes: 1,
      permissions: 0,
    });
    expect(tools.toolCall(toolCall.id)).toMatchObject({
      status: "failed",
      errorCode: "TOOL_HOST_INTERRUPTED",
    });
    expect(tools.activeScopes()).toHaveLength(0);
    chat.close();
    tools.close();
  });

  it("persists only MCP configuration and credential references", () => {
    const { chat, tools } = fixture();
    const server = tools.upsertMcpServer({
      id: "00000000-0000-4000-8000-000000000609",
      name: "remote",
      transport: "streamable_http",
      url: "https://mcp.example.com/mcp",
      auth: "bearer",
      credentialRef: "mcp:00000000-0000-4000-8000-000000000609",
      enabled: true,
      enabledTools: ["search"],
    });
    expect(tools.listMcpServers()).toEqual([server]);
    expect(tools.removeMcpServer(server.id)).toEqual({ serverId: server.id, removed: true });
    expect(tools.listMcpServers()).toEqual([]);
    chat.close();
    tools.close();
  });
});
