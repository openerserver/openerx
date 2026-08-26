import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedToolResult } from "@openerx/contracts";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuiltinToolAdapter, CapabilityBroker, operationDigest, WebSearchAdapter } from "../src";

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
    title: "使用工具",
    selectedModelRef: "platform/auto",
    piPackageVersion: "0.84.3",
    piHostContractVersion: 1,
  });
  return {
    chat,
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

  it("blocks Web search until the exact payload is approved and keeps sources", async () => {
    const { chat, repository, projection } = fixture();
    const expected: NormalizedToolResult = {
      summary: "两条结果",
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

    const blocked = await broker.execute(projection, operation);
    expect(blocked.status).toBe("permission_required");
    if (blocked.status !== "permission_required") throw new Error("expected permission");
    expect(blocked.permission.payloadDigest).toBe(operationDigest(operation));
    expect(transport.search).not.toHaveBeenCalled();

    broker.resolvePermission({
      permissionRequestId: blocked.permission.id,
      decision: "session",
      payloadDigest: blocked.permission.payloadDigest,
    });
    const completed = await broker.execute(projection, operation);
    expect(completed).toMatchObject({ status: "completed", result: { sources: expected.sources } });
    expect(repository.activeScopes("web.search")).toHaveLength(1);
    expect(transport.search).toHaveBeenCalledTimes(1);
    chat.close();
    repository.close();
  });

  it("does not reuse a remote session scope outside its approved conversation", async () => {
    const { chat, repository, projection } = fixture();
    const transport = {
      search: vi.fn(async () => ({
        summary: "result",
        data: {},
        sources: [],
        artifacts: [],
        sideEffectCommitted: false,
        durationMs: 1,
      })),
    };
    const broker = new CapabilityBroker(repository, [new WebSearchAdapter(transport)]);
    const firstOperation = {
      operation: "web_search" as const,
      query: "conversation A",
      recencyDays: 7,
      idempotencyKey: "conversation-a-search",
    };
    const blocked = await broker.execute(projection, firstOperation);
    if (blocked.status !== "permission_required") throw new Error("expected permission");
    broker.resolvePermission({
      permissionRequestId: blocked.permission.id,
      decision: "session",
      payloadDigest: blocked.permission.payloadDigest,
      scopeConversationId: projection.conversationId,
    });
    expect((await broker.execute(projection, firstOperation)).status).toBe("completed");

    const secondGeneration = chat.createGeneration({
      text: "另一个对话",
      idempotencyKey: "chat-broker-0002",
    });
    const secondProjection = repository.createProjection({
      conversationId: secondGeneration.receipt.conversationId,
      messageId: secondGeneration.receipt.assistantMessageId,
      title: "另一个对话",
      selectedModelRef: "platform/auto",
      piPackageVersion: "0.84.3",
      piHostContractVersion: 1,
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
        query: "conversation B",
        idempotencyKey: "conversation-b-search",
      },
    );
    expect(second.status).toBe("permission_required");
    expect(transport.search).toHaveBeenCalledTimes(1);
    expect(repository.activeScopes("web.search")[0]?.conversationId).toBe(
      projection.conversationId,
    );
    chat.close();
    repository.close();
  });
});
