import type {
  ExecutionTraceTimelineMeta,
  TaskExecutionTrace,
  TaskRoundDto,
  TaskRoundMessageDto,
  TaskRoundMessagesDto,
} from "./api";

type TaskConversationMessagesResponse = {
  data: unknown[];
  meta?: ExecutionTraceTimelineMeta & {
    sessionId?: string;
    messageCount?: number;
  };
};

export type TaskMessageSnapshotState = {
  sourceMessages: unknown[];
  resolvedSessionId: string | undefined;
  trace: TaskExecutionTrace;
};

function resolveTaskSnapshotRuntimeSessionId(taskId: string, sessionId?: string | null) {
  if (typeof sessionId !== "string") {
    return undefined;
  }

  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return undefined;
  }

  const canonicalPrefix = `task-session:${taskId}:`;
  if (normalizedSessionId.startsWith(canonicalPrefix)) {
    const runtimeSessionId = normalizedSessionId.slice(canonicalPrefix.length).trim();
    return runtimeSessionId || normalizedSessionId;
  }

  return normalizedSessionId;
}

export function resolveTaskSnapshotRound(
  rounds: TaskRoundDto[],
  requestedSessionId?: string,
) {
  if (!requestedSessionId) {
    return null;
  }

  return (
    rounds.find(
      (round) =>
        round.sessionId === requestedSessionId ||
        round.id === requestedSessionId ||
        resolveTaskSnapshotRuntimeSessionId(round.taskId, round.sessionId) === requestedSessionId ||
        resolveTaskSnapshotRuntimeSessionId(round.taskId, round.id) === requestedSessionId,
    ) ?? null
  );
}

function resolveTaskSnapshotPartType(part: TaskRoundMessageDto["parts"][number]) {
  const directType = typeof part.type === "string" ? part.type.trim() : "";
  if (directType) {
    return directType;
  }

  if (part.partType === "toolCall") {
    return "tool";
  }

  if (part.partType === "toolResult") {
    return "tool-result";
  }

  return "text";
}

function extractTaskSnapshotVisibleText(message: TaskRoundMessageDto) {
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    return message.text || undefined;
  }

  const text = message.parts
    .filter((part) => resolveTaskSnapshotPartType(part) === "text")
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n")
    .trim();

  return text || undefined;
}

export function toTaskSnapshotMessageRecord(message: TaskRoundMessageDto) {
  const completedAt = message.completedAt ?? message.updatedAt ?? null;
  const visibleText = extractTaskSnapshotVisibleText(message);

  return {
    id: message.id,
    role: message.role,
    status: message.status,
    errorText: message.errorText ?? undefined,
    text: visibleText,
    textContent: visibleText,
    createdAt: message.createdAt,
    completedAt,
    summaryText: visibleText,
    info: {
      id: message.id,
      role: message.role,
      status: message.status,
      preview: visibleText,
      time: {
        created: message.startedAt ?? message.createdAt,
        completed: completedAt,
      },
    },
    parts: message.parts.map((part) => {
      const partType = resolveTaskSnapshotPartType(part);
      const normalizedText = typeof part.text === "string" ? part.text : "";
      return {
        ...part,
        type: partType,
        text: normalizedText,
        ...(normalizedText
          ? {
              content: typeof part.content === "string" ? part.content : normalizedText,
              textContent:
                typeof part.textContent === "string" ? part.textContent : normalizedText,
              contentText:
                typeof part.contentText === "string" ? part.contentText : normalizedText,
            }
          : {}),
        finalizedAt: part.finalizedAt ?? undefined,
      };
    }),
  };
}

export function createEmptyTaskMessageSnapshotState(args: {
  taskId: string;
  sessionId?: string;
  includeLineage?: boolean;
}): TaskMessageSnapshotState {
  const resolvedSessionId = resolveTaskSnapshotRuntimeSessionId(args.taskId, args.sessionId);

  return {
    sourceMessages: [],
    resolvedSessionId,
    trace: {
      taskId: args.taskId,
      sessionId: resolvedSessionId ?? null,
      segments: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        readSource: "task-domain-projection",
        includeLineage: args.includeLineage,
        itemCount: 0,
        complete: true,
        reconcileRequired: false,
        snapshotVersion: 0,
        persistedThroughRevision: 0,
      },
      hookExecutions: [],
      followupExecutions: [],
    } satisfies TaskExecutionTrace,
  };
}

export function createTaskMessageSnapshotState(args: {
  taskId: string;
  requestedSessionId?: string;
  response: TaskRoundMessagesDto;
  includeLineage?: boolean;
}): TaskMessageSnapshotState {
  const resolvedSessionId =
    resolveTaskSnapshotRuntimeSessionId(args.taskId, args.requestedSessionId) ??
    resolveTaskSnapshotRuntimeSessionId(args.taskId, args.response.round.sessionId) ??
    resolveTaskSnapshotRuntimeSessionId(args.taskId, args.response.round.id);

  return {
    sourceMessages: Array.isArray(args.response.messages)
      ? args.response.messages.map((message) => toTaskSnapshotMessageRecord(message))
      : [],
    resolvedSessionId,
    trace: {
      taskId: args.taskId,
      sessionId: resolvedSessionId ?? null,
      segments: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        readSource: "task-domain-projection",
        includeLineage: args.includeLineage,
        itemCount: args.response.messages.length,
        complete: !args.response.reconcileRequired,
        roundId: args.response.round.id,
        snapshotVersion: args.response.snapshotVersion,
        persistedThroughRevision: args.response.persistedThroughRevision,
        reconcileRequired: Boolean(args.response.reconcileRequired),
      },
      hookExecutions: [],
      followupExecutions: [],
    } satisfies TaskExecutionTrace,
  };
}

export function createTaskConversationMessageSnapshotState(args: {
  taskId: string;
  requestedSessionId?: string;
  response: TaskConversationMessagesResponse;
  includeLineage?: boolean;
}): TaskMessageSnapshotState {
  const sourceMessages = Array.isArray(args.response.data) ? args.response.data : [];
  const meta = args.response.meta;
  const snapshotVersion =
    typeof meta?.snapshotVersion === "number"
      ? meta.snapshotVersion
      : typeof meta?.messageCount === "number"
        ? meta.messageCount
        : sourceMessages.length;
  const persistedThroughRevision =
    typeof meta?.persistedThroughRevision === "number"
      ? meta.persistedThroughRevision
      : snapshotVersion;
  const reconcileRequired = Boolean(meta?.reconcileRequired);

  return {
    sourceMessages,
    resolvedSessionId: meta?.sessionId ?? args.requestedSessionId,
    trace: {
      taskId: args.taskId,
      sessionId: meta?.sessionId ?? args.requestedSessionId ?? null,
      segments: [],
      messages: [],
      timeline: [],
      timelineMeta: {
        readSource: meta?.readSource ?? "task-domain-projection",
        cacheState: meta?.cacheState,
        complete: typeof meta?.complete === "boolean" ? meta.complete : !reconcileRequired,
        includeLineage: args.includeLineage,
        lineagePath: meta?.lineagePath,
        cachedSessionCount: meta?.cachedSessionCount,
        itemCount:
          typeof meta?.itemCount === "number"
            ? meta.itemCount
            : typeof meta?.messageCount === "number"
              ? meta.messageCount
              : sourceMessages.length,
        snapshotVersion,
        persistedThroughRevision,
        reconcileRequired,
      },
      hookExecutions: [],
      followupExecutions: [],
    } satisfies TaskExecutionTrace,
  };
}

export function getTaskMessageSnapshotRevision(trace?: TaskExecutionTrace | null) {
  return trace?.timelineMeta?.persistedThroughRevision ?? trace?.timelineMeta?.snapshotVersion ?? 0;
}