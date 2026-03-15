/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async () => ({ ok: true, data: {} }));
const dispatchStageInterventionMock = mock(async () => ({ disposition: "continue", decision: "allow" }));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/stage-intervention", () => ({
  dispatchStageIntervention: dispatchStageInterventionMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  dispatchStageInterventionMock.mockReset();
  dispatchStageInterventionMock.mockResolvedValue({ disposition: "continue", decision: "allow" });
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
  });

  test("stops terminal progression and marks waiting approval when intervention requires approval", async () => {
    dispatchStageInterventionMock
      .mockResolvedValueOnce({ disposition: "continue", decision: "allow" })
      .mockResolvedValueOnce({
        disposition: "waiting-approval",
        decision: "needs-approval",
      });

    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
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
  });
});