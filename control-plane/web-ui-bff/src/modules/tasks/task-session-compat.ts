import { getSessionMessages, listSessions } from "../agent-control/opencode-adapter";
import { cpFetch } from "../../lib/control-plane-client";

// Shared BFF helpers for task-session lineage, timeline, and cached message reads.
// These helpers bridge the session-first control-plane routes while keeping
// runtime session ids available for callers that still correlate with runtime data.

export interface TaskSessionLineageRecord {
  id?: string;
  taskId?: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName?: string | null;
  sourceType: string;
  isActive: boolean;
  coordinationKey?: string | null;
  winnerSessionId?: string | null;
  executionStatus?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  executionModeSnapshot?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

export interface UpsertTaskSessionLineageInput {
  runtimeSessionId: string;
  parentRuntimeSessionId?: string;
  forkedFromMessageId?: string;
  branchName?: string;
  sourceType?: "root" | "fork" | "sub_session";
  sessionKind?:
    | "primary"
    | "candidate"
    | "judge"
    | "sequential_step"
    | "resume"
    | "manual_branch"
    | "hook";
  executionModeSnapshot?: "single" | "parallel" | "sequential_chain";
  isActive: boolean;
  candidateIndex?: number;
  stepIndex?: number;
  selectedModel?: string;
  coordinationKey?: string;
  operationId?: string;
}

export interface TaskSessionTimelineItem {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
  sourceEventTypes?: string[];
}

export type TaskSessionTimelineReadSource =
  | "conversation-table"
  | "task-domain-events"
  | "conversation-table+task-domain-events"
  | "opencode-runtime"
  | "task-domain-projection"
  | "task-session-projection"
  | "task-session-first";

export interface TaskSessionTimelineMeta {
  readSource?: TaskSessionTimelineReadSource;
  cacheState?: "none" | "partial" | "complete";
  complete?: boolean;
  includeLineage?: boolean;
  lineagePath?: string[];
  cachedSessionCount?: number;
  itemCount?: number;
}

export interface TaskSessionTimelineResponse {
  data: TaskSessionTimelineItem[];
  meta?: TaskSessionTimelineMeta;
}

export interface TaskSessionCachedMessagesResponse {
  data?: unknown[];
  meta?: TaskSessionTimelineMeta;
}

interface ServiceTaskSessionMessagePart {
  id: string;
  partType?: string | null;
  textContent?: string | null;
  jsonPayload?: Record<string, unknown> | null;
  createdAt?: string;
}

interface ServiceTaskSessionMessageRecord {
  id: string;
  sessionId?: string | null;
  runtimeMessageId?: string | null;
  role?: string | null;
  status?: string | null;
  clientMessageId?: string | null;
  providerMessageId?: string | null;
  textContent?: string | null;
  rawPayload?: Record<string, unknown> | null;
  tokenUsed?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorText?: string | null;
  createdAt?: string;
  parts?: ServiceTaskSessionMessagePart[];
}

interface RuntimeWorkflowSessionRecord {
  sessionId: string;
  title?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface WorkflowGroupStepRecord {
  agentName: string;
  sessionId: string;
  messages: Record<string, unknown>[];
  createdAt?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asIsoTimestamp(value: unknown): string | undefined {
  const text = asString(value);
  if (text) {
    return text;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return undefined;
}

function mapServiceMessagePart(part: ServiceTaskSessionMessagePart, index: number) {
  const payload = asRecord(part.jsonPayload) ?? {};
  const partType = asString(payload.type) ?? asString(part.partType) ?? "text";
  const text =
    asString(payload.text) ?? asString(payload.content) ?? asString(part.textContent) ?? undefined;

  return {
    ...payload,
    id: asString(payload.id) ?? part.id ?? `${partType}-${index}`,
    type: partType,
    ...(text ? { text } : {}),
    ...(partType === "text" && text && !asString(payload.content) ? { content: text } : {}),
  } satisfies Record<string, unknown>;
}

function buildLegacySessionMessageParts(message: ServiceTaskSessionMessageRecord) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  if (parts.length > 0) {
    return parts.map((part, index) => mapServiceMessagePart(part, index));
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  if (rawParts.length > 0) {
    return rawParts;
  }

  const text = asString(message.textContent);
  return text ? [{ type: "text", text, content: text }] : [];
}

function buildLegacySessionMessage(message: ServiceTaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload) ?? {};
  const rawInfo = asRecord(rawPayload.info) ?? {};
  const rawTime = asRecord(rawInfo.time) ?? {};
  const id = asString(rawInfo.id) ?? asString(message.runtimeMessageId) ?? message.id;
  const role = asString(rawInfo.role) ?? asString(message.role) ?? "assistant";
  const text = asString(message.textContent) ?? asString(rawPayload.text);
  const createdAt = asString(message.createdAt) ?? asString(rawTime.created);
  const completedAt = asString(message.completedAt) ?? asString(rawTime.completed);
  const parts = buildLegacySessionMessageParts(message);

  return {
    ...rawPayload,
    id: asString(rawPayload.id) ?? id,
    role,
    ...(text ? { text } : {}),
    ...(createdAt ? { createdAt } : {}),
    info: {
      ...rawInfo,
      id,
      role,
      ...(text && !asString(rawInfo.preview) ? { preview: text } : {}),
      ...(message.status ? { status: message.status } : {}),
      ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
      ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
      ...(message.errorText && rawInfo.error === undefined ? { error: message.errorText } : {}),
      time: {
        ...rawTime,
        ...(createdAt ? { created: createdAt } : {}),
        ...(completedAt ? { completed: completedAt } : {}),
      },
    },
    parts,
  } satisfies Record<string, unknown>;
}

function buildTaskSessionLineageRecordLookup(records: TaskSessionLineageRecord[]) {
  const bySessionId = new Map<string, TaskSessionLineageRecord>();

  const addAliasFromCanonicalTaskSessionId = (
    canonicalId: string,
    record: TaskSessionLineageRecord,
  ) => {
    if (!canonicalId.startsWith("task-session:")) {
      return;
    }

    // Canonical id format: task-session:<taskId>:<runtimeSessionId>
    const segments = canonicalId.split(":");
    if (segments.length < 3) {
      return;
    }

    const runtimeSessionId = segments.slice(2).join(":").trim();
    if (runtimeSessionId) {
      bySessionId.set(runtimeSessionId, record);
    }
  };

  for (const record of records) {
    const recordId = asString(record.id);
    if (recordId) {
      bySessionId.set(recordId, record);
      addAliasFromCanonicalTaskSessionId(recordId, record);
    }

    const runtimeSessionId = asString(record.runtimeSessionId);
    if (runtimeSessionId) {
      bySessionId.set(runtimeSessionId, record);
    }
  }

  return bySessionId;
}

function isRootPrimaryTaskSessionRecord(record: TaskSessionLineageRecord | undefined) {
  return record?.sessionKind === "primary" && !asString(record.parentRuntimeSessionId);
}

function shouldPreserveWorkflowExecutionContextMessage(
  sourceSessionId: string,
  recordLookup: Map<string, TaskSessionLineageRecord>,
) {
  return isRootPrimaryTaskSessionRecord(recordLookup.get(sourceSessionId));
}

function extractWorkflowContextDisplayText(text: string | undefined) {
  const normalized = typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
  if (!normalized) {
    return undefined;
  }

  const withoutPrefix = normalized.replace(/^Execution context:\s*/u, "").trim();
  if (!withoutPrefix) {
    return undefined;
  }

  const cutMarkers = [
    "\n请只完成当前阶段的目标。",
    "\n完成后请输出本阶段产出摘要。",
    "\n如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "\n如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
    "\n/start-work ",
  ];

  let cutIndex = withoutPrefix.length;
  for (const marker of cutMarkers) {
    const markerIndex = withoutPrefix.indexOf(marker);
    if (markerIndex >= 0) {
      cutIndex = Math.min(cutIndex, markerIndex);
    }
  }

  const cleaned = withoutPrefix.slice(0, cutIndex).trim();
  return cleaned.length > 0 ? cleaned : withoutPrefix;
}

function extractWorkflowContextStageLabel(text: string | undefined) {
  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }

  const stageMatch = /当前阶段：([^\n]+)/u.exec(text);
  const stageLabel = stageMatch?.[1]?.trim();
  return stageLabel && stageLabel.length > 0 ? stageLabel : undefined;
}

function buildWorkflowContextLegacyMessage(message: ServiceTaskSessionMessageRecord) {
  const legacyMessage = buildLegacySessionMessage(message);
  const displayText = extractWorkflowContextDisplayText(
    extractServiceTaskSessionMessageText(message) ?? asString(legacyMessage.text),
  );
  if (!displayText) {
    return null;
  }

  const info = asRecord(legacyMessage.info) ?? {};
  const createdAt =
    asString(legacyMessage.createdAt) ??
    asString(asRecord(info.time)?.created) ??
    asString(asRecord(info.time)?.completed);
  const textPartId = `${asString(legacyMessage.id) ?? message.id}:workflow-context`;

  return {
    ...legacyMessage,
    role: "workflow",
    text: displayText,
    textContent: displayText,
    summaryText: displayText,
    parts: [
      {
        id: textPartId,
        type: "text",
        text: displayText,
        content: displayText,
      },
    ],
    ...(createdAt ? { createdAt } : {}),
    info: {
      ...info,
      role: "workflow",
      preview: displayText,
      time: {
        ...(asRecord(info.time) ?? {}),
        ...(createdAt ? { created: createdAt } : {}),
      },
    },
  } satisfies Record<string, unknown>;
}

function extractRuntimeMessageInfo(message: unknown) {
  return asRecord(asRecord(message)?.info);
}

function extractRuntimeMessageRole(message: unknown) {
  return asString(extractRuntimeMessageInfo(message)?.role) ?? asString(asRecord(message)?.role);
}

function extractRuntimeMessageFinish(message: unknown) {
  return asString(extractRuntimeMessageInfo(message)?.finish);
}

function extractRuntimeMessageCreatedAt(message: unknown) {
  const record = asRecord(message);
  const info = extractRuntimeMessageInfo(message);
  const time = asRecord(info?.time);
  return (
    asIsoTimestamp(time?.created) ??
    asIsoTimestamp(time?.completed) ??
    asIsoTimestamp(record?.createdAt) ??
    asIsoTimestamp(record?.updatedAt)
  );
}

function extractRuntimeMessageText(message: unknown) {
  const record = asRecord(message);
  const directText =
    asString(record?.text) ??
    asString(record?.textContent) ??
    asString(record?.summaryText) ??
    asString(record?.content);
  if (directText) {
    return directText;
  }

  const parts = Array.isArray(record?.parts)
    ? record.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  const text = parts
    .map((part) => asString(part.text) ?? asString(part.content) ?? "")
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function parseRuntimeWorkflowSessionRecord(session: unknown): RuntimeWorkflowSessionRecord | null {
  const record = asRecord(session);
  const sessionId = asString(record?.id);
  if (!sessionId) {
    return null;
  }

  const time = asRecord(record?.time);
  return {
    sessionId,
    title: asString(record?.title),
    createdAt: asIsoTimestamp(time?.created),
    updatedAt: asIsoTimestamp(time?.updated),
  } satisfies RuntimeWorkflowSessionRecord;
}

function extractRuntimeWorkflowAgentName(title: string | undefined | null) {
  const normalizedTitle = asString(title);
  if (!normalizedTitle) {
    return undefined;
  }

  const agentMatch = normalizedTitle.match(/^\[(?:clarify|design)\]\s*(.+?)\s*\//u);
  return agentMatch?.[1]?.trim() || undefined;
}

function isRuntimeWorkflowSessionForTask(
  session: RuntimeWorkflowSessionRecord,
  taskTitle: string | undefined,
) {
  const title = asString(session.title);
  if (!title) {
    return false;
  }

  if (!(title.startsWith("[clarify]") || title.startsWith("[design]"))) {
    return false;
  }

  if (!taskTitle) {
    return true;
  }

  return title.endsWith(`/ ${taskTitle}`);
}

function runtimeWorkflowMessagesBelongToTask(taskId: string, messages: Record<string, unknown>[]) {
  return messages.some((message) => {
    if (extractRuntimeMessageRole(message) !== "user") {
      return false;
    }

    const text = extractRuntimeMessageText(message);
    return typeof text === "string" && text.includes(taskId);
  });
}

function compareRuntimeWorkflowSessionCandidates(
  left: {
    messages: Record<string, unknown>[];
    session: RuntimeWorkflowSessionRecord;
  },
  right: {
    messages: Record<string, unknown>[];
    session: RuntimeWorkflowSessionRecord;
  },
) {
  const summarize = (candidate: {
    messages: Record<string, unknown>[];
    session: RuntimeWorkflowSessionRecord;
  }) => {
    const hasTerminalAssistant = candidate.messages.some((message) => {
      if (extractRuntimeMessageRole(message) !== "assistant") {
        return false;
      }

      const finish = extractRuntimeMessageFinish(message);
      return typeof finish === "string" && finish !== "tool-calls";
    });
    const hasAssistantText = candidate.messages.some((message) => {
      return (
        extractRuntimeMessageRole(message) === "assistant" &&
        typeof extractRuntimeMessageText(message) === "string"
      );
    });
    const lastActivityAt =
      candidate.messages
        .map((message) => toTimestampMs(extractRuntimeMessageCreatedAt(message)))
        .filter((value): value is number => value != null)
        .sort((a, b) => b - a)[0] ??
      toTimestampMs(candidate.session.updatedAt) ??
      toTimestampMs(candidate.session.createdAt) ??
      0;

    return {
      hasTerminalAssistant,
      hasAssistantText,
      lastActivityAt,
    };
  };

  const leftSummary = summarize(left);
  const rightSummary = summarize(right);
  if (leftSummary.hasTerminalAssistant !== rightSummary.hasTerminalAssistant) {
    return leftSummary.hasTerminalAssistant ? -1 : 1;
  }

  if (leftSummary.hasAssistantText !== rightSummary.hasAssistantText) {
    return leftSummary.hasAssistantText ? -1 : 1;
  }

  if (leftSummary.lastActivityAt !== rightSummary.lastActivityAt) {
    return rightSummary.lastActivityAt - leftSummary.lastActivityAt;
  }

  return (left.session.sessionId || "").localeCompare(
    right.session.sessionId || "",
    "zh-CN",
  );
}

function compactRuntimeWorkflowSessionMessages(messages: Record<string, unknown>[]) {
  const firstUserMessage = messages.find((message) => {
    return extractRuntimeMessageRole(message) === "user";
  });
  const assistantMessages = messages.filter((message) => {
    return extractRuntimeMessageRole(message) === "assistant";
  });
  const terminalAssistantMessage = [...assistantMessages].reverse().find((message) => {
    const finish = extractRuntimeMessageFinish(message);
    return typeof finish === "string" && finish !== "tool-calls";
  });
  const lastAssistantWithText = [...assistantMessages].reverse().find((message) => {
    return typeof extractRuntimeMessageText(message) === "string";
  });
  const selectedMessages = [
    firstUserMessage,
    terminalAssistantMessage ?? lastAssistantWithText,
  ].filter((message): message is Record<string, unknown> => Boolean(message));

  if (selectedMessages.length === 0) {
    return messages;
  }

  return Array.from(new Set(selectedMessages));
}

async function fetchRuntimeWorkflowGroupSteps(
  taskId: string,
  authorization: string,
) {
  const taskResult = await cpFetch<{ title?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  const taskTitle = asString(taskResult.data?.title);

  const runtimeResult = await listSessions(100);
  const runtimeSessions = Array.isArray(runtimeResult.data)
    ? runtimeResult.data
        .map((session) => parseRuntimeWorkflowSessionRecord(session))
        .filter((session): session is RuntimeWorkflowSessionRecord => Boolean(session))
        .filter((session) => isRuntimeWorkflowSessionForTask(session, taskTitle))
    : [];
  if (runtimeSessions.length === 0) {
    return [] as WorkflowGroupStepRecord[];
  }

  const resolvedCandidates = await Promise.all(
    runtimeSessions.map(async (session) => {
      const result = await getSessionMessages(session.sessionId, {
        includeLineage: false,
        bypassCircuitBreaker: true,
      });
      const messages = Array.isArray(result.data)
        ? result.data
            .map((message) => asRecord(message))
            .filter((message): message is Record<string, unknown> => Boolean(message))
        : [];
      if (messages.length === 0 || !runtimeWorkflowMessagesBelongToTask(taskId, messages)) {
        return null;
      }

      return {
        agentName:
          extractRuntimeWorkflowAgentName(session.title) ??
          asString(session.title) ??
          session.sessionId,
        session,
        messages,
      };
    }),
  );

  const chosenCandidates = new Map<
    string,
    {
      agentName: string;
      session: RuntimeWorkflowSessionRecord;
      messages: Record<string, unknown>[];
    }
  >();

  for (const candidate of resolvedCandidates) {
    if (!candidate) {
      continue;
    }

    const existing = chosenCandidates.get(candidate.agentName);
    if (!existing) {
      chosenCandidates.set(candidate.agentName, candidate);
      continue;
    }

    if (compareRuntimeWorkflowSessionCandidates(candidate, existing) < 0) {
      chosenCandidates.set(candidate.agentName, candidate);
    }
  }

  return Array.from(chosenCandidates.values())
    .map((candidate) => ({
      agentName: candidate.agentName,
      sessionId: candidate.session.sessionId,
      messages: compactRuntimeWorkflowSessionMessages(candidate.messages),
      createdAt:
        candidate.messages
          .map((message) => extractRuntimeMessageCreatedAt(message))
          .find((value): value is string => Boolean(value)) ??
        candidate.session.createdAt ??
        candidate.session.updatedAt,
    }))
    .sort((left, right) => {
      return (toTimestampMs(left.createdAt) ?? 0) - (toTimestampMs(right.createdAt) ?? 0);
    });
}

async function synthesizeWorkflowGroupMessages(
  taskId: string,
  authorization: string,
  messages: ServiceTaskSessionMessageRecord[],
  records: TaskSessionLineageRecord[],
) {
  const recordLookup = buildTaskSessionLineageRecordLookup(records);
  const workflowMessagesBySession = new Map<string, ServiceTaskSessionMessageRecord[]>();

  for (const message of messages) {
    if (!isExecutionContextUserMessage(message)) {
      continue;
    }

    const sourceSessionId = extractServiceTaskSessionMessageSourceSessionId(message);
    if (
      !sourceSessionId ||
      !shouldPreserveWorkflowExecutionContextMessage(sourceSessionId, recordLookup)
    ) {
      continue;
    }

    const existing = workflowMessagesBySession.get(sourceSessionId) ?? [];
    existing.push(message);
    workflowMessagesBySession.set(sourceSessionId, existing);
  }

  const workflowMessageSet = new Set<ServiceTaskSessionMessageRecord>();
  const workflowSteps: WorkflowGroupStepRecord[] = Array.from(
    workflowMessagesBySession.entries(),
  ).flatMap(([sourceSessionId, sessionMessages]) => {
      for (const message of sessionMessages) {
        workflowMessageSet.add(message);
      }

      const legacyMessages: Record<string, unknown>[] = sessionMessages.flatMap((message) => {
        const legacyMessage = buildWorkflowContextLegacyMessage(message);
        return legacyMessage ? [legacyMessage as Record<string, unknown>] : [];
      });
      if (legacyMessages.length === 0) {
        return [];
      }

      const firstSessionMessage = sessionMessages[0];
      if (!firstSessionMessage) {
        return [];
      }

      const stageLabel = extractWorkflowContextStageLabel(
        extractServiceTaskSessionMessageText(firstSessionMessage),
      );

      return [
        {
          agentName: stageLabel ?? "当前工作流",
          sessionId: sourceSessionId,
          messages: legacyMessages,
          createdAt:
            sessionMessages
              .map((message) => asString(message.createdAt))
              .find((value): value is string => Boolean(value)) ?? null,
        } satisfies WorkflowGroupStepRecord,
      ];
    });

  const runtimeWorkflowSteps = await fetchRuntimeWorkflowGroupSteps(taskId, authorization);
  if (runtimeWorkflowSteps.length > 0) {
    workflowSteps.push(...runtimeWorkflowSteps);
  }

  const regularMessages = mapServiceTaskSessionMessages(
    messages.filter((message) => !workflowMessageSet.has(message)),
  );
  if (workflowSteps.length === 0) {
    return regularMessages;
  }

  workflowSteps.sort((left, right) => {
    return (toTimestampMs(left.createdAt) ?? 0) - (toTimestampMs(right.createdAt) ?? 0);
  });

  const workflowGroup = {
    _type: "workflow_group",
    info: {
      id: `workflow-group-${taskId}`,
      role: "workflow",
      variant: "context",
      label: "工作流消息",
      hint: "当前阶段与执行上下文",
    },
    steps: workflowSteps,
  } satisfies Record<string, unknown>;

  const insertionIndex = regularMessages.findIndex((message) => {
    const record = asRecord(message);
    const info = asRecord(record?.info);
    const role = asString(info?.role) ?? asString(record?.role);
    return role != null && role !== "user";
  });

  if (insertionIndex < 0) {
    return [...regularMessages, workflowGroup];
  }

  return [
    ...regularMessages.slice(0, insertionIndex),
    workflowGroup,
    ...regularMessages.slice(insertionIndex),
  ];
}

function mapServiceTaskSessionMessages(messages: ServiceTaskSessionMessageRecord[]) {
  return messages.map((message) => buildLegacySessionMessage(message));
}

type PendingParallelMessageSuppressionGroup = {
  createdAtMs: number | null;
  suppressedSessionIds: Set<string>;
  /** Anchor/resume session IDs whose non-prompt messages should be suppressed. */
  anchorSessionIds: Set<string>;
};

type AdoptedParallelMessageSuppressionGroup = {
  suppressedSessionIds: Set<string>;
  winnerSessionIds: Set<string>;
  /** Anchor/resume session IDs whose non-prompt messages should be suppressed. */
  anchorSessionIds: Set<string>;
};

function toTimestampMs(value?: string | null) {
  const rawValue = asString(value);
  if (!rawValue) {
    return null;
  }

  const parsed = Date.parse(rawValue);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractServiceTaskSessionMessageSourceSessionId(message: ServiceTaskSessionMessageRecord) {
  const topLevelSessionId = asString(message.sessionId);
  if (topLevelSessionId) {
    return topLevelSessionId;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return (
    asString(rawInfo?.sessionID) ??
    asString(rawInfo?.sessionId) ??
    asString(rawPayload?.sessionID) ??
    asString(rawPayload?.sessionId)
  );
}

function extractServiceTaskSessionMessageRole(message: ServiceTaskSessionMessageRecord) {
  const topLevelRole = asString(message.role);
  if (topLevelRole) {
    return topLevelRole;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return asString(rawInfo?.role);
}

function extractServiceTaskSessionMessageText(message: ServiceTaskSessionMessageRecord) {
  const topLevelText = asString(message.textContent);
  if (topLevelText) {
    return topLevelText;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawText =
    asString(rawPayload?.textContent) ??
    asString(rawPayload?.text) ??
    asString(rawPayload?.summaryText) ??
    asString(rawPayload?.content);
  if (rawText) {
    return rawText;
  }

  const rawParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  const text = rawParts
    .map((part) => asString(part.text) ?? asString(part.content) ?? "")
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function isExecutionContextUserMessage(message: ServiceTaskSessionMessageRecord) {
  if (extractServiceTaskSessionMessageRole(message) !== "user") {
    return false;
  }

  const text = extractServiceTaskSessionMessageText(message);
  return typeof text === "string" && text.startsWith("Execution context:");
}

function isPendingParallelCandidateSession(record: TaskSessionLineageRecord) {
  return (
    typeof record.candidateIndex === "number" ||
    record.sessionKind === "candidate" ||
    record.sessionKind === "manual_branch" ||
    record.sessionKind === "judge"
  );
}

function isParallelAnchorSession(record: TaskSessionLineageRecord) {
  return !isPendingParallelCandidateSession(record) && record.sessionKind !== "primary";
}

function addTaskSessionLineageRecordIds(idSet: Set<string>, record: TaskSessionLineageRecord) {
  const recordId = asString(record.id);
  if (recordId) {
    idSet.add(recordId);
  }

  const runtimeSessionId = asString(record.runtimeSessionId);
  if (runtimeSessionId) {
    idSet.add(runtimeSessionId);
  }
}

function resolveLatestPendingParallelMessageSuppressionGroup(
  records: TaskSessionLineageRecord[],
): PendingParallelMessageSuppressionGroup | null {
  const groups = new Map<string, TaskSessionLineageRecord[]>();

  for (const record of records) {
    const coordinationKey = asString(record.coordinationKey);
    if (!coordinationKey) {
      continue;
    }

    const existing = groups.get(coordinationKey) ?? [];
    existing.push(record);
    groups.set(coordinationKey, existing);
  }

  let selectedGroup: PendingParallelMessageSuppressionGroup | null = null;

  for (const group of groups.values()) {
    if (group.some((record) => asString(record.winnerSessionId))) {
      continue;
    }

    const candidateRecords = group.filter(isPendingParallelCandidateSession);
    if (candidateRecords.length < 2) {
      continue;
    }

    const createdAtValues = candidateRecords
      .map((record) => toTimestampMs(record.createdAt))
      .filter((value): value is number => value != null);
    const createdAtMs = createdAtValues.length > 0 ? Math.min(...createdAtValues) : null;
    const selectedCreatedAtMs = selectedGroup?.createdAtMs ?? Number.NEGATIVE_INFINITY;
    const candidateCreatedAtMs = createdAtMs ?? Number.NEGATIVE_INFINITY;
    if (selectedGroup && candidateCreatedAtMs < selectedCreatedAtMs) {
      continue;
    }

    const suppressedSessionIds = new Set<string>();
    for (const record of candidateRecords) {
      if (asString(record.id)) {
        suppressedSessionIds.add(record.id as string);
      }
      if (asString(record.runtimeSessionId)) {
        suppressedSessionIds.add(record.runtimeSessionId);
      }
    }

    if (suppressedSessionIds.size < 2) {
      continue;
    }

    const anchorSessionIds = new Set<string>();
    for (const record of group) {
      if (!isParallelAnchorSession(record)) {
        continue;
      }
      addTaskSessionLineageRecordIds(anchorSessionIds, record);
    }

    selectedGroup = {
      createdAtMs,
      suppressedSessionIds,
      anchorSessionIds,
    };
  }

  return selectedGroup;
}

function resolveAdoptedParallelMessageSuppressionGroups(
  records: TaskSessionLineageRecord[],
): AdoptedParallelMessageSuppressionGroup[] {
  const groups = new Map<string, TaskSessionLineageRecord[]>();

  for (const record of records) {
    const coordinationKey = asString(record.coordinationKey);
    if (!coordinationKey) {
      continue;
    }

    const existing = groups.get(coordinationKey) ?? [];
    existing.push(record);
    groups.set(coordinationKey, existing);
  }

  const suppressionGroups: AdoptedParallelMessageSuppressionGroup[] = [];

  for (const group of groups.values()) {
    const candidateRecords = group.filter(isPendingParallelCandidateSession);
    if (candidateRecords.length < 2) {
      continue;
    }

    const rawWinnerIds = Array.from(
      new Set(
        candidateRecords
          .map((record) => asString(record.winnerSessionId))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (rawWinnerIds.length === 0) {
      continue;
    }

    const winnerSessionIds = new Set<string>();
    const winnerRecords = group.filter((record) => {
      const recordId = asString(record.id);
      const runtimeSessionId = asString(record.runtimeSessionId);
      return rawWinnerIds.some(
        (winnerId) => winnerId === recordId || winnerId === runtimeSessionId,
      );
    });
    if (winnerRecords.length > 0) {
      for (const record of winnerRecords) {
        addTaskSessionLineageRecordIds(winnerSessionIds, record);
      }
    } else {
      for (const winnerId of rawWinnerIds) {
        winnerSessionIds.add(winnerId);
      }
    }

    const suppressedSessionIds = new Set<string>();
    for (const record of candidateRecords) {
      const recordId = asString(record.id);
      const runtimeSessionId = asString(record.runtimeSessionId);
      const isWinner =
        (recordId != null && isSessionIdInSuppressionSet(recordId, winnerSessionIds)) ||
        (runtimeSessionId != null && isSessionIdInSuppressionSet(runtimeSessionId, winnerSessionIds));
      if (isWinner) {
        continue;
      }
      addTaskSessionLineageRecordIds(suppressedSessionIds, record);
    }

    const anchorSessionIds = new Set<string>();
    for (const record of group) {
      if (!isParallelAnchorSession(record)) {
        continue;
      }
      addTaskSessionLineageRecordIds(anchorSessionIds, record);
    }

    suppressionGroups.push({
      suppressedSessionIds,
      winnerSessionIds,
      anchorSessionIds,
    });
  }

  return suppressionGroups;
}

/**
 * Returns the set of runtime session IDs whose messages should be suppressed
 * because they belong to a pending (unadopted) parallel candidate group.
 * Used by the runtime fallback path to filter messages at the session level.
 */
export function resolvePendingParallelSuppressedSessionIds(
  records: TaskSessionLineageRecord[],
): Set<string> | null {
  const group = resolveLatestPendingParallelMessageSuppressionGroup(records);
  return group?.suppressedSessionIds ?? null;
}

function isSessionIdInSuppressionSet(sessionId: string, idSet: Set<string>): boolean {
  if (idSet.has(sessionId)) return true;
  // Messages use canonical form "task-session:taskId:sesId" while
  // the suppression set may store the short form "sesId" (or vice versa).
  if (sessionId.startsWith("task-session:")) {
    const lastColon = sessionId.lastIndexOf(":");
    if (lastColon > 0) {
      return idSet.has(sessionId.slice(lastColon + 1));
    }
  }
  return false;
}

function filterLatestPendingParallelTaskConversationMessages(
  messages: ServiceTaskSessionMessageRecord[],
  records: TaskSessionLineageRecord[],
) {
  if (messages.length === 0 || records.length === 0) {
    return messages;
  }

  const suppressionGroup = resolveLatestPendingParallelMessageSuppressionGroup(records);
  const adoptedSuppressionGroups = resolveAdoptedParallelMessageSuppressionGroups(records);
  const recordLookup = buildTaskSessionLineageRecordLookup(records);
  const nonExecutionUserMessageCountBySession = new Map<string, number>();
  for (const message of messages) {
    const sourceSessionId = extractServiceTaskSessionMessageSourceSessionId(message);
    if (!sourceSessionId || extractServiceTaskSessionMessageRole(message) !== "user") {
      continue;
    }
    if (isExecutionContextUserMessage(message)) {
      continue;
    }
    nonExecutionUserMessageCountBySession.set(
      sourceSessionId,
      (nonExecutionUserMessageCountBySession.get(sourceSessionId) ?? 0) + 1,
    );
  }

  if (!suppressionGroup && adoptedSuppressionGroups.length === 0) {
    return messages.filter((message) => {
      const sourceSessionId = extractServiceTaskSessionMessageSourceSessionId(message);
      if (!sourceSessionId || !isExecutionContextUserMessage(message)) {
        return true;
      }

      if (shouldPreserveWorkflowExecutionContextMessage(sourceSessionId, recordLookup)) {
        return true;
      }

      return (nonExecutionUserMessageCountBySession.get(sourceSessionId) ?? 0) === 0;
    });
  }

  // Suppress ALL messages whose source session belongs to the pending parallel
  // candidate group.  These messages are displayed inside the parallel comparison
  // card instead of the inline conversation flow.
  //
  // For anchor/resume sessions of the pending group, keep the first user message
  // (the prompt) but suppress subsequent messages (e.g. "Execution context:")
  // that would otherwise duplicate inline.
  const seenFirstUserPerAnchor = new Set<string>();
  return messages.filter((message) => {
    const sourceSessionId = extractServiceTaskSessionMessageSourceSessionId(message);
    if (!sourceSessionId) return true;
    const role = extractServiceTaskSessionMessageRole(message);

    for (const adoptedGroup of adoptedSuppressionGroups) {
      if (isSessionIdInSuppressionSet(sourceSessionId, adoptedGroup.suppressedSessionIds)) {
        return false;
      }
      if (isSessionIdInSuppressionSet(sourceSessionId, adoptedGroup.anchorSessionIds)) {
        if (role === "user" && !seenFirstUserPerAnchor.has(sourceSessionId)) {
          seenFirstUserPerAnchor.add(sourceSessionId);
          return true;
        }
        return false;
      }
      if (isSessionIdInSuppressionSet(sourceSessionId, adoptedGroup.winnerSessionIds)) {
        if (role === "user") {
          return false;
        }
        break;
      }
    }

    if (
      suppressionGroup &&
      isSessionIdInSuppressionSet(sourceSessionId, suppressionGroup.suppressedSessionIds)
    ) {
      return false;
    }
    if (
      suppressionGroup &&
      isSessionIdInSuppressionSet(sourceSessionId, suppressionGroup.anchorSessionIds)
    ) {
      if (role === "user" && !seenFirstUserPerAnchor.has(sourceSessionId)) {
        seenFirstUserPerAnchor.add(sourceSessionId);
        return true;
      }
      return false;
    }

    if (
      role === "user" &&
      isExecutionContextUserMessage(message) &&
      (nonExecutionUserMessageCountBySession.get(sourceSessionId) ?? 0) > 0 &&
      !shouldPreserveWorkflowExecutionContextMessage(sourceSessionId, recordLookup)
    ) {
      return false;
    }

    return true;
  });
}

function extractLegacySessionMessageId(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  return asString(info?.id) ?? asString(record?.id);
}

function dedupeLegacySessionMessages(messages: unknown[]) {
  const seen = new Set<string>();
  let anonymousIndex = 0;

  return messages.filter((message) => {
    const messageId = extractLegacySessionMessageId(message) ?? `anonymous-${anonymousIndex++}`;
    if (seen.has(messageId)) {
      return false;
    }
    seen.add(messageId);
    return true;
  });
}

function sliceLegacyMessagesForLineageBoundary(
  messages: unknown[],
  childRecord: TaskSessionLineageRecord | undefined,
) {
  if (!childRecord?.forkedFromMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => extractLegacySessionMessageId(message) === childRecord.forkedFromMessageId,
  );
  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function buildTaskSessionMessageLineagePath(
  records: TaskSessionLineageRecord[],
  sessionId: string,
) {
  const byRuntimeSessionId = new Map(
    records.map((record) => [record.runtimeSessionId, record] as const),
  );
  const selected = records.find(
    (record) => record.id === sessionId || record.runtimeSessionId === sessionId,
  );
  const path: TaskSessionLineageRecord[] = [];
  const visited = new Set<string>();
  let current = selected ?? byRuntimeSessionId.get(sessionId);

  while (current && !visited.has(current.runtimeSessionId)) {
    path.unshift(current);
    visited.add(current.runtimeSessionId);
    current = current.parentRuntimeSessionId
      ? byRuntimeSessionId.get(current.parentRuntimeSessionId)
      : undefined;
  }

  return path;
}

export function normalizeTaskSessionTimelineMeta(
  meta?: TaskSessionTimelineMeta,
): TaskSessionTimelineMeta | undefined {
  if (!meta) return undefined;
  return meta;
}

function deriveTaskSessionMessageCacheState(
  meta: TaskSessionTimelineMeta | undefined,
  messageCount: number,
): NonNullable<TaskSessionTimelineMeta["cacheState"]> {
  if (meta?.cacheState === "complete" || meta?.cacheState === "partial" || meta?.cacheState === "none") {
    return meta.cacheState;
  }

  if (meta?.complete === true) {
    return messageCount > 0 ? "complete" : "none";
  }

  return messageCount > 0 ? "partial" : "none";
}

function isTaskSessionMessageCacheComplete(
  meta: TaskSessionTimelineMeta | undefined,
  messageCount: number,
) {
  if (typeof meta?.complete === "boolean") {
    return meta.complete;
  }

  return deriveTaskSessionMessageCacheState(meta, messageCount) === "complete";
}

export function toCanonicalTaskSessionId(taskId: string, sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  if (normalizedSessionId.startsWith("task-session:")) {
    return normalizedSessionId;
  }
  if (normalizedSessionId.startsWith("task_session:")) {
    return normalizedSessionId.replace(/^task_session:/, "task-session:");
  }
  return `task-session:${taskId}:${normalizedSessionId}`;
}

type ServiceTaskSessionRecord = {
  id: string;
  taskId?: string;
  parentSessionId?: string | null;
  parentRuntimeSessionId?: string | null;
  coordinationKey?: string | null;
  runtimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  branchName?: string | null;
  sessionKind?: string | null;
  executionModeSnapshot?: string | null;
  executionStatus?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  winnerSessionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
};

type ServiceTaskSessionListResponse = {
  data?: ServiceTaskSessionRecord[];
  meta?: {
    currentSessionId?: string | null;
    latestSessionId?: string | null;
  };
};

type ServiceTaskTimelineItem = {
  id: string;
  sessionId?: string | null;
  messageId?: string | null;
  operationId?: string | null;
  artifactId?: string | null;
  itemKind?: string | null;
  itemRole?: string | null;
  role?: string | null;
  title?: string | null;
  displayText?: string | null;
  text?: string | null;
  raw?: Record<string, unknown> | null;
  metadataJson?: Record<string, unknown> | null;
  sortAt?: string;
  createdAt?: string;
};

type ServiceTaskTimelineResponse = {
  data?: ServiceTaskTimelineItem[];
  meta?: TaskSessionTimelineMeta;
};

type ServiceTaskSessionMessagesResponse = {
  data?: ServiceTaskSessionMessageRecord[];
  meta?: TaskSessionTimelineMeta & {
    sessionId?: string;
    messageCount?: number;
  };
};

type TaskSessionCachedMessagesResponseData = {
  data: unknown[];
  meta:
    | (TaskSessionTimelineMeta & {
        sessionId?: string;
        messageCount?: number;
      })
    | undefined;
};

type TaskSessionCachedMessagesResult = {
  ok: boolean;
  status: number;
  data?: TaskSessionCachedMessagesResponseData;
  error?: string;
};

function mapSessionKindToSourceType(session?: {
  sessionKind?: string | null;
  parentSessionId?: string | null;
  parentRuntimeSessionId?: string | null;
}) {
  const sessionKind = session?.sessionKind;
  if (sessionKind === "manual_branch") {
    return "fork";
  }
  if (sessionKind === "candidate") {
    return "fork";
  }
  if (sessionKind === "resume") {
    return "sub_session";
  }
  if (
    sessionKind === "sequential_step" &&
    (typeof session?.parentSessionId === "string" ||
      typeof session?.parentRuntimeSessionId === "string")
  ) {
    return "fork";
  }
  return "root";
}

function mapServiceTaskSessionsToLineageRecords(
  sessions: ServiceTaskSessionRecord[],
  currentSessionId?: string | null,
) {
  const byId = new Map(sessions.map((session) => [session.id, session] as const));

  return sessions.map((session) => ({
    id: session.id,
    taskId: session.taskId,
    runtimeSessionId: session.runtimeSessionId ?? session.id,
    parentRuntimeSessionId: session.parentSessionId
      ? (byId.get(session.parentSessionId)?.runtimeSessionId ?? session.parentSessionId)
      : (session.parentRuntimeSessionId ?? null),
    forkedFromMessageId: session.forkedFromMessageId ?? null,
    branchName: session.branchName ?? null,
    sourceType: mapSessionKindToSourceType(session),
    isActive: currentSessionId
      ? session.id === currentSessionId
      : session.executionStatus === "running" && !session.archivedAt,
    coordinationKey: session.coordinationKey ?? null,
    winnerSessionId: session.winnerSessionId ?? null,
    executionStatus: session.executionStatus ?? null,
    sessionKind: session.sessionKind ?? null,
    candidateIndex: typeof session.candidateIndex === "number" ? session.candidateIndex : null,
    stepIndex: typeof session.stepIndex === "number" ? session.stepIndex : null,
    selectedModel: session.selectedModel ?? null,
    executionModeSnapshot: session.executionModeSnapshot ?? null,
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
    archivedAt: session.archivedAt ?? null,
  } satisfies TaskSessionLineageRecord));
}

function mapTimelineRole(item: ServiceTaskTimelineItem) {
  if (item.itemRole) {
    return item.itemRole;
  }
  if (item.role) {
    return item.role;
  }
  if (item.itemKind === "user-input") {
    return "user";
  }
  if (item.itemKind === "assistant-output" || item.itemKind === "thinking") {
    return "assistant";
  }
  if (item.itemKind === "tool-call" || item.itemKind === "tool-output") {
    return "tool";
  }
  return "system";
}

function mapServiceTimelineItems(items: ServiceTaskTimelineItem[]) {
  return items.map((item) => ({
    id: item.messageId || item.operationId || item.artifactId || item.id,
    role: mapTimelineRole(item),
    text: item.displayText || item.title || item.text || "",
    createdAt: item.createdAt,
    completedAt: item.sortAt ?? null,
    raw: {
      ...(item.raw ?? {}),
      projection: true,
      sessionId: item.sessionId ?? null,
      messageId: item.messageId ?? null,
      operationId: item.operationId ?? null,
      artifactId: item.artifactId ?? null,
      itemKind: item.itemKind,
      itemRole: item.itemRole ?? null,
      legacyRole: item.role ?? null,
      title: item.title ?? null,
      displayText: item.displayText ?? null,
      legacyText: item.text ?? null,
      metadata: item.metadataJson ?? null,
    },
    sourceEventTypes: [`projection:${item.itemKind ?? item.role ?? "unknown"}`],
  } satisfies TaskSessionTimelineItem));
}

async function resolvePersistedTaskSessionId(
  taskId: string,
  sessionId: string,
  authorization: string,
) {
  const canonicalSessionId = toCanonicalTaskSessionId(taskId, sessionId);
  if (!canonicalSessionId) {
    return null;
  }

  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  if (lineageResult.ok) {
    const record = lineageResult.records.find(
      (item) => item.id === sessionId || item.runtimeSessionId === sessionId,
    );
    if (record?.id) {
      return record.id;
    }
  }

  return canonicalSessionId;
}

export function createProjectionTraceTimelineMeta(args: {
  meta?: TaskSessionTimelineMeta;
  itemCount: number;
}): TaskSessionTimelineMeta {
  return {
    ...args.meta,
    readSource: "task-session-projection",
    complete: args.meta?.complete === true && args.itemCount > 0,
  };
}

export function shouldReplaceTraceTimeline(args: {
  currentItemCount: number;
  fallbackItemCount: number;
  projectionComplete?: boolean;
}): boolean {
  return !args.projectionComplete && args.fallbackItemCount >= args.currentItemCount;
}

export async function persistTaskSessionMessageSnapshot(
  taskId: string,
  authorization: string,
  input: {
    runtimeSessionId: string;
    message: unknown;
  },
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/sessions/messages`, {
    method: "POST",
    authorization,
    body: {
      runtimeSessionId: input.runtimeSessionId,
      message: input.message,
    },
  });
}

export async function fetchTaskSessionLineageRecords(taskId: string, authorization: string) {
  const lineageResult = await cpFetch<ServiceTaskSessionListResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions`,
    { authorization },
  );

  const records =
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? mapServiceTaskSessionsToLineageRecords(
          lineageResult.data.data,
          lineageResult.data.meta?.currentSessionId,
        )
      : [];

  return {
    ok: lineageResult.ok,
    status: lineageResult.status,
    records,
    activeRecords: records.filter((record) => !record.archivedAt),
  };
}

export async function upsertTaskSessionLineageRecord(
  taskId: string,
  authorization: string,
  input: UpsertTaskSessionLineageInput,
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/sessions`, {
    method: "POST",
    body: {
      runtimeSessionId: input.runtimeSessionId,
      parentRuntimeSessionId: input.parentRuntimeSessionId,
      forkedFromMessageId: input.forkedFromMessageId,
      branchName: input.branchName,
      sourceType: input.sourceType,
      sessionKind: input.sessionKind,
      executionModeSnapshot: input.executionModeSnapshot,
      isActive: input.isActive,
      candidateIndex: input.candidateIndex,
      stepIndex: input.stepIndex,
      selectedModel: input.selectedModel,
      coordinationKey: input.coordinationKey,
      operationId: input.operationId,
    },
    authorization,
  });
}

export async function fetchTaskSessionTimeline(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const persistedSessionId = await resolvePersistedTaskSessionId(taskId, sessionId, authorization);
  if (!persistedSessionId) {
    return {
      ok: false as const,
      status: 404,
      data: undefined,
      error: "Task session not found",
    };
  }

  const suffix = options?.includeLineage ? "?includeLineage=true" : "";
  const result = await cpFetch<ServiceTaskTimelineResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(persistedSessionId)}/timeline${suffix}`,
    { authorization },
  );
  return {
    ...result,
    data: result.data
      ? {
          data: Array.isArray(result.data.data) ? mapServiceTimelineItems(result.data.data) : [],
          meta: normalizeTaskSessionTimelineMeta(result.data.meta),
        }
      : undefined,
  };
}

export async function fetchTaskSessionCachedMessages(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
): Promise<TaskSessionCachedMessagesResult> {
  if (options?.includeLineage) {
    const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
    const lineagePath = lineageResult.ok
      ? buildTaskSessionMessageLineagePath(lineageResult.activeRecords, sessionId)
      : [];

    if (lineagePath.length > 0) {
      const messageSets: Array<{
        ok: boolean;
        data: unknown[];
        meta: TaskSessionTimelineMeta | undefined;
      }> = await Promise.all(
        lineagePath.map(async (record) => {
          const result = await fetchTaskSessionCachedMessages(
            taskId,
            record.runtimeSessionId,
            authorization,
            { includeLineage: false },
          );
          return {
            ok: result.ok,
            data: Array.isArray(result.data?.data) ? result.data.data : [],
            meta: result.data?.meta,
          };
        }),
      );

      const mergedMessages = dedupeLegacySessionMessages(
        messageSets.flatMap((result, index) =>
          sliceLegacyMessagesForLineageBoundary(result.data, lineagePath[index + 1]),
        ),
      );
      const cachedSessionCount = messageSets.filter((result) => result.data.length > 0).length;
      const complete =
        messageSets.length > 0 &&
        messageSets.every(
          (result) =>
            result.ok &&
            isTaskSessionMessageCacheComplete(result.meta, result.data.length),
        );

      return {
        ok: true as const,
        status: 200,
        data: {
          data: mergedMessages,
          meta: {
            readSource: "task-session-first",
            includeLineage: true,
            lineagePath: lineagePath.map((record) => record.runtimeSessionId),
            cachedSessionCount,
            cacheState: complete ? "complete" : cachedSessionCount > 0 ? "partial" : "none",
            complete,
            itemCount: mergedMessages.length,
            sessionId,
            messageCount: mergedMessages.length,
          },
        },
      };
    }
  }

  const persistedSessionId = await resolvePersistedTaskSessionId(taskId, sessionId, authorization);
  if (!persistedSessionId) {
    return {
      ok: false as const,
      status: 404,
      data: undefined,
      error: "Task session not found",
    };
  }

  const result = await cpFetch<ServiceTaskSessionMessagesResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/query/normalized-conversation?sessionId=${encodeURIComponent(persistedSessionId)}&includeLineage=false`,
    { authorization },
  );
  const messages = Array.isArray(result.data?.data)
    ? mapServiceTaskSessionMessages(result.data.data)
    : [];
  const normalizedMeta = normalizeTaskSessionTimelineMeta(result.data?.meta);
  const cacheState = deriveTaskSessionMessageCacheState(normalizedMeta, messages.length);
  const complete = isTaskSessionMessageCacheComplete(normalizedMeta, messages.length);

  return {
    ...result,
    data: result.data
      ? {
          data: messages,
          meta: {
            ...normalizedMeta,
            cacheState,
            complete,
            itemCount: messages.length,
            sessionId: result.data.meta?.sessionId ?? persistedSessionId,
            messageCount: messages.length,
          },
        }
      : undefined,
  };
}

export async function fetchTaskConversationMessages(
  taskId: string,
  authorization: string,
  options?: { sessionId?: string; includeLineage?: boolean },
) {
  const params = new URLSearchParams();
  if (options?.sessionId) {
    const persistedSessionId = await resolvePersistedTaskSessionId(
      taskId,
      options.sessionId,
      authorization,
    );
    if (!persistedSessionId) {
      return {
        ok: false as const,
        status: 404,
        data: undefined,
        error: "Task session not found",
      };
    }
    params.set("sessionId", persistedSessionId);
  }
  if (options?.includeLineage === false) {
    params.set("includeLineage", "false");
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await cpFetch<ServiceTaskSessionMessagesResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/query/normalized-conversation${suffix}`,
    { authorization },
  );
  const serviceMessages = Array.isArray(result.data?.data) ? result.data.data : [];
  const lineageResult =
    !options?.sessionId && options?.includeLineage !== false
      ? await fetchTaskSessionLineageRecords(taskId, authorization)
      : null;
  const filteredServiceMessages =
    lineageResult?.ok && lineageResult.activeRecords.length > 0
      ? filterLatestPendingParallelTaskConversationMessages(
          serviceMessages,
          lineageResult.activeRecords,
        )
      : serviceMessages;
  const messages =
    lineageResult?.ok && lineageResult.activeRecords.length > 0
      ? await synthesizeWorkflowGroupMessages(
          taskId,
          authorization,
          filteredServiceMessages,
          lineageResult.activeRecords,
        )
      : mapServiceTaskSessionMessages(filteredServiceMessages);
  const normalizedMeta = normalizeTaskSessionTimelineMeta(result.data?.meta);
  const cacheState = deriveTaskSessionMessageCacheState(normalizedMeta, messages.length);
  const complete = isTaskSessionMessageCacheComplete(normalizedMeta, messages.length);

  return {
    ...result,
    data: result.data
      ? {
          data: messages,
          meta: {
            ...normalizedMeta,
            cacheState,
            complete,
            itemCount: messages.length,
            sessionId: result.data.meta?.sessionId,
            messageCount: messages.length,
          },
        }
      : undefined,
  };
}

export async function activateTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(recordId)}/activate`,
    { method: "POST", authorization },
  );
}

export async function archiveTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(recordId)}/archive`,
    { method: "POST", authorization },
  );
}

export async function adoptTaskSessionWinnerByRecordId(
  taskId: string,
  authorization: string,
  input: {
    coordinationKey: string;
    winnerSessionId: string;
  },
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/adopt-winner`, {
    method: "POST",
    authorization,
    body: input,
  });
}
