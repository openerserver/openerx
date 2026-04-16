import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getContinueLatencyLogFilePath,
  markContinueLatencyStage,
  noteContinueLatencyRuntimeEvent,
  noteContinueLatencyStateSnapshot,
  shouldTraceContinueLatency,
} from "./continue-latency-tracer";
import {
  ensureAgentRunForSession,
  findAgentRunBySessionId,
  getAgentRun,
  updateAgentRunStatus,
} from "./agent-run-registry";
import {
  PiMonoRpcClient,
  type PiMonoRpcConfig,
  type PiMonoRpcEvent,
  type PiMonoRpcExtensionUiRequest,
  type PiMonoRpcExtensionUiResponse,
  type PiMonoRpcState,
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
  activeAssistantMessageId?: string;
  assistantMessageIdAliases: Map<string, string>;
  approvedExternalDirectories: Set<string>;
  approvedCommands: Set<string>;
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

type OpenerXPiMonoGovernancePermissionPayload = {
  permission?: string;
  filepath?: string;
  parentDir?: string;
  patterns?: string[];
  command?: string;
  toolName?: string;
  toolCallId?: string;
};

type PiMonoRpcLocation = {
  cwd: string;
  cliPath: string;
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
const DEFAULT_PI_MONO_RPC_COMMAND = "bun";
const DEFAULT_PI_MONO_RPC_LOCATION_CANDIDATES: PiMonoRpcLocation[] = [
  {
    cwd: fileURLToPath(new URL("../../../../../pi-mono/", import.meta.url)),
    cliPath: "packages/coding-agent/src/cli.ts",
  },
  {
    cwd: resolve(process.cwd(), "pi-mono"),
    cliPath: "packages/coding-agent/src/cli.ts",
  },
  {
    cwd: resolve(process.cwd(), "../../pi-mono"),
    cliPath: "packages/coding-agent/src/cli.ts",
  },
  {
    cwd: fileURLToPath(new URL("../../../../../pi-mono/packages/coding-agent/", import.meta.url)),
    cliPath: "src/cli.ts",
  },
  {
    cwd: resolve(process.cwd(), "pi-mono/packages/coding-agent"),
    cliPath: "src/cli.ts",
  },
  {
    cwd: resolve(process.cwd(), "../../pi-mono/packages/coding-agent"),
    cliPath: "src/cli.ts",
  },
].filter(
  (candidate, index, candidates) =>
    candidates.findIndex(
      (entry) => resolve(entry.cwd) === resolve(candidate.cwd) && entry.cliPath === candidate.cliPath,
    ) === index,
);
const OPENERX_PI_MONO_PERMISSION_PREFIX = "openerx-permission:";
const DEFAULT_PI_MONO_GOVERNANCE_EXTENSION_CANDIDATES = Array.from(
  new Set([
    fileURLToPath(new URL("./pimono-governance-extension.ts", import.meta.url)),
    fileURLToPath(new URL("./pimono-governance-extension.js", import.meta.url)),
  ]),
);
const DEFAULT_PI_MONO_ALLOWED_ROOTS = Array.from(
  new Set([
    fileURLToPath(new URL("../../../../../", import.meta.url)),
    process.cwd(),
  ]),
);

function readDefaultPiMonoRpcLocation(): PiMonoRpcLocation {
  return (
    DEFAULT_PI_MONO_RPC_LOCATION_CANDIDATES.find((candidate) =>
      existsSync(resolve(candidate.cwd, candidate.cliPath)),
    ) || DEFAULT_PI_MONO_RPC_LOCATION_CANDIDATES[0]!
  );
}

function readDefaultPiMonoCliPath(cwd: string) {
  const normalizedCwd = resolve(cwd);
  const matchedCandidate = DEFAULT_PI_MONO_RPC_LOCATION_CANDIDATES.find(
    (candidate) =>
      resolve(candidate.cwd) === normalizedCwd && existsSync(resolve(candidate.cwd, candidate.cliPath)),
  );

  if (matchedCandidate) {
    return matchedCandidate.cliPath;
  }

  const rootRelativeCliPath = "packages/coding-agent/src/cli.ts";
  if (existsSync(resolve(normalizedCwd, rootRelativeCliPath))) {
    return rootRelativeCliPath;
  }

  const packageRelativeCliPath = "src/cli.ts";
  if (existsSync(resolve(normalizedCwd, packageRelativeCliPath))) {
    return packageRelativeCliPath;
  }

  return readDefaultPiMonoRpcLocation().cliPath;
}

function buildDefaultPiMonoRpcArgs(cwd: string) {
  return ["run", "--bun", readDefaultPiMonoCliPath(cwd), "--mode", "rpc"];
}

function readDefaultPiMonoGovernanceExtensionPath() {
  return DEFAULT_PI_MONO_GOVERNANCE_EXTENSION_CANDIDATES.find((candidate) =>
    existsSync(candidate),
  );
}

function parsePiMonoStringArray(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) {
    return [] as string[];
  }

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return parsed.map((entry) => entry.trim()).filter(Boolean);
      }
    } catch {
      // Fall back to newline splitting below.
    }
  }

  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePiMonoCliArgs(args: string[], extensionPath: string | undefined) {
  const normalized = [...args];
  if (!extensionPath) {
    return normalized;
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    if ((value === "--extension" || value === "-e") && normalized[index + 1] === extensionPath) {
      return normalized;
    }
  }

  normalized.push("--extension", extensionPath);
  return normalized;
}

function readPiMonoAllowedRoots(rpcCwd: string) {
  return Array.from(
    new Set(
      [...DEFAULT_PI_MONO_ALLOWED_ROOTS, rpcCwd, ...parsePiMonoStringArray(process.env.OPENERX_PI_MONO_ALLOWED_ROOTS)].map(
        (entry) => resolve(entry),
      ),
    ),
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
  const defaultLocation = readDefaultPiMonoRpcLocation();
  const cwd = resolve(process.env.PI_MONO_RPC_CWD?.trim() || defaultLocation.cwd || ".");
  const parsedArgs = parsePiMonoArgs(process.env.PI_MONO_RPC_ARGS);
  const extensionPath = readDefaultPiMonoGovernanceExtensionPath();
  const continueLatencyLogFilePath = getContinueLatencyLogFilePath();
  return {
    command: process.env.PI_MONO_RPC_COMMAND?.trim() || DEFAULT_PI_MONO_RPC_COMMAND,
    args: normalizePiMonoCliArgs(
      parsedArgs.length > 0 ? parsedArgs : buildDefaultPiMonoRpcArgs(cwd),
      extensionPath,
    ),
    cwd,
    env: {
      OPENERX_PI_MONO_ALLOWED_ROOTS: JSON.stringify(readPiMonoAllowedRoots(cwd)),
      ...(continueLatencyLogFilePath
        ? { OPENERX_CONTINUE_LATENCY_LOG_FILE: continueLatencyLogFilePath }
        : {}),
    },
  };
}

function formatPiMonoRuntimeModelRoute(model?: RuntimeModelRef | null) {
  if (!model?.providerId) {
    return model?.modelId?.trim() || undefined;
  }

  const providerId = model.providerId.trim();
  const modelId = model.modelId.trim();
  if (!modelId) {
    return providerId;
  }
  if (modelId.startsWith(`${providerId}/`) || modelId.startsWith(`${providerId}:`)) {
    return modelId;
  }

  return `${providerId}:${modelId}`;
}

function formatPiMonoRpcStateModelRoute(model: PiMonoRpcState["model"]) {
  if (!model || typeof model !== "object") {
    return undefined;
  }

  const record = model as Record<string, unknown>;
  const providerId = typeof record.provider === "string" ? record.provider.trim() : "";
  const modelId =
    typeof record.id === "string"
      ? record.id.trim()
      : typeof record.modelId === "string"
        ? record.modelId.trim()
        : "";

  if (!providerId) {
    return modelId || undefined;
  }
  if (!modelId) {
    return providerId;
  }
  if (modelId.startsWith(`${providerId}/`) || modelId.startsWith(`${providerId}:`)) {
    return modelId;
  }

  return `${providerId}:${modelId}`;
}

function recordPiMonoContinueStateSnapshot(
  sessionId: string,
  stage: Parameters<typeof noteContinueLatencyStateSnapshot>[1],
  state: PiMonoRpcState,
  requestedModel?: RuntimeModelRef,
) {
  noteContinueLatencyStateSnapshot(sessionId, stage, {
    requestedModelRoute: formatPiMonoRuntimeModelRoute(requestedModel),
    modelRoute: formatPiMonoRpcStateModelRoute(state.model),
    thinkingLevel: state.thinkingLevel,
    followUpMode: state.followUpMode,
    sessionFile: state.sessionFile,
    messageCount: state.messageCount,
    pendingMessageCount: state.pendingMessageCount,
    isStreaming: state.isStreaming,
    autoCompactionEnabled: state.autoCompactionEnabled,
  });
}

async function capturePiMonoContinueStateSnapshot(
  sessionId: string,
  handle: PiMonoRuntimeHandle,
  stage: Parameters<typeof noteContinueLatencyStateSnapshot>[1],
  requestedModel?: RuntimeModelRef,
) {
  if (!shouldTraceContinueLatency()) {
    return;
  }

  try {
    const state = await handle.client.getState();
    recordPiMonoContinueStateSnapshot(sessionId, stage, state, requestedModel);
  } catch {
    // Best-effort diagnostics only.
  }
}

function expandPiMonoHomePath(path: string) {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith(`~${sep}`)) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

function readPiMonoAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (configured) {
    return resolve(expandPiMonoHomePath(configured));
  }

  return resolve(homedir(), ".pi", "agent");
}

function encodePiMonoSessionDirName(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function readPiMonoCandidateSessionDirs() {
  const sessionsRoot = join(readPiMonoAgentDir(), "sessions");
  const configuredCwd = readPiMonoRpcConfig().cwd;
  const candidateDirs = [
    configuredCwd ? join(sessionsRoot, encodePiMonoSessionDirName(resolve(configuredCwd))) : null,
    ...parsePiMonoStringArray(process.env.OPENERX_PI_MONO_SESSION_SEARCH_DIRS).map((entry) =>
      resolve(expandPiMonoHomePath(entry)),
    ),
  ];

  if (existsSync(sessionsRoot)) {
    try {
      const entries = readdirSync(sessionsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidateDirs.push(join(sessionsRoot, entry.name));
        }
      }
    } catch {
      // Ignore unreadable session roots and fall back to explicit candidate directories.
    }
  }

  return Array.from(
    new Set(
      candidateDirs
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .map((entry) => resolve(entry)),
    ),
  );
}

function findPiMonoSessionFileBySessionId(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return undefined;
  }

  const fileSuffix = `_${normalizedSessionId}.jsonl`;
  for (const dir of readPiMonoCandidateSessionDirs()) {
    if (!existsSync(dir)) {
      continue;
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(fileSuffix)) {
          return join(dir, entry.name);
        }
      }
    } catch {
      // Ignore unreadable per-cwd session directories and keep scanning.
    }
  }

  return undefined;
}

function resolveRecoveredPiMonoHandleStatus(
  isStreaming: boolean,
  runtimeStatus?: string,
): PiMonoRuntimeStatus {
  if (isStreaming) {
    return "running";
  }

  if (runtimeStatus === "paused") {
    return "paused";
  }

  if (runtimeStatus === "stopped") {
    return "stopped";
  }

  if (runtimeStatus === "failed") {
    return "failed";
  }

  return "idle";
}

function resolvePiMonoRecoveredRunContext(sessionOrAgentRunId: string) {
  return getAgentRun(sessionOrAgentRunId) ?? findAgentRunBySessionId(sessionOrAgentRunId);
}

async function recoverMissingPiMonoHandle(sessionOrAgentRunId: string) {
  const recoveredRun = resolvePiMonoRecoveredRunContext(sessionOrAgentRunId);
  const sessionId = recoveredRun?.subSessionId ?? sessionOrAgentRunId;
  const sessionFile = findPiMonoSessionFileBySessionId(sessionId);
  if (!sessionFile) {
    return undefined;
  }

  const client = await startPiMonoClient();

  try {
    const switchResult = await client.switchSession(sessionFile);
    if (switchResult.cancelled) {
      throw new Error(`pi-mono session recovery cancelled for ${sessionId}`);
    }

    const state = await client.getState();
    const resolvedSessionId = state.sessionId?.trim();
    if (!resolvedSessionId) {
      throw new Error(`No sessionId returned from recovered pi-mono session file ${sessionFile}`);
    }

    const createdAt =
      recoveredRun && Number.isFinite(recoveredRun.startedAt)
        ? new Date(recoveredRun.startedAt).toISOString()
        : new Date().toISOString();
    const title = state.sessionName?.trim() || `Recovered pi-mono session ${resolvedSessionId}`;

    const handle: PiMonoRuntimeHandle = {
      agentRunId: resolvedSessionId,
      sessionId: resolvedSessionId,
      sessionFile: state.sessionFile ?? sessionFile,
      title,
      taskId: recoveredRun?.taskId,
      projectId: recoveredRun?.projectId,
      createdAt,
      model: recoveredRun?.model,
      candidateIndex: recoveredRun?.candidateIndex,
      client,
      eventChain: Promise.resolve(),
      status: resolveRecoveredPiMonoHandleStatus(state.isStreaming, recoveredRun?.status),
      pendingGuidance: [],
      cachedMessages: [],
      assistantMessageIdAliases: new Map<string, string>(),
      approvedExternalDirectories: new Set<string>(),
      approvedCommands: new Set<string>(),
    };

    bindPiMonoClient(handle, client);
    handle.cachedMessages = await client.getMessages().catch(() => []);
    registerPiMonoHandle(handle);

    if (recoveredRun?.agentRunId) {
      setPiMonoHandleAgentRunId(handle, recoveredRun.agentRunId);
    }

    return handle;
  } catch (error) {
    await client.stop().catch(() => undefined);
    throw error;
  }
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

function parseOpenerXPiMonoGovernancePermissionPayload(message: string | undefined) {
  if (!message?.startsWith(OPENERX_PI_MONO_PERMISSION_PREFIX)) {
    return null;
  }

  try {
    const payload = JSON.parse(message.slice(OPENERX_PI_MONO_PERMISSION_PREFIX.length));
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    return {
      permission: typeof record.permission === "string" ? record.permission.trim() : undefined,
      filepath: typeof record.filepath === "string" ? record.filepath.trim() : undefined,
      parentDir: typeof record.parentDir === "string" ? record.parentDir.trim() : undefined,
      patterns: Array.isArray(record.patterns)
        ? record.patterns.filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
        : undefined,
      command: typeof record.command === "string" ? record.command.trim() : undefined,
      toolName: typeof record.toolName === "string" ? record.toolName.trim() : undefined,
      toolCallId: typeof record.toolCallId === "string" ? record.toolCallId.trim() : undefined,
    } satisfies OpenerXPiMonoGovernancePermissionPayload;
  } catch {
    return null;
  }
}

function normalizePiMonoApprovalDirectory(input: string | undefined) {
  if (!input?.trim()) {
    return undefined;
  }
  return resolve(input.trim());
}

function normalizePiMonoApprovedCommand(input: string | undefined) {
  const value = input?.trim();
  return value ? value : undefined;
}

function isWithinPiMonoApprovedDirectory(pathname: string, approvedDirectory: string) {
  return pathname === approvedDirectory || pathname.startsWith(`${approvedDirectory}${sep}`);
}

function readPiMonoPermissionMetadata(
  request: PiMonoRpcExtensionUiRequest,
  payload: OpenerXPiMonoGovernancePermissionPayload | null,
) {
  return {
    source: "pi-mono-extension-ui",
    method: request.method,
    title: "title" in request ? request.title : undefined,
    message: payload ? undefined : readPiMonoUiRequestMessage(request),
    options: readPiMonoUiRequestOptions(request),
    prefill: readPiMonoUiRequestPrefill(request),
    permission: payload?.permission,
    filepath: payload?.filepath,
    parentDir: payload?.parentDir,
    command: payload?.command,
    toolName: payload?.toolName,
    toolCallId: payload?.toolCallId,
  } satisfies Record<string, unknown>;
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

  const governancePayload = parseOpenerXPiMonoGovernancePermissionPayload(
    readPiMonoUiRequestMessage(request),
  );

  const pendingRequest: PiMonoPendingPermission = {
    id: request.id,
    sessionID: handle.sessionId,
    permission: governancePayload?.permission || buildPiMonoPermissionName(request.method),
    patterns: governancePayload?.patterns ?? readPiMonoUiRequestOptions(request) ?? [],
    metadata: readPiMonoPermissionMetadata(request, governancePayload),
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

async function maybeAutoApprovePiMonoPermissionRequest(
  handle: PiMonoRuntimeHandle,
  request: PiMonoPendingPermission,
) {
  const metadata =
    request.metadata && typeof request.metadata === "object"
      ? (request.metadata as Record<string, unknown>)
      : undefined;

  if (request.permission === "external_directory") {
    const filepath = normalizePiMonoApprovalDirectory(
      typeof metadata?.filepath === "string" ? metadata.filepath : undefined,
    );
    const parentDir =
      normalizePiMonoApprovalDirectory(
        typeof metadata?.parentDir === "string" ? metadata.parentDir : undefined,
      ) ?? (filepath ? dirname(filepath) : undefined);

    if (
      parentDir &&
      Array.from(handle.approvedExternalDirectories).some((approvedDirectory) =>
        isWithinPiMonoApprovedDirectory(parentDir, approvedDirectory),
      )
    ) {
      await handle.client.respondToExtensionUiRequest(
        buildPiMonoPermissionResponse(request, { reply: "once" }),
      );
      piMonoRuntimePermissions.delete(request.id);
      return true;
    }
  }

  if (request.permission === "command_execution") {
    const command = normalizePiMonoApprovedCommand(
      typeof metadata?.command === "string" ? metadata.command : undefined,
    );
    if (command && handle.approvedCommands.has(command)) {
      await handle.client.respondToExtensionUiRequest(
        buildPiMonoPermissionResponse(request, { reply: "once" }),
      );
      piMonoRuntimePermissions.delete(request.id);
      return true;
    }
  }

  return false;
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

  // Serialize through event chain so pending agent_end events process first
  handle.eventChain = handle.eventChain.then(async () => {
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

    // If agent_end already moved status to idle/completed/failed, do not override
    if (handle.status === "idle" || handle.status === "failed") {
      return;
    }

    if (handle.status === "running") {
      handle.status = "paused";
      updateAgentRunStatus(handle.agentRunId, "paused");
      await emitPiMonoSessionStatus(handle, "paused", {
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
  });
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

function resolvePiMonoCanonicalAssistantMessageId(args: {
  sessionId: string;
  responseId?: string;
  timestamp?: number;
  assistantMessageIdAliases?: Map<string, string>;
}) {
  const timestampId =
    typeof args.timestamp === "number"
      ? `${args.sessionId}:assistant:${args.timestamp}`
      : undefined;
  const responseIdKey = args.responseId
    ? `${args.sessionId}:assistant:${args.responseId}`
    : undefined;
  const aliases = args.assistantMessageIdAliases;

  if (!aliases) {
    return timestampId ?? responseIdKey;
  }

  const canonicalId =
    (timestampId ? aliases.get(timestampId) : undefined) ??
    (responseIdKey ? aliases.get(responseIdKey) : undefined) ??
    timestampId ??
    responseIdKey;

  if (!canonicalId) {
    return undefined;
  }

  if (timestampId) {
    aliases.set(timestampId, canonicalId);
  }
  if (responseIdKey) {
    aliases.set(responseIdKey, canonicalId);
  }

  return canonicalId;
}

function normalizePiMonoMessage(
  sessionId: string,
  message: unknown,
  index: number,
  assistantMessageIdAliases?: Map<string, string>,
  messageId = getPiMonoNormalizedMessageIdWithAliases(
    sessionId,
    message,
    index,
    assistantMessageIdAliases,
  ),
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

function getPiMonoNormalizedMessageIdWithAliases(
  sessionId: string,
  message: unknown,
  index: number,
  assistantMessageIdAliases?: Map<string, string>,
) {
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
    const assistantMessageId = resolvePiMonoCanonicalAssistantMessageId({
      sessionId,
      responseId,
      timestamp,
      assistantMessageIdAliases,
    });
    if (assistantMessageId) {
      return assistantMessageId;
    }
  }

  return getPiMonoNormalizedMessageId(sessionId, message, index);
}

function normalizePiMonoMessages(
  sessionId: string,
  messages: unknown[],
  assistantMessageIdAliases?: Map<string, string>,
) {
  const messageIds = messages.map((message, index) =>
    getPiMonoNormalizedMessageIdWithAliases(
      sessionId,
      message,
      index,
      assistantMessageIdAliases,
    ),
  );
  let previousAssistantMessageId: string | undefined;

  return messages
    .map((message, index) => {
      const normalized = normalizePiMonoMessage(
        sessionId,
        message,
        index,
        assistantMessageIdAliases,
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

function readPiMonoMessageResponseId(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  return typeof record.responseId === "string" && record.responseId.trim().length > 0
    ? record.responseId.trim()
    : undefined;
}

function bindPiMonoAssistantMessageAliases(
  handle: PiMonoRuntimeHandle,
  message: unknown,
  canonicalId: string,
) {
  const timestamp = readPiMonoMessageTimestamp(message);
  if (typeof timestamp === "number") {
    handle.assistantMessageIdAliases.set(`${handle.sessionId}:assistant:${timestamp}`, canonicalId);
  }

  const responseId = readPiMonoMessageResponseId(message);
  if (responseId) {
    handle.assistantMessageIdAliases.set(`${handle.sessionId}:assistant:${responseId}`, canonicalId);
  }
}

function readPiMonoNormalizedMessageId(message: {
  info: Record<string, unknown>;
  parts: Array<Record<string, unknown>>;
} | null) {
  const id = message?.info?.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : undefined;
}

function overwritePiMonoNormalizedMessageId(
  message: {
    info: Record<string, unknown>;
    parts: Array<Record<string, unknown>>;
  } | null,
  messageId: string,
) {
  if (!message) {
    return message;
  }

  return {
    ...message,
    info: {
      ...message.info,
      id: messageId,
    },
  };
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

    return normalizePiMonoMessage(
      handle.sessionId,
      message,
      index,
      handle.assistantMessageIdAliases,
    );
  }

  return null;
}

function buildPiMonoRealtimeMessageSnapshot(handle: PiMonoRuntimeHandle, message: unknown) {
  const normalized = normalizePiMonoMessage(
    handle.sessionId,
    message,
    -1,
    handle.assistantMessageIdAliases,
  );

  if (!normalized || normalized.info.role !== "assistant") {
    return normalized;
  }

  const time =
    typeof normalized.info.time === "object" && normalized.info.time
      ? { ...(normalized.info.time as Record<string, unknown>) }
      : null;

  if (!time) {
    return normalized;
  }

  delete time.completed;
  return {
    ...normalized,
    info: {
      ...normalized.info,
      time,
    },
  };
}

function readPiMonoRuntimeEventRole(
  event: PiMonoRpcEvent,
  assistantMessageEvent?: Record<string, unknown> | null,
) {
  switch (event.type) {
    case "message_start":
    case "message_end":
      return readPiMonoMessageRole(event.message);
    case "message_update": {
      const partialMessage =
        event.message ??
        (typeof assistantMessageEvent?.partial === "object" ? assistantMessageEvent.partial : undefined);
      return readPiMonoMessageRole(partialMessage);
    }
    default:
      return null;
  }
}

function queuePiMonoRealtimeBridge(handle: PiMonoRuntimeHandle, event: PiMonoRpcEvent) {
  handle.eventChain = handle.eventChain
    .then(async () => {
      const assistantMessageEvent =
        event.type === "message_update" &&
        typeof event.assistantMessageEvent === "object" &&
        event.assistantMessageEvent
          ? (event.assistantMessageEvent as Record<string, unknown>)
          : null;
      noteContinueLatencyRuntimeEvent(handle.sessionId, event.type, {
        role: readPiMonoRuntimeEventRole(event, assistantMessageEvent) ?? undefined,
        assistantMessageType:
          typeof assistantMessageEvent?.type === "string" ? assistantMessageEvent.type : undefined,
      });

      switch (event.type) {
        case "agent_start": {
          handle.status = "running";
          handle.lastError = undefined;
          await emitPiMonoSessionStatus(handle, "running");
          return;
        }
        case "message_end": {
          const role = readPiMonoMessageRole(event.message);
          if (role === "assistant" && handle.activeAssistantMessageId) {
            bindPiMonoAssistantMessageAliases(handle, event.message, handle.activeAssistantMessageId);
          }
          const message = await loadLatestPiMonoNormalizedMessage(handle, role);
          if (!message) {
            return;
          }

          const emittedMessage =
            role === "assistant" && handle.activeAssistantMessageId
              ? overwritePiMonoNormalizedMessageId(message, handle.activeAssistantMessageId)
              : message;

          await ingestPiMonoRealtimeEvent("message.updated", {
            sessionId: handle.sessionId,
            ...emittedMessage,
          });

          if (role === "assistant") {
            handle.activeAssistantMessageId = undefined;
          }
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

          if (await maybeAutoApprovePiMonoPermissionRequest(handle, permission)) {
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

          const messageId = readPiMonoNormalizedMessageId(message);
          if (messageId) {
            handle.activeAssistantMessageId = messageId;
            bindPiMonoAssistantMessageAliases(handle, event.message, messageId);
          }

          await ingestPiMonoRealtimeEvent("message.updated", {
            sessionId: handle.sessionId,
            ...message,
          });
          return;
        }
        case "message_update": {
          const assistantMessageType =
            typeof assistantMessageEvent?.type === "string" ? assistantMessageEvent.type : undefined;
          const partType =
            assistantMessageType === "text_delta"
              ? "text"
              : assistantMessageType === "thinking_delta"
                ? "thinking"
                : null;
          if (!assistantMessageEvent || !partType) {
            return;
          }

          const partialMessage =
            event.message ??
            (typeof assistantMessageEvent.partial === "object"
              ? assistantMessageEvent.partial
              : undefined);
          if (handle.activeAssistantMessageId && partialMessage) {
            bindPiMonoAssistantMessageAliases(handle, partialMessage, handle.activeAssistantMessageId);
          }
          const snapshot = buildPiMonoRealtimeMessageSnapshot(handle, partialMessage);
          const canonicalSnapshot =
            handle.activeAssistantMessageId && snapshot
              ? overwritePiMonoNormalizedMessageId(snapshot, handle.activeAssistantMessageId)
              : snapshot;
          const messageId = readPiMonoNormalizedMessageId(canonicalSnapshot) ?? null;
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
              type: partType,
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
          handle.activeAssistantMessageId = undefined;

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

          if (handle.pauseRequested) {
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
      activeAssistantMessageId: undefined,
      assistantMessageIdAliases: new Map<string, string>(),
      approvedExternalDirectories: new Set<string>(),
      approvedCommands: new Set<string>(),
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
      activeAssistantMessageId: undefined,
      assistantMessageIdAliases: new Map<string, string>(),
      approvedExternalDirectories: new Set(parent.approvedExternalDirectories),
      approvedCommands: new Set(parent.approvedCommands),
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
      handle.activeAssistantMessageId = undefined;
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
  const handle =
    resolvePiMonoHandle(sessionOrAgentRunId) ??
    (await recoverMissingPiMonoHandle(sessionOrAgentRunId));
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
  return normalizePiMonoMessages(handle.sessionId, messages, handle.assistantMessageIdAliases);
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

function rememberPiMonoApprovedPermission(
  handle: PiMonoRuntimeHandle,
  request: PiMonoPendingPermission,
  reply: RuntimePermissionReply,
) {
  if (reply !== "always") {
    return;
  }

  const metadata =
    request.metadata && typeof request.metadata === "object"
      ? (request.metadata as Record<string, unknown>)
      : undefined;

  if (request.permission === "external_directory") {
    const filepath = normalizePiMonoApprovalDirectory(
      typeof metadata?.filepath === "string" ? metadata.filepath : undefined,
    );
    const parentDir =
      normalizePiMonoApprovalDirectory(
        typeof metadata?.parentDir === "string" ? metadata.parentDir : undefined,
      ) ?? (filepath ? dirname(filepath) : undefined);
    if (parentDir) {
      handle.approvedExternalDirectories.add(parentDir);
    }
    return;
  }

  if (request.permission === "command_execution") {
    const command = normalizePiMonoApprovedCommand(
      typeof metadata?.command === "string" ? metadata.command : undefined,
    );
    if (command) {
      handle.approvedCommands.add(command);
    }
  }
}

async function continuePiMonoSession(
  sessionId: string,
  prompt: string,
  options?: RuntimeContinueSessionOptions,
) {
  markContinueLatencyStage(sessionId, "runtime-continue-entered", {
    promptLength: prompt.length,
  });
  const handle = await ensurePiMonoHandle(sessionId, { action: "continue session" });
  markContinueLatencyStage(sessionId, "runtime-handle-ready", {
    taskId: handle.taskId,
    promptLength: prompt.length,
  });
  await capturePiMonoContinueStateSnapshot(
    sessionId,
    handle,
    "runtime-state-handle-ready",
    options?.model,
  );
  if (handle.pauseRequested) {
    await ensurePiMonoPauseSettled(handle, "continuing session");
  }

  if (options?.model) {
    await handle.client.setModel(options.model.providerId, options.model.modelId);
    handle.model = options.model;
  }
  markContinueLatencyStage(sessionId, "runtime-model-ready", {
    taskId: handle.taskId,
    promptLength: prompt.length,
  });
  await capturePiMonoContinueStateSnapshot(
    sessionId,
    handle,
    "runtime-state-after-model-set",
    options?.model,
  );

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
  markContinueLatencyStage(sessionId, "runtime-agent-run-ready", {
    taskId: handle.taskId,
    promptLength: prompt.length,
  });

  const wasRunning = handle.status === "running";
  handle.status = "running";
  await capturePiMonoContinueStateSnapshot(
    sessionId,
    handle,
    "runtime-state-before-dispatch",
    options?.model,
  );
  markContinueLatencyStage(sessionId, "runtime-dispatch-begin", {
    taskId: handle.taskId,
    promptLength: prompt.length,
    wasRunning,
    dispatchMode: wasRunning ? "followUp" : "prompt",
  });
  if (wasRunning) {
    await handle.client.followUp(prompt);
    markContinueLatencyStage(sessionId, "runtime-dispatch-resolved", {
      taskId: handle.taskId,
      promptLength: prompt.length,
      wasRunning,
      dispatchMode: "followUp",
    });
    return;
  }

  await handle.client.prompt(prompt);
  markContinueLatencyStage(sessionId, "runtime-dispatch-resolved", {
    taskId: handle.taskId,
    promptLength: prompt.length,
    wasRunning,
    dispatchMode: "prompt",
  });
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
      rememberPiMonoApprovedPermission(handle, pending.request, input.reply);
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

export function __readPiMonoRpcConfigForTests() {
  return readPiMonoRpcConfig();
}
