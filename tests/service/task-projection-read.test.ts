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
}) {
  importCounter += 1;

  const buildLineagePath = (
    rows: Array<{ id: string; parentSessionId: string | null }>,
    sessionId: string,
  ) => {
    if (args.lineagePath) {
      return args.lineagePath;
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const path: string[] = [];
    let cursor: string | null = sessionId;
    while (cursor) {
      path.unshift(cursor);
      cursor = byId.get(cursor)?.parentSessionId ?? null;
    }
    return path;
  };

  const selectResults = [args.lineageRows ?? [], args.resultRows ?? []];
  let selectCallIndex = 0;

  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      select: mock(() => {
        const result = selectResults[Math.min(selectCallIndex, selectResults.length - 1)] ?? [];
        selectCallIndex += 1;
        return createSelectChain(result);
      }),
    },
  }));

  mock.module("../../control-plane/service/src/modules/tasks/task-session-read", () => ({
    shouldPersistStandalonePartEvent: () => true,
    toCanonicalTaskSessionId: (taskId: string, sessionId?: string | null) =>
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.startsWith("task-session:")
          ? sessionId
          : `task-session:${taskId}:${sessionId.trim()}`
        : null,
    resolveTaskSessionRecordId: mock(
      (
        rows: Array<{ id: string; runtimeSessionId?: string | null }>,
        sessionId: string,
      ) =>
        args.resolvedSessionId ??
        rows.find((row) => row.id === sessionId)?.id ??
        rows.find((row) => row.runtimeSessionId === sessionId)?.id ??
        null,
    ),
    buildTaskSessionLineagePath: mock(
      (
        rows: Array<{ id: string; parentSessionId: string | null }>,
        sessionId: string,
      ) => buildLineagePath(rows, sessionId),
    ),
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-projection-read.ts?task-projection-read-test=${importCounter}`
  );

  return module;
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
        sessionId: "task-session:task-1:fork-session",
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

    const { buildTaskProjectionTimelineViewResponse } = await loadTaskProjectionReadModule({
      resultRows: timelineRows,
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "fork-session",
      includeLineage: false,
    });

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
    const { buildTaskProjectionTimelineViewResponse } = await loadTaskProjectionReadModule({
      resultRows: [],
      lineageRows: [
        { id: "root-session", parentSessionId: null },
        { id: "fork-session", parentSessionId: "root-session" },
      ],
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "fork-session",
      includeLineage: true,
    });

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

  test("filters projection timeline by canonical session ids only", async () => {
    const timelineRows = [
      {
        id: "timeline-1",
        taskId: "task-1",
        projectId: "project-1",
        sessionId: "task-session:task-1:fork-session",
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

    const { buildTaskProjectionTimelineViewResponse } = await loadTaskProjectionReadModule({
      resultRows: timelineRows,
      lineageRows: [
        {
          id: "task-session:task-1:fork-session",
          parentSessionId: null,
          runtimeSessionId: "fork-session",
        },
      ],
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "task-session:task-1:fork-session",
      includeLineage: false,
    });

    expect(response.meta.lineagePath).toEqual(["task-session:task-1:fork-session"]);
    expect(response.data).toEqual(timelineRows);
  });

  test("collapses duplicated tool timeline rows written with mixed runtime ids", async () => {
    const sessionId = "task-session:task-1:runtime-1";
    const timelineRows = [
      {
        id: "timeline-1",
        taskId: "task-1",
        projectId: "project-1",
        sessionId,
        messageId: `task-session-message:${sessionId}:runtime-1:tool:write_1`,
        operationId: null,
        artifactId: null,
        itemKind: "message",
        itemRole: "tool",
        title: null,
        displayText: "Successfully wrote 73 bytes to print_cc.c",
        metadataJson: {
          runtimeMessageId: "runtime-1:tool:write_1",
        },
        sortAt: "2025-01-01T00:00:01.000Z",
        createdAt: "2025-01-01T00:00:01.000Z",
        updatedAt: "2025-01-01T00:00:01.000Z",
      },
      {
        id: "timeline-2",
        taskId: "task-1",
        projectId: "project-1",
        sessionId,
        messageId: `task-session-message:${sessionId}:tool:write_1`,
        operationId: null,
        artifactId: null,
        itemKind: "message",
        itemRole: "tool",
        title: null,
        displayText: "Successfully wrote 73 bytes to print_cc.c",
        metadataJson: {
          runtimeMessageId: "tool:write_1",
        },
        sortAt: "2025-01-01T00:00:02.000Z",
        createdAt: "2025-01-01T00:00:02.000Z",
        updatedAt: "2025-01-01T00:00:02.000Z",
      },
    ];

    const { buildTaskProjectionTimelineViewResponse } = await loadTaskProjectionReadModule({
      resultRows: timelineRows,
      lineageRows: [
        {
          id: sessionId,
          parentSessionId: null,
          runtimeSessionId: "runtime-1",
        },
      ],
    });

    const response = await buildTaskProjectionTimelineViewResponse({
      taskId: "task-1",
      projectId: "project-1",
      sessionId,
      includeLineage: false,
    });

    expect(response.data).toEqual([
      expect.objectContaining({
        id: "timeline-2",
        sessionId,
        itemRole: "tool",
        displayText: "Successfully wrote 73 bytes to print_cc.c",
      }),
    ]);
    expect(response.meta).toEqual({
      readSource: "task-session-projection",
      includeLineage: false,
      lineagePath: [sessionId],
      itemCount: 1,
      cachedSessionCount: 1,
      complete: true,
      cacheState: "complete",
    });
  });
});
