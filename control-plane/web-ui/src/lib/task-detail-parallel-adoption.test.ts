import { describe, expect, it } from "vitest";
import { createEmptyLiveAssistantState } from "./message-normalize";
import { buildTaskDetailParallelAdoptionState } from "./task-detail-parallel-adoption";

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    parallelRunId: "run-current",
    startedAt: "2026-04-12T10:00:00.000Z",
    candidateSessions: [
      {
        label: "候选 1",
        status: "completed",
        sessionId: "session-a",
        startedAt: "2026-04-12T10:00:01.000Z",
      },
      {
        label: "候选 2",
        status: "completed",
        sessionId: "session-b",
        startedAt: "2026-04-12T10:00:02.000Z",
      },
    ],
    ...overrides,
  } as any;
}

describe("buildTaskDetailParallelAdoptionState", () => {
  it("marks the current compare run as pending adoption once all candidates settle", () => {
    expect(
      buildTaskDetailParallelAdoptionState({
        currentParallelRunId: "run-current",
        currentParallelRunRecord: buildRun(),
        parallelCandidateItems: {},
        parallelCandidateLiveStates: {},
        parallelCandidateSettledReply: {},
        parallelCandidateTraceStates: {},
        taskStatus: "completed",
      }),
    ).toEqual({
      adoptedCandidateSessionId: undefined,
      isCurrentParallelRunPendingAdoption: true,
    });
  });

  it("returns the adopted candidate session when the current run already has a winner", () => {
    expect(
      buildTaskDetailParallelAdoptionState({
        currentParallelRunId: "run-current",
        currentParallelRunRecord: buildRun({ winnerCandidateIndex: 1 }),
        parallelCandidateItems: {},
        parallelCandidateLiveStates: {},
        parallelCandidateSettledReply: {},
        parallelCandidateTraceStates: {},
        taskStatus: "completed",
      }),
    ).toEqual({
      adoptedCandidateSessionId: "session-b",
      isCurrentParallelRunPendingAdoption: false,
    });
  });

  it("keeps pending adoption false while a current candidate is still actively running", () => {
    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds.push("assistant-running");
    liveState.incompleteIds.add("assistant-running");
    liveState.textById.set("assistant-running", "正在输出");

    expect(
      buildTaskDetailParallelAdoptionState({
        currentParallelRunId: "run-current",
        currentParallelRunRecord: buildRun({
          candidateSessions: [
            {
              label: "候选 1",
              status: "running",
              sessionId: "session-a",
              startedAt: "2026-04-12T10:00:01.000Z",
            },
            {
              label: "候选 2",
              status: "completed",
              sessionId: "session-b",
              startedAt: "2026-04-12T10:00:02.000Z",
            },
          ],
        }),
        parallelCandidateItems: {},
        parallelCandidateLiveStates: {
          "session-a": liveState,
        },
        parallelCandidateSettledReply: {},
        parallelCandidateTraceStates: {},
        taskStatus: "running",
      }),
    ).toEqual({
      adoptedCandidateSessionId: undefined,
      isCurrentParallelRunPendingAdoption: false,
    });
  });
});