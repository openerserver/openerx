/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createOpencodeAdapterModuleMock } from "./opencode-adapter-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";
import { expectSessionMessageReaderCalls } from "./session-message-compatibility-test-helpers";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const setControlPlaneFetchHandlerMock = mock(() => undefined);
const listSessionsMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const continueSessionMock = mock(async () => ({ ok: true }));
const forkSessionMock = mock(async () => ({ ok: true, sessionId: "session-2" }));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () =>
  createOpencodeAdapterModuleMock({
    continueSession: continueSessionMock,
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    ensureAgentRunForSession: mock(() => "run-1"),
    extractAssistantResultFromMessages: mock(() => ({
      completed: false,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    })),
    forkSession: forkSessionMock,
    getAgentRun: mock(() => undefined),
    getSessionMessages: getSessionMessagesMock,
    listSessions: listSessionsMock,
    recoverAgentRun: mock(() => undefined),
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
    injectGuidance: mock(async () => ({ ok: true })),
    findAgentRunBySessionId: mock(() => undefined),
    listAgentRuns: mock(() => []),
    listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
    pauseAgent: mock(async () => ({ ok: true })),
    registerAgentRun: mock(() => undefined),
    replyRuntimePermission: mock(async () => ({ ok: true })),
    resumeAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: mock(async () => ({ ok: true, data: {} })),
    terminateAgent: mock(async () => ({ ok: true })),
    updateAgentRunStatus: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  mergeStageAndStrategyHooks: mock(
    (_stageHooks: unknown, strategyHooks: unknown) => strategyHooks ?? [],
  ),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
  recordModelUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  syncGraphsForSessionTask: mock(async () => undefined),
  syncGraphsForTask: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () =>
  createSseAggregatorModuleMock({
    registerParallelTask: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  listSessionsMock.mockReset();
  getSessionMessagesMock.mockReset();
  continueSessionMock.mockReset();
  forkSessionMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  listSessionsMock.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "session-1",
        title: "[Task task-1] finished session",
        summary: { additions: 1, deletions: 0, files: 1 },
        time: {
          created: Date.parse("2026-03-14T10:00:00.000Z"),
          updated: Date.parse("2026-03-14T10:05:00.000Z"),
        },
      },
    ],
  });
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
  continueSessionMock.mockResolvedValue({ ok: true });
  forkSessionMock.mockResolvedValue({ ok: true, sessionId: "session-2" });

  cpFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/project-tree/tasks/task-1") {
      return {
        ok: true,
        data: {
          id: "task-1",
          title: "finished task",
          status: "completed",
          sessionId: "session-1",
        },
      };
    }
    return { ok: true, data: {} };
  });
});

describe("task sessions route", () => {
  test("marks the task session as active when it matches the persisted sessionId", async () => {
    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/sessions", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "session-1",
          taskSessionId: "task-session:task-1:session-1",
          title: "[Task task-1] finished session",
          isActive: true,
          summary: { additions: 1, deletions: 0, files: 1 },
          createdAt: "2026-03-14T10:00:00.000Z",
          updatedAt: "2026-03-14T10:05:00.000Z",
        },
      ],
    });
  });

  test("surfaces sequential step metadata from session-first summaries", async () => {
    listSessionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "session-1",
          title: "runtime generic title",
          summary: { additions: 0, deletions: 0, files: 0 },
          time: {
            created: Date.parse("2026-03-14T10:00:00.000Z"),
            updated: Date.parse("2026-03-14T10:05:00.000Z"),
          },
        },
      ],
    });
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "running",
            sessionId: "session-1",
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:session-1",
                runtimeSessionId: "session-1",
                branchName: "finished task — 分析现状",
                sessionKind: "sequential_step",
                executionModeSnapshot: "sequential_chain",
                executionStatus: "running",
                stepIndex: 0,
                selectedModel: "gpt-5-mini",
                isActive: true,
                archivedAt: null,
                createdAt: "2026-03-14T10:00:00.000Z",
                updatedAt: "2026-03-14T10:05:00.000Z",
              },
            ],
            meta: {
              currentSessionId: "task-session:task-1:session-1",
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/sessions", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: "session-1",
          taskSessionId: "task-session:task-1:session-1",
          title: "finished task — 分析现状",
          isActive: true,
          summary: { additions: 0, deletions: 0, files: 0 },
          createdAt: "2026-03-14T10:00:00.000Z",
          updatedAt: "2026-03-14T10:05:00.000Z",
          executionStatus: "running",
          sessionKind: "sequential_step",
          stepIndex: 0,
          selectedModel: "gpt-5-mini",
          executionModeSnapshot: "sequential_chain",
        }),
      ],
    });
  });

  test("reads task session messages from the session-first cache before runtime fallback", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:session-1",
                runtimeSessionId: "session-1",
                parentRuntimeSessionId: null,
                sourceType: "root",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Asession-1/messages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-message-1",
                runtimeMessageId: "runtime-message-1",
                role: "user",
                textContent: "session-first prompt",
                createdAt: "2026-03-20T10:00:00.000Z",
                parts: [
                  {
                    id: "db-part-1",
                    partType: "text",
                    textContent: "session-first prompt",
                    jsonPayload: {},
                  },
                ],
              },
              {
                id: "db-message-2",
                runtimeMessageId: "runtime-message-2",
                role: "assistant",
                textContent: "session-first reply",
                createdAt: "2026-03-20T10:00:05.000Z",
                completedAt: "2026-03-20T10:00:08.000Z",
                parts: [
                  {
                    id: "db-part-2",
                    partType: "text",
                    textContent: "session-first reply",
                    jsonPayload: {},
                  },
                ],
              },
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "task-session:task-1:session-1",
              messageCount: 2,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/sessions/session-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: "runtime-message-1",
          role: "user",
          text: "session-first prompt",
        }),
        expect.objectContaining({
          id: "runtime-message-2",
          role: "assistant",
          text: "session-first reply",
        }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-1",
        messageCount: 2,
        cacheState: "partial",
        complete: false,
        itemCount: 2,
        cachedSessionCount: 1,
      }),
    });
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("reads task-level conversation messages from the task-first cache", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1/messages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-message-1",
                runtimeMessageId: "runtime-message-1",
                role: "user",
                textContent: "task-level prompt",
                createdAt: "2026-03-20T10:00:00.000Z",
                parts: [
                  {
                    id: "db-part-1",
                    partType: "text",
                    textContent: "task-level prompt",
                    jsonPayload: {},
                  },
                ],
              },
              {
                id: "db-message-2",
                runtimeMessageId: "runtime-message-2",
                role: "assistant",
                textContent: "task-level reply",
                createdAt: "2026-03-20T10:00:05.000Z",
                completedAt: "2026-03-20T10:00:08.000Z",
                parts: [
                  {
                    id: "db-part-2",
                    partType: "text",
                    textContent: "task-level reply",
                    jsonPayload: {},
                  },
                ],
              },
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "session-1",
              messageCount: 2,
              includeLineage: true,
              cachedSessionCount: 1,
              cacheState: "complete",
              complete: true,
              itemCount: 2,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: "runtime-message-1",
          role: "user",
          text: "task-level prompt",
        }),
        expect.objectContaining({
          id: "runtime-message-2",
          role: "assistant",
          text: "task-level reply",
        }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-1",
        messageCount: 2,
        cacheState: "complete",
        complete: true,
        itemCount: 2,
        cachedSessionCount: 1,
      }),
    });
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("filters latest pending parallel candidate messages from task-level conversation tail", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                parentRuntimeSessionId: null,
                sessionKind: "primary",
                coordinationKey: "coord-1",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:00:00.000Z",
                archivedAt: null,
              },
              {
                id: "ts-candidate-a",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "session-root",
                sessionKind: "manual_branch",
                candidateIndex: 0,
                coordinationKey: "coord-1",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:00:01.000Z",
                archivedAt: null,
              },
              {
                id: "ts-candidate-b",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "session-root",
                sessionKind: "manual_branch",
                candidateIndex: 1,
                coordinationKey: "coord-1",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:00:02.000Z",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/messages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-message-user-1",
                runtimeMessageId: "runtime-user-1",
                role: "user",
                textContent: "并行比较这个方案",
                createdAt: "2026-03-20T10:00:00.000Z",
                rawPayload: {
                  info: {
                    id: "runtime-user-1",
                    role: "user",
                    sessionID: "session-root",
                    time: {
                      created: "2026-03-20T10:00:00.000Z",
                    },
                  },
                },
                parts: [
                  {
                    id: "db-part-user-1",
                    partType: "text",
                    textContent: "并行比较这个方案",
                    jsonPayload: {},
                  },
                ],
              },
              {
                id: "db-message-candidate-a",
                runtimeMessageId: "runtime-candidate-a",
                role: "assistant",
                textContent: "候选 A 输出",
                createdAt: "2026-03-20T10:00:05.000Z",
                completedAt: "2026-03-20T10:00:06.000Z",
                rawPayload: {
                  info: {
                    id: "runtime-candidate-a",
                    role: "assistant",
                    sessionID: "session-a",
                    time: {
                      created: "2026-03-20T10:00:05.000Z",
                      completed: "2026-03-20T10:00:06.000Z",
                    },
                  },
                },
                parts: [
                  {
                    id: "db-part-candidate-a",
                    partType: "text",
                    textContent: "候选 A 输出",
                    jsonPayload: {},
                  },
                ],
              },
              {
                id: "db-message-candidate-b",
                runtimeMessageId: "runtime-candidate-b",
                role: "assistant",
                textContent: "候选 B 输出",
                createdAt: "2026-03-20T10:00:07.000Z",
                completedAt: "2026-03-20T10:00:08.000Z",
                rawPayload: {
                  info: {
                    id: "runtime-candidate-b",
                    role: "assistant",
                    sessionID: "session-b",
                    time: {
                      created: "2026-03-20T10:00:07.000Z",
                      completed: "2026-03-20T10:00:08.000Z",
                    },
                  },
                },
                parts: [
                  {
                    id: "db-part-candidate-b",
                    partType: "text",
                    textContent: "候选 B 输出",
                    jsonPayload: {},
                  },
                ],
              },
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "session-root",
              messageCount: 3,
              includeLineage: true,
              cachedSessionCount: 3,
              cacheState: "complete",
              complete: true,
              itemCount: 3,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: "runtime-user-1",
          role: "user",
          text: "并行比较这个方案",
        }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-root",
        messageCount: 1,
        cacheState: "complete",
        complete: true,
        itemCount: 1,
        cachedSessionCount: 3,
      }),
    });
  });

  test("filters adopted parallel candidate and anchor follow-up messages from task-level conversation", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                parentRuntimeSessionId: null,
                sessionKind: "primary",
                archivedAt: null,
              },
              {
                id: "ts-anchor",
                runtimeSessionId: "session-anchor",
                parentRuntimeSessionId: "session-root",
                sessionKind: "resume",
                coordinationKey: "coord-1",
                winnerSessionId: "session-a",
                createdAt: "2026-03-20T10:00:01.000Z",
                archivedAt: null,
              },
              {
                id: "ts-candidate-a",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "session-anchor",
                sessionKind: "candidate",
                candidateIndex: 0,
                coordinationKey: "coord-1",
                winnerSessionId: "session-a",
                createdAt: "2026-03-20T10:00:02.000Z",
                archivedAt: null,
              },
              {
                id: "ts-candidate-b",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "session-anchor",
                sessionKind: "candidate",
                candidateIndex: 1,
                coordinationKey: "coord-1",
                winnerSessionId: "session-a",
                createdAt: "2026-03-20T10:00:03.000Z",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/messages") {
        const buildMessage = (
          id: string,
          role: "user" | "assistant",
          text: string,
          createdAt: string,
          sessionId: string,
        ) => ({
          id: `db-${id}`,
          runtimeMessageId: id,
          role,
          textContent: text,
          createdAt,
          completedAt: role === "assistant" ? createdAt : undefined,
          rawPayload: {
            info: {
              id,
              role,
              sessionID: sessionId,
              time: {
                created: createdAt,
                ...(role === "assistant" ? { completed: createdAt } : {}),
              },
            },
          },
          parts: [
            {
              id: `part-${id}`,
              partType: "text",
              textContent: text,
              jsonPayload: {},
            },
          ],
        });

        return {
          ok: true,
          data: {
            data: [
              buildMessage("runtime-root-user", "user", "主线提示", "2026-03-20T10:00:00.000Z", "session-root"),
              buildMessage("runtime-anchor-user", "user", "再给我几个边界条件", "2026-03-20T10:00:01.000Z", "session-anchor"),
              buildMessage("runtime-anchor-context", "user", "Execution context: adopted round", "2026-03-20T10:00:01.500Z", "session-anchor"),
              buildMessage("runtime-candidate-a", "assistant", "候选 A 输出", "2026-03-20T10:00:05.000Z", "session-a"),
              buildMessage("runtime-candidate-b", "assistant", "候选 B 输出", "2026-03-20T10:00:06.000Z", "session-b"),
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "session-root",
              messageCount: 5,
              includeLineage: true,
              cachedSessionCount: 4,
              cacheState: "complete",
              complete: true,
              itemCount: 5,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({ id: "runtime-root-user", role: "user", text: "主线提示" }),
        expect.objectContaining({ id: "runtime-anchor-user", role: "user", text: "再给我几个边界条件" }),
        expect.objectContaining({ id: "runtime-candidate-a", role: "assistant", text: "候选 A 输出" }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-root",
        messageCount: 3,
        cacheState: "complete",
        complete: true,
        itemCount: 3,
        cachedSessionCount: 4,
      }),
    });
  });

  test("keeps the root workflow execution-context as a dedicated workflow block", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                parentRuntimeSessionId: null,
                sessionKind: "primary",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/messages") {
        const buildMessage = (
          id: string,
          role: "user" | "assistant",
          text: string,
          createdAt: string,
          sessionId: string,
        ) => ({
          id: `db-${id}`,
          runtimeMessageId: id,
          role,
          textContent: text,
          createdAt,
          completedAt: role === "assistant" ? createdAt : undefined,
          rawPayload: {
            info: {
              id,
              role,
              sessionID: sessionId,
              time: {
                created: createdAt,
                ...(role === "assistant" ? { completed: createdAt } : {}),
              },
            },
          },
          parts: [
            {
              id: `part-${id}`,
              partType: "text",
              textContent: text,
              jsonPayload: {},
            },
          ],
        });

        return {
          ok: true,
          data: {
            data: [
              buildMessage(
                "runtime-root-user",
                "user",
                "/start-work 真正的用户输入",
                "2026-03-20T10:00:00.000Z",
                "session-root",
              ),
              buildMessage(
                "runtime-root-context",
                "user",
                [
                  "Execution context:",
                  "- Opener-X task ID: task-1",
                  "- Project ID: project-1",
                  "",
                  "## 当前执行上下文",
                  "任务：demo task",
                  "流程状态：pending",
                  "当前阶段：需求进入",
                  "执行 Agent：explore-enterprise",
                  "执行模型：github-copilot:gpt-5-mini",
                  "请只完成当前阶段的目标。",
                  "/start-work 真正的用户输入",
                ].join("\n"),
                "2026-03-20T10:00:01.000Z",
                "session-root",
              ),
              buildMessage(
                "runtime-root-assistant",
                "assistant",
                "已完成需求梳理",
                "2026-03-20T10:00:02.000Z",
                "session-root",
              ),
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "session-root",
              messageCount: 3,
              includeLineage: true,
              cachedSessionCount: 1,
              cacheState: "complete",
              complete: true,
              itemCount: 3,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        expect.objectContaining({
          id: "runtime-root-user",
          role: "user",
          text: "/start-work 真正的用户输入",
        }),
        expect.objectContaining({
          _type: "workflow_group",
          info: expect.objectContaining({
            role: "workflow",
            variant: "context",
            label: "工作流消息",
          }),
          steps: [
            expect.objectContaining({
              agentName: "需求进入",
              sessionId: "session-root",
              messages: [
                expect.objectContaining({
                  role: "workflow",
                  text: expect.stringContaining("当前阶段：需求进入"),
                }),
              ],
            }),
          ],
        }),
        expect.objectContaining({
          id: "runtime-root-assistant",
          role: "assistant",
          text: "已完成需求梳理",
        }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-root",
        messageCount: 3,
        cacheState: "complete",
        complete: true,
        itemCount: 3,
        cachedSessionCount: 1,
      }),
    });
  });

  test("merges runtime workflow sub-sessions into the dedicated workflow block and preserves an explicit root context step when projected", async () => {
    listSessionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "session-root",
          title:
            "[Task task-1] ## 当前执行上下文\n任务：macos下的聊天软件\n流程状态：pending\n当前阶段：需求进入",
          time: {
            created: Date.parse("2026-03-20T10:00:00.000Z"),
            updated: Date.parse("2026-03-20T10:00:03.000Z"),
          },
        },
        {
          id: "session-product",
          title: "[clarify] 产品 Agent / macos下的聊天软件",
          time: {
            created: Date.parse("2026-03-20T10:00:04.000Z"),
            updated: Date.parse("2026-03-20T10:00:05.000Z"),
          },
        },
        {
          id: "session-architect-final",
          title: "[clarify] 架构师 Agent / macos下的聊天软件",
          time: {
            created: Date.parse("2026-03-20T10:00:06.000Z"),
            updated: Date.parse("2026-03-20T10:00:07.000Z"),
          },
        },
        {
          id: "session-architect-tools",
          title: "[clarify] 架构师 Agent / macos下的聊天软件",
          time: {
            created: Date.parse("2026-03-20T10:00:06.500Z"),
            updated: Date.parse("2026-03-20T10:00:08.000Z"),
          },
        },
        {
          id: "session-security-final",
          title: "[clarify] 安全 Agent / macos下的聊天软件",
          time: {
            created: Date.parse("2026-03-20T10:00:08.000Z"),
            updated: Date.parse("2026-03-20T10:00:09.000Z"),
          },
        },
        {
          id: "session-security-tools",
          title: "[clarify] 安全 Agent / macos下的聊天软件",
          time: {
            created: Date.parse("2026-03-20T10:00:08.500Z"),
            updated: Date.parse("2026-03-20T10:00:10.000Z"),
          },
        },
      ],
    });

    const buildRuntimeMessage = (
      id: string,
      role: "user" | "assistant",
      text: string,
      createdAt: string,
      options?: { finish?: string },
    ) => ({
      id,
      info: {
        id,
        role,
        ...(options?.finish ? { finish: options.finish } : {}),
        time: {
          created: Date.parse(createdAt),
          ...(role === "assistant" ? { completed: Date.parse(createdAt) } : {}),
        },
      },
      parts: text
        ? [
            {
              id: `${id}-text`,
              type: "text",
              text,
            },
          ]
        : [],
    });

    getSessionMessagesMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === "session-product") {
        return {
          ok: true,
          data: [
            buildRuntimeMessage(
              "runtime-product-user",
              "user",
              "Execution context:\n- Opener-X task ID: task-1\n\n你当前作为 产品 Agent 参与需求澄清。",
              "2026-03-20T10:00:04.000Z",
            ),
            buildRuntimeMessage(
              "runtime-product-assistant",
              "assistant",
              "产品侧建议先澄清核心使用场景和目标用户。",
              "2026-03-20T10:00:05.000Z",
              { finish: "stop" },
            ),
          ],
        };
      }

      if (sessionId === "session-architect-final") {
        return {
          ok: true,
          data: [
            buildRuntimeMessage(
              "runtime-architect-user",
              "user",
              "Execution context:\n- Opener-X task ID: task-1\n\n你当前作为 架构师 Agent 参与需求澄清。",
              "2026-03-20T10:00:06.000Z",
            ),
            buildRuntimeMessage(
              "runtime-architect-assistant",
              "assistant",
              "架构侧建议先确认客户端形态、后端接口和同步策略。",
              "2026-03-20T10:00:07.000Z",
              { finish: "stop" },
            ),
          ],
        };
      }

      if (sessionId === "session-architect-tools") {
        return {
          ok: true,
          data: [
            buildRuntimeMessage(
              "runtime-architect-tools-user",
              "user",
              "Execution context:\n- Opener-X task ID: task-1\n\n你当前作为 架构师 Agent 参与需求澄清。",
              "2026-03-20T10:00:06.500Z",
            ),
            buildRuntimeMessage(
              "runtime-architect-tools-assistant",
              "assistant",
              "",
              "2026-03-20T10:00:08.000Z",
              { finish: "tool-calls" },
            ),
          ],
        };
      }

      if (sessionId === "session-security-final") {
        return {
          ok: true,
          data: [
            buildRuntimeMessage(
              "runtime-security-user",
              "user",
              "Execution context:\n- Opener-X task ID: task-1\n\n你当前作为 安全 Agent 参与需求澄清。",
              "2026-03-20T10:00:08.000Z",
            ),
            buildRuntimeMessage(
              "runtime-security-assistant",
              "assistant",
              "安全侧建议先明确认证方式、数据加密和权限边界。",
              "2026-03-20T10:00:09.000Z",
              { finish: "stop" },
            ),
          ],
        };
      }

      if (sessionId === "session-security-tools") {
        return {
          ok: true,
          data: [
            buildRuntimeMessage(
              "runtime-security-tools-user",
              "user",
              "Execution context:\n- Opener-X task ID: task-1\n\n你当前作为 安全 Agent 参与需求澄清。",
              "2026-03-20T10:00:08.500Z",
            ),
            buildRuntimeMessage(
              "runtime-security-tools-assistant",
              "assistant",
              "",
              "2026-03-20T10:00:10.000Z",
              { finish: "tool-calls" },
            ),
          ],
        };
      }

      return { ok: true, data: [] };
    });

    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "macos下的聊天软件",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                parentRuntimeSessionId: null,
                sessionKind: "primary",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/messages") {
        const buildMessage = (
          id: string,
          role: "user" | "assistant",
          text: string,
          createdAt: string,
          sessionId: string,
        ) => ({
          id: `db-${id}`,
          runtimeMessageId: id,
          role,
          textContent: text,
          createdAt,
          completedAt: role === "assistant" ? createdAt : undefined,
          rawPayload: {
            info: {
              id,
              role,
              sessionID: sessionId,
              time: {
                created: createdAt,
                ...(role === "assistant" ? { completed: createdAt } : {}),
              },
            },
          },
          parts: [
            {
              id: `part-${id}`,
              partType: "text",
              textContent: text,
              jsonPayload: {},
            },
          ],
        });

        return {
          ok: true,
          data: {
            data: [
              buildMessage(
                "runtime-root-user",
                "user",
                "/start-work 真正的用户输入",
                "2026-03-20T10:00:00.000Z",
                "session-root",
              ),
              buildMessage(
                "runtime-root-context",
                "user",
                [
                  "Execution context:",
                  "- Opener-X task ID: task-1",
                  "## 当前执行上下文",
                  "当前阶段：需求进入",
                  "执行 Agent：explore-enterprise",
                  "/start-work 真正的用户输入",
                ].join("\n"),
                "2026-03-20T10:00:01.000Z",
                "session-root",
              ),
              buildMessage(
                "runtime-root-assistant",
                "assistant",
                "已完成需求梳理",
                "2026-03-20T10:00:02.000Z",
                "session-root",
              ),
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "session-root",
              messageCount: 3,
              includeLineage: true,
              cachedSessionCount: 1,
              cacheState: "complete",
              complete: true,
              itemCount: 3,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta).toEqual(
      expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-root",
        messageCount: 3,
        cacheState: "complete",
        complete: true,
        itemCount: 3,
        cachedSessionCount: 1,
      }),
    );
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime-root-user",
          role: "user",
          text: "/start-work 真正的用户输入",
        }),
        expect.objectContaining({
          _type: "workflow_group",
        }),
        expect.objectContaining({
          id: "runtime-root-assistant",
          role: "assistant",
          text: "已完成需求梳理",
        }),
      ]),
    );

    const workflowGroup = body.data.find((item: { _type?: string }) => item?._type === "workflow_group");
    expect(workflowGroup).toBeTruthy();
    expect(workflowGroup.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentName: "产品 Agent",
          sessionId: "session-product",
          messages: expect.any(Array),
        }),
        expect.objectContaining({
          agentName: "架构师 Agent",
          sessionId: "session-architect-final",
          messages: expect.arrayContaining([
            expect.objectContaining({
              info: expect.objectContaining({ role: "user" }),
            }),
            expect.objectContaining({
              info: expect.objectContaining({ role: "assistant", finish: "stop" }),
            }),
          ]),
        }),
        expect.objectContaining({
          agentName: "安全 Agent",
          sessionId: "session-security-final",
          messages: expect.arrayContaining([
            expect.objectContaining({
              info: expect.objectContaining({ role: "assistant", finish: "stop" }),
            }),
          ]),
        }),
      ]),
    );

    const stepCounts = new Map(
      workflowGroup.steps.map((step: { agentName: string; messages: unknown[] }) => [
        step.agentName,
        step.messages.length,
      ]),
    );
    expect(stepCounts.get("产品 Agent")).toBe(2);
    expect(stepCounts.get("架构师 Agent")).toBe(2);
    expect(stepCounts.get("安全 Agent")).toBe(2);

    const contextStep = workflowGroup.steps.find(
      (step: { agentName?: string }) => step.agentName === "需求进入",
    );
    expect(contextStep).toBeTruthy();
    expect(contextStep).toEqual(
      expect.objectContaining({
        sessionId: "session-root",
        messages: [
          expect.objectContaining({
            role: "workflow",
          }),
        ],
      }),
    );
    expect(stepCounts.get("需求进入")).toBe(1);
  });

  test("keeps older pending parallel messages when only the newest parallel batch is still current", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                parentRuntimeSessionId: null,
                sessionKind: "primary",
                archivedAt: null,
              },
              {
                id: "ts-old-a",
                runtimeSessionId: "session-old-a",
                parentRuntimeSessionId: "session-root",
                sessionKind: "manual_branch",
                candidateIndex: 0,
                coordinationKey: "coord-old",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:00:01.000Z",
                archivedAt: null,
              },
              {
                id: "ts-old-b",
                runtimeSessionId: "session-old-b",
                parentRuntimeSessionId: "session-root",
                sessionKind: "manual_branch",
                candidateIndex: 1,
                coordinationKey: "coord-old",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:00:02.000Z",
                archivedAt: null,
              },
              {
                id: "ts-new-a",
                runtimeSessionId: "session-new-a",
                parentRuntimeSessionId: "session-root",
                sessionKind: "manual_branch",
                candidateIndex: 0,
                coordinationKey: "coord-new",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:01:01.000Z",
                archivedAt: null,
              },
              {
                id: "ts-new-b",
                runtimeSessionId: "session-new-b",
                parentRuntimeSessionId: "session-root",
                sessionKind: "manual_branch",
                candidateIndex: 1,
                coordinationKey: "coord-new",
                winnerSessionId: null,
                createdAt: "2026-03-20T10:01:02.000Z",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/messages") {
        const buildMessage = (
          id: string,
          role: "user" | "assistant",
          text: string,
          createdAt: string,
          sessionId: string,
        ) => ({
          id: `db-${id}`,
          runtimeMessageId: id,
          role,
          textContent: text,
          createdAt,
          completedAt: role === "assistant" ? createdAt : undefined,
          rawPayload: {
            info: {
              id,
              role,
              sessionID: sessionId,
              time: {
                created: createdAt,
                ...(role === "assistant" ? { completed: createdAt } : {}),
              },
            },
          },
          parts: [
            {
              id: `part-${id}`,
              partType: "text",
              textContent: text,
              jsonPayload: {},
            },
          ],
        });

        return {
          ok: true,
          data: {
            data: [
              buildMessage("runtime-user-old", "user", "第一次并行", "2026-03-20T10:00:00.000Z", "session-root"),
              buildMessage("runtime-old-a", "assistant", "旧候选 A", "2026-03-20T10:00:05.000Z", "session-old-a"),
              buildMessage("runtime-old-b", "assistant", "旧候选 B", "2026-03-20T10:00:06.000Z", "session-old-b"),
              buildMessage("runtime-user-new", "user", "第二次并行", "2026-03-20T10:01:00.000Z", "session-root"),
              buildMessage("runtime-new-a", "assistant", "新候选 A", "2026-03-20T10:01:05.000Z", "session-new-a"),
              buildMessage("runtime-new-b", "assistant", "新候选 B", "2026-03-20T10:01:06.000Z", "session-new-b"),
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "session-root",
              messageCount: 6,
              includeLineage: true,
              cachedSessionCount: 5,
              cacheState: "complete",
              complete: true,
              itemCount: 6,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({ id: "runtime-user-old", role: "user", text: "第一次并行" }),
        expect.objectContaining({ id: "runtime-old-a", role: "assistant", text: "旧候选 A" }),
        expect.objectContaining({ id: "runtime-old-b", role: "assistant", text: "旧候选 B" }),
        expect.objectContaining({ id: "runtime-user-new", role: "user", text: "第二次并行" }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-root",
        messageCount: 4,
        cacheState: "complete",
        complete: true,
        itemCount: 4,
        cachedSessionCount: 5,
      }),
    });
  });

  test("keeps partial session-first messages when no assistant reply is cached yet", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:session-1",
                runtimeSessionId: "session-1",
                parentRuntimeSessionId: null,
                sourceType: "root",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/task-session%3Atask-1%3Asession-1/messages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-message-1",
                runtimeMessageId: "runtime-message-1",
                role: "user",
                textContent: "session-first prompt",
                createdAt: "2026-03-20T10:00:00.000Z",
                parts: [
                  {
                    id: "db-part-1",
                    partType: "text",
                    textContent: "session-first prompt",
                    jsonPayload: {},
                  },
                ],
              },
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "task-session:task-1:session-1",
              messageCount: 1,
              cacheState: "partial",
              complete: false,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });
    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/sessions/session-1/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: "runtime-message-1",
          role: "user",
          text: "session-first prompt",
        }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        includeLineage: true,
        sessionId: "session-1",
        cacheState: "partial",
        complete: false,
        messageCount: 1,
      }),
    });
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });

  test("activates task session by runtime session id via lineage record", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                isActive: true,
                archivedAt: null,
              },
              {
                id: "ts-leaf",
                runtimeSessionId: "session-leaf",
                branchName: "branch-leaf",
                isActive: false,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/ts-leaf/activate" && options?.method === "POST") {
        return { ok: true, data: { ok: true } };
      }

      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/sessions/session-leaf/activate",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, sessionId: "session-leaf" });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/sessions/ts-leaf/activate", {
      method: "POST",
      authorization: "Bearer test",
    });
  });

  test("archives task session by runtime session id via lineage record", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                isActive: true,
                archivedAt: null,
              },
              {
                id: "ts-leaf",
                runtimeSessionId: "session-leaf",
                branchName: "branch-leaf",
                isActive: false,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/ts-leaf/archive" && options?.method === "POST") {
        return { ok: true, data: { ok: true } };
      }

      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/sessions/session-leaf/archive",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/sessions/ts-leaf/archive", {
      method: "POST",
      authorization: "Bearer test",
    });
  });

  test("forks task session via session route", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "project-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                sourceType: "root",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && options?.method === "POST") {
        return {
          ok: true,
          data: {
            data: {
              id: "ts-branch",
              runtimeSessionId: "session-2",
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/sessions/session-root/fork",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "新分支", messageId: "msg-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sessionId: "session-2",
      taskSessionId: "task-session:task-1:session-2",
      title: "新分支",
      parentSessionId: "session-root",
      parentTaskSessionId: "task-session:task-1:session-root",
      forkedFromMessageId: "msg-1",
    });
  });

  test("fork route resolves canonical task session ids to runtime sessions", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "project-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-1:session-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                sourceType: "root",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && options?.method === "POST") {
        return {
          ok: true,
          data: {
            data: {
              id: "task-session:task-1:session-2",
              runtimeSessionId: "session-2",
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/sessions/task-session%3Atask-1%3Asession-root/fork",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Canonical 分支" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sessionId: "session-2",
      taskSessionId: "task-session:task-1:session-2",
      title: "Canonical 分支",
      parentSessionId: "session-root",
      parentTaskSessionId: "task-session:task-1:session-root",
    });
    expect(forkSessionMock).toHaveBeenCalledWith("session-root", { title: "Canonical 分支" });
  });

  test("builds session-lineage previews from session messages instead of public trace reads", async () => {
    listSessionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "session-root",
          title: "main",
          time: {
            created: Date.parse("2026-03-14T10:00:00.000Z"),
            updated: Date.parse("2026-03-14T10:05:00.000Z"),
          },
        },
        {
          id: "session-leaf",
          title: "branch-a",
          time: {
            created: Date.parse("2026-03-14T10:06:00.000Z"),
            updated: Date.parse("2026-03-14T10:07:00.000Z"),
          },
        },
      ],
    });
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                sourceType: "root",
                isActive: true,
                archivedAt: null,
                parentRuntimeSessionId: null,
                forkedFromMessageId: null,
                createdAt: "2026-03-14T10:00:00.000Z",
                updatedAt: "2026-03-14T10:05:00.000Z",
              },
              {
                id: "ts-leaf",
                runtimeSessionId: "session-leaf",
                branchName: "branch-a",
                sourceType: "fork",
                isActive: false,
                archivedAt: null,
                parentRuntimeSessionId: "session-root",
                forkedFromMessageId: "msg-1",
                createdAt: "2026-03-14T10:06:00.000Z",
                updatedAt: "2026-03-14T10:07:00.000Z",
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/ts-root/messages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-root-message-1",
                runtimeMessageId: "msg-1",
                role: "assistant",
                textContent: "父分支里的回答摘要",
                createdAt: "2026-03-14T10:01:00.000Z",
                parts: [
                  {
                    id: "db-root-part-1",
                    partType: "text",
                    textContent: "父分支里的回答摘要",
                    jsonPayload: {},
                  },
                ],
              },
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "ts-root",
              messageCount: 1,
              cacheState: "complete",
              complete: true,
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/sessions/ts-leaf/messages") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "db-leaf-message-1",
                runtimeMessageId: "leaf-user-1",
                role: "user",
                textContent: "分叉后的第一条用户问题",
                createdAt: "2026-03-14T10:06:30.000Z",
                parts: [
                  {
                    id: "db-leaf-part-1",
                    partType: "text",
                    textContent: "分叉后的第一条用户问题",
                    jsonPayload: {},
                  },
                ],
              },
            ],
            meta: {
              readSource: "task-session-first",
              sessionId: "ts-leaf",
              messageCount: 1,
              cacheState: "complete",
              complete: true,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/session-lineage", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual([
      expect.objectContaining({
        runtimeSessionId: "session-root",
        children: [
          expect.objectContaining({
            runtimeSessionId: "session-leaf",
            forkedFromMessageId: "msg-1",
            forkedFromMessagePreview: "父分支里的回答摘要",
            firstPromptAfterFork: "分叉后的第一条用户问题",
          }),
        ],
      }),
    ]);
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
  });
});
