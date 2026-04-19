import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../../control-plane/web-ui/src/stores/realtime";
import {
  createEmptyLiveAssistantState,
  normalizeSessionConversationItems,
} from "../../control-plane/web-ui/src/lib/message-normalize";
import { toTaskMessagePatchEvent } from "../../control-plane/web-ui/src/lib/task-message-patch-event";
import { applyRealtimeEventToLiveAssistantState } from "../../control-plane/web-ui/src/lib/task-live-message-state";

function createEvent(overrides: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    id: overrides.id ?? "event-1",
    type: overrides.type ?? "task.message.updated",
    ts: overrides.ts ?? "2026-04-08T03:18:17.218Z",
    projectId: overrides.projectId,
    taskId: overrides.taskId ?? "task-1",
    phaseId: overrides.phaseId,
    sessionId: overrides.sessionId ?? "session-1",
    agentRunId: overrides.agentRunId,
    data: overrides.data ?? {},
  };
}

describe("task message first text", () => {
  it("extracts inline assistant text from task.message.updated snapshots", () => {
    const patchEvent = toTaskMessagePatchEvent(
      createEvent({
        data: {
          message: {
            info: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.218Z",
              },
            },
            parts: [
              {
                type: "text",
                text: "首段正文",
              },
            ],
          },
        },
      }),
    );

    expect(patchEvent).toMatchObject({
      kind: "assistant-progress",
      messageId: "assistant-1",
      initialText: "首段正文",
    });
  });

  it("ignores execution-context and tool content when extracting first assistant text", () => {
    const patchEvent = toTaskMessagePatchEvent(
      createEvent({
        data: {
          message: {
            info: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.218Z",
              },
            },
            parts: [
              {
                type: "text",
                text: "Execution context:\n当前阶段：实现",
              },
              {
                type: "tool",
                text: "工具输出",
              },
              {
                type: "text",
                text: "真正的首段正文",
              },
            ],
          },
        },
      }),
    );

    expect(patchEvent).toMatchObject({
      kind: "assistant-progress",
      messageId: "assistant-1",
      initialText: "真正的首段正文",
    });
  });

  it("hydrates live assistant state from snapshot text before delta arrives", () => {
    const state = applyRealtimeEventToLiveAssistantState(
      createEmptyLiveAssistantState(),
      createEvent({
        data: {
          message: {
            info: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.218Z",
              },
            },
            parts: [
              {
                type: "text",
                text: "首段正文",
              },
            ],
          },
        },
      }),
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(state.textById.get("assistant-1")).toBe("首段正文");
    expect(state.incompleteIds.has("assistant-1")).toBe(true);
  });

  it("hydrates live assistant state with visible text only", () => {
    const state = applyRealtimeEventToLiveAssistantState(
      createEmptyLiveAssistantState(),
      createEvent({
        data: {
          message: {
            info: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.218Z",
              },
            },
            parts: [
              {
                type: "text",
                text: "Execution context:\n当前阶段：实现",
              },
              {
                type: "tool",
                text: "工具输出",
              },
              {
                type: "text",
                text: "真正的首段正文",
              },
            ],
          },
        },
      }),
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(state.textById.get("assistant-1")).toBe("真正的首段正文");
    expect(state.incompleteIds.has("assistant-1")).toBe(true);
  });

  it("normalizes pre-execution review wrapped user prompts back to the original task", () => {
    const fullPrompt = [
      "Execution context:",
      "- task: task-1",
      "",
      "请只完成当前阶段的目标。",
      "",
      "Pre-execution assessment from the configured review agent:",
      "",
      "先梳理需求，再决定是否进入编码。",
      "",
      "Original task:",
      "",
      "/start-work 请先梳理需求和边界条件，再实现功能代码。",
    ].join("\n");
    const processedUserInput = [
      "Pre-execution assessment from the configured review agent:",
      "",
      "先梳理需求，再决定是否进入编码。",
      "",
      "Original task:",
      "",
      "/start-work 请先梳理需求和边界条件，再实现功能代码。",
    ].join("\n");

    const [item] = normalizeSessionConversationItems([
      {
        id: "user-review-wrapped-1",
        role: "user",
        text: fullPrompt,
        textContent: fullPrompt,
        summaryText: fullPrompt,
        userInputText: processedUserInput,
        finalSentText: processedUserInput,
        createdAt: "2026-04-19T09:18:16.353Z",
        info: {
          id: "user-review-wrapped-1",
          role: "user",
          time: {
            created: "2026-04-19T09:18:16.353Z",
            completed: "2026-04-19T09:18:16.353Z",
          },
        },
        parts: [{ type: "text", text: fullPrompt }],
      },
    ]);

    expect(item).toBeTruthy();
    expect(item?.userInputText).toBe("/start-work 请先梳理需求和边界条件，再实现功能代码。");
    expect(item?.text).toContain("Pre-execution assessment from the configured review agent:");
    expect(item?.finalSentText).toContain("Original task:");
  });

  it.each([
    ["task.phase.created", "phase-created", "running"],
    ["task.phase.paused", "phase-paused", "paused"],
    ["task.phase.resumed", "phase-resumed", "running"],
    ["task.phase.completed", "phase-completed", "completed"],
    ["task.phase.failed", "phase-failed", "failed"],
  ] as const)("maps %s phase lifecycle events into %s patch kinds", (type, kind, status) => {
    const patchEvent = toTaskMessagePatchEvent(
      createEvent({
        type,
        phaseId: "phase-2",
        data: {
          status,
        },
      }),
    );

    expect(patchEvent).toMatchObject({
      kind,
      phaseId: "phase-2",
    });
  });
});