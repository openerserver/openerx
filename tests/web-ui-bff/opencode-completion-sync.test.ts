import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  DEFAULT_ORCHESTRATION_STRATEGY,
  type OrchestrationStrategy,
} from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  paidExecutionIntegrationTest,
  resolveExecutionIntegrationModel,
} from "./execution-integration-guard";
import { buildTaskCleanupStatements, resolveBffUrl, runCleanupStatements } from "./test-env";

const BFF_URL = resolveBffUrl();
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const executionIntegrationTest = paidExecutionIntegrationTest;

let originalOrchestrationStrategy: OrchestrationStrategy | null = null;

interface ConfigModelRecord {
  id?: string;
  provider?: string;
}

const SLOWER_EXECUTION_TEST_MODELS = ["github-copilot:gpt-4o"] as const;

interface TaskStatusRecord {
  status: string;
  result: string | null;
  finishedAt: string | null;
  currentRunId?: string | null;
  orchestrationKind?: string | null;
}

interface AgentStatusRecord {
  status: string;
  finishedAt?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BFF_URL}${path}`, options);
  const text = await response.text();

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }

  return data as T;
}

async function login(): Promise<string> {
  const data = await request<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  return data.token;
}

function cloneStrategy(strategy: OrchestrationStrategy): OrchestrationStrategy {
  return JSON.parse(JSON.stringify(strategy)) as OrchestrationStrategy;
}

async function getOrchestrationStrategy(token: string): Promise<OrchestrationStrategy> {
  const response = await request<{ data: OrchestrationStrategy }>(
    "/api/config/orchestration-strategy",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return response.data;
}

async function updateOrchestrationStrategy(
  token: string,
  strategy: OrchestrationStrategy,
): Promise<void> {
  await request<{ ok: boolean }>("/api/config/orchestration-strategy", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(strategy),
  });
}

beforeAll(async () => {
  const token = await login();
  originalOrchestrationStrategy = await getOrchestrationStrategy(token);
  await updateOrchestrationStrategy(token, cloneStrategy(DEFAULT_ORCHESTRATION_STRATEGY));
});

afterAll(async () => {
  if (!originalOrchestrationStrategy) {
    return;
  }

  const token = await login();
  await updateOrchestrationStrategy(token, originalOrchestrationStrategy);
});

async function getAvailableCopilotModel(token: string): Promise<string> {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const [modelList, testPolicy] = await Promise.all([
    request<{ data?: ConfigModelRecord[] }>("/api/config/models/list", {
      headers: authHeaders,
    }),
    request<{ data?: { effectiveModel?: string | null } }>("/api/config/models/test-policy", {
      headers: authHeaders,
    }),
  ]);

  return resolveExecutionIntegrationModel(modelList.data || [], testPolicy.data?.effectiveModel);
}

function selectPreferredExecutionModel(
  configuredModels: ConfigModelRecord[],
  preferredModels: readonly string[],
): string | null {
  for (const route of preferredModels) {
    const [provider, ...modelParts] = route.split(":");
    const modelId = modelParts.join(":");
    const configured = configuredModels.find(
      (model) => model.provider === provider && model.id === modelId,
    );
    if (configured?.provider && configured.id) {
      return `${configured.provider}:${configured.id}`;
    }
  }

  return null;
}

async function getCompletionSyncExecutionModel(
  token: string,
  options?: { preferSlowerModel?: boolean },
): Promise<string> {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const [modelList, testPolicy] = await Promise.all([
    request<{ data?: ConfigModelRecord[] }>("/api/config/models/list", {
      headers: authHeaders,
    }),
    request<{ data?: { effectiveModel?: string | null } }>("/api/config/models/test-policy", {
      headers: authHeaders,
    }),
  ]);

  const configuredModels = modelList.data || [];
  if (options?.preferSlowerModel) {
    const preferred = selectPreferredExecutionModel(configuredModels, SLOWER_EXECUTION_TEST_MODELS);
    if (preferred) {
      return preferred;
    }
  }

  return resolveExecutionIntegrationModel(configuredModels, testPolicy.data?.effectiveModel);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function summarizeEvents(events: Array<Record<string, unknown>>): Record<string, unknown> {
  const counts = new Map<string, number>();

  for (const event of events) {
    const type = typeof event.type === "string" ? event.type : "unknown";
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  const countsByType = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => ({ type, count }));

  const recentEvents = events.slice(-10).map((event) => {
    const data =
      typeof event.data === "object" && event.data ? (event.data as Record<string, unknown>) : null;

    return {
      type: event.type,
      taskId: event.taskId,
      agentRunId: event.agentRunId,
      receivedAt: event._receivedAt,
      reason: data?.reason,
      status: data?.status,
    };
  });

  return {
    totalEvents: events.length,
    countsByType,
    recentEvents,
  };
}

async function buildWaitForEventDiagnostics(options: {
  events: Array<Record<string, unknown>>;
  token: string;
  taskId?: string;
  agentRunId?: string;
}): Promise<string> {
  const diagnostics: Record<string, unknown> = {
    eventSummary: summarizeEvents(options.events),
  };

  if (options.taskId) {
    try {
      diagnostics.taskStatus = await request<TaskStatusRecord>(`/api/tasks/${options.taskId}`, {
        headers: { Authorization: `Bearer ${options.token}` },
      });
    } catch (error) {
      diagnostics.taskStatusError = error instanceof Error ? error.message : String(error);
    }
  }

  if (options.agentRunId) {
    try {
      diagnostics.agentStatus = await request<AgentStatusRecord>(
        `/api/agents/${options.agentRunId}/status`,
        {
          headers: { Authorization: `Bearer ${options.token}` },
        },
      );
    } catch (error) {
      diagnostics.agentStatusError = error instanceof Error ? error.message : String(error);
    }
  }

  return JSON.stringify(diagnostics);
}

async function waitForEvent(
  events: Array<Record<string, unknown>>,
  type: string,
  predicate: (event: Record<string, unknown>) => boolean = () => true,
  timeoutMs = 120000,
  describeTimeout?: () => Promise<string>,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const match = events.find((event) => event.type === type && predicate(event));
    if (match) {
      return match;
    }
    await sleep(250);
  }

  const diagnostics = describeTimeout ? await describeTimeout() : undefined;
  throw new Error(
    diagnostics
      ? `Timed out waiting for event ${type}; diagnostics=${diagnostics}`
      : `Timed out waiting for event ${type}`,
  );
}

function extractAssistantText(messages: unknown): string {
  const normalized = Array.isArray(messages)
    ? messages
    : typeof messages === "object" &&
        messages &&
        Array.isArray((messages as { data?: unknown[] }).data)
      ? (messages as { data: unknown[] }).data
      : [];

  for (let index = normalized.length - 1; index >= 0; index--) {
    const message = normalized[index] as {
      info?: Record<string, unknown>;
      parts?: Array<Record<string, unknown>>;
    };
    if (message?.info?.role !== "assistant") {
      continue;
    }

    const text = (message.parts || [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text).trim())
      .filter(Boolean)
      .join("\n\n");

    if (text) {
      return text;
    }
  }

  return "";
}

async function resolveCandidateAgentRunIds(
  _token: string,
  _taskId: string,
  _taskStatus: TaskStatusRecord,
  fallbackAgentRunId: string,
): Promise<{
  resolvedAgentRunId: string;
  candidateAgentRunIds: string[];
}> {
  return {
    resolvedAgentRunId: fallbackAgentRunId,
    candidateAgentRunIds: [fallbackAgentRunId],
  };
}

async function waitForCompletedStatus(
  token: string,
  taskId: string,
  agentRunId: string,
): Promise<{
  agentStatus: { status: string };
  taskStatus: TaskStatusRecord;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const [agentStatus, taskStatus] = await Promise.all([
      request<{ status: string }>(`/api/agents/${agentRunId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      request<TaskStatusRecord>(`/api/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    const completedStatuses =
      agentStatus.status === "completed" && taskStatus.status === "completed";
    const hasFinishedAt = Boolean(taskStatus.finishedAt);

    if (completedStatuses && hasFinishedAt) {
      return { agentStatus, taskStatus };
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for completed status of task ${taskId}`);
}

async function readExecutionStatusSnapshot(
  token: string,
  taskId: string,
  agentRunId: string,
): Promise<{
  taskStatus: TaskStatusRecord;
  agentStatus: AgentStatusRecord;
}> {
  const [taskStatus, agentStatus] = await Promise.all([
    request<TaskStatusRecord>(`/api/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    request<AgentStatusRecord>(`/api/agents/${agentRunId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  return { taskStatus, agentStatus };
}

async function ensureInteractionWindow(options: {
  token: string;
  taskId: string;
  agentRunId: string;
  execution: Record<string, unknown>;
  actionLabel: string;
}): Promise<{
  taskStatus: TaskStatusRecord;
  agentStatus: AgentStatusRecord;
  hasInteractionWindow: boolean;
}> {
  const { taskStatus, agentStatus } = await readExecutionStatusSnapshot(
    options.token,
    options.taskId,
    options.agentRunId,
  );

  if (taskStatus.status === "completed") {
    console.warn(
      `[opencode-completion-sync] 当前环境无可${options.actionLabel}窗口: execute 返回后任务已 completed; taskId=${options.taskId}; agentRunId=${options.agentRunId}; executionStatus=${JSON.stringify(options.execution)}; taskStatus=${JSON.stringify(taskStatus)}; agentStatus=${JSON.stringify(agentStatus)}`,
    );
    return {
      taskStatus,
      agentStatus,
      hasInteractionWindow: false,
    };
  }

  return {
    taskStatus,
    agentStatus,
    hasInteractionWindow: true,
  };
}

async function waitForStoppedStatus(
  token: string,
  agentRunId: string,
): Promise<{ status: string; finishedAt?: string | null }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const agentStatus = await request<{ status: string; finishedAt?: string | null }>(
      `/api/agents/${agentRunId}/status`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (agentStatus.status === "stopped") {
      return agentStatus;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for stopped status of agent ${agentRunId}`);
}

async function pauseAgentWithRetry(
  token: string,
  agentRunId: string,
  timeoutMs = 5000,
): Promise<void> {
  const startedAt = Date.now();
  let lastError = "Unknown pause failure";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const pauseResult = await request<{ ok: boolean }>(`/api/agents/${agentRunId}/pause`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      expect(pauseResult.ok).toBe(true);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (message.includes("status is completed") || message.includes("status is stopped")) {
        throw error;
      }
    }

    await sleep(150);
  }

  throw new Error(`Timed out trying to pause agent ${agentRunId}; lastError=${lastError}`);
}

async function waitForAgentSummary(
  token: string,
  agentRunId: string,
): Promise<{
  agentRunId: string;
  status: string;
  blockerType: string | null;
  blockerLabel: string;
  finishedAt: string | null;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const summary = await request<{
      agentRunId: string;
      status: string;
      blockerType: string | null;
      blockerLabel: string;
      finishedAt: string | null;
    }>(`/api/agents/${agentRunId}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (summary.status === "stopped") {
      return summary;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for stopped summary of agent ${agentRunId}`);
}

async function waitForQueueContains(
  token: string,
  queue: "attention" | "running" | "recent",
  agentRunId: string,
): Promise<{
  data: Array<{
    agentRunId: string;
    status: string;
    blockerType: string | null;
    blockerLabel: string;
  }>;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const response = await request<{
      data: Array<{
        agentRunId: string;
        status: string;
        blockerType: string | null;
        blockerLabel: string;
      }>;
    }>(`/api/agents/queues?queue=${encodeURIComponent(queue)}&page=1&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.data.some((item) => item.agentRunId === agentRunId)) {
      return response;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for agent ${agentRunId} in ${queue} queue`);
}

async function waitForAssistantResult(
  token: string,
  taskId: string,
  agentRunId: string,
): Promise<{
  taskStatus: TaskStatusRecord;
  assistantText: string;
  resolvedAgentRunId: string;
}> {
  const startedAt = Date.now();
  let lastTaskResult = "";
  let lastAssistantText = "";
  let lastResolvedAgentRunId = agentRunId;

  while (Date.now() - startedAt < 30000) {
    const taskStatus = await request<TaskStatusRecord>(`/api/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { resolvedAgentRunId, candidateAgentRunIds } = await resolveCandidateAgentRunIds(
      token,
      taskId,
      taskStatus,
      agentRunId,
    );
    lastTaskResult = String(taskStatus.result ?? "");
    lastResolvedAgentRunId = resolvedAgentRunId;

    for (const candidateAgentRunId of candidateAgentRunIds) {
      const messages = await request(`/api/agents/${candidateAgentRunId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const assistantText = extractAssistantText(messages);
      if (assistantText) {
        lastAssistantText = assistantText;
      }
      if (assistantText && taskStatus.result === assistantText) {
        return { taskStatus, assistantText, resolvedAgentRunId: candidateAgentRunId };
      }
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for assistant result of task ${taskId}; resolvedAgentRunId=${lastResolvedAgentRunId}; taskResult=${JSON.stringify(lastTaskResult)}; assistantText=${JSON.stringify(lastAssistantText)}`,
  );
}

async function deleteTask(taskId: string): Promise<void> {
  await runCleanupStatements(buildTaskCleanupStatements([taskId]), "opencode completion sync test");
}

async function runCompletionSyncScenario(options: {
  titlePrefix: string;
  prompt: string;
  intervene: boolean;
  expectResultSync: boolean;
}): Promise<void> {
  const health = await request<{ status: string }>("/health");
  expect(health.status).toBe("ok");

  const token = await login();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const selectedModel = await getCompletionSyncExecutionModel(token, {
    preferSlowerModel: options.intervene,
  });

  const task = await request<{ id: string }>("/api/tasks", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      title: `${options.titlePrefix}-${Date.now()}`,
      projectId: PROJECT_ID,
      prompt: options.prompt,
      selectedModel,
    }),
  });

  if (options.intervene) {
    await request<{ ok: boolean }>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        strategy: JSON.stringify({
          workflowTemplateId: null,
          selectedTemplateId: null,
        }),
      }),
    });
  }

  const events: Array<Record<string, unknown>> = [];
  const wsReady = createDeferred<void>();
  const ws = new WebSocket(
    `${BFF_URL.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`,
  );

  let agentRunId = "";
  let completed = false;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "subscribe_task", taskId: task.id, projectId: PROJECT_ID }));
    wsReady.resolve();
  });

  ws.addEventListener("message", (message) => {
    try {
      const event = JSON.parse(String(message.data)) as Record<string, unknown>;
      event._receivedAt = Date.now();
      events.push(event);
    } catch {
      // ignore malformed frames
    }
  });

  ws.addEventListener("error", (error) => wsReady.reject(error));

  try {
    await wsReady.promise;

    const describeTimeout = () =>
      buildWaitForEventDiagnostics({
        events,
        token,
        taskId: task.id,
        agentRunId: agentRunId || undefined,
      });

    const execution = await request<{ agentRunId: string; sessionId: string }>(
      `/api/tasks/${task.id}/execute`,
      {
        method: "POST",
        headers: authHeaders,
      },
    );

    agentRunId = execution.agentRunId;

    if (options.intervene) {
      const { hasInteractionWindow } = await ensureInteractionWindow({
        token,
        taskId: task.id,
        agentRunId,
        execution,
        actionLabel: "暂停",
      });

      if (!hasInteractionWindow) {
        completed = true;
        return;
      }

      await pauseAgentWithRetry(token, agentRunId);
      await waitForEvent(
        events,
        "agent.started",
        (event) => event.agentRunId === agentRunId,
        15000,
      );
      await waitForEvent(events, "agent.paused", (event) => event.agentRunId === agentRunId, 15000);
    } else {
      await waitForEvent(
        events,
        "agent.started",
        (event) => event.agentRunId === agentRunId,
        15000,
      );
    }

    if (options.intervene) {
      const guidanceResult = await request<{ ok: boolean }>(`/api/agents/${agentRunId}/guidance`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          content:
            "Quick brief reply only. Discard any unfinished output from before the pause. Do not inspect the repository or call tools. Reply with exactly these 3 bullets and nothing else: - Resumed flow acknowledged. - Final result stored. - Runtime delay observed.",
          mode: "noReply",
        }),
      });
      expect(guidanceResult.ok).toBe(true);
      await waitForEvent(
        events,
        "guidance.injected",
        (event) => event.agentRunId === agentRunId,
        15000,
      );

      const resumeResult = await request<{ ok: boolean }>(`/api/agents/${agentRunId}/resume`, {
        method: "POST",
        headers: authHeaders,
      });
      expect(resumeResult.ok).toBe(true);

      await waitForEvent(
        events,
        "agent.resumed",
        (event) => event.agentRunId === agentRunId,
        15000,
      );
    }

    await waitForEvent(
      events,
      "agent.completed",
      (event) => event.agentRunId === agentRunId,
      120000,
      describeTimeout,
    );
    await waitForEvent(
      events,
      "task.completed",
      (event) => event.taskId === task.id,
      120000,
      describeTimeout,
    );
    await waitForEvent(
      events,
      "pipeline.stage.updated",
      (event) =>
        event.taskId === task.id &&
        typeof event.data === "object" &&
        event.data &&
        (event.data as Record<string, unknown>).reason === "task.completed",
      120000,
      describeTimeout,
    );

    const { agentStatus, taskStatus } = await waitForCompletedStatus(token, task.id, agentRunId);

    expect(agentStatus.status).toBe("completed");
    expect(taskStatus.status).toBe("completed");
    expect(taskStatus.finishedAt).toBeTruthy();

    if (options.expectResultSync) {
      const {
        taskStatus: finalTaskStatus,
        assistantText,
        resolvedAgentRunId,
      } = await waitForAssistantResult(token, task.id, agentRunId);
      expect(typeof resolvedAgentRunId).toBe("string");
      expect(resolvedAgentRunId.length).toBeGreaterThan(0);
      expect(assistantText.length).toBeGreaterThan(0);
      expect(finalTaskStatus.result).toBe(assistantText);
    }

    if (!options.intervene) {
      expect(events.some((event) => event.type === "agent.paused")).toBe(false);
      expect(events.some((event) => event.type === "agent.resumed")).toBe(false);
      expect(events.some((event) => event.type === "guidance.injected")).toBe(false);
    }

    completed = true;
  } finally {
    ws.close();

    if (agentRunId && !completed) {
      try {
        await request(`/api/agents/${agentRunId}/terminate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best effort cleanup
      }
    }

    await deleteTask(task.id);
  }
}

executionIntegrationTest(
  "task graph injection pushes task.node.updated over websocket",
  async () => {
    const health = await request<{ status: string }>("/health");
    expect(health.status).toBe("ok");

    const token = await login();
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const selectedModel = await getAvailableCopilotModel(token);

    const task = await request<{ id: string }>("/api/tasks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: `task-node-updated-${Date.now()}`,
        projectId: PROJECT_ID,
        prompt:
          "Quick brief reply only. Do not inspect the repository or call tools. Reply with exactly one line: OK.",
        selectedModel,
      }),
    });

    const events: Array<Record<string, unknown>> = [];
    const wsReady = createDeferred<void>();
    const ws = new WebSocket(
      `${BFF_URL.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`,
    );

    let agentRunId = "";
    const completed = false;

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe_task", taskId: task.id, projectId: PROJECT_ID }));
      wsReady.resolve();
    });

    ws.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data)) as Record<string, unknown>;
        events.push(event);
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener("error", (error) => wsReady.reject(error));

    try {
      await wsReady.promise;

      const describeTimeout = () =>
        buildWaitForEventDiagnostics({
          events,
          token,
          taskId: task.id,
          agentRunId: agentRunId || undefined,
        });

      const execution = await request<{ agentRunId: string; sessionId: string }>(
        `/api/tasks/${task.id}/execute`,
        {
          method: "POST",
          headers: authHeaders,
        },
      );
      agentRunId = execution.agentRunId;

      await request<{
        ok: boolean;
        graphId: string;
        workspaceDirectory: string;
        graphPath: string;
      }>("/api/realtime/dev/inject-task-graph-event", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          taskId: task.id,
          projectId: PROJECT_ID,
          sessionId: execution.sessionId,
          graph: {
            status: "running",
            nodes: [
              {
                id: "node-1",
                subject: "Synthetic graph node",
                status: "running",
                agentType: "default-executor",
              },
            ],
            edges: [],
          },
        }),
      });

      await waitForEvent(events, "task.node.updated", (event) => event.taskId === task.id, 30000);
      await waitForEvent(
        events,
        "pipeline.stage.updated",
        (event) =>
          event.taskId === task.id &&
          typeof event.data === "object" &&
          event.data &&
          (event.data as Record<string, unknown>).reason === "task.node.updated",
        30000,
        describeTimeout,
      );
    } finally {
      ws.close();

      if (agentRunId) {
        try {
          await request(`/api/agents/${agentRunId}/terminate`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          // best effort cleanup
        }
      }

      await deleteTask(task.id);
    }
  },
);

executionIntegrationTest("OpenCode completion sync closes pause/guidance/resume flow", async () => {
  await runCompletionSyncScenario({
    titlePrefix: "completion-sync-test",
    prompt:
      "Quick brief reply only. Do not inspect the repository or call tools. First print the word HOLD on 400 separate lines, one HOLD per line, and do not summarize before finishing all 400 lines. If the run is later resumed after a pause, discard any unfinished HOLD output and reply with exactly these 3 bullets and nothing else: - Resumed flow acknowledged. - Final result stored. - Runtime delay observed.",
    intervene: true,
    expectResultSync: true,
  });
});

executionIntegrationTest(
  "OpenCode direct execution completes without pause or resume",
  async () => {
    await runCompletionSyncScenario({
      titlePrefix: "direct-completion-test",
      prompt:
        "Quick brief reply only. Do not inspect the repository or call tools. Reply with exactly these 2 lines and nothing else: Direct completion acknowledged. Runtime delay observed.",
      intervene: false,
      expectResultSync: false,
    });
  },
);

executionIntegrationTest(
  "OpenCode terminate emits stopped event and persists stopped status",
  async () => {
    const health = await request<{ status: string }>("/health");
    expect(health.status).toBe("ok");

    const token = await login();
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const selectedModel = await getAvailableCopilotModel(token);

    const task = await request<{ id: string }>("/api/tasks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: `terminate-regression-${Date.now()}`,
        projectId: PROJECT_ID,
        prompt:
          "Quick brief reply only. Do not inspect the repository or call tools. Print the word HOLD on 200 separate lines and do not summarize.",
        selectedModel,
      }),
    });

    const events: Array<Record<string, unknown>> = [];
    const wsReady = createDeferred<void>();
    const ws = new WebSocket(
      `${BFF_URL.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`,
    );

    let agentRunId = "";

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe_task", taskId: task.id, projectId: PROJECT_ID }));
      wsReady.resolve();
    });

    ws.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data)) as Record<string, unknown>;
        events.push(event);
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener("error", (error) => wsReady.reject(error));

    try {
      await wsReady.promise;

      const execution = await request<{ agentRunId: string }>(`/api/tasks/${task.id}/execute`, {
        method: "POST",
        headers: authHeaders,
      });
      agentRunId = execution.agentRunId;

      const { hasInteractionWindow } = await ensureInteractionWindow({
        token,
        taskId: task.id,
        agentRunId,
        execution,
        actionLabel: "终止",
      });

      if (!hasInteractionWindow) {
        return;
      }

      await waitForEvent(
        events,
        "agent.started",
        (event) => event.agentRunId === agentRunId,
        15000,
      );

      const terminateResult = await request<{ ok: boolean }>(
        `/api/agents/${agentRunId}/terminate`,
        {
          method: "POST",
          headers: authHeaders,
        },
      );
      expect(terminateResult.ok).toBe(true);

      const stoppedEvent = await waitForEvent(
        events,
        "agent.stopped",
        (event) => event.agentRunId === agentRunId,
        15000,
      );
      expect((stoppedEvent.data as Record<string, unknown>)?.reason).toBe("terminated");

      const agentStatus = await waitForStoppedStatus(token, agentRunId);
      expect(agentStatus.status).toBe("stopped");

      const summary = await waitForAgentSummary(token, agentRunId);
      expect(summary.agentRunId).toBe(agentRunId);
      expect(summary.status).toBe("stopped");
      expect(summary.blockerType).toBe("stopped");
      expect(summary.blockerLabel).toBe("已停止待处理");
      expect(summary.finishedAt).toBeTruthy();

      const recentQueue = await waitForQueueContains(token, "recent", agentRunId);
      const queuedRun = recentQueue.data.find((item) => item.agentRunId === agentRunId);
      expect(queuedRun?.status).toBe("stopped");
      expect(queuedRun?.blockerType).toBe("stopped");

      const attentionQueue = await waitForQueueContains(token, "attention", agentRunId);
      const attentionRun = attentionQueue.data.find((item) => item.agentRunId === agentRunId);
      expect(attentionRun?.status).toBe("stopped");
      expect(attentionRun?.blockerType).toBe("stopped");
      expect(attentionRun?.blockerLabel).toBe("已停止待处理");
    } finally {
      ws.close();
      await deleteTask(task.id);
    }
  },
);
