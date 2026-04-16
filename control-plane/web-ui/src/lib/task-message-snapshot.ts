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

  const legacyType = typeof part.partType === "string" ? part.partType.trim() : "";
  if (legacyType) {
    if (legacyType === "toolCall") {
      return "tool";
    }

    if (legacyType === "toolResult") {
      return "tool-result";
    }

    return legacyType;
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

function extractTaskSnapshotThinkingText(message: TaskRoundMessageDto) {
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    return undefined;
  }

  const text = message.parts
    .filter((part) => {
      const partType = resolveTaskSnapshotPartType(part);
      return partType === "thinking" || partType === "reasoning";
    })
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n")
    .trim();

  return text || undefined;
}

function hasTaskSnapshotToolParts(message: TaskRoundMessageDto) {
  return Array.isArray(message.parts)
    ? message.parts.some((part) => {
        const partType = resolveTaskSnapshotPartType(part);
        return partType === "tool" || partType === "tool-result";
      })
    : false;
}

function normalizeTaskSnapshotComparableText(text?: string | null) {
  return typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
}

function collapseTaskSnapshotDuplicateAssistantFailures(messages: TaskRoundMessageDto[]) {
  return messages.filter((message, index) => {
    if (message.role !== "assistant") {
      return true;
    }

    const hasError =
      message.status === "failed" ||
      (typeof message.errorText === "string" && message.errorText.trim().length > 0);
    if (!hasError) {
      return true;
    }

    const normalizedText = normalizeTaskSnapshotComparableText(
      extractTaskSnapshotVisibleText(message) ?? message.text,
    );
    if (!normalizedText) {
      return true;
    }

    return !messages.slice(index + 1).some((candidate) => {
      if (candidate.role !== "assistant" || candidate.status !== "completed") {
        return false;
      }

      if (candidate.roundId !== message.roundId || candidate.sessionId !== message.sessionId) {
        return false;
      }

      return (
        normalizeTaskSnapshotComparableText(
          extractTaskSnapshotVisibleText(candidate) ?? candidate.text,
        ) === normalizedText
      );
    });
  });
}

function collapseTaskSnapshotSupersededAssistantProgress(messages: TaskRoundMessageDto[]) {
  return messages.filter((message, index) => {
    if (message.role !== "assistant") {
      return true;
    }

    if (message.status === "completed") {
      return true;
    }

    if (hasTaskSnapshotToolParts(message)) {
      return true;
    }

    const visibleText = normalizeTaskSnapshotComparableText(
      extractTaskSnapshotVisibleText(message) ?? message.text,
    );
    if (visibleText) {
      return true;
    }

    const thinkingText = normalizeTaskSnapshotComparableText(
      extractTaskSnapshotThinkingText(message),
    );

    return !messages.slice(index + 1).some((candidate) => {
      if (candidate.role !== "assistant" || candidate.status !== "completed") {
        return false;
      }

      if (candidate.roundId !== message.roundId || candidate.sessionId !== message.sessionId) {
        return false;
      }

      if (hasTaskSnapshotToolParts(candidate)) {
        return false;
      }

      const candidateVisibleText = normalizeTaskSnapshotComparableText(
        extractTaskSnapshotVisibleText(candidate) ?? candidate.text,
      );
      if (!candidateVisibleText) {
        return false;
      }

      if (!thinkingText) {
        return true;
      }

      const candidateThinkingText = normalizeTaskSnapshotComparableText(
        extractTaskSnapshotThinkingText(candidate),
      );
      return Boolean(candidateThinkingText) && candidateThinkingText.includes(thinkingText);
    });
  });
}

function collapseTaskSnapshotDuplicateAssistantMessages(messages: TaskRoundMessageDto[]) {
  return collapseTaskSnapshotSupersededAssistantProgress(
    collapseTaskSnapshotDuplicateAssistantFailures(messages),
  );
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
  const sourceRoundMessages = Array.isArray(args.response.messages)
    ? collapseTaskSnapshotDuplicateAssistantMessages(args.response.messages)
    : [];
  const resolvedSessionId =
    resolveTaskSnapshotRuntimeSessionId(args.taskId, args.requestedSessionId) ??
    resolveTaskSnapshotRuntimeSessionId(args.taskId, args.response.round.sessionId) ??
    resolveTaskSnapshotRuntimeSessionId(args.taskId, args.response.round.id);

  return {
    sourceMessages: sourceRoundMessages.map((message) => toTaskSnapshotMessageRecord(message)),
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
        itemCount: sourceRoundMessages.length,
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