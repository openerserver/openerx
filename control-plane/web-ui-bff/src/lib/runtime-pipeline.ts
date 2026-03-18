import { getSessionMessages } from "../modules/agent-control/opencode-adapter";
import { cpFetch } from "./control-plane-client";
import type {
  ExecutionCandidate,
  ExecutionPlan,
  ExecutionStep,
  HookExecutionRecord,
  PersistedTaskStrategy,
} from "./orchestration-strategy";

const PIPELINE_AGENTS = ["prometheus-enterprise", "metis-enterprise", "momus-enterprise"] as const;

export type RuntimePipelineStatus = "idle" | "running" | "completed" | "failed" | "paused";
export type RuntimePipelineStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface RuntimePipelineStage {
  id: string;
  type: "hook" | "planning" | "execution" | "judge" | "post-hook";
  label: string;
  status: RuntimePipelineStageStatus;
  order: number;
  sourceType:
    | "executionPlan.step"
    | "strategy.hookExecution"
    | "session.message";
  sourceId: string | null;
  agent: string | null;
  model: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: string | null;
  error: string | null;
  tokens: { input: number; output: number } | null;
  graphNodeId: string | null;
  dependsOn: string[];
  messageCount?: number;
}

export interface PipelineSummary {
  totalStages: number;
  completedStages: number;
  failedStages: number;
  currentStageId: string | null;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
  replanCount: number;
}

export interface RuntimePipeline {
  taskId: string;
  sessionId: string | null;
  branchName: string | null;
  status: RuntimePipelineStatus;
  createdAt: string | null;
  updatedAt: string;
  stages: RuntimePipelineStage[];
  summary: PipelineSummary;
}

interface TaskRecord {
  id: string;
  status?: string;
  sessionId?: string | null;
  strategy?: string | null;
  executionPlan?: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  result?: string | null;
}

interface TaskSessionRecord {
  id: string;
  runtimeSessionId: string;
  branchName: string | null;
  isActive: boolean;
  archivedAt?: string | null;
}

interface SessionMessageRecord {
  info?: {
    id?: string;
    role?: string;
    agent?: string;
    modelID?: string;
    model?: string;
    tokens?: { input: number; output: number };
    time?: { created?: number; completed?: number };
  };
  parts?: Array<{ type?: string; text?: string }>;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toIso(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  return null;
}

function computeDurationMs(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return end - start;
}

function truncateOutput(text: string | null | undefined, max = 2000) {
  if (!text) {
    return null;
  }

  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function mapTaskStatus(
  status: string | undefined,
  stages: RuntimePipelineStage[],
): RuntimePipelineStatus {
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed" || stages.some((stage) => stage.status === "failed")) {
    return "failed";
  }
  if (status === "paused") {
    return "paused";
  }
  return "idle";
}

function hookTriggerLabel(trigger: HookExecutionRecord["trigger"]) {
  switch (trigger) {
    case "pre-execution":
      return "执行前 Hook";
    case "post-execution":
      return "执行后 Hook";
    case "on-failure":
      return "失败 Hook";
    case "pre-resume":
      return "续跑前 Hook";
    default:
      return "Hook";
  }
}

function stepTypeLabel(step: ExecutionStep["type"]) {
  switch (step) {
    case "hook":
      return "Hook 阶段";
    case "judge":
      return "评判阶段";
    default:
      return "执行阶段";
  }
}

function stageFromHookExecution(record: HookExecutionRecord, order: number): RuntimePipelineStage {
  const finishedAt = toIso(record.completedAt);
  return {
    id: `hook:${record.trigger}:${record.hookId}:${order}`,
    type: record.trigger === "post-execution" ? "post-hook" : "hook",
    label: `${hookTriggerLabel(record.trigger)} · ${record.agent}`,
    status: record.status === "skipped" ? "skipped" : record.status,
    order,
    sourceType: "strategy.hookExecution",
    sourceId: record.hookId,
    agent: record.agent,
    model: record.model ?? null,
    sessionId: record.sessionId ?? null,
    startedAt: null,
    finishedAt,
    durationMs: null,
    output: truncateOutput(record.result),
    error: record.error ?? null,
    tokens:
      record.tokenUsed && record.tokenUsed > 0 ? { input: 0, output: record.tokenUsed } : null,
    graphNodeId: null,
    dependsOn: [],
  };
}

function stageFromPlanningMessages(
  agentName: string,
  messages: SessionMessageRecord[],
  order: number,
): RuntimePipelineStage | null {
  const agentMessages = messages.filter(
    (message) => message.info?.role === "assistant" && message.info?.agent === agentName,
  );
  if (agentMessages.length === 0) {
    return null;
  }

  const lastMessage = agentMessages[agentMessages.length - 1];
  if (!lastMessage) {
    return null;
  }
  const output = truncateOutput(
    (lastMessage.parts || [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n"),
  );
  const startedAt = toIso(lastMessage.info?.time?.created);
  const finishedAt = toIso(lastMessage.info?.time?.completed);

  return {
    id: `planning:${agentName}`,
    type: "planning",
    label: `规划 · ${agentName.replace("-enterprise", "")}`,
    status: output ? "completed" : "running",
    order,
    sourceType: "session.message",
    sourceId: lastMessage.info?.id ?? null,
    agent: agentName,
    model: lastMessage.info?.modelID ?? lastMessage.info?.model ?? null,
    sessionId: null,
    startedAt,
    finishedAt,
    durationMs: computeDurationMs(startedAt, finishedAt),
    output,
    error: null,
    tokens: lastMessage.info?.tokens ?? null,
    graphNodeId: null,
    dependsOn: [],
    messageCount: agentMessages.length,
  };
}

function stageFromPlanHookStep(step: ExecutionStep, order: number): RuntimePipelineStage {
  return {
    id: `plan-step:${step.id}`,
    type: "hook",
    label: stepTypeLabel(step.type),
    status: step.status,
    order,
    sourceType: "executionPlan.step",
    sourceId: step.id,
    agent: null,
    model: null,
    sessionId: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    output: null,
    error: null,
    tokens: null,
    graphNodeId: null,
    dependsOn: step.dependsOn ?? [],
  };
}

function stageFromExecutionCandidate(
  step: ExecutionStep,
  candidate: ExecutionCandidate,
  index: number,
  order: number,
): RuntimePipelineStage {
  return {
    id: `candidate:${index}:${candidate.sessionId ?? candidate.agent}`,
    type: "execution",
    label: candidate.label || `执行 · ${candidate.agent}`,
    status: candidate.status,
    order,
    sourceType: "executionPlan.step",
    sourceId: step.id,
    agent: candidate.agent,
    model: candidate.model ?? null,
    sessionId: candidate.sessionId ?? null,
    startedAt: candidate.startedAt ?? null,
    finishedAt: candidate.finishedAt ?? null,
    durationMs: computeDurationMs(candidate.startedAt ?? null, candidate.finishedAt ?? null),
    output: truncateOutput(candidate.result),
    error: null,
    tokens: null,
    graphNodeId: null,
    dependsOn: step.dependsOn ?? [],
  };
}

function stageFromJudgeStep(
  plan: ExecutionPlan,
  step: ExecutionStep,
  order: number,
): RuntimePipelineStage {
  const result = plan.judgeResult;
  const finishedAt = result?.completedAt ?? null;
  return {
    id: `judge:${step.id}`,
    type: "judge",
    label: "评判 / 聚合",
    status: result?.status === "skipped" ? "skipped" : (result?.status ?? step.status),
    order,
    sourceType: "executionPlan.step",
    sourceId: step.id,
    agent: null,
    model: result?.model ?? null,
    sessionId: result?.sessionId ?? null,
    startedAt: null,
    finishedAt,
    durationMs: null,
    output: truncateOutput(result?.reasoning),
    error: result?.status === "failed" ? result.reasoning : null,
    tokens:
      result?.tokenUsed && result.tokenUsed > 0 ? { input: 0, output: result.tokenUsed } : null,
    graphNodeId: null,
    dependsOn: step.dependsOn ?? [],
  };
}


function computePipelineSummary(stages: RuntimePipelineStage[]): PipelineSummary {
  const completedStages = stages.filter((stage) => stage.status === "completed").length;
  const failedStages = stages.filter((stage) => stage.status === "failed").length;
  const currentStage =
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "pending");

  return {
    totalStages: stages.length,
    completedStages,
    failedStages,
    currentStageId: currentStage?.id ?? null,
    totalTokens: stages.reduce(
      (acc, stage) => ({
        input: acc.input + (stage.tokens?.input ?? 0),
        output: acc.output + (stage.tokens?.output ?? 0),
      }),
      { input: 0, output: 0 },
    ),
    totalDurationMs: stages.reduce((acc, stage) => acc + (stage.durationMs ?? 0), 0),
    replanCount: 0,
  };
}

function finalizeStagesForTask(
  task: TaskRecord,
  stages: RuntimePipelineStage[],
): RuntimePipelineStage[] {
  if (task.status !== "failed") {
    return stages;
  }

  const failureAt = task.finishedAt ?? new Date().toISOString();
  const failureReason = task.result ?? "Task failed";

  return stages.map((stage) => {
    if (stage.status === "running") {
      return {
        ...stage,
        status: "failed",
        finishedAt: stage.finishedAt ?? failureAt,
        error: stage.error ?? failureReason,
      };
    }

    if (stage.status === "pending") {
      return {
        ...stage,
        status: "skipped",
        finishedAt: stage.finishedAt ?? failureAt,
      };
    }

    return stage;
  });
}

function buildEmptyRuntimePipeline(taskId: string, sessionId?: string, createdAt: string | null = null) {
  return {
    taskId,
    sessionId: sessionId ?? null,
    branchName: null,
    status: "idle" as const,
    createdAt,
    updatedAt: new Date().toISOString(),
    stages: [],
    summary: computePipelineSummary([]),
  };
}

async function loadRuntimePipelineResources(args: {
  taskId: string;
  requestedSessionId?: string;
  authorization: string;
  prefetchedMessages?: unknown[];
}) {
  const [lineageResult, messagesResult] = await Promise.all([
    cpFetch<{ data: TaskSessionRecord[] }>(`/api/tasks/${encodeURIComponent(args.taskId)}/task-sessions`, {
      authorization: args.authorization,
    }),
    args.prefetchedMessages
      ? Promise.resolve({ ok: true, data: args.prefetchedMessages } as const)
      : args.requestedSessionId
        ? getSessionMessages(args.requestedSessionId)
        : Promise.resolve({ ok: false } as const),
  ]);

  return { lineageResult, messagesResult };
}

function resolveRuntimePipelineResources(args: {
  lineageResult: Awaited<ReturnType<typeof cpFetch<{ data: TaskSessionRecord[] }>>>;
  messagesResult:
    | { ok: true; data: unknown[] }
    | { ok: false }
    | Awaited<ReturnType<typeof getSessionMessages>>;
  requestedSessionId?: string;
  task: TaskRecord;
}) {
  const lineage =
    args.lineageResult.ok && Array.isArray(args.lineageResult.data?.data)
      ? args.lineageResult.data.data.filter((record) => !record.archivedAt)
      : [];
  const sessionIsAllowed =
    !args.requestedSessionId ||
    args.requestedSessionId === args.task.sessionId ||
    lineage.length === 0 ||
    lineage.some((record) => record.runtimeSessionId === args.requestedSessionId);
  const branchName =
    lineage.find((record) => record.runtimeSessionId === args.requestedSessionId)?.branchName ?? null;
  const messages =
    args.messagesResult.ok && Array.isArray(args.messagesResult.data)
      ? (args.messagesResult.data as SessionMessageRecord[])
      : [];

  return { lineage, sessionIsAllowed, branchName, messages };
}

function appendHookExecutionStages(
  stages: RuntimePipelineStage[],
  hookExecutions: HookExecutionRecord[],
  order: number,
  triggers: HookExecutionRecord["trigger"][],
) {
  let nextOrder = order;
  for (const record of hookExecutions.filter((item) => triggers.includes(item.trigger))) {
    stages.push(stageFromHookExecution(record, nextOrder));
    nextOrder += 1;
  }
  return nextOrder;
}

function appendPlanningStages(
  stages: RuntimePipelineStage[],
  messages: SessionMessageRecord[],
  order: number,
) {
  let nextOrder = order;
  for (const agentName of PIPELINE_AGENTS) {
    const planningStage = stageFromPlanningMessages(agentName, messages, nextOrder);
    if (!planningStage) {
      continue;
    }
    stages.push(planningStage);
    nextOrder += 1;
  }
  return nextOrder;
}

function appendPlanStages(stages: RuntimePipelineStage[], plan: ExecutionPlan | null, order: number) {
  if (!plan) {
    return order;
  }

  let nextOrder = order;
  for (const step of plan.steps) {
    if (step.type === "hook") {
      stages.push(stageFromPlanHookStep(step, nextOrder));
      nextOrder += 1;
      continue;
    }
    if (step.type === "execution") {
      if (plan.candidates.length === 0) {
        stages.push(stageFromPlanHookStep(step, nextOrder));
        nextOrder += 1;
        continue;
      }
      for (const [index, candidate] of plan.candidates.entries()) {
        stages.push(stageFromExecutionCandidate(step, candidate, index, nextOrder));
        nextOrder += 1;
      }
      continue;
    }
    if (step.type === "judge") {
      stages.push(stageFromJudgeStep(plan, step, nextOrder));
      nextOrder += 1;
    }
  }

  return nextOrder;
}

export async function buildRuntimePipeline(args: {
  taskId: string;
  sessionId?: string;
  authorization: string;
  prefetchedMessages?: unknown[];
}): Promise<RuntimePipeline> {
  const taskResult = await cpFetch<TaskRecord>(`/api/tasks/${encodeURIComponent(args.taskId)}`, {
    authorization: args.authorization,
  });

  if (!taskResult.ok || !taskResult.data) {
    return buildEmptyRuntimePipeline(args.taskId, args.sessionId);
  }

  const task = taskResult.data;
  const requestedSessionId = args.sessionId || task.sessionId || undefined;
  const loadedResources = await loadRuntimePipelineResources({
    taskId: args.taskId,
    requestedSessionId,
    authorization: args.authorization,
    prefetchedMessages: args.prefetchedMessages,
  });
  const { sessionIsAllowed, branchName, messages } = resolveRuntimePipelineResources({
    ...loadedResources,
    requestedSessionId,
    task,
  });

  if (!sessionIsAllowed) {
    return buildEmptyRuntimePipeline(args.taskId, requestedSessionId, task.createdAt ?? null);
  }
  const plan = parseJson<ExecutionPlan>(task.executionPlan);
  const strategy = parseJson<PersistedTaskStrategy>(task.strategy);

  const stages: RuntimePipelineStage[] = [];
  let order = 0;

  const hookExecutions = Array.isArray(strategy?.hookExecutions) ? strategy.hookExecutions : [];
  order = appendHookExecutionStages(stages, hookExecutions, order, ["pre-execution", "pre-resume"]);
  order = appendPlanningStages(stages, messages, order);
  order = appendPlanStages(stages, plan, order);
  appendHookExecutionStages(stages, hookExecutions, order, ["post-execution", "on-failure"]);

  const finalizedStages = finalizeStagesForTask(
    task,
    stages.sort((left, right) => left.order - right.order),
  );
  const summary = computePipelineSummary(finalizedStages);

  return {
    taskId: args.taskId,
    sessionId: requestedSessionId ?? null,
    branchName,
    status: mapTaskStatus(task.status, finalizedStages),
    createdAt: task.createdAt ?? null,
    updatedAt: new Date().toISOString(),
    stages: finalizedStages,
    summary,
  };
}
