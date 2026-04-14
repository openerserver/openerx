import { describe, expect, it } from "vitest";
import { buildConversationItemsWithParallelRuns } from "./task-detail-parallel-conversation-projector";

describe("task-detail-parallel-conversation-projector", () => {
  it("inserts unadopted parallel items after their anchor user turn and before the next user turn", () => {
    const items = buildConversationItemsWithParallelRuns({
      baseConversationItems: [
        {
          key: "user-1",
          role: "user",
          text: "先比较两个方案",
          createdAt: "2026-04-12T10:00:00.000Z",
          toolCalls: [],
          raw: null,
        } as any,
        {
          key: "user-2",
          role: "user",
          text: "后续单轮消息",
          createdAt: "2026-04-12T10:10:00.000Z",
          toolCalls: [],
          raw: null,
        } as any,
      ],
      parallelConversationItems: [
        {
          key: "parallel-run-1",
          role: "parallel",
          createdAt: "2026-04-12T10:05:00.000Z",
          candidates: [
            {
              key: "candidate-a",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [],
              canAdopt: true,
              isAdopted: false,
              isRecommended: false,
            },
            {
              key: "candidate-b",
              index: 1,
              label: "候选 B",
              status: "completed",
              loading: false,
              items: [],
              canAdopt: true,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: { anchorMessageId: "user-1" },
          toolCalls: [],
        } as any,
      ],
    });

    expect(items.map((item) => item.key)).toEqual(["user-1", "parallel-run-1", "user-2"]);
  });
});