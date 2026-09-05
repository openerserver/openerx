import type { AutomaticMemoryCreatedEvent } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { memoryNotificationContent } from "../src/main/memory-notification";

const event: AutomaticMemoryCreatedEvent = {
  eventId: "00000000-0000-4000-8000-000000000001",
  jobId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  createdAt: "2026-08-30T00:00:00.000Z",
  memories: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      ownerProfileId: "owner",
      scope: "personal",
      kind: "preference",
      content: "这段正文不应出现在系统通知中。",
      retrievalKeys: [],
      canonicalKey: "preference:notification",
      conflictKey: null,
      origin: "automatic",
      confidence: 0.9,
      status: "active",
      sourceConversationId: "00000000-0000-4000-8000-000000000003",
      sourceMessageId: "00000000-0000-4000-8000-000000000005",
      supersedesMemoryId: null,
      expiresAt: null,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      revision: 1,
    },
  ],
};

describe("memoryNotificationContent", () => {
  it("reports the count without exposing memory content", () => {
    const content = memoryNotificationContent(event);
    expect(content).toEqual({
      title: "已生成长期记忆",
      body: "后台新增 1 条长期记忆。点击查看或撤销。",
    });
    expect(content.body).not.toContain(event.memories[0]?.content);
  });
});
