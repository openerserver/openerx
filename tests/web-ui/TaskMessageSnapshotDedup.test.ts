import { describe, expect, it } from "vitest";
import type { TaskRoundDto, TaskRoundMessagesDto } from "../../control-plane/web-ui/src/lib/api";
import { createTaskMessageSnapshotState } from "../../control-plane/web-ui/src/lib/task-message-snapshot";

function createRound(overrides?: Partial<TaskRoundDto>): TaskRoundDto {
  return {
    id: overrides?.id ?? "task-session:task-1:session-1",
    taskId: overrides?.taskId ?? "task-1",
    sessionId: overrides?.sessionId ?? "session-1",
    kind: overrides?.kind ?? "continue",
    source: overrides?.source ?? "continue",
    status: overrides?.status ?? "completed",
    promptText: overrides?.promptText ?? "Summarize progress",
    createdAt: overrides?.createdAt ?? "2026-04-08T03:18:17.218Z",
    updatedAt: overrides?.updatedAt ?? "2026-04-08T03:18:24.437Z",
  };
}

describe("task message snapshot dedupe", () => {
  it("suppresses a failed assistant duplicate when a later completed assistant has the same text", () => {
    const response: TaskRoundMessagesDto = {
      taskId: "task-1",
      round: createRound({ id: "round-1", sessionId: "session-2" }),
      messages: [
        {
          id: "assistant-failed",
          roundId: "round-1",
          sessionId: "session-2",
          role: "assistant",
          status: "failed",
          text: "same reply",
          errorText: "503 Service Unavailable",
          parts: [
            {
              id: "assistant-failed:synthetic-text",
              partIndex: 0,
              partType: "text",
              text: "same reply",
              finalizedAt: "2026-04-08T03:18:22.000Z",
            },
          ],
          createdAt: "2026-04-08T03:18:22.000Z",
          updatedAt: "2026-04-08T03:18:22.000Z",
          startedAt: "2026-04-08T03:18:20.000Z",
          completedAt: "2026-04-08T03:18:22.000Z",
        },
        {
          id: "assistant-completed",
          roundId: "round-1",
          sessionId: "session-2",
          role: "assistant",
          status: "completed",
          text: "same reply",
          errorText: null,
          parts: [
            {
              id: "assistant-completed:part-1",
              partIndex: 0,
              partType: "text",
              text: "same reply",
              finalizedAt: "2026-04-08T03:18:24.437Z",
            },
          ],
          createdAt: "2026-04-08T03:18:24.437Z",
          updatedAt: "2026-04-08T03:18:24.437Z",
          startedAt: "2026-04-08T03:18:23.000Z",
          completedAt: "2026-04-08T03:18:24.437Z",
        },
      ],
      reconcileRequired: false,
      snapshotVersion: 4,
      persistedThroughRevision: 5,
    };

    const state = createTaskMessageSnapshotState({
      taskId: "task-1",
      requestedSessionId: "session-2",
      response,
    });

    expect(state.sourceMessages).toHaveLength(1);
    expect(state.sourceMessages[0]).toMatchObject({
      id: "assistant-completed",
      status: "completed",
      text: "same reply",
    });
    expect(state.trace.timelineMeta).toMatchObject({ itemCount: 1 });
  });

  it("suppresses an earlier thinking-only assistant progress row once a later completed assistant lands", () => {
    const response: TaskRoundMessagesDto = {
      taskId: "task-1",
      round: createRound({ id: "round-1", sessionId: "session-2" }),
      messages: [
        {
          id: "assistant-progress",
          roundId: "round-1",
          sessionId: "session-2",
          role: "assistant",
          status: "streaming",
          text: null,
          errorText: null,
          parts: [
            {
              id: "assistant-progress:thinking-1",
              partIndex: 0,
              partType: "thinking",
              text: "先分析 bun run 和 bun test 的职责。",
              finalizedAt: null,
            },
          ],
          createdAt: "2026-04-08T03:18:20.000Z",
          updatedAt: "2026-04-08T03:18:21.000Z",
          startedAt: "2026-04-08T03:18:20.000Z",
          completedAt: null,
        },
        {
          id: "assistant-completed",
          roundId: "round-1",
          sessionId: "session-2",
          role: "assistant",
          status: "completed",
          text: "bun run 用来执行脚本，bun test 用来跑测试。",
          errorText: null,
          parts: [
            {
              id: "assistant-completed:thinking-1",
              partIndex: 0,
              partType: "thinking",
              text: "先分析 bun run 和 bun test 的职责。",
              finalizedAt: "2026-04-08T03:18:24.000Z",
            },
            {
              id: "assistant-completed:text-1",
              partIndex: 1,
              partType: "text",
              text: "bun run 用来执行脚本，bun test 用来跑测试。",
              finalizedAt: "2026-04-08T03:18:24.437Z",
            },
          ],
          createdAt: "2026-04-08T03:18:24.437Z",
          updatedAt: "2026-04-08T03:18:24.437Z",
          startedAt: "2026-04-08T03:18:23.000Z",
          completedAt: "2026-04-08T03:18:24.437Z",
        },
      ],
      reconcileRequired: false,
      snapshotVersion: 4,
      persistedThroughRevision: 5,
    };

    const state = createTaskMessageSnapshotState({
      taskId: "task-1",
      requestedSessionId: "session-2",
      response,
    });

    expect(state.sourceMessages).toHaveLength(1);
    expect(state.sourceMessages[0]).toMatchObject({
      id: "assistant-completed",
      status: "completed",
      text: "bun run 用来执行脚本，bun test 用来跑测试。",
    });
    expect(state.trace.timelineMeta).toMatchObject({ itemCount: 1 });
  });
});
