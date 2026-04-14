import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpFetch,
  createInternalAuthorization,
} from "../../control-plane/web-ui-bff/src/lib/control-plane-client";
import { sseAggregator } from "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator";
import { executionIntegrationTest } from "./execution-integration-guard";
import { createLiveExecutionHarness } from "./live-execution-harness";
import { runWithTransientUpstreamRetry } from "./live-execution-transient";

const liveHarness = createLiveExecutionHarness({ cleanupLabel: "workflow evaluation integration test" });
const {
  request,
  authHeaders,
  parseTaskStrategy,
  getOrchestrationStrategy,
  updateOrchestrationStrategy,
  createTask,
  getAvailableCopilotModel,
  executeTask,
  getTask,
  terminateAgent,
  waitForTaskStrategy,
  waitForEvent,
  withStrategyLock,
  initialize,
  cleanup,
} = liveHarness;

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

          const completed = await runWithTransientUpstreamRetry({
            label: "persists pre-execution hook result after saving orchestration strategy",
            scope: "workflow-evaluation",
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

          const completed = await runWithTransientUpstreamRetry({
            label: "persists post-execution hook result and emits hooks refresh event after strategy save",
            scope: "workflow-evaluation",
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
});
