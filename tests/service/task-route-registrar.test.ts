/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import {
  createRouteCollector,
  createRouteContext,
  getRequiredRouteHandler,
  invokeRouteHandler,
} from "./task-route-test-helpers";

let importCounter = 0;

async function loadTaskSessionRegistrarModule() {
  mock.module("../../control-plane/service/src/modules/tasks/task-branch-write", () => ({
    createTaskBranchWriteApi: mock(() => ({})),
    createTaskBranchSchema: z.object({}).passthrough(),
    persistTaskBranchMessageSchema: z.object({}).passthrough(),
  }));
  mock.module("../../control-plane/service/src/modules/tasks/task-route-builder-shared", () => ({
    resolveTaskByRuntimeSessionId: mock(async () => null),
  }));
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-session-routes.ts?task-session-routes-test=${importCounter}`
  );
}

function createTaskSessionRegistrarDeps(overrides: Record<string, unknown> = {}) {
  return {
    upsertTaskSession: mock(async () => ({ ok: true, status: 201, data: {} })),
    persistTaskSessionMessage: mock(async () => ({ ok: true, status: 201, data: {} })),
    postTaskSessionMessage: mock(async () => ({ ok: true, status: 201, data: {} })),
    listTaskPhases: mock(async () => ({ ok: true, status: 200, data: {} })),
    getTaskPhaseView: mock(async () => ({ ok: true, status: 200, data: {} })),
    upsertTaskPhase: mock(async () => ({ ok: true, status: 201, data: {} })),
    adoptTaskPhase: mock(async () => ({ ok: true, status: 200, data: {} })),
    pauseTaskPhase: mock(async () => ({ ok: true, status: 200, data: {} })),
    cancelTaskPhase: mock(async () => ({ ok: true, status: 200, data: {} })),
    resumeTaskPhase: mock(async () => ({ ok: true, status: 200, data: {} })),
    activateTaskSession: mock(async () => ({ ok: true, status: 200, data: {} })),
    archiveTaskSession: mock(async () => ({ ok: true, status: 200, data: {} })),
    listTaskSessions: mock(async () => ({ ok: true, status: 200, data: {} })),
    getTaskSession: mock(async () => ({ ok: true, status: 200, data: {} })),
    buildTaskConversationMessagesResponse: mock(async () => ({ ok: true, status: 200, data: {} })),
    buildTaskNormalizedConversationQueryResponse: mock(async () => ({
      ok: true,
      status: 200,
      data: {},
    })),
    buildTaskTreeResponse: mock(async () => ({ ok: true, status: 200, data: {} })),
    buildTaskTimelineResponse: mock(async () => ({ ok: true, status: 200, data: {} })),
    listTaskSessionMessages: mock(async () => ({ ok: true, status: 200, data: {} })),
    listTaskSessionOperations: mock(async () => ({ ok: true, status: 200, data: {} })),
    listTaskSessionArtifacts: mock(async () => ({ ok: true, status: 200, data: {} })),
    listTaskUsageLedgerEntries: mock(async () => ({ ok: true, status: 200, data: {} })),
    buildTaskSessionTimelineViewResponse: mock(async () => ({ ok: true, status: 200, data: {} })),
    buildTaskExecutionTraceResponse: mock(async () => ({ ok: true, status: 200, data: {} })),
    ...overrides,
  };
}

async function setupTaskSessionRegistrar(args: {
  routeKeys: {
    primary: string;
    secondary?: string;
  };
  depsOverrides?: Record<string, unknown>;
}) {
  const app = createRouteCollector();
  const { registerTaskSessionRoutes } = await loadTaskSessionRegistrarModule();

  registerTaskSessionRoutes(
    app as never,
    createTaskSessionRegistrarDeps(args.depsOverrides) as never,
  );

  return {
    app,
    primaryHandler: getRequiredRouteHandler(app, args.routeKeys.primary),
    secondaryHandler: args.routeKeys.secondary
      ? getRequiredRouteHandler(app, args.routeKeys.secondary)
      : undefined,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task session route registrar", () => {
  test("phase view route is mounted and delegates to the phase reader", async () => {
    const getTaskPhaseView = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: { routeScope: "phase-view", args },
    }));

    const { primaryHandler } = await setupTaskSessionRegistrar({
      routeKeys: {
        primary: "GET /:taskId/phases/:phaseId/view",
      },
      depsOverrides: { getTaskPhaseView },
    });

    const response = await invokeRouteHandler(
      primaryHandler,
      createRouteContext({
        params: {
          taskId: "task-1",
          phaseId: "phase-2",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(getTaskPhaseView).toHaveBeenCalledWith({
      taskId: "task-1",
      phaseId: "phase-2",
    });
    expect(await response.json()).toEqual({
      routeScope: "phase-view",
      args: {
        taskId: "task-1",
        phaseId: "phase-2",
      },
    });
  });

  test("phase adopt route is mounted and forwards parsed body to the phase adoption dependency", async () => {
    const adoptTaskPhase = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: args,
    }));

    const { primaryHandler } = await setupTaskSessionRegistrar({
      routeKeys: {
        primary: "POST /:taskId/phases/:phaseId/adopt",
      },
      depsOverrides: { adoptTaskPhase },
    });

    const response = await invokeRouteHandler(
      primaryHandler,
      createRouteContext({
        params: {
          taskId: "task-1",
          phaseId: "phase-1",
        },
        validJson: {
          winnerSessionId: "session-2",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(adoptTaskPhase).toHaveBeenCalledWith({
      taskId: "task-1",
      phaseId: "phase-1",
      winnerSessionId: "session-2",
    });
    expect(await response.json()).toEqual({
      taskId: "task-1",
      phaseId: "phase-1",
      winnerSessionId: "session-2",
    });
  });

  test("phase pause route is mounted and delegates to the phase pause dependency", async () => {
    const pauseTaskPhase = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: args,
    }));

    const { primaryHandler } = await setupTaskSessionRegistrar({
      routeKeys: {
        primary: "POST /:taskId/phases/:phaseId/pause",
      },
      depsOverrides: { pauseTaskPhase },
    });

    const response = await invokeRouteHandler(
      primaryHandler,
      createRouteContext({
        params: {
          taskId: "task-1",
          phaseId: "phase-1",
        },
        validJson: {},
      }),
    );

    expect(response.status).toBe(200);
    expect(pauseTaskPhase).toHaveBeenCalledWith({
      taskId: "task-1",
      phaseId: "phase-1",
    });
    expect(await response.json()).toEqual({
      taskId: "task-1",
      phaseId: "phase-1",
    });
  });

  test("session read routes delegate to session readers", async () => {
    const listTaskSessions = mock(async (taskId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { routeScope: "sessions", taskId },
    }));
    const buildTaskConversationMessagesResponse = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: {
        routeScope: "task-messages",
        args,
      },
    }));
    const buildTaskNormalizedConversationQueryResponse = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: {
        routeScope: "normalized-conversation-query",
        args,
      },
    }));
    const buildTaskTreeResponse = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: {
        routeScope: "task-tree",
        args,
      },
    }));
    const buildTaskTimelineResponse = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: {
        routeScope: "task-timeline",
        args,
      },
    }));
    const listTaskSessionMessages = mock(async (taskId: string, sessionId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { routeScope: "session-messages", taskId, sessionId },
    }));
    const buildTaskSessionTimelineViewResponse = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: {
        routeScope: "session-timeline",
        args,
      },
    }));
    const buildTaskExecutionTraceResponse = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: {
        routeScope: "execution-trace",
        args,
      },
    }));

    const { app } = await setupTaskSessionRegistrar({
      routeKeys: {
        primary: "GET /:taskId/sessions",
      },
      depsOverrides: {
        listTaskSessions,
        buildTaskConversationMessagesResponse,
        buildTaskNormalizedConversationQueryResponse,
        buildTaskTreeResponse,
        buildTaskTimelineResponse,
        listTaskSessionMessages,
        buildTaskSessionTimelineViewResponse,
        buildTaskExecutionTraceResponse,
      },
    });

    const sessionsHandler = getRequiredRouteHandler(app, "GET /:taskId/sessions");
    const taskMessagesHandler = getRequiredRouteHandler(app, "GET /:taskId/messages");
    const normalizedConversationHandler = getRequiredRouteHandler(
      app,
      "GET /:taskId/query/normalized-conversation",
    );
    const treeHandler = getRequiredRouteHandler(app, "GET /:taskId/tree");
    const taskTimelineHandler = getRequiredRouteHandler(app, "GET /:taskId/timeline");
    const messagesHandler = getRequiredRouteHandler(
      app,
      "GET /:taskId/sessions/:sessionId/messages",
    );
    const timelineHandler = getRequiredRouteHandler(
      app,
      "GET /:taskId/sessions/:sessionId/timeline",
    );
    const traceHandler = getRequiredRouteHandler(app, "GET /:taskId/execution-trace");

    const sessionsResponse = await invokeRouteHandler(
      sessionsHandler,
      createRouteContext({
        params: { taskId: "task-1" },
      }),
    );
    const taskMessagesResponse = await invokeRouteHandler(
      taskMessagesHandler,
      createRouteContext({
        params: { taskId: "task-1" },
        query: { includeLineage: "false" },
      }),
    );
    const messagesResponse = await invokeRouteHandler(
      messagesHandler,
      createRouteContext({
        params: { taskId: "task-1", sessionId: "session-1" },
      }),
    );
    const normalizedConversationResponse = await invokeRouteHandler(
      normalizedConversationHandler,
      createRouteContext({
        params: { taskId: "task-1" },
        query: { sessionId: "session-1" },
      }),
    );
    const treeResponse = await invokeRouteHandler(
      treeHandler,
      createRouteContext({
        params: { taskId: "task-1" },
        query: { sessionId: "session-1", includeLineage: "false" },
      }),
    );
    const taskTimelineResponse = await invokeRouteHandler(
      taskTimelineHandler,
      createRouteContext({
        params: { taskId: "task-1" },
        query: { sessionId: "session-1", includeLineage: "false" },
      }),
    );
    const timelineResponse = await invokeRouteHandler(
      timelineHandler,
      createRouteContext({
        params: { taskId: "task-1", sessionId: "session-1" },
        query: { includeLineage: "false" },
      }),
    );
    const traceResponse = await invokeRouteHandler(
      traceHandler,
      createRouteContext({
        params: { taskId: "task-1" },
        query: { sessionId: "session-1" },
      }),
    );

    expect(listTaskSessions).toHaveBeenCalledWith("task-1");
    expect(buildTaskConversationMessagesResponse).not.toHaveBeenCalled();
    expect(buildTaskNormalizedConversationQueryResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-1",
      includeLineage: true,
    });
    expect(buildTaskTreeResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-1",
      includeLineage: false,
    });
    expect(buildTaskTimelineResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-1",
      includeLineage: false,
    });
    expect(listTaskSessionMessages).not.toHaveBeenCalled();
    expect(buildTaskSessionTimelineViewResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-1",
      includeLineage: false,
    });
    expect(buildTaskExecutionTraceResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-1",
      includeLineage: true,
    });
    expect(await sessionsResponse.json()).toEqual({ routeScope: "sessions", taskId: "task-1" });
    expect(taskMessagesResponse.status).toBe(410);
    expect(await taskMessagesResponse.json()).toEqual({
      error: "Deprecated route. Use /tasks/:taskId/query/normalized-conversation",
    });
    expect(messagesResponse.status).toBe(410);
    expect(await messagesResponse.json()).toEqual({
      error:
        "Deprecated route. Use /tasks/:taskId/query/normalized-conversation?sessionId=:sessionId",
    });
    expect(await normalizedConversationResponse.json()).toEqual({
      routeScope: "normalized-conversation-query",
      args: {
        taskId: "task-1",
        sessionId: "session-1",
        includeLineage: true,
      },
    });
    expect(await treeResponse.json()).toEqual({
      routeScope: "task-tree",
      args: {
        taskId: "task-1",
        sessionId: "session-1",
        includeLineage: false,
      },
    });
    expect(await taskTimelineResponse.json()).toEqual({
      routeScope: "task-timeline",
      args: {
        taskId: "task-1",
        sessionId: "session-1",
        includeLineage: false,
      },
    });
    expect(await timelineResponse.json()).toEqual({
      routeScope: "session-timeline",
      args: {
        taskId: "task-1",
        sessionId: "session-1",
        includeLineage: false,
      },
    });
    expect(await traceResponse.json()).toEqual({
      routeScope: "execution-trace",
      args: {
        taskId: "task-1",
        sessionId: "session-1",
        includeLineage: true,
      },
    });
  });

  test("canonical session message post route forwards the validated payload", async () => {
    const postTaskSessionMessage = mock(async (args: unknown) => ({
      ok: true as const,
      status: 201 as const,
      data: args,
    }));

    const { primaryHandler } = await setupTaskSessionRegistrar({
      routeKeys: {
        primary: "POST /:taskId/sessions/:sessionId/messages",
      },
      depsOverrides: {
        postTaskSessionMessage,
      },
    });

    const response = await invokeRouteHandler(
      primaryHandler,
      createRouteContext({
        params: { taskId: "task-1", sessionId: "session-1" },
        validJson: {
          client_message_id: "cli-1",
          text: "hello session",
          attachments: [{ kind: "file_reference", filePath: "docs/spec.md" }],
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(postTaskSessionMessage).toHaveBeenCalledWith({
      taskId: "task-1",
      sessionId: "session-1",
      client_message_id: "cli-1",
      text: "hello session",
      attachments: [{ kind: "file_reference", filePath: "docs/spec.md" }],
    });
    expect(await response.json()).toEqual({
      taskId: "task-1",
      sessionId: "session-1",
      client_message_id: "cli-1",
      text: "hello session",
      attachments: [{ kind: "file_reference", filePath: "docs/spec.md" }],
    });
  });

  test("session activate and archive routes stay mounted on session dependencies", async () => {
    const activateTaskSession = mock(async (taskId: string, sessionId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { action: "activate", taskId, sessionId },
    }));
    const archiveTaskSession = mock(async (taskId: string, sessionId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { action: "archive", taskId, sessionId },
    }));

    const { primaryHandler: activateHandler, secondaryHandler: archiveHandler } =
      await setupTaskSessionRegistrar({
        routeKeys: {
          primary: "POST /:taskId/sessions/:sessionId/activate",
          secondary: "POST /:taskId/sessions/:sessionId/archive",
        },
        depsOverrides: {
          activateTaskSession,
          archiveTaskSession,
        },
      });

    expect(archiveHandler).toBeDefined();

    const activateResponse = await invokeRouteHandler(
      activateHandler,
      createRouteContext({
        params: { taskId: "task-1", sessionId: "session-1" },
      }),
    );
    const archiveResponse = await invokeRouteHandler(
      archiveHandler,
      createRouteContext({
        params: { taskId: "task-1", sessionId: "session-1" },
      }),
    );

    expect(activateResponse.status).toBe(200);
    expect(await activateResponse.json()).toEqual({
      action: "activate",
      taskId: "task-1",
      sessionId: "session-1",
    });
    expect(activateTaskSession).toHaveBeenCalledWith("task-1", "session-1");

    expect(archiveResponse.status).toBe(200);
    expect(await archiveResponse.json()).toEqual({
      action: "archive",
      taskId: "task-1",
      sessionId: "session-1",
    });
    expect(archiveTaskSession).toHaveBeenCalledWith("task-1", "session-1");
  });

  test("execution-trace route rejects runtimeSessionId query", async () => {
    const { primaryHandler } = await setupTaskSessionRegistrar({
      routeKeys: {
        primary: "GET /:taskId/execution-trace",
      },
    });

    const response = await invokeRouteHandler(
      primaryHandler,
      createRouteContext({
        params: { taskId: "task-1" },
        query: { runtimeSessionId: "runtime-1" },
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: "runtimeSessionId query has been removed; use sessionId.",
    });
  });
});
