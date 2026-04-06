import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { taskSessions, taskTimelineViews } from "../../db/schema";
import {
  buildTaskSessionIdAliases,
  buildTaskSessionLineagePath,
  resolveTaskSessionRecordId,
  toCanonicalTaskSessionId,
} from "./task-session-read";

export async function buildTaskProjectionTimelineViewResponse(args: {
  taskId: string;
  projectId: string;
  sessionId?: string | null;
  includeLineage: boolean;
}) {
  let lineagePath: string[] = [];
  if (args.sessionId) {
    const rows = await db
      .select({
        id: taskSessions.id,
        parentSessionId: taskSessions.parentSessionId,
        runtimeSessionId: taskSessions.runtimeSessionId,
      })
      .from(taskSessions)
      .where(eq(taskSessions.taskId, args.taskId))
      .orderBy(asc(taskSessions.createdAt));
    const selectedSessionId = resolveTaskSessionRecordId(rows, args.sessionId) ?? args.sessionId;

    if (!args.includeLineage) {
      lineagePath = [selectedSessionId];
    } else {
      lineagePath = buildTaskSessionLineagePath(rows, selectedSessionId);
    }
  }

  const filters = [eq(taskTimelineViews.taskId, args.taskId)];
  if (lineagePath.length > 0) {
    filters.push(
      inArray(
        taskTimelineViews.sessionId,
        Array.from(
          new Set(lineagePath.flatMap((sessionId) => buildTaskSessionIdAliases(sessionId))),
        ),
      ),
    );
  }

  const timelineRows = await db
    .select({
      id: taskTimelineViews.id,
      taskId: taskTimelineViews.taskId,
      projectId: taskTimelineViews.projectId,
      sessionId: taskTimelineViews.sessionId,
      messageId: taskTimelineViews.messageId,
      operationId: taskTimelineViews.operationId,
      artifactId: taskTimelineViews.artifactId,
      itemKind: taskTimelineViews.itemKind,
      itemRole: taskTimelineViews.itemRole,
      title: taskTimelineViews.title,
      displayText: taskTimelineViews.displayText,
      metadataJson: taskTimelineViews.metadataJson,
      sortAt: taskTimelineViews.sortAt,
      createdAt: taskTimelineViews.createdAt,
      updatedAt: taskTimelineViews.updatedAt,
    })
    .from(taskTimelineViews)
    .where(and(...filters))
    .orderBy(asc(taskTimelineViews.sortAt), asc(taskTimelineViews.createdAt));

  const data = timelineRows.map((row) => ({
    ...row,
    sessionId: toCanonicalTaskSessionId(args.taskId, row.sessionId) ?? row.sessionId,
  }));

  return {
    data,
    meta: {
      readSource: "task-session-projection" as const,
      includeLineage: args.includeLineage,
      lineagePath,
      itemCount: data.length,
      cachedSessionCount: lineagePath.length,
      complete: data.length > 0,
      cacheState: data.length > 0 ? ("complete" as const) : ("none" as const),
    },
  };
}
