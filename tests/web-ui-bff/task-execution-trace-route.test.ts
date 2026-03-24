/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { createOpencodeAdapterModuleMock } from "./opencode-adapter-mock";
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

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/intent-classifier", () => ({
  classifyIntent: mock(() => ({ category: "implementation" })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  diagnoseModelReadiness: mock(() => ({ ready: true })),
  formatModelRoute: mock(() => "github-copilot:gpt-5.4"),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  resolveModelRoute: mock(() => ({ providerId: "github-copilot", modelId: "gpt-5.4" })),
  validateModelProvider: mock(() => true),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  parseTaskStrategy: mock(() => ({ selectedAgent: "oracle-enterprise" })),
  readOrchestrationStrategy: mock(async () => ({ hooks: [], templates: [], judge: {} })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-runtime", () => ({
  recordPaidExecutionRuntimeUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-pipeline", () => ({
  buildRuntimePipeline: mock(async () => ({ stages: [] })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () =>
  createOpencodeAdapterModuleMock({
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
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
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
  reconcileRunningTasksOnStartup: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  buildStageArtifactSummary: mock(() => null),
  buildWorkflowExecutionPromptSnapshot: buildWorkflowExecutionPromptSnapshotMock,
  fetchCurrentStageHooks: mock(async () => []),
  persistWorkflowStageExecutionOutcome: mock(async () => undefined),
}));

function expectNoLegacyTimelineReadSource(payload: {
  timelineMeta?: { readSource?: string | null } | null;
}) {
  expect(payload.timelineMeta?.readSource).not.toBe("legacy-project-tree-events");
  expect(payload.timelineMeta?.readSource).not.toBe("conversation-table+legacy-fallback");
}

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

  cpFetchMock.mockImplementation(async (url: string) => {
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
            readSource: "task-domain-projection",
            complete: false,
          },
        },
      };
    }
    if (url === "/api/tasks/task-1/timeline-view?runtimeSessionId=ses-1") {
      return {
        ok: true,
        data: {
          data: [],
          meta: {
            readSource: "task-domain-projection",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }
    if (url === "/api/tasks/task-1/timeline-view?runtimeSessionId=ses-1&includeLineage=false") {
      return {
        ok: true,
        data: {
          data: [],
          meta: {
            readSource: "task-domain-projection",
            complete: false,
            itemCount: 0,
          },
        },
      };
    }
    if (url === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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
              "第一轮用户输入",
            ].join("\n"),
          },
        ],
      },
      {
        info: {
          id: "msg-2",
          role: "assistant",
          time: { created: Date.parse("2026-03-19T10:00:05.000Z") },
        },
        parts: [{ type: "text", text: "第一轮模型回复" }],
      },
      {
        info: {
          id: "msg-3",
          role: "user",
          time: { created: Date.parse("2026-03-19T10:01:00.000Z") },
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
    cpFetchMock.mockImplementation(async (url: string) => {
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
              readSource: "task-domain-projection",
              complete: true,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?runtimeSessionId=ses-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-1",
                sessionId: "task_session:task-1:ses-1",
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
                sessionId: "task_session:task-1:ses-1",
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
                sessionId: "task_session:task-1:ses-1",
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
                sessionId: "task_session:task-1:ses-1",
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
                sessionId: "task_session:task-1:ses-1",
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
                sessionId: "task_session:task-1:ses-1",
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
              readSource: "task-domain-projection",
              complete: true,
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
    expect(payload.timelineMeta).toMatchObject({
      readSource: "task-domain-projection",
      complete: true,
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

  test("prefers service timeline aggregation when tree events cache is complete", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
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
              readSource: "task-domain-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?runtimeSessionId=ses-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-domain-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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
    cpFetchMock.mockImplementation(async (url: string) => {
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
              readSource: "task-domain-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?runtimeSessionId=ses-1") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "projection-user-partial-1",
                taskId: "task-1",
                projectId: "proj-1",
                messageId: "message-user-partial-1",
                sessionId: "task_session:task-1:ses-1",
                itemKind: "user-input",
                itemRole: "user",
                displayText: "projection partial prompt",
                sortAt: "2026-03-22T10:00:01.000Z",
                createdAt: "2026-03-22T10:00:01.000Z",
              },
            ],
            meta: {
              readSource: "task-domain-projection",
              complete: false,
              itemCount: 1,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
        throw new Error("should not load service timeline when projection timeline already has items");
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
      readSource: "task-domain-projection",
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
    expect(
      cpFetchMock.mock.calls.some(
        ([path]) => path === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true",
      ),
    ).toBe(false);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("keeps projection incomplete meta when projection and service timeline are both unavailable", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
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
              readSource: "task-domain-projection",
              complete: false,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/timeline-view?runtimeSessionId=ses-1") {
        return {
          ok: true,
          data: {
            data: [],
            meta: {
              readSource: "task-domain-projection",
              complete: false,
              itemCount: 0,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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
      readSource: "task-domain-projection",
      complete: false,
      itemCount: 0,
    });
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.latestResponse).toBeNull();
    expect(payload.finalPrompt).toBeNull();
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("reassembles anonymous user prompt parts from complete timeline items", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
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

      if (url === "/api/tasks/task-1/branches/ses-1/timeline?includeLineage=true") {
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
    expect(payload.finalPrompt == null || payload.finalPrompt.includes("第二轮用户输入")).toBe(true);
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

  test("keeps workflow context and user input segments from the persisted trace path", async () => {
    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.finalPrompt == null || payload.finalPrompt.includes("第二轮用户输入")).toBe(true);
    expect(payload.finalPrompt == null || payload.finalPrompt.includes("当前执行上下文")).toBe(true);
    expect(payload.latestResponse == null || payload.latestResponse === "第二轮模型回复").toBe(true);
    expectNoLegacyTimelineReadSource(payload);
    expect(payload.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow-context",
          label: "工作流注入上下文",
        }),
        expect.objectContaining({
          type: "user-input",
          content: "第一轮用户输入",
        }),
      ]),
    );
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("respects includeLineage=false when timeline cache is partial", async () => {
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
