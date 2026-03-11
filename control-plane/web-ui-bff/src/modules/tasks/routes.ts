import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import { classifyIntent } from "../../lib/intent-classifier";
import { resolveModelRoute, validateModelProvider } from "../../lib/opencode-config";
import {
  type ExecutionPlan,
  type HookExecutionRecord,
  buildExecutionPlan,
  mergeTaskStrategy,
  readOrchestrationStrategy,
  resolveWorkflowTemplate,
} from "../../lib/orchestration-strategy";
import type { JWTPayload } from "../../middleware/auth";
import {
  continueSession,
  createSession,
  getSessionMessages,
  listSessions,
} from "../agent-control/opencode-adapter";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { syncGraphsForSessionTask, syncGraphsForTask } from "../realtime/dag-sync";
import { sseAggregator } from "../realtime/sse-aggregator";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { reconcileRunningTasksOnStartup } from "./reconcile";

// ── Task Routes (BFF) ──────────────────────────────────────────────

type AppEnv = { Variables: { user: JWTPayload } };

export const taskRoutes = new Hono<AppEnv>();

type IntentClassification = ReturnType<typeof classifyIntent>;
type ResolvedModel = { providerId: string; modelId: string };
type SessionStartResult = Awaited<ReturnType<typeof createSession>>;

interface StartExecutionResponse {
  status: 200 | 502;
  body: Record<string, unknown>;
}

interface ExecutableTask {
  id: string;
  prompt: string;
  status: string;
  projectId: string;
  title: string;
  selectedModel?: string | null;
  repoId?: string | null;
  repoName?: string | null;
  remoteUrl?: string | null;
  workingBranch?: string | null;
  credentialId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
}

type IdentitySnapshot = Record<string, unknown>;

interface PreparedExecutionContext {
  task: ExecutableTask;
  authorization: string;
  identitySnapshot: IdentitySnapshot;
  classification: IntentClassification;
  executionAgent: string;
  plan: ExecutionPlan;
  repoContext: ReturnType<typeof buildRepoContext>;
  resolvedModel?: ResolvedModel;
  effectiveModel?: string;
}

interface ExecutionContext extends PreparedExecutionContext {
  prompt: string;
  hookExecutions: HookExecutionRecord[];
}

interface ParallelCandidateAttempt {
  index: number;
  sessionResult?: SessionStartResult;
}

function requireSystemAdmin(user: JWTPayload): string | null {
  if (user.role === "platform_admin" || user.role === "org_admin" || user.role === "admin") {
    return null;
  }
  return "Requires org_admin role";
}

async function recordManualReconcileAudit(
  authorization: string,
  user: JWTPayload,
  summary: Awaited<ReturnType<typeof reconcileRunningTasksOnStartup>>,
) {
  const result = await cpFetch("/api/audit", {
    method: "POST",
    authorization,
    body: {
      eventType: "task.running.reconciled",
      action: "manual_reconcile_running_tasks",
      target: "running_tasks",
      detail: {
        triggeredByRole: user.role,
        scanned: summary.scanned,
        completed: summary.completed,
        failed: summary.failed,
        recovered: summary.recovered,
        skipped: summary.skipped,
        runtimeAvailable: summary.runtimeAvailable,
      },
      riskLevel: "medium",
    },
  });

  if (!result.ok) {
    console.warn(
      `[reconcile] audit write failed status=${result.status} user=${user.sub} action=manual_reconcile_running_tasks`,
    );
  }
}

async function fetchExecutableTask(taskId: string, authorization: string) {
  return cpFetch<ExecutableTask>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization,
  });
}

async function resolveExecutionIdentity(task: ExecutableTask, authorization: string) {
  if (!task.repoId || task.gitAuthorName) {
    return {} satisfies IdentitySnapshot;
  }

  const credResult = await resolveIdentity(
    task.projectId,
    task.repoId,
    task.credentialId ?? undefined,
    authorization,
  );
  return credResult ?? ({} satisfies IdentitySnapshot);
}

function selectExecutionAgent(prompt: string) {
  const strategy = readOrchestrationStrategy();
  const classification = classifyIntent(prompt);
  const configuredAgents = strategy.categoryAgentMap[classification.category] || [];
  const suggestedAgents =
    configuredAgents.length > 0 ? configuredAgents : classification.suggestedAgents;

  // Resolve template and build execution plan
  const template = resolveWorkflowTemplate(strategy, classification.category);
  const plan = buildExecutionPlan(template, strategy, classification.category);

  // For single mode, the execution agent is the sole candidate
  const executionAgent = plan.candidates[0]?.agent || suggestedAgents[0] || "build";

  return {
    classification: {
      ...classification,
      suggestedAgents,
    },
    executionAgent,
    strategy,
    plan,
  };
}

/**
 * Resolve the model to use for execution.
 * Priority: task.selectedModel > project.settings.defaultModel > env fallback (null).
 */
async function resolveExecutionModel(
  task: ExecutableTask,
  authorization: string,
  strategyModel?: string,
): Promise<ResolvedModel | undefined> {
  // 1. Task-level override
  if (task.selectedModel) {
    return parseModelString(task.selectedModel);
  }

  // 2. Strategy-level category override
  if (strategyModel) {
    return parseModelString(strategyModel);
  }

  // 3. Project-level default
  try {
    const projectResult = await cpFetch<{ settings?: { defaultModel?: string } }>(
      `/api/projects/${encodeURIComponent(task.projectId)}`,
      { authorization },
    );
    if (projectResult.ok && projectResult.data?.settings?.defaultModel) {
      return parseModelString(projectResult.data.settings.defaultModel);
    }
  } catch {
    // Fall through to env default
  }

  // 4. Return undefined — adapter will use its env-based defaults
  return undefined;
}

function parseModelString(raw: string): { providerId: string; modelId: string } {
  return resolveModelRoute(raw);
}

function buildRepoContext(task: ExecutableTask, identitySnapshot: IdentitySnapshot) {
  if (!task.repoId) {
    return undefined;
  }

  return {
    repoName: task.repoName ?? undefined,
    remoteUrl: task.remoteUrl ?? undefined,
    workingBranch: task.workingBranch ?? undefined,
    gitAuthorName: (identitySnapshot.gitAuthorName ?? task.gitAuthorName ?? undefined) as
      | string
      | undefined,
    gitAuthorEmail: (identitySnapshot.gitAuthorEmail ?? task.gitAuthorEmail ?? undefined) as
      | string
      | undefined,
    gitCommitterName: identitySnapshot.gitCommitterName as string | undefined,
    gitCommitterEmail: identitySnapshot.gitCommitterEmail as string | undefined,
  };
}

function buildTaskPatchBody(
  execResult: { sessionId?: string; agentRunId?: string },
  classification: ReturnType<typeof classifyIntent>,
  identitySnapshot: IdentitySnapshot,
  executionMeta: {
    selectedAgent: string;
    effectiveModel?: string;
    plan?: ExecutionPlan;
    hookExecutions?: HookExecutionRecord[];
  },
) {
  return {
    status: "running",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    category: classification.category,
    executionMode: executionMeta.plan?.mode ?? "single",
    executionPlan: executionMeta.plan ? JSON.stringify(executionMeta.plan) : undefined,
    strategy: mergeTaskStrategy(undefined, {
      selectedTemplateId: executionMeta.plan?.templateId,
      complexity: classification.complexity,
      suggestedAgents: classification.suggestedAgents,
      requiresPlan: classification.requiresPlan,
      confidence: classification.confidence,
      selectedAgent: executionMeta.selectedAgent,
      effectiveModel: executionMeta.effectiveModel,
      executionMode: executionMeta.plan?.mode,
      hookExecutions: executionMeta.hookExecutions,
    }),
    ...identitySnapshot,
  };
}

function buildWorkflowPromptContext(
  task: ExecutableTask,
  extras: Record<string, string | undefined | null>,
) {
  return {
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    repoName: task.repoName,
    remoteUrl: task.remoteUrl,
    workingBranch: task.workingBranch,
    ...extras,
  };
}

async function runPreExecutionHooks(
  task: ExecutableTask,
  repoContext: ReturnType<typeof buildRepoContext>,
  executionAgent: string,
  effectiveModel: string | undefined,
) {
  const strategy = readOrchestrationStrategy();
  const hookResult = await executeLifecycleHooks({
    strategy,
    trigger: "pre-execution",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "Preflight",
    repoContext,
    context: buildWorkflowPromptContext(task, {
      selectedAgent: executionAgent,
      selectedModel: effectiveModel,
      taskResult: "",
      changesSummary: "",
    }),
  });

  if (hookResult.hookExecutions.length === 0) {
    return {
      prompt: task.prompt,
      hookExecutions: [] as HookExecutionRecord[],
    };
  }

  if (hookResult.rewrittenPrompt) {
    return {
      prompt: hookResult.rewrittenPrompt,
      hookExecutions: hookResult.hookExecutions,
    };
  }

  // Default: prepend the review as context for the execution agent
  const promptWithReview = [
    "Pre-execution assessment from the configured review agent:",
    hookResult.combinedResultText || "",
    "",
    "Original task:",
    task.prompt,
  ].join("\n\n");

  return {
    prompt: promptWithReview,
    hookExecutions: hookResult.hookExecutions,
  };
}

function validateExecutableTask(task: ExecutableTask): string | null {
  if (task.status !== "pending") {
    return `Cannot execute: task status is ${task.status}`;
  }

  return null;
}

function validateResolvedModel(resolvedModel: ResolvedModel | undefined) {
  if (!resolvedModel) {
    return null;
  }

  const check = validateModelProvider(resolvedModel.providerId);
  if (check.valid) {
    return null;
  }

  return {
    status: 400 as const,
    body: {
      error: check.error,
      code: "MODEL_PROVIDER_NOT_CONFIGURED",
      providers: check.providers,
    },
  };
}

async function prepareExecutionContext(
  task: ExecutableTask,
  authorization: string,
): Promise<PreparedExecutionContext> {
  const identitySnapshot = await resolveExecutionIdentity(task, authorization);
  const { classification, executionAgent, strategy, plan } = selectExecutionAgent(task.prompt);
  const resolvedModel = await resolveExecutionModel(
    task,
    authorization,
    strategy.categoryModelMap[classification.category] || undefined,
  );
  const repoContext = buildRepoContext(task, identitySnapshot);

  return {
    task,
    authorization,
    identitySnapshot,
    classification,
    executionAgent,
    plan,
    repoContext,
    resolvedModel,
    effectiveModel: resolvedModel
      ? `${resolvedModel.providerId}:${resolvedModel.modelId}`
      : undefined,
  };
}

async function finalizePreExecutionContext(
  context: PreparedExecutionContext,
): Promise<ExecutionContext> {
  const preExecutionHooks = await runPreExecutionHooks(
    context.task,
    context.repoContext,
    context.executionAgent,
    context.effectiveModel,
  );

  return {
    ...context,
    prompt: preExecutionHooks.prompt,
    hookExecutions: [...preExecutionHooks.hookExecutions],
  };
}

function isParallelExecution(plan: ExecutionPlan) {
  return plan.mode === "parallel" && plan.candidates.length > 1;
}

async function createParallelCandidateAttempts(
  context: ExecutionContext,
): Promise<ParallelCandidateAttempt[]> {
  return Promise.all(
    context.plan.candidates.map(async (candidate, index) => {
      try {
        const sessionResult = await createSession(
          context.task.id,
          context.task.projectId,
          context.prompt,
          {
            agent: candidate.agent,
            candidateIndex: index,
            repoContext: context.repoContext,
            model: context.resolvedModel,
          },
        );
        return { index, sessionResult };
      } catch {
        return { index };
      }
    }),
  );
}

function applyParallelCandidateAttempts(plan: ExecutionPlan, attempts: ParallelCandidateAttempt[]) {
  let hasAnySuccess = false;
  const startedAt = new Date().toISOString();

  for (const attempt of attempts) {
    const candidate = plan.candidates[attempt.index];
    if (!candidate) {
      continue;
    }

    if (!attempt.sessionResult) {
      candidate.status = "failed";
      continue;
    }

    candidate.sessionId = attempt.sessionResult.sessionId;
    candidate.agentRunId = attempt.sessionResult.agentRunId;
    candidate.status = attempt.sessionResult.ok ? "running" : "failed";
    candidate.startedAt = startedAt;
    hasAnySuccess ||= attempt.sessionResult.ok;
  }

  return hasAnySuccess;
}

async function markTaskFailed(taskId: string, authorization: string) {
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: "failed" },
    authorization,
  });
}

async function persistExecutionStart(
  context: ExecutionContext,
  execResult: { sessionId?: string; agentRunId?: string },
) {
  await cpFetch(`/api/tasks/${encodeURIComponent(context.task.id)}`, {
    method: "PATCH",
    body: buildTaskPatchBody(execResult, context.classification, context.identitySnapshot, {
      selectedAgent: context.executionAgent,
      effectiveModel: context.effectiveModel,
      plan: context.plan,
      hookExecutions: context.hookExecutions,
    }),
    authorization: context.authorization,
  });
}

function broadcastParallelExecutionStarted(context: ExecutionContext) {
  for (const candidate of context.plan.candidates) {
    if (candidate.status !== "running") {
      continue;
    }

    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.started",
      ts: new Date().toISOString(),
      taskId: context.task.id,
      projectId: context.task.projectId,
      agentRunId: candidate.agentRunId,
      sessionId: candidate.sessionId,
      data: {
        taskId: context.task.id,
        title: context.task.title,
        agentRunId: candidate.agentRunId,
        agent: candidate.agent,
        executionMode: "parallel",
      },
    });
  }
}

function buildParallelExecutionResponse(
  taskId: string,
  primaryCandidate: ExecutionPlan["candidates"][number] | undefined,
  candidates: ExecutionPlan["candidates"],
): StartExecutionResponse {
  return {
    status: 200,
    body: {
      taskId,
      sessionId: primaryCandidate?.sessionId,
      agentRunId: primaryCandidate?.agentRunId,
      status: "running",
      executionMode: "parallel",
      candidates: candidates.map((candidate) => ({
        agent: candidate.agent,
        sessionId: candidate.sessionId,
        status: candidate.status,
      })),
    },
  };
}

async function startParallelExecution(context: ExecutionContext): Promise<StartExecutionResponse> {
  const attempts = await createParallelCandidateAttempts(context);
  const hasAnySuccess = applyParallelCandidateAttempts(context.plan, attempts);

  if (!hasAnySuccess) {
    await markTaskFailed(context.task.id, context.authorization);
    return {
      status: 502,
      body: { error: "All parallel candidates failed to start" },
    };
  }

  const primaryCandidate = context.plan.candidates.find(
    (candidate) => candidate.status === "running",
  );
  await persistExecutionStart(context, {
    sessionId: primaryCandidate?.sessionId,
    agentRunId: primaryCandidate?.agentRunId,
  });
  sseAggregator.registerParallelTask(context.task.id, context.plan.candidates);
  broadcastParallelExecutionStarted(context);

  return buildParallelExecutionResponse(context.task.id, primaryCandidate, context.plan.candidates);
}

function handleSingleExecutionFailure(
  taskId: string,
  execResult: SessionStartResult,
): StartExecutionResponse | null {
  if (!execResult.ok && !execResult.sessionId) {
    return {
      status: 502,
      body: { error: execResult.error || "Failed to start agent execution" },
    };
  }

  if (!execResult.ok && execResult.sessionId) {
    return {
      status: 502,
      body: {
        error: execResult.error || "Agent 会话已创建但提示发送失败 — 所选模型可能未开通或不可用",
        code: "MODEL_RUNTIME_ERROR",
        sessionId: execResult.sessionId,
        taskId,
      },
    };
  }

  return null;
}

function attachSingleCandidate(plan: ExecutionPlan, execResult: SessionStartResult) {
  const candidate = plan.candidates[0];
  if (!candidate) {
    return;
  }

  candidate.sessionId = execResult.sessionId;
  candidate.agentRunId = execResult.agentRunId;
  candidate.status = "running";
  candidate.startedAt = new Date().toISOString();
}

function broadcastSingleExecutionStarted(
  context: ExecutionContext,
  execResult: SessionStartResult,
) {
  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "agent.started",
    ts: new Date().toISOString(),
    taskId: context.task.id,
    projectId: context.task.projectId,
    agentRunId: execResult.agentRunId,
    sessionId: execResult.sessionId,
    data: {
      taskId: context.task.id,
      title: context.task.title,
      agentRunId: execResult.agentRunId,
    },
  });
}

async function startSingleExecution(context: ExecutionContext): Promise<StartExecutionResponse> {
  const execResult = await createSession(context.task.id, context.task.projectId, context.prompt, {
    agent: context.executionAgent,
    repoContext: context.repoContext,
    model: context.resolvedModel,
  });
  const failure = handleSingleExecutionFailure(context.task.id, execResult);
  if (failure) {
    if (failure.body.code === "MODEL_RUNTIME_ERROR") {
      await markTaskFailed(context.task.id, context.authorization);
    }
    return failure;
  }

  attachSingleCandidate(context.plan, execResult);
  await persistExecutionStart(context, execResult);
  broadcastSingleExecutionStarted(context, execResult);

  return {
    status: 200,
    body: {
      taskId: context.task.id,
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
      status: "running",
      executionMode: "single",
    },
  };
}

// GET /api/tasks — List tasks
taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId") || "";
  const status = c.req.query("status") || "";
  const repoId = c.req.query("repoId") || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  if (repoId) params.set("repoId", repoId);

  const result = await cpFetch(`/api/tasks?${params.toString()}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// GET /api/tasks/:taskId — Get task detail
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// POST /api/tasks — Create a new task
const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
  repoId: z.string().min(1).optional(),
  workingBranch: z.string().min(1).max(100).optional(),
  credentialId: z.string().min(1).optional(),
  selectedModel: z.string().max(200).optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
});

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const body = c.req.valid("json");

  const result = await cpFetch<{ id: string; status: string }>("/api/tasks", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });

  if (result.ok) {
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "task.created",
      ts: new Date().toISOString(),
      taskId: result.data.id,
      projectId: body.projectId,
      data: { title: body.title },
    });
  }

  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 502));
});

// POST /api/tasks/:taskId/execute — Start agent execution for a task
taskRoutes.post("/:taskId/execute", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const taskResult = await fetchExecutableTask(taskId, authorization);
  if (!taskResult.ok) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;
  const validationError = validateExecutableTask(task);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const preparedContext = await prepareExecutionContext(task, authorization);
  const modelValidationError = validateResolvedModel(preparedContext.resolvedModel);
  if (modelValidationError) {
    return c.json(modelValidationError.body, modelValidationError.status);
  }

  const executionContext = await finalizePreExecutionContext(preparedContext);
  const response = isParallelExecution(executionContext.plan)
    ? await startParallelExecution(executionContext)
    : await startSingleExecution(executionContext);

  return c.json(response.body, response.status);
});

// POST /api/tasks/reconcile-running — Manually reconcile persisted running tasks
taskRoutes.post("/reconcile-running", async (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) {
    return c.json({ error: adminErr }, 403);
  }

  const user = c.get("user");
  const authorization = authHeader(c);
  const summary = await reconcileRunningTasksOnStartup();
  await recordManualReconcileAudit(authorization, user, summary);
  return c.json({ ok: true, data: summary });
});

// GET /api/tasks/:taskId/graph — Get DAG visualization data
taskRoutes.get("/:taskId/graph", async (c) => {
  const taskId = c.req.param("taskId");
  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization: authHeader(c),
    },
  );

  // Sync latest runtime DAG state before returning
  await syncGraphsForSessionTask(
    taskId,
    taskResult.ok ? taskResult.data?.sessionId : undefined,
  ).catch(() => {});
  await syncGraphsForTask(taskId).catch(() => {});
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/graph`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/runs — Get agent run history
taskRoutes.get("/:taskId/runs", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/runs`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/pipeline — Get planning pipeline results
// Fetches session messages and extracts planning stage outputs (prometheus/metis/momus)
const PIPELINE_AGENTS = ["prometheus-enterprise", "metis-enterprise", "momus-enterprise"];

taskRoutes.get("/:taskId/pipeline", async (c) => {
  const taskId = c.req.param("taskId");

  // Fetch the task to get its sessionId
  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization: authHeader(c) },
  );
  if (!taskResult.ok || !taskResult.data?.sessionId) {
    return c.json({ stages: [] });
  }

  // Fetch messages from the OpenCode session
  const msgResult = await getSessionMessages(taskResult.data.sessionId);
  if (!msgResult.ok || !Array.isArray(msgResult.data)) {
    return c.json({ stages: [] });
  }

  const messages = msgResult.data as Array<{
    info: { role: string; agent?: string; tokens?: { input: number; output: number } };
    parts: Array<{ type: string; text?: string }>;
  }>;

  // Extract planning pipeline stages from assistant messages
  const stages = PIPELINE_AGENTS.map((agentName) => {
    const agentMsgs = messages.filter(
      (m) => m.info.role === "assistant" && m.info.agent === agentName,
    );
    const lastMsg = agentMsgs[agentMsgs.length - 1];
    const output =
      lastMsg?.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n") || null;
    return {
      agent: agentName,
      label: agentName.replace("-enterprise", ""),
      status: agentMsgs.length > 0 ? (output ? "completed" : "running") : "pending",
      messageCount: agentMsgs.length,
      output: output ? (output.length > 2000 ? `${output.slice(0, 2000)}…` : output) : null,
      tokens: lastMsg?.info.tokens || null,
    };
  });

  return c.json({ stages });
});

// ═══════════════════════════════════════════════════════════════════
// SESSION ROUTES — Expose OpenCode session operations
// ═══════════════════════════════════════════════════════════════════

// GET /api/tasks/:taskId/sessions — List sessions related to a task
taskRoutes.get("/:taskId/sessions", async (c) => {
  const taskId = c.req.param("taskId");

  // Get task to find its sessionId
  const taskResult = await cpFetch<{ sessionId?: string; title?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization: authHeader(c) },
  );

  if (!taskResult.ok) {
    return c.json({ data: [] });
  }

  // List recent sessions from OpenCode and filter by task reference
  const sessResult = await listSessions(50);
  if (!sessResult.ok || !Array.isArray(sessResult.data)) {
    return c.json({ data: [] });
  }

  const taskPrefix = `[Task ${taskId.slice(0, 8)}]`;
  const sessions = (
    sessResult.data as Array<{
      id: string;
      title?: string;
      version?: string;
      summary?: { additions: number; deletions: number; files: number };
      time?: { created: number; updated: number };
    }>
  )
    .filter((s) => s.id === taskResult.data?.sessionId || s.title?.includes(taskPrefix))
    .map((s) => ({
      id: s.id,
      title: s.title || "",
      isActive: s.id === taskResult.data?.sessionId,
      summary: s.summary || null,
      createdAt: s.time?.created ? new Date(s.time.created).toISOString() : null,
      updatedAt: s.time?.updated ? new Date(s.time.updated).toISOString() : null,
    }));

  return c.json({ data: sessions });
});

// GET /api/tasks/:taskId/sessions/:sessionId/messages — Get session messages
taskRoutes.get("/:taskId/sessions/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId") as string;
  const result = await getSessionMessages(sessionId);
  if (!result.ok) {
    return c.json({ data: [] });
  }
  return c.json({ data: result.data });
});

// POST /api/tasks/:taskId/continue — Continue a task (send follow-up prompt to its session)
const continueSchema = z.object({
  prompt: z.string().min(1).max(50000),
  sessionId: z.string().optional(),
});

taskRoutes.post("/:taskId/continue", zValidator("json", continueSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const { prompt, sessionId: overrideSessionId } = c.req.valid("json");

  // Get the task's session
  const taskResult = await cpFetch<{
    sessionId?: string;
    projectId: string;
    selectedModel?: string | null;
  }>(`/api/tasks/${encodeURIComponent(taskId)}`, { authorization: authHeader(c) });

  if (!taskResult.ok) return c.json({ error: "Task not found" }, 404);

  const sid = overrideSessionId || taskResult.data?.sessionId;
  if (!sid) return c.json({ error: "No session associated with this task" }, 400);

  // Resolve model for continuation (same priority as initial execution)
  const resolvedModel = await resolveExecutionModel(
    {
      id: taskId,
      prompt,
      status: "running",
      projectId: taskResult.data.projectId,
      title: "",
      selectedModel: taskResult.data.selectedModel,
    },
    authHeader(c),
  );

  // Pre-flight: validate model provider
  if (resolvedModel) {
    const check = validateModelProvider(resolvedModel.providerId);
    if (!check.valid) {
      return c.json(
        { error: check.error, code: "MODEL_PROVIDER_NOT_CONFIGURED", providers: check.providers },
        400,
      );
    }
  }

  const result = await continueSession(sid, prompt, { model: resolvedModel });
  if (!result.ok) return c.json({ error: result.error || "Failed to continue session" }, 502);

  // Update task status back to running
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: "running" },
    authorization: authHeader(c),
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.continued",
    ts: new Date().toISOString(),
    taskId,
    projectId: taskResult.data?.projectId,
    data: { sessionId: sid },
  });

  return c.json({ ok: true, sessionId: sid });
});

// ═══════════════════════════════════════════════════════════════════
// CODE CHANGE ROUTES
// ═══════════════════════════════════════════════════════════════════

// GET /api/tasks/:taskId/changes — List code changes for a task
taskRoutes.get("/:taskId/changes", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/changes`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/changes/:changeId/files — List files for a change
taskRoutes.get("/:taskId/changes/:changeId/files", async (c) => {
  const taskId = c.req.param("taskId");
  const changeId = c.req.param("changeId");
  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/changes/${encodeURIComponent(changeId)}/files`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/governance — Get governance summary for a task
taskRoutes.get("/:taskId/governance", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/governance/tasks/${encodeURIComponent(taskId)}/summary`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// ═══════════════════════════════════════════════════════════════════
// IDENTITY RESOLUTION HELPER
// ═══════════════════════════════════════════════════════════════════

interface CredentialInfo {
  id: string;
  label: string;
  repoId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  scope: string;
  isDefault?: boolean;
  status?: string;
}

export function selectCredentialForIdentity(
  credentials: CredentialInfo[],
  repoId: string,
): CredentialInfo | null {
  const activeCredentials = credentials.filter(
    (credential) => credential.status !== "revoked" && credential.status !== "expired",
  );
  const repoCredentials = activeCredentials.filter((credential) => credential.repoId === repoId);
  const projectCredentials = activeCredentials.filter((credential) => !credential.repoId);

  return (
    repoCredentials.find((credential) => credential.isDefault) ??
    projectCredentials.find((credential) => credential.isDefault) ??
    repoCredentials[0] ??
    projectCredentials[0] ??
    null
  );
}

/**
 * Resolve identity for a task execution:
 * 1. If explicit credentialId, use that credential's author info
 * 2. Otherwise, look for default credential for the repo → project
 * Returns identity snapshot fields to freeze on the task, or null if nothing found.
 */
async function resolveIdentity(
  projectId: string,
  repoId: string,
  credentialId: string | undefined,
  authorization: string,
): Promise<Record<string, unknown> | null> {
  // If explicit credential specified, fetch it
  if (credentialId) {
    const credResult = await cpFetch<CredentialInfo>(
      `/api/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`,
      { authorization },
    );
    if (credResult.ok && credResult.data) {
      return buildIdentitySnapshot(credResult.data, credentialId);
    }
  }

  // Try to find a default credential for this repo, then fall back to project-level credentials.
  const repoCredsResult = await cpFetch<{ data: CredentialInfo[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials`,
    { authorization },
  );

  if (repoCredsResult.ok && Array.isArray(repoCredsResult.data?.data)) {
    const selectedCredential = selectCredentialForIdentity(repoCredsResult.data.data, repoId);
    if (selectedCredential) {
      return buildIdentitySnapshot(selectedCredential, selectedCredential.id);
    }
  }

  return null;
}

function buildIdentitySnapshot(
  cred: CredentialInfo,
  credentialId: string,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { credentialId };
  if (cred.gitAuthorName) snapshot.gitAuthorName = cred.gitAuthorName;
  if (cred.gitAuthorEmail) snapshot.gitAuthorEmail = cred.gitAuthorEmail;
  // For shared credentials, committer = credential author; for user, same as author
  if (cred.gitAuthorName) snapshot.gitCommitterName = cred.gitAuthorName;
  if (cred.gitAuthorEmail) snapshot.gitCommitterEmail = cred.gitAuthorEmail;
  return snapshot;
}
