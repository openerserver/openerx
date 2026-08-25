import { randomUUID } from "node:crypto";
import type { UsageRecord } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { UsageStore } from "../src/usage-store";

const stores: UsageStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup(): UsageStore {
  const store = new UsageStore(":memory:");
  stores.push(store);
  return store;
}

function usage(
  accountId: string,
  conversationId: string,
  messageId: string,
  dedupeKey: string,
  values: Partial<UsageRecord> = {},
): UsageRecord {
  return {
    usageId: randomUUID(),
    accountId,
    conversationId,
    messageId,
    runId: null,
    toolCallId: null,
    selectedModelRef: "platform/standard",
    effectiveModelRef: "platform/standard",
    inputTokens: 10,
    cachedInputTokens: 2,
    outputTokens: 5,
    reasoningTokens: null,
    totalTokens: 17,
    providerReported: true,
    missingReasons: { reasoningTokens: "provider_not_reported" },
    dedupeKey,
    recordedAt: "2026-08-25T10:00:00.000Z",
    ...values,
  };
}

describe("UsageStore", () => {
  it("deduplicates exact model-call replays and rejects changed measurements", () => {
    const store = setup();
    const accountId = randomUUID();
    const record = usage(accountId, randomUUID(), randomUUID(), "model-call-stable");
    expect(store.record(record).replayed).toBe(false);
    expect(store.record(record)).toMatchObject({ replayed: true, record });
    expect(store.record({ ...record, recordedAt: "2026-08-25T10:05:00.000Z" })).toMatchObject({
      replayed: true,
      record,
    });
    expect(() => store.record({ ...record, totalTokens: 18 })).toThrow("USAGE_DEDUPE_MISMATCH");
  });

  it("aggregates known values while preserving unknown counts", () => {
    const store = setup();
    const accountId = randomUUID();
    const conversationId = randomUUID();
    store.record(usage(accountId, conversationId, randomUUID(), "model-call-one"));
    store.record(
      usage(accountId, conversationId, randomUUID(), "model-call-two", {
        inputTokens: null,
        totalTokens: null,
        providerReported: false,
        missingReasons: {
          inputTokens: "upstream_timeout",
          reasoningTokens: "provider_not_reported",
          totalTokens: "upstream_timeout",
        },
      }),
    );
    const aggregate = store.aggregate({ accountId, conversationId });
    expect(aggregate).toMatchObject({
      records: 2,
      inputTokens: { known: 10, unknownRecords: 1 },
      outputTokens: { known: 10, unknownRecords: 0 },
      reasoningTokens: { known: 0, unknownRecords: 2 },
      totalTokens: { known: 17, unknownRecords: 1 },
    });
  });

  it("does not expose records across account scopes", () => {
    const store = setup();
    const owner = randomUUID();
    const stranger = randomUUID();
    const record = usage(owner, randomUUID(), randomUUID(), "model-call-private");
    store.record(record);
    expect(store.list({ accountId: stranger })).toEqual([]);
    expect(() => store.get(stranger, record.usageId)).toThrow("USAGE_NOT_FOUND");
  });

  it("preserves selected, effective and fallback model evidence", () => {
    const store = setup();
    const accountId = randomUUID();
    const record = usage(accountId, randomUUID(), randomUUID(), "model-call-fallback", {
      effectiveModelRef: "platform/tools",
      fallbackReason: "approved outage",
    });
    store.record(record);
    expect(store.list({ accountId })).toEqual([record]);
  });
});
