import { describe, expect, it } from "vitest";

import {
  buildVisibleParallelRunSet,
  resolveNextSelectedSessionId,
} from "../../control-plane/web-ui/src/lib/task-detail-parallel-runtime";

describe("task detail parallel runtime visibility", () => {
  it("keeps historical unadopted runs that stay on the selected session lineage", () => {
    const oldRun = {
      parallelRunId: "run-old",
      startedAt: "2026-04-09T09:51:28.649Z",
      parentSessionId: "root-session",
      candidateSessions: [
        {
          label: "候选 A",
          status: "completed",
          sessionId: "old-a",
          startedAt: "2026-04-09T09:51:28.649Z",
          finishedAt: "2026-04-09T09:52:23.019Z",
        },
        {
          label: "候选 B",
          status: "completed",
          sessionId: "old-b",
          startedAt: "2026-04-09T09:51:28.675Z",
          finishedAt: "2026-04-09T09:52:06.366Z",
        },
      ],
    };

    const currentRun = {
      parallelRunId: "run-current",
      startedAt: "2026-04-09T09:55:11.837Z",
      parentSessionId: "old-a",
      candidateSessions: [
        {
          label: "候选 A",
          status: "completed",
          sessionId: "current-a",
          startedAt: "2026-04-09T09:55:11.837Z",
          finishedAt: "2026-04-09T10:45:07.672Z",
        },
        {
          label: "候选 B",
          status: "completed",
          sessionId: "current-b",
          startedAt: "2026-04-09T09:55:11.852Z",
          finishedAt: "2026-04-09T10:45:07.662Z",
        },
      ],
    };

    const visibleRuns = buildVisibleParallelRunSet({
      resolvedParallelRuns: [oldRun, currentRun],
      sessionScopedParallelRuns: [currentRun],
      selectedSessionId: "current-a-child",
      selectedSessionNode: {
        id: "node-current-a-child",
        parentId: "node-old-a",
        runtimeSessionId: "current-a-child",
        createdAt: "2026-04-09T10:45:07.700Z",
      },
      flatNodes: [
        {
          id: "node-root",
          runtimeSessionId: "root-session",
          createdAt: "2026-04-09T05:59:42.669Z",
        },
        {
          id: "node-old-a",
          parentId: "node-root",
          runtimeSessionId: "old-a",
          createdAt: "2026-04-09T09:51:28.649Z",
        },
        {
          id: "node-current-a-child",
          parentId: "node-old-a",
          runtimeSessionId: "current-a-child",
          createdAt: "2026-04-09T10:45:07.700Z",
        },
      ],
      task: {
        id: "task-1",
        sessionId: "task-main-session",
      },
    });

    expect(visibleRuns.map((run) => run.parallelRunId)).toEqual(["run-old", "run-current"]);
  });

  it("keeps unrelated historical unadopted runs hidden when they are off the selected lineage", () => {
    const oldRun = {
      parallelRunId: "run-old",
      startedAt: "2026-04-09T09:51:28.649Z",
      parentSessionId: "root-session",
      candidateSessions: [
        {
          label: "候选 A",
          status: "completed",
          sessionId: "old-a",
          startedAt: "2026-04-09T09:51:28.649Z",
          finishedAt: "2026-04-09T09:52:23.019Z",
        },
        {
          label: "候选 B",
          status: "completed",
          sessionId: "old-b",
          startedAt: "2026-04-09T09:51:28.675Z",
          finishedAt: "2026-04-09T09:52:06.366Z",
        },
      ],
    };

    const currentRun = {
      parallelRunId: "run-current",
      startedAt: "2026-04-09T09:55:11.837Z",
      parentSessionId: "another-root",
      candidateSessions: [
        {
          label: "候选 A",
          status: "completed",
          sessionId: "current-a",
          startedAt: "2026-04-09T09:55:11.837Z",
          finishedAt: "2026-04-09T10:45:07.672Z",
        },
        {
          label: "候选 B",
          status: "completed",
          sessionId: "current-b",
          startedAt: "2026-04-09T09:55:11.852Z",
          finishedAt: "2026-04-09T10:45:07.662Z",
        },
      ],
    };

    const visibleRuns = buildVisibleParallelRunSet({
      resolvedParallelRuns: [oldRun, currentRun],
      sessionScopedParallelRuns: [currentRun],
      selectedSessionId: "current-a-child",
      selectedSessionNode: {
        id: "node-current-a-child",
        parentId: "node-another-root",
        runtimeSessionId: "current-a-child",
        createdAt: "2026-04-09T10:45:07.700Z",
      },
      flatNodes: [
        {
          id: "node-root",
          runtimeSessionId: "root-session",
          createdAt: "2026-04-09T05:59:42.669Z",
        },
        {
          id: "node-old-a",
          parentId: "node-root",
          runtimeSessionId: "old-a",
          createdAt: "2026-04-09T09:51:28.649Z",
        },
        {
          id: "node-another-root",
          runtimeSessionId: "another-root",
          createdAt: "2026-04-09T09:55:11.700Z",
        },
        {
          id: "node-current-a-child",
          parentId: "node-another-root",
          runtimeSessionId: "current-a-child",
          createdAt: "2026-04-09T10:45:07.700Z",
        },
      ],
      task: {
        id: "task-1",
        sessionId: "task-main-session",
      },
    });

    expect(visibleRuns.map((run) => run.parallelRunId)).toEqual(["run-current"]);
  });

  it("keeps an explicitly focused child session while a running task tree catches up", () => {
    const nextSessionId = resolveNextSelectedSessionId({
      selectedSessionId: "child-1",
      selectedSessionNode: null,
      flatNodes: [
        {
          id: "node-parent",
          runtimeSessionId: "parent-1",
          isActive: true,
        },
      ],
      task: {
        id: "task-1",
        sessionId: "parent-1",
        status: "running",
      },
      currentParallelRun: null,
      adoptedCandidateSessionId: undefined,
      isCurrentParallelRunPendingAdoption: false,
    });

    expect(nextSessionId).toBe("child-1");
  });

  it("falls back to the active task session once the task is no longer running", () => {
    const nextSessionId = resolveNextSelectedSessionId({
      selectedSessionId: "child-1",
      selectedSessionNode: null,
      flatNodes: [
        {
          id: "node-parent",
          runtimeSessionId: "parent-1",
          isActive: true,
        },
      ],
      task: {
        id: "task-1",
        sessionId: "parent-1",
        status: "completed",
      },
      currentParallelRun: null,
      adoptedCandidateSessionId: undefined,
      isCurrentParallelRunPendingAdoption: false,
    });

    expect(nextSessionId).toBe("parent-1");
  });

  it("keeps task-wide history unscoped by default outside parallel runs", () => {
    const nextSessionId = resolveNextSelectedSessionId({
      selectedSessionId: undefined,
      selectedSessionNode: null,
      flatNodes: [
        {
          id: "node-parent",
          runtimeSessionId: "parent-1",
          isActive: true,
        },
      ],
      task: {
        id: "task-1",
        sessionId: "parent-1",
        status: "completed",
      },
      currentParallelRun: null,
      adoptedCandidateSessionId: undefined,
      isCurrentParallelRunPendingAdoption: false,
    });

    expect(nextSessionId).toBeUndefined();
  });

  it("prefers the mainline root session when task.sessionId already points at a pending candidate", () => {
    const nextSessionId = resolveNextSelectedSessionId({
      selectedSessionId: undefined,
      selectedSessionNode: null,
      flatNodes: [
        {
          id: "node-root",
          runtimeSessionId: "root-session",
          isActive: false,
        },
        {
          id: "node-candidate-a",
          parentId: "node-root",
          runtimeSessionId: "candidate-a",
          isActive: true,
        },
        {
          id: "node-candidate-b",
          parentId: "node-root",
          runtimeSessionId: "candidate-b",
          isActive: false,
        },
      ],
      task: {
        id: "task-1",
        sessionId: "candidate-a",
        status: "completed",
      },
      currentParallelRun: {
        parallelRunId: "run-pending-adopt",
        executionSessionId: "root-session",
        parentSessionId: "root-session",
        candidateSessions: [
          {
            label: "候选 A",
            status: "completed",
            sessionId: "candidate-a",
          },
          {
            label: "候选 B",
            status: "completed",
            sessionId: "candidate-b",
          },
        ],
      },
      adoptedCandidateSessionId: undefined,
      isCurrentParallelRunPendingAdoption: true,
    });

    expect(nextSessionId).toBe("root-session");
  });
});