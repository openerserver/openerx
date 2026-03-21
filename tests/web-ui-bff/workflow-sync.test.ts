/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async () => ({ ok: true, data: {} }));
const dispatchStageInterventionMock = mock(async () => ({
  disposition: "continue",
  decision: "allow",
}));
const readOrchestrationStrategyMock = mock(() => ({
  organizationSettings: {
    recommendedProfiles: [],
  },
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/stage-intervention", () => ({
  dispatchStageIntervention: dispatchStageInterventionMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  readOrchestrationStrategy: readOrchestrationStrategyMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  dispatchStageInterventionMock.mockReset();
  readOrchestrationStrategyMock.mockReset();
  dispatchStageInterventionMock.mockResolvedValue({ disposition: "continue", decision: "allow" });
  readOrchestrationStrategyMock.mockReturnValue({
    organizationSettings: {
      recommendedProfiles: [],
    },
  });
});

type FetchOptions = { method?: string; body?: unknown };
type FetchResponse = { ok: true; data: unknown };
type FetchHandler = (path: string, options?: FetchOptions) => FetchResponse | undefined;

function ok(data: unknown = {}): FetchResponse {
  return { ok: true, data };
}

function createTemplateStage(
  stageKey: string,
  orderIndex: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `s-${stageKey}`,
    stageKey,
    orderIndex,
    enabled: true,
    ...overrides,
  };
}

function createWorkflowStage(
  stageKey: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `run-${stageKey}`,
    stageKey,
    status,
    ...overrides,
  };
}

function createWorkflowRun(
  currentStage: string,
  templateId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `wf-${currentStage}`,
    currentStage,
    status: "running",
    templateId,
    ...overrides,
  };
}

function withData(data: unknown) {
  return { data };
}

function templateStagesRoute(
  templateId: string,
  stages: Array<Record<string, unknown>>,
): FetchHandler {
  return (path, options) =>
    !options?.method && path === `/api/workflow-templates/${templateId}/stages`
      ? ok(withData(stages))
      : undefined;
}

function staticRoute(pathname: string, data: unknown): FetchHandler {
  return (path, options) => (!options?.method && path === pathname ? ok(data) : undefined);
}

function workflowRouteSequence(taskId: string, responses: unknown[]): FetchHandler {
  let index = 0;
  return (path, options) => {
    if (options?.method || path !== `/api/tasks/${taskId}/workflow`) {
      return undefined;
    }

    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return ok(response);
  };
}

function postEchoRoute(pathname: string): FetchHandler {
  return (path, options) =>
    options?.method === "POST" && path === pathname
      ? ok({ ok: true, body: options.body })
      : undefined;
}

function installFetchHandlers(...handlers: FetchHandler[]) {
  cpFetchMock.mockImplementation(async (path: string, options?: FetchOptions) => {
    for (const handler of handlers) {
      const response = handler(path, options);
      if (response) {
        return response;
      }
    }

    return ok({});
  });
}

describe("workflow-sync", () => {
  test("initializes workflow from first template stage and dispatches every startup stage until implement", async () => {
    installFetchHandlers(
      templateStagesRoute("tpl-1", [
        createTemplateStage("clarify", 0),
        createTemplateStage("design", 1),
        createTemplateStage("implement", 2),
        createTemplateStage("verify", 3),
      ]),
      workflowRouteSequence("task-1", [
        withData({ workflowRun: null, stages: [] }),
        withData({
          workflowRun: createWorkflowRun("clarify", "tpl-1", { id: "wf-1" }),
          stages: [
            createWorkflowStage("clarify", "running"),
            createWorkflowStage("design", "pending"),
            createWorkflowStage("implement", "pending"),
            createWorkflowStage("verify", "pending"),
          ],
        }),
      ]),
      postEchoRoute("/api/tasks/task-1/workflow/initialize"),
      postEchoRoute("/api/tasks/task-1/workflow/advance"),
    );

    const { ensureTaskWorkflowStarted } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync"
    );

    await ensureTaskWorkflowStarted({
      authorization: "Bearer test",
      taskId: "task-1",
      templateId: "tpl-1",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/workflow/initialize", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        templateId: "tpl-1",
        currentStage: "clarify",
      },
    });

    expect(dispatchStageInterventionMock.mock.calls.map((call) => call[0].stageKey)).toEqual([
      "clarify",
      "design",
      "implement",
    ]);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/operating-runtime/boss-decisions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        decisionType: "advance-stage",
        stageKey: "clarify",
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "clarify",
        toStage: "design",
        status: "completed",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "design",
        toStage: "implement",
        status: "completed",
      },
    });
  });

  test("auto creates select-template decision from recommended scenario before workflow initialize", async () => {
    readOrchestrationStrategyMock.mockReturnValue({
      organizationSettings: {
        recommendedProfiles: [
          {
            scenarioKey: "release-guard",
            collaborationMode: "team",
            autopilotLevel: "L1",
            bossParticipationMode: "advisory",
            templateHints: ["tpl-release"],
            requiredRoleHints: [],
            reason: "Release window requires guarded flow.",
          },
        ],
      },
    });

    installFetchHandlers(
      staticRoute("/api/project-tree/tasks/task-auto", {
        id: "task-auto",
        projectId: "proj-default",
        strategy: JSON.stringify({
          scenarioKey: "release-guard",
          workflowTemplateId: "tpl-default",
        }),
      }),
      staticRoute("/api/projects/proj-default", {
        id: "proj-default",
        settings: {
          allowBossAutoTemplateSwitch: true,
          preferredTemplateId: "tpl-preferred",
          workflowTemplateId: "tpl-default",
        },
      }),
      staticRoute("/api/tasks/task-auto/operating-runtime/mode", {
        data: {
          selectedTemplateId: "tpl-default",
          scenarioKey: "release-guard",
        },
      }),
      postEchoRoute("/api/tasks/task-auto/operating-runtime/boss-decisions"),
      templateStagesRoute("tpl-release", [
        createTemplateStage("clarify", 0),
        createTemplateStage("implement", 1),
      ]),
      workflowRouteSequence("task-auto", [
        withData({ workflowRun: null, stages: [] }),
        withData({
          workflowRun: createWorkflowRun("clarify", "tpl-release", { id: "wf-auto" }),
          stages: [
            createWorkflowStage("clarify", "running"),
            createWorkflowStage("implement", "pending"),
          ],
        }),
      ]),
      postEchoRoute("/api/tasks/task-auto/workflow/initialize"),
      postEchoRoute("/api/tasks/task-auto/workflow/advance"),
    );

    const { ensureTaskWorkflowStarted } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?auto-select-template"
    );

    await ensureTaskWorkflowStarted({
      authorization: "Bearer test",
      taskId: "task-auto",
      templateId: "tpl-default",
    });

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-auto/operating-runtime/boss-decisions",
      {
        method: "POST",
        authorization: "Bearer test",
        body: expect.objectContaining({
          decisionType: "select-template",
          metadata: expect.objectContaining({
            selectedTemplateId: "tpl-release",
            source: "recommended-profile",
            scenarioKey: "release-guard",
          }),
        }),
      },
    );
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-auto/workflow/initialize", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        templateId: "tpl-release",
        currentStage: "clarify",
      },
    });
  });

  test("dispatches and advances every remaining stage on terminal completion", async () => {
    installFetchHandlers(
      templateStagesRoute("tpl-1", [
        createTemplateStage("clarify", 0),
        createTemplateStage("design", 1),
        createTemplateStage("implement", 2),
        createTemplateStage("verify", 3),
        createTemplateStage("release", 4),
      ]),
      staticRoute("/api/tasks/task-2/workflow", {
        data: {
          workflowRun: createWorkflowRun("implement", "tpl-1", { id: "wf-1" }),
          stages: [
            createWorkflowStage("implement", "running", { id: "stage-implement" }),
            createWorkflowStage("verify", "pending", { id: "stage-verify" }),
            createWorkflowStage("release", "pending", { id: "stage-release" }),
          ],
        },
      }),
      postEchoRoute("/api/tasks/task-2/workflow/advance"),
    );

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-2",
      status: "completed",
    });

    expect(dispatchStageInterventionMock.mock.calls.map((call) => call[0].stageKey)).toEqual([
      "implement",
      "verify",
      "release",
    ]);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-2/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "implement",
        toStage: "verify",
        status: "completed",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-2/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "verify",
        toStage: "release",
        status: "completed",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-2/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "release",
        status: "completed",
      },
    });
  });

  test("marks current workflow stage as failed for terminal failure states", async () => {
    installFetchHandlers(
      templateStagesRoute("tpl-2", [
        createTemplateStage("clarify", 0),
        createTemplateStage("design", 1),
        createTemplateStage("implement", 2),
        createTemplateStage("verify", 3),
      ]),
      staticRoute("/api/tasks/task-3/workflow", {
        data: {
          workflowRun: createWorkflowRun("verify", "tpl-2", { id: "wf-2" }),
          stages: [createWorkflowStage("verify", "running", { id: "stage-verify" })],
        },
      }),
      postEchoRoute("/api/tasks/task-3/workflow/advance"),
    );

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-3",
      status: "failed",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-3/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "verify",
        status: "failed",
      },
    });
  });

  test("stops startup progression and blocks the stage when intervention returns block", async () => {
    dispatchStageInterventionMock
      .mockResolvedValueOnce({ disposition: "continue", decision: "allow" })
      .mockResolvedValueOnce({
        disposition: "blocked",
        decision: "block",
        blockingReason: "Security gate blocked design.",
      });

    installFetchHandlers(
      templateStagesRoute("tpl-3", [
        createTemplateStage("clarify", 0),
        createTemplateStage("design", 1),
        createTemplateStage("implement", 2),
      ]),
      workflowRouteSequence("task-4", [
        withData({ workflowRun: null, stages: [] }),
        withData({
          workflowRun: createWorkflowRun("clarify", "tpl-3", { id: "wf-4" }),
          stages: [
            createWorkflowStage("clarify", "running"),
            createWorkflowStage("design", "pending"),
            createWorkflowStage("implement", "pending"),
          ],
        }),
      ]),
      postEchoRoute("/api/tasks/task-4/workflow/initialize"),
      postEchoRoute("/api/tasks/task-4/workflow/advance"),
    );

    const { ensureTaskWorkflowStarted } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?startup-blocked"
    );

    await ensureTaskWorkflowStarted({
      authorization: "Bearer test",
      taskId: "task-4",
      templateId: "tpl-3",
    });

    expect(dispatchStageInterventionMock.mock.calls.map((call) => call[0].stageKey)).toEqual([
      "clarify",
      "design",
    ]);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "clarify",
        toStage: "design",
        status: "completed",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "design",
        status: "blocked",
        blockingReason: "Security gate blocked design.",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4/operating-runtime/boss-decisions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        decisionType: "hold-stage",
        stageKey: "design",
        reason: "Security gate blocked design.",
      }),
    });
  });

  test("creates a secondary select-template decision when stage blocking triggers governance switch", async () => {
    dispatchStageInterventionMock.mockResolvedValueOnce({
      disposition: "blocked",
      decision: "block",
      blockingReason: "Security gate blocked verify.",
    });

    readOrchestrationStrategyMock.mockReturnValue({
      organizationSettings: {
        recommendedProfiles: [
          {
            scenarioKey: "security-remediation",
            collaborationMode: "team",
            autopilotLevel: "L1",
            bossParticipationMode: "exception-only",
            templateHints: ["tpl-security"],
            requiredRoleHints: [],
            reason: "Security incidents should switch to remediation template.",
          },
        ],
      },
    });

    installFetchHandlers(
      staticRoute("/api/project-tree/tasks/task-4b", {
        id: "task-4b",
        projectId: "proj-blocked",
        strategy: JSON.stringify({
          scenarioKey: "security-remediation",
          workflowTemplateId: "tpl-3",
        }),
      }),
      staticRoute("/api/projects/proj-blocked", {
        id: "proj-blocked",
        settings: {
          allowBossAutoTemplateSwitch: true,
          preferredTemplateId: "tpl-fallback",
          workflowTemplateId: "tpl-3",
        },
      }),
      staticRoute("/api/tasks/task-4b/operating-runtime/mode", {
        data: {
          selectedTemplateId: "tpl-3",
          scenarioKey: "security-remediation",
        },
      }),
      templateStagesRoute("tpl-3", [
        createTemplateStage("verify", 0, {
          stageTemplateStrategyJson: {
            onBlockedTemplateId: "tpl-stage-policy",
            note: "验证阻断时切到人工修复模板。",
          },
        }),
      ]),
      staticRoute("/api/tasks/task-4b/workflow", {
        data: {
          workflowRun: createWorkflowRun("verify", "tpl-3", { id: "wf-4b" }),
          stages: [createWorkflowStage("verify", "running")],
        },
      }),
      postEchoRoute("/api/tasks/task-4b/workflow/advance"),
    );

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?terminal-blocked-secondary-switch"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-4b",
      status: "completed",
    });

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-4b/operating-runtime/boss-decisions",
      {
        method: "POST",
        authorization: "Bearer test",
        body: expect.objectContaining({
          decisionType: "select-template",
          metadata: expect.objectContaining({
            source: "stage-policy",
            trigger: "stage-blocked",
            selectedTemplateId: "tpl-stage-policy",
            triggerStageKey: "verify",
            stagePolicyNote: "验证阻断时切到人工修复模板。",
          }),
        }),
      },
    );
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4b/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "verify",
        status: "blocked",
        blockingReason: "Security gate blocked verify.",
      },
    });
  });

  test("stops terminal progression and marks waiting approval when intervention requires approval", async () => {
    dispatchStageInterventionMock
      .mockResolvedValueOnce({ disposition: "continue", decision: "allow" })
      .mockResolvedValueOnce({
        disposition: "waiting-approval",
        decision: "needs-approval",
      });

    installFetchHandlers(
      staticRoute("/api/project-tree/tasks/task-5", {
        id: "task-5",
        projectId: "proj-approval",
        strategy: JSON.stringify({ workflowTemplateId: "tpl-4" }),
      }),
      staticRoute("/api/projects/proj-approval", {
        id: "proj-approval",
        settings: {
          allowBossAutoTemplateSwitch: true,
          preferredTemplateId: "tpl-approval",
          workflowTemplateId: "tpl-4",
        },
      }),
      staticRoute("/api/tasks/task-5/operating-runtime/mode", {
        data: { selectedTemplateId: "tpl-4" },
      }),
      templateStagesRoute("tpl-4", [
        createTemplateStage("implement", 0),
        createTemplateStage("verify", 1),
        createTemplateStage("release", 2),
      ]),
      staticRoute("/api/tasks/task-5/workflow", {
        data: {
          workflowRun: createWorkflowRun("implement", "tpl-4", { id: "wf-5" }),
          stages: [
            createWorkflowStage("implement", "running"),
            createWorkflowStage("verify", "pending"),
            createWorkflowStage("release", "pending"),
          ],
        },
      }),
      postEchoRoute("/api/tasks/task-5/workflow/advance"),
    );

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?terminal-waiting-approval"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-5",
      status: "completed",
    });

    expect(dispatchStageInterventionMock.mock.calls.map((call) => call[0].stageKey)).toEqual([
      "implement",
      "verify",
    ]);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-5/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "implement",
        toStage: "verify",
        status: "completed",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-5/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "verify",
        status: "waiting-approval",
        approvalState: "pending",
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-5/operating-runtime/boss-decisions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        decisionType: "request-approval",
        stageKey: "verify",
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-5/operating-runtime/escalations", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        stageKey: "verify",
        requestedBy: "boss-agent",
        status: "open",
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-5/operating-runtime/boss-decisions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        decisionType: "select-template",
        metadata: expect.objectContaining({
          source: "project-preferred",
          trigger: "stage-waiting-approval",
          selectedTemplateId: "tpl-approval",
          triggerStageKey: "verify",
        }),
      }),
    });
  });

  test("prefers stage waiting-approval strategy over project preference during secondary governance switch", async () => {
    dispatchStageInterventionMock.mockResolvedValueOnce({
      disposition: "waiting-approval",
      decision: "needs-approval",
      reason: "Release sign-off is required.",
    });

    installFetchHandlers(
      staticRoute("/api/project-tree/tasks/task-5b", {
        id: "task-5b",
        projectId: "proj-approval",
        strategy: JSON.stringify({ workflowTemplateId: "tpl-4" }),
      }),
      staticRoute("/api/projects/proj-approval", {
        id: "proj-approval",
        settings: {
          allowBossAutoTemplateSwitch: true,
          preferredTemplateId: "tpl-approval",
          workflowTemplateId: "tpl-4",
        },
      }),
      staticRoute("/api/tasks/task-5b/operating-runtime/mode", {
        data: { selectedTemplateId: "tpl-4" },
      }),
      templateStagesRoute("tpl-4", [
        createTemplateStage("verify", 0, {
          stageTemplateStrategyJson: {
            onWaitingApprovalTemplateId: "tpl-stage-approval",
            note: "等待审批时切到审批模板。",
          },
        }),
      ]),
      staticRoute("/api/tasks/task-5b/workflow", {
        data: {
          workflowRun: createWorkflowRun("verify", "tpl-4", { id: "wf-5b" }),
          stages: [createWorkflowStage("verify", "running")],
        },
      }),
      postEchoRoute("/api/tasks/task-5b/workflow/advance"),
    );

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?terminal-stage-policy-waiting-approval"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-5b",
      status: "completed",
    });

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-5b/operating-runtime/boss-decisions",
      {
        method: "POST",
        authorization: "Bearer test",
        body: expect.objectContaining({
          decisionType: "select-template",
          metadata: expect.objectContaining({
            source: "stage-policy",
            trigger: "stage-waiting-approval",
            selectedTemplateId: "tpl-stage-approval",
            triggerStageKey: "verify",
            stagePolicyNote: "等待审批时切到审批模板。",
          }),
        }),
      },
    );
  });

  test("treats human-review as escalation and persists runtime records", async () => {
    dispatchStageInterventionMock.mockResolvedValueOnce({
      disposition: "waiting-approval",
      decision: "human-review",
      reason: "需要人工复核关键风险。",
    });

    installFetchHandlers(
      templateStagesRoute("tpl-6", [createTemplateStage("verify", 0)]),
      staticRoute("/api/tasks/task-6/workflow", {
        data: {
          workflowRun: createWorkflowRun("verify", "tpl-6", { id: "wf-6" }),
          stages: [createWorkflowStage("verify", "running")],
        },
      }),
      postEchoRoute("/api/tasks/task-6/workflow/advance"),
    );

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?terminal-human-review"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-6",
      status: "completed",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-6/operating-runtime/boss-decisions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        decisionType: "escalate-human",
        stageKey: "verify",
        reason: "需要人工复核关键风险。",
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-6/operating-runtime/escalations", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        stageKey: "verify",
        requestedBy: "boss-agent",
        status: "open",
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-6/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "verify",
        status: "waiting-approval",
        approvalState: "pending",
      },
    });
  });
});
