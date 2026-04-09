/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

async function loadProjectsRoutesModule() {
  importCounter += 1;

  mock.module("../../control-plane/service/src/db", () => ({
    db: { query: {} },
  }));

  return import(
    `../../control-plane/service/src/modules/projects/routes.ts?projects-overview-status-test=${importCounter}`
  );
}

afterEach(() => {
  mock.restore();
});

describe("projects overview status semantics", () => {
  test("normalizes overview task statuses from snapshot execution, fallback status, and lifecycle", async () => {
    const { mergeOverviewTaskSummaries } = await loadProjectsRoutesModule();

    const summaries = mergeOverviewTaskSummaries({
      tasks: [
        {
          id: "task-complete",
          projectId: "project-1",
          status: "running",
          lifecycleStatus: "active",
          createdAt: "2026-04-09T10:00:00.000Z",
          startedAt: "2026-04-09T10:01:00.000Z",
          finishedAt: null,
          updatedAt: "2026-04-09T10:02:00.000Z",
        },
        {
          id: "task-queued",
          projectId: "project-1",
          status: null,
          lifecycleStatus: "active",
          createdAt: "2026-04-09T10:00:00.000Z",
          startedAt: null,
          finishedAt: null,
          updatedAt: "2026-04-09T10:02:00.000Z",
        },
        {
          id: "task-awaiting",
          projectId: "project-1",
          status: "running",
          lifecycleStatus: "active",
          createdAt: "2026-04-09T10:00:00.000Z",
          startedAt: "2026-04-09T10:01:00.000Z",
          finishedAt: null,
          updatedAt: "2026-04-09T10:02:00.000Z",
        },
        {
          id: "task-fallback-status",
          projectId: "project-1",
          status: "failed",
          lifecycleStatus: "active",
          createdAt: "2026-04-09T10:00:00.000Z",
          startedAt: "2026-04-09T10:01:00.000Z",
          finishedAt: "2026-04-09T10:03:00.000Z",
          updatedAt: "2026-04-09T10:04:00.000Z",
        },
      ],
      snapshots: [
        {
          taskId: "task-complete",
          currentExecutionStatus: "complete",
          lifecycleStatus: "active",
          currentSessionId: "session-complete",
          currentExecutionMode: "parallel",
          lastActivityAt: "2026-04-09T10:05:00.000Z",
        },
        {
          taskId: "task-queued",
          currentExecutionStatus: "queued",
          lifecycleStatus: "active",
          currentSessionId: "session-queued",
          currentExecutionMode: "single",
          lastActivityAt: null,
        },
        {
          taskId: "task-awaiting",
          currentExecutionStatus: "awaiting_adoption",
          lifecycleStatus: "active",
          currentSessionId: "session-awaiting",
          currentExecutionMode: "parallel",
          lastActivityAt: "2026-04-09T10:06:00.000Z",
        },
        {
          taskId: "task-fallback-status",
          currentExecutionStatus: "mystery",
          lifecycleStatus: null,
          currentSessionId: "session-fallback",
          currentExecutionMode: "sequential_chain",
          lastActivityAt: null,
        },
      ],
    });

    const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));

    expect(summaryById.get("task-complete")).toMatchObject({
      status: "completed",
      currentSessionId: "session-complete",
      orchestrationKind: "parallel",
      finishedAt: "2026-04-09T10:05:00.000Z",
    });
    expect(summaryById.get("task-queued")).toMatchObject({
      status: "pending",
      currentSessionId: "session-queued",
      orchestrationKind: "single",
      finishedAt: null,
    });
    expect(summaryById.get("task-awaiting")).toMatchObject({
      status: "awaiting_adoption",
      currentSessionId: "session-awaiting",
      orchestrationKind: "parallel",
      finishedAt: null,
    });
    expect(summaryById.get("task-fallback-status")).toMatchObject({
      status: "failed",
      currentSessionId: "session-fallback",
      orchestrationKind: "sequential-chain",
      finishedAt: "2026-04-09T10:03:00.000Z",
    });
  });
});