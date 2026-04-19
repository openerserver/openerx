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

  it("suppresses top-level candidate prompts that belong to the pending parallel sessions", () => {
    const items = buildConversationItemsWithParallelRuns({
      baseConversationItems: [
        {
          key: "15d71817-2f0c-4e0d-b4b0-7ad39312df8d:user-prompt",
          role: "user",
          text: "package.json  是什么？",
          createdAt: "2026-04-16T03:39:32.401Z",
          toolCalls: [],
          raw: {
            id: "15d71817-2f0c-4e0d-b4b0-7ad39312df8d:user-prompt",
            sessionId: "15d71817-2f0c-4e0d-b4b0-7ad39312df8d",
          },
        } as any,
        {
          key: "11e568b2-5610-436c-913d-8813604c7095:user-prompt",
          role: "user",
          text: "pi-monorepo 项目 是什么？",
          createdAt: "2026-04-16T03:44:35.294Z",
          toolCalls: [],
          raw: {
            id: "11e568b2-5610-436c-913d-8813604c7095:user-prompt",
            sessionId: "11e568b2-5610-436c-913d-8813604c7095",
          },
        } as any,
        {
          key: "65ad1ede-ed5a-4705-969b-405342dcc85f:user-prompt",
          role: "user",
          text: "pi-monorepo 项目 是什么？",
          createdAt: "2026-04-16T03:44:35.282Z",
          toolCalls: [],
          raw: {
            id: "65ad1ede-ed5a-4705-969b-405342dcc85f:user-prompt",
            sessionId: "65ad1ede-ed5a-4705-969b-405342dcc85f",
          },
        } as any,
      ],
      parallelConversationItems: [
        {
          key: "parallel-task-session:task-phase:phase-1",
          role: "parallel",
          createdAt: "2026-04-16T03:44:35.294Z",
          candidates: [
            {
              key: "candidate-a",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [
                {
                  key: "65ad1ede-ed5a-4705-969b-405342dcc85f:assistant:1",
                  role: "assistant",
                  text: "候选 A 回复",
                  createdAt: "2026-04-16T03:44:49.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
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
              items: [
                {
                  key: "11e568b2-5610-436c-913d-8813604c7095:assistant:1",
                  role: "assistant",
                  text: "候选 B 回复",
                  createdAt: "2026-04-16T03:44:46.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: true,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: {
            parallelRunId: "run-1",
            candidateSessions: [
              { sessionId: "65ad1ede-ed5a-4705-969b-405342dcc85f" },
              { sessionId: "11e568b2-5610-436c-913d-8813604c7095" },
            ],
          },
          toolCalls: [],
        } as any,
      ],
    });

    expect(items.map((item) => item.key)).toEqual([
      "15d71817-2f0c-4e0d-b4b0-7ad39312df8d:user-prompt",
      "parallel-task-session:task-phase:phase-1",
    ]);
  });

  it("injects all adopted candidate assistant replies into the mainline when no top-level assistant reply exists", () => {
    const items = buildConversationItemsWithParallelRuns({
      baseConversationItems: [
        {
          key: "user-1",
          role: "user",
          text: "给我最终建议",
          createdAt: "2026-04-12T10:00:00.000Z",
          toolCalls: [],
          raw: null,
        } as any,
        {
          key: "user-2",
          role: "user",
          text: "下一轮提问",
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
              items: [
                {
                  key: "candidate-a-first",
                  role: "assistant",
                  text: "这是采纳候选的第一条模型回复",
                  createdAt: "2026-04-12T10:05:10.000Z",
                  toolCalls: [],
                  raw: null,
                },
                {
                  key: "candidate-a-final",
                  role: "assistant",
                  text: "这是采纳后的正式回复",
                  createdAt: "2026-04-12T10:05:30.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: false,
              isAdopted: true,
              isRecommended: false,
            },
            {
              key: "candidate-b",
              index: 1,
              label: "候选 B",
              status: "completed",
              loading: false,
              items: [
                {
                  key: "candidate-b-final",
                  role: "assistant",
                  text: "另一个候选回复",
                  createdAt: "2026-04-12T10:05:28.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: false,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: { anchorMessageId: "user-1", candidateSessions: [] },
          toolCalls: [],
        } as any,
      ],
    });

    expect(items.map((item) => item.key)).toEqual([
      "user-1",
      "parallel-run-1",
      "parallel-adopted:parallel-run-1:candidate-a-first",
      "parallel-adopted:parallel-run-1:candidate-a-final",
      "user-2",
    ]);
    expect(items[2]).toMatchObject({
      role: "assistant",
      text: "这是采纳候选的第一条模型回复",
    });
    expect(items[3]).toMatchObject({
      role: "assistant",
      text: "这是采纳后的正式回复",
    });
  });
});