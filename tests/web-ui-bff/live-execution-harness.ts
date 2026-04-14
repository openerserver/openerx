import { resolveExecutionIntegrationModel } from "./execution-integration-guard";
import { buildTaskFailureError, sleep } from "./live-execution-transient";
import { buildTaskCleanupStatements, resolveBffUrl, runCleanupStatements } from "./test-env";

const BFF_URL = resolveBffUrl();
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";

export interface LifecycleHook {
  id: string;
  trigger: "pre-execution" | "post-execution" | "on-failure" | "pre-resume";
  enabled: boolean;
  agent: string;
  model?: string;
  promptTemplate: string;
  timeoutMs: number;
  order: number;
}

export interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  hooks: LifecycleHook[];
}

export interface HookExecutionSnapshot {
  status: string;
  agent: string;
  model?: string;
  prompt: string;
  result?: string;
  error?: string;
  sessionId?: string;
  completedAt: string;
}

export interface TaskStrategyPayload {
  selectedAgent?: string;
  effectiveModel?: string;
  paidExecutionGuard?: Record<string, unknown>;
  hookExecutions?: Array<HookExecutionSnapshot & { hookId: string; trigger: string }>;
}

export interface TaskRecord {
  id: string;
  status: string;
  agentRunId?: string | null;
  result?: string | null;
  strategy?: string | Record<string, unknown> | null;
}

interface ConfigModelRecord {
  id?: string;
  provider?: string;
}

interface WaitForTaskStrategyOptions {
  failOnTaskFailure?: boolean;
  failureContext?: string;
}

export function createLiveExecutionHarness(args: { cleanupLabel: string }) {
  const createdTaskIds: string[] = [];
  let token = "";
  let strategyQueue = Promise.resolve();

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

  function authHeaders() {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  function getAuthToken(): string {
    if (!token) {
      throw new Error("Live execution harness token not initialized");
    }

    return token;
  }

  function parseTaskStrategy(
    strategyRaw?: string | Record<string, unknown> | null,
  ): TaskStrategyPayload {
    if (!strategyRaw) {
      return {};
    }

    if (typeof strategyRaw === "object") {
      return strategyRaw as TaskStrategyPayload;
    }

    try {
      return JSON.parse(strategyRaw) as TaskStrategyPayload;
    } catch {
      return {};
    }
  }

  async function getOrchestrationStrategy(): Promise<OrchestrationStrategy> {
    const response = await request<{ data: OrchestrationStrategy }>(
      "/api/config/orchestration-strategy",
      {
        headers: authHeaders(),
      },
    );
    return response.data;
  }

  async function updateOrchestrationStrategy(strategy: OrchestrationStrategy): Promise<void> {
    await request<{ ok: boolean }>("/api/config/orchestration-strategy", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(strategy),
    });
  }

  async function createTask(
    title: string,
    prompt: string,
    options?: { selectedModel?: string },
  ): Promise<string> {
    const response = await request<{ id: string }>("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        title,
        projectId: PROJECT_ID,
        prompt,
        ...(options?.selectedModel ? { selectedModel: options.selectedModel } : {}),
      }),
    });
    createdTaskIds.push(response.id);
    return response.id;
  }

  async function executeTask(taskId: string): Promise<{ agentRunId: string; sessionId: string }> {
    return request<{ agentRunId: string; sessionId: string }>(`/api/tasks/${taskId}/execute`, {
      method: "POST",
      headers: authHeaders(),
    });
  }

  async function getTask(taskId: string): Promise<TaskRecord> {
    return request<TaskRecord>(`/api/tasks/${taskId}`, {
      headers: authHeaders(),
    });
  }

  async function getAvailableCopilotModel(): Promise<string> {
    const [modelList, testPolicy] = await Promise.all([
      request<{ data?: ConfigModelRecord[] }>("/api/config/models/list", {
        headers: authHeaders(),
      }),
      request<{ data?: { effectiveModel?: string | null } }>("/api/config/models/test-policy", {
        headers: authHeaders(),
      }),
    ]);

    return resolveExecutionIntegrationModel(modelList.data || [], testPolicy.data?.effectiveModel);
  }

  async function terminateAgent(agentRunId: string): Promise<void> {
    await request(`/api/agents/${agentRunId}/terminate`, {
      method: "POST",
      headers: authHeaders(),
    });
  }

  async function waitForTaskStrategy(
    taskId: string,
    predicate: (strategy: TaskStrategyPayload, task: TaskRecord) => boolean,
    timeoutMs = 30000,
    options?: WaitForTaskStrategyOptions,
  ): Promise<{ task: TaskRecord; strategy: TaskStrategyPayload }> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const task = await getTask(taskId);
      const strategy = parseTaskStrategy(task.strategy);
      if (predicate(strategy, task)) {
        return { task, strategy };
      }
      if (options?.failOnTaskFailure && task.status === "failed") {
        const detail =
          typeof task.result === "string" && task.result.length > 0
            ? task.result
            : "task failed before expected hook state was observed";
        throw buildTaskFailureError(
          taskId,
          options.failureContext || "Task failed while waiting for hook state",
          detail,
        );
      }
      await sleep(250);
    }

    throw new Error(`Timed out waiting for hook execution on task ${taskId}`);
  }

  async function waitForEvent(
    events: Array<Record<string, unknown>>,
    type: string,
    predicate: (event: Record<string, unknown>) => boolean = () => true,
    timeoutMs = 60000,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const match = events.find((event) => event.type === type && predicate(event));
      if (match) {
        return match;
      }
      await sleep(250);
    }

    throw new Error(`Timed out waiting for event ${type}`);
  }

  async function withStrategyLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = strategyQueue;
    let release: (() => void) | undefined;
    strategyQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release?.();
    }
  }

  async function initialize(): Promise<void> {
    token = await login();
  }

  async function cleanup(): Promise<void> {
    if (createdTaskIds.length === 0) {
      return;
    }

    await runCleanupStatements(buildTaskCleanupStatements(createdTaskIds), args.cleanupLabel);
  }

  return {
    bffUrl: BFF_URL,
    projectId: PROJECT_ID,
    request,
    authHeaders,
    getAuthToken,
    parseTaskStrategy,
    getOrchestrationStrategy,
    updateOrchestrationStrategy,
    createTask,
    executeTask,
    getTask,
    getAvailableCopilotModel,
    terminateAgent,
    waitForTaskStrategy,
    waitForEvent,
    withStrategyLock,
    initialize,
    cleanup,
  };
}