/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createRouteCollector,
  createRouteContext,
  getRequiredRouteHandler,
  invokeRouteHandler,
} from "./task-route-test-helpers";

let importCounter = 0;

async function loadTaskBranchRegistrarModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-branch-routes.ts?task-branch-routes-test=${importCounter}`
  );
}

function mockTaskDomainRunRouteBoundaries() {
  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      select: mock(() => ({
        from: mock(() => ({ where: mock(() => ({ orderBy: mock(async () => []) })) })),
      })),
      query: {
        taskRuns: {
          findFirst: mock(async () => null),
        },
      },
    },
  }));
  mock.module("../../control-plane/service/src/modules/tasks/task-run-detail", () => ({
    listTaskRunDetailNodes: mock(async () => ({})),
  }));
}

async function loadTaskDomainRunRegistrarModule() {
  mockTaskDomainRunRouteBoundaries();
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-domain-run-routes.ts?task-domain-run-routes-test=${importCounter}`
  );
}

function createTaskDomainRunRegistrarDeps(overrides: Record<string, unknown> = {}) {
  return {
    adoptDomainRunCandidate: mock(async () => ({ ok: true, status: 200, data: {} })),
    ...overrides,
  };
}

async function setupTaskDomainRunRegistrar(args: {
  routeKey: string;
  depsOverrides?: Record<string, unknown>;
}) {
  const app = createRouteCollector();
  const { registerTaskDomainRunRoutes } = await loadTaskDomainRunRegistrarModule();

  registerTaskDomainRunRoutes(
    app as never,
    createTaskDomainRunRegistrarDeps(args.depsOverrides) as never,
  );

  return {
    app,
    handler: getRequiredRouteHandler(app, args.routeKey),
  };
}

function createTaskBranchRegistrarDeps(overrides: Record<string, unknown> = {}) {
  return {
    loadTaskTreeBackedRecord: mock(async () => null),
    listTaskBranchCompatTreeRecords: mock(async () => []),
    buildTaskBranchCompatMessagesResponse: mock(async () => ({})),
    buildTaskBranchCompatEventsResponse: mock(async () => ({})),
    buildTaskBranchCompatTimelineResponse: mock(async () => ({})),
    upsertTaskBranch: mock(async () => ({ ok: true, status: 201, data: {} })),
    persistTaskBranchMessage: mock(async () => ({ ok: true, status: 201, data: {} })),
    activateTaskBranch: mock(async () => ({ ok: true, status: 200, data: {} })),
    archiveTaskBranch: mock(async () => ({ ok: true, status: 200, data: {} })),
    ...overrides,
  };
}

async function setupTaskBranchRegistrar(args: {
  routeKeys: {
    primary: string;
    secondary?: string;
  };
  depsOverrides?: Record<string, unknown>;
}) {
  const app = createRouteCollector();
  const { registerTaskBranchCompatRoutes } = await loadTaskBranchRegistrarModule();

  registerTaskBranchCompatRoutes(
    app as never,
    createTaskBranchRegistrarDeps(args.depsOverrides) as never,
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

describe("task domain-run registrar", () => {
  test("candidate adoption route is mounted and forwards parsed params to the adoption dependency", async () => {
    const adoptDomainRunCandidate = mock(async (args: unknown) => ({
      ok: true as const,
      status: 200 as const,
      data: args,
    }));

    const { handler } = await setupTaskDomainRunRegistrar({
      routeKey: "POST /:taskId/domain-runs/:runId/candidates/:candidateIndex/adopt",
      depsOverrides: { adoptDomainRunCandidate },
    });

    const response = await invokeRouteHandler(
      handler,
      createRouteContext({
        params: {
          taskId: "task-1",
          runId: "run-1",
          candidateIndex: "2",
        },
        validJson: {
          stoppedCandidates: [{ candidateIndex: 1, status: "failed", errorText: "stopped" }],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(adoptDomainRunCandidate).toHaveBeenCalledWith({
      taskId: "task-1",
      runId: "run-1",
      candidateIndex: 2,
      stoppedCandidates: [{ candidateIndex: 1, status: "failed", errorText: "stopped" }],
    });
    expect(await response.json()).toEqual({
      data: {
        taskId: "task-1",
        runId: "run-1",
        candidateIndex: 2,
        stoppedCandidates: [{ candidateIndex: 1, status: "failed", errorText: "stopped" }],
      },
    });
  });
});

describe("task branch compat route registrar", () => {
  test("branch compat messages, events, and timeline routes delegate to compat readers", async () => {
    const loadTaskTreeBackedRecord = mock(async () => ({ projectId: "proj-1" }));
    const buildTaskBranchCompatMessagesResponse = mock(async (args: unknown) => ({
      routeScope: "branch-compat-messages",
      args,
    }));
    const buildTaskBranchCompatEventsResponse = mock(async (args: unknown) => ({
      routeScope: "branch-compat-events",
      args,
    }));
    const buildTaskBranchCompatTimelineResponse = mock(async (args: unknown) => ({
      routeScope: "branch-compat-timeline",
      args,
    }));

    const { app } = await setupTaskBranchRegistrar({
      routeKeys: {
        primary: "GET /:taskId/branches/:runtimeSessionId/messages",
      },
      depsOverrides: {
        loadTaskTreeBackedRecord,
        buildTaskBranchCompatMessagesResponse,
        buildTaskBranchCompatEventsResponse,
        buildTaskBranchCompatTimelineResponse,
      },
    });

    const messagesHandler = getRequiredRouteHandler(
      app,
      "GET /:taskId/branches/:runtimeSessionId/messages",
    );
    const eventsHandler = getRequiredRouteHandler(
      app,
      "GET /:taskId/branches/:runtimeSessionId/events",
    );
    const timelineHandler = getRequiredRouteHandler(
      app,
      "GET /:taskId/branches/:runtimeSessionId/timeline",
    );

    const messagesResponse = await invokeRouteHandler(
      messagesHandler,
      createRouteContext({
        params: { taskId: "task-1", runtimeSessionId: "runtime-1" },
        query: { includeLineage: "true" },
      }),
    );
    const eventsResponse = await invokeRouteHandler(
      eventsHandler,
      createRouteContext({
        params: { taskId: "task-1", runtimeSessionId: "runtime-1" },
      }),
    );
    const timelineResponse = await invokeRouteHandler(
      timelineHandler,
      createRouteContext({
        params: { taskId: "task-1", runtimeSessionId: "runtime-1" },
      }),
    );

    expect(loadTaskTreeBackedRecord).toHaveBeenCalledTimes(3);
    expect(buildTaskBranchCompatMessagesResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "proj-1",
      runtimeSessionId: "runtime-1",
      includeLineage: true,
    });
    expect(buildTaskBranchCompatEventsResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "proj-1",
      runtimeSessionId: "runtime-1",
      includeLineage: false,
    });
    expect(buildTaskBranchCompatTimelineResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "proj-1",
      runtimeSessionId: "runtime-1",
      includeLineage: false,
    });
    expect(await messagesResponse.json()).toEqual({
      routeScope: "branch-compat-messages",
      args: {
        taskId: "task-1",
        projectId: "proj-1",
        runtimeSessionId: "runtime-1",
        includeLineage: true,
      },
    });
    expect(await eventsResponse.json()).toEqual({
      routeScope: "branch-compat-events",
      args: {
        taskId: "task-1",
        projectId: "proj-1",
        runtimeSessionId: "runtime-1",
        includeLineage: false,
      },
    });
    expect(await timelineResponse.json()).toEqual({
      routeScope: "branch-compat-timeline",
      args: {
        taskId: "task-1",
        projectId: "proj-1",
        runtimeSessionId: "runtime-1",
        includeLineage: false,
      },
    });
  });

  test("branch compat activate and archive routes stay mounted on compat-specific dependencies", async () => {
    const activateTaskBranch = mock(async (taskId: string, branchId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { action: "activate", taskId, branchId },
    }));
    const archiveTaskBranch = mock(async (taskId: string, branchId: string) => ({
      ok: true as const,
      status: 200 as const,
      data: { action: "archive", taskId, branchId },
    }));

    const { primaryHandler: activateHandler, secondaryHandler: archiveHandler } =
      await setupTaskBranchRegistrar({
        routeKeys: {
          primary: "POST /:taskId/branches/:branchId/activate",
          secondary: "POST /:taskId/branches/:branchId/archive",
        },
        depsOverrides: {
          activateTaskBranch,
          archiveTaskBranch,
        },
      });

    expect(archiveHandler).toBeDefined();

    const activateResponse = await invokeRouteHandler(
      activateHandler,
      createRouteContext({
        params: { taskId: "task-1", branchId: "branch-1" },
      }),
    );
    const archiveResponse = await invokeRouteHandler(
      archiveHandler,
      createRouteContext({
        params: { taskId: "task-1", branchId: "branch-1" },
      }),
    );

    expect(activateResponse.status).toBe(200);
    expect(await activateResponse.json()).toEqual({
      action: "activate",
      taskId: "task-1",
      branchId: "branch-1",
    });
    expect(activateTaskBranch).toHaveBeenCalledWith("task-1", "branch-1");

    expect(archiveResponse.status).toBe(200);
    expect(await archiveResponse.json()).toEqual({
      action: "archive",
      taskId: "task-1",
      branchId: "branch-1",
    });
    expect(archiveTaskBranch).toHaveBeenCalledWith("task-1", "branch-1");
  });
});
