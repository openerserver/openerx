import { cpFetch } from "../../lib/control-plane-client";

let runtimeProviderModulePromise:
  | Promise<typeof import("../agent-control/runtime-provider")>
  | undefined;

async function loadRuntimeProviderModule() {
  runtimeProviderModulePromise ??= import("../agent-control/runtime-provider");
  return runtimeProviderModulePromise;
}

interface RuntimeWorkflowSessionRecord {
  sessionId: string;
  title?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WorkflowGroupStepRecord {
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

function toTimestampMs(value?: string | null) {
  const rawValue = asString(value);
  if (!rawValue) {
    return null;
  }

  const parsed = Date.parse(rawValue);
  return Number.isNaN(parsed) ? null : parsed;
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

  return (left.session.sessionId || "").localeCompare(right.session.sessionId || "", "zh-CN");
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

export async function fetchRuntimeWorkflowCompatGroupSteps(
  taskId: string,
  authorization: string,
) {
  const taskResult = await cpFetch<{ title?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  const taskTitle = asString(taskResult.data?.title);

  const { listSessions } = await loadRuntimeProviderModule();
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
      const { getSessionMessages } = await loadRuntimeProviderModule();
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