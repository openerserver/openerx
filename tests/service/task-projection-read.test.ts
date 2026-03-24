/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

function createSelectChain(resultRows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return {
            orderBy: mock(async () => resultRows),
          };
        },
      };
    },
  };
}

async function loadTaskProjectionReadModule(args: {
  resultRows?: unknown[];
  lineageRecords?: unknown[];
  normalizedLineageRecords?: unknown[];
  lineagePathRecords?: Array<{ runtimeSessionId: string }>;
}) {
  importCounter += 1;

  const listTaskSessionTreeRecords = mock(async () => args.lineageRecords ?? []);
  const normalizeTaskSessionLineageRecords = mock(() => args.normalizedLineageRecords ?? []);
  const buildTaskSessionLineagePath = mock(() => args.lineagePathRecords ?? []);

  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      select: mock(() => createSelectChain(args.resultRows ?? [])),
    },
  }));

  mock.module("../../control-plane/service/src/modules/tasks/task-session-read", () => ({
    buildConversationSessionId: (taskId: string, runtimeSessionId: string) =>
      `task_session:${taskId}:${runtimeSessionId}`,
    buildTaskSessionLineagePath,
    listTaskSessionTreeRecords,
    normalizeTaskSessionLineageRecords,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-projection-read.ts?task-projection-read-test=${importCounter}`
  );

  return {
    ...module,
    listTaskSessionTreeRecords,
    normalizeTaskSessionLineageRecords,
    buildTaskSessionLineagePath,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task projection read", () => {
  test("uses only the leaf runtime session when lineage inclusion is disabled", async () => {
    const timelineRows = [
      {
        id: "timeline-1",
        taskId: "task-1",
        projectId: "project-1",
        runId: null,
        runNodeId: null,
        sessionId: "task_session:task-1:fork-session",
        messageId: "msg-1",
        itemKind: "assistant-output",
        itemRole: "assistant",
        title: null,
        displayText: "fork output",
        metadataJson: null,
        sortAt: "2025-01-01T00:00:01.000Z",
        createdAt: "2025-01-01T00:00:01.000Z",
      },
    ];

    const { buildTaskProjectionTimelineViewResponse, listTaskSessionTreeRecords } =
      await loadTaskProjectionReadModule({ resultRows: timelineRows });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      runtimeSessionId: "fork-session",
      includeLineage: false,
    });

    expect(listTaskSessionTreeRecords).not.toHaveBeenCalled();
    expect(response).toEqual({
      data: timelineRows,
      meta: {
        readSource: "task-domain-projection",
        includeLineage: false,
        lineagePath: ["fork-session"],
        itemCount: 1,
        cachedSessionCount: 1,
        complete: true,
        cacheState: "complete",
      },
    });
  });

  test("expands lineage path through task session records when requested", async () => {
    const {
      buildTaskProjectionTimelineViewResponse,
      listTaskSessionTreeRecords,
      normalizeTaskSessionLineageRecords,
      buildTaskSessionLineagePath,
    } = await loadTaskProjectionReadModule({
      resultRows: [],
      lineageRecords: [{ id: "raw-session-record" }],
      normalizedLineageRecords: [
        { runtimeSessionId: "root-session" },
        { runtimeSessionId: "fork-session" },
      ],
      lineagePathRecords: [
        { runtimeSessionId: "root-session" },
        { runtimeSessionId: "fork-session" },
      ],
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      runtimeSessionId: "fork-session",
      includeLineage: true,
    });

    expect(listTaskSessionTreeRecords).toHaveBeenCalledWith("task-1", "project-1");
    expect(normalizeTaskSessionLineageRecords).toHaveBeenCalledWith([{ id: "raw-session-record" }]);
    expect(buildTaskSessionLineagePath).toHaveBeenCalledWith(
      [{ runtimeSessionId: "root-session" }, { runtimeSessionId: "fork-session" }],
      "fork-session",
    );
    expect(response.meta).toEqual({
      readSource: "task-domain-projection",
      includeLineage: true,
      lineagePath: ["root-session", "fork-session"],
      itemCount: 0,
      cachedSessionCount: 2,
      complete: false,
      cacheState: "none",
    });
  });
});
