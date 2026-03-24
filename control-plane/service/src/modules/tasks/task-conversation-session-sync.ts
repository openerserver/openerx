import { eq } from "drizzle-orm";
import { db } from "../../db";
import { conversationSessions } from "../../db/schema";
import type { AppendTaskDomainEventArgs } from "./task-domain-projector";
import {
  buildConversationSessionId,
  mapSourceTypeToConversationSessionKind,
} from "./task-session-read";

type TaskConversationSessionRecordArgs = {
  task: {
    id: string;
    projectId: string;
  };
  runtimeSessionId: string;
  parentRuntimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  branchName?: string | null;
  sourceType?: "root" | "fork" | "sub_session" | null;
  isActive?: boolean;
  archivedAt?: string | null;
};

function buildConversationParentSessionId(taskId: string, parentRuntimeSessionId?: string | null) {
  return parentRuntimeSessionId ? buildConversationSessionId(taskId, parentRuntimeSessionId) : null;
}

async function loadConversationParentSessionRootId(parentSessionId: string | null) {
  if (!parentSessionId) {
    return null;
  }

  const existingParent = await db.query.conversationSessions.findFirst({
    where: eq(conversationSessions.id, parentSessionId),
  });

  return existingParent?.rootSessionId ?? null;
}

function buildConversationSessionRootId(
  sessionId: string,
  parentSessionId: string | null,
  rootId: string | null,
) {
  return rootId ?? parentSessionId ?? sessionId;
}

function buildConversationSessionUpsertValues(args: {
  sessionId: string;
  parentSessionId: string | null;
  rootSessionId: string;
  isActive: boolean;
  now: string;
  input: TaskConversationSessionRecordArgs;
}) {
  return {
    id: args.sessionId,
    projectId: args.input.task.projectId,
    taskId: args.input.task.id,
    runId: null,
    runNodeId: null,
    parentSessionId: args.parentSessionId,
    rootSessionId: args.rootSessionId,
    forkedFromMessageId: args.input.forkedFromMessageId ?? null,
    sessionKind: mapSourceTypeToConversationSessionKind(args.input.sourceType),
    sourceType: args.input.sourceType ?? "root",
    branchName: args.input.branchName ?? null,
    isActive: args.isActive,
    runtimeSessionId: args.input.runtimeSessionId,
    treeNodeId: args.sessionId,
    createdAt: args.now,
    updatedAt: args.now,
    archivedAt: args.input.archivedAt ?? null,
  };
}

function buildConversationSessionUpdateValues(args: {
  sessionId: string;
  parentSessionId: string | null;
  rootSessionId: string;
  isActive: boolean;
  now: string;
  input: TaskConversationSessionRecordArgs;
}) {
  return {
    parentSessionId: args.parentSessionId,
    rootSessionId: args.rootSessionId,
    forkedFromMessageId: args.input.forkedFromMessageId ?? null,
    sessionKind: mapSourceTypeToConversationSessionKind(args.input.sourceType),
    sourceType: args.input.sourceType ?? "root",
    branchName: args.input.branchName ?? null,
    isActive: args.isActive,
    runtimeSessionId: args.input.runtimeSessionId,
    treeNodeId: args.sessionId,
    updatedAt: args.now,
    archivedAt: args.input.archivedAt ?? null,
  };
}

function buildConversationSessionEventPayload(args: {
  sessionId: string;
  isActive: boolean;
  input: TaskConversationSessionRecordArgs;
}) {
  return {
    runtimeSessionId: args.input.runtimeSessionId,
    sessionId: args.sessionId,
    parentRuntimeSessionId: args.input.parentRuntimeSessionId ?? null,
    forkedFromMessageId: args.input.forkedFromMessageId ?? null,
    branchName: args.input.branchName ?? null,
    sourceType: args.input.sourceType ?? "root",
    isActive: args.isActive,
    archivedAt: args.input.archivedAt ?? null,
  };
}

export function createTaskConversationSessionSyncApi(deps: {
  appendTaskDomainEvent: (args: AppendTaskDomainEventArgs) => Promise<unknown>;
}) {
  async function upsertConversationSessionRecord(args: TaskConversationSessionRecordArgs) {
    const sessionId = buildConversationSessionId(args.task.id, args.runtimeSessionId);
    const parentSessionId = buildConversationParentSessionId(
      args.task.id,
      args.parentRuntimeSessionId,
    );
    const parentRootSessionId = await loadConversationParentSessionRootId(parentSessionId);
    const isActive = args.isActive ?? false;
    const now = new Date().toISOString();
    const rootSessionId = buildConversationSessionRootId(
      sessionId,
      parentSessionId,
      parentRootSessionId,
    );

    if (isActive) {
      await db
        .update(conversationSessions)
        .set({ isActive: false, updatedAt: now })
        .where(eq(conversationSessions.taskId, args.task.id));
    }

    await db
      .insert(conversationSessions)
      .values(
        buildConversationSessionUpsertValues({
          sessionId,
          parentSessionId,
          rootSessionId,
          isActive,
          now,
          input: args,
        }),
      )
      .onConflictDoUpdate({
        target: conversationSessions.id,
        set: buildConversationSessionUpdateValues({
          sessionId,
          parentSessionId,
          rootSessionId,
          isActive,
          now,
          input: args,
        }),
      });

    await deps.appendTaskDomainEvent({
      projectId: args.task.projectId,
      taskId: args.task.id,
      sessionId,
      eventType: "conversation.session.upserted",
      payload: buildConversationSessionEventPayload({ sessionId, isActive, input: args }),
    });

    return sessionId;
  }

  return { upsertConversationSessionRecord };
}
