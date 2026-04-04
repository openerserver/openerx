/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    cpFetch: cpFetchMock,
    createInternalAuthorization: createInternalAuthorizationMock,
  }),
);

async function loadFinalizeModule() {
  return import("../../control-plane/web-ui-bff/src/modules/tasks/finalize?task-finalize-test");
}

describe("finalizeTaskState", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    createInternalAuthorizationMock.mockReset();

    cpFetchMock.mockResolvedValue({ ok: true, data: {} });
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("finalization patch does not include legacy runtime plan fields", async () => {
    const { finalizeTaskState } = await loadFinalizeModule();

    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [
        string,
        { method?: string; body?: Record<string, unknown> } | undefined,
      ];
      if (url === "/api/tasks/task-projection-parallel/sessions") {
        if (options?.method === "POST") {
          return { ok: true, data: { ok: true } };
        }

        return { ok: true, data: { data: [] } };
      }

      if (url === "/api/tasks/task-projection-parallel" && options?.method === "PATCH") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

    const finalized = await finalizeTaskState({
      authorization: "Bearer test",
      taskId: "task-projection-parallel",
      status: "completed",
      syncWorkflowTerminalState: false,
      sessionId: "ses-projection-a",
      agentRunId: "run-projection-a",
      result: "projection result",
      task: {
        id: "task-projection-parallel",
        status: "running",
        sessionId: "ses-root",
        agentRunId: "run-root",
        orchestrationKind: "parallel",
        currentRunId: "run-domain-1",
        startedAt: "2026-03-22T00:00:00.000Z",
      },
    });

    expect(finalized).toBe(true);

    const patchCall = (
      cpFetchMock.mock.calls as Array<[string, { method?: string; body?: Record<string, unknown> }]>
    ).find(
      ([url, options]) =>
        url === "/api/tasks/task-projection-parallel" && options?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();

    const patchBody = patchCall?.[1]?.body as Record<string, unknown> | undefined;

    expect(patchBody).toMatchObject({
      status: "completed",
      sessionId: "ses-projection-a",
      agentRunId: "run-projection-a",
      result: "projection result",
    });
    expect(patchBody).not.toHaveProperty("executionPlan");
    expect(patchBody).not.toHaveProperty("parallelRunHistory");
  });
});
