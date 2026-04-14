import { describe, expect, it } from "vitest";
import type { TaskExecutionTrace } from "./api";
import { buildParallelComparisonCardsForRun, resolveParallelCandidateTraceState } from "./task-detail-parallel-card-builder";

function buildTrace(
  timelineMeta?: TaskExecutionTrace["timelineMeta"],
): TaskExecutionTrace {
  return {
    taskId: "task-1",
    sessionId: "ses-candidate",
    segments: [],
    hookExecutions: [],
    followupExecutions: [],
    timelineMeta,
  };
}

describe("task-detail-parallel-card-builder", () => {
  it("marks reconcile-required candidate traces incomplete", () => {
    expect(
      resolveParallelCandidateTraceState(
        buildTrace({
          readSource: "task-session-projection",
          complete: false,
          itemCount: 3,
          reconcileRequired: true,
          snapshotVersion: 11,
        }),
      ),
    ).toMatchObject({
      state: "incomplete",
      note: "当前候选执行追踪仍在同步，展示内容可能不完整。",
    });
  });

  it("treats empty incomplete projection traces as unavailable", () => {
    expect(
      resolveParallelCandidateTraceState(
        buildTrace({
          readSource: "task-session-projection",
          complete: false,
          itemCount: 0,
          snapshotVersion: 12,
        }),
      ),
    ).toMatchObject({
      state: "incomplete",
      note: "当前候选暂时没有可用的执行追踪时间线。",
    });
  });

  it("treats non-empty incomplete projection traces as partial", () => {
    expect(
      resolveParallelCandidateTraceState(
        buildTrace({
          readSource: "task-session-projection",
          complete: false,
          itemCount: 2,
          snapshotVersion: 13,
        }),
      ),
    ).toMatchObject({
      state: "incomplete",
      note: "当前候选只拿到了部分执行追踪，展示内容可能不完整。",
    });
  });

  it("keeps complete traces clear", () => {
    expect(
      resolveParallelCandidateTraceState(
        buildTrace({
          readSource: "task-session-projection",
          complete: true,
          itemCount: 2,
          snapshotVersion: 14,
        }),
      ),
    ).toEqual({});
  });

  it("marks settled current-run cards as adoptable when no winner exists", () => {
    expect(
      buildParallelComparisonCardsForRun({
        run: {
          parallelRunId: "run-1",
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
              status: "failed",
              sessionId: "session-b",
              startedAt: "2026-04-12T10:00:02.000Z",
            },
          ],
        } as any,
        currentParallelRunId: "run-1",
        taskStatus: "completed",
        parallelCandidateItems: {},
        parallelCandidateSettledReply: {},
        parallelCandidateTraceStates: {},
      }).map((candidate) => candidate.canAdopt),
    ).toEqual([true, false]);
  });
});