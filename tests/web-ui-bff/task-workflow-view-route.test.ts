/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
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
  getAgentRun: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  recoverAgentRun: mock(() => undefined),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  syncGraphsForSessionTask: mock(async () => undefined),
  syncGraphsForTask: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () => ({
  sseAggregator: {
    registerParallelTask: mock(() => undefined),
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

describe("task workflow view route", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("falls back to completed task status when workflow run is missing", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "project-1",
            status: "completed",
          },
        };
      }

      if (url === "/api/tasks/task-1/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: null,
              stages: [],
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/role-conclusions") {
        return { ok: true, data: { data: [] } };
      }

      if (url === "/api/tasks/task-1/developer-change-requests") {
        return { ok: true, data: { data: [] } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-workflow-view-route-completed"
    );

    const response = await taskRoutes.request("http://localhost/task-1/workflow-view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      taskId: "task-1",
      workflow: {
        currentStage: "done",
        status: "completed",
        stages: [],
      },
      roleConclusions: [],
      developerChangeRequests: [],
    });
  });

  test("falls back to failed task status when workflow run is missing", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-2") {
        return {
          ok: true,
          data: {
            id: "task-2",
            projectId: "project-1",
            status: "failed",
          },
        };
      }

      if (url === "/api/tasks/task-2/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: null,
              stages: [],
            },
          },
        };
      }

      if (url === "/api/tasks/task-2/role-conclusions") {
        return { ok: true, data: { data: [] } };
      }

      if (url === "/api/tasks/task-2/developer-change-requests") {
        return { ok: true, data: { data: [] } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-workflow-view-route-failed"
    );

    const response = await taskRoutes.request("http://localhost/task-2/workflow-view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      taskId: "task-2",
      workflow: {
        currentStage: "unknown",
        status: "failed",
        stages: [],
      },
      roleConclusions: [],
      developerChangeRequests: [],
    });
  });

  test("derives gate, approval and block actual state for task workflow stages", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-3") {
        return {
          ok: true,
          data: {
            id: "task-3",
            projectId: "project-1",
            status: "running",
          },
        };
      }

      if (url === "/api/tasks/task-3/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: {
                id: "wf-3",
                templateId: "tpl-1",
                currentStage: "verify",
                status: "blocked",
              },
              stages: [
                {
                  id: "run-clarify",
                  stageKey: "clarify",
                  status: "completed",
                  approvalState: "not-required",
                  primaryRoleAgentId: "role.product",
                },
                {
                  id: "run-verify",
                  stageKey: "verify",
                  status: "blocked",
                  approvalState: "pending",
                  blockingReason: "Security gate blocked release.",
                  primaryRoleAgentId: "role.qa",
                },
              ],
            },
          },
        };
      }

      if (url === "/api/tasks/task-3/role-conclusions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "conclusion-security",
                roleAgentId: "role.security",
                stage: "verify",
                finalDecision: "block",
                aggregateRiskLevel: "high",
                consensusScore: 1,
                winningRationale: "Security gate blocked release.",
                mergedFindings: [],
                minorityFindings: [],
                conflicts: [],
                approvalRecommendation: { required: true },
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-3/developer-change-requests") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "request-verify",
                taskStageRunId: "run-verify",
                sourceRoleAgentId: "role.security",
                priority: "high",
                title: "修复安全问题",
                summary: "修复漏洞后重新验证。",
                requiredChanges: ["补充安全修复"],
                blocking: true,
                approvalRequired: true,
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
                id: "stage-clarify",
                stageKey: "clarify",
                name: "需求澄清",
                primaryRoleAgentId: "role.product",
                gatesJson: [],
                approvalsJson: [],
              },
              {
                id: "stage-verify",
                stageKey: "verify",
                name: "集成验证",
                primaryRoleAgentId: "role.qa",
                gatesJson: [{ name: "Security Gate" }],
                approvalsJson: [{ name: "QA Approval" }],
              },
            ],
          },
        };
      }

      if (url.startsWith("/api/role-agents/role.security/resolve")) {
        return {
          ok: true,
          data: { data: { role: { name: "安全 Agent" } } },
        };
      }

      if (url.startsWith("/api/role-agents/role.qa/resolve")) {
        return {
          ok: true,
          data: { data: { role: { name: "QA Agent" } } },
        };
      }

      if (url.startsWith("/api/role-agents/role.product/resolve")) {
        return {
          ok: true,
          data: { data: { role: { name: "产品 Agent" } } },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-workflow-view-route-stage-runtime"
    );

    const response = await taskRoutes.request("http://localhost/task-3/workflow-view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      taskId: "task-3",
      workflow: {
        templateId: "tpl-1",
        currentStage: "verify",
        status: "blocked",
        stages: [
          expect.objectContaining({
            stageKey: "clarify",
            gateCount: 0,
            approvalCount: 0,
            runtimeSummary: expect.objectContaining({
              gateResult: "not-configured",
              approvalResult: "not-configured",
            }),
          }),
          expect.objectContaining({
            stageKey: "verify",
            gateCount: 1,
            approvalCount: 1,
            blockingReason: "Security gate blocked release.",
            runtimeSummary: expect.objectContaining({
              blockDecisionCount: 1,
              approvalDecisionCount: 1,
              openChangeRequestCount: 1,
              blockingChangeRequestCount: 1,
              gateResult: "blocked",
              approvalResult: "pending",
              latestBlockingRoleLabel: "安全 Agent",
              latestApprovalRoleLabel: "安全 Agent",
            }),
          }),
        ],
      },
      developerChangeRequests: [
        expect.objectContaining({
          id: "request-verify",
          stageKey: "verify",
        }),
      ],
    });
  });
});