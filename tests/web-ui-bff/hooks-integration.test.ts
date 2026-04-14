import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInternalAuthorization } from "../../control-plane/web-ui-bff/src/lib/control-plane-client";
import { sseAggregator } from "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator";
import { executionIntegrationTest } from "./execution-integration-guard";
import { createLiveExecutionHarness } from "./live-execution-harness";
import {
  buildTaskFailureError,
  runWithTransientUpstreamRetry,
  sleep,
} from "./live-execution-transient";
import { resolveServiceUrl } from "./test-env";

const SERVICE_URL = resolveServiceUrl();

interface ProjectFundSnapshotResponse {
  projectId: string;
  available?: number;
  hasFund?: boolean;
}

const liveHarness = createLiveExecutionHarness({ cleanupLabel: "hooks integration test" });
const {
  bffUrl: BFF_URL,
  projectId: PROJECT_ID,
  request,
  authHeaders,
  getAuthToken,
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
} = liveHarness;

async function serviceRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`, options);
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

async function getAvailableHookCompatibleModel(): Promise<string> {
  return getAvailableCopilotModel();
}

async function ensureProjectFund(minAvailableUsd = 25): Promise<void> {
  const current = await request<ProjectFundSnapshotResponse>(`/api/projects/${PROJECT_ID}/fund`, {
    headers: authHeaders(),
  });

  const available = typeof current.available === "number" ? current.available : 0;
  if (available >= minAvailableUsd) {
    return;
  }

  const topUpUsd = Math.max(minAvailableUsd - available, minAvailableUsd);
  await request(`/api/projects/${PROJECT_ID}/fund/grant`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ amountUsd: topUpUsd, note: "hooks integration test fund top-up" }),
  });
}

async function waitForCostAndAgentAudit(taskId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 120000) {
    const [costDetail, auditResult] = await Promise.all([
      serviceRequest<{
        taskId: string;
        totalCost: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        records: Array<{
          sessionId?: string | null;
          taskId?: string | null;
          cost: number;
        }>;
      }>(`/api/cost/detail?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      }),
      serviceRequest<{
        data: Array<{
          taskId?: string | null;
          action: string;
          eventType: string;
          sessionId?: string | null;
          detail?: Record<string, unknown> | null;
        }>;
      }>(`/api/audit?projectId=${encodeURIComponent(PROJECT_ID)}&type=agent&limit=200`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      }),
    ]);

    const taskAudits = auditResult.data.filter((event) => event.taskId === taskId);

    if (
      costDetail.records.some((record) => record.taskId === taskId) &&
      taskAudits.some((event) => event.action === "completed")
    ) {
      return { costDetail, taskAudits };
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for cost/audit persistence for task ${taskId}`);
}

async function waitForSuccessfulTaskCompletion(
  events: Array<Record<string, unknown>>,
  taskId: string,
  timeoutMs = 60000,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const completed = events.find(
      (event) =>
        event.type === "task.completed" &&
        event.taskId === taskId &&
        typeof event.data === "object" &&
        event.data &&
        (event.data as Record<string, unknown>).status === "completed",
    );
    if (completed) {
      return completed;
    }

    const failed = events.find((event) => {
      if (event.taskId !== taskId || typeof event.data !== "object" || !event.data) {
        return false;
      }

      const status = (event.data as Record<string, unknown>).status;
      return event.type === "task.failed" || (event.type === "task.completed" && status === "failed");
    });
    if (failed) {
      const error =
        typeof (failed.data as Record<string, unknown>).error === "string"
          ? (failed.data as Record<string, unknown>).error
          : "unknown error";
      throw buildTaskFailureError(
        taskId,
        "Task failed before post-execution hooks completed",
        error,
      );
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for successful completion of task ${taskId}`);
}

async function subscribeTaskEvents(taskId: string) {
  const events: Array<Record<string, unknown>> = [];
  let resolveOpen: (() => void) | undefined;
  let rejectOpen: ((reason?: unknown) => void) | undefined;
  const opened = new Promise<void>((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });

  const ws = new WebSocket(
    `${BFF_URL.replace("http", "ws")}/ws?token=${encodeURIComponent(getAuthToken())}`,
  );

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "subscribe_task", taskId, projectId: PROJECT_ID }));
    resolveOpen?.();
  });

  ws.addEventListener("message", (message) => {
    try {
      events.push(JSON.parse(String(message.data)) as Record<string, unknown>);
    } catch {
      // Ignore malformed frames.
    }
  });

  ws.addEventListener("error", (error) => rejectOpen?.(error));

  await opened;

  return {
    events,
    close() {
      ws.close();
    },
  };
}

beforeAll(async () => {
  await initialize();
});

afterAll(async () => {
  await cleanup();
});

describe("lifecycle hooks integration", () => {
  executionIntegrationTest(
    "persists pre-execution hook result after saving orchestration strategy",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        const executionModel = await getAvailableHookCompatibleModel();
        const hookModel = executionModel;

        try {
          await ensureProjectFund();
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
                model: hookModel,
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

          const completed = await runWithTransientUpstreamRetry({
            label: "persists pre-execution hook result after saving orchestration strategy",
            scope: "hooks-integration",
            async fn() {
              let agentRunId: string | undefined;

              try {
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
                      currentStrategy.hookExecutions?.some(
                        (hook) => hook.trigger === "pre-execution",
                      ),
                    ) && currentTask.status !== "pending",
                  30000,
                  { failOnTaskFailure: true },
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
              }
            },
          });

          if (!completed) {
            return;
          }
        } finally {
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
        const executionModel = await getAvailableHookCompatibleModel();
        const hookModel = executionModel;
        const events: Array<Record<string, unknown>> = [];
        const unsubscribe = sseAggregator.onEvent((event) => {
          events.push(event as unknown as Record<string, unknown>);
        });

        try {
          await ensureProjectFund();
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
                model: hookModel,
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

          const completed = await runWithTransientUpstreamRetry({
            label: "persists post-execution hook result and emits hooks refresh event after strategy save",
            scope: "hooks-integration",
            async fn() {
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
              await serviceRequest(`/api/tasks/${encodeURIComponent(taskId)}`, {
                method: "PATCH",
                headers: {
                  Authorization: authorization,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  status: "completed",
                  result: resultText,
                }),
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
                    currentStrategy.hookExecutions?.some(
                      (hook) => hook.trigger === "post-execution",
                    ),
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
            },
          });

          if (!completed) {
            return;
          }
        } finally {
          unsubscribe();
          await updateOrchestrationStrategy(originalStrategy);
        }
      });
    },
  );

  executionIntegrationTest(
    "pushes task.hooks.updated to websocket clients after real completion",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        const executionModel = await getAvailableHookCompatibleModel();
        const hookModel = executionModel;
        let subscription:
          | {
              events: Array<Record<string, unknown>>;
              close: () => void;
            }
          | undefined;

        try {
          await ensureProjectFund();
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
                id: "post-execution-ws-test",
                trigger: "post-execution",
                enabled: true,
                agent: "default-executor",
                model: hookModel,
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

          const completed = await runWithTransientUpstreamRetry({
            label: "pushes task.hooks.updated to websocket clients after real completion",
            scope: "hooks-integration",
            async fn() {
              const taskId = await createTask(
                `post-eval-ws-${Date.now()}`,
                "Quick brief reply only. Do not inspect the repository or call tools. Reply with exactly one line: OK.",
                {
                  selectedModel: executionModel,
                },
              );
              subscription = await subscribeTaskEvents(taskId);

              try {
                await executeTask(taskId);

                await waitForSuccessfulTaskCompletion(subscription.events, taskId, 120000);
                await waitForEvent(
                  subscription.events,
                  "task.hooks.updated",
                  (event) => event.taskId === taskId,
                  120000,
                );
                await waitForEvent(
                  subscription.events,
                  "pipeline.stage.updated",
                  (event) =>
                    event.taskId === taskId &&
                    typeof event.data === "object" &&
                    event.data &&
                    (event.data as Record<string, unknown>).reason === "task.hooks.updated",
                  120000,
                );
              } finally {
                subscription?.close();
                subscription = undefined;
              }
            },
          });

          if (!completed) {
            return;
          }
        } finally {
          subscription?.close();
          await updateOrchestrationStrategy(originalStrategy);
        }
      });
    },
  );

  executionIntegrationTest(
    "persists costRecords and agent audits for real test-model hook execution",
    async () => {
      await withStrategyLock(async () => {
        const originalStrategy = await getOrchestrationStrategy();
        const executionModel = await getAvailableHookCompatibleModel();

        try {
          await ensureProjectFund();
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
                id: "pre-execution-cost-test",
                trigger: "pre-execution",
                enabled: true,
                agent: "default-executor",
                model: executionModel,
                timeoutMs: 15000,
                promptTemplate: [
                  "Pre-execution reviewer for Opener-X task.",
                  "Task title: {{taskTitle}}",
                  "Task prompt:",
                  "{{taskPrompt}}",
                ].join("\n"),
                order: 0,
              },
              {
                id: "post-execution-cost-test",
                trigger: "post-execution",
                enabled: true,
                agent: "default-executor",
                model: executionModel,
                timeoutMs: 15000,
                promptTemplate: [
                  "Post-execution reviewer for Opener-X task.",
                  "Task title: {{taskTitle}}",
                  "Execution result:",
                  "{{taskResult}}",
                ].join("\n"),
                order: 1,
              },
            ],
          });

          const completed = await runWithTransientUpstreamRetry({
            label: "persists costRecords and agent audits for real test-model hook execution",
            scope: "hooks-integration",
            async fn() {
              const taskId = await createTask(
                `hook-cost-audit-${Date.now()}`,
                "Quick brief reply only. Do not inspect the repository or call tools. Reply with exactly one line: OK.",
                {
                  selectedModel: executionModel,
                },
              );
              await executeTask(taskId);

              const { strategy } = await waitForTaskStrategy(
                taskId,
                (currentStrategy, task) => {
                  const hookExecutions = currentStrategy.hookExecutions || [];
                  const hasPre = hookExecutions.some((hook) => hook.trigger === "pre-execution");
                  const hasPost = hookExecutions.some(
                    (hook) => hook.trigger === "post-execution",
                  );
                  return task.status === "completed" && hasPre && hasPost;
                },
                180000,
                { failOnTaskFailure: true },
              );

              const preExecution = strategy.hookExecutions?.find(
                (hook) => hook.trigger === "pre-execution",
              );
              const postExecution = strategy.hookExecutions?.find(
                (hook) => hook.trigger === "post-execution",
              );
              expect(preExecution?.completedAt).toBeTruthy();
              expect(postExecution?.completedAt).toBeTruthy();

              const { costDetail, taskAudits } = await waitForCostAndAgentAudit(taskId);

              expect(costDetail.records.some((record) => record.taskId === taskId)).toBe(true);
              expect(taskAudits.some((event) => event.action === "completed")).toBe(true);
            },
          });

          if (!completed) {
            return;
          }
        } finally {
          await updateOrchestrationStrategy(originalStrategy);
        }
      });
    },
  );
});
