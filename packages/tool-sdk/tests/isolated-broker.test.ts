import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { CapabilityBroker } from "@openerx/tool-sdk/broker";
import { BuiltinToolAdapter } from "@openerx/tool-sdk/builtin-adapter";
import { expect, test, vi } from "vitest";

test("isolated in-memory repositories share Broker constraints and replay without owning the connection", async () => {
  const database = new DatabaseSync(":memory:");
  const other = new DatabaseSync(":memory:");
  try {
    const chat = new ChatRepository(database, { ownerProfileId: "enterprise-a" });
    const tools = new ToolRepository(database, { ownerProfileId: "enterprise-a" });
    const generation = chat.createGeneration({
      text: "secret table",
      idempotencyKey: randomUUID(),
    });
    const p = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "isolated",
      selectedModelRef: "platform/test",
      thinkingLevel: "off",
      piPackageVersion: "1.0.0",
      piHostContractVersion: 11,
    });
    const projection = {
      generationId: randomUUID(),
      workItemId: p.workItem.id,
      runId: p.run.id,
      conversationId: generation.receipt.conversationId,
      assistantMessageId: generation.receipt.assistantMessageId,
      piToolCallId: "one",
      toolName: "compute",
    };
    const adapter = new BuiltinToolAdapter();
    const execute = vi.spyOn(adapter, "execute");
    const broker = new CapabilityBroker(tools, [adapter]);
    const operation = {
      operation: "compute" as const,
      expression: "12*3",
      idempotencyKey: "isolated-memory-step",
    };
    expect(await broker.execute(projection, operation)).toMatchObject({
      status: "completed",
      replayed: false,
      result: { data: { value: 36 } },
    });
    expect(await broker.execute(projection, operation)).toMatchObject({
      status: "completed",
      replayed: true,
    });
    await expect(
      broker.execute(projection, { ...operation, expression: "12*4" }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_IDEMPOTENCY_CONFLICT" });
    expect(execute).toHaveBeenCalledTimes(1);
    const isolated = new ChatRepository(other, { ownerProfileId: "enterprise-a" });
    expect(other.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    tools.close();
    chat.close();
    isolated.close();
    expect(database.prepare("SELECT COUNT(*) AS n FROM tool_calls").get()).toEqual({ n: 1 });
    expect(other.prepare("PRAGMA database_list").all()[0]).toMatchObject({ file: "" });
  } finally {
    database.close();
    other.close();
  }
});
