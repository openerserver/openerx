/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { createRouteCollector } from "./task-route-test-helpers";

let importCounter = 0;

async function loadTaskRouteRegistrationsModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-route-registrations.ts?task-route-registrations-test=${importCounter}`
  );
}

async function loadTaskRouteModulesModule() {
  importCounter += 1;
  return import(
    `../../control-plane/service/src/modules/tasks/task-route-modules.ts?task-route-modules-test=${importCounter}`
  );
}

afterEach(() => {
  mock.restore();
});

describe("task route registration assembly", () => {
  test("buildTaskRouteRegistrations composes each subgroup from shared builder output", async () => {
    const shared = { scope: "shared" };
    const core = { scope: "core" };
    const domainRuns = { scope: "domain-runs" };
    const agentRunWrites = { scope: "agent-run-writes" };
    const branchCompat = { scope: "branch-compat" };
    const projections = { scope: "projections" };

    const buildShared = mock(() => shared);
    const buildCore = mock((value: unknown) => ({ ...core, shared: value }));
    const buildDomain = mock((value: unknown) => ({ ...domainRuns, shared: value }));
    const buildAgentRunWrites = mock((value: unknown) => ({ ...agentRunWrites, shared: value }));
    const buildBranchCompat = mock((value: unknown) => ({ ...branchCompat, shared: value }));
    const buildProjections = mock((value: unknown) => ({ ...projections, shared: value }));

    mock.module("../../control-plane/service/src/modules/tasks/task-route-builder-shared", () => ({
      buildTaskRouteBuilderShared: buildShared,
    }));
    mock.module(
      "../../control-plane/service/src/modules/tasks/task-route-core-registrations",
      () => ({
        buildTaskCoreRegistrations: buildCore,
        buildTaskAgentRunWriteRegistrations: buildAgentRunWrites,
      }),
    );
    mock.module(
      "../../control-plane/service/src/modules/tasks/task-route-domain-registrations",
      () => ({
        buildTaskDomainRegistrations: buildDomain,
      }),
    );
    mock.module(
      "../../control-plane/service/src/modules/tasks/task-route-branch-registrations",
      () => ({
        buildTaskBranchCompatRegistrations: buildBranchCompat,
      }),
    );
    mock.module(
      "../../control-plane/service/src/modules/tasks/task-route-projection-registrations",
      () => ({
        buildTaskProjectionRegistrations: buildProjections,
      }),
    );

    const { buildTaskRouteRegistrations } = await loadTaskRouteRegistrationsModule();
    const registrations = buildTaskRouteRegistrations();

    expect(buildShared).toHaveBeenCalledTimes(1);
    expect(buildCore).toHaveBeenCalledWith(shared);
    expect(buildDomain).toHaveBeenCalledWith(shared);
    expect(buildAgentRunWrites).toHaveBeenCalledWith(shared);
    expect(buildBranchCompat).toHaveBeenCalledWith(shared);
    expect(buildProjections).toHaveBeenCalledWith(shared);
    expect(registrations).toEqual({
      core: { ...core, shared },
      domainRuns: { ...domainRuns, shared },
      agentRunWrites: { ...agentRunWrites, shared },
      branchCompat: { ...branchCompat, shared },
      projections: { ...projections, shared },
    });
  });
});

describe("task route module assembly", () => {
  test("registerTaskRouteModules dispatches grouped registrations to the matching route modules", async () => {
    const taskRoutes = createRouteCollector();
    const registrations = {
      core: { scope: "core" },
      domainRuns: { scope: "domain-runs" },
      agentRunWrites: { scope: "agent-run-writes" },
      branchCompat: { scope: "branch-compat" },
      projections: { scope: "projections" },
    };
    const callLog: Array<[string, unknown, unknown]> = [];

    const buildRegistrations = mock(() => registrations);
    const registerCore = mock((routes: unknown, deps: unknown) => {
      callLog.push(["core", routes, deps]);
    });
    const registerDomainRuns = mock((routes: unknown, deps: unknown) => {
      callLog.push(["domainRuns", routes, deps]);
    });
    const registerAgentRunWrites = mock((routes: unknown, deps: unknown) => {
      callLog.push(["agentRunWrites", routes, deps]);
    });
    const registerBranchCompat = mock((routes: unknown, deps: unknown) => {
      callLog.push(["branchCompat", routes, deps]);
    });
    const registerProjections = mock((routes: unknown, deps: unknown) => {
      callLog.push(["projections", routes, deps]);
    });

    mock.module("../../control-plane/service/src/modules/tasks/task-route-registrations", () => ({
      buildTaskRouteRegistrations: buildRegistrations,
    }));
    mock.module("../../control-plane/service/src/modules/tasks/task-core-routes", () => ({
      registerTaskCoreRoutes: registerCore,
    }));
    mock.module("../../control-plane/service/src/modules/tasks/task-domain-run-routes", () => ({
      registerTaskDomainRunRoutes: registerDomainRuns,
    }));
    mock.module(
      "../../control-plane/service/src/modules/tasks/task-agent-run-write-routes",
      () => ({
        registerTaskAgentRunWriteRoutes: registerAgentRunWrites,
      }),
    );
    mock.module("../../control-plane/service/src/modules/tasks/task-branch-routes", () => ({
      registerTaskBranchCompatRoutes: registerBranchCompat,
    }));
    mock.module("../../control-plane/service/src/modules/tasks/task-projection-routes", () => ({
      registerTaskProjectionRoutes: registerProjections,
    }));

    const { registerTaskRouteModules } = await loadTaskRouteModulesModule();
    registerTaskRouteModules(taskRoutes as never);

    expect(buildRegistrations).toHaveBeenCalledTimes(1);
    expect(callLog).toEqual([
      ["core", taskRoutes, registrations.core],
      ["domainRuns", taskRoutes, registrations.domainRuns],
      ["agentRunWrites", taskRoutes, registrations.agentRunWrites],
      ["branchCompat", taskRoutes, registrations.branchCompat],
      ["projections", taskRoutes, registrations.projections],
    ]);
  });
});
