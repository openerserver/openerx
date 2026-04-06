import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpFetch,
  createInternalAuthorization,
} from "../../control-plane/web-ui-bff/src/lib/control-plane-client";
import { sseAggregator } from "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator";
import {
  paidExecutionIntegrationTest,
  resolveExecutionIntegrationModel,
} from "./execution-integration-guard";
import { buildTaskCleanupStatements, resolveBffUrl, runCleanupStatements } from "./test-env";

const BFF_URL = resolveBffUrl();
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const executionIntegrationTest = paidExecutionIntegrationTest;

interface HookConfig {
  enabled: boolean;
  agent: string;
  model: string;
  promptTemplate: string;
  timeoutMs: number;
}

interface LifecycleHook {
  id: string;
  trigger: "pre-execution" | "post-execution" | "on-failure" | "pre-resume";
  enabled: boolean;
  agent: string;
  model?: string;
  promptTemplate: string;
  timeoutMs: number;
  order: number;
}

interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  hooks: LifecycleHook[];
}

interface HookExecutionSnapshot {
  status: string;
  agent: string;
  model?: string;
  prompt: string;
  result?: string;
  error?: string;
  sessionId?: string;
  completedAt: string;
}

interface TaskStrategyPayload {
  selectedAgent?: string;
  effectiveModel?: string;
  paidExecutionGuard?: Record<string, unknown>;
  hookExecutions?: Array<HookExecutionSnapshot & { hookId: string; trigger: string }>;
}

interface TaskRecord {
  id: string;
  status: string;
  agentRunId?: string | null;
  strategy?: string | Record<string, unknown> | null;
}

interface ConfigModelRecord {
  id?: string;
  provider?: string;
}

const createdTaskIds: string[] = [];
let token = "";
let strategyQueue = Promise.resolve();

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

function authHeaders() {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
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
): Promise<{ task: TaskRecord; strategy: TaskStrategyPayload }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = await getTask(taskId);
    const strategy = parseTaskStrategy(task.strategy);
    if (predicate(strategy, task)) {
      return { task, strategy };
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

beforeAll(async () => {
  token = await login();
});

afterAll(async () => {
  if (createdTaskIds.length === 0) {
    return;
  }

  await runCleanupStatements(
    buildTaskCleanupStatements(createdTaskIds),
    "workflow evaluation integration test",
  );
});

describe("lifecycle hooks integration", () => {
  executionIntegrationTest(
    "persists pre-execution hook result after saving orchestration strategy",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        let agentRunId: string | undefined;
        const executionModel = await getAvailableCopilotModel();

        try {
          await updateOrchestrationStrategy({
            ...originalStrategy,
            categoryAgentMap: Object.fromEntries(
              Object.keys(originalStrategy.categoryAgentMap).map((key) => [
                key,
                ["default-executor"],
              ]),
            ),
            hooks: [
              {
                id: "pre-execution-test",
                trigger: "pre-execution",
                enabled: true,
                agent: "default-executor",
                model: "",
                timeoutMs: 15000,
                promptTemplate: [
                  "Pre-flight reviewer for Opener-X task.",
                  "Task title: {{taskTitle}}",
                  "Task prompt:",
                  "{{taskPrompt}}",
                ].join("\n"),
                order: 0,
              },
            ],
          });

          const taskTitle = `pre-eval-${Date.now()}`;
          const taskPrompt =
            "Inspect the repository briefly and respond with one concise status line.";
          const taskId = await createTask(taskTitle, taskPrompt, {
            selectedModel: executionModel,
          });
          const execution = await executeTask(taskId);
          agentRunId = execution.agentRunId;

          const { task, strategy } = await waitForTaskStrategy(
            taskId,
            (currentStrategy, currentTask) =>
              Boolean(
                currentStrategy.hookExecutions?.some((hook) => hook.trigger === "pre-execution"),
              ) && currentTask.status !== "pending",
          );

          expect(task.status).not.toBe("pending");
          expect(strategy.selectedAgent).toBeTruthy();
          const preExecution = strategy.hookExecutions?.find(
            (hook) => hook.trigger === "pre-execution",
          );
          expect(preExecution).toBeTruthy();
          expect(preExecution?.agent).toBe("default-executor");
          expect(preExecution?.prompt).toContain(taskTitle);
          expect(preExecution?.prompt).toContain("Task title:");
          expect(preExecution?.prompt).toContain(taskPrompt);
          expect(preExecution?.completedAt).toBeTruthy();
        } finally {
          if (agentRunId) {
            await terminateAgent(agentRunId).catch(() => undefined);
          }
          await updateOrchestrationStrategy(originalStrategy);
        }
      });
    },
  );

  executionIntegrationTest(
    "persists post-execution hook result and emits hooks refresh event after strategy save",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        const events: Array<Record<string, unknown>> = [];
        const executionModel = await getAvailableCopilotModel();
        const unsubscribe = sseAggregator.onEvent((event) => {
          events.push(event as unknown as Record<string, unknown>);
        });

        try {
          await updateOrchestrationStrategy({
            ...originalStrategy,
            categoryAgentMap: Object.fromEntries(
              Object.keys(originalStrategy.categoryAgentMap).map((key) => [
                key,
                ["default-executor"],
              ]),
            ),
            hooks: [
              {
                id: "post-execution-test",
                trigger: "post-execution",
                enabled: true,
                agent: "default-executor",
                model: "",
                timeoutMs: 15000,
                promptTemplate: [
                  "Post-execution reviewer for Opener-X task.",
                  "Task title: {{taskTitle}}",
                  "Execution result:",
                  "{{taskResult}}",
                ].join("\n"),
                order: 0,
              },
            ],
          });

          const taskId = await createTask(
            `post-eval-${Date.now()}`,
            "Reply with exactly one line: OK.",
            {
              selectedModel: executionModel,
            },
          );
          await executeTask(taskId);

          const authorization = await createInternalAuthorization();
          const resultText = "OK.";
          const latestTask = await getTask(taskId);
          const latestStrategy = parseTaskStrategy(latestTask.strategy);
          const paidExecutionGuard =
            latestStrategy.paidExecutionGuard &&
            typeof latestStrategy.paidExecutionGuard === "object"
              ? latestStrategy.paidExecutionGuard
              : {};

          await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            authorization,
            body: {
              status: "completed",
              result: resultText,
              strategy: JSON.stringify({
                ...latestStrategy,
                paidExecutionGuard: {
                  ...paidExecutionGuard,
                  postHooksDisabled: false,
                },
              }),
            },
          });

          await (
            sseAggregator as unknown as {
              triggerPostExecutionHooks: (
                taskId: string,
                resultText: string,
                authorization: string,
              ) => Promise<void>;
            }
          ).triggerPostExecutionHooks(taskId, resultText, authorization);

          const hooksUpdatedEvent = await waitForEvent(
            events,
            "task.hooks.updated",
            (event) => event.taskId === taskId,
            20000,
          );

          expect(hooksUpdatedEvent.data).toMatchObject({
            phase: "postExecution",
            agent: "default-executor",
          });

          const { strategy } = await waitForTaskStrategy(
            taskId,
            (currentStrategy) =>
              Boolean(
                currentStrategy.hookExecutions?.some((hook) => hook.trigger === "post-execution"),
              ),
            20000,
          );

          const postExecution = strategy.hookExecutions?.find(
            (hook) => hook.trigger === "post-execution",
          );
          expect(postExecution).toBeTruthy();
          expect(postExecution?.agent).toBe("default-executor");
          expect(postExecution?.prompt).toContain("Task title:");
          expect(postExecution?.prompt).toContain("Execution result:");
          expect(postExecution?.completedAt).toBeTruthy();
        } finally {
          unsubscribe();
          await updateOrchestrationStrategy(originalStrategy);
        }
      });
    },
  );
});
