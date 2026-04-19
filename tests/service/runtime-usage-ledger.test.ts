import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildDeleteByIdsStatements,
  buildTaskNodeDefensiveCleanupStatements,
  buildTaskProjectionCleanupStatements,
  runPostgresCleanupStatements,
} from "./service-teardown-helpers";

const CP_URL = process.env.TEST_CP_URL || "http://127.0.0.1:4097";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";

const createdTaskIds: string[] = [];
const createdLedgerIds: string[] = [];
const createdStepIds: string[] = [];
let token = "";

interface RuntimeUsageLedgerRecord {
  id: string;
  projectId: string;
  taskId?: string | null;
  runtimeSessionId: string;
  requestCount: number;
  stepCount: number;
  totalTokens: number;
  costUsd: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  status: string;
  finishedAt?: string | null;
}

interface RuntimeUsageLedgerStepRecord {
  id: string;
  ledgerId: string;
  stepType: string;
  requestIndex: number;
  totalTokens: number;
  status: string;
  finishedAt?: string | null;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const response = await fetch(`${CP_URL}${path}`, opts);
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, status: response.status };
}

async function authedRequest<T>(path: string, opts: RequestInit = {}) {
  return request<T>(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function login() {
  const { data, status } = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (status !== 200) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function createTask(title: string) {
  const { data, status } = await authedRequest<{ id: string }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      prompt: `${title} 的执行说明`,
      projectId: PROJECT_ID,
    }),
  });
  expect(status).toBe(201);
  createdTaskIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  token = await login();
});

afterAll(async () => {
  const taskCleanupStatements = [
    ...buildTaskProjectionCleanupStatements(createdTaskIds),
    ...buildDeleteByIdsStatements("tasks", createdTaskIds),
    ...buildTaskNodeDefensiveCleanupStatements(createdTaskIds),
  ];
  const statements = [
    ...buildDeleteByIdsStatements("runtime_usage_ledger_steps", createdStepIds),
    ...buildDeleteByIdsStatements("runtime_usage_ledgers", createdLedgerIds),
    ...taskCleanupStatements,
  ];

  if (statements.length === 0) {
    return;
  }

  runPostgresCleanupStatements(statements, "runtime-usage-ledger.test.ts");
});

describe("runtime usage ledger routes", () => {
  test("dedupes repeated step sync and keeps header totals stable", async () => {
    const taskId = await createTask(`账本去重-${Date.now()}`);
    const syncBody = {
      taskId,
      runtimeSessionId: `session-dedupe-${Date.now()}`,
      executionSource: "task-execute",
      entrypointType: "single-task",
      defaultProviderId: "github-copilot",
      defaultModelId: "gpt-5-mini",
      requestCountDelta: 1,
      stepCountDelta: 1,
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
      costUsd: 0.12,
      candidateCount: 1,
      judgeRequestCountDelta: 0,
      hookRequestCountDelta: 0,
      status: "completed",
      startedAt: "2026-03-17T10:00:00.000Z",
      finishedAt: "2026-03-17T10:01:00.000Z",
      step: {
        id: `step-dedupe-${Date.now()}`,
        stepType: "execution",
        requestIndex: 0,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 80,
        outputTokens: 40,
        totalTokens: 120,
        costUsd: 0.12,
        status: "completed",
        startedAt: "2026-03-17T10:00:00.000Z",
        finishedAt: "2026-03-17T10:01:00.000Z",
      },
    };

    createdStepIds.push(syncBody.step.id);

    const firstSync = await authedRequest<{
      ledger: RuntimeUsageLedgerRecord;
      stepInserted: boolean;
      deltaApplied: boolean;
    }>(`/api/projects/${PROJECT_ID}/runtime-usage-ledgers/sync`, {
      method: "POST",
      body: JSON.stringify(syncBody),
    });

    expect(firstSync.status).toBe(200);
    expect(firstSync.data.stepInserted).toBe(true);
    expect(firstSync.data.deltaApplied).toBe(true);
    expect(firstSync.data.ledger.totalTokens).toBe(120);
    createdLedgerIds.push(firstSync.data.ledger.id);

    const secondSync = await authedRequest<{
      ledger: RuntimeUsageLedgerRecord;
      stepInserted: boolean;
      deltaApplied: boolean;
    }>(`/api/projects/${PROJECT_ID}/runtime-usage-ledgers/sync`, {
      method: "POST",
      body: JSON.stringify({
        ...syncBody,
        finishedAt: "2026-03-17T10:02:00.000Z",
      }),
    });

    expect(secondSync.status).toBe(200);
    expect(secondSync.data.stepInserted).toBe(false);
    expect(secondSync.data.deltaApplied).toBe(false);
    expect(secondSync.data.ledger.requestCount).toBe(1);
    expect(secondSync.data.ledger.stepCount).toBe(1);
    expect(secondSync.data.ledger.totalTokens).toBe(120);
    expect(secondSync.data.ledger.costUsd).toBe(0.12);
    expect(secondSync.data.ledger.finishedAt).toBe("2026-03-17T10:02:00.000Z");

    const listResult = await authedRequest<{
      projectId: string;
      totals: {
        ledgerCount: number;
        requestCount: number;
        stepCount: number;
        totalTokens: number;
        costUsd: number;
      };
      items: RuntimeUsageLedgerRecord[];
    }>(`/api/projects/${PROJECT_ID}/runtime-usage-ledgers?taskId=${encodeURIComponent(taskId)}`);

    expect(listResult.status).toBe(200);
    expect(listResult.data.totals).toMatchObject({
      ledgerCount: 1,
      requestCount: 1,
      stepCount: 1,
      totalTokens: 120,
      costUsd: 0.12,
    });
    expect(listResult.data.items).toHaveLength(1);
  });

  test("aggregates totals across ledgers and exposes step breakdown in detail", async () => {
    const taskA = await createTask(`账本聚合-A-${Date.now()}`);
    const taskB = await createTask(`账本聚合-B-${Date.now()}`);
    const stamp = Date.now();

    const syncPayloads = [
      {
        taskId: taskA,
        runtimeSessionId: `session-agg-a-${stamp}`,
        executionSource: "task-execute",
        entrypointType: "single-task",
        defaultProviderId: "github-copilot",
        defaultModelId: "gpt-5-mini",
        requestCountDelta: 1,
        stepCountDelta: 1,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0.15,
        candidateCount: 1,
        judgeRequestCountDelta: 0,
        hookRequestCountDelta: 1,
        status: "completed",
        step: {
          id: `step-agg-a-${stamp}`,
          stepType: "hook",
          requestIndex: 0,
          providerId: "github-copilot",
          modelId: "gpt-5-mini",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.15,
          status: "completed",
        },
      },
      {
        taskId: taskB,
        runtimeSessionId: `session-agg-b-${stamp}`,
        executionSource: "parallel-judge",
        entrypointType: "judge-only",
        defaultProviderId: "github-copilot",
        defaultModelId: "gpt-4o",
        requestCountDelta: 1,
        stepCountDelta: 1,
        inputTokens: 120,
        outputTokens: 60,
        totalTokens: 180,
        costUsd: 0.18,
        candidateCount: 2,
        judgeRequestCountDelta: 1,
        hookRequestCountDelta: 0,
        status: "completed",
        step: {
          id: `step-agg-b-${stamp}`,
          stepType: "judge",
          requestIndex: 0,
          providerId: "github-copilot",
          modelId: "gpt-4o",
          inputTokens: 120,
          outputTokens: 60,
          totalTokens: 180,
          costUsd: 0.18,
          status: "completed",
          startedAt: "2026-03-17T11:00:00.000Z",
          finishedAt: "2026-03-17T11:01:00.000Z",
        },
      },
    ];

    createdStepIds.push(syncPayloads[0].step.id, syncPayloads[1].step.id);

    for (const payload of syncPayloads) {
      const response = await authedRequest<{ ledger: RuntimeUsageLedgerRecord }>(
        `/api/projects/${PROJECT_ID}/runtime-usage-ledgers/sync`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      expect(response.status).toBe(200);
      createdLedgerIds.push(response.data.ledger.id);
    }

    const listResult = await authedRequest<{
      totals: {
        ledgerCount: number;
        requestCount: number;
        stepCount: number;
        totalTokens: number;
        costUsd: number;
      };
      items: RuntimeUsageLedgerRecord[];
    }>(`/api/projects/${PROJECT_ID}/runtime-usage-ledgers?limit=10&status=completed`);

    expect(listResult.status).toBe(200);
    expect(listResult.data.totals.ledgerCount).toBeGreaterThanOrEqual(2);
    expect(listResult.data.totals.requestCount).toBeGreaterThanOrEqual(2);
    expect(listResult.data.totals.stepCount).toBeGreaterThanOrEqual(2);

    const itemA = listResult.data.items.find(
      (item) => item.runtimeSessionId === syncPayloads[0].runtimeSessionId,
    );
    const itemB = listResult.data.items.find(
      (item) => item.runtimeSessionId === syncPayloads[1].runtimeSessionId,
    );

    expect(itemA?.totalTokens).toBe(150);
    expect(itemA?.hookRequestCount).toBe(1);
    expect(itemB?.totalTokens).toBe(180);
    expect(itemB?.judgeRequestCount).toBe(1);

    const detailResult = await authedRequest<{
      ledger: RuntimeUsageLedgerRecord;
      steps: RuntimeUsageLedgerStepRecord[];
      breakdown: { byStepType: Record<string, number> };
    }>(
      `/api/projects/${PROJECT_ID}/runtime-usage-ledgers/${encodeURIComponent(String(itemB?.id))}`,
    );

    expect(detailResult.status).toBe(200);
    expect(detailResult.data.ledger.runtimeSessionId).toBe(syncPayloads[1].runtimeSessionId);
    expect(detailResult.data.steps).toHaveLength(1);
    expect(detailResult.data.steps[0]).toMatchObject({
      id: syncPayloads[1].step.id,
      stepType: "judge",
      totalTokens: 180,
      status: "completed",
      finishedAt: "2026-03-17T11:01:00.000Z",
    });
    expect(detailResult.data.breakdown.byStepType).toEqual({ judge: 1 });
  });
});
