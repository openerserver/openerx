/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createOpencodeAdapterModuleMock } from "./opencode-adapter-mock";

type CpFetchOptions = { method?: string; body?: unknown };
type CpFetchResponse = { ok: boolean; data: unknown };
type MockRoute = {
  method?: string;
  path?: string;
  pathPrefix?: string;
  response: CpFetchResponse;
};

const cpFetchMock = mock(async () => ({ ok: true, data: {} }));
const runDetachedPromptMock = mock(async () => ({
  ok: true,
  sessionId: "session-detached",
  text: JSON.stringify({
    finalDecision: "allow",
    aggregateRiskLevel: "low",
    winningRationale: "通过。",
    summary: "通过。",
    requiredChanges: [],
    mergedFindings: [],
    approvalRequired: false,
    confidenceScore: 0.9,
  }),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: mock(() => "Bearer test"),
  cpFetch: cpFetchMock,
  createInternalAuthorization: mock(async () => "Bearer internal"),
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
    getAgentRun: mock(() => undefined),
    getSessionMessages: mock(async () => ({ ok: true, data: [] })),
    listSessions: mock(async () => ({ ok: true, data: [] })),
    recoverAgentRun: mock(() => undefined),
    terminateAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: runDetachedPromptMock,
  }),
);

beforeEach(() => {
  cpFetchMock.mockReset();
  runDetachedPromptMock.mockReset();
  runDetachedPromptMock.mockResolvedValue({
    ok: true,
    sessionId: "session-detached",
    text: JSON.stringify({
      finalDecision: "allow",
      aggregateRiskLevel: "low",
      winningRationale: "通过。",
      summary: "通过。",
      requiredChanges: [],
      mergedFindings: [],
      approvalRequired: false,
      confidenceScore: 0.9,
    }),
  });
});

function matchesMockRoute(route: MockRoute, path: string, options?: CpFetchOptions) {
  const method = options?.method;
  const methodMatches = route.method ? route.method === method : !method;
  if (!methodMatches) {
    return false;
  }
  if (route.path) {
    return route.path === path;
  }
  if (route.pathPrefix) {
    return path.startsWith(route.pathPrefix);
  }
  return false;
}

function createCpFetchImplementation(routes: MockRoute[]) {
  return async (path: string, options?: CpFetchOptions) => {
    const matched = routes.find((route) => matchesMockRoute(route, path, options));
    return matched?.response || { ok: true, data: {} };
  };
}

describe("stage-intervention", () => {
  test("executes resolved role bindings and persists role conclusion plus developer request", async () => {
    cpFetchMock.mockImplementation(
      createCpFetchImplementation([
        {
          path: "/api/project-tree/tasks/task-1",
          response: {
            ok: true,
            data: {
              id: "task-1",
              title: "Implement feature",
              prompt: "Add workflow stage automation",
              projectId: "proj-1",
              result: "Implementation finished",
            },
          },
        },
        {
          path: "/api/workflow-templates/tpl-1/stages",
          response: {
            ok: true,
            data: {
              data: [
                {
                  id: "stage-implement",
                  templateId: "tpl-1",
                  stageKey: "implement",
                  name: "实现开发",
                  enabled: true,
                  mode: "single",
                  primaryRoleAgentId: "role.developer",
                  participantRoleAgentIdsJson: ["role.security"],
                  entryCriteriaJson: ["设计已完成"],
                  exitCriteriaJson: ["代码已提交"],
                },
              ],
            },
          },
        },
        {
          path: "/api/tasks/task-1/workflow",
          response: {
            ok: true,
            data: {
              data: {
                stages: [{ id: "run-implement", stageKey: "implement", status: "running" }],
              },
            },
          },
        },
        {
          path: "/api/tasks/task-1/role-conclusions",
          response: { ok: true, data: { data: [] } },
        },
        {
          path: "/api/tasks/task-1/developer-change-requests",
          response: { ok: true, data: { data: [] } },
        },
        {
          pathPrefix: "/api/role-agents/role.developer/resolve?",
          response: {
            ok: true,
            data: {
              data: {
                role: {
                  id: "role.developer",
                  name: "开发者 Agent",
                  status: "active",
                  riskLevel: "medium",
                  defaultExecutionMode: "single",
                  requiresApprovalForWrite: false,
                  aggregationPolicy: { strategy: "first-pass" },
                  bindings: [
                    {
                      bindingId: "binding-dev",
                      runtimeAgent: "oracle-enterprise",
                      label: "Dev Binding",
                      priority: 1,
                      model: "github-copilot:claude-sonnet-4",
                    },
                  ],
                },
                validation: {
                  executable: true,
                  reasons: [],
                },
              },
            },
          },
        },
        {
          pathPrefix: "/api/role-agents/role.security/resolve?",
          response: {
            ok: true,
            data: {
              data: {
                role: {
                  id: "role.security",
                  name: "安全 Agent",
                  status: "active",
                  riskLevel: "high",
                  defaultExecutionMode: "single",
                  requiresApprovalForWrite: false,
                  aggregationPolicy: { strategy: "first-pass" },
                  bindings: [
                    {
                      bindingId: "binding-security",
                      runtimeAgent: "prometheus-enterprise",
                      label: "Security Binding",
                      priority: 1,
                      model: "github-copilot:claude-sonnet-4",
                    },
                  ],
                },
                validation: {
                  executable: true,
                  reasons: [],
                },
              },
            },
          },
        },
        {
          method: "POST",
          path: "/api/tasks/task-1/role-conclusions",
          response: { ok: true, data: { ok: true } },
        },
        {
          method: "POST",
          path: "/api/tasks/task-1/developer-change-requests",
          response: { ok: true, data: { ok: true } },
        },
      ]),
    );

    runDetachedPromptMock
      .mockResolvedValueOnce({
        ok: true,
        sessionId: "dev-session",
        text: JSON.stringify({
          finalDecision: "notify-developer",
          aggregateRiskLevel: "medium",
          winningRationale: "需要补充单元测试。",
          summary: "需要补充单元测试。",
          requiredChanges: ["为 workflow progression 增加自动化测试"],
          mergedFindings: [{ key: "test-gap", title: "测试缺口", severity: "medium" }],
          approvalRequired: false,
          confidenceScore: 0.85,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        sessionId: "security-session",
        text: JSON.stringify({
          finalDecision: "allow",
          aggregateRiskLevel: "low",
          winningRationale: "当前实现可接受。",
          summary: "当前实现可接受。",
          requiredChanges: [],
          mergedFindings: [],
          approvalRequired: false,
          confidenceScore: 0.8,
        }),
      });

    const { dispatchStageIntervention } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/stage-intervention?executes-role-bindings"
    );

    const result = await dispatchStageIntervention({
      authorization: "Bearer test",
      taskId: "task-1",
      templateId: "tpl-1",
      stageKey: "implement",
    });

    expect(runDetachedPromptMock).toHaveBeenCalledTimes(2);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/role-conclusions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        roleAgentId: "role.developer",
        stage: "implement",
        finalDecision: "notify-developer",
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/developer-change-requests", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        sourceRoleAgentId: "role.developer",
        taskStageRunId: "run-implement",
        blocking: false,
      }),
    });
    expect(result).toMatchObject({
      disposition: "continue",
      decision: "notify-developer",
    });
  });

  test("reuses existing blocking conclusion and returns blocked without re-dispatch", async () => {
    cpFetchMock.mockImplementation(
      createCpFetchImplementation([
        {
          path: "/api/project-tree/tasks/task-2",
          response: {
            ok: true,
            data: {
              id: "task-2",
              title: "Verify feature",
              prompt: "Run verification",
              projectId: "proj-1",
            },
          },
        },
        {
          path: "/api/workflow-templates/tpl-1/stages",
          response: {
            ok: true,
            data: {
              data: [
                {
                  id: "stage-verify",
                  templateId: "tpl-1",
                  stageKey: "verify",
                  name: "集成验证",
                  enabled: true,
                  mode: "single",
                  primaryRoleAgentId: "role.qa",
                  participantRoleAgentIdsJson: [],
                },
              ],
            },
          },
        },
        {
          path: "/api/tasks/task-2/workflow",
          response: {
            ok: true,
            data: {
              data: {
                stages: [{ id: "run-verify", stageKey: "verify", status: "running" }],
              },
            },
          },
        },
        {
          path: "/api/tasks/task-2/role-conclusions",
          response: {
            ok: true,
            data: {
              data: [
                {
                  id: "existing",
                  roleAgentId: "role.qa",
                  stage: "verify",
                  finalDecision: "block",
                  aggregateRiskLevel: "high",
                  winningRationale: "Security gate blocked verification.",
                },
              ],
            },
          },
        },
        {
          path: "/api/tasks/task-2/developer-change-requests",
          response: { ok: true, data: { data: [] } },
        },
      ]),
    );

    const { dispatchStageIntervention } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/stage-intervention?skip-existing"
    );

    const result = await dispatchStageIntervention({
      authorization: "Bearer test",
      taskId: "task-2",
      templateId: "tpl-1",
      stageKey: "verify",
    });

    expect(runDetachedPromptMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      disposition: "blocked",
      decision: "block",
      blockingReason: "Security gate blocked verification.",
    });
  });
});
