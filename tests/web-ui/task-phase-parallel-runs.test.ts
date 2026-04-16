import { describe, expect, it } from "vitest";
import { buildTaskDetailParallelReadModel } from "../../control-plane/web-ui/src/lib/task-detail-parallel-read-model";
import {
  buildPhaseParallelCandidateBaselines,
  buildPhaseParallelCandidateStates,
  buildPhaseParallelRuns,
} from "../../control-plane/web-ui/src/lib/task-phase-parallel-runs";

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

describe("phase parallel runs", () => {
  it("builds candidate baseline states from phase view message groups", () => {
    const baselines = buildPhaseParallelCandidateBaselines({
      phaseViews: [
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "awaiting_adoption",
          } as any,
          sessions: [
            {
              id: "candidate-1",
              runtimeSessionId: "runtime-candidate-1",
              phaseId: "phase-2",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
            },
            {
              id: "candidate-2",
              runtimeSessionId: "runtime-candidate-2",
              phaseId: "phase-2",
              phaseRole: "candidate",
              candidateIndex: 1,
            },
          ],
          messageGroups: [
            {
              taskSessionId: "candidate-1",
              runtimeSessionId: "runtime-candidate-1",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
              timelineMeta: {
                cacheState: "complete",
                complete: true,
                itemCount: 1,
              },
              messages: [
                {
                  id: "candidate-1-assistant",
                  role: "assistant",
                  text: "候选一回复",
                  createdAt: "2026-04-12T10:00:12.000Z",
                },
              ],
            },
            {
              taskSessionId: "candidate-2",
              runtimeSessionId: "runtime-candidate-2",
              phaseRole: "candidate",
              candidateIndex: 1,
              messages: [
                {
                  id: "candidate-2-user",
                  role: "user",
                  text: "只有提示词",
                  createdAt: "2026-04-12T10:00:21.000Z",
                },
              ],
            },
          ],
          meta: {},
        },
      ],
    });

    expect(baselines["candidate-1"]).toMatchObject({
      hasSettledReply: true,
      skipTraceLoad: true,
      traceState: {},
    });
    expect(baselines["candidate-1"]?.items.map((item) => item.key)).toEqual([
      "candidate-1-assistant",
    ]);
    expect(baselines["candidate-2"]).toBeUndefined();
    expect(buildPhaseParallelCandidateStates({
      phaseViews: [
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "awaiting_adoption",
          } as any,
          sessions: [
            {
              id: "candidate-1",
              runtimeSessionId: "runtime-candidate-1",
              phaseId: "phase-2",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
            },
          ],
          messageGroups: [
            {
              taskSessionId: "candidate-1",
              runtimeSessionId: "runtime-candidate-1",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
              timelineMeta: {
                cacheState: "complete",
                complete: true,
                itemCount: 1,
              },
              messages: [
                {
                  id: "candidate-1-assistant",
                  role: "assistant",
                  text: "候选一回复",
                  createdAt: "2026-04-12T10:00:12.000Z",
                },
              ],
            },
          ],
          meta: {},
        },
      ],
    })).toEqual({
      "candidate-1": baselines["candidate-1"],
    });
  });

  it("keeps trace loading enabled for running candidates even when phase view already has displayable content", () => {
    const baselines = buildPhaseParallelCandidateBaselines({
      phaseViews: [
        {
          phase: {
            id: "phase-3",
            phaseIndex: 3,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "running",
          } as any,
          sessions: [
            {
              id: "candidate-running",
              runtimeSessionId: "runtime-candidate-running",
              phaseId: "phase-3",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "running",
            },
          ],
          messageGroups: [
            {
              taskSessionId: "candidate-running",
              runtimeSessionId: "runtime-candidate-running",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "running",
              timelineMeta: {
                cacheState: "partial",
                complete: false,
                itemCount: 2,
              },
              messages: [
                {
                  id: "candidate-running-assistant",
                  role: "assistant",
                  text: "阶段视图里的进行中回复",
                  createdAt: "2026-04-12T10:10:12.000Z",
                },
              ],
            },
          ],
          meta: {},
        },
      ],
    });

    expect(baselines["candidate-running"]).toMatchObject({
      hasSettledReply: true,
      skipTraceLoad: false,
      traceState: {
        state: "incomplete",
        note: "当前候选只拿到了部分执行追踪，展示内容可能不完整。",
      },
    });
  });

  it("marks terminal candidates with no phase timeline as incomplete while still skipping compat trace loads", () => {
    const baselines = buildPhaseParallelCandidateBaselines({
      phaseViews: [
        {
          phase: {
            id: "phase-5",
            phaseIndex: 5,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "completed",
          } as any,
          sessions: [
            {
              id: "candidate-complete-no-timeline",
              runtimeSessionId: "runtime-candidate-complete-no-timeline",
              phaseId: "phase-5",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
            },
          ],
          messageGroups: [
            {
              taskSessionId: "candidate-complete-no-timeline",
              runtimeSessionId: "runtime-candidate-complete-no-timeline",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
              timelineMeta: {
                cacheState: "none",
                complete: false,
                itemCount: 0,
              },
              messages: [
                {
                  id: "candidate-complete-no-timeline-assistant",
                  role: "assistant",
                  text: "完成但没有 timeline 的回复",
                  createdAt: "2026-04-12T10:20:12.000Z",
                },
              ],
            },
          ],
          meta: {},
        },
      ],
    });

    expect(baselines["candidate-complete-no-timeline"]).toMatchObject({
      hasSettledReply: true,
      skipTraceLoad: true,
      traceState: {
        state: "incomplete",
        note: "当前候选暂时没有可用的执行追踪时间线。",
      },
    });
  });

  it("marks paused candidates as stale from phase view baseline state", () => {
    const baselines = buildPhaseParallelCandidateBaselines({
      phaseViews: [
        {
          phase: {
            id: "phase-4",
            phaseIndex: 4,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "paused",
          } as any,
          sessions: [
            {
              id: "candidate-paused",
              runtimeSessionId: "runtime-candidate-paused",
              phaseId: "phase-4",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "paused",
            },
          ],
          messageGroups: [
            {
              taskSessionId: "candidate-paused",
              runtimeSessionId: "runtime-candidate-paused",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "paused",
              messages: [
                {
                  id: "candidate-paused-assistant",
                  role: "assistant",
                  text: "暂停前的候选回复",
                  createdAt: "2026-04-12T10:15:12.000Z",
                },
              ],
            },
          ],
          meta: {},
        },
      ],
    });

    expect(baselines["candidate-paused"]).toMatchObject({
      hasSettledReply: true,
      skipTraceLoad: false,
      traceState: {
        state: "stale",
        note: "当前候选已暂停，当前展示的是最近一次阶段视图快照。",
      },
    });
  });

  it("builds phase-scoped parallel runs directly from phase DTO views", () => {
    const phase = {
      id: "phase-2",
      phaseIndex: 2,
      phaseKind: "parallel",
      triggerType: "execute",
      status: "awaiting_adoption",
      anchorSessionId: "mainline-session",
      winnerSessionId: "candidate-2",
      startedAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:06:30.000Z",
      createdAt: "2026-04-12T10:00:00.000Z",
    } as const;

    const runs = buildPhaseParallelRuns({
      phases: [phase],
      phaseViews: [
        {
          phase,
          sessions: [
            {
              id: "candidate-1",
              title: "候选 1",
              phaseId: "phase-2",
              phaseRole: "candidate",
              candidateIndex: 0,
              executionStatus: "completed",
              selectedModel: "gpt-5.4-mini",
              isActive: false,
              summary: null,
              createdAt: "2026-04-12T10:00:10.000Z",
              updatedAt: "2026-04-12T10:06:00.000Z",
            },
            {
              id: "candidate-2",
              title: "候选 2",
              phaseId: "phase-2",
              phaseRole: "candidate",
              candidateIndex: 1,
              executionStatus: "completed",
              selectedModel: "gpt-5.4",
              isActive: false,
              summary: null,
              createdAt: "2026-04-12T10:00:20.000Z",
              updatedAt: "2026-04-12T10:06:30.000Z",
            },
          ],
          messageGroups: [],
          meta: {},
        },
      ],
      agentRuns: [],
      configuredCandidates: [
        { label: "方案 A", model: "gpt-5.4-mini" },
        { label: "方案 B", model: "gpt-5.4" },
      ],
    });

    expect(runs).toMatchObject([
      {
        parallelRunId: "task-phase:phase-2",
        phaseId: "phase-2",
        parentSessionId: "mainline-session",
        executionSessionId: "mainline-session",
        winnerCandidateIndex: 1,
        candidateSessions: [
          { label: "方案 A", model: "gpt-5.4-mini", sessionId: "candidate-1" },
          { label: "方案 B", model: "gpt-5.4", sessionId: "candidate-2" },
        ],
      },
    ]);
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

  it("does not fall back to session summaries or tree inference after phase authority loads empty", () => {
    const readModel = buildTaskDetailParallelReadModel({
      agentRuns: [],
      baseConversationItems: [],
      configuredCandidates: buildConfiguredCandidates(),
      currentPhaseId: null,
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
      phaseAuthorityLoaded: true,
      phaseParallelRuns: [],
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
      taskSessionSummaries: [
        buildSummary({ id: "summary-candidate-1", phaseId: "phase-old", candidateIndex: 0 }),
        buildSummary({ id: "summary-candidate-2", phaseId: "phase-old", candidateIndex: 1 }),
      ],
    });

    expect(readModel.resolvedParallelRuns).toEqual([]);
    expect(readModel.visibleParallelRuns).toEqual([]);
    expect(readModel.visibleParallelCandidateSessionIds).toEqual([]);
    expect(readModel.sessionTreeFallbackRunSessionKey).toBe("");
  });

  it("does not backfill phase winners from session-summary fallback when phase authority succeeds", () => {
    const readModel = buildTaskDetailParallelReadModel({
      agentRuns: [],
      baseConversationItems: [],
      configuredCandidates: buildConfiguredCandidates(),
      currentPhaseId: "phase-live",
      flatNodes: [],
      phaseAuthorityLoaded: true,
      phaseParallelRuns: [
        {
          parallelRunId: "task-phase:phase-live",
          phaseId: "phase-live",
          startedAt: "2026-04-12T10:00:00.000Z",
          parentSessionId: "root-session",
          executionSessionId: "root-session",
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
        buildSummary({
          id: "phase-candidate-1",
          phaseId: "phase-live",
          candidateIndex: 0,
          winnerSessionId: "phase-candidate-2",
        }),
        buildSummary({
          id: "phase-candidate-2",
          phaseId: "phase-live",
          candidateIndex: 1,
          winnerSessionId: "phase-candidate-2",
        }),
      ],
    });

    expect(readModel.currentParallelRunRecord).toMatchObject({
      parallelRunId: "task-phase:phase-live",
    });
    expect(readModel.currentParallelRunRecord?.winnerCandidateIndex).toBeUndefined();
  });
});