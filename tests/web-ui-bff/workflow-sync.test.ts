/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async () => ({ ok: true, data: {} }));
const dispatchStageInterventionMock = mock(async () => ({ disposition: "continue", decision: "allow" }));
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

describe("workflow-sync", () => {
  test("initializes workflow from first template stage and dispatches every startup stage until implement", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/workflow-templates/tpl-1/stages") {
        return {
          ok: true,
          data: {
            data: [
              { id: "s1", stageKey: "clarify", orderIndex: 0, enabled: true },
              { id: "s2", stageKey: "design", orderIndex: 1, enabled: true },
              { id: "s3", stageKey: "implement", orderIndex: 2, enabled: true },
              { id: "s4", stageKey: "verify", orderIndex: 3, enabled: true },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-1/workflow") {
        if (cpFetchMock.mock.calls.filter(([url]) => url === "/api/tasks/task-1/workflow").length > 1) {
          return {
            ok: true,
            data: {
              data: {
                workflowRun: { id: "wf-1", currentStage: "clarify", status: "running", templateId: "tpl-1" },
                stages: [
                  { id: "run-clarify", stageKey: "clarify", status: "running" },
                  { id: "run-design", stageKey: "design", status: "pending" },
                  { id: "run-implement", stageKey: "implement", status: "pending" },
                  { id: "run-verify", stageKey: "verify", status: "pending" },
                ],
              },
            },
          };
        }
        return { ok: true, data: { data: { workflowRun: null, stages: [] } } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-1/workflow/initialize") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-1/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/tasks/task-auto") {
        return {
          ok: true,
          data: {
            id: "task-auto",
            projectId: "proj-default",
            strategy: JSON.stringify({
              scenarioKey: "release-guard",
              workflowTemplateId: "tpl-default",
            }),
          },
        };
      }

      if (!options?.method && path === "/api/projects/proj-default") {
        return {
          ok: true,
          data: {
            id: "proj-default",
            settings: {
              allowBossAutoTemplateSwitch: true,
              preferredTemplateId: "tpl-preferred",
              workflowTemplateId: "tpl-default",
            },
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-auto/operating-runtime/mode") {
        return {
          ok: true,
          data: {
            data: {
              selectedTemplateId: "tpl-default",
              scenarioKey: "release-guard",
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-auto/operating-runtime/boss-decisions") {
        return { ok: true, data: { ok: true } };
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-release/stages") {
        return {
          ok: true,
          data: {
            data: [
              { id: "s1", stageKey: "clarify", orderIndex: 0, enabled: true },
              { id: "s2", stageKey: "implement", orderIndex: 1, enabled: true },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-auto/workflow") {
        if (cpFetchMock.mock.calls.filter(([url]) => url === "/api/tasks/task-auto/workflow").length > 1) {
          return {
            ok: true,
            data: {
              data: {
                workflowRun: { id: "wf-auto", currentStage: "clarify", status: "running", templateId: "tpl-release" },
                stages: [
                  { id: "run-clarify", stageKey: "clarify", status: "running" },
                  { id: "run-implement", stageKey: "implement", status: "pending" },
                ],
              },
            },
          };
        }
        return { ok: true, data: { data: { workflowRun: null, stages: [] } } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-auto/workflow/initialize") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-auto/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

    const { ensureTaskWorkflowStarted } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?auto-select-template"
    );

    await ensureTaskWorkflowStarted({
      authorization: "Bearer test",
      taskId: "task-auto",
      templateId: "tpl-default",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-auto/operating-runtime/boss-decisions", {
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
    });
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
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/workflow-templates/tpl-1/stages") {
        return {
          ok: true,
          data: {
            data: [
              { id: "s1", stageKey: "clarify", orderIndex: 0, enabled: true },
              { id: "s2", stageKey: "design", orderIndex: 1, enabled: true },
              { id: "s3", stageKey: "implement", orderIndex: 2, enabled: true },
              { id: "s4", stageKey: "verify", orderIndex: 3, enabled: true },
              { id: "s5", stageKey: "release", orderIndex: 4, enabled: true },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-2/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-1", currentStage: "implement", status: "running", templateId: "tpl-1" },
              stages: [
                { id: "stage-implement", stageKey: "implement", status: "running" },
                { id: "stage-verify", stageKey: "verify", status: "pending" },
                { id: "stage-release", stageKey: "release", status: "pending" },
              ],
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-2/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/workflow-templates/tpl-2/stages") {
        return {
          ok: true,
          data: {
            data: [
              { id: "s1", stageKey: "clarify", orderIndex: 0, enabled: true },
              { id: "s2", stageKey: "design", orderIndex: 1, enabled: true },
              { id: "s3", stageKey: "implement", orderIndex: 2, enabled: true },
              { id: "s4", stageKey: "verify", orderIndex: 3, enabled: true },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-3/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-2", currentStage: "verify", status: "running", templateId: "tpl-2" },
              stages: [{ id: "stage-verify", stageKey: "verify", status: "running" }],
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-3/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/workflow-templates/tpl-3/stages") {
        return {
          ok: true,
          data: {
            data: [
              { id: "s1", stageKey: "clarify", orderIndex: 0, enabled: true },
              { id: "s2", stageKey: "design", orderIndex: 1, enabled: true },
              { id: "s3", stageKey: "implement", orderIndex: 2, enabled: true },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-4/workflow") {
        if (cpFetchMock.mock.calls.filter(([url]) => url === "/api/tasks/task-4/workflow").length > 1) {
          return {
            ok: true,
            data: {
              data: {
                workflowRun: { id: "wf-4", currentStage: "clarify", status: "running", templateId: "tpl-3" },
                stages: [
                  { id: "run-clarify", stageKey: "clarify", status: "running" },
                  { id: "run-design", stageKey: "design", status: "pending" },
                  { id: "run-implement", stageKey: "implement", status: "pending" },
                ],
              },
            },
          };
        }
        return { ok: true, data: { data: { workflowRun: null, stages: [] } } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-4/workflow/initialize") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-4/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/tasks/task-4b") {
        return {
          ok: true,
          data: {
            id: "task-4b",
            projectId: "proj-blocked",
            strategy: JSON.stringify({
              scenarioKey: "security-remediation",
              workflowTemplateId: "tpl-3",
            }),
          },
        };
      }

      if (!options?.method && path === "/api/projects/proj-blocked") {
        return {
          ok: true,
          data: {
            id: "proj-blocked",
            settings: {
              allowBossAutoTemplateSwitch: true,
              preferredTemplateId: "tpl-fallback",
              workflowTemplateId: "tpl-3",
            },
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-4b/operating-runtime/mode") {
        return {
          ok: true,
          data: {
            data: {
              selectedTemplateId: "tpl-3",
              scenarioKey: "security-remediation",
            },
          },
        };
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-3/stages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "s1",
                stageKey: "verify",
                orderIndex: 0,
                enabled: true,
                stageTemplateStrategyJson: {
                  onBlockedTemplateId: "tpl-stage-policy",
                  note: "验证阻断时切到人工修复模板。",
                },
              },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-4b/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-4b", currentStage: "verify", status: "running", templateId: "tpl-3" },
              stages: [{ id: "run-verify", stageKey: "verify", status: "running" }],
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-4b/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?terminal-blocked-secondary-switch"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-4b",
      status: "completed",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-4b/operating-runtime/boss-decisions", {
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
    });
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

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/tasks/task-5") {
        return {
          ok: true,
          data: {
            id: "task-5",
            projectId: "proj-approval",
            strategy: JSON.stringify({
              workflowTemplateId: "tpl-4",
            }),
          },
        };
      }

      if (!options?.method && path === "/api/projects/proj-approval") {
        return {
          ok: true,
          data: {
            id: "proj-approval",
            settings: {
              allowBossAutoTemplateSwitch: true,
              preferredTemplateId: "tpl-approval",
              workflowTemplateId: "tpl-4",
            },
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-5/operating-runtime/mode") {
        return {
          ok: true,
          data: {
            data: {
              selectedTemplateId: "tpl-4",
            },
          },
        };
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-4/stages") {
        return {
          ok: true,
          data: {
            data: [
              { id: "s1", stageKey: "implement", orderIndex: 0, enabled: true },
              { id: "s2", stageKey: "verify", orderIndex: 1, enabled: true },
              { id: "s3", stageKey: "release", orderIndex: 2, enabled: true },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-5/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-5", currentStage: "implement", status: "running", templateId: "tpl-4" },
              stages: [
                { id: "run-implement", stageKey: "implement", status: "running" },
                { id: "run-verify", stageKey: "verify", status: "pending" },
                { id: "run-release", stageKey: "release", status: "pending" },
              ],
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-5/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/tasks/task-5b") {
        return {
          ok: true,
          data: {
            id: "task-5b",
            projectId: "proj-approval",
            strategy: JSON.stringify({
              workflowTemplateId: "tpl-4",
            }),
          },
        };
      }

      if (!options?.method && path === "/api/projects/proj-approval") {
        return {
          ok: true,
          data: {
            id: "proj-approval",
            settings: {
              allowBossAutoTemplateSwitch: true,
              preferredTemplateId: "tpl-approval",
              workflowTemplateId: "tpl-4",
            },
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-5b/operating-runtime/mode") {
        return {
          ok: true,
          data: {
            data: {
              selectedTemplateId: "tpl-4",
            },
          },
        };
      }

      if (!options?.method && path === "/api/workflow-templates/tpl-4/stages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "s1",
                stageKey: "verify",
                orderIndex: 0,
                enabled: true,
                stageTemplateStrategyJson: {
                  onWaitingApprovalTemplateId: "tpl-stage-approval",
                  note: "等待审批时切到审批模板。",
                },
              },
            ],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-5b/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-5b", currentStage: "verify", status: "running", templateId: "tpl-4" },
              stages: [{ id: "run-verify", stageKey: "verify", status: "running" }],
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-5b/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

    const { syncTaskWorkflowTerminalState } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync?terminal-stage-policy-waiting-approval"
    );

    await syncTaskWorkflowTerminalState({
      authorization: "Bearer test",
      taskId: "task-5b",
      status: "completed",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-5b/operating-runtime/boss-decisions", {
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
    });
  });

  test("treats human-review as escalation and persists runtime records", async () => {
    dispatchStageInterventionMock.mockResolvedValueOnce({
      disposition: "waiting-approval",
      decision: "human-review",
      reason: "需要人工复核关键风险。",
    });

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/workflow-templates/tpl-6/stages") {
        return {
          ok: true,
          data: {
            data: [{ id: "s1", stageKey: "verify", orderIndex: 0, enabled: true }],
          },
        };
      }

      if (!options?.method && path === "/api/tasks/task-6/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-6", currentStage: "verify", status: "running", templateId: "tpl-6" },
              stages: [{ id: "run-verify", stageKey: "verify", status: "running" }],
            },
          },
        };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-6/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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