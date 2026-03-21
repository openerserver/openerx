/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

const projectBossResponseMap: Record<string, { ok: boolean; status: number; data: unknown }> = {
  "/api/projects/proj-default": {
    ok: true,
    status: 200,
    data: { id: "proj-default", name: "Default Project", slug: "default" },
  },
  "/api/project-tree/tasks?projectId=proj-default&limit=50": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "task-1",
          title: "Release candidate",
          status: "running",
          createdAt: "2026-03-16T08:00:00.000Z",
        },
        {
          id: "task-2",
          title: "Security review",
          status: "running",
          createdAt: "2026-03-16T09:00:00.000Z",
        },
      ],
    },
  },
  "/api/tasks/task-1/operating-runtime/boss-decisions": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "decision-select-template-1",
          ts: "2026-03-16T10:04:00.000Z",
          decisionType: "select-template",
          reason:
            "老板在阶段 release 升级后根据场景 release-guard 的推荐策略，自动切换到模板 tpl-release。",
          stageKey: "release",
          metadata: {
            source: "recommended-profile",
            trigger: "stage-waiting-approval",
            selectedTemplateId: "tpl-release",
            scenarioKey: "release-guard",
            scenarioReason: "Release window requires guarded flow.",
            governanceReason: "Release approval pending",
          },
        },
        {
          id: "decision-override-1",
          ts: "2026-03-16T10:06:00.000Z",
          decisionType: "manual-override",
          reason:
            "人工覆盖任务运行档位：solo / L1 / advisory -> team / L2 / advisory / tpl-release",
          stageKey: "release",
          metadata: {
            actorType: "human",
            actorId: "user-1",
            action: "manual-override",
            previousMode: {
              collaborationMode: "solo",
              autopilotLevel: "L1",
              bossParticipationMode: "advisory",
              selectedTemplateId: null,
              source: "project-default",
            },
            nextMode: {
              collaborationMode: "team",
              autopilotLevel: "L2",
              bossParticipationMode: "advisory",
              selectedTemplateId: "tpl-release",
              source: "task-override",
            },
          },
        },
        {
          id: "decision-1",
          ts: "2026-03-16T10:00:00.000Z",
          decisionType: "request-approval",
          reason: "Need release approval",
          stageKey: "release",
        },
      ],
    },
  },
  "/api/tasks/task-2/operating-runtime/boss-decisions": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "decision-2",
          ts: "2026-03-16T11:00:00.000Z",
          decisionType: "hold-stage",
          reason: "Security gate blocked review",
          stageKey: "verify",
        },
      ],
    },
  },
  "/api/tasks/task-1/operating-runtime/escalations": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "esc-1",
          ts: "2026-03-16T10:05:00.000Z",
          reason: "Release approval pending",
          status: "open",
          stageKey: "release",
          requestedBy: "boss-agent",
        },
      ],
    },
  },
  "/api/tasks/task-2/operating-runtime/escalations": {
    ok: true,
    status: 200,
    data: { data: [] },
  },
  "/api/tasks/task-1/workflow": {
    ok: true,
    status: 200,
    data: {
      data: {
        workflowRun: {
          id: "wf-1",
          templateId: "tpl-1",
          currentStage: "release",
          status: "waiting-approval",
        },
        stages: [
          {
            id: "run-release",
            stageKey: "release",
            status: "waiting-approval",
            approvalState: "pending",
            primaryRoleAgentId: "role.release",
          },
        ],
      },
    },
  },
  "/api/tasks/task-2/workflow": {
    ok: true,
    status: 200,
    data: {
      data: {
        workflowRun: {
          id: "wf-2",
          templateId: "tpl-1",
          currentStage: "verify",
          status: "blocked",
        },
        stages: [
          {
            id: "run-verify",
            stageKey: "verify",
            status: "blocked",
            approvalState: "not-required",
            blockingReason: "Security gate blocked review",
            primaryRoleAgentId: "role.security",
          },
        ],
      },
    },
  },
  "/api/tasks/task-1/role-conclusions": { ok: true, status: 200, data: { data: [] } },
  "/api/tasks/task-2/role-conclusions": { ok: true, status: 200, data: { data: [] } },
  "/api/tasks/task-1/developer-change-requests": { ok: true, status: 200, data: { data: [] } },
  "/api/tasks/task-2/developer-change-requests": { ok: true, status: 200, data: { data: [] } },
  "/api/workflow-templates/tpl-1/stages": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "stage-release",
          stageKey: "release",
          name: "发布执行",
          primaryRoleAgentId: "role.release",
          gatesJson: [],
          approvalsJson: [{ name: "Release Approval" }],
        },
        {
          id: "stage-verify",
          stageKey: "verify",
          name: "集成验证",
          primaryRoleAgentId: "role.security",
          gatesJson: [{ name: "Security Gate" }],
          approvalsJson: [],
        },
      ],
    },
  },
  "/api/role-agents/role.release": { ok: true, status: 200, data: { data: {} } },
  "/api/role-agents/role.security": { ok: true, status: 200, data: { data: {} } },
};

function getProjectBossResponse(path: string) {
  const directResponse = projectBossResponseMap[path];
  if (directResponse) {
    return directResponse;
  }

  if (path.startsWith("/api/role-agents/role.release/resolve")) {
    return { ok: true, status: 200, data: { data: { role: { name: "发布 Agent" } } } };
  }

  if (path.startsWith("/api/role-agents/role.security/resolve")) {
    return { ok: true, status: 200, data: { data: { role: { name: "安全 Agent" } } } };
  }

  return {
    ok: false,
    status: 404,
    data: { error: `Unhandled path: ${path}` },
  };
}

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");

  cpFetchMock.mockImplementation(async (path: string) => getProjectBossResponse(path));
});

describe("project boss operations route", () => {
  test("aggregates project decisions, escalations and attention tasks", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-boss-operations-route"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/boss-operations-view",
      {
        headers: { Authorization: "Bearer inbound-token" },
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.project).toMatchObject({
      id: "proj-default",
      name: "Default Project",
      slug: "default",
    });
    expect(payload.summary).toMatchObject({
      totalTasks: 2,
      tasksWithBossDecisions: 2,
      totalBossDecisions: 4,
      openEscalations: 1,
      blockedTasks: 1,
      waitingApprovalTasks: 1,
      tasksNeedingAttention: 2,
      manualOverrides: 1,
    });
    expect(payload.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-2",
          decisionType: "hold-stage",
        }),
        expect.objectContaining({
          taskId: "task-1",
          decisionType: "select-template",
          metadata: expect.objectContaining({
            source: "recommended-profile",
            trigger: "stage-waiting-approval",
            selectedTemplateId: "tpl-release",
          }),
        }),
        expect.objectContaining({
          taskId: "task-1",
          decisionType: "manual-override",
        }),
        expect.objectContaining({
          taskId: "task-1",
          decisionType: "request-approval",
        }),
      ]),
    );
    expect(payload.overrideHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          actorId: "user-1",
          overrideAction: "manual-override",
        }),
      ]),
    );
    expect(payload.escalations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          reason: "Release approval pending",
        }),
      ]),
    );
    expect(payload.attentionTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-2",
          workflowStatus: "blocked",
        }),
        expect.objectContaining({
          taskId: "task-1",
          workflowStatus: "waiting-approval",
        }),
      ]),
    );
  });
});
