/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  createRouteCollector,
  createRouteContext,
  getRequiredRouteHandler,
  invokeRouteHandler,
} from "./task-route-test-helpers";

let importCounter = 0;

async function loadTaskProjectionRoutesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-projection-routes.ts?task-projection-routes-test=${importCounter}`
  );
}

function createTaskProjectionRegistrarDeps(overrides: Record<string, unknown> = {}) {
  return {
    loadTaskTreeBackedRecord: mock(async () => null),
    listTaskSnapshots: mock(async () => ({ data: [] })),
    getTaskSnapshot: mock(async () => ({
      ok: true,
      status: 200,
      data: { data: null, meta: { complete: false } },
    })),
    buildTaskProjectionTimelineViewResponse: mock(async () => ({
      data: [],
      meta: { complete: false },
    })),
    replayTaskDomainProjections: mock(async () => ({ replayedTaskId: "task-default" })),
    replayTaskDomainProjectionsByProject: mock(async () => ({
      replayedProjectId: "project-default",
    })),
    ...overrides,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task projection routes", () => {
  test("timeline-view route resolves project context and forwards lineage query params", async () => {
    const app = createRouteCollector();
    const loadTaskTreeBackedRecord = mock(async () => ({ id: "task-1", projectId: "project-1" }));
    const buildTaskProjectionTimelineViewResponse = mock(async () => ({
      data: ["ok"],
      meta: { complete: true },
    }));
    const { registerTaskProjectionRoutes } = await loadTaskProjectionRoutesModule();

    registerTaskProjectionRoutes(
      app as never,
      createTaskProjectionRegistrarDeps({
        loadTaskTreeBackedRecord,
        buildTaskProjectionTimelineViewResponse,
      }) as never,
    );

    const handler = getRequiredRouteHandler(app, "GET /:taskId/timeline-view");
    const response = await invokeRouteHandler(handler, {
      ...createRouteContext({ params: { taskId: "task-1" } }),
      req: {
        ...createRouteContext({ params: { taskId: "task-1" } }).req,
        param: (name: string) => ({ taskId: "task-1" })[name] ?? "",
        query: (name: string) =>
          ({ runtimeSessionId: "fork-session", includeLineage: "false" })[
            name as "runtimeSessionId" | "includeLineage"
          ],
      },
    });

    expect(response.status).toBe(200);
    expect(loadTaskTreeBackedRecord).toHaveBeenCalledWith("task-1");
    expect(buildTaskProjectionTimelineViewResponse).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      runtimeSessionId: "fork-session",
      includeLineage: false,
    });
    expect(await response.json()).toEqual({ data: ["ok"], meta: { complete: true } });
  });

  test("replay route delegates project-scope requests and preserves reason plus confirmation", async () => {
    const app = createRouteCollector();
    const replayTaskDomainProjections = mock(async () => ({ replayedTaskId: "task-ignored" }));
    const replayTaskDomainProjectionsByProject = mock(async () => ({
      replayedProjectId: "project-1",
      replayedCount: 3,
    }));
    const { registerTaskProjectionRoutes } = await loadTaskProjectionRoutesModule();

    registerTaskProjectionRoutes(
      app as never,
      createTaskProjectionRegistrarDeps({
        replayTaskDomainProjections,
        replayTaskDomainProjectionsByProject,
      }) as never,
    );

    const handler = getRequiredRouteHandler(app, "POST /projections/replay");
    const response = await invokeRouteHandler(
      handler,
      createRouteContext({
        validJson: {
          scope: "project",
          projectId: "project-1",
          confirm: true,
          reason: "rebuild task projections after storage cleanup",
        },
        userRole: "org_admin",
      }),
    );

    expect(response.status).toBe(200);
    expect(replayTaskDomainProjections).not.toHaveBeenCalled();
    expect(replayTaskDomainProjectionsByProject).toHaveBeenCalledWith("project-1");
    expect(await response.json()).toEqual({
      scope: "project",
      reason: "rebuild task projections after storage cleanup",
      confirmed: true,
      replayedProjectId: "project-1",
      replayedCount: 3,
    });
  });
});
