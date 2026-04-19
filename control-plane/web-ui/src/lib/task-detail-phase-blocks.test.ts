import { describe, expect, it } from "vitest";
import { buildTaskDetailPhaseBlocks } from "./task-detail-phase-blocks";

describe("task-detail-phase-blocks", () => {
  it("suppresses top-level candidate session messages inside parallel phase blocks", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "awaiting_adoption",
            startedAt: "2026-04-16T03:44:35.000Z",
          } as any,
          sourceMessages: [
            {
              id: "root-user",
              role: "user",
              text: "请比较两个方案",
              sessionId: "root-session",
              createdAt: "2026-04-16T03:44:34.000Z",
            },
            {
              id: "candidate-a:user-prompt",
              role: "user",
              text: "请比较两个方案",
              sessionId: "candidate-a",
              createdAt: "2026-04-16T03:44:35.100Z",
            },
            {
              id: "candidate-b:user-prompt",
              role: "user",
              text: "请比较两个方案",
              sessionId: "candidate-b",
              createdAt: "2026-04-16T03:44:35.200Z",
            },
            {
              id: "candidate-a:assistant:1",
              role: "assistant",
              text: "候选 A 回复",
              sessionId: "candidate-a",
              createdAt: "2026-04-16T03:44:49.000Z",
            },
          ],
        },
      ],
      parallelConversationItems: [
        {
          key: "parallel-run-1",
          role: "parallel",
          createdAt: "2026-04-16T03:44:35.200Z",
          candidates: [
            {
              key: "candidate-a-card",
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
              key: "candidate-b-card",
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
          raw: {
            phaseId: "phase-1",
            candidateSessions: [{ sessionId: "candidate-a" }, { sessionId: "candidate-b" }],
          },
          toolCalls: [],
        },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.items.map((item) => item.key)).toEqual(["root-user", "parallel-run-1"]);
  });

  it("dedupes equivalent realtime user prompts for the current phase", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "single",
            triggerType: "continue",
            status: "running",
            startedAt: "2026-04-16T03:39:32.000Z",
          } as any,
          sourceMessages: [
            {
              id: "root-user",
              role: "user",
              text: "package.json 是什么？",
              createdAt: "2026-04-16T03:39:32.401Z",
            },
          ],
        },
      ],
      parallelConversationItems: [],
      currentPhaseId: "phase-1",
      currentPhaseRealtimeSourceMessages: [
        {
          id: "task-session-message:task-session:task-1:main:model-a:user-prompt",
          role: "user",
          text: "pi-monorepo 项目 是什么？",
          userInputText: "pi-monorepo 项目 是什么？",
          finalSentText: "pi-monorepo 项目 是什么？",
          createdAt: "2026-04-16T03:44:35.409Z",
          info: {
            id: "task-session-message:task-session:task-1:main:model-a:user-prompt",
            role: "user",
            time: {
              created: "2026-04-16T03:44:35.409Z",
              completed: "2026-04-16T03:44:35.409Z",
            },
          },
          parts: [{ type: "text", text: "pi-monorepo 项目 是什么？" }],
        },
        {
          id: "task-session-message:task-session:task-1:main:model-b:user-prompt",
          role: "user",
          text: "pi-monorepo 项目 是什么？",
          userInputText: "pi-monorepo 项目 是什么？",
          finalSentText: "pi-monorepo 项目 是什么？",
          createdAt: "2026-04-16T03:44:35.409Z",
          info: {
            id: "task-session-message:task-session:task-1:main:model-b:user-prompt",
            role: "user",
            time: {
              created: "2026-04-16T03:44:35.409Z",
              completed: "2026-04-16T03:44:35.409Z",
            },
          },
          parts: [{ type: "text", text: "pi-monorepo 项目 是什么？" }],
        },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.items.map((item) => item.key)).toEqual([
      "root-user",
      "task-session-message:task-session:task-1:main:model-a:user-prompt",
    ]);
  });

  it("adds all adopted candidate assistant replies as formal mainline items for parallel phases", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "completed",
            startedAt: "2026-04-16T03:44:35.000Z",
          } as any,
          sourceMessages: [],
        },
      ],
      parallelConversationItems: [
        {
          key: "parallel-run-1",
          role: "parallel",
          createdAt: "2026-04-16T03:44:35.200Z",
          candidates: [
            {
              key: "candidate-a-card",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [
                {
                  key: "candidate-a-first",
                  role: "assistant",
                  text: "这是第一条采纳候选回复",
                  createdAt: "2026-04-16T03:44:40.000Z",
                  toolCalls: [],
                  raw: null,
                },
                {
                  key: "candidate-a-final",
                  role: "assistant",
                  text: "这是正式采纳后的回复",
                  createdAt: "2026-04-16T03:44:49.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: false,
              isAdopted: true,
              isRecommended: false,
            },
            {
              key: "candidate-b-card",
              index: 1,
              label: "候选 B",
              status: "completed",
              loading: false,
              items: [
                {
                  key: "candidate-b-final",
                  role: "assistant",
                  text: "候选 B 回复",
                  createdAt: "2026-04-16T03:44:46.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: false,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: {
            phaseId: "phase-1",
            candidateSessions: [{ sessionId: "candidate-a" }, { sessionId: "candidate-b" }],
          },
          toolCalls: [],
        },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.items.map((item) => item.key)).toEqual([
      "parallel-run-1",
      "parallel-adopted:parallel-run-1:candidate-a-first",
      "parallel-adopted:parallel-run-1:candidate-a-final",
    ]);
    expect(blocks[0]?.items[1]).toMatchObject({
      role: "assistant",
      text: "这是第一条采纳候选回复",
    });
    expect(blocks[0]?.items[2]).toMatchObject({
      role: "assistant",
      text: "这是正式采纳后的回复",
    });
  });

  it("places the anchor user message before the adopted summary card in live parallel phases", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "completed",
            startedAt: "2026-04-16T03:44:35.000Z",
          } as any,
          sourceMessages: [],
        },
      ],
      parallelConversationItems: [
        {
          key: "parallel-run-1",
          role: "parallel",
          createdAt: "2026-04-16T03:44:35.200Z",
          candidates: [
            {
              key: "candidate-a-card",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [
                {
                  key: "candidate-a-final",
                  role: "assistant",
                  text: "这是正式采纳后的回复",
                  createdAt: "2026-04-16T03:44:49.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: false,
              isAdopted: true,
              isRecommended: false,
            },
            {
              key: "candidate-b-card",
              index: 1,
              label: "候选 B",
              status: "completed",
              loading: false,
              items: [],
              canAdopt: false,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: {
            phaseId: "phase-1",
            anchorMessageId: "user-1",
            anchorUserMessage: {
              key: "user-1",
              role: "user",
              text: "pi-monorepo 项目 是什么？",
              userInputText: "pi-monorepo 项目 是什么？",
              createdAt: "2026-04-16T03:44:35.000Z",
              toolCalls: [],
              raw: { id: "user-1" },
            },
            candidateSessions: [{ sessionId: "candidate-a" }, { sessionId: "candidate-b" }],
          },
          toolCalls: [],
        },
      ],
      baseConversationItems: [
        {
          key: "assistant-1",
          role: "assistant",
          text: "好的，为了了解这个项目，我将首先阅读 README.md 文件。",
          createdAt: "2026-04-16T03:44:35.100Z",
          toolCalls: [],
          raw: null,
        } as any,
      ],
      currentPhaseId: "phase-1",
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.items.map((item) => item.key)).toEqual([
      "user-1",
      "parallel-run-1",
      "assistant-1",
      "parallel-adopted:parallel-run-1:candidate-a-final",
    ]);
    expect(blocks[0]?.items[0]).toMatchObject({
      role: "user",
      text: "pi-monorepo 项目 是什么？",
    });
  });

  it("reuses the latest visible user prompt from the previous phase when a parallel phase has no user messages", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-0",
            phaseIndex: 21,
            phaseKind: "single",
            triggerType: "continue",
            status: "completed",
            startedAt: "2026-04-16T03:44:34.000Z",
          } as any,
          sourceMessages: [
            {
              id: "user-1",
              role: "user",
              text: "pi-monorepo 项目 是什么？",
              userInputText: "pi-monorepo 项目 是什么？",
              createdAt: "2026-04-16T03:44:35.000Z",
            },
          ],
        },
        {
          phase: {
            id: "phase-1",
            phaseIndex: 22,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "completed",
            startedAt: "2026-04-16T03:44:35.000Z",
          } as any,
          sourceMessages: [],
        },
      ],
      parallelConversationItems: [
        {
          key: "parallel-run-1",
          role: "parallel",
          createdAt: "2026-04-16T03:44:35.200Z",
          candidates: [
            {
              key: "candidate-a-card",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [
                {
                  key: "candidate-a-final",
                  role: "assistant",
                  text: "这是正式采纳后的回复",
                  createdAt: "2026-04-16T03:44:49.000Z",
                  toolCalls: [],
                  raw: null,
                },
              ],
              canAdopt: false,
              isAdopted: true,
              isRecommended: false,
            },
            {
              key: "candidate-b-card",
              index: 1,
              label: "候选 B",
              status: "completed",
              loading: false,
              items: [],
              canAdopt: false,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: {
            phaseId: "phase-1",
            candidateSessions: [{ sessionId: "candidate-a" }, { sessionId: "candidate-b" }],
          },
          toolCalls: [],
        },
      ],
      baseConversationItems: [
        {
          key: "assistant-1",
          role: "assistant",
          text: "好的，为了了解这个项目，我将首先阅读 README.md 文件。",
          createdAt: "2026-04-16T03:44:35.100Z",
          toolCalls: [],
          raw: null,
        } as any,
      ],
      currentPhaseId: "phase-1",
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.items.map((item) => item.key)).toEqual([
      "user-1",
      "parallel-run-1",
      "assistant-1",
      "parallel-adopted:parallel-run-1:candidate-a-final",
    ]);
  });
});