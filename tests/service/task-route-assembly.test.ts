/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";
import { createRouteCollector } from "./task-route-test-helpers";

let importCounter = 0;

async function loadTaskRouteRegistrationsModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-route-assembly.ts?task-route-assembly-registrations-test=${importCounter}`
  );
}

async function loadTaskRouteModulesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-route-assembly.ts?task-route-assembly-modules-test=${importCounter}`
  );
}

describe("task route registration assembly", () => {
  test("buildTaskRouteRegistrations composes each subgroup from shared builder output", async () => {
    const shared = { scope: "shared" };
    const core = { scope: "core" };
    const agentRunWrites = { scope: "agent-run-writes" };
    const sessions = { scope: "sessions" };
    const projections = { scope: "projections" };

    const buildShared = mock(() => shared);
    const buildCore = mock((value: unknown) => ({ ...core, shared: value }));
    const buildAgentRunWrites = mock((value: unknown) => ({ ...agentRunWrites, shared: value }));
    const buildSessions = mock((value: unknown) => ({ ...sessions, shared: value }));
    const buildProjections = mock((value: unknown) => ({ ...projections, shared: value }));

    const { buildTaskRouteRegistrationsFromBuilders } = await loadTaskRouteRegistrationsModule();
    const registrations = buildTaskRouteRegistrationsFromBuilders({
      buildShared,
      buildCore,
      buildAgentRunWrites,
      buildSessions,
      buildProjections,
    });

    expect(buildShared).toHaveBeenCalledTimes(1);
    expect(buildCore).toHaveBeenCalledWith(shared);
    expect(buildAgentRunWrites).toHaveBeenCalledWith(shared);
    expect(buildSessions).toHaveBeenCalledWith(shared);
    expect(buildProjections).toHaveBeenCalledWith(shared);
    expect(registrations).toEqual({
      core: { ...core, shared },
      agentRunCompat: { ...agentRunWrites, shared },
      sessions: { ...sessions, shared },
      projections: { ...projections, shared },
    });
  });
});

describe("task route module assembly", () => {
  test("registerTaskRouteModules dispatches grouped registrations to the matching route modules", async () => {
    const taskRoutes = createRouteCollector();
    const registrations = {
      core: { scope: "core" },
      agentRunCompat: { scope: "agent-run-writes" },
      sessions: { scope: "sessions" },
      projections: { scope: "projections" },
    };
    const callLog: Array<[string, unknown, unknown]> = [];

    const buildRegistrations = mock(() => registrations);
    const registerAgentRunReads = mock((routes: unknown) => {
      callLog.push(["agentRunReads", routes, undefined]);
    });
    const registerCore = mock((routes: unknown, deps: unknown) => {
      callLog.push(["core", routes, deps]);
    });
    const registerAgentRunWrites = mock((routes: unknown, deps: unknown) => {
      callLog.push(["agentRunWrites", routes, deps]);
    });
    const registerSessions = mock((routes: unknown, deps: unknown) => {
      callLog.push(["sessions", routes, deps]);
    });
    const registerProjections = mock((routes: unknown, deps: unknown) => {
      callLog.push(["projections", routes, deps]);
    });

    const { registerTaskRouteModulesFromRegistrars } = await loadTaskRouteModulesModule();
    registerTaskRouteModulesFromRegistrars(taskRoutes as never, {
      buildRegistrations,
      registerAgentRunReads,
      registerAgentRunWrites,
      registerCore,
      registerSessions,
      registerProjections,
    });

    expect(buildRegistrations).toHaveBeenCalledTimes(1);
    expect(callLog).toEqual([
      ["agentRunReads", taskRoutes, undefined],
      ["agentRunWrites", taskRoutes, registrations.agentRunCompat],
      ["core", taskRoutes, registrations.core],
      ["sessions", taskRoutes, registrations.sessions],
      ["projections", taskRoutes, registrations.projections],
    ]);
  });
});
