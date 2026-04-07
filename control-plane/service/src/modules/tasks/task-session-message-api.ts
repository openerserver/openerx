import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { taskMessages, taskOperations, taskSessions } from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import type {
  PostTaskSessionMessageInput,
  PostTaskSessionMessageResponse,
  TaskSessionMessageApiStatus,
  TaskSessionMessageApiSummary,
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

type CanonicalTaskMessageSummaryRow = {
  id: string;
  sessionId: string;
  role: string;
  status: string;
  clientMessageId: string | null;
  runtimeMessageId: string | null;
  seq: number;
  textContent: string | null;
  textPreview: string | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
};

const CANONICAL_TASK_MESSAGE_SUMMARY_COLUMNS = {
  id: taskMessages.id,
  sessionId: taskMessages.sessionId,
  role: taskMessages.role,
  status: taskMessages.status,
  clientMessageId: taskMessages.clientMessageId,
  runtimeMessageId: taskMessages.runtimeMessageId,
  seq: taskMessages.seq,
  textContent: taskMessages.textContent,
  textPreview: taskMessages.textPreview,
  errorText: taskMessages.errorText,
  createdAt: taskMessages.createdAt,
  completedAt: taskMessages.completedAt,
};

function buildUserRuntimeMessageId(clientMessageId: string) {
  return `user:${clientMessageId}`;
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

function normalizeMessageRole(role: string): TaskSessionMessageApiSummary["role"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }

  return "assistant";
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

function mapCanonicalTaskMessage(
  message: CanonicalTaskMessageSummaryRow,
): TaskSessionMessageSummaryRecord {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    clientMessageId: message.clientMessageId ?? null,
    runtimeMessageId: message.runtimeMessageId ?? null,
    messageIndex: message.seq,
    textContent: message.textContent ?? message.textPreview ?? null,
    errorText: message.errorText ?? null,
    createdAt: message.createdAt,
    completedAt: message.completedAt ?? null,
  };
}

function mapMessageSummary(message: TaskSessionMessageSummaryRecord): TaskSessionMessageApiSummary {
  return {
    id: message.id,
    client_message_id: message.clientMessageId ?? undefined,
    role: normalizeMessageRole(message.role),
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

async function loadTaskSessionMessageById(messageId: string) {
  const [message] = await db
    .select(CANONICAL_TASK_MESSAGE_SUMMARY_COLUMNS)
    .from(taskMessages)
    .where(eq(taskMessages.id, messageId))
    .limit(1);
  return message ? mapCanonicalTaskMessage(message) : null;
}

async function loadTaskSessionMessageByClientMessageId(
  sessionId: string,
  clientMessageId: string,
) {
  const [message] = await db
    .select(CANONICAL_TASK_MESSAGE_SUMMARY_COLUMNS)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.sessionId, sessionId),
        eq(taskMessages.clientMessageId, clientMessageId),
      ),
    )
    .limit(1);
  return message ? mapCanonicalTaskMessage(message) : null;
}

async function loadTaskSessionMessageByRuntimeId(
  sessionId: string,
  runtimeMessageId: string,
) {
  const [message] = await db
    .select(CANONICAL_TASK_MESSAGE_SUMMARY_COLUMNS)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.sessionId, sessionId),
        eq(taskMessages.runtimeMessageId, runtimeMessageId),
      ),
    )
    .limit(1);
  return message ? mapCanonicalTaskMessage(message) : null;
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
  const existingSummary =
    existing?.summaryJson && typeof existing.summaryJson === "object"
      ? (existing.summaryJson as Record<string, unknown>)
      : {};
  const preservedMessageId = existing?.messageId ?? null;

  const taskOperationRunId = buildTaskSessionDefaultRunId(args.sessionId);

  await db
    .insert(taskOperations)
    .values({
      id: operationId,
      taskId: args.task.id,
      sessionId: args.sessionId,
      runId: taskOperationRunId,
      messageId: preservedMessageId,
      parentOperationId: null,
      runtimeOperationId,
      operationIndex,
      operationKind: "model_request",
      toolName: null,
      title: "model_request",
      status: "queued",
      summaryJson: {
        ...existingSummary,
        clientMessageId: args.clientMessageId,
        sourceMessageId: args.sourceMessageId,
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
        messageId: preservedMessageId,
        runtimeOperationId,
        operationKind: "model_request",
        status: "queued",
        summaryJson: {
          ...existingSummary,
          clientMessageId: args.clientMessageId,
          sourceMessageId: args.sourceMessageId,
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

type CreateTaskSessionMessageApiDeps = {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  upsertTaskSessionMessageRecord: (args: {
    task: { id: string; projectId: string };
    sessionId?: string;
    runtimeSessionId?: string;
    message: Record<string, unknown>;
  }) => Promise<{ messageId: string; sessionId: string; seq: number }>;
};

type TaskSessionPostContext = {
  task: PersistedTask;
  session: typeof taskSessions.$inferSelect;
  now: string;
  userRuntimeMessageId: string;
};

type EnsuredTaskSessionMessage = {
  message: TaskSessionMessageSummaryRecord;
  created: boolean;
};

async function resolvePostTaskSessionContext(
  input: PostTaskSessionMessageInput,
  loadTaskTreeBackedRecord: CreateTaskSessionMessageApiDeps["loadTaskTreeBackedRecord"],
): Promise<RouteResult<TaskSessionPostContext, 200>> {
  const taskRecord = await loadTaskTreeBackedRecord(input.taskId);
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

  return {
    ok: true,
    status: 200,
    data: {
      task: asTaskProject(taskRecord, session),
      session,
      now: new Date().toISOString(),
      userRuntimeMessageId: buildUserRuntimeMessageId(input.client_message_id),
    },
  };
}

async function ensureUserTaskSessionMessage(
  deps: CreateTaskSessionMessageApiDeps,
  context: TaskSessionPostContext,
  input: PostTaskSessionMessageInput,
): Promise<RouteResult<EnsuredTaskSessionMessage, 200>> {
  let userMessage = await loadTaskSessionMessageByClientMessageId(
    context.session.id,
    input.client_message_id,
  );
  let created = false;

  if (!userMessage) {
    created = true;
    const persistedUser = await deps.upsertTaskSessionMessageRecord({
      task: context.task,
      sessionId: context.session.id,
      message: {
        id: context.userRuntimeMessageId,
        runtimeMessageId: context.userRuntimeMessageId,
        role: "user",
        status: "completed",
        clientMessageId: input.client_message_id,
        text: input.text,
        textContent: input.text,
        summaryText: input.text,
        parts: [{ type: "text", text: input.text }],
        attachments: input.attachments,
        createdAt: context.now,
        completedAt: context.now,
      },
    });
    userMessage = await loadTaskSessionMessageById(persistedUser.messageId);
  }

  if (!userMessage) {
    return { ok: false, status: 500, error: "Failed to persist user message" };
  }

  return {
    ok: true,
    status: 200,
    data: {
      message: userMessage,
      created,
    },
  };
}

async function resolveOperationAssistantMessage(operation: {
  messageId?: string | null;
}): Promise<TaskSessionMessageSummaryRecord | null> {
  if (!operation.messageId) {
    return null;
  }

  const assistantMessage = await loadTaskSessionMessageById(operation.messageId);
  if (!assistantMessage || normalizeMessageRole(assistantMessage.role) !== "assistant") {
    return null;
  }

  return assistantMessage;
}

export function createTaskSessionMessageApi(deps: CreateTaskSessionMessageApiDeps) {
  async function postTaskSessionMessage(
    input: PostTaskSessionMessageInput,
  ): Promise<RouteResult<PostTaskSessionMessageResponse, 200 | 201>> {
    const contextResult = await resolvePostTaskSessionContext(input, deps.loadTaskTreeBackedRecord);
    if (!contextResult.ok) {
      return contextResult;
    }

    const context = contextResult.data;
    const userMessageResult = await ensureUserTaskSessionMessage(deps, context, input);
    if (!userMessageResult.ok) {
      return userMessageResult;
    }

    const operation = await upsertQueuedModelRequestOperation({
      task: context.task,
      sessionId: context.session.id,
      clientMessageId: input.client_message_id,
      sourceMessageId: userMessageResult.data.message.id,
      attachments: input.attachments,
    });
    const assistantMessage = await resolveOperationAssistantMessage(operation.operation);
    const created = userMessageResult.data.created || operation.created;

    return {
      ok: true,
      status: created ? 201 : 200,
      data: {
        task_id: input.taskId,
        session_id: context.session.id,
        user_message: mapMessageSummary(userMessageResult.data.message),
        assistant_message: assistantMessage ? mapMessageSummary(assistantMessage) : null,
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
