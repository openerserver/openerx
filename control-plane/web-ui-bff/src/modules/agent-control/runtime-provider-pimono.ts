import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAgentRunForSession, updateAgentRunStatus } from "./agent-run-registry";
import {
  PiMonoRpcClient,
  type PiMonoRpcConfig,
  type PiMonoRpcEvent,
  type PiMonoRpcExtensionUiRequest,
  type PiMonoRpcExtensionUiResponse,
} from "./pimono-rpc-client";
import type {
  RuntimeBackend,
  RuntimeContinueSessionOptions,
  RuntimeCreateSessionResult,
  RuntimeDetachedPromptResult,
  RuntimeForkSessionResult,
  RuntimeGetSessionMessagesOptions,
  RuntimeModelRef,
  RuntimePermissionReply,
  RuntimePermissionRequest,
  RuntimeProvider,
  RuntimeResult,
} from "./runtime-provider-types";

type PiMonoRuntimeStatus = "idle" | "running" | "paused" | "stopped" | "failed";

type PiMonoGuidance = {
  content: string;
  injectedAt: string;
  mode: "reply" | "noReply";
};

type PiMonoPermissionMethod = "confirm" | "select" | "input" | "editor";

type PiMonoRuntimeHandle = {
  agentRunId: string;
  sessionId: string;
  sessionFile?: string;
  title: string;
  taskId?: string;
  projectId?: string;
  createdAt: string;
  model?: RuntimeModelRef;
  candidateIndex?: number;
  client: PiMonoRpcClient;
  eventChain: Promise<void>;
  unsubscribeEvents?: () => void;
  unsubscribeExit?: () => void;
  status: PiMonoRuntimeStatus;
  pendingGuidance: PiMonoGuidance[];
  cachedMessages: unknown[];
  lastCompletedAt?: string;
  lastError?: string;
  pauseRequested?: boolean;
  stopRequested?: boolean;
  disposed?: boolean;
  recovering?: Promise<void>;
};

type PiMonoPendingPermission = RuntimePermissionRequest & {
  createdAt: string;
  method: PiMonoPermissionMethod;
  messageText?: string;
  options?: string[];
  prefill?: string;
  timeout?: number;
  title?: string;
};

const piMonoRuntimeHandles = new Map<string, PiMonoRuntimeHandle>();
const piMonoRuntimePermissions = new Map<
  string,
  {
    handle: PiMonoRuntimeHandle;
    original: PiMonoRpcExtensionUiRequest;
    request: PiMonoPendingPermission;
  }
>();
let sseAggregatorModulePromise:
  | Promise<{
      sseAggregator: {
        ingestParsedEvent(type: string, parsed: Record<string, unknown>): Promise<void>;
      };
    }>
  | undefined;

const DEFAULT_PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS = 5_000;
const DEFAULT_PI_MONO_RPC_COMMAND = "npm";
const DEFAULT_PI_MONO_RPC_ARGS = ["exec", "tsx", "src/cli.ts", "--", "--mode", "rpc"];
const DEFAULT_PI_MONO_RPC_CWD_CANDIDATES = Array.from(
  new Set([
    fileURLToPath(
      new URL("../../../../../pi-mono/packages/coding-agent/", import.meta.url),
    ),
    resolve(process.cwd(), "pi-mono/packages/coding-agent"),
    resolve(process.cwd(), "../../pi-mono/packages/coding-agent"),
  ]),
);

function readDefaultPiMonoRpcCwd() {
  return (
    DEFAULT_PI_MONO_RPC_CWD_CANDIDATES.find((candidate) =>
      existsSync(resolve(candidate, "src/cli.ts")),
    ) || DEFAULT_PI_MONO_RPC_CWD_CANDIDATES[0]
  );
}

function readPiMonoPauseSettlementTimeoutMs() {
  const raw = process.env.PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PI_MONO_PAUSE_SETTLEMENT_TIMEOUT_MS;
  }

  return parsed;
}

function parsePiMonoArgs(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) {
    return [];
  }

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return parsed;
      }
    } catch {
      // Fall back to whitespace splitting below.
    }
  }

  return value.split(/\s+/).filter(Boolean);
}

function readPiMonoRpcConfig(): PiMonoRpcConfig {
  const parsedArgs = parsePiMonoArgs(process.env.PI_MONO_RPC_ARGS);
  return {
    command: process.env.PI_MONO_RPC_COMMAND?.trim() || DEFAULT_PI_MONO_RPC_COMMAND,
    args: parsedArgs.length > 0 ? parsedArgs : [...DEFAULT_PI_MONO_RPC_ARGS],
    cwd: process.env.PI_MONO_RPC_CWD?.trim() || readDefaultPiMonoRpcCwd(),
  };
}

function uniquePiMonoHandles() {
  return Array.from(new Set(Array.from(piMonoRuntimeHandles.values())));
}

function countPiMonoPendingPermissions(handle: PiMonoRuntimeHandle) {
  let count = 0;
  for (const entry of piMonoRuntimePermissions.values()) {
    if (entry.handle === handle) {
      count += 1;
    }
  }
  return count;
}

function createPiMonoTitle(taskId: string, prompt: string) {
  return `[Task ${taskId.slice(0, 8)}] ${prompt.slice(0, 80)}`;
}

async function getPiMonoSseAggregator() {
  sseAggregatorModulePromise ??= import("../realtime/sse-aggregator");
  return (await sseAggregatorModulePromise).sseAggregator;
}

async function ingestPiMonoRealtimeEvent(type: string, parsed: Record<string, unknown>) {
  const sseAggregator = await getPiMonoSseAggregator();
  await sseAggregator.ingestParsedEvent(type, parsed);
}

function resolvePiMonoHandle(key: string) {
  return piMonoRuntimeHandles.get(key);
}

function registerPiMonoHandle(handle: PiMonoRuntimeHandle) {
  piMonoRuntimeHandles.set(handle.sessionId, handle);
  if (handle.agentRunId !== handle.sessionId) {
    piMonoRuntimeHandles.set(handle.agentRunId, handle);
  }
}

function unregisterPiMonoHandle(handle: PiMonoRuntimeHandle) {
  piMonoRuntimeHandles.delete(handle.sessionId);
  piMonoRuntimeHandles.delete(handle.agentRunId);
}

function setPiMonoHandleAgentRunId(handle: PiMonoRuntimeHandle, agentRunId: string) {
  if (handle.agentRunId === agentRunId) {
    return;
  }

  piMonoRuntimeHandles.delete(handle.agentRunId);
  handle.agentRunId = agentRunId;
  piMonoRuntimeHandles.set(agentRunId, handle);
}

async function disposePiMonoHandle(handle: PiMonoRuntimeHandle) {
  handle.disposed = true;
  unregisterPiMonoHandle(handle);
  clearPiMonoPermissionsForHandle(handle);
  handle.unsubscribeEvents?.();
  handle.unsubscribeEvents = undefined;
  handle.unsubscribeExit?.();
  handle.unsubscribeExit = undefined;
  await handle.eventChain.catch(() => undefined);
  await handle.client.stop().catch(() => undefined);
}

function clearPiMonoPermissionsForHandle(handle: PiMonoRuntimeHandle) {
  for (const [requestId, entry] of piMonoRuntimePermissions.entries()) {
    if (entry.handle === handle) {
      piMonoRuntimePermissions.delete(requestId);
    }
  }
}

function readPiMonoUiRequestMessage(request: PiMonoRpcExtensionUiRequest) {
  if (request.method === "confirm") {
    return request.message;
  }
  return undefined;
}

function readPiMonoUiRequestOptions(request: PiMonoRpcExtensionUiRequest) {
  if (request.method === "select") {
    return request.options;
  }
  return undefined;
}

function readPiMonoUiRequestPrefill(request: PiMonoRpcExtensionUiRequest) {
  if (request.method === "editor") {
    return request.prefill;
  }
  return undefined;
}

function readPiMonoUiRequestTimeout(request: PiMonoRpcExtensionUiRequest) {
  switch (request.method) {
    case "confirm":
    case "input":
    case "select":
      return request.timeout;
    default:
      return undefined;
  }
}

function isPiMonoPermissionMethod(
  method: PiMonoRpcExtensionUiRequest["method"],
): method is PiMonoPermissionMethod {
  return method === "confirm" || method === "editor" || method === "input" || method === "select";
}

function isPiMonoExtensionUiRequest(event: PiMonoRpcEvent): event is PiMonoRpcExtensionUiRequest {
  return event.type === "extension_ui_request" && "id" in event && "method" in event;
}

function buildPiMonoPermissionName(method: PiMonoPermissionMethod) {
  switch (method) {
    case "confirm":
      return "runtime_confirmation";
    case "editor":
      return "runtime_editor";
    case "input":
      return "runtime_input";
    case "select":
      return "runtime_selection";
  }
}

function registerPiMonoPermissionRequest(
  handle: PiMonoRuntimeHandle,
  request: PiMonoRpcExtensionUiRequest,
) {
  if (!isPiMonoPermissionMethod(request.method)) {
    return null;
  }

  const pendingRequest: PiMonoPendingPermission = {
    id: request.id,
    sessionID: handle.sessionId,
    permission: buildPiMonoPermissionName(request.method),
    patterns: readPiMonoUiRequestOptions(request) ?? [],
    metadata: {
      source: "pi-mono-extension-ui",
      method: request.method,
      title: "title" in request ? request.title : undefined,
      message: readPiMonoUiRequestMessage(request),
      options: readPiMonoUiRequestOptions(request),
      prefill: readPiMonoUiRequestPrefill(request),
    },
    always: [],
    createdAt: new Date().toISOString(),
    method: request.method,
    title: "title" in request ? request.title : undefined,
    messageText: readPiMonoUiRequestMessage(request),
    options: readPiMonoUiRequestOptions(request),
    prefill: readPiMonoUiRequestPrefill(request),
    timeout: readPiMonoUiRequestTimeout(request),
  };

  piMonoRuntimePermissions.set(request.id, {
    handle,
    original: request,
    request: pendingRequest,
  });
  return pendingRequest;
}

function buildPiMonoPermissionStatusInfo(
  handle: PiMonoRuntimeHandle,
  request: PiMonoPendingPermission,
) {
  return {
    ...buildPiMonoSessionInfo(handle.sessionId, "paused", handle.createdAt),
    type: "paused-approval",
    metadata: {
      decision: "paused-approval",
      method: request.method,
      permission: request.permission,
      requestId: request.id,
      source: "pi-mono-extension-ui",
      title: request.title,
    },
    requests: countPiMonoPendingPermissions(handle),
  };
}

async function emitPiMonoSessionStatus(
  handle: PiMonoRuntimeHandle,
  status: string,
  options?: {
    completedAt?: string | number;
    error?: string;
    info?: Record<string, unknown>;
  },
) {
  if (!handle.taskId || !handle.projectId) {
    return;
  }

  await ingestPiMonoRealtimeEvent("session.status", {
    sessionId: handle.sessionId,
    info: {
      ...buildPiMonoSessionInfo(handle.sessionId, status, handle.createdAt, options?.completedAt),
      ...options?.info,
    },
    ...(options?.error ? { error: { message: options.error } } : {}),
  });
}

async function waitForPiMonoPauseSettlement(handle: PiMonoRuntimeHandle, timeoutMs = 5_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await handle.eventChain.catch(() => undefined);
    if (handle.status === "paused" && !handle.pauseRequested) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return handle.status === "paused" && !handle.pauseRequested;
}

async function ensurePiMonoPauseSettled(
  handle: PiMonoRuntimeHandle,
  action: string,
  timeoutMs = readPiMonoPauseSettlementTimeoutMs(),
) {
  const settled = await waitForPiMonoPauseSettlement(handle, timeoutMs);
  if (settled) {
    return;
  }

  throw new Error(
    `pi-mono pause did not settle while ${action} within ${timeoutMs}ms for session ${handle.sessionId}`,
  );
}

function handlePiMonoClientExit(handle: PiMonoRuntimeHandle, reason: string) {
  if (handle.disposed) {
    return;
  }

  handle.lastError = reason;
  clearPiMonoPermissionsForHandle(handle);

  if (handle.stopRequested) {
    handle.status = "stopped";
    return;
  }

  if (handle.pauseRequested) {
    handle.status = "paused";
    return;
  }

  if (handle.status === "running") {
    handle.status = "paused";
    updateAgentRunStatus(handle.agentRunId, "paused");
    void emitPiMonoSessionStatus(handle, "paused", {
      info: {
        metadata: {
          message: reason,
          reason: "runtime-process-exit",
          source: "pi-mono-runtime",
        },
        type: "paused",
      },
    });
    return;
  }

  if (handle.status !== "paused") {
    handle.status = "idle";
  }
}

function bindPiMonoClient(handle: PiMonoRuntimeHandle, client: PiMonoRpcClient) {
  handle.unsubscribeEvents?.();
  handle.unsubscribeExit?.();
  handle.client = client;
  handle.unsubscribeEvents = client.onEvent((event) => {
    queuePiMonoRealtimeBridge(handle, event);
  });
  handle.unsubscribeExit = client.onExit((reason) => {
    handlePiMonoClientExit(handle, reason);
  });
}

async function startPiMonoClient(args?: { title?: string; model?: RuntimeModelRef }) {
  const client = new PiMonoRpcClient(readPiMonoRpcConfig());
  await client.start();
  if (args?.model) {
    await client.setModel(args.model.providerId, args.model.modelId);
  }
  if (args?.title?.trim()) {
    await client.setSessionName(args.title.trim());
  }
  return client;
}

function sumPiMonoAssistantTokenUsage(messages: unknown[]): number {
  return messages.reduce<number>((total, message) => {
    if (!message || typeof message !== "object") {
      return total;
    }

    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") {
      return total;
    }

    const usage =
      typeof record.usage === "object" && record.usage
        ? (record.usage as Record<string, unknown>)
        : undefined;
    const totalTokens = usage?.totalTokens;
    return (
      total + (typeof totalTokens === "number" && Number.isFinite(totalTokens) ? totalTokens : 0)
    );
  }, 0);
}

function normalizePiMonoContentToParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content.trim()
      ? [
          {
            type: "text",
            text: content,
          },
        ]
      : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    switch (record.type) {
      case "text":
        if (typeof record.text === "string") {
          parts.push({ type: "text", text: record.text });
        }
        break;
      case "image":
        parts.push({
          type: "image",
          data: record.data,
          mimeType: record.mimeType,
        });
        break;
      case "thinking":
        if (typeof record.thinking === "string") {
          parts.push({ type: "thinking", text: record.thinking });
        }
        break;
      case "toolCall":
        parts.push({
          type: "tool",
          callID: record.id,
          toolName: record.name,
          input: record.arguments,
          state: { status: "completed" },
        });
        break;
      default:
        break;
    }
  }

  return parts;
}

function getPiMonoNormalizedMessageId(sessionId: string, message: unknown, index: number) {
  if (!message || typeof message !== "object") {
    return `${sessionId}:message:${index}`;
  }

  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "unknown";
  const responseId =
    typeof record.responseId === "string" && record.responseId.trim().length > 0
      ? record.responseId.trim()
      : undefined;
  const timestamp =
    typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
      ? record.timestamp
      : undefined;

  if (role === "assistant") {
    if (responseId) {
      return `${sessionId}:assistant:${responseId}`;
    }
    if (timestamp !== undefined) {
      return `${sessionId}:assistant:${timestamp}`;
    }
  }

  if (role === "toolResult") {
    const toolCallId =
      typeof record.toolCallId === "string" && record.toolCallId.trim().length > 0
        ? record.toolCallId.trim()
        : undefined;
    if (toolCallId) {
      return `${sessionId}:tool:${toolCallId}`;
    }
    if (timestamp !== undefined) {
      return `${sessionId}:tool:${timestamp}`;
    }
  }

  if (timestamp !== undefined) {
    return `${sessionId}:${role}:${timestamp}`;
  }

  return `${sessionId}:${role}:${index}`;
}

function normalizePiMonoMessage(
  sessionId: string,
  message: unknown,
  index: number,
  messageId = getPiMonoNormalizedMessageId(sessionId, message, index),
  relatedAssistantMessageId?: string,
) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "unknown";
  const timestamp =
    typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
      ? record.timestamp
      : Date.now();
  const parts = normalizePiMonoContentToParts(record.content);

  const info: Record<string, unknown> = {
    id: messageId,
    role: role === "toolResult" ? "tool" : role,
    sessionID: sessionId,
    time: {
      created: timestamp,
    },
  };

  if (role === "assistant") {
    (info.time as Record<string, unknown>).completed = timestamp;
    info.finish =
      typeof record.stopReason === "string" && record.stopReason.trim()
        ? record.stopReason.trim()
        : "stop";

    const usage =
      typeof record.usage === "object" && record.usage
        ? (record.usage as Record<string, unknown>)
        : undefined;
    if (usage) {
      info.tokens = {
        input: usage.input,
        output: usage.output,
        reasoning: 0,
        total: usage.totalTokens,
        cache: {
          read: usage.cacheRead,
          write: usage.cacheWrite,
        },
      };
    }

    if (typeof record.errorMessage === "string" && record.errorMessage.trim()) {
      info.error = record.errorMessage.trim();
    }
  }

  if (role === "toolResult") {
    info.tool = {
      messageID: relatedAssistantMessageId,
      callID: record.toolCallId,
      toolName: record.toolName,
      isError: record.isError,
    };
  }

  return {
    info,
    parts,
  };
}

function normalizePiMonoMessages(sessionId: string, messages: unknown[]) {
  const messageIds = messages.map((message, index) =>
    getPiMonoNormalizedMessageId(sessionId, message, index),
  );
  let previousAssistantMessageId: string | undefined;

  return messages
    .map((message, index) => {
      const normalized = normalizePiMonoMessage(
        sessionId,
        message,
        index,
        messageIds[index],
        previousAssistantMessageId,
      );
      if (readPiMonoMessageRole(message) === "assistant") {
        previousAssistantMessageId = messageIds[index];
      }
      return normalized;
    })
    .filter(
      (
        message,
      ): message is { info: Record<string, unknown>; parts: Array<Record<string, unknown>> } =>
        Boolean(message),
    );
}

function buildPiMonoSessionSummary(handle: PiMonoRuntimeHandle) {
  return {
    id: handle.sessionId,
    sessionID: handle.sessionId,
    sessionFile: handle.sessionFile,
    title: handle.title,
    backend: backend,
    status: handle.status,
    taskId: handle.taskId,
    projectId: handle.projectId,
    createdAt: handle.createdAt,
    lastCompletedAt: handle.lastCompletedAt,
    lastError: handle.lastError ?? null,
    model: handle.model,
    pendingGuidanceCount: handle.pendingGuidance.length,
    pendingPermissionCount: countPiMonoPendingPermissions(handle),
  };
}

function readPiMonoMessageRole(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  return typeof record.role === "string" ? record.role : undefined;
}

function readPiMonoMessageTimestamp(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  const timestamp = record.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }

  return undefined;
}

function extractPiMonoFailure(message: unknown) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const record = message as Record<string, unknown>;
  const stopReason =
    typeof record.stopReason === "string" && record.stopReason.trim()
      ? record.stopReason.trim()
      : undefined;
  const errorMessage =
    typeof record.errorMessage === "string" && record.errorMessage.trim()
      ? record.errorMessage.trim()
      : undefined;
  const failed = stopReason === "error" || stopReason === "aborted" || Boolean(errorMessage);

  if (!failed) {
    return null;
  }

  return {
    stopReason,
    errorMessage: errorMessage ?? `pi-mono agent ended with ${stopReason ?? "an error"}`,
  };
}

function stringifyPiMonoValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildPiMonoSessionInfo(
  sessionId: string,
  status: string,
  createdAt: string,
  completedAt?: string | number,
) {
  const time: Record<string, unknown> = {
    created: createdAt,
  };
  if (completedAt !== undefined) {
    time.completed = completedAt;
  }

  return {
    id: sessionId,
    sessionID: sessionId,
    type: status,
    status,
    time,
  };
}

async function loadLatestPiMonoNormalizedMessage(
  handle: PiMonoRuntimeHandle,
  expectedRole?: string,
) {
  const messages = await readPiMonoMessages(handle);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (expectedRole && readPiMonoMessageRole(message) !== expectedRole) {
      continue;
    }

    return normalizePiMonoMessage(handle.sessionId, message, index);
  }

  return null;
}

function buildPiMonoRealtimeMessageSnapshot(handle: PiMonoRuntimeHandle, message: unknown) {
  return normalizePiMonoMessage(handle.sessionId, message, -1);
}

function queuePiMonoRealtimeBridge(handle: PiMonoRuntimeHandle, event: PiMonoRpcEvent) {
  handle.eventChain = handle.eventChain
    .then(async () => {
      switch (event.type) {
        case "agent_start": {
          handle.status = "running";
          handle.lastError = undefined;
          await emitPiMonoSessionStatus(handle, "running");
          return;
        }
        case "message_end": {
          const role = readPiMonoMessageRole(event.message);
          const message = await loadLatestPiMonoNormalizedMessage(handle, role);
          if (!message) {
            return;
          }

          await ingestPiMonoRealtimeEvent("message.updated", {
            sessionId: handle.sessionId,
            ...message,
          });
          return;
        }
        case "extension_ui_request": {
          if (!isPiMonoExtensionUiRequest(event)) {
            return;
          }

          const permission = registerPiMonoPermissionRequest(handle, event);
          if (!permission) {
            return;
          }

          handle.status = "paused";
          updateAgentRunStatus(handle.agentRunId, "paused");
          await emitPiMonoSessionStatus(handle, "paused", {
            info: buildPiMonoPermissionStatusInfo(handle, permission),
          });
          return;
        }
        case "message_start": {
          const role = readPiMonoMessageRole(event.message);
          if (role !== "assistant") {
            return;
          }

          const message = buildPiMonoRealtimeMessageSnapshot(handle, event.message);
          if (!message) {
            return;
          }

          await ingestPiMonoRealtimeEvent("message.updated", {
            sessionId: handle.sessionId,
            info: message.info,
          });
          return;
        }
        case "message_update": {
          const assistantMessageEvent =
            typeof event.assistantMessageEvent === "object" && event.assistantMessageEvent
              ? (event.assistantMessageEvent as Record<string, unknown>)
              : null;
          if (!assistantMessageEvent || assistantMessageEvent.type !== "text_delta") {
            return;
          }

          const partialMessage =
            event.message ??
            (typeof assistantMessageEvent.partial === "object"
              ? assistantMessageEvent.partial
              : undefined);
          const snapshot = buildPiMonoRealtimeMessageSnapshot(handle, partialMessage);
          const messageId =
            typeof snapshot?.info.id === "string" && snapshot.info.id.length > 0
              ? snapshot.info.id
              : null;
          const delta =
            typeof assistantMessageEvent.delta === "string" &&
            assistantMessageEvent.delta.length > 0
              ? assistantMessageEvent.delta
              : null;

          if (!messageId || !delta) {
            return;
          }

          await ingestPiMonoRealtimeEvent("message.part.updated", {
            sessionId: handle.sessionId,
            delta,
            part: {
              type: "text",
              messageID: messageId,
              text: delta,
            },
          });
          return;
        }
        case "tool_execution_start": {
          await ingestPiMonoRealtimeEvent("tool.execute.before", {
            sessionId: handle.sessionId,
            toolCallId: event.toolCallId,
            callID: event.toolCallId,
            toolName: event.toolName,
            input: event.args,
            arguments: event.args,
          });
          return;
        }
        case "tool_execution_end": {
          const errorText = event.isError
            ? (stringifyPiMonoValue(event.result) ?? "tool failed")
            : undefined;
          await ingestPiMonoRealtimeEvent("tool.execute.after", {
            sessionId: handle.sessionId,
            toolCallId: event.toolCallId,
            callID: event.toolCallId,
            toolName: event.toolName,
            input: event.args,
            arguments: event.args,
            result: stringifyPiMonoValue(event.result),
            error: errorText,
          });
          return;
        }
        case "agent_end": {
          const messages = Array.isArray(event.messages) ? event.messages : [];
          if (messages.length > 0) {
            handle.cachedMessages = messages;
          }

          const lastAssistant = [...messages]
            .reverse()
            .find((message) => readPiMonoMessageRole(message) === "assistant");
          const completedAt = readPiMonoMessageTimestamp(lastAssistant) ?? new Date().toISOString();
          const failure = extractPiMonoFailure(lastAssistant);
          handle.lastCompletedAt = String(completedAt);
          clearPiMonoPermissionsForHandle(handle);

          if (handle.stopRequested || handle.status === "stopped") {
            handle.stopRequested = false;
            handle.pauseRequested = false;
            handle.status = "stopped";
            await emitPiMonoSessionStatus(handle, "stopped", { completedAt });
            return;
          }

          if (handle.pauseRequested || handle.status === "paused") {
            handle.pauseRequested = false;
            handle.status = "paused";
            await emitPiMonoSessionStatus(handle, "paused", {
              completedAt,
              info: {
                type: "paused",
              },
            });
            return;
          }

          handle.pauseRequested = false;

          if (failure) {
            handle.status = "failed";
            handle.lastError = failure.errorMessage;
            const errorInfo = buildPiMonoSessionInfo(
              handle.sessionId,
              "error",
              handle.createdAt,
              completedAt,
            );
            if (handle.taskId && handle.projectId) {
              await ingestPiMonoRealtimeEvent("session.status", {
                sessionId: handle.sessionId,
                info: errorInfo,
                error: { message: failure.errorMessage },
              });
              await ingestPiMonoRealtimeEvent("session.error", {
                sessionId: handle.sessionId,
                info: errorInfo,
                error: { message: failure.errorMessage },
              });
            }
            return;
          }

          handle.status = "idle";
          handle.lastError = undefined;

          if (!handle.taskId || !handle.projectId) {
            return;
          }

          await ingestPiMonoRealtimeEvent("session.updated", {
            sessionId: handle.sessionId,
            info: buildPiMonoSessionInfo(
              handle.sessionId,
              "completed",
              handle.createdAt,
              completedAt,
            ),
          });
          await ingestPiMonoRealtimeEvent("session.status", {
            sessionId: handle.sessionId,
            info: buildPiMonoSessionInfo(
              handle.sessionId,
              "completed",
              handle.createdAt,
              completedAt,
            ),
          });
          await ingestPiMonoRealtimeEvent("session.idle", {
            sessionId: handle.sessionId,
            info: buildPiMonoSessionInfo(handle.sessionId, "idle", handle.createdAt, completedAt),
          });
          return;
        }
        default:
          return;
      }
    })
    .catch((error) => {
      console.error(`Failed to bridge pi-mono realtime event ${event.type}:`, error);
    });
}

async function emitPiMonoSessionCreated(handle: PiMonoRuntimeHandle) {
  if (!handle.taskId || !handle.projectId) {
    return;
  }

  await ingestPiMonoRealtimeEvent("session.created", {
    sessionId: handle.sessionId,
    info: {
      ...buildPiMonoSessionInfo(handle.sessionId, "created", handle.createdAt),
      title: handle.title,
    },
  });
}

async function createPiMonoRuntimeHandle(args: {
  title: string;
  taskId?: string;
  projectId?: string;
  model?: RuntimeModelRef;
  candidateIndex?: number;
}) {
  const client = await startPiMonoClient({
    model: args.model,
    title: args.title,
  });

  try {
    const state = await client.getState();
    const sessionId = state.sessionId?.trim();
    if (!sessionId) {
      throw new Error("No sessionId returned from pi-mono RPC state");
    }

    const handle: PiMonoRuntimeHandle = {
      agentRunId: sessionId,
      sessionId,
      sessionFile: state.sessionFile,
      title: args.title,
      taskId: args.taskId,
      projectId: args.projectId,
      createdAt: new Date().toISOString(),
      model: args.model,
      candidateIndex: args.candidateIndex,
      client,
      eventChain: Promise.resolve(),
      status: state.isStreaming ? "running" : "idle",
      pendingGuidance: [],
      cachedMessages: [],
    };
    bindPiMonoClient(handle, client);
    registerPiMonoHandle(handle);
    return handle;
  } catch (error) {
    await client.stop();
    throw error;
  }
}

async function createPiMonoForkRuntimeHandle(parent: PiMonoRuntimeHandle, title?: string) {
  if (!parent.sessionFile) {
    throw new Error(`Cannot fork pi-mono session without session file: ${parent.sessionId}`);
  }

  const client = await startPiMonoClient();

  try {
    const forkResult = await client.newSession(parent.sessionFile);
    if (forkResult.cancelled) {
      throw new Error(`pi-mono session fork cancelled for ${parent.sessionId}`);
    }
    if (parent.model) {
      await client.setModel(parent.model.providerId, parent.model.modelId);
    }
    const nextTitle = title?.trim() || `${parent.title} (fork)`;
    if (nextTitle) {
      await client.setSessionName(nextTitle);
    }

    const state = await client.getState();
    const sessionId = state.sessionId?.trim();
    if (!sessionId) {
      throw new Error(`No sessionId returned from pi-mono fork of ${parent.sessionId}`);
    }

    const handle: PiMonoRuntimeHandle = {
      agentRunId: sessionId,
      sessionId,
      sessionFile: state.sessionFile,
      title: nextTitle,
      taskId: parent.taskId,
      projectId: parent.projectId,
      createdAt: new Date().toISOString(),
      model: parent.model,
      candidateIndex: parent.candidateIndex,
      client,
      eventChain: Promise.resolve(),
      status: state.isStreaming ? "running" : "idle",
      pendingGuidance: [],
      cachedMessages: [],
    };
    bindPiMonoClient(handle, client);
    registerPiMonoHandle(handle);
    return handle;
  } catch (error) {
    await client.stop().catch(() => undefined);
    throw error;
  }
}

async function recoverPiMonoHandle(handle: PiMonoRuntimeHandle, action: string) {
  if (handle.recovering) {
    await handle.recovering;
    return;
  }

  if (!handle.sessionFile) {
    throw new Error(`Cannot recover pi-mono session ${handle.sessionId}: missing session file`);
  }

  const sessionFile = handle.sessionFile;

  handle.recovering = (async () => {
    const client = await startPiMonoClient();

    try {
      const switchResult = await client.switchSession(sessionFile);
      if (switchResult.cancelled) {
        throw new Error(`pi-mono session recovery cancelled while ${action}`);
      }
      if (handle.model) {
        await client.setModel(handle.model.providerId, handle.model.modelId);
      }
      if (handle.title.trim()) {
        await client.setSessionName(handle.title.trim());
      }

      const state = await client.getState();
      handle.sessionFile = state.sessionFile ?? handle.sessionFile;
      handle.cachedMessages = await client.getMessages().catch(() => handle.cachedMessages);
      bindPiMonoClient(handle, client);
      if (handle.status === "failed") {
        handle.status = "paused";
      }
      handle.lastError = undefined;
    } catch (error) {
      await client.stop().catch(() => undefined);
      throw error;
    }
  })().finally(() => {
    handle.recovering = undefined;
  });

  await handle.recovering;
}

async function ensurePiMonoHandleOperational(handle: PiMonoRuntimeHandle, action: string) {
  if (handle.disposed) {
    throw new Error(`pi-mono runtime session already disposed: ${handle.sessionId}`);
  }

  if (handle.client.isStarted()) {
    return handle;
  }

  try {
    await recoverPiMonoHandle(handle, action);
    return handle;
  } catch (error) {
    handle.status = "failed";
    handle.lastError = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to recover pi-mono runtime session ${handle.sessionId} while ${action}: ${handle.lastError}`,
    );
  }
}

async function ensurePiMonoHandle(
  sessionOrAgentRunId: string,
  options?: { action?: string; recover?: boolean },
) {
  const handle = resolvePiMonoHandle(sessionOrAgentRunId);
  if (!handle) {
    throw new Error(`pi-mono runtime session not found: ${sessionOrAgentRunId}`);
  }

  if (options?.recover !== false) {
    await ensurePiMonoHandleOperational(handle, options?.action ?? "operate pi-mono session");
  }

  return handle;
}

async function readPiMonoMessages(handle: PiMonoRuntimeHandle) {
  try {
    await ensurePiMonoHandleOperational(handle, "read session messages");
    const messages = await handle.client.getMessages();
    handle.cachedMessages = messages;
    return messages;
  } catch (error) {
    if (handle.cachedMessages.length > 0) {
      return handle.cachedMessages;
    }
    throw error;
  }
}

async function getPiMonoSessionMessages(
  sessionId: string,
  _options?: RuntimeGetSessionMessagesOptions,
) {
  const handle = await ensurePiMonoHandle(sessionId, { action: "load session messages" });
  const messages = await readPiMonoMessages(handle);
  return normalizePiMonoMessages(handle.sessionId, messages);
}

function queuePiMonoGuidance(
  handle: PiMonoRuntimeHandle,
  content: string,
  mode: "reply" | "noReply",
) {
  handle.pendingGuidance.push({
    content,
    injectedAt: new Date().toISOString(),
    mode,
  });
}

function consumePiMonoGuidance(handle: PiMonoRuntimeHandle) {
  const queued = [...handle.pendingGuidance];
  handle.pendingGuidance = [];
  return queued;
}

function buildPiMonoResumePrompt(handle: PiMonoRuntimeHandle) {
  const guidanceBlocks = consumePiMonoGuidance(handle);
  const sections: string[] = [];

  if (handle.lastError) {
    sections.push(
      [
        "The previous pi-mono runtime process exited unexpectedly and the session was restored.",
        "Resume from the current session context instead of restarting from scratch.",
      ].join(" "),
    );
  }

  if (guidanceBlocks.length > 0) {
    sections.push(
      guidanceBlocks
        .map((guidance, index) => `Guidance ${index + 1}:\n${guidance.content}`)
        .join("\n\n"),
    );
  }

  sections.push(
    "Resume execution. Apply any guidance provided above and continue your current task.",
  );

  return sections.join("\n\n");
}

function buildPiMonoPermissionResponse(
  request: PiMonoPendingPermission,
  input: { reply: RuntimePermissionReply; message?: string },
): PiMonoRpcExtensionUiResponse {
  switch (request.method) {
    case "confirm":
      return {
        type: "extension_ui_response",
        id: request.id,
        confirmed: input.reply !== "reject",
      };
    case "editor":
    case "input":
      if (input.reply === "reject") {
        return { type: "extension_ui_response", id: request.id, cancelled: true };
      }
      return {
        type: "extension_ui_response",
        id: request.id,
        value: input.message ?? request.prefill ?? "",
      };
    case "select": {
      if (input.reply === "reject") {
        return { type: "extension_ui_response", id: request.id, cancelled: true };
      }
      const requestedValue = input.message?.trim();
      const value =
        requestedValue && request.options?.includes(requestedValue)
          ? requestedValue
          : (request.options?.[0] ?? "");
      return {
        type: "extension_ui_response",
        id: request.id,
        value,
      };
    }
  }
}

async function continuePiMonoSession(
  sessionId: string,
  prompt: string,
  options?: RuntimeContinueSessionOptions,
) {
  const handle = await ensurePiMonoHandle(sessionId, { action: "continue session" });
  if (handle.pauseRequested) {
    await ensurePiMonoPauseSettled(handle, "continuing session");
  }

  if (options?.model) {
    await handle.client.setModel(options.model.providerId, options.model.modelId);
    handle.model = options.model;
  }

  if (handle.taskId && handle.projectId) {
    const agentRunId = ensureAgentRunForSession(
      handle.sessionId,
      handle.taskId,
      handle.projectId,
      handle.model,
      handle.agentRunId,
    );
    setPiMonoHandleAgentRunId(handle, agentRunId);
  }

  const wasRunning = handle.status === "running";
  handle.status = "running";
  if (wasRunning) {
    await handle.client.followUp(prompt);
    return;
  }

  await handle.client.prompt(prompt);
}

const backend: RuntimeBackend = "pi-mono";

export const piMonoRuntimeProvider: RuntimeProvider = {
  backend,
  async createSession(taskId, projectId, prompt, options) {
    try {
      const handle = await createPiMonoRuntimeHandle({
        title: createPiMonoTitle(taskId, prompt),
        taskId,
        projectId,
        model: options?.model,
        candidateIndex: options?.candidateIndex,
      });
      const agentRunId = ensureAgentRunForSession(
        handle.sessionId,
        taskId,
        projectId,
        handle.model,
        handle.agentRunId,
      );
      setPiMonoHandleAgentRunId(handle, agentRunId);
      await emitPiMonoSessionCreated(handle);
      await handle.client.prompt(prompt);
      return {
        ok: true,
        sessionId: handle.sessionId,
        agentRunId: handle.agentRunId,
        data: {
          sessionFile: handle.sessionFile,
          backend,
        },
      } satisfies RuntimeCreateSessionResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeCreateSessionResult;
    }
  },
  async pauseAgent(agentRunId) {
    try {
      const handle = await ensurePiMonoHandle(agentRunId, { action: "pause agent" });
      if (handle.status !== "running") {
        return {
          ok: false,
          error: `Cannot pause: status is ${handle.status}`,
        } satisfies RuntimeResult;
      }

      handle.pauseRequested = true;
      handle.status = "paused";
      updateAgentRunStatus(handle.agentRunId, "paused");
      await handle.client.abort();
      try {
        await handle.client.waitForIdle(readPiMonoPauseSettlementTimeoutMs());
      } catch {
        // The abort response is sufficient; the runtime may settle shortly afterwards.
      }
      await ensurePiMonoPauseSettled(handle, "pausing agent");
      return { ok: true } satisfies RuntimeResult;
    } catch (error) {
      const handle = resolvePiMonoHandle(agentRunId);
      if (handle) {
        handle.pauseRequested = false;
        if (handle.status !== "stopped") {
          handle.status = "running";
          updateAgentRunStatus(handle.agentRunId, "running");
        }
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async injectGuidance(agentRunId, content, mode = "reply") {
    try {
      const handle = await ensurePiMonoHandle(agentRunId, { action: "inject guidance" });

      if (handle.status === "running" && mode === "reply") {
        await handle.client.steer(content);
        return { ok: true } satisfies RuntimeResult;
      }

      if (handle.status !== "paused" && handle.status !== "idle" && handle.status !== "running") {
        return {
          ok: false,
          error: `Cannot inject guidance: status is ${handle.status}`,
        } satisfies RuntimeResult;
      }

      queuePiMonoGuidance(handle, content, mode);
      return {
        ok: true,
        data: {
          pendingGuidanceCount: handle.pendingGuidance.length,
          queued: true,
        },
      } satisfies RuntimeResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async resumeAgent(agentRunId) {
    try {
      const handle = await ensurePiMonoHandle(agentRunId, { action: "resume agent" });
      if (handle.status !== "paused") {
        return {
          ok: false,
          error: `Cannot resume: status is ${handle.status}`,
        } satisfies RuntimeResult;
      }

      if (handle.pauseRequested) {
        await ensurePiMonoPauseSettled(handle, "resuming agent");
      }

      const queuedGuidance = [...handle.pendingGuidance];
      const resumePrompt = buildPiMonoResumePrompt(handle);
      handle.pauseRequested = false;
      handle.stopRequested = false;
      handle.status = "running";
      updateAgentRunStatus(handle.agentRunId, "running");

      try {
        await handle.client.prompt(resumePrompt);
        handle.lastError = undefined;
        return { ok: true } satisfies RuntimeResult;
      } catch (error) {
        handle.status = "paused";
        handle.pendingGuidance = queuedGuidance;
        updateAgentRunStatus(handle.agentRunId, "paused");
        throw error;
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async terminateAgent(agentRunId) {
    try {
      const handle = await ensurePiMonoHandle(agentRunId, {
        action: "terminate agent",
        recover: false,
      });
      handle.stopRequested = true;
      handle.pauseRequested = false;
      handle.status = "stopped";
      updateAgentRunStatus(handle.agentRunId, "stopped");
      try {
        if (handle.client.isStarted()) {
          await handle.client.abort();
        }
      } catch {
        // Best-effort abort before shutdown.
      }
      await disposePiMonoHandle(handle);
      return { ok: true } satisfies RuntimeResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async getAgentMessages(agentRunId) {
    try {
      const handle = await ensurePiMonoHandle(agentRunId, { action: "load agent messages" });
      const data = await getPiMonoSessionMessages(handle.sessionId);
      return { ok: true, data } satisfies RuntimeResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async getSessionMessages(sessionId, options) {
    try {
      const data = await getPiMonoSessionMessages(sessionId, options);
      return { ok: true, data } satisfies RuntimeResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async listSessions(limit = 20) {
    const data = uniquePiMonoHandles()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(buildPiMonoSessionSummary);
    return { ok: true, data } satisfies RuntimeResult;
  },
  async listRuntimePermissions() {
    const data = Array.from(piMonoRuntimePermissions.values())
      .sort((left, right) => left.request.createdAt.localeCompare(right.request.createdAt))
      .map(({ request }) => ({
        id: request.id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
      }));
    return { ok: true, data } satisfies RuntimeResult;
  },
  async replyRuntimePermission(requestId, input) {
    const pending = piMonoRuntimePermissions.get(requestId);
    if (!pending) {
      return {
        ok: false,
        error: `pi-mono runtime permission request not found: ${requestId}`,
      } satisfies RuntimeResult;
    }

    try {
      const handle = await ensurePiMonoHandleOperational(
        pending.handle,
        "reply to runtime permission",
      );
      const response = buildPiMonoPermissionResponse(pending.request, input);
      await handle.client.respondToExtensionUiRequest(response);
      piMonoRuntimePermissions.delete(requestId);
      handle.status = "running";
      updateAgentRunStatus(handle.agentRunId, "running");
      await emitPiMonoSessionStatus(handle, "running", {
        info: {
          metadata: {
            reply: input.reply,
            requestId,
            source: "pi-mono-extension-ui",
          },
          type: "running",
        },
      });
      return { ok: true, data: true } satisfies RuntimeResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
  async forkSession(sessionId, options) {
    try {
      const parent = await ensurePiMonoHandle(sessionId, { action: "fork session" });
      const handle = await createPiMonoForkRuntimeHandle(parent, options?.title);
      return {
        ok: true,
        sessionId: handle.sessionId,
        data: {
          backend,
          parentSessionId: parent.sessionId,
          sessionFile: handle.sessionFile,
        },
      } satisfies RuntimeForkSessionResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeForkSessionResult;
    }
  },
  async runDetachedPrompt(title, prompt, options) {
    let handle: PiMonoRuntimeHandle | undefined;

    try {
      handle = await createPiMonoRuntimeHandle({
        title,
        model: options?.model,
      });
      const idle = handle.client.waitForIdle(options?.timeoutMs ?? 15_000);
      await handle.client.prompt(prompt);
      await idle;
      const messages = await readPiMonoMessages(handle);
      const text = (await handle.client.getLastAssistantText()) ?? undefined;
      return {
        ok: true,
        sessionId: handle.sessionId,
        text,
        completed: Boolean(text),
        tokenUsed: sumPiMonoAssistantTokenUsage(messages),
        model: options?.model,
      } satisfies RuntimeDetachedPromptResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeDetachedPromptResult;
    } finally {
      if (handle) {
        await disposePiMonoHandle(handle);
      }
    }
  },
  async continueSession(sessionId, prompt, options) {
    try {
      await continuePiMonoSession(sessionId, prompt, options);
      return { ok: true } satisfies RuntimeResult;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RuntimeResult;
    }
  },
};

export async function __shutdownPiMonoRuntimeForTests() {
  const handles = uniquePiMonoHandles();
  for (const handle of handles) {
    await disposePiMonoHandle(handle);
  }
  piMonoRuntimePermissions.clear();
}
