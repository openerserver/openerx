import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cpFetch,
  createInternalAuthorization,
} from "../../control-plane/web-ui-bff/src/lib/control-plane-client";
import { sseAggregator } from "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BFF_URL = process.env.TEST_BFF_URL || "http://127.0.0.1:4098";
const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123!";
const PROJECT_ID = process.env.TEST_PROJECT_ID || "proj-default";
const DB_PATH =
  process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db");
const executionIntegrationTest = process.env.RUN_EXECUTION_INTEGRATION === "1" ? test : test.skip;

interface WorkflowEvaluationHook {
  enabled: boolean;
  agent: string;
  model: string;
  promptTemplate: string;
  timeoutMs: number;
}

interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  preExecutionReview: WorkflowEvaluationHook;
  postExecutionReview: WorkflowEvaluationHook;
}

interface WorkflowEvaluationRecord {
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
  workflowEvaluations?: {
    preExecution?: WorkflowEvaluationRecord;
    postExecution?: WorkflowEvaluationRecord;
  };
}

interface TaskRecord {
  id: string;
  status: string;
  agentRunId?: string | null;
  strategy?: string | null;
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

function parseTaskStrategy(strategyRaw?: string | null): TaskStrategyPayload {
  if (!strategyRaw) {
    return {};
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

async function createTask(title: string, prompt: string): Promise<string> {
  const response = await request<{ id: string }>("/api/tasks", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      title,
      projectId: PROJECT_ID,
      prompt,
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

  throw new Error(`Timed out waiting for workflow evaluation on task ${taskId}`);
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

  const { execSync } = await import("node:child_process");
  const statements = createdTaskIds.map((id) => `DELETE FROM tasks WHERE id='${id}';`);
  try {
    execSync(`sqlite3 "${DB_PATH}" "${statements.join(" ")}"`, { timeout: 5000 });
  } catch {
    console.warn("Cleanup failed for workflow-evaluation.test.ts");
  }
});

describe("workflow evaluations", () => {
  executionIntegrationTest(
    "persists pre-execution evaluation after saving orchestration strategy",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        let agentRunId: string | undefined;

        try {
          await updateOrchestrationStrategy({
            ...originalStrategy,
            categoryAgentMap: Object.fromEntries(
              Object.keys(originalStrategy.categoryAgentMap).map((key) => [key, ["build"]]),
            ),
            preExecutionReview: {
              enabled: true,
              agent: "build",
              model: "",
              timeoutMs: 15000,
              promptTemplate: [
                "Pre-flight reviewer for OpenerX task.",
                "Task title: {{taskTitle}}",
                "Task prompt:",
                "{{taskPrompt}}",
              ].join("\n"),
            },
            postExecutionReview: {
              ...originalStrategy.postExecutionReview,
              enabled: false,
            },
          });

          const taskTitle = `pre-eval-${Date.now()}`;
          const taskPrompt =
            "Inspect the repository briefly and respond with one concise status line.";
          const taskId = await createTask(taskTitle, taskPrompt);
          const execution = await executeTask(taskId);
          agentRunId = execution.agentRunId;

          const { task, strategy } = await waitForTaskStrategy(
            taskId,
            (currentStrategy, currentTask) =>
              Boolean(currentStrategy.workflowEvaluations?.preExecution) &&
              currentTask.status !== "pending",
          );

          expect(task.status).not.toBe("pending");
          expect(strategy.selectedAgent).toBeTruthy();
          expect(strategy.workflowEvaluations?.preExecution).toBeTruthy();
          expect(strategy.workflowEvaluations?.preExecution?.agent).toBe("build");
          expect(strategy.workflowEvaluations?.preExecution?.prompt).toContain(taskTitle);
          expect(strategy.workflowEvaluations?.preExecution?.prompt).toContain("Task title:");
          expect(strategy.workflowEvaluations?.preExecution?.prompt).toContain(taskPrompt);
          expect(strategy.workflowEvaluations?.preExecution?.completedAt).toBeTruthy();
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
    "persists post-execution evaluation and emits refresh event after strategy save",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        const events: Array<Record<string, unknown>> = [];
        const unsubscribe = sseAggregator.onEvent((event) => {
          events.push(event as unknown as Record<string, unknown>);
        });

        try {
          await updateOrchestrationStrategy({
            ...originalStrategy,
            categoryAgentMap: Object.fromEntries(
              Object.keys(originalStrategy.categoryAgentMap).map((key) => [key, ["build"]]),
            ),
            preExecutionReview: {
              ...originalStrategy.preExecutionReview,
              enabled: false,
            },
            postExecutionReview: {
              enabled: true,
              agent: "build",
              model: "",
              timeoutMs: 15000,
              promptTemplate: [
                "Post-execution reviewer for OpenerX task.",
                "Task title: {{taskTitle}}",
                "Execution result:",
                "{{taskResult}}",
              ].join("\n"),
            },
          });

          const taskId = await createTask(
            `post-eval-${Date.now()}`,
            "Reply with exactly one line: OK.",
          );
          await executeTask(taskId);

          const authorization = await createInternalAuthorization();
          const resultText = "OK.";
          await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            authorization,
            body: {
              status: "completed",
              result: resultText,
            },
          });

          await (
            sseAggregator as unknown as {
              triggerPostExecutionReview: (
                taskId: string,
                resultText: string,
                authorization: string,
              ) => Promise<void>;
            }
          ).triggerPostExecutionReview(taskId, resultText, authorization);

          const evaluationUpdatedEvent = await waitForEvent(
            events,
            "task.workflow-evaluation.updated",
            (event) => event.taskId === taskId,
            20000,
          );

          expect(evaluationUpdatedEvent.data).toMatchObject({
            phase: "postExecution",
            agent: "build",
          });

          const { strategy } = await waitForTaskStrategy(
            taskId,
            (currentStrategy) => Boolean(currentStrategy.workflowEvaluations?.postExecution),
            20000,
          );

          expect(strategy.workflowEvaluations?.postExecution).toBeTruthy();
          expect(strategy.workflowEvaluations?.postExecution?.agent).toBe("build");
          expect(strategy.workflowEvaluations?.postExecution?.prompt).toContain("Task title:");
          expect(strategy.workflowEvaluations?.postExecution?.prompt).toContain(
            "Execution result:",
          );
          expect(strategy.workflowEvaluations?.postExecution?.completedAt).toBeTruthy();
        } finally {
          unsubscribe();
          await updateOrchestrationStrategy(originalStrategy);
        }
      });
    },
  );
});
