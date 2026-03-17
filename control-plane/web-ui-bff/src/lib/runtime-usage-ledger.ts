import {
  type UpstreamResponse,
  cpFetch,
  createInternalAuthorization,
} from "./control-plane-client";

export type RuntimeUsageLedgerStatus = "running" | "completed" | "failed" | "cancelled";
export type RuntimeUsageLedgerStepType = "execution" | "judge" | "hook" | "resume" | "other";
export type RuntimeUsageLedgerStepStatus = "pending" | "completed" | "failed" | "skipped";

export interface RuntimeUsageLedgerRecord {
  id: string;
  projectId: string;
  taskId?: string | null;
  agentRunId?: string | null;
  runtimeSessionId: string;
  executionSource: string;
  entrypointType: string;
  orchestrationFingerprint?: string | null;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  requestCount: number;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  candidateCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  status: RuntimeUsageLedgerStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  syncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeUsageLedgerStepRecord {
  id: string;
  ledgerId: string;
  projectId: string;
  taskId?: string | null;
  agentRunId?: string | null;
  runtimeSessionId?: string | null;
  stepType: RuntimeUsageLedgerStepType;
  triggerType?: string | null;
  hookId?: string | null;
  candidateIndex?: number | null;
  requestIndex: number;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  amplificationSource?: string | null;
  status: RuntimeUsageLedgerStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeUsageBaselineMatchScope =
  | "project+provider+model+entrypoint+fingerprint"
  | "project+provider+model+entrypoint"
  | "project+provider+model"
  | "project+entrypoint"
  | "project";

export interface RuntimeUsageBaselineRecord {
  id: string;
  projectId: string;
  providerId?: string | null;
  modelId?: string | null;
  entrypointType?: string | null;
  orchestrationFingerprint?: string | null;
  matchScope: RuntimeUsageBaselineMatchScope;
  sampleSize: number;
  requestCount: { p50: number | null; p90: number | null };
  inputTokens: { p50: number | null; p90: number | null };
  outputTokens: { p50: number | null; p90: number | null };
  totalTokens: { p50: number | null; p90: number | null };
  costUsd: { p50: number | null; p90: number | null };
  lastLedgerAt?: string | null;
  generatedAt: string;
}

export interface SyncRuntimeUsageLedgerInput {
  projectId: string;
  taskId?: string;
  agentRunId?: string;
  runtimeSessionId: string;
  executionSource: string;
  entrypointType: string;
  orchestrationFingerprint?: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  requestCountDelta?: number;
  stepCountDelta?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  candidateCount?: number;
  judgeRequestCountDelta?: number;
  hookRequestCountDelta?: number;
  status?: RuntimeUsageLedgerStatus;
  startedAt?: string;
  finishedAt?: string;
  syncedAt?: string;
  step?: {
    stepType: RuntimeUsageLedgerStepType;
    triggerType?: string;
    hookId?: string;
    candidateIndex?: number;
    requestIndex?: number;
    providerId?: string;
    modelId?: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    amplificationSource?: string;
    status?: RuntimeUsageLedgerStepStatus;
    startedAt?: string;
    finishedAt?: string;
  };
}

function buildStableStepId(input: SyncRuntimeUsageLedgerInput) {
  const step = input.step;
  if (!step) {
    return undefined;
  }

  return [
    input.runtimeSessionId,
    step.stepType,
    step.triggerType || "",
    step.hookId || "",
    step.candidateIndex ?? -1,
    step.requestIndex ?? 0,
    step.status || "completed",
  ].join(":");
}

export async function syncRuntimeUsageLedger(input: SyncRuntimeUsageLedgerInput): Promise<
  UpstreamResponse<{
    projectId: string;
    ledger: RuntimeUsageLedgerRecord | null;
    stepInserted: boolean;
    deltaApplied: boolean;
  }>
> {
  const authorization = await createInternalAuthorization();
  return cpFetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/runtime-usage-ledgers/sync`,
    {
      method: "POST",
      authorization,
      body: {
        taskId: input.taskId,
        agentRunId: input.agentRunId,
        runtimeSessionId: input.runtimeSessionId,
        executionSource: input.executionSource,
        entrypointType: input.entrypointType,
        orchestrationFingerprint: input.orchestrationFingerprint,
        defaultProviderId: input.defaultProviderId,
        defaultModelId: input.defaultModelId,
        requestCountDelta: input.requestCountDelta ?? 1,
        stepCountDelta: input.stepCountDelta ?? 1,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        costUsd: input.costUsd,
        candidateCount: input.candidateCount,
        judgeRequestCountDelta: input.judgeRequestCountDelta ?? 0,
        hookRequestCountDelta: input.hookRequestCountDelta ?? 0,
        status: input.status ?? "completed",
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        syncedAt: input.syncedAt,
        step: input.step
          ? {
              id: buildStableStepId(input),
              stepType: input.step.stepType,
              triggerType: input.step.triggerType,
              hookId: input.step.hookId,
              candidateIndex: input.step.candidateIndex,
              requestIndex: input.step.requestIndex ?? 0,
              providerId: input.step.providerId,
              modelId: input.step.modelId,
              inputTokens: input.step.inputTokens,
              outputTokens: input.step.outputTokens,
              totalTokens: input.step.totalTokens,
              costUsd: input.step.costUsd,
              amplificationSource: input.step.amplificationSource,
              status: input.step.status ?? "completed",
              startedAt: input.step.startedAt,
              finishedAt: input.step.finishedAt,
            }
          : undefined,
      },
    },
  );
}

export async function fetchProjectRuntimeUsageLedgers(
  projectId: string,
  authorization: string,
  params?: { limit?: number; taskId?: string; status?: string },
) {
  const search = new URLSearchParams();
  if (params?.limit) {
    search.set("limit", String(params.limit));
  }
  if (params?.taskId) {
    search.set("taskId", params.taskId);
  }
  if (params?.status) {
    search.set("status", params.status);
  }

  const suffix = search.toString() ? `?${search.toString()}` : "";
  return cpFetch<{
    projectId: string;
    totals: {
      ledgerCount: number;
      requestCount: number;
      stepCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
    };
    items: RuntimeUsageLedgerRecord[];
  }>(`/api/projects/${encodeURIComponent(projectId)}/runtime-usage-ledgers${suffix}`, {
    authorization,
  });
}

export async function fetchProjectRuntimeUsageLedgerDetail(
  projectId: string,
  ledgerId: string,
  authorization: string,
) {
  return cpFetch<{
    projectId: string;
    ledger: RuntimeUsageLedgerRecord;
    steps: RuntimeUsageLedgerStepRecord[];
    breakdown: { byStepType: Record<string, number> };
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/runtime-usage-ledgers/${encodeURIComponent(ledgerId)}`,
    {
      authorization,
    },
  );
}

export async function fetchProjectRuntimeUsageBaseline(
  projectId: string,
  authorization: string,
  params?: {
    providerId?: string;
    modelId?: string;
    entrypointType?: string;
    orchestrationFingerprint?: string;
  },
) {
  const search = new URLSearchParams();
  if (params?.providerId) search.set("providerId", params.providerId);
  if (params?.modelId) search.set("modelId", params.modelId);
  if (params?.entrypointType) search.set("entrypointType", params.entrypointType);
  if (params?.orchestrationFingerprint)
    search.set("orchestrationFingerprint", params.orchestrationFingerprint);
  const suffix = search.toString() ? `?${search.toString()}` : "";

  return cpFetch<{
    projectId: string;
    query: {
      providerId?: string | null;
      modelId?: string | null;
      entrypointType?: string | null;
      orchestrationFingerprint?: string | null;
    };
    baseline: RuntimeUsageBaselineRecord | null;
    candidates: RuntimeUsageBaselineRecord[];
  }>(`/api/projects/${encodeURIComponent(projectId)}/runtime-usage-baselines${suffix}`, {
    authorization,
  });
}
