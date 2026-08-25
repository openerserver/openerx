/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  expectNoLegacyTimelineReadSource,
  expectNoPromptBackfillSegment,
  expectServiceTimelineNotRequested,
} from "./execution-trace-contract-test-helpers";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const setControlPlaneFetchHandlerMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const buildWorkflowExecutionPromptSnapshotMock = mock(async () => ({
  workflowStatus: "running",
  currentStageKey: "implement",
  currentStageLabel: "实现",
  currentStageStatus: "running",
  currentStageExitCriteria: ["输出实现结果"],
  completedStageOutputs: [],
  pendingStageLabels: ["验证"],
}));
const buildTaskWorkflowViewModelMock = mock(async () => ({
  workflow: {
    status: "running",
    currentStage: "implement",
    stages: [
      {
        stageKey: "implement",
        stageLabel: "实现",
        status: "running",
      },
    ],
  },
  roleConclusions: [],
  developerChangeRequests: [],
}));

function aliasExecutionTraceMockUrl(url: string) {
  const projectionMatch = url.match(/^\/api\/tasks\/([^/]+)\/timeline-view\?(.*)$/);
  if (projectionMatch) {
    const params = new URLSearchParams(projectionMatch[2] ?? "");
    const runtimeSessionId = params.get("runtimeSessionId");
    if (runtimeSessionId) {
      throw new Error(
        `Deprecated runtimeSessionId query used for projection timeline fetch: ${runtimeSessionId}`,
      );
    }
  }

  const branchMatch = url.match(
    /^\/api\/tasks\/([^/]+)\/branches\/([^/]+)\/timeline(\?includeLineage=true)?$/,
  );
  if (branchMatch) {
    const taskIdEncoded = branchMatch[1] ?? "";
    const runtimeSessionId = decodeURIComponent(branchMatch[2] ?? "");
    const taskId = decodeURIComponent(taskIdEncoded);
    const includeLineageSuffix = branchMatch[3] ?? "";
    return `/api/tasks/${taskIdEncoded}/sessions/${encodeURIComponent(`task-session:${taskId}:${runtimeSessionId}`)}/timeline${includeLineageSuffix}`;
  }

  return url;
}

function withTraceRouteAliases<T>(handler: (url: string) => Promise<T>) {
  return async (url: string) => handler(aliasExecutionTraceMockUrl(url));
}

function setTraceFetchImplementation<T>(handler: (url: string) => Promise<T>) {
  cpFetchMock.mockImplementation(withTraceRouteAliases(handler));
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/intent-classifier", () => ({
  classifyIntent: mock(() => ({ category: "implementation" })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  diagnoseModelReadiness: mock(() => ({ ready: true })),
  formatModelRoute: mock(() => "github-copilot:gpt-5.4"),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  readOpencodeJson: mock(() => ({ models: { list: [] } })),
  resolveModelRoute: mock(() => ({ providerId: "github-copilot", modelId: "gpt-5.4" })),
  validateModelProvider: mock(() => true),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-runtime", () => ({
  recordPaidExecutionRuntimeUsage: mock(async () => undefined),
  releasePaidExecutionReservation: mock(async () => ({ ok: true, releasedUsd: 0 })),
}));

const runtimeProviderModule = createRuntimeProviderModuleMock({
  continueSession: mock(async () => ({ ok: true })),
  createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
  ensureAgentRunForSession: mock(() => "run-1"),
  extractAssistantResultFromMessages: mock(() => ({
    completed: false,
    failed: false,
    error: undefined,
    tokenUsed: 0,
  })),
  forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: mock(() => undefined),
  getSessionMessages: getSessionMessagesMock,
  injectGuidance: mock(async () => ({ ok: true })),
  listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
  listAgentRuns: mock(() => []),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  recoverAgentRun: mock(() => undefined),
  registerAgentRun: mock(() => undefined),
  replyRuntimePermission: mock(async () => ({ ok: true })),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider",
  () => runtimeProviderModule,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  patchAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  mergeStageAndStrategyHooks: mock(() => []),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () =>
  createSseAggregatorModuleMock({
    registerParallelTask: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/reconcile", () => ({
  repairTaskMessagesFromRuntime: mock(async () => ({
    scope: "task",
    lineageResolved: true,
    scannedSessions: 0,
    repairedSessions: 0,
    failedSessions: 0,
    skippedSessions: 0,
    scannedMessages: 0,
    repairableMessages: 0,
    repairedMessages: 0,
    failedMessages: 0,
    repaired: false,
    totalMessages: 0,
    userMessages: 0,
    assistantMessages: 0,
  })),
  reconcileRunningTasksOnStartup: mock(async () => ({
    scanned: 0,
    completed: 0,
    failed: 0,
    recovered: 0,
    skipped: 0,
    runtimeAvailable: true,
    affectedTasks: [],
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  buildStageArtifactSummary: mock(() => null),
  buildWorkflowExecutionPromptSnapshot: buildWorkflowExecutionPromptSnapshotMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  getSessionMessagesMock.mockReset();
  buildWorkflowExecutionPromptSnapshotMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  buildWorkflowExecutionPromptSnapshotMock.mockResolvedValue({
    workflowStatus: "running",
    currentStageKey: "implement",
    currentStageLabel: "实现",
    currentStageStatus: "running",
    currentStageExitCriteria: ["输出实现结果"],
    completedStageOutputs: [],
    pendingStageLabels: ["验证"],
  });

  setTraceFetchImplementation(async (url: string) => {
    if (url === "/api/project-tree/tasks/task-1") {
      return {
        ok: true,
        data: {
          id: "task-1",
          projectId: "proj-1",
          title: "trace task",
          prompt: "第一轮用户输入",
          status: "running",
          sessionId: "ses-1",
          selectedModel: "github-copilot:gpt-5.4",
          strategy: JSON.stringify({
            selectedAgent: "oracle-enterprise",
            hookExecutions: [],
          }),
        },
      };
    }
    if (url === "/api/tasks/task-1/snapshot") {
      return {
        ok: true,
        data: {
          data: null,
          meta: {
            readSource: "task-session-projection",
            complete: false,
          },
        },
      };
    }
    if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
      return {
        ok: true,
        data: {
          data: [],
          meta: {
            readSource: "task-session-projection",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }
    if (
      url ===
      "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1&includeLineage=false"
    ) {
      return {
        ok: true,
        data: {
          data: [],
          meta: {
            readSource: "task-session-projection",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }
    if (
      url ===
      "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
    ) {
      return {
        ok: true,
        data: {
          data: [],
          meta: {
            cacheState: "partial",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }
    return { ok: true, data: {} };
  });

  getSessionMessagesMock.mockResolvedValue({
    ok: true,
    data: [
      {
        info: {
          id: "msg-1",
          role: "user",
          time: { created: Date.parse("2026-03-19T10:00:00.000Z") },
        },
        parts: [
          {
            type: "text",
            text: [
              "Execution context:",
              "",
              "Opener-X task ID: task-1",
              "Project ID: proj-1",
              "当前执行上下文",
              "任务：trace task",
              "请只完成当前阶段的目标。",
              "完成后请输出本阶段产出摘要。",
              "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
              "",
              "第二轮用户输入",
            ].join("\n"),
          },
        ],
      },
      {
        info: {
          id: "msg-4",
          role: "assistant",
          time: { created: Date.parse("2026-03-19T10:01:08.000Z") },
        },
        parts: [{ type: "text", text: "第二轮模型回复" }],
      },
    ],
  });
});

describe("task execution trace route", () => {
  test("prefers task-domain projection timeline and snapshot when available", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "投影回复",
              latestResultSummary: "投影回复",
              activeCandidateCount: 0,
              completedCandidateCount: 1,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: true,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                displayText: "投影用户输入",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "projection-assistant-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-assistant-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "assistant-output",
                itemRole: "assistant",
                displayText: "投影回复",
                sortAt: "2026-03-22T10:00:03.000Z",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
              {
                id: "projection-tool-1",
                taskId: "task-1",
                projectId: "proj-1",
                runNodeId: "run-node-tool-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "tool-call",
                itemRole: "tool",
                title: "工具调用 search_code",
                displayText: "fallback tool summary",
                metadataJson: {
                  toolName: "search_code",
                  argumentsSummary:
                    "query: task domain projections | includePattern: control-plane/service/src/modules/tasks/**",
                  status: "completed",
                },
                sortAt: "2026-03-22T10:00:04.000Z",
                createdAt: "2026-03-22T10:00:04.000Z",
              },
              {
                id: "projection-judge-1",
                taskId: "task-1",
                projectId: "proj-1",
                runNodeId: "run-node-judge-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "judge-decision",
                itemRole: "completed",
                title: "Judge 决策",
                displayText: "judge selected candidate B",
                sortAt: "2026-03-22T10:00:05.000Z",
                createdAt: "2026-03-22T10:00:05.000Z",
              },
              {
                id: "projection-file-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "file-reference",
                itemRole: "assistant",
                title: "文件引用 docs/task-domain-radical-storage-redesign-plan.md",
                displayText: "fallback file summary",
                metadataJson: {
                  filePath: "docs/task-domain-radical-storage-redesign-plan.md",
                  locationSummary: "docs/task-domain-radical-storage-redesign-plan.md:12-26",
                  startLine: 12,
                  endLine: 26,
                },
                sortAt: "2026-03-22T10:00:05.500Z",
                createdAt: "2026-03-22T10:00:05.500Z",
              },
              {
                id: "projection-diff-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "diff",
                itemRole: "assistant",
                title: "变更 Diff",
                displayText: "fallback diff summary",
                metadataJson: {
                  filePath: "control-plane/service/src/modules/tasks/task-domain-projector.ts",
                  diffSummary:
                    "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
                  additions: 14,
                  deletions: 3,
                },
                sortAt: "2026-03-22T10:00:06.000Z",
                createdAt: "2026-03-22T10:00:06.000Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: true,
              snapshotVersion: 29,
              itemCount: 6,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });
    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.finalPrompt).toBe("投影用户输入");
    expect(payload.latestResponse).toBe("投影回复");
    expect(payload.traceId).toBe(
      payload.messages.find((item: { role?: string }) => item.role === "assistant")?.id ?? null,
    );
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: true,
      snapshotVersion: 29,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.snapshot).toMatchObject({
      currentStatus: "completed",
      latestResult: "投影回复",
    });
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          content: expect.stringContaining("includePattern"),
          toolName: "search_code",
          toolArgumentsSummary: expect.stringContaining("task domain projections"),
          toolStatus: "completed",
        }),
        expect.objectContaining({ type: "judge-decision", content: "judge selected candidate B" }),
        expect.objectContaining({
          type: "file-reference",
          content: "docs/task-domain-radical-storage-redesign-plan.md:12-26",
          filePath: "docs/task-domain-radical-storage-redesign-plan.md",
          fileRange: "12-26",
        }),
        expect.objectContaining({
          type: "diff",
          content: "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
          filePath: "control-plane/service/src/modules/tasks/task-domain-projector.ts",
          diffSummary: "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
        }),
      ]),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("supports generic projection message operation and artifact rows", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "投影回复",
              latestResultSummary: "投影回复",
              activeCandidateCount: 0,
              completedCandidateCount: 1,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: true,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-generic-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-generic-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "message",
                itemRole: "user",
                displayText: "投影用户输入",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "projection-assistant-generic-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-assistant-generic-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "message",
                itemRole: "assistant",
                displayText: "投影回复",
                sortAt: "2026-03-22T10:00:03.000Z",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
              {
                id: "projection-operation-generic-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                operationId: "operation-generic-1",
                itemKind: "operation",
                itemRole: "tool",
                title: "bash",
                displayText: "command: pwd",
                metadataJson: {
                  sourceKind: "tool-call",
                  toolName: "bash",
                  argumentsSummary: "command: pwd",
                  status: "completed",
                },
                sortAt: "2026-03-22T10:00:03.100Z",
                createdAt: "2026-03-22T10:00:03.100Z",
              },
              {
                id: "projection-artifact-generic-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                operationId: "operation-generic-1",
                artifactId: "artifact-generic-1",
                itemKind: "artifact",
                itemRole: "tool",
                title: "bash result",
                displayText: "/tmp/workspace",
                metadataJson: {
                  sourceKind: "tool-output",
                  artifactKind: "result",
                  toolName: "bash",
                  outputSummary: "/tmp/workspace",
                  status: "completed",
                },
                sortAt: "2026-03-22T10:00:03.200Z",
                createdAt: "2026-03-22T10:00:03.200Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: true,
              itemCount: 4,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });
    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.finalPrompt).toBe("投影用户输入");
    expect(payload.latestResponse).toBe("投影回复");
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: true,
    });
    expect(payload.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "投影用户输入" }),
        expect.objectContaining({ role: "assistant", text: "投影回复" }),
      ]),
    );
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolName: "bash",
          toolArgumentsSummary: "command: pwd",
          toolStatus: "completed",
          content: "command: pwd",
        }),
        expect.objectContaining({
          type: "tool-output",
          toolName: "bash",
          toolStatus: "completed",
          content: "/tmp/workspace",
        }),
      ]),
    );
    expectNoLegacyTimelineReadSource(payload);
    expectServiceTimelineNotRequested(cpFetchMock, "task-1", "task-session:task-1:ses-1");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("prefers service timeline aggregation when tree events cache is complete", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "msg-1",
                role: "user",
                text: [
                  "Execution context:",
                  "",
                  "Opener-X task ID: task-1",
                  "Project ID: proj-1",
                  "当前执行上下文",
                  "任务：trace task",
                  "请只完成当前阶段的目标。",
                  "完成后请输出本阶段产出摘要。",
                  "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
                  "",
                  "第一轮用户输入",
                ].join("\n"),
                createdAt: "2026-03-19T10:00:00.000Z",
              },
              {
                id: "msg-2",
                role: "assistant",
                text: "第一轮模型回复",
                createdAt: "2026-03-19T10:00:05.000Z",
              },
              {
                id: "msg-3",
                role: "user",
                text: [
                  "Execution context:",
                  "",
                  "Opener-X task ID: task-1",
                  "Project ID: proj-1",
                  "当前执行上下文",
                  "任务：trace task",
                  "请只完成当前阶段的目标。",
                  "完成后请输出本阶段产出摘要。",
                  "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
                  "",
                  "第二轮用户输入",
                ].join("\n"),
                createdAt: "2026-03-19T10:01:00.000Z",
              },
              {
                id: "msg-4",
                role: "assistant",
                text: "第二轮模型回复",
                createdAt: "2026-03-19T10:01:08.000Z",
              },
            ],
            meta: {
              cacheState: "complete",
              complete: true,
              itemCount: 4,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });
    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.finalPrompt).toContain("第二轮用户输入");
    expect(payload.latestResponse).toBe("第二轮模型回复");
    expectNoLegacyTimelineReadSource(payload);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps non-empty partial projection timeline without loading service timeline", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-partial-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-partial-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                displayText: "projection partial prompt",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 1,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        throw new Error(
          "should not load service timeline when projection timeline already has items",
        );
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: false,
      itemCount: 1,
    });
    expect(payload.timeline).toEqual([
      expect.objectContaining({
        id: "message-user-partial-1",
        role: "user",
        text: "projection partial prompt",
      }),
    ]);
    expect(payload.finalPrompt).toBe("projection partial prompt");
    expect(payload.latestResponse).toBeNull();
    expectNoLegacyTimelineReadSource(payload);
    expectServiceTimelineNotRequested(cpFetchMock, "task-1", "task-session:task-1:ses-1");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("loads service timeline when projection is empty even if snapshot latestResult exists", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "running",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "snapshot only response",
              latestResultSummary: "snapshot only response",
              activeCandidateCount: 0,
              completedCandidateCount: 0,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "fallback-user-1",
                role: "user",
                text: "fallback prompt",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "fallback-assistant-1",
                role: "assistant",
                text: "fallback response",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
            ],
            meta: {
              readSource: "conversation-table",
              cacheState: "complete",
              complete: true,
              itemCount: 2,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "conversation-table",
      complete: true,
      itemCount: 2,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.snapshot).toMatchObject({ latestResult: "snapshot only response" });
    expect(payload.timeline).toEqual([
      expect.objectContaining({ role: "user", text: "fallback prompt" }),
      expect.objectContaining({ role: "assistant", text: "fallback response" }),
    ]);
    expect(payload.finalPrompt).toBe("fallback prompt");
    expect(payload.latestResponse).toBe("fallback response");
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true",
      expect.anything(),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("loads service timeline when projection only has status items and no conversation messages", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "snapshot only response",
              latestResultSummary: "snapshot only response",
              activeCandidateCount: 0,
              completedCandidateCount: 1,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-status-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "status-transition",
                itemRole: "completed",
                title: "任务状态",
                displayText: "任务进入 completed 状态",
                sortAt: "2026-03-22T10:00:05.000Z",
                createdAt: "2026-03-22T10:00:05.000Z",
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 1,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "fallback-user-1",
                role: "user",
                text: "fallback prompt",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "fallback-assistant-1",
                role: "assistant",
                text: "fallback response",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
            ],
            meta: {
              readSource: "conversation-table",
              cacheState: "complete",
              complete: true,
              itemCount: 2,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "conversation-table",
      complete: true,
      itemCount: 2,
    });
    expect(payload.timeline).toEqual([
      expect.objectContaining({ role: "user", text: "fallback prompt" }),
      expect.objectContaining({ role: "assistant", text: "fallback response" }),
    ]);
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user-input", content: "fallback prompt" }),
        expect.objectContaining({ type: "model-response", content: "fallback response" }),
        expect.objectContaining({ type: "status-transition", content: "任务进入 completed 状态" }),
      ]),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true",
      expect.anything(),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("loads service timeline when projection conversation rows only contain role placeholders", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "running",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "placeholder result",
              latestResultSummary: "placeholder result",
              activeCandidateCount: 0,
              completedCandidateCount: 0,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                title: "user",
                displayText: null,
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
                metadataJson: { partTypes: [] },
              },
              {
                id: "projection-assistant-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "assistant-output",
                itemRole: "assistant",
                title: "assistant",
                displayText: null,
                sortAt: "2026-03-22T10:00:03.000Z",
                createdAt: "2026-03-22T10:00:03.000Z",
                metadataJson: { partTypes: [] },
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 2,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "fallback-user-1",
                role: "user",
                text: "fallback prompt",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "fallback-assistant-1",
                role: "assistant",
                text: "fallback response",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
            ],
            meta: {
              readSource: "conversation-table",
              cacheState: "complete",
              complete: true,
              itemCount: 2,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "conversation-table",
      complete: true,
      itemCount: 2,
    });
    expect(payload.timeline).toEqual([
      expect.objectContaining({ role: "user", text: "fallback prompt" }),
      expect.objectContaining({ role: "assistant", text: "fallback response" }),
    ]);
    expect(payload.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "fallback prompt" }),
        expect.objectContaining({ role: "assistant", text: "fallback response" }),
      ]),
    );
    expect(payload.finalPrompt).toBe("fallback prompt");
    expect(payload.latestResponse).toBe("fallback response");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("uses persisted conversation when projection shells are not displayable", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "running",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "placeholder result",
              latestResultSummary: "placeholder result",
              activeCandidateCount: 0,
              completedCandidateCount: 0,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                title: "user",
                displayText: null,
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
                metadataJson: { partTypes: [] },
              },
              {
                id: "projection-assistant-1",
                taskId: "task-1",
                projectId: "proj-1",
                sessionId: "task-session:task-1:ses-1",
                itemKind: "assistant-output",
                itemRole: "assistant",
                title: "assistant",
                displayText: null,
                sortAt: "2026-03-22T10:00:03.000Z",
                createdAt: "2026-03-22T10:00:03.000Z",
                metadataJson: { partTypes: [] },
              },
            ],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 2,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "status-1",
                role: "system",
                text: "任务进入 running 状态",
                createdAt: "2026-03-22T09:59:59.000Z",
              },
              {
                id: "empty-user-1",
                role: "user",
                text: "",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "empty-assistant-1",
                role: "assistant",
                text: "",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
            ],
            meta: {
              readSource: "conversation-table",
              cacheState: "complete",
              complete: true,
              itemCount: 2,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:ses-1",
                taskId: "task-1",
                runtimeSessionId: "ses-1",
                parentRuntimeSessionId: null,
                forkedFromMessageId: null,
                branchName: "main",
                sourceType: "root",
                isActive: true,
                createdAt: "2026-03-22T10:00:00.000Z",
                updatedAt: "2026-03-22T10:00:00.000Z",
                archivedAt: null,
              },
            ],
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "conversation-table",
      cacheState: "complete",
      complete: true,
    });
    expect(payload.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "status-1",
          role: "system",
          text: "任务进入 running 状态",
        }),
        expect.objectContaining({
          id: "empty-user-1",
          role: "user",
          text: "",
        }),
        expect.objectContaining({
          id: "empty-assistant-1",
          role: "assistant",
          text: "",
        }),
      ]),
    );
    expect(payload.messages).toEqual([]);
    expect(payload.finalPrompt).toBeNull();
    expect(payload.latestResponse).toBe("placeholder result");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps displayable service timeline placeholders without loading task conversation messages", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "placeholder result",
              latestResultSummary: "placeholder result",
              activeCandidateCount: 0,
              completedCandidateCount: 1,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:05.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "fallback-user-1",
                role: "user",
                text: "user",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
              {
                id: "fallback-assistant-1",
                role: "assistant",
                text: "assistant",
                createdAt: "2026-03-22T10:00:03.000Z",
              },
              {
                id: "fallback-status-1",
                role: "system",
                text: "任务进入 completed 状态",
                createdAt: "2026-03-22T10:00:05.000Z",
              },
            ],
            meta: {
              readSource: "conversation-table",
              cacheState: "complete",
              complete: true,
              itemCount: 3,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:ses-1",
                runtimeSessionId: "ses-1",
                parentSessionId: null,
              },
            ],
            meta: {
              currentSessionId: "task-session:task-1:ses-1",
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/messages?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-user-1",
                runtimeMessageId: "runtime-user-1",
                role: "user",
                textContent: "补全后的用户输入",
                createdAt: "2026-03-22T10:00:01.000Z",
                rawPayload: {
                  info: {
                    id: "runtime-user-1",
                    role: "user",
                    time: { created: "2026-03-22T10:00:01.000Z" },
                  },
                  parts: [{ type: "text", text: "补全后的用户输入" }],
                },
              },
              {
                id: "db-assistant-1",
                runtimeMessageId: "runtime-assistant-1",
                role: "assistant",
                textContent: "补全后的模型回复",
                createdAt: "2026-03-22T10:00:03.000Z",
                rawPayload: {
                  info: {
                    id: "runtime-assistant-1",
                    role: "assistant",
                    time: { created: "2026-03-22T10:00:03.000Z" },
                  },
                  parts: [{ type: "text", text: "补全后的模型回复" }],
                },
              },
            ],
            meta: {
              readSource: "task-session-first",
              cacheState: "complete",
              complete: true,
              itemCount: 2,
              messageCount: 2,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "conversation-table",
      cacheState: "complete",
      complete: true,
    });
    expect(payload.messages).toEqual([
      expect.objectContaining({ role: "user", text: "user" }),
      expect.objectContaining({ role: "assistant", text: "assistant" }),
    ]);
    expect(payload.timeline).toEqual([
      expect.objectContaining({ role: "user", text: "user" }),
      expect.objectContaining({ role: "assistant", text: "assistant" }),
      expect.objectContaining({ role: "system", text: "任务进入 completed 状态" }),
    ]);
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user-input", content: "user" }),
        expect.objectContaining({ type: "model-response", content: "assistant" }),
      ]),
    );
    expect(payload.finalPrompt).toBe("user");
    expect(payload.latestResponse).toBe("assistant");
    expect(payload.traceId).toBe(
      payload.messages.find((item: { role?: string }) => item.role === "assistant")?.id ?? null,
    );
    expect(
      cpFetchMock.mock.calls.some(
        ([path]) => path === "/api/tasks/task-1/messages?sessionId=task-session%3Atask-1%3Ases-1",
      ),
    ).toBe(false);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps DB read model empty when projection and session timeline are both empty", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-1",
              currentSessionId: "ses-1",
              latestResult: "snapshot only response",
              latestResultSummary: "snapshot only response",
              activeCandidateCount: 0,
              completedCandidateCount: 1,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              cacheState: "none",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:ses-1",
                taskId: "task-1",
                runtimeSessionId: "ses-1",
                parentRuntimeSessionId: null,
                forkedFromMessageId: null,
                branchName: "main",
                sourceType: "root",
                isActive: true,
                createdAt: "2026-03-22T10:00:00.000Z",
                updatedAt: "2026-03-22T10:00:00.000Z",
                archivedAt: null,
              },
            ],
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      cacheState: "none",
      complete: false,
      itemCount: 0,
    });
    expect(payload.timeline).toEqual([]);
    expect(payload.messages).toEqual([]);
    expect(payload.finalPrompt).toBeNull();
    expect(payload.latestResponse).toBe("snapshot only response");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps projection incomplete meta when service timeline is unavailable", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: false,
          status: 404,
          data: { error: "timeline unavailable" },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: false,
      itemCount: 0,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.latestResponse).toBeNull();
    expect(payload.finalPrompt).toBeNull();
    expectNoPromptBackfillSegment(payload, "第一轮用户输入");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("reassembles anonymous user prompt parts from complete timeline items", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline?includeLineage=true"
      ) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "msg-1",
                role: "user",
                text: "",
                createdAt: "2026-03-19T10:00:00.000Z",
              },
              {
                id: "anonymous-msg-1",
                role: "unknown",
                text: "",
                raw: {
                  part: {
                    id: "prt-msg-1",
                    type: "text",
                    messageID: "msg-1",
                    text: [
                      "Execution context:",
                      "",
                      "Opener-X task ID: task-1",
                      "Project ID: proj-1",
                      "当前执行上下文",
                      "任务：trace task",
                      "请只完成当前阶段的目标。",
                      "完成后请输出本阶段产出摘要。",
                      "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
                      "",
                      "第二轮用户输入",
                    ].join("\n"),
                  },
                },
              },
              {
                id: "msg-2",
                role: "assistant",
                text: "",
                createdAt: "2026-03-19T10:00:05.000Z",
                raw: {
                  parts: [
                    {
                      id: "prt-msg-2",
                      type: "text",
                      text: "第二轮模型回复",
                    },
                  ],
                },
              },
            ],
            meta: {
              cacheState: "complete",
              complete: true,
              itemCount: 3,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages).toEqual([
      expect.objectContaining({
        id: "msg-1",
        role: "user",
        text: expect.stringContaining("第二轮用户输入"),
      }),
      expect.objectContaining({
        id: "msg-2",
        role: "assistant",
        text: "第二轮模型回复",
      }),
    ]);
    expect(payload.finalPrompt == null || payload.finalPrompt.includes("第二轮用户输入")).toBe(
      true,
    );
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user-input",
          content: "第二轮用户输入",
        }),
      ]),
    );
  });

  test("keeps workflow context without synthesizing task prompt when persisted trace is unavailable", async () => {
    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.finalPrompt == null || payload.finalPrompt.includes("第二轮用户输入")).toBe(
      true,
    );
    expect(payload.finalPrompt == null || payload.finalPrompt.includes("当前执行上下文")).toBe(
      true,
    );
    expect(payload.latestResponse == null || payload.latestResponse === "第二轮模型回复").toBe(
      true,
    );
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow-context",
          label: "工作流注入上下文",
        }),
      ]),
    );
    expectNoPromptBackfillSegment(payload, "第一轮用户输入");
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("does not reuse task snapshot latestResult for an explicitly requested candidate session", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-main",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-main",
              currentSessionId: "ses-main",
              latestResult: "主线最新结果",
              latestResultSummary: "主线最新结果",
              activeCandidateCount: 0,
              completedCandidateCount: 2,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-candidate&includeLineage=false"
      ) {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-candidate/timeline") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              cacheState: "partial",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/execution-trace?sessionId=ses-candidate&includeLineage=false",
      {
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.snapshot).toMatchObject({ latestResult: "主线最新结果" });
    expect(payload.latestResponse).toBeNull();
    expect(payload.messages).toEqual([]);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches/ses-candidate/timeline",
      expect.anything(),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps candidate trace empty when projection and session timeline are both empty", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-main",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-main",
              currentSessionId: "ses-main",
              latestResult: "主线最新结果",
              latestResultSummary: "主线最新结果",
              activeCandidateCount: 0,
              completedCandidateCount: 2,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-candidate-empty-projection&includeLineage=false"
      ) {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              reconcileRequired: true,
              snapshotVersion: 37,
              itemCount: 0,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-candidate-empty-projection/timeline"
      ) {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/execution-trace?sessionId=ses-candidate-empty-projection&includeLineage=false",
      {
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.latestResponse).toBeNull();
    expect(payload.messages).toEqual([]);
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-session-projection",
      complete: false,
      reconcileRequired: true,
      snapshotVersion: 37,
      itemCount: 0,
    });
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("does not reuse task snapshot latestResult even when the explicitly requested session matches task.sessionId", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "completed",
            sessionId: "ses-main",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "completed",
              currentRunId: "task_run:task-1:ses-main",
              currentSessionId: "ses-main",
              latestResult: "主线最新结果",
              latestResultSummary: "主线最新结果",
              activeCandidateCount: 0,
              completedCandidateCount: 2,
              failedCandidateCount: 0,
              totalChainSteps: 0,
              completedChainSteps: 0,
              updatedAt: "2026-03-22T10:00:03.000Z",
            },
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-main&includeLineage=false"
      ) {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-main/timeline") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              cacheState: "partial",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockRejectedValue(new Error("should not hit runtime messages"));

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/execution-trace?sessionId=ses-main&includeLineage=false",
      {
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.snapshot).toMatchObject({ latestResult: "主线最新结果" });
    expect(payload.latestResponse).toBeNull();
    expect(payload.messages).toEqual([]);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches/ses-main/timeline",
      expect.anything(),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("respects includeLineage=false when timeline cache is partial", async () => {
    setTraceFetchImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "trace task",
            prompt: "第一轮用户输入",
            status: "running",
            sessionId: "ses-1",
            selectedModel: "github-copilot:gpt-5.4",
            strategy: JSON.stringify({
              selectedAgent: "oracle-enterprise",
              hookExecutions: [],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          data: {
            data: null,
            meta: {
              readSource: "task-session-projection",
              complete: false,
            },
          },
        };
      }

      if (
        url ===
        "/api/tasks/task-1/timeline-view?sessionId=task-session%3Atask-1%3Ases-1&includeLineage=false"
      ) {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-session-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Ases-1/timeline") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              cacheState: "partial",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/execution-trace?sessionId=ses-1&includeLineage=false",
      {
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expectNoLegacyTimelineReadSource(payload);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches/ses-1/timeline",
      expect.objectContaining({ authorization: "Bearer test" }),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });
});
