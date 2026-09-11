import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  aggregateByokUsage,
  type ByokUsageRecord,
  byokUsageRecordSchema,
  classifyModelError,
  piHostContractVersion,
} from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository, ToolRepository } from "../src";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-byok-usage-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "openerx.sqlite");
  const chat = new ChatRepository(databasePath, {
    ownerProfileId: "profile-a",
    selectedModelRef: "platform/byok.fixture",
  });
  const tools = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
  cleanup.push(
    () => chat.close(),
    () => tools.close(),
  );
  const generation = chat.createGeneration({ text: "fixture", idempotencyKey: randomUUID() });
  const projection = tools.createProjection({
    conversationId: generation.receipt.conversationId,
    messageId: generation.receipt.assistantMessageId,
    branchId: generation.receipt.branchId,
    title: "fixture",
    selectedModelRef: generation.selectedModelRef,
    thinkingLevel: generation.thinkingLevel,
    piPackageVersion: "0.84.4",
    piHostContractVersion,
  });
  const record = (): ByokUsageRecord => {
    const usageId = randomUUID();
    return byokUsageRecordSchema.parse({
      usageId,
      source: "byok",
      accountId: null,
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      runId: null,
      toolCallId: null,
      operation: "chat",
      operationId: randomUUID(),
      selectedModelRef: "platform/byok.fixture",
      effectiveModelRef: "byok/actual",
      fallbackReason: null,
      inputTokens: 10,
      promptTokens: 15,
      cachedInputTokens: 5,
      outputTokens: 3,
      reasoningTokens: null,
      totalTokens: 18,
      providerReported: true,
      missingReasons: { reasoningTokens: "provider_usage_missing" },
      status: "completed",
      failure: null,
      dedupeKey: `byok:${usageId}`,
      startedAt: "2026-09-11T04:00:00.000Z",
      recordedAt: "2026-09-11T04:00:01.000Z",
    });
  };
  return { databasePath, chat, tools, generation, projection, record };
}

describe("local BYOK usage persistence", () => {
  it("persists once per attempt and retains records after finalization, replay and reopening", () => {
    const { databasePath, tools, generation, projection, record } = fixture();
    const usage = record();
    tools.recordByokUsage(usage, projection.run.id);
    tools.recordByokUsage(usage, projection.run.id);
    tools.completeRun(projection.run.id, "failed", "MODEL_RATE_LIMITED");
    tools.recordByokUsage(usage);
    expect(tools.run(projection.run.id).usageRecords).toHaveLength(1);
    const reopened = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
    cleanup.push(() => reopened.close());
    expect(reopened.byokUsage({ messageId: generation.receipt.assistantMessageId })).toMatchObject({
      selectedModelRef: "platform/byok.fixture",
      records: [{ usageId: usage.usageId, runId: projection.run.id }],
    });
    expect(() => reopened.recordByokUsage({ ...usage, totalTokens: 999 })).toThrow(
      "BYOK_USAGE_DEDUPE_CONFLICT",
    );
    expect(reopened.run(projection.run.id).usageRecords[0]?.totalTokens).toBe(18);
  });

  it("keeps profiles and message/conversation scopes isolated", () => {
    const { databasePath, tools, generation, record } = fixture();
    const usage = record();
    tools.recordByokUsage(usage);
    const other = new ToolRepository(databasePath, { ownerProfileId: "profile-b" });
    cleanup.push(() => other.close());
    expect(other.byokUsage().records).toEqual([]);
    expect(() => other.recordByokUsage(usage)).toThrow("BYOK_USAGE_SCOPE_INVALID");
    expect(
      tools.byokUsage({
        conversationId: randomUUID(),
        messageId: generation.receipt.assistantMessageId,
      }).records,
    ).toEqual([]);
    expect(() => tools.recordByokUsage({ ...record(), messageId: randomUUID() })).toThrow(
      "BYOK_USAGE_SCOPE_INVALID",
    );
  });

  it("includes background calls and failed unknown usage without adding unknown as known zero", () => {
    const { tools, record } = fixture();
    const known = record();
    tools.recordByokUsage(known);
    const background = {
      ...record(),
      conversationId: null,
      messageId: null,
      operation: "memory_clustering" as const,
      status: "failed" as const,
      failure: classifyModelError("MODEL_NETWORK_ERROR"),
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      promptTokens: null,
      providerReported: false,
    };
    tools.recordByokUsage(background);
    expect(aggregateByokUsage(tools.byokUsage().records)).toMatchObject({
      accountId: null,
      source: "byok",
      records: 2,
      totalTokens: { known: 18, unknownRecords: 1 },
      reasoningTokens: { known: 0, unknownRecords: 2 },
    });
  });

  it("retains consumption when cancellation finalizes a run", () => {
    const { tools, projection, record } = fixture();
    tools.recordByokUsage(
      { ...record(), status: "cancelled", failure: classifyModelError("MODEL_REQUEST_ABORTED") },
      projection.run.id,
    );
    tools.completeRun(projection.run.id, "interrupted");
    expect(tools.run(projection.run.id)).toMatchObject({
      status: "interrupted",
      usageRecords: [{ totalTokens: 18, status: "cancelled" }],
    });
  });

  it("accepts late usage from an owned deleted conversation without showing it in queries", () => {
    const { chat, tools, generation, projection, record } = fixture();
    chat.deleteConversation(generation.receipt.conversationId);
    expect(() => tools.recordByokUsage(record(), projection.run.id)).not.toThrow();
    expect(tools.byokUsage().records).toEqual([]);
  });
});
