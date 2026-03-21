/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock((async (..._args: unknown[]) => ({ ok: true, data: {} })) as (
  ...args: unknown[]
) => Promise<{ ok: boolean; data: unknown }>);
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const authHeaderMock = mock(() => "Bearer test");
const extractAssistantResultFromMessagesMock = mock((() => ({
  completed: false,
  failed: false,
  error: undefined as string | undefined,
  tokenUsed: 0,
})) as () => { completed: boolean; failed: boolean; error?: string; tokenUsed: number });
const getAgentRunMock = mock(() => undefined);
const findAgentRunBySessionIdMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({ ok: true, data: [] }));
const listSessionsMock = mock(async () => ({ ok: true, data: [{ id: "session-1" }] }));
const recoverAgentRunMock = mock(() => undefined);
const runDetachedPromptMock = mock(async () => ({
  ok: true,
  text: "judge result",
  sessionId: "judge-ses",
}));
const updateAgentRunStatusMock = mock(() => undefined);
const persistWorkflowStageExecutionOutcomeMock = mock(async () => ({
  updated: true,
  advanced: false,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
  findAgentRunBySessionId: findAgentRunBySessionIdMock,
  getAgentRun: getAgentRunMock,
  getSessionMessages: getSessionMessagesMock,
  listSessions: listSessionsMock,
  recoverAgentRun: recoverAgentRunMock,
  runDetachedPrompt: runDetachedPromptMock,
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  persistWorkflowStageExecutionOutcome: persistWorkflowStageExecutionOutcomeMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  authHeaderMock.mockReset();
  extractAssistantResultFromMessagesMock.mockReset();
  getAgentRunMock.mockReset();
  findAgentRunBySessionIdMock.mockReset();
  getSessionMessagesMock.mockReset();
  listSessionsMock.mockReset();
  recoverAgentRunMock.mockReset();
  runDetachedPromptMock.mockReset();
  updateAgentRunStatusMock.mockReset();
  persistWorkflowStageExecutionOutcomeMock.mockReset();

  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  authHeaderMock.mockReturnValue("Bearer test");
  listSessionsMock.mockResolvedValue({ ok: true, data: [{ id: "session-1" }] });
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
  getAgentRunMock.mockReturnValue(undefined);
  findAgentRunBySessionIdMock.mockReturnValue(undefined);
  recoverAgentRunMock.mockReturnValue(undefined);
  runDetachedPromptMock.mockResolvedValue({
    ok: true,
    text: "judge result",
    sessionId: "judge-ses",
  });
  updateAgentRunStatusMock.mockImplementation(() => undefined);
  persistWorkflowStageExecutionOutcomeMock.mockResolvedValue({
    updated: true,
    advanced: false,
  });
  extractAssistantResultFromMessagesMock.mockReturnValue({
    completed: false,
    failed: true,
    error: "The operation was aborted.",
    tokenUsed: 0,
  });

  cpFetchMock.mockImplementation(async (...args: unknown[]) => {
    const [url, options] = args as [string, { method?: string; body?: unknown }?];
    if (!options?.method) {
      if (url.includes("/api/project-tree/tasks?status=running")) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-1",
                projectId: "proj-1",
                title: "Stuck task",
                status: "running",
                sessionId: "session-1",
                agentRunId: "run-1",
                createdAt: "2026-03-13T12:56:03.000Z",
                startedAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        };
      }

      if (url === "/api/project-tree/tasks?limit=200") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-1",
                projectId: "proj-1",
                title: "Stuck task",
                status: "running",
                sessionId: "session-1",
                agentRunId: "run-1",
                createdAt: "2026-03-13T12:56:03.000Z",
                startedAt: "2026-03-13T12:56:03.000Z",
                executionPlan: JSON.stringify({
                  templateId: "single-default",
                  mode: "single",
                  steps: [{ id: "exec-1", type: "execution", status: "running" }],
                  candidates: [
                    {
                      label: "Default executor",
                      agent: "default-executor",
                      sessionId: "session-1",
                      agentRunId: "run-1",
                      status: "running",
                      startedAt: "2026-03-13T12:56:03.000Z",
                    },
                  ],
                }),
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Stuck task",
            status: "running",
            sessionId: "session-1",
            agentRunId: "run-1",
            startedAt: "2026-03-13T12:56:03.000Z",
            executionPlan: JSON.stringify({
              templateId: "single-default",
              mode: "single",
              steps: [{ id: "exec-1", type: "execution", status: "running" }],
              candidates: [
                {
                  label: "Default executor",
                  agent: "default-executor",
                  sessionId: "session-1",
                  agentRunId: "run-1",
                  status: "running",
                  startedAt: "2026-03-13T12:56:03.000Z",
                },
              ],
            }),
          },
        };
      }

      if (url === "/api/tasks/task-1/branches") {
        return {
          ok: true,
          data: {
            data: [
              {
                runtimeSessionId: "session-1",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }
    }

    return { ok: true, data: { body: options?.body } };
  });
});

describe("reconcileRunningTasksOnStartup", () => {
  test("marks tasks failed when assistant messages contain embedded runtime errors", async () => {
    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.failed).toBe(1);
    expect(summary.completed).toBe(0);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "failed",
          result: "Recovered from failed assistant session: The operation was aborted.",
          executionPlan: expect.stringContaining('"status":"failed"'),
        }),
      }),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          runtimeSessionId: "session-1",
          isActive: false,
        }),
      }),
    );
  });

  test("marks single-candidate plans completed and closes active sessions during reconcile", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 42,
      text: "Final answer",
    });

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
          result: "Final answer",
          executionPlan: expect.stringContaining('"status":"completed"'),
        }),
      }),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          runtimeSessionId: "session-1",
          isActive: false,
        }),
      }),
    );
  });

  test("repairs historical terminal tasks whose candidate/session state never converged", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: false,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    });

    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, { method?: string; body?: unknown }?];
      if (!options?.method) {
        if (url.includes("/api/project-tree/tasks?status=running")) {
          return {
            ok: true,
            data: {
              data: [],
            },
          };
        }

        if (url === "/api/project-tree/tasks?limit=200") {
          return {
            ok: true,
            data: {
              data: [
                {
                  id: "task-historical",
                  projectId: "proj-1",
                  title: "Historical task",
                  status: "completed",
                  sessionId: "session-historical",
                  agentRunId: "run-historical",
                  result: "Already done",
                  finishedAt: "2026-03-13T13:10:00.000Z",
                  executionPlan: JSON.stringify({
                    templateId: "single-default",
                    mode: "single",
                    steps: [{ id: "exec-1", type: "execution", status: "running" }],
                    candidates: [
                      {
                        label: "Default executor",
                        agent: "default-executor",
                        sessionId: "session-historical",
                        agentRunId: "run-historical",
                        status: "running",
                        startedAt: "2026-03-13T12:56:03.000Z",
                      },
                    ],
                  }),
                },
              ],
            },
          };
        }

        if (url === "/api/tasks/task-historical/branches") {
          return {
            ok: true,
            data: {
              data: [
                {
                  runtimeSessionId: "session-historical",
                  isActive: true,
                  archivedAt: null,
                },
              ],
            },
          };
        }
      }

      return { ok: true, data: { body: options?.body } };
    });

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-historical",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
          result: "Already done",
          executionPlan: expect.stringContaining('"status":"completed"'),
        }),
      }),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-historical/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          runtimeSessionId: "session-historical",
          isActive: false,
        }),
      }),
    );
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-historical",
      authorization: "Bearer internal",
      resultText: "Already done",
      source: "assistant-output",
    });
  });

  test("repairs recently completed tasks with active sessions using the latest assistant output", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 12,
      text: "Verify stage complete\n[STAGE_COMPLETE]",
    });

    const recentFinishedAt = new Date().toISOString();

    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, { method?: string; body?: unknown }?];
      if (!options?.method) {
        if (url.includes("/api/project-tree/tasks?status=running")) {
          return { ok: true, data: { data: [] } };
        }

        if (url === "/api/project-tree/tasks?limit=200") {
          return {
            ok: true,
            data: {
              data: [
                {
                  id: "task-completed-active",
                  projectId: "proj-1",
                  title: "Completed but active session",
                  status: "completed",
                  sessionId: "session-completed-active",
                  agentRunId: "run-completed-active",
                  result: "Old result",
                  finishedAt: recentFinishedAt,
                  executionPlan: JSON.stringify({
                    templateId: "single-default",
                    mode: "single",
                    steps: [{ id: "exec-1", type: "execution", status: "completed" }],
                    candidates: [
                      {
                        label: "Default executor",
                        agent: "default-executor",
                        sessionId: "session-completed-active",
                        agentRunId: "run-completed-active",
                        status: "completed",
                        startedAt: recentFinishedAt,
                        finishedAt: recentFinishedAt,
                      },
                    ],
                  }),
                },
              ],
            },
          };
        }

        if (url === "/api/tasks/task-completed-active/branches") {
          return {
            ok: true,
            data: {
              data: [
                {
                  runtimeSessionId: "session-completed-active",
                  isActive: true,
                  archivedAt: null,
                },
              ],
            },
          };
        }
      }

      return { ok: true, data: { body: options?.body } };
    });

    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [{ id: "msg-1" }],
    });

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-completed-active",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
          result: "Verify stage complete\n[STAGE_COMPLETE]",
          executionPlan: expect.stringContaining('"status":"completed"'),
        }),
      }),
    );
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-completed-active",
      authorization: "Bearer internal",
      resultText: "Verify stage complete\n[STAGE_COMPLETE]",
      source: "assistant-output",
    });
  });
});
