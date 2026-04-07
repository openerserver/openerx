/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

type SnapshotRow = {
  taskId: string;
  projectId: string;
  lifecycleStatus: string | null;
  currentExecutionMode: string | null;
  currentExecutionStatus: string | null;
  currentSessionId: string | null;
  latestSessionId: string | null;
  latestResultSummary: string | null;
  latestErrorText: string | null;
  activeCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
  lastActivityAt: string;
  updatedAt: string;
};

function makeSnapshotRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    taskId: "task-1",
    projectId: "project-1",
    lifecycleStatus: "done",
    currentExecutionMode: "single",
    currentExecutionStatus: "complete",
    currentSessionId: null,
    latestSessionId: null,
    latestResultSummary: "done",
    latestErrorText: null,
    activeCandidateCount: 0,
    totalChainSteps: 0,
    completedChainSteps: 0,
    lastActivityAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    ...overrides,
  };
}

async function loadTaskSnapshotReadModule(args: {
  snapshotRows?: SnapshotRow[];
  snapshotRow?: SnapshotRow | null;
}) {
  importCounter += 1;

  const orderBy = mock(async () => args.snapshotRows ?? []);
  const findFirst = mock(async () => args.snapshotRow ?? null);
  const findMany = mock(async () => []);

  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      select: mock(() => ({
        from: mock(() => ({
          orderBy,
        })),
      })),
      query: {
        taskSnapshots: {
          findFirst,
        },
        taskSessions: {
          findMany,
        },
      },
    },
  }));

  mock.module("../../control-plane/service/src/db/schema", () => ({
    taskSessions: {
      id: "id",
      runtimeSessionId: "runtimeSessionId",
    },
    taskSnapshots: {
      projectId: "projectId",
      taskId: "taskId",
      updatedAt: "updatedAt",
      currentSessionId: "currentSessionId",
      latestSessionId: "latestSessionId",
    },
  }));

  return import(
    `../../control-plane/service/src/modules/tasks/task-snapshot-read.ts?task-snapshot-read-test=${importCounter}`
  );
}

afterEach(() => {
  mock.restore();
});

describe("task snapshot read", () => {
  test("normalizes complete execution status to completed in snapshot list filtering", async () => {
    const { createTaskSnapshotReadApi } = await loadTaskSnapshotReadModule({
      snapshotRows: [makeSnapshotRow()],
    });
    const api = createTaskSnapshotReadApi({
      loadTaskTreeBackedRecord: mock(async () => null),
    });

    const result = await api.listTaskSnapshots({ status: "completed", limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.currentStatus).toBe("completed");
  });

  test("normalizes complete execution status in single snapshot responses", async () => {
    const { createTaskSnapshotReadApi } = await loadTaskSnapshotReadModule({
      snapshotRow: makeSnapshotRow(),
    });
    const api = createTaskSnapshotReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", sessionId: null } as never)),
    });

    const result = await api.getTaskSnapshot("task-1");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.data?.currentStatus).toBe("completed");
  });
});