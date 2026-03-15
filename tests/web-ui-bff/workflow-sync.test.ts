/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async () => ({ ok: true, data: {} }));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
});

describe("workflow-sync", () => {
  test("initializes workflow run at implement stage when template is selected and no run exists", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/tasks/task-1/workflow") {
        return { ok: true, data: { data: { workflowRun: null, stages: [] } } };
      }

      if (options?.method === "POST" && path === "/api/tasks/task-1/workflow/initialize") {
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
        currentStage: "implement",
      },
    });
  });

  test("advances completed tasks from current stage into verify when verify stage exists", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method && path === "/api/tasks/task-2/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { id: "wf-1", currentStage: "implement", status: "running", templateId: "tpl-1" },
              stages: [
                { id: "stage-implement", stageKey: "implement", status: "running" },
                { id: "stage-verify", stageKey: "verify", status: "pending" },
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

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-2/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "implement",
        toStage: "verify",
        status: "running",
      },
    });
  });

  test("marks current workflow stage as failed for terminal failure states", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
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
});