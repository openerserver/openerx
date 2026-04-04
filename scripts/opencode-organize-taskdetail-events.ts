import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type RawCaptureRecord = {
  kind: string;
  ts?: string;
  sequence?: number;
  dataJson?: unknown;
};

type PageRealtimeEvent = {
  sequence: number;
  ts: string;
  kind:
    | "task.message.updated"
    | "task.message.delta"
    | "task.snapshot.updated"
    | "session.status"
    | "session.idle"
    | "tool.execute.before"
    | "tool.execute.after";
  sessionId?: string;
  messageId?: string;
  role?: string;
  agent?: string;
  model?: string;
  delta?: string;
  reason?: string;
  statusType?: string;
  toolName?: string;
  sourceRawType: string;
};

type OrganizedMessageItem = {
  key: string;
  role: string;
  agent?: string;
  model?: string;
  text?: string;
  toolCalls: [];
  createdAt?: string;
  completedAt?: string;
  raw: {
    messageUpdatedSequences: number[];
    partUpdatedSequences: number[];
    partDeltaSequences: number[];
    partTypes: string[];
  };
  isStreaming?: boolean;
  deltaCount: number;
  nonTextParts: Array<{
    type: string;
    sequence: number;
    partId?: string;
    snapshot?: string;
  }>;
};

type OrganizedSession = {
  sessionId: string;
  title?: string;
  slug?: string;
  label?: string;
  stage?: string;
  agentLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  idleAt?: string;
  statusTimeline: Array<{
    ts: string;
    type?: string;
    sequence: number;
  }>;
  messageItems: OrganizedMessageItem[];
};

type OrganizedMessageDirectionItem = {
  index: number;
  key: string;
  sessionId: string;
  sessionLabel?: string;
  sessionTitle?: string;
  role: string;
  agent?: string;
  model?: string;
  createdAt?: string;
  completedAt?: string;
  isStreaming?: boolean;
  deltaCount: number;
  text?: string;
};

type SessionAccumulator = {
  sessionId: string;
  title?: string;
  slug?: string;
  label?: string;
  stage?: string;
  agentLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  idleAt?: string;
  statusTimeline: Array<{
    ts: string;
    type?: string;
    sequence: number;
  }>;
  messageOrder: string[];
};

type MessageAccumulator = {
  key: string;
  sessionId: string;
  role?: string;
  agent?: string;
  model?: string;
  createdAt?: string;
  completedAt?: string;
  text?: string;
  deltaCount: number;
  messageUpdatedSequences: number[];
  partUpdatedSequences: number[];
  partDeltaSequences: number[];
  partTypes: Set<string>;
  nonTextParts: Array<{
    type: string;
    sequence: number;
    partId?: string;
    snapshot?: string;
  }>;
};

type OrganizedTaskDetailDebug = {
  version: 1;
  sourceFile: string;
  generatedAt: string;
  taskId?: string;
  summary: {
    rawEventCount: number;
    pageRealtimeEventCount: number;
    sessionCount: number;
    messageCount: number;
    sentToModelCount: number;
    modelReplyCount: number;
    ignoredRawTypes: Record<string, number>;
    keptRawTypes: Record<string, number>;
  };
  notes: string[];
  groupedMessages: {
    sentToModel: OrganizedMessageDirectionItem[];
    modelReplies: OrganizedMessageDirectionItem[];
  };
  sessions: OrganizedSession[];
  pageRealtimeEvents: PageRealtimeEvent[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function longestOverlapSuffixPrefix(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  for (let length = maxLength; length > 0; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function mergeStreamingText(
  existing: string | undefined,
  incoming: string,
  mode: "delta" | "snapshot",
): string {
  const next = incoming.trim();
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  if (next.startsWith(existing)) {
    return next;
  }
  if (existing === next || existing.endsWith(next)) {
    return existing;
  }

  if (mode === "snapshot") {
    if (next.length >= existing.length && next.includes(existing.slice(0, Math.min(80, existing.length)))) {
      return next;
    }
    if (existing.length > next.length && existing.includes(next.slice(0, Math.min(80, next.length)))) {
      return existing;
    }
  }

  const overlap = longestOverlapSuffixPrefix(existing, next);
  if (overlap > 0) {
    return `${existing}${next.slice(overlap)}`;
  }

  return mode === "snapshot" && next.length > existing.length ? next : `${existing}${next}`;
}

function inferTaskIdFromText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /Opener-X task ID:\s*([0-9a-f-]{8,})/iu.exec(value);
  return match?.[1];
}

function inferSessionLabel(title: string | undefined) {
  if (!title) {
    return {};
  }

  const rootMatch = /^\[Task\s+([^\]]+)\]\s+(.+)$/su.exec(title);
  if (rootMatch) {
    return {
      label: "main",
      stage: "root",
      agentLabel: undefined,
    };
  }

  const workflowMatch = /^\[([^\]]+)\]\s+(.+?)\s*\/\s*(.+)$/su.exec(title);
  if (workflowMatch) {
    return {
      label: workflowMatch[1],
      stage: workflowMatch[1],
      agentLabel: workflowMatch[2],
    };
  }

  return {
    label: title,
  };
}

function deriveOutputPath(inputPath: string) {
  if (inputPath.endsWith(".jsonl")) {
    return inputPath.replace(/\.jsonl$/u, ".taskdetail.json");
  }
  return `${inputPath}.taskdetail.json`;
}

function parseArgs(argv: string[]) {
  let inputPath = "";
  let outputPath = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if ((arg === "--input" || arg === "-i") && next) {
      inputPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if ((arg === "--output" || arg === "-o") && next) {
      outputPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Organize a raw OpenCode global-event JSONL file into a TaskDetail-focused debug JSON.

Usage:
  bun run scripts/opencode-organize-taskdetail-events.ts --input <file> [--output <file>]
`);
      process.exit(0);
    }
  }

  if (!inputPath) {
    throw new Error("Missing --input <file>");
  }

  return {
    inputPath,
    outputPath: outputPath || deriveOutputPath(inputPath),
  };
}

async function main() {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));
  const content = await readFile(inputPath, "utf8");
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const sessions = new Map<string, SessionAccumulator>();
  const messages = new Map<string, MessageAccumulator>();
  const pageRealtimeEvents: PageRealtimeEvent[] = [];
  const keptRawTypes = new Map<string, number>();
  const ignoredRawTypes = new Map<string, number>();
  let taskId: string | undefined;
  let rawEventCount = 0;

  const ensureSession = (sessionId: string) => {
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        statusTimeline: [],
        messageOrder: [],
      };
      sessions.set(sessionId, session);
    }
    return session;
  };

  const ensureMessage = (messageId: string, sessionId: string) => {
    let message = messages.get(messageId);
    if (!message) {
      message = {
        key: messageId,
        sessionId,
        deltaCount: 0,
        messageUpdatedSequences: [],
        partUpdatedSequences: [],
        partDeltaSequences: [],
        partTypes: new Set<string>(),
        nonTextParts: [],
      };
      messages.set(messageId, message);
      const session = ensureSession(sessionId);
      if (!session.messageOrder.includes(messageId)) {
        session.messageOrder.push(messageId);
      }
    }
    return message;
  };

  for (const line of lines) {
    const record = JSON.parse(line) as RawCaptureRecord;
    if (record.kind !== "event" || typeof record.sequence !== "number") {
      continue;
    }
    rawEventCount += 1;

    const dataJson = asRecord(record.dataJson);
    const payload = asRecord(dataJson?.payload);
    const rawType = asString(payload?.type);
    if (!payload || !rawType) {
      continue;
    }

    const properties = asRecord(payload.properties) ?? {};
    const info = asRecord(properties.info) ?? {};
    const part = asRecord(properties.part) ?? {};

    const markKept = () => keptRawTypes.set(rawType, (keptRawTypes.get(rawType) || 0) + 1);
    const markIgnored = () => ignoredRawTypes.set(rawType, (ignoredRawTypes.get(rawType) || 0) + 1);

    if (!taskId) {
      taskId =
        inferTaskIdFromText(asString(part.text)) ??
        inferTaskIdFromText(asString(dataJson?.dataRaw)) ??
        inferTaskIdFromText(asString(info.title));
    }

    if (rawType === "session.created" || rawType === "session.updated") {
      const sessionId = asString(info.id);
      if (!sessionId) {
        markIgnored();
        continue;
      }

      const session = ensureSession(sessionId);
      session.title = asString(info.title) ?? session.title;
      session.slug = asString(info.slug) ?? session.slug;
      session.createdAt = parseTimestamp(asRecord(info.time)?.created) ?? session.createdAt;
      session.updatedAt = parseTimestamp(asRecord(info.time)?.updated) ?? session.updatedAt;
      const inferred = inferSessionLabel(session.title);
      session.label = inferred.label ?? session.label;
      session.stage = inferred.stage ?? session.stage;
      session.agentLabel = inferred.agentLabel ?? session.agentLabel;

      pageRealtimeEvents.push({
        sequence: record.sequence,
        ts: record.ts ?? new Date().toISOString(),
        kind: "task.snapshot.updated",
        sessionId,
        reason: rawType,
        sourceRawType: rawType,
      });
      markKept();
      continue;
    }

    if (rawType === "session.status") {
      const sessionId = asString(properties.sessionID);
      if (!sessionId) {
        markIgnored();
        continue;
      }
      const session = ensureSession(sessionId);
      const statusType = asString(asRecord(properties.status)?.type);
      session.statusTimeline.push({
        ts: record.ts ?? new Date().toISOString(),
        type: statusType,
        sequence: record.sequence,
      });
      pageRealtimeEvents.push({
        sequence: record.sequence,
        ts: record.ts ?? new Date().toISOString(),
        kind: "session.status",
        sessionId,
        statusType,
        sourceRawType: rawType,
      });
      markKept();
      continue;
    }

    if (rawType === "session.idle") {
      const sessionId = asString(properties.sessionID);
      if (!sessionId) {
        markIgnored();
        continue;
      }
      const session = ensureSession(sessionId);
      session.idleAt = record.ts ?? new Date().toISOString();
      pageRealtimeEvents.push({
        sequence: record.sequence,
        ts: record.ts ?? new Date().toISOString(),
        kind: "session.idle",
        sessionId,
        sourceRawType: rawType,
      });
      markKept();
      continue;
    }

    if (rawType === "message.updated") {
      const messageId = asString(info.id);
      const sessionId = asString(info.sessionID);
      if (!messageId || !sessionId) {
        markIgnored();
        continue;
      }
      const message = ensureMessage(messageId, sessionId);
      message.role = asString(info.role) ?? message.role;
      message.agent = asString(info.agent) ?? message.agent;
      message.model = asString(asRecord(info.model)?.modelID) ?? asString(info.modelID) ?? message.model;
      message.createdAt = parseTimestamp(asRecord(info.time)?.created) ?? message.createdAt;
      message.completedAt = parseTimestamp(asRecord(info.time)?.completed) ?? message.completedAt;
      message.messageUpdatedSequences.push(record.sequence);

      pageRealtimeEvents.push({
        sequence: record.sequence,
        ts: record.ts ?? new Date().toISOString(),
        kind: "task.message.updated",
        sessionId,
        messageId,
        role: message.role,
        agent: message.agent,
        model: message.model,
        reason: rawType,
        sourceRawType: rawType,
      });
      markKept();
      continue;
    }

    if (rawType === "message.part.updated") {
      const messageId = asString(part.messageID);
      const sessionId = asString(part.sessionID);
      const partType = asString(part.type);
      if (!messageId || !sessionId) {
        markIgnored();
        continue;
      }

      const message = ensureMessage(messageId, sessionId);
      if (partType) {
        message.partTypes.add(partType);
      }
      message.partUpdatedSequences.push(record.sequence);

      if (partType === "text") {
        const text = asString(part.text);
        if (text) {
          message.text = mergeStreamingText(message.text, text, "snapshot");
          pageRealtimeEvents.push({
            sequence: record.sequence,
            ts: record.ts ?? new Date().toISOString(),
            kind: "task.message.delta",
            sessionId,
            messageId,
            role: message.role,
            agent: message.agent,
            model: message.model,
            delta: text,
            reason: rawType,
            sourceRawType: rawType,
          });
        }
      } else if (partType) {
        message.nonTextParts.push({
          type: partType,
          sequence: record.sequence,
          partId: asString(part.id),
          snapshot: asString(part.snapshot),
        });
      }

      markKept();
      continue;
    }

    if (rawType === "message.part.delta") {
      const messageId = asString(properties.messageID);
      const sessionId = asString(properties.sessionID);
      const field = asString(properties.field);
      const delta = asString(properties.delta);
      if (!messageId || !sessionId || field !== "text" || !delta) {
        markIgnored();
        continue;
      }

        const message = ensureMessage(messageId, sessionId);
        message.text = mergeStreamingText(message.text, delta, "delta");
      message.deltaCount += 1;
      message.partDeltaSequences.push(record.sequence);

      pageRealtimeEvents.push({
        sequence: record.sequence,
        ts: record.ts ?? new Date().toISOString(),
        kind: "task.message.delta",
        sessionId,
        messageId,
        role: message.role,
        agent: message.agent,
        model: message.model,
        delta,
        reason: rawType,
        sourceRawType: rawType,
      });
      markKept();
      continue;
    }

    if (rawType === "tool.execute.before" || rawType === "tool.execute.after") {
      const sessionId =
        asString(properties.sessionID) ??
        asString(asRecord(properties.info)?.sessionID) ??
        asString(asRecord(properties.part)?.sessionID);
      pageRealtimeEvents.push({
        sequence: record.sequence,
        ts: record.ts ?? new Date().toISOString(),
        kind: rawType,
        sessionId,
        toolName: asString(properties.tool) ?? asString(properties.toolName),
        sourceRawType: rawType,
      });
      markKept();
      continue;
    }

    markIgnored();
  }

  const organizedSessions = [...sessions.values()]
    .map<OrganizedSession>((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      slug: session.slug,
      label: session.label,
      stage: session.stage,
      agentLabel: session.agentLabel,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      idleAt: session.idleAt,
      statusTimeline: session.statusTimeline,
      messageItems: session.messageOrder
        .map((messageId) => messages.get(messageId))
        .filter((message): message is MessageAccumulator => Boolean(message))
        .map((message) => ({
          key: message.key,
          role: message.role ?? "unknown",
          agent: message.agent,
          model: message.model,
          text: message.text,
          toolCalls: [],
          createdAt: message.createdAt,
          completedAt: message.completedAt,
          raw: {
            messageUpdatedSequences: message.messageUpdatedSequences,
            partUpdatedSequences: message.partUpdatedSequences,
            partDeltaSequences: message.partDeltaSequences,
            partTypes: [...message.partTypes],
          },
          isStreaming: !message.completedAt && message.role === "assistant",
          deltaCount: message.deltaCount,
          nonTextParts: message.nonTextParts,
        })),
    }))
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const groupedMessages = organizedSessions
    .flatMap((session) =>
      session.messageItems.map((message) => ({
        sessionId: session.sessionId,
        sessionLabel: session.label ?? session.stage,
        sessionTitle: session.title,
        ...message,
      })),
    )
    .sort((a, b) => {
      const left = a.createdAt || "";
      const right = b.createdAt || "";
      return left.localeCompare(right);
    });

  const sentToModel: OrganizedMessageDirectionItem[] = [];
  const modelReplies: OrganizedMessageDirectionItem[] = [];

  for (const message of groupedMessages) {
    const baseItem: Omit<OrganizedMessageDirectionItem, "index"> = {
      key: message.key,
      sessionId: message.sessionId,
      sessionLabel: message.sessionLabel,
      sessionTitle: message.sessionTitle,
      role: message.role,
      agent: message.agent,
      model: message.model,
      createdAt: message.createdAt,
      completedAt: message.completedAt,
      isStreaming: message.isStreaming,
      deltaCount: message.deltaCount,
      text: message.text,
    };

    if (message.role === "user") {
      sentToModel.push({ index: sentToModel.length + 1, ...baseItem });
      continue;
    }

    if (message.role === "assistant") {
      modelReplies.push({ index: modelReplies.length + 1, ...baseItem });
    }
  }

  const organized: OrganizedTaskDetailDebug = {
    version: 1,
    sourceFile: inputPath,
    generatedAt: new Date().toISOString(),
    taskId,
    summary: {
      rawEventCount,
      pageRealtimeEventCount: pageRealtimeEvents.length,
      sessionCount: sessions.size,
      messageCount: messages.size,
      sentToModelCount: sentToModel.length,
      modelReplyCount: modelReplies.length,
      ignoredRawTypes: Object.fromEntries([...ignoredRawTypes.entries()].sort((a, b) => b[1] - a[1])),
      keptRawTypes: Object.fromEntries([...keptRawTypes.entries()].sort((a, b) => b[1] - a[1])),
    },
    notes: [
      "该文件按 TaskDetail 页面调试视角整理，保留页面关心的 message.updated、message delta、session snapshot/status/idle。",
      "原始 runtime 的 message.part.delta 已折叠并映射为 task.message.delta，便于直接观察页面流式文本。",
      "server.connected、server.heartbeat、session.diff 等噪音事件不会进入 pageRealtimeEvents，但会出现在 summary.ignoredRawTypes 中。",
      "groupedMessages.sentToModel 等价于我们发给模型的 user 消息；groupedMessages.modelReplies 等价于模型返回的 assistant 消息。",
    ],
    groupedMessages: {
      sentToModel,
      modelReplies,
    },
    sessions: organizedSessions,
    pageRealtimeEvents,
  };

  await writeFile(outputPath, `${JSON.stringify(organized, null, 2)}\n`, "utf8");
  console.log(`Organized TaskDetail debug file written to ${outputPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});