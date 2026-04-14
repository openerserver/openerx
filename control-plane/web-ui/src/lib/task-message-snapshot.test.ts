import { describe, expect, it } from "vitest";
import type { TaskExecutionTrace, TaskRoundDto, TaskRoundMessagesDto } from "./api";
import {
  createEmptyTaskMessageSnapshotState,
  createTaskMessageSnapshotState,
  getTaskMessageSnapshotRevision,
  resolveTaskSnapshotRound,
} from "./task-message-snapshot";

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

describe("task-message-snapshot", () => {
  it("resolves a round by session id or round id", () => {
    const rounds = [
      createRound({ id: "round-1", sessionId: "session-1" }),
      createRound({ id: "round-2", sessionId: "session-2" }),
    ];

    expect(resolveTaskSnapshotRound(rounds, "session-2")?.id).toBe("round-2");
    expect(resolveTaskSnapshotRound(rounds, "round-1")?.sessionId).toBe("session-1");
    expect(resolveTaskSnapshotRound(rounds, "missing")).toBeNull();
  });

  it("builds an empty snapshot state", () => {
    const state = createEmptyTaskMessageSnapshotState({
      taskId: "task-1",
      sessionId: "session-1",
      includeLineage: true,
    });

    expect(state.sourceMessages).toEqual([]);
    expect(state.resolvedSessionId).toBe("session-1");
    expect(state.trace.timelineMeta).toMatchObject({
      readSource: "task-domain-projection",
      includeLineage: true,
      itemCount: 0,
      snapshotVersion: 0,
      persistedThroughRevision: 0,
    });
  });

  it("builds a populated snapshot state from round response", () => {
    const response: TaskRoundMessagesDto = {
      taskId: "task-1",
      round: createRound({ id: "round-1", sessionId: "session-2" }),
      messages: [
        {
          id: "assistant-1",
          roundId: "round-1",
          sessionId: "session-2",
          role: "assistant",
          status: "completed",
          text: "reply",
          errorText: null,
          parts: [
            {
              id: "part-1",
              partIndex: 0,
              partType: "text",
              text: "reply",
              finalizedAt: "2026-04-08T03:18:24.437Z",
            },
          ],
          createdAt: "2026-04-08T03:18:19.218Z",
          updatedAt: "2026-04-08T03:18:24.437Z",
          startedAt: "2026-04-08T03:18:19.218Z",
          completedAt: "2026-04-08T03:18:24.437Z",
        },
      ],
      reconcileRequired: false,
      snapshotVersion: 4,
      persistedThroughRevision: 5,
    };

    const state = createTaskMessageSnapshotState({
      taskId: "task-1",
      requestedSessionId: "session-1",
      response,
      includeLineage: true,
    });

    expect(state.resolvedSessionId).toBe("session-1");
    expect(state.sourceMessages).toHaveLength(1);
    expect(state.trace.sessionId).toBe("session-1");
    expect(state.trace.timelineMeta).toMatchObject({
      roundId: "round-1",
      snapshotVersion: 4,
      persistedThroughRevision: 5,
      includeLineage: true,
      itemCount: 1,
      complete: true,
    });
  });

  it("prefers persistedThroughRevision when resolving snapshot revision", () => {
    const trace: TaskExecutionTrace = {
      taskId: "task-1",
      sessionId: "session-1",
      segments: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        snapshotVersion: 4,
        persistedThroughRevision: 9,
      },
      hookExecutions: [],
      followupExecutions: [],
    };

    expect(getTaskMessageSnapshotRevision(trace)).toBe(9);
    expect(getTaskMessageSnapshotRevision({ ...trace, timelineMeta: { snapshotVersion: 4 } })).toBe(4);
    expect(getTaskMessageSnapshotRevision(null)).toBe(0);
  });
});