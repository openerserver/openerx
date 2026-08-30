import { describe, expect, it } from "vitest";
import {
  automaticMemoryCreatedEventFrameSchema,
  chatCommandEnvelopeSchema,
  memoryEntrySchema,
  parseChatCommandResult,
  piMemoryExtractFrameSchema,
  piMemoryExtractResultFrameSchema,
  piPromptFrameSchema,
  toolOperationSchema,
} from "../src";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const timestamp = "2026-08-30T00:00:00.000Z";

describe("memory contracts", () => {
  it("accepts strict settings and explicit-memory commands", () => {
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "memory.settings.update",
        input: { memoriesEnabled: true, useMemories: true },
      }).command,
    ).toBe("memory.settings.update");
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "memory.conversation.settings.update",
        input: { conversationId: id("9"), useMemories: false },
      }).command,
    ).toBe("memory.conversation.settings.update");
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "memory.clear",
        input: { kind: "preference", idempotencyKey: "memory-clear-kind-0001" },
      }).input,
    ).toMatchObject({ kind: "preference" });
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "memory.upsert",
        input: {
          kind: "preference",
          content: "先给结论，再给必要细节。",
          conflictKey: "response.structure",
          idempotencyKey: "memory-contract-0001",
        },
      }).command,
    ).toBe("memory.upsert");
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "memory.sources.list",
        input: { memoryId: id("16") },
      }).command,
    ).toBe("memory.sources.list");
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "memory.merge-reviews.resolve",
        input: {
          reviewId: id("17"),
          resolution: "accept",
          idempotencyKey: "memory-review-contract-0001",
        },
      }).command,
    ).toBe("memory.merge-reviews.resolve");
  });

  it("returns bounded, account-scoped memory source links", () => {
    expect(
      parseChatCommandResult("memory.sources.list", [
        {
          memoryId: id("30"),
          ownerProfileId: "local-default",
          conversationId: id("31"),
          messageId: id("32"),
          origin: "automatic",
          confidence: 0.93,
          conversationTitle: "来源对话",
          conversationDeletedAt: null,
          createdAt: timestamp,
        },
      ]),
    ).toEqual([expect.objectContaining({ conversationId: id("31") })]);
  });

  it("carries bounded recalled memories into a Pi prompt frame", () => {
    const memory = memoryEntrySchema.parse({
      id: id("1"),
      ownerProfileId: "local-default",
      scope: "personal",
      kind: "preference",
      content: "先给结论。",
      retrievalKeys: ["结论"],
      canonicalKey: "preference:先给结论。",
      conflictKey: null,
      origin: "explicit",
      confidence: 1,
      status: "active",
      sourceConversationId: null,
      sourceMessageId: null,
      supersedesMemoryId: null,
      expiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    });
    const prompt = piPromptFrameSchema.parse({
      kind: "pi.session.prompt",
      generationId: id("2"),
      conversationId: id("3"),
      branchId: id("4"),
      assistantMessageId: id("5"),
      history: [{ role: "user", text: "请解释方案" }],
      memoryEnabled: true,
      memories: [
        {
          id: memory.id,
          kind: memory.kind,
          content: memory.content,
          score: 0.8,
          updatedAt: memory.updatedAt,
        },
      ],
    });
    expect(prompt.memories).toHaveLength(1);
  });

  it("validates Pi-native remember and forget operations", () => {
    expect(
      toolOperationSchema.parse({
        operation: "memory_upsert",
        memoryId: id("7"),
        kind: "workflow",
        content: "提交前运行类型检查。",
        conflictKey: "workflow.preflight",
        idempotencyKey: "memory-tool-0001",
      }).operation,
    ).toBe("memory_upsert");
    expect(
      toolOperationSchema.parse({
        operation: "memory_forget",
        memoryId: id("6"),
        idempotencyKey: "memory-tool-0002",
      }).operation,
    ).toBe("memory_forget");
  });

  it("bounds background Pi memory extraction requests and structured results", () => {
    const sourceMessageId = id("10");
    const request = piMemoryExtractFrameSchema.parse({
      kind: "pi.memory.extract",
      requestId: id("11"),
      jobId: id("12"),
      conversationId: id("13"),
      sourceAssistantMessageId: id("14"),
      messages: [
        { messageId: sourceMessageId, text: "我希望先给结论。" },
        { messageId: id("15"), text: "这是第二条用户消息。" },
      ],
      existingMemories: [
        {
          id: id("16"),
          kind: "preference",
          content: "用户希望先给结论。",
          conflictKey: null,
        },
      ],
    });
    expect(request.messages).toHaveLength(2);
    expect(request.existingMemories).toHaveLength(1);
    expect(
      piMemoryExtractResultFrameSchema.parse({
        kind: "pi.memory.extract-result",
        requestId: request.requestId,
        ok: true,
        output: {
          candidates: [
            {
              kind: "preference",
              content: "用户希望先给结论。",
              retrievalKeys: ["结论"],
              conflictKey: "response.structure",
              confidence: 0.93,
              sourceMessageId,
              semanticRelation: "duplicate",
              relatedMemoryId: id("16"),
            },
          ],
        },
      }),
    ).toMatchObject({ ok: true, usageRecords: [] });
    expect(() =>
      piMemoryExtractResultFrameSchema.parse({
        kind: "pi.memory.extract-result",
        requestId: request.requestId,
        ok: true,
        output: {
          candidates: [
            {
              kind: "preference",
              content: "用户希望先给结论。",
              retrievalKeys: ["结论"],
              conflictKey: null,
              confidence: 0.93,
              sourceMessageId,
              semanticRelation: "conflict",
              relatedMemoryId: null,
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("accepts only active automatic memories in created-memory events", () => {
    const conversationId = id("20");
    const event = {
      kind: "memory.created.event",
      event: {
        eventId: id("21"),
        jobId: id("22"),
        conversationId,
        memories: [
          {
            id: id("23"),
            ownerProfileId: "local-default",
            scope: "personal",
            kind: "preference",
            content: "用户希望先给结论。",
            retrievalKeys: ["结论"],
            canonicalKey: "preference:先给结论",
            conflictKey: "response.structure",
            origin: "automatic",
            confidence: 0.93,
            status: "active",
            sourceConversationId: conversationId,
            sourceMessageId: id("24"),
            supersedesMemoryId: null,
            expiresAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: 1,
          },
        ],
        createdAt: timestamp,
      },
    };

    expect(automaticMemoryCreatedEventFrameSchema.parse(event).event.memories).toHaveLength(1);
    expect(() =>
      automaticMemoryCreatedEventFrameSchema.parse({
        ...event,
        event: {
          ...event.event,
          memories: [{ ...event.event.memories[0], origin: "explicit" }],
        },
      }),
    ).toThrow();
  });
});
