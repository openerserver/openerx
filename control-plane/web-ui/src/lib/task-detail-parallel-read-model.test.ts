import { describe, expect, it } from "vitest";
import { buildTaskDetailParallelReadModel } from "./task-detail-parallel-read-model";

function buildConfiguredCandidates() {
  return [
    { label: "候选 1", model: "gpt-5.4-mini" },
    { label: "候选 2", model: "gpt-5.4" },
  ];
}

function buildNode(overrides: Record<string, unknown>) {
  return {
    id: "node-default",
    runtimeSessionId: "session-default",
    parentId: null,
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  } as any;
}

function buildSummary(overrides: Record<string, unknown>) {
  return {
    id: "candidate-default",
    title: "候选",
    isActive: false,
    summary: null,
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:05:00.000Z",
    phaseId: "phase-default",
    parentRuntimeSessionId: "mainline-session",
    sessionKind: "candidate",
    candidateIndex: 0,
    executionStatus: "completed",
    executionModeSnapshot: "parallel",
    selectedModel: "gpt-5.4-mini",
    ...overrides,
  } as any;
}

describe("buildTaskDetailParallelReadModel", () => {
  it("projects a session-tree fallback run into the compare read-model", () => {
    const readModel = buildTaskDetailParallelReadModel({
      agentRuns: [],
      baseConversationItems: [],
      configuredCandidates: buildConfiguredCandidates(),
      flatNodes: [
        buildNode({ id: "root-node", runtimeSessionId: "root-session" }),
        buildNode({
          id: "candidate-node-1",
          parentId: "root-node",
          runtimeSessionId: "candidate-session-1",
          createdAt: "2026-04-12T10:01:00.000Z",
          updatedAt: "2026-04-12T10:03:00.000Z",
        }),
        buildNode({
          id: "candidate-node-2",
          parentId: "root-node",
          runtimeSessionId: "candidate-session-2",
          createdAt: "2026-04-12T10:01:30.000Z",
          updatedAt: "2026-04-12T10:03:30.000Z",
        }),
      ],
      selectedSessionId: undefined,
      selectedSessionNode: null,
      task: {
        id: "task-1",
        sessionId: "root-session",
        status: "running",
        executionMode: "parallel",
        orchestrationKind: "parallel",
      } as any,
      taskNodeId: "task-root-node",
      taskSessionSummaries: [],
    });

    expect(readModel.isParallelComparisonMode).toBe(true);
    expect(readModel.currentParallelRunRecord?.parallelRunId).toBe("tree-fallback:root-session");
    expect(readModel.visibleParallelRuns.map((run) => run.parallelRunId)).toEqual([
      "tree-fallback:root-session",
    ]);
    expect(readModel.visibleParallelCandidateSessionIds).toEqual([
      "candidate-session-1",
      "candidate-session-2",
    ]);
    expect(readModel.sessionTreeFallbackRunSessionKey).toBe(
      "tree-fallback:root-session:candidate-session-1,candidate-session-2",
    );
  });

  it("hides session-tree fallback runs from the visible compare set after later single-turn input", () => {
    const readModel = buildTaskDetailParallelReadModel({
      agentRuns: [],
      baseConversationItems: [
        {
          key: "user-later",
          role: "user",
          createdAt: "2026-04-12T10:06:00.000Z",
          raw: null,
          toolCalls: [],
        } as any,
      ],
      configuredCandidates: buildConfiguredCandidates(),
      flatNodes: [
        buildNode({ id: "root-node", runtimeSessionId: "root-session" }),
        buildNode({
          id: "candidate-node-1",
          parentId: "root-node",
          runtimeSessionId: "candidate-session-1",
          createdAt: "2026-04-12T10:01:00.000Z",
          updatedAt: "2026-04-12T10:03:00.000Z",
        }),
        buildNode({
          id: "candidate-node-2",
          parentId: "root-node",
          runtimeSessionId: "candidate-session-2",
          createdAt: "2026-04-12T10:01:30.000Z",
          updatedAt: "2026-04-12T10:03:30.000Z",
        }),
      ],
      selectedSessionId: undefined,
      selectedSessionNode: null,
      task: {
        id: "task-1",
        sessionId: "root-session",
        status: "running",
        executionMode: "single",
      } as any,
      taskNodeId: "task-root-node",
      taskSessionSummaries: [],
    });

    expect(readModel.resolvedParallelRuns.map((run) => run.parallelRunId)).toEqual([
      "tree-fallback:root-session",
    ]);
    expect(readModel.visibleParallelRuns).toEqual([]);
    expect(readModel.visibleParallelCandidateSessionIds).toEqual([]);
  });

  it("keeps explicit session-summary runs in the read-model and selects the latest comparable run", () => {
    const readModel = buildTaskDetailParallelReadModel({
      agentRuns: [],
      baseConversationItems: [],
      configuredCandidates: buildConfiguredCandidates(),
      flatNodes: [],
      selectedSessionId: undefined,
      selectedSessionNode: null,
      task: {
        id: "task-1",
        sessionId: "mainline-session",
        status: "completed",
        executionMode: "parallel",
      } as any,
      taskNodeId: "task-root-node",
      taskSessionSummaries: [
        buildSummary({
          id: "candidate-old-1",
          title: "旧候选 1",
          phaseId: "phase-old",
          candidateIndex: 0,
          winnerSessionId: "candidate-old-2",
          createdAt: "2026-04-12T09:00:00.000Z",
          updatedAt: "2026-04-12T09:05:00.000Z",
        }),
        buildSummary({
          id: "candidate-old-2",
          title: "旧候选 2",
          phaseId: "phase-old",
          candidateIndex: 1,
          winnerSessionId: "candidate-old-2",
          createdAt: "2026-04-12T09:00:30.000Z",
          updatedAt: "2026-04-12T09:05:30.000Z",
          selectedModel: "gpt-5.4",
        }),
        buildSummary({
          id: "candidate-new-1",
          title: "新候选 1",
          phaseId: "phase-new",
          candidateIndex: 0,
          winnerSessionId: "candidate-new-2",
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:06:00.000Z",
        }),
        buildSummary({
          id: "candidate-new-2",
          title: "新候选 2",
          phaseId: "phase-new",
          candidateIndex: 1,
          winnerSessionId: "candidate-new-2",
          createdAt: "2026-04-12T10:00:30.000Z",
          updatedAt: "2026-04-12T10:06:30.000Z",
          selectedModel: "gpt-5.4",
        }),
      ],
    });

    expect(readModel.visibleParallelRuns.map((run) => run.parallelRunId)).toEqual([
      "task-session:phase-old",
      "task-session:phase-new",
    ]);
    expect(readModel.currentParallelRunId).toBe("task-session:phase-new");
    expect(readModel.currentParallelRunRecord).toMatchObject({
      parallelRunId: "task-session:phase-new",
      winnerCandidateIndex: 1,
    });
    expect(readModel.visibleParallelCandidateSessionIds).toEqual([
      "candidate-old-1",
      "candidate-old-2",
      "candidate-new-1",
      "candidate-new-2",
    ]);
    expect(readModel.sessionTreeFallbackRunSessionKey).toBe("");
  });

  it("prefers phase-scoped runs over session-summary and tree fallback inference", () => {
    const readModel = buildTaskDetailParallelReadModel({
      agentRuns: [],
      baseConversationItems: [],
      configuredCandidates: buildConfiguredCandidates(),
      currentPhaseId: "phase-live",
      flatNodes: [
        buildNode({ id: "root-node", runtimeSessionId: "root-session" }),
        buildNode({
          id: "candidate-node-1",
          parentId: "root-node",
          runtimeSessionId: "tree-candidate-1",
        }),
        buildNode({
          id: "candidate-node-2",
          parentId: "root-node",
          runtimeSessionId: "tree-candidate-2",
        }),
      ],
      phaseParallelRuns: [
        {
          parallelRunId: "task-phase:phase-live",
          phaseId: "phase-live",
          startedAt: "2026-04-12T10:00:00.000Z",
          parentSessionId: "root-session",
          executionSessionId: "root-session",
          winnerCandidateIndex: 1,
          candidateSessions: [
            {
              label: "方案 A",
              model: "gpt-5.4-mini",
              status: "completed",
              sessionId: "phase-candidate-1",
            },
            {
              label: "方案 B",
              model: "gpt-5.4",
              status: "completed",
              sessionId: "phase-candidate-2",
            },
          ],
        },
      ],
      selectedSessionId: undefined,
      selectedSessionNode: null,
      task: {
        id: "task-1",
        sessionId: "root-session",
        currentPhaseId: "phase-live",
        status: "running",
        executionMode: "parallel",
        orchestrationKind: "parallel",
      } as any,
      taskNodeId: "task-root-node",
      taskSessionSummaries: [
        buildSummary({ id: "summary-candidate-1", phaseId: "phase-old", candidateIndex: 0 }),
        buildSummary({ id: "summary-candidate-2", phaseId: "phase-old", candidateIndex: 1 }),
      ],
    });

    expect(readModel.resolvedParallelRuns.map((run) => run.parallelRunId)).toEqual([
      "task-phase:phase-live",
    ]);
    expect(readModel.currentParallelRunId).toBe("task-phase:phase-live");
    expect(readModel.currentParallelRunRecord).toMatchObject({
      parallelRunId: "task-phase:phase-live",
      winnerCandidateIndex: 1,
    });
    expect(readModel.visibleParallelCandidateSessionIds).toEqual([
      "phase-candidate-1",
      "phase-candidate-2",
    ]);
    expect(readModel.sessionTreeFallbackRunSessionKey).toBe("");
  });
});