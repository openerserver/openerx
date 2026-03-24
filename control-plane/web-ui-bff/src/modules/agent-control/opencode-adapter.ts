import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInternalAuthorization } from "../../lib/control-plane-client";
import { DEFAULT_EXECUTION_AGENT, isDefaultExecutionAgent } from "../../lib/orchestration-strategy";
import type { AgentRunStatus } from "../../types/events";
import {
  type BranchCompatLineageRecord,
  fetchBranchCompatCachedMessages,
  fetchBranchCompatLineageRecords,
} from "../tasks/task-session-compat";

// ── OpenCode Adapter ───────────────────────────────────────────────
// Maps agent control operations to OpenCode SDK calls.

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";
const OPENCODE_PROVIDER_ID = process.env.OPENCODE_PROVIDER_ID || "github-copilot";
const OPENCODE_MODEL_ID = process.env.OPENCODE_MODEL_ID || "claude-sonnet-4";
const configuredMinActiveBeforePauseMs = Number(process.env.OPENCODE_MIN_ACTIVE_BEFORE_PAUSE_MS);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

// ── Circuit breaker for OpenCode runtime ────────────────────────────
// Session read fan-out can avalanche the runtime, so only those paths use a
// short-lived circuit breaker. Mutating calls keep probing independently.
const CIRCUIT_BREAKER_THRESHOLD = 2;
const CIRCUIT_BREAKER_COOLDOWN_MS = 15_000;
const SESSION_READ_CIRCUIT_KEY = "session-read";
const circuitBreakers = new Map<string, { failures: number; openedAt: number }>();

function isCircuitOpen(circuitKey?: string): boolean {
  if (!circuitKey) return false;

  const state = circuitBreakers.get(circuitKey);
  if (!state || state.failures < CIRCUIT_BREAKER_THRESHOLD) {
    return false;
  }

  if (Date.now() - state.openedAt > CIRCUIT_BREAKER_COOLDOWN_MS) {
    circuitBreakers.delete(circuitKey);
    return false;
  }

  return true;
}

function recordCircuitSuccess(circuitKey?: string): void {
  if (!circuitKey) return;
  circuitBreakers.delete(circuitKey);
}

function recordCircuitFailure(circuitKey?: string): void {
  if (!circuitKey) return;

  const current = circuitBreakers.get(circuitKey) ?? { failures: 0, openedAt: 0 };
  const failures = current.failures + 1;
  circuitBreakers.set(circuitKey, {
    failures,
    openedAt: failures >= CIRCUIT_BREAKER_THRESHOLD ? Date.now() : current.openedAt,
  });
}

// Short-lived cache + in-flight deduplication for listSessions to prevent
// request avalanche when the multi-task-monitor refreshes many tasks at once.
const LIST_SESSIONS_CACHE_TTL_MS = 3_000;
const listSessionsCache = new Map<string, { ts: number; result: OpencodeResponse }>();
const listSessionsInflight = new Map<string, Promise<OpencodeResponse>>();

interface OpencodeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface RuntimePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  always?: string[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

export type RuntimePermissionReply = "once" | "always" | "reject";

interface GetSessionMessagesOptions {
  bypassCircuitBreaker?: boolean;
  taskId?: string;
  authorization?: string;
  includeLineage?: boolean;
}

interface AgentRunRecord {
  subSessionId: string;
  status: AgentRunStatus;
  taskId: string;
  projectId: string;
  model?: { providerId: string; modelId: string };
  candidateIndex?: number;
  startedAt: number;
  finishedAt?: string;
  pausedAt?: number;
  lastPromptAt?: number;
}

const PROMPT_SETTLE_MS = 1200;
const MIN_ACTIVE_BEFORE_PAUSE_MS =
  Number.isFinite(configuredMinActiveBeforePauseMs) && configuredMinActiveBeforePauseMs >= 0
    ? configuredMinActiveBeforePauseMs
    : 3000;

type PromptOptions = {
  noReply?: boolean;
  agent?: string;
  taskId?: string;
  projectId?: string;
  model?: { providerId: string; modelId: string };
  repoContext?: {
    repoName?: string;
    remoteUrl?: string;
    workingBranch?: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
    gitCommitterName?: string;
    gitCommitterEmail?: string;
  };
};

function getAgentDefinitionDirs(): string[] {
  const candidates = [
    process.env.OPENCODE_DIR,
    process.env.OPENCODE_ROOT,
    process.cwd(),
    resolve(MODULE_DIR, "../../../../../"),
    resolve(MODULE_DIR, "../../../../../opencode-fork"),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates.map((directory) => join(directory, ".opencode", "agents"))));
}

function hasRuntimeAgentDefinition(agentName: string): boolean {
  if (!agentName || isDefaultExecutionAgent(agentName)) {
    return true;
  }

  return getAgentDefinitionDirs().some((directory) =>
    existsSync(join(directory, `${agentName}.md`)),
  );
}

function resolvePromptAgent(agentName?: string): string | undefined {
  if (!agentName) {
    return undefined;
  }

  if (agentName === DEFAULT_EXECUTION_AGENT) {
    return undefined;
  }

  if (hasRuntimeAgentDefinition(agentName)) {
    return agentName;
  }

  console.warn(
    `[opencode-adapter] agent definition not found for ${agentName}; falling back to runtime default agent`,
  );
  return undefined;
}

function appendExecutionContextLines(lines: string[], options?: PromptOptions): void {
  if (!options?.taskId || !options?.projectId) {
    return;
  }

  lines.push(
    "Execution context:",
    `- Opener-X task ID: ${options.taskId}`,
    `- Project ID: ${options.projectId}`,
  );
}

function appendRepoContextLines(lines: string[], repoContext?: PromptOptions["repoContext"]): void {
  if (!repoContext) {
    return;
  }

  if (repoContext.repoName) lines.push(`- Repository: ${repoContext.repoName}`);
  if (repoContext.remoteUrl) lines.push(`- Remote URL: ${repoContext.remoteUrl}`);
  if (repoContext.workingBranch) lines.push(`- Working branch: ${repoContext.workingBranch}`);
  if (repoContext.gitAuthorName || repoContext.gitAuthorEmail) {
    lines.push(
      `- Git author: ${repoContext.gitAuthorName ?? ""} <${repoContext.gitAuthorEmail ?? ""}>`,
    );
  }
  if (repoContext.gitCommitterName || repoContext.gitCommitterEmail) {
    lines.push(
      `- Git committer: ${repoContext.gitCommitterName ?? ""} <${repoContext.gitCommitterEmail ?? ""}>`,
    );
  }
}

function buildExecutionContext(options?: PromptOptions): string {
  const lines: string[] = [];
  appendExecutionContextLines(lines, options);
  appendRepoContextLines(lines, options?.repoContext);
  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

function normalizeRuntimeModelId(providerId: string, modelId: string): string {
  const trimmedProviderId = providerId.trim();
  const trimmedModelId = modelId.trim();

  if (!trimmedProviderId || !trimmedModelId) {
    return trimmedModelId;
  }
  if (trimmedModelId.startsWith(`${trimmedProviderId}/`)) {
    return trimmedModelId.slice(trimmedProviderId.length + 1);
  }
  if (trimmedModelId.startsWith(`${trimmedProviderId}:`)) {
    return trimmedModelId.slice(trimmedProviderId.length + 1);
  }

  return trimmedModelId;
}

function buildPromptBody(text: string, options?: PromptOptions): Record<string, unknown> {
  const executionContext = buildExecutionContext(options);
  const agent = resolvePromptAgent(options?.agent);
  const model = resolvePromptModel(options);

  return {
    parts: [{ type: "text", text: `${executionContext}${text}` }],
    model: {
      providerID: model.providerId,
      modelID: model.modelId,
    },
    ...(agent ? { agent } : {}),
    ...(typeof options?.noReply === "boolean" ? { noReply: options.noReply } : {}),
  };
}

function resolvePromptModel(options?: PromptOptions): { providerId: string; modelId: string } {
  const providerId = options?.model?.providerId || OPENCODE_PROVIDER_ID;
  const modelId = options?.model?.modelId || OPENCODE_MODEL_ID;

  return {
    providerId,
    modelId: normalizeRuntimeModelId(providerId, modelId),
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type OpcallOptions = {
  timeoutMs?: number;
  circuitKey?: string;
};

const PROMPT_PERSIST_SETTLE_MS = 1_500;
const PROMPT_PERSIST_POLL_MS = 150;

async function opcall(
  method: string,
  path: string,
  body?: unknown,
  options: OpcallOptions = {},
): Promise<OpencodeResponse> {
  const { timeoutMs = 4_000, circuitKey } = options;

  if (isCircuitOpen(circuitKey)) {
    return { ok: false, error: "OpenCode circuit breaker open — skipping call" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${OPENCODE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await parseResponseBody(response);

    if (!response.ok) {
      const error =
        typeof data === "object" && data && "error" in data && typeof data.error === "string"
          ? data.error
          : typeof data === "string"
            ? data
            : `OpenCode request failed: ${response.status}`;
      return { ok: false, data, error };
    }

    recordCircuitSuccess(circuitKey);
    return { ok: true, data };
  } catch (e) {
    recordCircuitFailure(circuitKey);
    return { ok: false, error: String(e) };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function readSessionMessageCount(
  sessionId: string,
  options?: { bypassCircuitBreaker?: boolean },
): Promise<number | undefined> {
  const result = await getSessionMessages(sessionId, options);
  if (!result.ok || !Array.isArray(result.data)) {
    return undefined;
  }

  return result.data.length;
}

async function waitForSessionMessageCount(
  sessionId: string,
  expectedMinCount: number,
  timeoutMs = PROMPT_PERSIST_SETTLE_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = await readSessionMessageCount(sessionId, {
      bypassCircuitBreaker: true,
    });
    if (count !== undefined && count >= expectedMinCount) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, PROMPT_PERSIST_POLL_MS));
  }

  return false;
}

async function sendPromptWithPersistenceCheck(
  sessionId: string,
  promptBody: Record<string, unknown>,
  baselineMessageCount = 0,
): Promise<OpencodeResponse> {
  const initialResult = await opcall("POST", `/session/${sessionId}/prompt_async`, promptBody);
  if (!initialResult.ok) {
    return initialResult;
  }

  const expectedMinCount = Math.max(0, baselineMessageCount) + 1;
  const initialPersisted = await waitForSessionMessageCount(sessionId, expectedMinCount);
  if (initialPersisted) {
    return initialResult;
  }

  const retryResult = await opcall("POST", `/session/${sessionId}/prompt_async`, promptBody);
  if (!retryResult.ok) {
    return retryResult;
  }

  const retryPersisted = await waitForSessionMessageCount(sessionId, expectedMinCount);
  if (retryPersisted) {
    return retryResult;
  }

  return {
    ok: false,
    error: "OpenCode accepted prompt_async but did not persist the prompt",
  };
}

// ── Agent Run Registry ─────────────────────────────────────────────
// Maps agentRunId → subSessionId for OpenCode adapter operations.

const agentRunRegistry = new Map<string, AgentRunRecord>();

function parseStartedAt(value?: string | number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function registerAgentRun(
  agentRunId: string,
  subSessionId: string,
  taskId: string,
  projectId: string,
  model?: { providerId: string; modelId: string },
  candidateIndex?: number,
): void {
  agentRunRegistry.set(agentRunId, {
    subSessionId,
    status: "running",
    taskId,
    projectId,
    model,
    candidateIndex,
    startedAt: Date.now(),
  });
}

export function recoverAgentRun(
  agentRunId: string,
  subSessionId: string,
  taskId: string,
  projectId: string,
  startedAt?: string | number | null,
  model?: { providerId: string; modelId: string },
  candidateIndex?: number,
): void {
  agentRunRegistry.set(agentRunId, {
    subSessionId,
    status: "running",
    taskId,
    projectId,
    model,
    candidateIndex,
    startedAt: parseStartedAt(startedAt),
  });
}

async function waitForPromptWindow(run: AgentRunRecord): Promise<void> {
  const waitUntil = Math.max(run.pausedAt ?? 0, run.lastPromptAt ?? 0) + PROMPT_SETTLE_MS;
  const remaining = waitUntil - Date.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

async function waitForPauseWindow(run: AgentRunRecord): Promise<void> {
  const remaining = run.startedAt + MIN_ACTIVE_BEFORE_PAUSE_MS - Date.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

function markPromptSent(run: AgentRunRecord): void {
  run.lastPromptAt = Date.now();
}

function setFinishedAt(run: AgentRunRecord, status: AgentRunStatus): void {
  if (status === "completed" || status === "failed" || status === "stopped") {
    run.finishedAt = new Date().toISOString();
    return;
  }

  run.finishedAt = undefined;
}

export function updateAgentRunStatus(agentRunId: string, status: AgentRunStatus) {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return undefined;

  run.status = status;
  setFinishedAt(run, status);

  return {
    agentRunId,
    ...run,
  };
}

export function getAgentRun(agentRunId: string) {
  const run = agentRunRegistry.get(agentRunId);
  return run
    ? {
        agentRunId,
        ...run,
      }
    : undefined;
}

export function findAgentRunBySessionId(sessionId: string) {
  for (const [agentRunId, run] of agentRunRegistry.entries()) {
    if (run.subSessionId === sessionId) {
      return { agentRunId, ...run };
    }
  }

  return undefined;
}

export function listAgentRuns() {
  return Array.from(agentRunRegistry.entries()).map(([id, run]) => ({
    agentRunId: id,
    ...run,
  }));
}

export function ensureAgentRunForSession(
  sessionId: string,
  taskId: string,
  projectId: string,
  model?: { providerId: string; modelId: string },
  agentRunId?: string,
) {
  const existing = findAgentRunBySessionId(sessionId);

  if (existing) {
    const run = agentRunRegistry.get(existing.agentRunId);
    if (run) {
      run.status = "running";
      run.taskId = taskId;
      run.projectId = projectId;
      run.startedAt = Date.now();
      run.pausedAt = undefined;
      run.finishedAt = undefined;
      if (model) {
        run.model = model;
      }
      markPromptSent(run);
    }

    return existing.agentRunId;
  }

  const resolvedAgentRunId = agentRunId || crypto.randomUUID();
  registerAgentRun(resolvedAgentRunId, sessionId, taskId, projectId, model);
  const created = agentRunRegistry.get(resolvedAgentRunId);
  if (created) {
    markPromptSent(created);
  }

  return resolvedAgentRunId;
}

// ── Control Operations ─────────────────────────────────────────────

/**
 * Create a new OpenCode session and send the initial prompt to start agent execution.
 * Returns the sessionId and agentRunId.
 */
export async function createSession(
  taskId: string,
  projectId: string,
  prompt: string,
  options?: {
    agent?: string;
    model?: { providerId: string; modelId: string };
    candidateIndex?: number;
    repoContext?: {
      repoName?: string;
      remoteUrl?: string;
      workingBranch?: string;
      gitAuthorName?: string;
      gitAuthorEmail?: string;
      gitCommitterName?: string;
      gitCommitterEmail?: string;
    };
  },
): Promise<OpencodeResponse & { sessionId?: string; agentRunId?: string }> {
  // 1. Create a new session in OpenCode
  const sessionResult = await opcall("POST", "/session", {
    title: `[Task ${taskId.slice(0, 8)}] ${prompt.slice(0, 80)}`,
  });

  if (!sessionResult.ok) {
    return { ok: false, error: sessionResult.error || "Failed to create OpenCode session" };
  }

  const sessionData = sessionResult.data as { id?: string; sessionID?: string };
  const sessionId = sessionData.id || sessionData.sessionID;
  if (!sessionId) {
    return { ok: false, error: "No session ID returned from OpenCode" };
  }

  // 2. Register as an agent run
  const agentRunId = crypto.randomUUID();
  registerAgentRun(
    agentRunId,
    sessionId,
    taskId,
    projectId,
    options?.model,
    options?.candidateIndex,
  );

  // 3. Send initial prompt to start execution
  const promptBody = buildPromptBody(prompt, {
    agent: options?.agent || DEFAULT_EXECUTION_AGENT,
    model: options?.model,
    taskId,
    projectId,
    repoContext: options?.repoContext,
  });
  const messageResult = await sendPromptWithPersistenceCheck(sessionId, promptBody, 0);

  if (!messageResult.ok) {
    // Session created but message failed — still return IDs so caller can retry
    return {
      ok: false,
      error: messageResult.error || "Session created but failed to send prompt",
      sessionId,
      agentRunId,
    };
  }

  const run = agentRunRegistry.get(agentRunId);
  if (run) {
    markPromptSent(run);
  }

  return { ok: true, data: sessionResult.data, sessionId, agentRunId };
}

/**
 * Pause an agent run by aborting its OpenCode sub-session.
 */
export async function pauseAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "running")
    return { ok: false, error: `Cannot pause: status is ${run.status}` };

  await waitForPauseWindow(run);
  if (run.status !== "running") {
    return { ok: false, error: `Cannot pause: status is ${run.status}` };
  }

  const result = await opcall("POST", `/session/${run.subSessionId}/abort`);

  if (!result.ok) {
    return result;
  }

  if (run.status !== "running") {
    return { ok: false, error: `Cannot pause: status is ${run.status}` };
  }

  updateAgentRunStatus(agentRunId, "paused");
  run.pausedAt = Date.now();

  return result;
}

/**
 * Inject guidance into a paused agent run.
 */
export async function injectGuidance(
  agentRunId: string,
  content: string,
  mode: "reply" | "noReply" = "reply",
): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "paused")
    return { ok: false, error: `Cannot inject guidance: status is ${run.status}` };

  await waitForPromptWindow(run);

  const result = await opcall(
    "POST",
    `/session/${run.subSessionId}/prompt_async`,
    buildPromptBody(content, { noReply: mode === "noReply", model: run.model }),
  );

  if (result.ok) {
    markPromptSent(run);
  }

  return result;
}

export async function resumeAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "paused")
    return { ok: false, error: `Cannot resume: status is ${run.status}` };

  await waitForPromptWindow(run);

  const result = await opcall(
    "POST",
    `/session/${run.subSessionId}/prompt_async`,
    buildPromptBody(
      "Resume execution. Apply any guidance provided above and continue your current task.",
      { model: run.model },
    ),
  );

  if (result.ok) {
    updateAgentRunStatus(agentRunId, "running");
    run.pausedAt = undefined;
    markPromptSent(run);
  }

  return result;
}

export async function terminateAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };

  const result = await opcall("POST", `/session/${run.subSessionId}/abort`);

  if (result.ok) {
    updateAgentRunStatus(agentRunId, "stopped");
  }

  return result;
}

export async function getAgentMessages(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };

  return await opcall("GET", `/session/${run.subSessionId}/message?limit=200`);
}

const sessionMessagesInflight = new Map<string, Promise<OpencodeResponse>>();

function extractSessionMessageId(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  const info =
    record.info && typeof record.info === "object"
      ? (record.info as Record<string, unknown>)
      : undefined;

  const infoId = info?.id;
  if (typeof infoId === "string" && infoId.trim()) {
    return infoId;
  }

  const directId = record.id;
  return typeof directId === "string" && directId.trim() ? directId : undefined;
}

function sliceMessagesForLineageBoundary(
  messages: unknown[],
  childRecord?: BranchCompatLineageRecord,
) {
  if (!childRecord?.forkedFromMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => extractSessionMessageId(message) === childRecord.forkedFromMessageId,
  );

  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function dedupeMergedSessionMessages(messages: unknown[]) {
  const seen = new Set<string>();
  let anonymousIndex = 0;

  return messages.filter((message) => {
    const messageId = extractSessionMessageId(message) || `anonymous-${anonymousIndex++}`;
    if (seen.has(messageId)) {
      return false;
    }

    seen.add(messageId);
    return true;
  });
}

function compareLineageTime(left?: string | null, right?: string | null) {
  const leftTime = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function dedupeTaskLineageRecords(records: BranchCompatLineageRecord[]) {
  const byRuntimeSessionId = new Map<string, BranchCompatLineageRecord>();

  for (const record of records) {
    const existing = byRuntimeSessionId.get(record.runtimeSessionId);
    if (!existing) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
      continue;
    }

    const existingScore =
      Number(Boolean(existing.parentRuntimeSessionId)) +
      Number(Boolean(existing.forkedFromMessageId));
    const nextScore =
      Number(Boolean(record.parentRuntimeSessionId)) + Number(Boolean(record.forkedFromMessageId));
    const existingUpdated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const nextUpdated = record.updatedAt ? Date.parse(record.updatedAt) : 0;

    if (nextScore > existingScore || nextUpdated > existingUpdated) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
    }
  }

  return Array.from(byRuntimeSessionId.values()).sort((left, right) =>
    compareLineageTime(left.createdAt, right.createdAt),
  );
}

function findLineageRootRecord(records: BranchCompatLineageRecord[]) {
  return (
    records.find((record) => record.sourceType === "root") ??
    records.slice().sort((left, right) => compareLineageTime(left.createdAt, right.createdAt))[0]
  );
}

function repairLineageRecord(record: BranchCompatLineageRecord, rootRuntimeSessionId: string) {
  const previousParent = record.parentRuntimeSessionId;
  const previousSourceType = record.sourceType;

  if (record.runtimeSessionId === rootRuntimeSessionId) {
    record.parentRuntimeSessionId = null;
    record.sourceType = "root";
  } else if (!record.parentRuntimeSessionId) {
    record.parentRuntimeSessionId = rootRuntimeSessionId;
    if (record.sourceType !== "sub_session") {
      record.sourceType = "fork";
    }
  } else if (record.sourceType === "root") {
    record.sourceType = "fork";
  }

  return (
    record.parentRuntimeSessionId !== previousParent || record.sourceType !== previousSourceType
  );
}

function normalizeLineageRecords(records: BranchCompatLineageRecord[]) {
  const normalized = dedupeTaskLineageRecords(records).map((record) => ({ ...record }));
  if (normalized.length <= 1) {
    return normalized;
  }

  const rootRecord = findLineageRootRecord(normalized);
  if (!rootRecord) {
    return normalized;
  }

  for (const record of normalized) {
    repairLineageRecord(record, rootRecord.runtimeSessionId);
  }

  return normalized;
}

function buildLineagePath(records: TaskSessionLineageRecord[], runtimeSessionId: string) {
  const recordMap = new Map(records.map((record) => [record.runtimeSessionId, record] as const));
  const path: TaskSessionLineageRecord[] = [];
  const visited = new Set<string>();

  let current = recordMap.get(runtimeSessionId);
  while (current && !visited.has(current.runtimeSessionId)) {
    path.push(current);
    visited.add(current.runtimeSessionId);
    current = current.parentRuntimeSessionId
      ? recordMap.get(current.parentRuntimeSessionId)
      : undefined;
  }

  return path.reverse();
}

async function fetchRuntimeSessionMessages(
  sessionId: string,
  options?: Pick<GetSessionMessagesOptions, "bypassCircuitBreaker">,
): Promise<OpencodeResponse> {
  if (options?.bypassCircuitBreaker) {
    return opcall("GET", `/session/${sessionId}/message?limit=200`);
  }

  const existing = sessionMessagesInflight.get(sessionId);
  if (existing) {
    return existing;
  }

  const promise = opcall("GET", `/session/${sessionId}/message?limit=200`, undefined, {
    circuitKey: SESSION_READ_CIRCUIT_KEY,
  }).finally(() => {
    sessionMessagesInflight.delete(sessionId);
  });
  sessionMessagesInflight.set(sessionId, promise);
  return promise;
}

async function loadTaskLineageMessages(
  taskId: string,
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<OpencodeResponse | null> {
  const authorization = options?.authorization?.trim()
    ? options.authorization
    : await createInternalAuthorization();

  const lineageResult = await fetchBranchCompatLineageRecords(taskId, authorization);
  const lineageRecords = lineageResult.activeRecords;

  if (lineageRecords.length === 0) {
    return null;
  }

  const lineagePath = buildLineagePath(normalizeLineageRecords(lineageRecords), sessionId);
  if (lineagePath.length === 0) {
    return null;
  }

  const aggregatedCachedMessagesResult = await fetchBranchCompatCachedMessages(
    taskId,
    sessionId,
    authorization,
    { includeLineage: true },
  );
  const aggregatedCachedMessages =
    aggregatedCachedMessagesResult.ok && Array.isArray(aggregatedCachedMessagesResult.data?.data)
      ? {
          ok: true,
          data: aggregatedCachedMessagesResult.data.data,
          meta: aggregatedCachedMessagesResult.data.meta,
        }
      : null;
  const aggregatedMeta =
    aggregatedCachedMessages &&
    typeof aggregatedCachedMessages === "object" &&
    "meta" in aggregatedCachedMessages
      ? ((aggregatedCachedMessages as { meta?: { cacheState?: string; complete?: boolean } })
          .meta ?? undefined)
      : undefined;
  if (
    aggregatedCachedMessages?.ok &&
    (aggregatedMeta?.cacheState === "complete" || aggregatedMeta?.complete === true)
  ) {
    return aggregatedCachedMessages;
  }

  const messageResults = await Promise.all(
    lineagePath.map(async (record) => {
      const cachedFetchResult = await fetchBranchCompatCachedMessages(
        taskId,
        record.runtimeSessionId,
        authorization,
      );
      const cachedMeta = cachedFetchResult.data?.meta;
      const cachedMessages = Array.isArray(cachedFetchResult.data?.data)
        ? cachedFetchResult.data.data
        : null;
      if (
        cachedFetchResult.ok &&
        cachedMessages &&
        (cachedMeta?.cacheState === "complete" ||
          cachedMeta?.complete === true ||
          cachedMessages.length > 0)
      ) {
        return {
          ok: true,
          data: cachedMessages,
        };
      }

      return fetchRuntimeSessionMessages(record.runtimeSessionId, {
        bypassCircuitBreaker: options?.bypassCircuitBreaker,
      });
    }),
  );

  const mergedMessages = messageResults.flatMap((result, index) => {
    const data = result.ok && Array.isArray(result.data) ? result.data : [];
    return sliceMessagesForLineageBoundary(data, lineagePath[index + 1]);
  });

  return {
    ok: true,
    data: dedupeMergedSessionMessages(mergedMessages),
  };
}

export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<OpencodeResponse> {
  if (options?.taskId && options.includeLineage !== false) {
    const lineageResult = await loadTaskLineageMessages(options.taskId, sessionId, options);
    if (lineageResult) {
      return lineageResult;
    }
  }

  return fetchRuntimeSessionMessages(sessionId, options);
}

function getAssistantMessageInfo(message: unknown): Record<string, unknown> | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  return "info" in message && typeof message.info === "object" && message.info
    ? (message.info as Record<string, unknown>)
    : undefined;
}

function getMessageParts(message: unknown): Record<string, unknown>[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  return Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts: unknown[] }).parts as Record<string, unknown>[])
    : [];
}

function readAssistantText(parts: Record<string, unknown>[]): string | undefined {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n");

  return text || undefined;
}

function isCompletedAssistantMessage(info: Record<string, unknown> | undefined): boolean {
  const time =
    typeof info?.time === "object" && info.time
      ? (info.time as Record<string, unknown>)
      : undefined;
  const completed = time?.completed;
  return typeof completed === "number" || typeof completed === "string";
}

function readAssistantCompletedAt(info: Record<string, unknown> | undefined): number | undefined {
  const time =
    typeof info?.time === "object" && info.time
      ? (info.time as Record<string, unknown>)
      : undefined;
  const completed = time?.completed;

  if (typeof completed === "number" && Number.isFinite(completed)) {
    return completed;
  }

  if (typeof completed === "string") {
    const numeric = Number(completed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const parsed = Date.parse(completed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function extractAssistantErrorMessage(
  info: Record<string, unknown> | undefined,
): string | undefined {
  const rawError = info?.error;
  if (typeof rawError === "string") {
    const trimmed = rawError.trim();
    return trimmed || undefined;
  }

  if (typeof rawError !== "object" || !rawError) {
    return undefined;
  }

  const error = rawError as Record<string, unknown>;
  const data =
    typeof error.data === "object" && error.data
      ? (error.data as Record<string, unknown>)
      : undefined;
  const message = data?.message ?? error.message ?? error.name;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function readTokenMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function extractAssistantTokenUsage(info: Record<string, unknown> | undefined): number {
  const tokens =
    typeof info?.tokens === "object" && info.tokens
      ? (info.tokens as Record<string, unknown>)
      : undefined;
  if (!tokens) {
    return 0;
  }

  const total = readTokenMetric(tokens.total);
  if (total > 0) {
    return total;
  }

  const cache =
    typeof tokens.cache === "object" && tokens.cache
      ? (tokens.cache as Record<string, unknown>)
      : undefined;

  return (
    readTokenMetric(tokens.input) +
    readTokenMetric(tokens.output) +
    readTokenMetric(tokens.reasoning) +
    readTokenMetric(cache?.read) +
    readTokenMetric(cache?.write)
  );
}

export function extractAssistantResultFromMessages(
  messages: unknown,
  options?: { minCompletedAt?: number },
): {
  text?: string;
  completed: boolean;
  failed: boolean;
  error?: string;
  tokenUsed: number;
} {
  if (!Array.isArray(messages)) {
    return { completed: false, failed: false, tokenUsed: 0 };
  }

  const tokenUsed = collectAssistantTokenUsage(messages);
  const resolved = resolveAssistantResultState(messages, options);
  return {
    text: resolved.text,
    completed: resolved.completed,
    failed: resolved.failed,
    error: resolved.error,
    tokenUsed,
  };
}

function collectAssistantTokenUsage(messages: unknown[]) {
  let tokenUsed = 0;

  for (const message of messages) {
    const info = getAssistantMessageInfo(message);
    if (info?.role !== "assistant") {
      continue;
    }
    tokenUsed += extractAssistantTokenUsage(info);
  }

  return tokenUsed;
}

function shouldSkipAssistantMessage(
  info: Record<string, unknown> | undefined,
  options?: { minCompletedAt?: number },
) {
  if (info?.role !== "assistant") {
    return true;
  }

  const completedAt = readAssistantCompletedAt(info);
  return (
    options?.minCompletedAt !== undefined &&
    completedAt !== undefined &&
    completedAt < options.minCompletedAt
  );
}

function resolveAssistantResultState(messages: unknown[], options?: { minCompletedAt?: number }) {
  let fallbackText: string | undefined;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const info = getAssistantMessageInfo(message);
    if (shouldSkipAssistantMessage(info, options)) {
      continue;
    }

    const text = readAssistantText(getMessageParts(message));
    if (text) {
      fallbackText = text;
    }

    const errorMessage = extractAssistantErrorMessage(info);
    if (errorMessage) {
      return {
        text: fallbackText ?? text,
        completed: false,
        failed: true,
        error: errorMessage,
      };
    }

    if (text && isCompletedAssistantMessage(info)) {
      return { text, completed: true, failed: false, error: undefined };
    }

    break;
  }

  return { text: fallbackText, completed: false, failed: false, error: undefined };
}

async function waitForSessionText(
  sessionId: string,
  timeoutMs: number,
  options?: { minCompletedAt?: number },
): Promise<{
  text?: string;
  completed: boolean;
  failed: boolean;
  error?: string;
  tokenUsed: number;
}> {
  const deadline = Date.now() + timeoutMs;
  let fallbackText: string | undefined;
  let fallbackTokenUsed = 0;

  while (Date.now() < deadline) {
    const messagesResult = await getSessionMessages(sessionId);
    if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
      return { text: fallbackText, completed: false, failed: false, tokenUsed: fallbackTokenUsed };
    }

    const assistantResult = extractAssistantResultFromMessages(messagesResult.data, options);
    if (assistantResult.text) {
      fallbackText = assistantResult.text;
    }
    if (assistantResult.tokenUsed > 0) {
      fallbackTokenUsed = assistantResult.tokenUsed;
    }

    if (assistantResult.failed) {
      return assistantResult;
    }

    if (assistantResult.completed) {
      return assistantResult;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { text: fallbackText, completed: false, failed: false, tokenUsed: fallbackTokenUsed };
}

export async function listSessions(limit = 20): Promise<OpencodeResponse> {
  const cacheKey = `list-sessions-${limit}`;
  const now = Date.now();
  const cached = listSessionsCache.get(cacheKey);
  if (cached && now - cached.ts < LIST_SESSIONS_CACHE_TTL_MS) {
    return cached.result;
  }
  const inflight = listSessionsInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }
  const promise = opcall("GET", `/session?limit=${limit}`, undefined, {
    circuitKey: SESSION_READ_CIRCUIT_KEY,
  })
    .then((result) => {
      if (result.ok) {
        listSessionsCache.set(cacheKey, { ts: Date.now(), result });
      }
      listSessionsInflight.delete(cacheKey);
      return result;
    })
    .catch((err) => {
      listSessionsInflight.delete(cacheKey);
      throw err;
    });
  listSessionsInflight.set(cacheKey, promise);
  return promise;
}

export async function listRuntimePermissions(): Promise<OpencodeResponse> {
  return opcall("GET", "/permission");
}

export async function replyRuntimePermission(
  requestId: string,
  input: { reply: RuntimePermissionReply; message?: string },
): Promise<OpencodeResponse> {
  return opcall("POST", `/permission/${encodeURIComponent(requestId)}/reply`, input);
}

export async function forkSession(
  sessionId: string,
  options?: { title?: string },
): Promise<OpencodeResponse & { sessionId?: string }> {
  const result = await opcall(
    "POST",
    `/session/${sessionId}/fork`,
    options?.title ? { title: options.title } : undefined,
  );

  if (!result.ok) {
    return { ok: false, error: result.error || "Failed to fork session" };
  }

  const sessionData = result.data as { id?: string; sessionID?: string } | undefined;
  return {
    ...result,
    sessionId: sessionData?.id || sessionData?.sessionID,
  };
}

export async function runDetachedPrompt(
  title: string,
  prompt: string,
  options?: PromptOptions & { timeoutMs?: number },
): Promise<
  OpencodeResponse & {
    sessionId?: string;
    text?: string;
    completed?: boolean;
    tokenUsed?: number;
    model?: { providerId: string; modelId: string };
  }
> {
  const model = resolvePromptModel(options);
  const sessionResult = await opcall("POST", "/session", { title });
  if (!sessionResult.ok) {
    return {
      ok: false,
      error: sessionResult.error || "Failed to create detached session",
      model,
    };
  }

  const sessionData = sessionResult.data as { id?: string; sessionID?: string };
  const sessionId = sessionData.id || sessionData.sessionID;
  if (!sessionId) {
    return { ok: false, error: "No session ID returned from OpenCode", model };
  }

  const promptResult = await opcall(
    "POST",
    `/session/${sessionId}/prompt_async`,
    buildPromptBody(prompt, options),
  );
  if (!promptResult.ok) {
    return {
      ok: false,
      error: promptResult.error || "Detached session created but prompt failed",
      sessionId,
      model,
    };
  }

  const result = await waitForSessionText(sessionId, options?.timeoutMs ?? 15000);
  return {
    ok: true,
    sessionId,
    text: result.text,
    completed: result.completed,
    tokenUsed: result.tokenUsed,
    model,
  };
}

export async function continueSession(
  sessionId: string,
  prompt: string,
  options?: { model?: { providerId: string; modelId: string } },
): Promise<OpencodeResponse> {
  const baselineMessageCount = (await readSessionMessageCount(sessionId)) ?? 0;
  return await sendPromptWithPersistenceCheck(
    sessionId,
    buildPromptBody(prompt, { model: options?.model }),
    baselineMessageCount,
  );
}
