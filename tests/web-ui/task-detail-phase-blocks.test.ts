import { describe, expect, it } from "vitest";
import { buildTaskDetailPhaseBlocks } from "../../control-plane/web-ui/src/lib/task-detail-phase-blocks";

describe("task detail phase blocks", () => {
  it("groups loaded slices into ordered phase blocks and attaches parallel cards to the matching phase", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "awaiting_adoption",
            startedAt: "2026-04-14T10:00:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-2-user",
              role: "user",
              text: "并行问题",
              createdAt: "2026-04-14T10:00:01.000Z",
            },
          ],
        },
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "single",
            triggerType: "continue",
            status: "completed",
            startedAt: "2026-04-14T09:59:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "第一阶段问题",
              createdAt: "2026-04-14T09:59:01.000Z",
            },
            {
              id: "phase-1-assistant",
              role: "assistant",
              text: "第一阶段回复",
              createdAt: "2026-04-14T09:59:02.000Z",
            },
          ],
        },
      ],
      parallelConversationItems: [
        {
          key: "parallel-phase-2",
          role: "parallel",
          candidates: [
            {
              key: "candidate-a",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [],
              canAdopt: false,
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
              canAdopt: false,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: { phaseId: "phase-2" },
          toolCalls: [],
        } as any,
      ],
    });

    expect(blocks.map((block) => block.phaseId)).toEqual(["phase-1", "phase-2"]);
    expect(blocks[0]?.items.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(blocks[1]?.items.map((item) => item.role)).toEqual(["user", "parallel"]);
  });

  it("orders message items and parallel cards by createdAt within the same phase block", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "completed",
            startedAt: "2026-04-14T09:59:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "先提出问题",
              createdAt: "2026-04-14T09:59:01.000Z",
            },
            {
              id: "phase-1-assistant",
              role: "assistant",
              text: "阶段总结",
              createdAt: "2026-04-14T09:59:03.000Z",
            },
          ],
        },
      ],
      parallelConversationItems: [
        {
          key: "parallel-phase-1",
          role: "parallel",
          createdAt: "2026-04-14T09:59:02.000Z",
          candidates: [
            {
              key: "candidate-a",
              index: 0,
              label: "候选 A",
              status: "completed",
              loading: false,
              items: [],
              canAdopt: false,
              isAdopted: false,
              isRecommended: false,
            },
          ],
          raw: { phaseId: "phase-1" },
          toolCalls: [],
        } as any,
      ],
    });

    expect(blocks[0]?.items.map((item) => item.role)).toEqual(["user", "parallel", "assistant"]);
  });

  it("overlays current phase with live conversation items that are newer than the persisted slice", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      currentPhaseId: "phase-2",
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "single",
            triggerType: "execute",
            status: "completed",
            startedAt: "2026-04-14T09:59:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "第一阶段问题",
              createdAt: "2026-04-14T09:59:01.000Z",
            },
          ],
        },
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "single",
            triggerType: "continue",
            status: "running",
            startedAt: "2026-04-14T10:00:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-2-user",
              role: "user",
              text: "第二阶段问题",
              createdAt: "2026-04-14T10:00:01.000Z",
            },
          ],
        },
      ],
      baseConversationItems: [
        {
          key: "phase-1-user",
          role: "user",
          text: "第一阶段问题",
          toolCalls: [],
          createdAt: "2026-04-14T09:59:01.000Z",
          raw: null,
        },
        {
          key: "phase-2-user",
          role: "user",
          text: "第二阶段问题",
          toolCalls: [],
          createdAt: "2026-04-14T10:00:01.000Z",
          raw: null,
        },
        {
          key: "pending-assistant:ses-phase-2:2026-04-14T10:00:02.000Z",
          role: "assistant",
          text: "正在生成...",
          toolCalls: [],
          createdAt: "2026-04-14T10:00:02.000Z",
          raw: null,
          isStreaming: true,
        },
      ] as any,
      parallelConversationItems: [],
    });

    expect(blocks[0]?.items.map((item) => item.key)).toEqual(["phase-1-user"]);
    expect(blocks[1]?.items.map((item) => item.key)).toEqual([
      "phase-2-user",
      "pending-assistant:ses-phase-2:2026-04-14T10:00:02.000Z",
    ]);
  });

  it("adds current phase realtime user and tool messages", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      currentPhaseId: "phase-2",
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "single",
            triggerType: "execute",
            status: "completed",
            startedAt: "2026-04-14T09:59:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "第一阶段问题",
              createdAt: "2026-04-14T09:59:01.000Z",
            },
          ],
        },
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "single",
            triggerType: "continue",
            status: "running",
            startedAt: "2026-04-14T10:00:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-2-user",
              role: "user",
              text: "第二阶段问题",
              createdAt: "2026-04-14T10:00:01.000Z",
            },
          ],
        },
      ],
      currentPhaseRealtimeSourceMessages: [
        {
          id: "phase-2-tool",
          role: "tool",
          parts: [
            {
              type: "tool",
              toolName: "read_file",
              state: "completed",
              input: {
                filePath: "docs/phase-2.md",
              },
            },
          ],
          createdAt: "2026-04-14T10:00:03.000Z",
        },
        {
          id: "phase-2-user-followup",
          role: "user",
          text: "继续排查 phase-2",
          createdAt: "2026-04-14T10:00:02.000Z",
        },
      ],
      parallelConversationItems: [],
    });

    expect(blocks[0]?.items.map((item) => item.key)).toEqual(["phase-1-user"]);
    expect(blocks[1]?.items.map((item) => item.key)).toEqual([
      "phase-2-user",
      "phase-2-user-followup",
      "phase-2-tool",
    ]);
  });

  it("adds non-current phase live assistant overlays from phase-scoped conversation items", () => {
    const blocks = buildTaskDetailPhaseBlocks({
      currentPhaseId: "phase-2",
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "single",
            triggerType: "execute",
            status: "running",
            startedAt: "2026-04-14T09:59:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "第一阶段问题",
              createdAt: "2026-04-14T09:59:01.000Z",
            },
            {
              id: "phase-1-assistant",
              role: "assistant",
              text: "第一阶段旧回复",
              createdAt: "2026-04-14T09:59:02.000Z",
            },
          ],
        },
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "single",
            triggerType: "continue",
            status: "running",
            startedAt: "2026-04-14T10:00:00.000Z",
          } as any,
          sourceMessages: [
            {
              id: "phase-2-user",
              role: "user",
              text: "第二阶段问题",
              createdAt: "2026-04-14T10:00:01.000Z",
            },
          ],
        },
      ],
      phaseConversationItemsByPhaseId: {
        "phase-1": [
          {
            key: "phase-1-user",
            role: "user",
            text: "第一阶段问题",
            toolCalls: [],
            createdAt: "2026-04-14T09:59:01.000Z",
            raw: null,
          },
          {
            key: "phase-1-assistant",
            role: "assistant",
            text: "第一阶段流式更新后的回复",
            toolCalls: [],
            createdAt: "2026-04-14T09:59:02.000Z",
            raw: null,
            isStreaming: true,
          },
        ],
      } as any,
      parallelConversationItems: [],
    });

    expect(blocks[0]?.items.map((item) => item.key)).toEqual([
      "phase-1-user",
      "phase-1-assistant",
    ]);
    expect(blocks[0]?.items[1]).toMatchObject({
      key: "phase-1-assistant",
      text: "第一阶段流式更新后的回复",
      isStreaming: true,
    });
    expect(blocks[1]?.items.map((item) => item.key)).toEqual(["phase-2-user"]);
  });
});