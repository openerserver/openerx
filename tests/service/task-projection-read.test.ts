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
  lineageRows?: unknown[];
  lineagePath?: string[];
  resolvedSessionId?: string | null;
  aliasMap?: Record<string, string[]>;
}) {
  importCounter += 1;

  const selectResults = args.lineageRows ? [args.lineageRows, args.resultRows ?? []] : [args.resultRows ?? []];
  let selectCallIndex = 0;
  const buildTaskSessionLineagePath = mock(() => args.lineagePath ?? []);
  const resolveTaskSessionRecordId = mock(
    (_rows: unknown[], sessionId?: string | null) => args.resolvedSessionId ?? sessionId ?? null,
  );
  const buildTaskSessionIdAliases = mock(
    (sessionId: string) => args.aliasMap?.[sessionId] ?? [sessionId],
  );

  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      select: mock(() => {
        const result =
          selectResults[Math.min(selectCallIndex, selectResults.length - 1)] ?? [];
        selectCallIndex += 1;
        return createSelectChain(result);
      }),
    },
  }));

  mock.module("../../control-plane/service/src/db/schema", () => ({
    sessionOperations: {},
    taskArtifacts: {},
    taskSessions: {
      id: "id",
      parentSessionId: "parentSessionId",
      taskId: "taskId",
      runtimeSessionId: "runtimeSessionId",
      createdAt: "createdAt",
    },
    taskSnapshots: {},
    taskTimelineViews: {
      id: "id",
      taskId: "taskId",
      projectId: "projectId",
      sessionId: "sessionId",
      messageId: "messageId",
      operationId: "operationId",
      artifactId: "artifactId",
      itemKind: "itemKind",
      itemRole: "itemRole",
      title: "title",
      displayText: "displayText",
      metadataJson: "metadataJson",
      sortAt: "sortAt",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
    taskUsageLedgerEntries: {},
  }));

  mock.module("../../control-plane/service/src/modules/tasks/task-session-read", () => ({
    buildTaskSessionLineagePath,
    buildTaskSessionIdAliases,
    resolveTaskSessionRecordId,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-projection-read.ts?task-projection-read-test=${importCounter}`
  );

  return {
    ...module,
    buildTaskSessionLineagePath,
    buildTaskSessionIdAliases,
    resolveTaskSessionRecordId,
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
        sessionId: "fork-session",
        messageId: "msg-1",
        operationId: null,
        artifactId: null,
        itemKind: "assistant-output",
        itemRole: "assistant",
        title: null,
        displayText: "fork output",
        metadataJson: null,
        sortAt: "2025-01-01T00:00:01.000Z",
        createdAt: "2025-01-01T00:00:01.000Z",
        updatedAt: "2025-01-01T00:00:01.000Z",
      },
    ];

    const { buildTaskProjectionTimelineViewResponse, buildTaskSessionLineagePath } =
      await loadTaskProjectionReadModule({ resultRows: timelineRows });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "fork-session",
      includeLineage: false,
    });

    expect(buildTaskSessionLineagePath).not.toHaveBeenCalled();
    expect(response).toEqual({
      data: timelineRows,
      meta: {
        readSource: "task-session-projection",
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
      buildTaskSessionLineagePath,
    } = await loadTaskProjectionReadModule({
      resultRows: [],
      lineageRows: [
        { id: "root-session", parentSessionId: null },
        { id: "fork-session", parentSessionId: "root-session" },
      ],
      lineagePath: ["root-session", "fork-session"],
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "fork-session",
      includeLineage: true,
    });

    expect(buildTaskSessionLineagePath).toHaveBeenCalledWith(
      [
        { id: "root-session", parentSessionId: null },
        { id: "fork-session", parentSessionId: "root-session" },
      ],
      "fork-session",
    );
    expect(response.meta).toEqual({
      readSource: "task-session-projection",
      includeLineage: true,
      lineagePath: ["root-session", "fork-session"],
      itemCount: 0,
      cachedSessionCount: 2,
      complete: false,
      cacheState: "none",
    });
  });

  test("canonicalizes legacy requested session ids before filtering projection timeline", async () => {
    const timelineRows = [
      {
        id: "timeline-1",
        taskId: "task-1",
        projectId: "project-1",
        sessionId: "task_session:task-1:fork-session",
        messageId: "msg-1",
        operationId: null,
        artifactId: null,
        itemKind: "assistant-output",
        itemRole: "assistant",
        title: null,
        displayText: "fork output",
        metadataJson: null,
        sortAt: "2025-01-01T00:00:01.000Z",
        createdAt: "2025-01-01T00:00:01.000Z",
        updatedAt: "2025-01-01T00:00:01.000Z",
      },
    ];

    const {
      buildTaskProjectionTimelineViewResponse,
      buildTaskSessionIdAliases,
      resolveTaskSessionRecordId,
    } = await loadTaskProjectionReadModule({
      resultRows: timelineRows,
      lineageRows: [
        { id: "task-session:task-1:fork-session", parentSessionId: null, runtimeSessionId: "fork-session" },
      ],
      resolvedSessionId: "task-session:task-1:fork-session",
      aliasMap: {
        "task-session:task-1:fork-session": [
          "task-session:task-1:fork-session",
          "task_session:task-1:fork-session",
        ],
      },
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "task_session:task-1:fork-session",
      includeLineage: false,
    });

    expect(resolveTaskSessionRecordId).toHaveBeenCalledWith(
      [
        {
          id: "task-session:task-1:fork-session",
          parentSessionId: null,
          runtimeSessionId: "fork-session",
        },
      ],
      "task_session:task-1:fork-session",
    );
    expect(buildTaskSessionIdAliases).toHaveBeenCalledWith("task-session:task-1:fork-session");
    expect(response.meta.lineagePath).toEqual(["task-session:task-1:fork-session"]);
    expect(response.data).toEqual(timelineRows);
  });
});
