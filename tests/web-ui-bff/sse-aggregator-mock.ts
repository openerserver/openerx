import { mock } from "bun:test";

type ParallelCandidateResult = { sessionId: string; result?: string };
type PaidExecutionRuntimeState = { tripped: boolean; reason?: string };

type SseAggregatorMock = {
  finalizedAgentRuns: Set<string>;
  finalizingAgentRuns: Set<string>;
  parallelTaskSessions: Map<string, Set<string>>;
  parallelCandidateResults: Map<string, Map<number, ParallelCandidateResult>>;
  sessionToCandidateMap: Map<string, { taskId: string; candidateIndex: number }>;
  sequentialChainTasks: Map<string, unknown>;
  sessionToChainStepMap: Map<string, unknown>;
  judgingTasks: Set<string>;
  paidExecutionRuntime: Map<string, PaidExecutionRuntimeState>;
  onEvent: ReturnType<typeof mock>;
  subscribeGlobal: ReturnType<typeof mock>;
  subscribeSession: ReturnType<typeof mock>;
  ingestParsedEvent: ReturnType<typeof mock>;
  registerParallelTask: ReturnType<typeof mock>;
  registerSequentialChainTask: ReturnType<typeof mock>;
};

export function createSseAggregatorMock(
  overrides: Partial<SseAggregatorMock> = {},
): SseAggregatorMock {
  return {
    finalizedAgentRuns: new Set<string>(),
    finalizingAgentRuns: new Set<string>(),
    parallelTaskSessions: new Map<string, Set<string>>(),
    parallelCandidateResults: new Map<string, Map<number, ParallelCandidateResult>>(),
    sessionToCandidateMap: new Map<string, { taskId: string; candidateIndex: number }>(),
    sequentialChainTasks: new Map<string, unknown>(),
    sessionToChainStepMap: new Map<string, unknown>(),
    judgingTasks: new Set<string>(),
    paidExecutionRuntime: new Map<string, PaidExecutionRuntimeState>(),
    onEvent: mock(() => () => undefined),
    subscribeGlobal: mock(async () => undefined),
    subscribeSession: mock(async () => undefined),
    ingestParsedEvent: mock(async () => undefined),
    registerParallelTask: mock(() => undefined),
    registerSequentialChainTask: mock(() => undefined),
    ...overrides,
  };
}

export function createSseAggregatorModuleMock(overrides: Partial<SseAggregatorMock> = {}) {
  return {
    sseAggregator: createSseAggregatorMock(overrides),
  };
}
