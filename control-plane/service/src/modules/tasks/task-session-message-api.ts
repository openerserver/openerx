import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  taskMessages,
  taskOperations,
  taskSessions,
} from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import type {
  PostTaskSessionMessageInput,
  PostTaskSessionMessageResponse,
  TaskSessionMessageApiStatus,
  TaskSessionOperationApiStatus,
} from "./task-session-message-dto";
import { buildTaskSessionDefaultRunId } from "./task-session-write-api";

type RouteErrorStatus = 400 | 404 | 409 | 500;

type RouteResult<T, S extends number = 200 | 201> =
  | { ok: true; status: S; data: T }
  | { ok: false; status: RouteErrorStatus; error: string; details?: unknown };

type PersistedTask = Pick<TaskTreeRecord, "id"> & {
  projectId: string;
};

type TaskSessionMessageSummaryRecord = {
  id: string;
  role: string;
  status?: string | null;
  clientMessageId?: string | null;
  runtimeMessageId?: string | null;
  messageIndex: number;
  textContent?: string | null;
  errorText?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

function buildUserRuntimeMessageId(clientMessageId: string) {
  return `user:${clientMessageId}`;
}

function buildAssistantRuntimeMessageId(clientMessageId: string) {
  return `assistant:${clientMessageId}`;
}

function buildQueuedModelRequestRuntimeOperationId(clientMessageId: string) {
  return `model-request:${clientMessageId}`;
}

function buildQueuedModelRequestOperationId(taskId: string, clientMessageId: string) {
  return `session-operation:${taskId}:model-request:${clientMessageId}`;
}

function normalizeMessageStatus(message: {
  role: string;
  status?: string | null;
  completedAt?: string | null;
  textContent?: string | null;
  errorText?: string | null;
}): TaskSessionMessageApiStatus {
  if (
    message.status === "pending" ||
    message.status === "streaming" ||
    message.status === "completed" ||
    message.status === "failed" ||
    message.status === "cancelled"
  ) {
    return message.status;
  }

  if (message.errorText) {
    return "failed";
  }
  if (message.completedAt) {
    return "completed";
  }
  if (message.role === "user") {
    return "completed";
  }
  if (message.textContent) {
    return "streaming";
  }

  return "pending";
}

function normalizeOperationStatus(status?: string | null): TaskSessionOperationApiStatus {
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }

  if (status === "complete") {
    return "completed";
  }

  return "queued";
}

function asTaskProject(task: TaskTreeRecord | null, session: typeof taskSessions.$inferSelect) {
  return {
    id: task?.id ?? session.taskId,
    projectId: task?.projectId ?? session.projectId,
  } satisfies PersistedTask;
}

function asTaskMessagePayload(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractTaskMessagePayloadText(payload: Record<string, unknown> | null) {
  if (!payload) {
    return null;
  }

  const candidates = [payload.textContent, payload.text, payload.summaryText, payload.content];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) {
      return text;
    }
    const content = (part as Record<string, unknown>).content;
    if (typeof content === "string" && content.trim()) {
      return content;
    }
  }

  return null;
}

function mapCanonicalTaskMessage(message: typeof taskMessages.$inferSelect): TaskSessionMessageSummaryRecord {
  const rawPayload = asTaskMessagePayload(message.rawPayload);
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    clientMessageId: message.clientMessageId ?? null,
    runtimeMessageId: message.runtimeMessageId ?? null,
    messageIndex: message.seq,
    textContent:
      message.textContent ??
      extractTaskMessagePayloadText(rawPayload) ??
      message.textPreview ??
      null,
    errorText:
      message.errorText ??
      (typeof rawPayload?.errorText === "string" && rawPayload.errorText.trim()
        ? rawPayload.errorText
        : null),
    createdAt: message.createdAt,
    completedAt: message.completedAt ?? null,
  };
}

function mapMessageSummary(message: TaskSessionMessageSummaryRecord) {
  return {
    id: message.id,
    client_message_id: message.clientMessageId ?? undefined,
    role: message.role,
    status: normalizeMessageStatus(message),
    text: message.textContent ?? null,
    message_index: message.messageIndex,
    created_at: message.createdAt,
    completed_at: message.completedAt ?? null,
  };
}

async function loadTaskSessionRecord(taskId: string, sessionId: string) {
  return db.query.taskSessions.findFirst({
    where: and(eq(taskSessions.taskId, taskId), eq(taskSessions.id, sessionId)),
  });
}

async function loadCanonicalTaskSessionMessageById(messageId: string) {
  const message = await db.query.taskMessages.findFirst({
    where: eq(taskMessages.id, messageId),
  });
  return message ? mapCanonicalTaskMessage(message) : null;
}

async function loadTaskSessionMessageById(messageId: string) {
  return loadCanonicalTaskSessionMessageById(messageId);
}

async function loadCanonicalTaskSessionMessageByClientMessageId(
  sessionId: string,
  clientMessageId: string,
) {
  const message = await db.query.taskMessages.findFirst({
    where: and(
      eq(taskMessages.sessionId, sessionId),
      eq(taskMessages.clientMessageId, clientMessageId),
    ),
  });
  return message ? mapCanonicalTaskMessage(message) : null;
}

async function loadTaskSessionMessageByClientMessageId(sessionId: string, clientMessageId: string) {
  return loadCanonicalTaskSessionMessageByClientMessageId(sessionId, clientMessageId);
}

async function loadCanonicalTaskSessionMessageByRuntimeId(
  sessionId: string,
  runtimeMessageId: string,
) {
  const message = await db.query.taskMessages.findFirst({
    where: and(
      eq(taskMessages.sessionId, sessionId),
      eq(taskMessages.runtimeMessageId, runtimeMessageId),
    ),
  });
  return message ? mapCanonicalTaskMessage(message) : null;
}

async function loadTaskSessionMessageByRuntimeId(sessionId: string, runtimeMessageId: string) {
  return loadCanonicalTaskSessionMessageByRuntimeId(sessionId, runtimeMessageId);
}

async function loadSessionOperationByRuntimeId(sessionId: string, runtimeOperationId: string) {
  return db.query.taskOperations.findFirst({
    where: and(
      eq(taskOperations.sessionId, sessionId),
      eq(taskOperations.runtimeOperationId, runtimeOperationId),
    ),
  });
}

async function upsertQueuedModelRequestOperation(args: {
  task: PersistedTask;
  sessionId: string;
  clientMessageId: string;
  sourceMessageId: string;
  targetMessageId: string;
  attachments: Array<Record<string, unknown>>;
}) {
  const existing = await loadSessionOperationByRuntimeId(
    args.sessionId,
    buildQueuedModelRequestRuntimeOperationId(args.clientMessageId),
  );
  const latestOperation = await db.query.taskOperations.findFirst({
    where: eq(taskOperations.sessionId, args.sessionId),
    orderBy: [desc(taskOperations.operationIndex)],
  });
  const operationIndex = existing?.operationIndex ?? (latestOperation?.operationIndex ?? -1) + 1;
  const now = new Date().toISOString();
  const operationId = buildQueuedModelRequestOperationId(args.task.id, args.clientMessageId);
  const runtimeOperationId = buildQueuedModelRequestRuntimeOperationId(args.clientMessageId);

  const taskOperationRunId = buildTaskSessionDefaultRunId(args.sessionId);

  await db
    .insert(taskOperations)
    .values({
      id: operationId,
      taskId: args.task.id,
      sessionId: args.sessionId,
      runId: taskOperationRunId,
      messageId: args.targetMessageId,
      parentOperationId: null,
      runtimeOperationId,
      operationIndex,
      operationKind: "model_request",
      toolName: null,
      title: "model_request",
      status: "queued",
      summaryJson: {
        clientMessageId: args.clientMessageId,
        sourceMessageId: args.sourceMessageId,
        targetMessageId: args.targetMessageId,
        attachments: args.attachments,
      },
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskOperations.id,
      set: {
        sessionId: args.sessionId,
        runId: taskOperationRunId,
        messageId: args.targetMessageId,
        runtimeOperationId,
        operationKind: "model_request",
        status: "queued",
        summaryJson: {
          clientMessageId: args.clientMessageId,
          sourceMessageId: args.sourceMessageId,
          targetMessageId: args.targetMessageId,
          attachments: args.attachments,
        },
        updatedAt: now,
      },
    });

  const persisted = await db.query.taskOperations.findFirst({
    where: eq(taskOperations.id, operationId),
  });

  if (!persisted) {
    throw new Error(`Failed to persist session operation ${operationId}`);
  }

  return {
    operation: persisted,
    created: !existing,
  };
}

export function createTaskSessionMessageApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  upsertTaskSessionMessageRecord: (args: {
    task: { id: string; projectId: string };
    sessionId?: string;
    runtimeSessionId?: string;
    message: Record<string, unknown>;
  }) => Promise<{ messageId: string; sessionId: string; seq: number }>;
}) {
  async function postTaskSessionMessage(
    input: PostTaskSessionMessageInput,
  ): Promise<RouteResult<PostTaskSessionMessageResponse, 200 | 201>> {
    const taskRecord = await deps.loadTaskTreeBackedRecord(input.taskId);
    if (!taskRecord) {
      return { ok: false, status: 404, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(input.taskId, input.sessionId);
    if (!session) {
      return { ok: false, status: 404, error: "Task session not found" };
    }
    if (session.archivedAt) {
      return {
        ok: false,
        status: 409,
        error: "Task session is not writable",
        details: { archivedAt: session.archivedAt },
      };
    }

    const task = asTaskProject(taskRecord, session);
    const userRuntimeMessageId = buildUserRuntimeMessageId(input.client_message_id);
    const assistantRuntimeMessageId = buildAssistantRuntimeMessageId(input.client_message_id);
    const now = new Date().toISOString();
    let created = false;

    let userMessage = await loadTaskSessionMessageByClientMessageId(
      session.id,
      input.client_message_id,
    );

    if (!userMessage) {
      created = true;
      const persistedUser = await deps.upsertTaskSessionMessageRecord({
        task,
        sessionId: session.id,
        message: {
          id: userRuntimeMessageId,
          runtimeMessageId: userRuntimeMessageId,
          role: "user",
          status: "completed",
          clientMessageId: input.client_message_id,
          text: input.text,
          textContent: input.text,
          summaryText: input.text,
          parts: [{ type: "text", text: input.text }],
          attachments: input.attachments,
          createdAt: now,
          completedAt: now,
        },
      });
      userMessage = await loadTaskSessionMessageById(persistedUser.messageId);
    }

    if (!userMessage) {
      return { ok: false, status: 500, error: "Failed to persist user message" };
    }

    let assistantMessage = await loadTaskSessionMessageByRuntimeId(
      session.id,
      assistantRuntimeMessageId,
    );

    if (!assistantMessage) {
      created = true;
      const persistedAssistant = await deps.upsertTaskSessionMessageRecord({
        task,
        sessionId: session.id,
        message: {
          id: assistantRuntimeMessageId,
          runtimeMessageId: assistantRuntimeMessageId,
          role: "assistant",
          status: "pending",
          text: "",
          textContent: null,
          summaryText: null,
          parts: [],
          createdAt: new Date(Date.parse(now) + 1).toISOString(),
          completedAt: null,
          metadata: {
            sourceClientMessageId: input.client_message_id,
          },
        },
      });
      assistantMessage = await loadTaskSessionMessageById(persistedAssistant.messageId);
    }

    if (!assistantMessage) {
      return { ok: false, status: 500, error: "Failed to persist assistant placeholder" };
    }

    const operation = await upsertQueuedModelRequestOperation({
      task,
      sessionId: session.id,
      clientMessageId: input.client_message_id,
      sourceMessageId: userMessage.id,
      targetMessageId: assistantMessage.id,
      attachments: input.attachments,
    });
    created = created || operation.created;

    return {
      ok: true,
      status: created ? 201 : 200,
      data: {
        task_id: input.taskId,
        session_id: session.id,
        user_message: mapMessageSummary(userMessage),
        assistant_message: mapMessageSummary(assistantMessage),
        operation: {
          id: operation.operation.id,
          kind: "model_request",
          status: normalizeOperationStatus(operation.operation.status),
        },
      },
    };
  }

  return {
    postTaskSessionMessage,
  };
}