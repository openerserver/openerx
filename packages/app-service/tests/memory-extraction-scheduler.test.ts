import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiMemoryExtractFrame } from "@openerx/contracts";
import { ChatRepository, MemoryRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type MemoryExtractionRequest,
  MemoryExtractionScheduler,
  type MemoryExtractor,
  PiMemoryExtractor,
} from "../src/memory-extraction-scheduler";
import type { PiHostClient } from "../src/pi-host-client";

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-memory-extraction-"));
  directories.push(directory);
  return path.join(directory, "openerx.sqlite");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function complete(repository: ChatRepository, assistantMessageId: string, occurredAt: string) {
  const event = repository.appendPiEvent(assistantMessageId, {
    eventId: randomUUID(),
    sequence: 1,
    occurredAt,
    type: "completed",
  });
  if (!event) throw new Error("Expected terminal event");
  return event;
}

function twoTurnConversation(repository: ChatRepository, now: string) {
  const first = repository.createGeneration({
    text: "我长期在上海工作，平时希望使用中文交流，并且所有技术方案都先给明确结论，再给必要的背景、风险和实施细节。",
    idempotencyKey: "memory-extraction-turn-0001",
  });
  complete(repository, first.receipt.assistantMessageId, now);
  const second = repository.createGeneration({
    conversationId: first.receipt.conversationId,
    text: "我的固定开发流程是修改代码后先运行类型检查，再运行相关的专项测试，确认通过后才整理变更说明并交付。",
    idempotencyKey: "memory-extraction-turn-0002",
  });
  const event = complete(repository, second.receipt.assistantMessageId, now);
  return { first, second, event };
}

describe("MemoryExtractionScheduler", () => {
  it("uses a supported medium-thinking platform request for extraction", async () => {
    const extractMemories = vi.fn(async (frame: PiMemoryExtractFrame) => ({
      kind: "pi.memory.extract-result" as const,
      requestId: frame.requestId,
      ok: true as const,
      output: { candidates: [] },
      usageRecords: [],
    }));
    const extractor = new PiMemoryExtractor(
      { extractMemories } as unknown as PiHostClient,
      async () => ({
        authorization: {
          accountId: randomUUID(),
          accessToken: "t".repeat(32),
          accessTokenExpiresAt: "2026-08-31T00:00:00.000Z",
          platformBaseUrl: "https://platform.example.test",
        },
      }),
    );
    const conversationId = randomUUID();
    const jobId = randomUUID();
    await expect(
      extractor.extract({
        job: { id: jobId, conversationId, sourceAssistantMessageId: randomUUID() },
        snapshot: { conversation: { selectedModelRef: "platform/auto" } },
        messages: [],
        existingMemories: [],
      } as unknown as MemoryExtractionRequest),
    ).resolves.toEqual({ candidates: [] });
    expect(extractMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pi.memory.extract",
        jobId,
        conversationId,
        thinkingLevel: "medium",
        platform: expect.objectContaining({ selectedModelRef: "platform/auto" }),
      }),
    );
  });

  it("extracts completed user messages after idle and commits safe automatic memories", async () => {
    const file = databasePath();
    let now = "2026-08-30T00:00:00.000Z";
    const chat = new ChatRepository(file, { now: () => now });
    const memories = new MemoryRepository(file, { now: () => now });
    memories.updateSettings({
      memoriesEnabled: true,
      generateMemories: true,
      idleDelayMinutes: 1,
    });
    const { first, event } = twoTurnConversation(chat, now);
    const extractor: MemoryExtractor = {
      extract: vi.fn(async () => ({
        candidates: [
          {
            kind: "preference" as const,
            content: "用户希望技术方案先给结论。",
            retrievalKeys: ["技术方案", "结论"],
            conflictKey: null,
            confidence: 0.94,
            sourceMessageId: first.receipt.userMessageId ?? "",
          },
          {
            kind: "profile" as const,
            content: "api_key=sk-abcdefghijklmnop",
            retrievalKeys: [],
            conflictKey: null,
            confidence: 0.99,
            sourceMessageId: first.receipt.userMessageId ?? "",
          },
        ],
      })),
    };
    const created = vi.fn();
    const scheduler = new MemoryExtractionScheduler({
      chatRepository: chat,
      memoryRepository: memories,
      extractor,
      onMemoriesCreated: created,
    });
    expect(scheduler.handleChatEvent(event)).toMatchObject({ status: "pending" });

    now = "2026-08-30T00:02:00.000Z";
    await expect(scheduler.tick()).resolves.toEqual([
      expect.objectContaining({ status: "completed", candidateCount: 1 }),
    ]);
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ messageId: first.receipt.userMessageId }),
        ]),
      }),
    );
    const saved = memories.list({ status: "active", limit: 50 });
    expect(saved).toEqual([
      expect.objectContaining({
        origin: "automatic",
        content: "用户希望技术方案先给结论。",
        sourceConversationId: first.receipt.conversationId,
        sourceMessageId: first.receipt.userMessageId,
      }),
    ]);
    expect(created).toHaveBeenCalledOnce();

    memories.delete({ memoryId: saved[0]?.id ?? "", idempotencyKey: "memory-auto-undo-0001" });
    expect(memories.list({ status: "active", limit: 50 })).toEqual([]);
    memories.close();
    chat.close();
  });

  it("skips external context but does not require a client-side quota signal", async () => {
    const file = databasePath();
    let now = "2026-08-30T00:00:00.000Z";
    const chat = new ChatRepository(file, { now: () => now });
    const memories = new MemoryRepository(file, { now: () => now });
    memories.updateSettings({
      memoriesEnabled: true,
      generateMemories: true,
      idleDelayMinutes: 1,
    });
    const first = twoTurnConversation(chat, now);
    const extractor: MemoryExtractor = { extract: vi.fn(async () => ({ candidates: [] })) };
    const scheduler = new MemoryExtractionScheduler({
      chatRepository: chat,
      memoryRepository: memories,
      extractor,
    });
    scheduler.handleChatEvent(first.event);
    now = "2026-08-30T00:02:00.000Z";
    memories.markExternalContext(first.first.receipt.conversationId);
    await expect(scheduler.tick()).resolves.toEqual([
      expect.objectContaining({ status: "skipped", skipReason: "external_context" }),
    ]);
    expect(extractor.extract).not.toHaveBeenCalled();

    memories.updateSettings({ disableOnExternalContext: false });
    memories.scheduleExtraction(
      first.first.receipt.conversationId,
      first.second.receipt.assistantMessageId,
    );
    now = "2026-08-30T00:04:00.000Z";
    await expect(scheduler.tick()).resolves.toEqual([
      expect.objectContaining({ status: "completed", candidateCount: 0 }),
    ]);
    expect(extractor.extract).toHaveBeenCalledOnce();
    memories.close();
    chat.close();
  });

  it("retains a new conversation source without notifying an existing canonical memory again", async () => {
    const file = databasePath();
    let now = "2026-08-30T00:00:00.000Z";
    const chat = new ChatRepository(file, { now: () => now });
    const memories = new MemoryRepository(file, { now: () => now });
    memories.updateSettings({
      memoriesEnabled: true,
      generateMemories: true,
      idleDelayMinutes: 1,
    });
    const original = chat.createGeneration({
      text: "我一直希望技术方案先给明确结论，再给必要细节。",
      idempotencyKey: "memory-existing-source-0001",
    });
    const existing = memories.upsertAutomatic({
      candidate: {
        kind: "preference",
        content: "用户希望技术方案先给结论。",
        retrievalKeys: ["技术方案", "结论"],
        conflictKey: null,
        confidence: 0.94,
        sourceMessageId: original.receipt.userMessageId ?? "",
      },
      conversationId: original.receipt.conversationId,
      jobId: "10000000-0000-4000-8000-000000000201",
    });
    const later = twoTurnConversation(chat, now);
    const extractor: MemoryExtractor = {
      extract: vi.fn(async () => ({
        candidates: [
          {
            kind: "preference" as const,
            content: "用户希望技术方案先给结论。",
            retrievalKeys: ["技术方案", "结论"],
            conflictKey: null,
            confidence: 0.91,
            sourceMessageId: later.first.receipt.userMessageId ?? "",
          },
        ],
      })),
    };
    const created = vi.fn();
    const scheduler = new MemoryExtractionScheduler({
      chatRepository: chat,
      memoryRepository: memories,
      extractor,
      onMemoriesCreated: created,
    });
    scheduler.handleChatEvent(later.event);

    now = "2026-08-30T00:02:00.000Z";
    await expect(scheduler.tick()).resolves.toEqual([
      expect.objectContaining({ status: "completed", candidateCount: 0 }),
    ]);
    expect(created).not.toHaveBeenCalled();
    expect(memories.sources(existing.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId: original.receipt.conversationId }),
        expect.objectContaining({ conversationId: later.first.receipt.conversationId }),
      ]),
    );
    memories.close();
    chat.close();
  });

  it("stages model-related fuzzy candidates for review without changing active memories", async () => {
    const file = databasePath();
    let now = "2026-08-30T00:00:00.000Z";
    const chat = new ChatRepository(file, { now: () => now });
    const memories = new MemoryRepository(file, { now: () => now });
    memories.updateSettings({
      memoriesEnabled: true,
      generateMemories: true,
      idleDelayMinutes: 1,
    });
    const target = memories.upsert({
      kind: "preference",
      content: "用户偏好结论优先的技术方案。",
      idempotencyKey: "memory-review-scheduler-target-0001",
    });
    const conversation = twoTurnConversation(chat, now);
    const extractor: MemoryExtractor = {
      extract: vi.fn(async () => ({
        candidates: [
          {
            kind: "preference" as const,
            content: "用户希望技术方案先给明确结论。",
            retrievalKeys: ["技术方案", "结论"],
            conflictKey: null,
            confidence: 0.91,
            sourceMessageId: conversation.first.receipt.userMessageId ?? "",
            semanticRelation: "duplicate" as const,
            relatedMemoryId: target.id,
          },
        ],
      })),
    };
    const created = vi.fn();
    const scheduler = new MemoryExtractionScheduler({
      chatRepository: chat,
      memoryRepository: memories,
      extractor,
      onMemoriesCreated: created,
    });
    scheduler.handleChatEvent(conversation.event);

    now = "2026-08-30T00:02:00.000Z";
    await expect(scheduler.tick()).resolves.toEqual([
      expect.objectContaining({ status: "completed", candidateCount: 0 }),
    ]);
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        existingMemories: [expect.objectContaining({ id: target.id, content: target.content })],
      }),
    );
    expect(created).not.toHaveBeenCalled();
    expect(memories.list({ status: "active", limit: 50 })).toEqual([
      expect.objectContaining({ id: target.id }),
    ]);
    expect(memories.listMergeReviews()).toEqual([
      expect.objectContaining({ relation: "duplicate", targetMemoryId: target.id }),
    ]);
    memories.close();
    chat.close();
  });

  it("protects explicit conflicts and notifies only the final active automatic value", async () => {
    const file = databasePath();
    let now = "2026-08-30T00:00:00.000Z";
    const chat = new ChatRepository(file, { now: () => now });
    const memories = new MemoryRepository(file, { now: () => now });
    memories.updateSettings({
      memoriesEnabled: true,
      generateMemories: true,
      idleDelayMinutes: 1,
    });
    const explicit = memories.upsert({
      kind: "preference",
      content: "用户明确要求使用中文回复。",
      conflictKey: "response.language",
      idempotencyKey: "memory-scheduler-explicit-0001",
    });
    const conversation = twoTurnConversation(chat, now);
    const sourceMessageId = conversation.first.receipt.userMessageId ?? "";
    const extractor: MemoryExtractor = {
      extract: vi.fn(async () => ({
        candidates: [
          {
            kind: "preference" as const,
            content: "用户偏好使用英文回复。",
            retrievalKeys: ["英文"],
            conflictKey: "response.language",
            confidence: 0.97,
            sourceMessageId,
          },
          {
            kind: "preference" as const,
            content: "用户偏好简短回答。",
            retrievalKeys: ["简短"],
            conflictKey: "response.detail",
            confidence: 0.9,
            sourceMessageId,
          },
          {
            kind: "preference" as const,
            content: "用户偏好详细回答。",
            retrievalKeys: ["详细"],
            conflictKey: "response.detail",
            confidence: 0.93,
            sourceMessageId,
          },
        ],
      })),
    };
    const created = vi.fn();
    const scheduler = new MemoryExtractionScheduler({
      chatRepository: chat,
      memoryRepository: memories,
      extractor,
      onMemoriesCreated: created,
    });
    scheduler.handleChatEvent(conversation.event);

    now = "2026-08-30T00:02:00.000Z";
    await expect(scheduler.tick()).resolves.toEqual([
      expect.objectContaining({ status: "completed", candidateCount: 1 }),
    ]);
    expect(memories.get(explicit.id).status).toBe("active");
    expect(created).toHaveBeenCalledWith(
      [expect.objectContaining({ content: "用户偏好详细回答。", status: "active" })],
      expect.objectContaining({ status: "completed", candidateCount: 1 }),
    );
    memories.close();
    chat.close();
  });
});
