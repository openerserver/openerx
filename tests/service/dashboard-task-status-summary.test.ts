/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

async function loadDashboardRoutesModule() {
  importCounter += 1;

  mock.module("../../control-plane/service/src/db", () => ({
    db: { query: {}, select: () => ({ from: () => ({ where: async () => [] }) }) },
  }));

  return import(
    `../../control-plane/service/src/modules/dashboard/routes.ts?dashboard-task-status-summary-test=${importCounter}`
  );
}

afterEach(() => {
  mock.restore();
});

function makeSnapshot(
  overrides: Partial<{
    currentSessionId: string | null;
    currentExecutionStatus: string | null;
    lifecycleStatus: string | null;
    currentExecutionMode: string | null;
    activeCandidateCount: number | null;
    totalChainSteps: number | null;
    completedChainSteps: number | null;
  }> = {},
) {
  return {
    currentSessionId: null,
    currentExecutionStatus: null,
    lifecycleStatus: "draft",
    currentExecutionMode: "single",
    activeCandidateCount: 0,
    totalChainSteps: 0,
    completedChainSteps: 0,
    ...overrides,
  } as never;
}

describe("dashboard task status summary", () => {
  test("keeps normalized task statuses consistent in dashboard aggregates", async () => {
    const { summarizeDashboardTaskSnapshots } = await loadDashboardRoutesModule();

    const summary = summarizeDashboardTaskSnapshots([
      makeSnapshot({
        currentSessionId: "session-complete",
        currentExecutionStatus: "complete",
        lifecycleStatus: "active",
        currentExecutionMode: "parallel",
      }),
      makeSnapshot({
        currentExecutionStatus: "queued",
        lifecycleStatus: "active",
      }),
      makeSnapshot({
        currentSessionId: "session-awaiting",
        currentExecutionStatus: "awaiting_adoption",
        lifecycleStatus: "active",
        currentExecutionMode: "parallel",
        activeCandidateCount: 2,
      }),
      makeSnapshot({
        currentSessionId: "session-running",
        currentExecutionStatus: null,
        lifecycleStatus: "active",
        currentExecutionMode: "sequential_chain",
        activeCandidateCount: 1,
        totalChainSteps: 4,
        completedChainSteps: 1,
      }),
      makeSnapshot({
        currentSessionId: "session-paused",
        currentExecutionStatus: "paused",
        lifecycleStatus: "active",
      }),
      makeSnapshot({
        currentSessionId: "session-failed",
        currentExecutionStatus: "failed",
        lifecycleStatus: "active",
      }),
      makeSnapshot({
        currentSessionId: "session-failed",
        currentExecutionStatus: null,
        lifecycleStatus: "archived",
      }),
    ]);

    expect(summary).toEqual({
      activeSessionCount: 5,
      runningTaskCount: 2,
      parallelTaskCount: 2,
      sequentialChainTaskCount: 1,
      pausedTaskCount: 1,
      failedTaskCount: 2,
      activeCandidateCount: 3,
      pendingChainStepCount: 3,
    });
  });
});