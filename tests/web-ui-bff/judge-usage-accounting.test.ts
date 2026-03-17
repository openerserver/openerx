import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const runDetachedPromptMock = mock(async () => ({
  ok: true,
  text: '{"winnerIndex":1,"scores":[72,91],"reasoning":"candidate 1 wins"}',
  sessionId: "judge-ses",
  tokenUsed: 2600,
  model: { providerId: "github-copilot", modelId: "gpt-5.4" },
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  resolveModelRoute: (value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  }),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: () => ({
    ...strategyModule.DEFAULT_ORCHESTRATION_STRATEGY,
    hooks: [],
    judge: {
      enabled: true,
      agent: "judge-agent",
      model: "github-copilot:gpt-5.4",
      promptTemplate: '{"winnerIndex":1,"scores":[72,91],"reasoning":"{{candidateResults}}"}',
      timeoutMs: 1000,
      selectionStrategy: "judge-pick",
    },
  }),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  extractAssistantResultFromMessages: mock(() => ({ completed: true, failed: false, tokenUsed: 0, text: "" })),
  findAgentRunBySessionId: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  runDetachedPrompt: runDetachedPromptMock,
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/code-changes/change-collector", () => ({
  collectChangesFromSession: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({ hookExecutions: [] })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  observeGraphWorkspaceDir: mock(() => undefined),
  onGraphToolExecuted: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(async () => []),
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  runDetachedPromptMock.mockReset();

  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  runDetachedPromptMock.mockResolvedValue({
    ok: true,
    text: '{"winnerIndex":1,"scores":[72,91],"reasoning":"candidate 1 wins"}',
    sessionId: "judge-ses",
    tokenUsed: 2600,
    model: { providerId: "github-copilot", modelId: "gpt-5.4" },
  });

  cpFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown }) => {
    if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-judge") {
      return {
        ok: true,
        status: 200,
        data: {
          id: "task-judge",
          title: "Judge task",
          prompt: "Choose the better implementation",
          projectId: "proj-judge",
          sessionId: "ses-root",
          strategy: JSON.stringify({
            effectiveModel: "github-copilot:gpt-5.4",
            paidExecutionGuard: {
              enabled: true,
              providerId: "github-copilot",
              modelId: "gpt-5.4",
              modelRoute: "github-copilot:gpt-5.4",
              guardDecision: "allow",
              guardReason: "approved",
              estimatedRequestUpperBound: 3,
              estimatedTokenUpperBound: 9000,
              estimatedCostUpperBound: 4,
              actualRequests: 0,
              actualTokenUsage: 0,
              actualCost: 0,
              maxRequestsPerRun: 4,
              maxEstimatedCostUsdPerRun: 5,
              overridesApplied: [],
              postHooksDisabled: false,
            },
          }),
          selectedModel: "github-copilot:gpt-5.4",
          executionPlan: JSON.stringify({
            templateId: "parallel-template",
            mode: "parallel",
            steps: [
              { id: "exec-0", type: "execution", status: "completed" },
              { id: "judge-0", type: "judge", status: "pending", dependsOn: ["exec-0"] },
            ],
            candidates: [
              { label: "A", agent: "agent-a", status: "running" },
              { label: "B", agent: "agent-b", status: "running" },
            ],
          }),
        },
      };
    }

    return { ok: true, status: 200, data: { body: options?.body } };
  });
});

describe("judge usage accounting", () => {
  test("records cost and audit for judge execution", async () => {
    const { sseAggregator } = await import(
      "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator?judge-usage-accounting-test"
    );

    const aggregator = sseAggregator as unknown as {
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
      parallelTaskSessions: Map<string, Set<string>>;
      judgingTasks: Set<string>;
      finalizeParallelTask: (taskId: string, projectId: string, authorization: string) => Promise<void>;
    };

    aggregator.parallelCandidateResults.set(
      "task-judge",
      new Map([
        [0, { sessionId: "ses-a", result: "candidate A" }],
        [1, { sessionId: "ses-b", result: "candidate B" }],
      ]),
    );
    aggregator.parallelTaskSessions.set("task-judge", new Set(["ses-a", "ses-b"]));
    aggregator.judgingTasks.clear();

    await aggregator.finalizeParallelTask("task-judge", "proj-judge", "Bearer internal");

    const costRecordCalls = cpFetchMock.mock.calls.filter(
      (call) => call[0] === "/api/cost/records" && (call[1] as { method?: string })?.method === "POST",
    );
    const auditCalls = cpFetchMock.mock.calls.filter(
      (call) => call[0] === "/api/audit" && (call[1] as { method?: string })?.method === "POST",
    );
    const patchCalls = cpFetchMock.mock.calls.filter(
      (call) => call[0] === "/api/tasks/task-judge" && (call[1] as { method?: string })?.method === "PATCH",
    );

    expect(costRecordCalls).toHaveLength(1);
    expect(auditCalls.some((call) => (call[1] as { body?: { action?: string } }).body?.action === "judge_usage_recorded")).toBe(true);
    expect(
      patchCalls.some((call) =>
        String((call[1] as { body?: { strategy?: string } }).body?.strategy || "").includes('"tokenUsed":2600'),
      ),
    ).toBe(true);
  });
});