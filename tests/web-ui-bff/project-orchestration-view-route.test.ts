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

const projectOrchestrationResponseMap: Record<string, { ok: boolean; status: number; data: unknown }> = {
  "/api/projects/proj-default": {
    ok: true,
    status: 200,
    data: {
      id: "proj-default",
      name: "Default Project",
      slug: "default",
    },
  },
  "/api/role-agents?scope=system": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "role.developer",
          projectId: null,
          name: "开发者 Agent",
          description: "负责实现",
          scope: "system",
          status: "active",
          ownerTeam: "platform",
          permissionProfile: "dev",
          toolProfile: "code",
          defaultExecutionMode: "single",
          aggregationStrategy: null,
          maxActiveBindings: null,
          requireConsensus: false,
          riskLevel: "medium",
          requiresApprovalForWrite: false,
          allowedStages: ["implement", "verify"],
          outputSchemaId: null,
          tagsJson: [],
          createdAt: "2026-03-15T00:00:00.000Z",
          updatedAt: "2026-03-15T00:00:00.000Z",
        },
      ],
    },
  },
  "/api/role-agents/role.developer/projects/proj-default/override": {
    ok: false,
    status: 403,
    data: { error: "Forbidden" },
  },
  "/api/projects/proj-default/workflow-template": {
    ok: true,
    status: 200,
    data: {
      projectId: "proj-default",
      workflowTemplateId: "tpl-1",
      template: {
        id: "tpl-1",
        projectId: null,
        name: "默认研发交付模板",
        description: "Default delivery template",
        category: "delivery",
        enabled: true,
        selectableByProjects: true,
        stageOrderJson: ["implement", "verify"],
        defaultRolesJson: ["role.developer"],
        version: 1,
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
      },
    },
  },
  "/api/workflow-templates": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "tpl-1",
          projectId: null,
          name: "默认研发交付模板",
          description: "Default delivery template",
          category: "delivery",
          enabled: true,
          selectableByProjects: true,
          stageOrderJson: ["implement", "verify"],
          defaultRolesJson: ["role.developer"],
          version: 1,
          createdAt: "2026-03-15T00:00:00.000Z",
          updatedAt: "2026-03-15T00:00:00.000Z",
        },
      ],
    },
  },
  "/api/workflow-templates/tpl-1/stages": {
    ok: true,
    status: 200,
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
          participantRoleAgentIdsJson: [],
          gatesJson: [],
          approvalsJson: [],
          orderIndex: 0,
        },
        {
          id: "stage-verify",
          templateId: "tpl-1",
          stageKey: "verify",
          name: "集成验证",
          enabled: true,
          mode: "single",
          primaryRoleAgentId: "role.developer",
          participantRoleAgentIdsJson: [],
          gatesJson: [{ name: "Security Gate" }],
          approvalsJson: [{ name: "QA Approval" }],
          orderIndex: 1,
        },
      ],
    },
  },
  "/api/role-agents/role.developer/bindings": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "binding-system-1",
          roleAgentId: "role.developer",
          projectId: null,
          bindingKey: "default",
          runtimeAgent: "oracle-enterprise",
          label: "System Binding",
          enabled: true,
          priority: 1,
          createdAt: "2026-03-15T00:00:00.000Z",
          updatedAt: "2026-03-15T00:00:00.000Z",
        },
      ],
    },
  },
  "/api/role-agents/role.developer/bindings?projectId=proj-default": {
    ok: true,
    status: 200,
    data: { data: [] },
  },
  "/api/project-tree/tasks?projectId=proj-default&limit=20": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "task-1",
          title: "Verify release candidate",
          status: "running",
          createdAt: "2026-03-15T00:00:00.000Z",
        },
      ],
    },
  },
  "/api/tasks/task-1/workflow": {
    ok: true,
    status: 200,
    data: {
      data: {
        workflowRun: {
          id: "wf-1",
          templateId: "tpl-1",
          currentStage: "verify",
          status: "blocked",
        },
        stages: [
          {
            id: "run-implement",
            stageKey: "implement",
            status: "completed",
            approvalState: "not-required",
            primaryRoleAgentId: "role.developer",
          },
          {
            id: "run-verify",
            stageKey: "verify",
            status: "blocked",
            approvalState: "pending",
            blockingReason: "Security gate blocked release.",
            primaryRoleAgentId: "role.developer",
          },
        ],
      },
    },
  },
  "/api/tasks/task-1/role-conclusions": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "conclusion-verify",
          roleAgentId: "role.developer",
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
  },
  "/api/tasks/task-1/developer-change-requests": {
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: "request-1",
          taskStageRunId: "run-verify",
          sourceRoleAgentId: "role.developer",
          priority: "high",
          title: "Fix verify blockers",
          summary: "Address verification blockers.",
          requiredChanges: ["Fix security blocker"],
          blocking: true,
          approvalRequired: true,
          status: "open",
        },
      ],
    },
  },
};

function getProjectOrchestrationResponse(path: string) {
  const directResponse = projectOrchestrationResponseMap[path];
  if (directResponse) {
    return directResponse;
  }

  if (path.startsWith("/api/role-agents/role.developer/resolve")) {
    return {
      ok: true,
      status: 200,
      data: { data: { role: { name: "开发者 Agent" } } },
    };
  }

  return {
    ok: false,
    status: 404,
    data: {
      error: `Unhandled path: ${path}`,
    },
  };
}

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");

  cpFetchMock.mockImplementation(async (path: string) => getProjectOrchestrationResponse(path));
});

describe("project orchestration view route", () => {
  test("aggregates current template runtime state into stage summaries", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-orchestration-view-route"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/orchestration-view",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      project: {
        id: "proj-default",
        name: "Default Project",
      },
      scenarios: {
        current: {
          stages: [
            expect.objectContaining({
              stageKey: "implement",
              runtimeSummary: expect.objectContaining({
                totalTasks: 1,
                completedCount: 1,
              }),
            }),
            expect.objectContaining({
              stageKey: "verify",
              runtimeSummary: expect.objectContaining({
                totalTasks: 1,
                blockedCount: 1,
                waitingApprovalCount: 1,
                blockDecisionCount: 1,
                approvalDecisionCount: 1,
                openChangeRequestCount: 1,
                blockingChangeRequestCount: 1,
                latestTask: expect.objectContaining({
                  taskId: "task-1",
                  title: "Verify release candidate",
                  workflowStatus: "blocked",
                  stageStatus: "blocked",
                }),
              }),
            }),
          ],
        },
      },
    });
  });
});
