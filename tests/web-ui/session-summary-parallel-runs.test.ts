import { describe, expect, it } from "vitest";

import type { TaskSessionRecord } from "../../control-plane/web-ui/src/lib/api";
import {
  buildSessionSummaryParallelRuns,
  hasSessionSummaryParallelGroups,
} from "../../control-plane/web-ui/src/lib/session-summary-parallel-runs";
import {
  buildExplicitParallelTaskSessionGroups,
  isExplicitParallelCandidateSession,
} from "../../control-plane/web-ui/src/lib/task-session-parallel-groups";
import { resolveSessionSummaryWinnerCandidateIndex } from "../../control-plane/web-ui/src/lib/task-detail-parallel-runtime";

function buildSessionRecord(overrides: Partial<TaskSessionRecord>): TaskSessionRecord {
  return {
    id: "session-default",
    taskSessionId: "task-session:task-1:session-default",
    phaseId: null,
    parentRuntimeSessionId: null,
    title: "session-default",
    isActive: false,
    summary: null,
    createdAt: "2026-04-08T14:00:00.000Z",
    updatedAt: "2026-04-08T14:00:10.000Z",
    coordinationKey: null,
    winnerSessionId: null,
    executionStatus: "completed",
    sessionKind: "primary",
    candidateIndex: null,
    stepIndex: null,
    selectedModel: null,
    executionModeSnapshot: null,
    ...overrides,
  };
}

describe("task session parallel groups", () => {
  it("treats only candidate+parallel sessions as explicit parallel candidates", () => {
    const candidate = buildSessionRecord({
      id: "ses-a",
      taskSessionId: "task-session:task-1:ses-a",
      parentRuntimeSessionId: "ses-root",
      phaseId: "phase-root",
      sessionKind: "candidate",
      executionModeSnapshot: "parallel",
      candidateIndex: 0,
    });
    const manualBranch = buildSessionRecord({
      id: "ses-branch",
      taskSessionId: "task-session:task-1:ses-branch",
      parentRuntimeSessionId: "ses-root",
      coordinationKey: "ses-root",
      sessionKind: "manual_branch",
      executionModeSnapshot: "single",
    });

    expect(isExplicitParallelCandidateSession(candidate)).toBe(true);
    expect(isExplicitParallelCandidateSession(manualBranch)).toBe(false);
  });

  it("builds historical parallel runs from explicit candidate metadata instead of generic fork topology", () => {
    const sessionSummaries = [
      buildSessionRecord({
        id: "ses-root",
        taskSessionId: "task-session:task-1:ses-root",
        title: "主分支",
        sessionKind: "primary",
      }),
      buildSessionRecord({
        id: "ses-branch",
        taskSessionId: "task-session:task-1:ses-branch",
        parentRuntimeSessionId: "ses-root",
        title: "手动 fork",
        coordinationKey: "ses-root",
        sessionKind: "manual_branch",
        executionModeSnapshot: "single",
      }),
      buildSessionRecord({
        id: "ses-a",
        taskSessionId: "task-session:task-1:ses-a",
        phaseId: "phase-root",
        parentRuntimeSessionId: "ses-root",
        title: "候选 A",
        coordinationKey: null,
        winnerSessionId: "ses-a",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 0,
        selectedModel: "github-copilot:gpt-5-mini",
        createdAt: "2026-04-08T14:00:01.000Z",
        updatedAt: "2026-04-08T14:00:11.000Z",
      }),
      buildSessionRecord({
        id: "ses-b",
        taskSessionId: "task-session:task-1:ses-b",
        phaseId: "phase-root",
        parentRuntimeSessionId: "ses-root",
        title: "候选 B",
        coordinationKey: null,
        winnerSessionId: "ses-a",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 1,
        selectedModel: "github-copilot:gpt-4o",
        createdAt: "2026-04-08T14:00:02.000Z",
        updatedAt: "2026-04-08T14:00:12.000Z",
      }),
    ];

    const explicitGroups = buildExplicitParallelTaskSessionGroups(sessionSummaries);
    expect(hasSessionSummaryParallelGroups(sessionSummaries)).toBe(true);
    expect(explicitGroups).toHaveLength(1);
    expect(explicitGroups[0]?.phaseId).toBe("phase-root");
    expect(explicitGroups[0]?.candidateSessions.map((session) => session.id)).toEqual([
      "ses-a",
      "ses-b",
    ]);

    const parallelRuns = buildSessionSummaryParallelRuns({
      task: {
        sessionId: "ses-root",
        status: "completed",
        createdAt: "2026-04-08T14:00:00.000Z",
      },
      sessionSummaries,
      sessionNodes: [],
      agentRuns: [],
      configuredCandidates: [
        { label: "候选 A", model: "github-copilot:gpt-5-mini" },
        { label: "候选 B", model: "github-copilot:gpt-4o" },
      ],
    });

    expect(parallelRuns).toEqual([
      expect.objectContaining({
        parallelRunId: "task-session:phase-root",
        parentSessionId: "ses-root",
        executionSessionId: "ses-root",
        winnerCandidateIndex: 0,
        candidateSessions: [
          expect.objectContaining({ sessionId: "ses-a", label: "候选 A" }),
          expect.objectContaining({ sessionId: "ses-b", label: "候选 B" }),
        ],
      }),
    ]);
  });

  it("ignores explicit parallel candidates without a canonical phaseId", () => {
    const sessionSummaries = [
      buildSessionRecord({
        id: "ses-a",
        taskSessionId: "task-session:task-1:ses-a",
        parentRuntimeSessionId: "ses-root",
        coordinationKey: "legacy-group-1",
        winnerSessionId: "ses-b",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 0,
      }),
      buildSessionRecord({
        id: "ses-b",
        taskSessionId: "task-session:task-1:ses-b",
        parentRuntimeSessionId: "ses-root",
        coordinationKey: "legacy-group-1",
        winnerSessionId: "ses-b",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 1,
      }),
    ];

    const explicitGroups = buildExplicitParallelTaskSessionGroups(sessionSummaries);

    expect(explicitGroups).toHaveLength(0);
  });

  it("resolves winner candidate index from phaseId-only candidate summaries", () => {
    const sessionSummaries = [
      buildSessionRecord({
        id: "ses-a",
        taskSessionId: "task-session:task-1:ses-a",
        phaseId: "phase-root",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 0,
        winnerSessionId: "ses-b",
      }),
      buildSessionRecord({
        id: "ses-b",
        taskSessionId: "task-session:task-1:ses-b",
        phaseId: "phase-root",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 1,
        winnerSessionId: "ses-b",
      }),
    ];

    const winnerCandidateIndex = resolveSessionSummaryWinnerCandidateIndex(
      {
        parallelRunId: "task-session:phase-root",
        startedAt: "2026-04-08T14:00:00.000Z",
        candidateSessions: [{ sessionId: "ses-a" }, { sessionId: "ses-b" }],
      } as never,
      sessionSummaries,
    );

    expect(winnerCandidateIndex).toBe(1);
  });
});