/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createOpencodeAdapterModuleMock,
  createRuntimeProviderModuleMock,
} from "./opencode-adapter-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

const opencodeAdapterModule = createOpencodeAdapterModuleMock({
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
  findAgentRunBySessionId: mock(() => undefined),
  getAgentRun: mock(() => undefined),
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  listAgentRuns: mock(() => []),
  listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  registerAgentRun: mock(() => undefined),
  recoverAgentRun: mock(() => undefined),
  replyRuntimePermission: mock(async () => ({ ok: true })),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  () => opencodeAdapterModule,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  createRuntimeProviderModuleMock(opencodeAdapterModule),
);

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  })),
  mergeStageAndStrategyHooks: mock(
    (_stageHooks: unknown, strategyHooks: unknown) => strategyHooks ?? [],
  ),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
  recordModelUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  syncGraphsForSessionTask: mock(async () => undefined),
  syncGraphsForTask: mock(async () => undefined),
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

describe("task member view route", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("aggregates manager, user and agent members for a task", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            status: "running",
          },
        };
      }

      if (url === "/api/tasks/task-1/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: {
                id: "wf-task-1",
                templateId: "tpl-1",
                currentStage: "implement",
                status: "running",
              },
              stages: [
                {
                  id: "stage-run-implement",
                  stageKey: "implement",
                  status: "running",
                  approvalState: "not-required",
                  primaryRoleAgentId: "role.developer",
                },
                {
                  id: "stage-run-verify",
                  stageKey: "verify",
                  status: "pending",
                  approvalState: "not-required",
                  primaryRoleAgentId: "role.qa",
                },
              ],
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/role-conclusions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "conclusion-qa",
                roleAgentId: "role.qa",
                stage: "verify",
                finalDecision: "observe",
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/developer-change-requests") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "request-dev",
                taskStageRunId: "stage-run-implement",
                sourceRoleAgentId: "role.developer",
                priority: "medium",
                title: "继续实现",
                summary: "继续推进实现阶段。",
                requiredChanges: [],
                blocking: false,
                approvalRequired: false,
                status: "open",
              },
            ],
          },
        };
      }

      if (url === "/api/workflow-templates/tpl-1/stages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "stage-implement",
                stageKey: "implement",
                name: "实现开发",
                primaryRoleAgentId: "role.developer",
                gatesJson: [],
                approvalsJson: [],
              },
              {
                id: "stage-verify",
                stageKey: "verify",
                name: "集成验证",
                primaryRoleAgentId: "role.qa",
                gatesJson: [],
                approvalsJson: [],
              },
            ],
          },
        };
      }

      if (url === "/api/projects/proj-1/members") {
        return {
          ok: true,
          data: [
            {
              userId: "manager-1",
              projectId: "proj-1",
              role: "project_admin",
              username: "manager",
              displayName: "项目管理员",
              globalRole: "project_admin",
              createdAt: "2026-03-22T00:00:00.000Z",
            },
            {
              userId: "user-1",
              projectId: "proj-1",
              role: "developer",
              username: "requester",
              displayName: "需求发起人",
              globalRole: "developer",
              createdAt: "2026-03-22T00:10:00.000Z",
            },
          ],
        };
      }

      if (url === "/api/tasks/task-1/runs") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "run-dev-1",
                taskId: "task-1",
                sessionId: "session-1",
                agentType: "oracle-enterprise",
                status: "running",
                createdAt: "2026-03-22T01:00:00.000Z",
                startedAt: "2026-03-22T01:00:05.000Z",
                finishedAt: null,
              },
              {
                id: "run-qa-1",
                taskId: "task-1",
                sessionId: "session-2",
                agentType: "qa-reviewer",
                status: "completed",
                createdAt: "2026-03-22T02:00:00.000Z",
                startedAt: "2026-03-22T02:00:02.000Z",
                finishedAt: "2026-03-22T02:10:00.000Z",
              },
            ],
          },
        };
      }

      if (url.startsWith("/api/role-agents/role.developer/resolve")) {
        return {
          ok: true,
          data: {
            data: {
              role: {
                id: "role.developer",
                name: "开发 Agent",
                bindings: [
                  {
                    bindingId: "binding-dev",
                    runtimeAgent: "oracle-enterprise",
                    label: "开发 Agent Alpha",
                    enabled: true,
                    priority: 1,
                    model: "gpt-5.4",
                    tags: ["code", "review"],
                  },
                ],
              },
              validation: {
                executable: true,
                reasons: [],
              },
            },
          },
        };
      }

      if (url.startsWith("/api/role-agents/role.qa/resolve")) {
        return {
          ok: true,
          data: {
            data: {
              role: {
                id: "role.qa",
                name: "QA Agent",
                bindings: [
                  {
                    bindingId: "binding-qa",
                    runtimeAgent: "qa-reviewer",
                    label: "QA Agent Beta",
                    enabled: true,
                    priority: 1,
                    model: "gpt-5-mini",
                    tags: ["qa"],
                  },
                ],
              },
              validation: {
                executable: true,
                reasons: [],
              },
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-member-view-route"
    );

    const response = await taskRoutes.request("http://localhost/task-1/member-view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      taskId: "task-1",
      projectId: "proj-1",
      workflowStatus: "running",
      currentStageKey: "implement",
      currentStageLabel: "实现开发",
      summary: {
        managerCount: 1,
        userCount: 1,
        agentCount: 2,
        activeAgentCount: 1,
      },
      members: [
        expect.objectContaining({
          kind: "manager",
          displayName: "项目管理员",
          responsibilityLabels: ["治理 / 授权 / 审批"],
        }),
        expect.objectContaining({
          kind: "user",
          displayName: "需求发起人",
          responsibilityLabels: ["原始意图 / 协作 / 上下文"],
        }),
        expect.objectContaining({
          kind: "agent",
          displayName: "开发 Agent Alpha",
          handle: "oracle-enterprise",
          statusLabel: "执行中",
          capabilityBadges: ["code", "review"],
          runCount: 1,
        }),
        expect.objectContaining({
          kind: "agent",
          displayName: "QA Agent Beta",
          handle: "qa-reviewer",
          statusLabel: "已运行",
          runCount: 1,
        }),
      ],
    });
  });
});
