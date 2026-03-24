import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { taskTimelineViews } from "../../db/schema";
import {
  buildConversationSessionId,
  buildTaskBranchLineagePath,
  listTaskBranchCompatTreeRecords,
  normalizeTaskBranchLineageRecords,
} from "./task-branch-compat-read";

export async function buildTaskProjectionTimelineViewResponse(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId?: string | null;
  includeLineage: boolean;
}) {
  let lineagePath: string[] = [];
  if (args.runtimeSessionId) {
    if (!args.includeLineage) {
      lineagePath = [args.runtimeSessionId];
    } else {
      const rows = await listTaskBranchCompatTreeRecords(args.taskId, args.projectId);
      lineagePath = buildTaskBranchLineagePath(
        normalizeTaskBranchLineageRecords(rows),
        args.runtimeSessionId,
      ).map((record) => record.runtimeSessionId);
    }
  }

  const sessionIds = lineagePath.map((runtimeSessionId) =>
    buildConversationSessionId(args.taskId, runtimeSessionId),
  );

  const filters = [eq(taskTimelineViews.taskId, args.taskId)];
  if (sessionIds.length > 0) {
    filters.push(inArray(taskTimelineViews.sessionId, sessionIds));
  }

  const data = await db
    .select({
      id: taskTimelineViews.id,
      taskId: taskTimelineViews.taskId,
      projectId: taskTimelineViews.projectId,
      runId: taskTimelineViews.runId,
      runNodeId: taskTimelineViews.runNodeId,
      sessionId: taskTimelineViews.sessionId,
      messageId: taskTimelineViews.messageId,
      itemKind: taskTimelineViews.itemKind,
      itemRole: taskTimelineViews.itemRole,
      title: taskTimelineViews.title,
      displayText: taskTimelineViews.displayText,
      metadataJson: taskTimelineViews.metadataJson,
      sortAt: taskTimelineViews.sortAt,
      createdAt: taskTimelineViews.createdAt,
    })
    .from(taskTimelineViews)
    .where(and(...filters))
    .orderBy(asc(taskTimelineViews.sortAt), asc(taskTimelineViews.createdAt));

  return {
    data,
    meta: {
      readSource: "task-domain-projection" as const,
      includeLineage: args.includeLineage,
      lineagePath,
      itemCount: data.length,
      cachedSessionCount: sessionIds.length,
      complete: data.length > 0,
      cacheState: data.length > 0 ? ("complete" as const) : ("none" as const),
    },
  };
}
