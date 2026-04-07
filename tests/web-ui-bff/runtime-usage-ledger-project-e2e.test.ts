import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import * as paidExecutionGuardModule from "../../control-plane/web-ui-bff/src/lib/paid-execution-guard";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";

type LedgerRecord = {
  id: string;
  projectId: string;
  taskId?: string;
  agentRunId?: string;
  runtimeSessionId: string;
  executionSource: string;
  entrypointType: string;
  orchestrationFingerprint?: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  requestCount: number;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  candidateCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type StepRecord = {
  id: string;
  ledgerId: string;
  projectId: string;
  taskId?: string;
  agentRunId?: string;
  runtimeSessionId?: string;
  stepType: string;
  triggerType?: string;
  hookId?: string;
  candidateIndex?: number;
  requestIndex: number;
  providerId?: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  amplificationSource?: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer inbound-test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-test-token");
const evaluatePaidExecutionPreflightMock = mock(async () => ({
  allowed: true,
  requirements: {
    allowPaidExecution: false,
    leaseRequired: false,
    hasAllowPaidExecution: true,
    hasLease: false,
  },
  estimate: {
    guardDecision: "allow",
    guardReason: "ok",
  },
  activeLease: null,
}));
const fetchProjectPaidExecutionLeaseStateMock = mock(async () => ({
  projectId: "proj-default",
  activeLease: null,
  now: "2026-03-17T10:00:00.000Z",
}));
const readDefaultExecutionModelMock = mock(() => "github-copilot:gpt-5-mini");
const resolveModelRouteMock = mock((value: string) => ({
  providerId: value.split(":")[0] || "github-copilot",
  modelId: value.split(":").slice(1).join(":") || value,
}));
const readOrchestrationStrategyMock = mock(() => ({
  hooks: [],
  templates: [],
  judge: { enabled: false },
}));

const ledgers = new Map<string, LedgerRecord>();
const stepsByLedger = new Map<string, StepRecord[]>();

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    authHeader: authHeaderMock,
    cpFetch: cpFetchMock,
    createInternalAuthorization: createInternalAuthorizationMock,
  }),
);

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  ...paidExecutionGuardModule,
  evaluatePaidExecutionPreflight: evaluatePaidExecutionPreflightMock,
  fetchProjectPaidExecutionLeaseState: fetchProjectPaidExecutionLeaseStateMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  diagnoseModelReadiness: mock(async () => undefined),
  formatModelRoute: (resolved: { providerId: string; modelId: string }) =>
    `${resolved.providerId}:${resolved.modelId}`,
  readDefaultExecutionModel: readDefaultExecutionModelMock,
  resolveModelRoute: resolveModelRouteMock,
  validateModelProvider: mock(() => ({ valid: true })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: readOrchestrationStrategyMock,
}));

function computeTotals(items: LedgerRecord[]) {
  return items.reduce(
    (acc, ledger) => {
      acc.ledgerCount += 1;
      acc.requestCount += ledger.requestCount;
      acc.stepCount += ledger.stepCount;
      acc.inputTokens += ledger.inputTokens;
      acc.outputTokens += ledger.outputTokens;
      acc.totalTokens += ledger.totalTokens;
      acc.costUsd = Number((acc.costUsd + ledger.costUsd).toFixed(4));
      return acc;
    },
    {
      ledgerCount: 0,
      requestCount: 0,
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  );
}

function buildBaseLedger(
  body: Record<string, unknown>,
  existing: LedgerRecord | undefined,
  now: string,
) {
  return (
    existing || {
      id: existing?.id || `ledger-${ledgers.size + 1}`,
      projectId: "proj-default",
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
      agentRunId: typeof body.agentRunId === "string" ? body.agentRunId : undefined,
      runtimeSessionId: String(body.runtimeSessionId || ""),
      executionSource: String(body.executionSource || ""),
      entrypointType: String(body.entrypointType || ""),
      orchestrationFingerprint:
        typeof body.orchestrationFingerprint === "string"
          ? body.orchestrationFingerprint
          : undefined,
      defaultProviderId:
        typeof body.defaultProviderId === "string" ? body.defaultProviderId : undefined,
      defaultModelId: typeof body.defaultModelId === "string" ? body.defaultModelId : undefined,
      requestCount: 0,
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      candidateCount: Number(body.candidateCount || 1),
      judgeRequestCount: 0,
      hookRequestCount: 0,
      status: String(body.status || "completed"),
      startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
      finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : undefined,
      syncedAt: typeof body.syncedAt === "string" ? body.syncedAt : now,
      createdAt: now,
      updatedAt: now,
    }
  );
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? String(record[key]) : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "number" ? Number(record[key]) : undefined;
}

function buildStepRecord(
  ledgerId: string,
  body: Record<string, unknown>,
  step: Record<string, unknown>,
  now: string,
): StepRecord {
  return {
    id: String(step.id),
    ledgerId,
    projectId: "proj-default",
    taskId: readOptionalString(body, "taskId"),
    agentRunId: readOptionalString(body, "agentRunId"),
    runtimeSessionId: String(body.runtimeSessionId || ""),
    stepType: String(step.stepType || "other"),
    triggerType: readOptionalString(step, "triggerType"),
    hookId: readOptionalString(step, "hookId"),
    candidateIndex: readOptionalNumber(step, "candidateIndex"),
    requestIndex: Number(step.requestIndex || 0),
    providerId: readOptionalString(step, "providerId"),
    modelId: readOptionalString(step, "modelId"),
    inputTokens: Number(step.inputTokens || 0),
    outputTokens: Number(step.outputTokens || 0),
    totalTokens: Number(step.totalTokens || 0),
    costUsd: Number(step.costUsd || 0),
    amplificationSource: readOptionalString(step, "amplificationSource"),
    status: String(step.status || "completed"),
    startedAt: readOptionalString(step, "startedAt"),
    finishedAt: readOptionalString(step, "finishedAt"),
    createdAt: now,
    updatedAt: now,
  };
}

function appendLedgerStep(
  ledgerId: string,
  body: Record<string, unknown>,
  step: Record<string, unknown>,
  now: string,
) {
  const stepId = typeof step.id === "string" ? step.id : undefined;
  const ledgerSteps = stepsByLedger.get(ledgerId) || [];
  const existingStep = stepId ? ledgerSteps.find((item) => item.id === stepId) : undefined;

  if (stepId && !existingStep) {
    ledgerSteps.push(buildStepRecord(ledgerId, body, step, now));
    stepsByLedger.set(ledgerId, ledgerSteps);
  }

  return { stepId, existingStep };
}

function buildLedgerStatusPatch(base: LedgerRecord, body: Record<string, unknown>, now: string) {
  return {
    status: String(body.status || base.status),
    finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : base.finishedAt,
    syncedAt: typeof body.syncedAt === "string" ? body.syncedAt : now,
    updatedAt: now,
  } satisfies Partial<LedgerRecord>;
}

function buildLedgerDeltaPatch(base: LedgerRecord, body: Record<string, unknown>) {
  return {
    requestCount: base.requestCount + Number(body.requestCountDelta || 1),
    stepCount: base.stepCount + Number(body.stepCountDelta || 1),
    inputTokens: base.inputTokens + Number(body.inputTokens || 0),
    outputTokens: base.outputTokens + Number(body.outputTokens || 0),
    totalTokens: base.totalTokens + Number(body.totalTokens || 0),
    costUsd: Number((base.costUsd + Number(body.costUsd || 0)).toFixed(4)),
    candidateCount: Math.max(base.candidateCount, Number(body.candidateCount || 1)),
    judgeRequestCount: base.judgeRequestCount + Number(body.judgeRequestCountDelta || 0),
    hookRequestCount: base.hookRequestCount + Number(body.hookRequestCountDelta || 0),
  } satisfies Partial<LedgerRecord>;
}

function applyLedgerUpdate(
  base: LedgerRecord,
  body: Record<string, unknown>,
  applyDelta: boolean,
  now: string,
) {
  return {
    ...base,
    ...(applyDelta ? buildLedgerDeltaPatch(base, body) : {}),
    ...buildLedgerStatusPatch(base, body, now),
  } satisfies LedgerRecord;
}

function handleLedgerSync(options?: { body?: Record<string, unknown> }) {
  const body = options?.body as Record<string, unknown>;
  const runtimeSessionId = String(body.runtimeSessionId || "");
  const existing = [...ledgers.values()].find((item) => item.runtimeSessionId === runtimeSessionId);
  const now = "2026-03-17T10:00:00.000Z";
  const ledgerId = existing?.id || `ledger-${ledgers.size + 1}`;
  const step = body.step as Record<string, unknown> | undefined;
  const { existingStep } = step
    ? appendLedgerStep(ledgerId, body, step, now)
    : { existingStep: undefined };
  const applyDelta = !step || !existingStep;
  const base = buildBaseLedger(body, existing, now);
  const updated = applyLedgerUpdate(base, body, applyDelta, now);

  ledgers.set(ledgerId, updated);

  return {
    ok: true,
    status: 200,
    data: {
      projectId: "proj-default",
      ledger: updated,
      stepInserted: Boolean(step && !existingStep),
      deltaApplied: applyDelta,
    },
  };
}

function handleLedgerList(path: string) {
  const url = new URL(`http://localhost${path}`);
  const limit = Number(url.searchParams.get("limit") || 20);
  const taskId = url.searchParams.get("taskId");
  const status = url.searchParams.get("status");
  const items = [...ledgers.values()]
    .filter((item) => (taskId ? item.taskId === taskId : true))
    .filter((item) => (status ? item.status === status : true))
    .slice(0, limit);

  return {
    ok: true,
    status: 200,
    data: {
      projectId: "proj-default",
      totals: computeTotals(items),
      items,
    },
  };
}

function handleLedgerDetail(path: string) {
  const ledgerId = path.split("/").pop() || "";
  const ledger = ledgers.get(ledgerId);
  if (!ledger) {
    return {
      ok: false,
      status: 404,
      data: { error: "Runtime usage ledger not found" },
    };
  }

  const steps = stepsByLedger.get(ledgerId) || [];
  const byStepType = steps.reduce(
    (acc, step) => {
      acc[step.stepType] = (acc[step.stepType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    ok: true,
    status: 200,
    data: {
      projectId: "proj-default",
      ledger,
      steps,
      breakdown: {
        byStepType,
      },
    },
  };
}

function getRuntimeUsageLedgerResponse(
  path: string,
  options?: { method?: string; body?: Record<string, unknown> },
) {
  const method = options?.method || "GET";

  if (method === "POST" && path === "/api/projects/proj-default/runtime-usage-ledgers/sync") {
    return handleLedgerSync(options);
  }

  if (method === "GET" && path.startsWith("/api/projects/proj-default/runtime-usage-ledgers?")) {
    return handleLedgerList(path);
  }

  if (method === "GET" && path.startsWith("/api/projects/proj-default/runtime-usage-ledgers/")) {
    return handleLedgerDetail(path);
  }

  return {
    ok: false,
    status: 404,
    data: {
      error: `Unhandled path: ${path}`,
    },
  };
}

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  evaluatePaidExecutionPreflightMock.mockReset();
  fetchProjectPaidExecutionLeaseStateMock.mockReset();
  readDefaultExecutionModelMock.mockReset();
  resolveModelRouteMock.mockReset();
  readOrchestrationStrategyMock.mockReset();
  ledgers.clear();
  stepsByLedger.clear();

  authHeaderMock.mockReturnValue("Bearer inbound-test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-test-token");
  evaluatePaidExecutionPreflightMock.mockResolvedValue({
    allowed: true,
    requirements: {
      allowPaidExecution: false,
      leaseRequired: false,
      hasAllowPaidExecution: true,
      hasLease: false,
    },
    estimate: {
      guardDecision: "allow",
      guardReason: "ok",
    },
    activeLease: null,
  });
  fetchProjectPaidExecutionLeaseStateMock.mockResolvedValue({
    projectId: "proj-default",
    activeLease: null,
    now: "2026-03-17T10:00:00.000Z",
  });
  readDefaultExecutionModelMock.mockReturnValue("github-copilot:gpt-5-mini");
  resolveModelRouteMock.mockImplementation((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  }));
  readOrchestrationStrategyMock.mockReturnValue({
    hooks: [],
    templates: [],
    judge: { enabled: false },
  });

  cpFetchMock.mockImplementation(
    async (path: string, options?: { method?: string; body?: Record<string, unknown> }) =>
      getRuntimeUsageLedgerResponse(path, options),
  );
});

describe("runtime usage ledger project read path", () => {
  test("keeps project list and detail responses consistent with sync writes", async () => {
    const { syncRuntimeUsageLedger } = await import(
      "../../control-plane/web-ui-bff/src/lib/runtime-usage-ledger?runtime-usage-ledger-project-e2e-sync"
    );
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?runtime-usage-ledger-project-e2e-routes"
    );

    const executionSync = await syncRuntimeUsageLedger({
      projectId: "proj-default",
      taskId: "task-1",
      agentRunId: "run-1",
      runtimeSessionId: "session-1",
      executionSource: "task-execute",
      entrypointType: "single-task",
      defaultProviderId: "github-copilot",
      defaultModelId: "gpt-5-mini",
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
      costUsd: 0.12,
      status: "completed",
      step: {
        stepType: "execution",
        requestIndex: 0,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 80,
        outputTokens: 40,
        totalTokens: 120,
        costUsd: 0.12,
        amplificationSource: "execution",
        status: "completed",
      },
    });

    const hookSync = await syncRuntimeUsageLedger({
      projectId: "proj-default",
      taskId: "task-1",
      agentRunId: "run-1",
      runtimeSessionId: "session-1",
      executionSource: "task-post-execution-hook",
      entrypointType: "hook-only",
      defaultProviderId: "github-copilot",
      defaultModelId: "gpt-5-mini",
      inputTokens: 60,
      outputTokens: 20,
      totalTokens: 80,
      costUsd: 0.08,
      hookRequestCountDelta: 1,
      status: "completed",
      step: {
        stepType: "hook",
        triggerType: "post-execution",
        hookId: "hook-1",
        requestIndex: 1,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 60,
        outputTokens: 20,
        totalTokens: 80,
        costUsd: 0.08,
        amplificationSource: "hook",
        status: "completed",
      },
    });

    expect(executionSync.ok).toBe(true);
    expect(hookSync.ok).toBe(true);

    const listResponse = await projectRoutes.request(
      "http://localhost/proj-default/runtime-usage-ledgers?limit=8",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.totals).toMatchObject({
      ledgerCount: 1,
      requestCount: 2,
      stepCount: 2,
      totalTokens: 200,
      costUsd: 0.2,
    });
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({
      runtimeSessionId: "session-1",
      hookRequestCount: 1,
      totalTokens: 200,
    });

    const detailResponse = await projectRoutes.request(
      `http://localhost/proj-default/runtime-usage-ledgers/${encodeURIComponent(String(listBody.items[0].id))}`,
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.ledger).toMatchObject({
      id: listBody.items[0].id,
      runtimeSessionId: listBody.items[0].runtimeSessionId,
      totalTokens: listBody.items[0].totalTokens,
      costUsd: listBody.items[0].costUsd,
      hookRequestCount: listBody.items[0].hookRequestCount,
    });
    expect(detailBody.steps).toHaveLength(2);
    expect(detailBody.breakdown.byStepType).toEqual({
      execution: 1,
      hook: 1,
    });
    expect(detailBody.steps.map((item: { stepType: string }) => item.stepType)).toEqual([
      "execution",
      "hook",
    ]);
  });
});
