import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_EXECUTION_AGENT,
  isDefaultExecutionAgent,
} from "../../lib/orchestration-strategy";
import type { AgentRunStatus } from "../../types/events";

// ── OpenCode Adapter ───────────────────────────────────────────────
// Maps agent control operations to OpenCode SDK calls.

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";
const OPENCODE_PROVIDER_ID = process.env.OPENCODE_PROVIDER_ID || "github-copilot";
const OPENCODE_MODEL_ID = process.env.OPENCODE_MODEL_ID || "claude-sonnet-4";
const configuredMinActiveBeforePauseMs = Number(process.env.OPENCODE_MIN_ACTIVE_BEFORE_PAUSE_MS);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

interface OpencodeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
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

  if (hasRuntimeAgentDefinition(agentName)) {
    return agentName;
  }

  console.warn(`[opencode-adapter] agent definition not found for ${agentName}; falling back to runtime default agent`);
  return undefined;
}

function appendExecutionContextLines(lines: string[], options?: PromptOptions): void {
  if (!options?.taskId || !options?.projectId) {
    return;
  }

  lines.push(
    "Execution context:",
    `- OpenerX task ID: ${options.taskId}`,
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

function appendTaskGraphToolingNotes(lines: string[], options?: PromptOptions): void {
  if (!options?.taskId || !options?.projectId) {
    return;
  }

  lines.push(
    "- If you call create_sub_session, dispatch_to_agent, list_sub_sessions, or any task_graph_* tool, you MUST use the exact OpenerX task ID above as taskId.",
    "- For task_graph_create, nodes must use JSON objects shaped like {subject, agentType, maxRetries?}.",
    "- For task_graph_create, edges must use JSON objects shaped like {fromIndex, toIndex, type?} where indexes reference the nodes array.",
  );
}

function buildExecutionContext(options?: PromptOptions): string {
  const lines: string[] = [];
  appendExecutionContextLines(lines, options);
  appendRepoContextLines(lines, options?.repoContext);
  appendTaskGraphToolingNotes(lines, options);
  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

function buildPromptBody(text: string, options?: PromptOptions): Record<string, unknown> {
  const executionContext = buildExecutionContext(options);
  const agent = resolvePromptAgent(options?.agent);

  const modelProvider = options?.model?.providerId || OPENCODE_PROVIDER_ID;
  const modelId = options?.model?.modelId || OPENCODE_MODEL_ID;

  return {
    parts: [{ type: "text", text: `${executionContext}${text}` }],
    model: {
      providerID: modelProvider,
      modelID: modelId,
    },
    ...(agent ? { agent } : {}),
    ...(typeof options?.noReply === "boolean" ? { noReply: options.noReply } : {}),
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

async function opcall(method: string, path: string, body?: unknown): Promise<OpencodeResponse> {
  try {
    const response = await fetch(`${OPENCODE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
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

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
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
  return agentRunRegistry.get(agentRunId);
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
  const messageResult = await opcall(
    "POST",
    `/session/${sessionId}/prompt_async`,
    buildPromptBody(prompt, {
      agent: options?.agent || DEFAULT_EXECUTION_AGENT,
      model: options?.model,
      taskId,
      projectId,
      repoContext: options?.repoContext,
    }),
  );

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
  updateAgentRunStatus(agentRunId, "paused");
  run.pausedAt = Date.now();
  const result = await opcall("POST", `/session/${run.subSessionId}/abort`);

  if (!result.ok) {
    updateAgentRunStatus(agentRunId, "running");
    run.pausedAt = undefined;
  }

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

export async function getSessionMessages(sessionId: string): Promise<OpencodeResponse> {
  return await opcall("GET", `/session/${sessionId}/message?limit=200`);
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

function extractAssistantErrorMessage(info: Record<string, unknown> | undefined): string | undefined {
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

export function extractAssistantResultFromMessages(messages: unknown): {
  text?: string;
  completed: boolean;
  failed: boolean;
  error?: string;
  tokenUsed: number;
} {
  if (!Array.isArray(messages)) {
    return { completed: false, failed: false, tokenUsed: 0 };
  }

  let fallbackText: string | undefined;
  let tokenUsed = 0;

  for (const message of messages) {
    const info = getAssistantMessageInfo(message);
    if (info?.role !== "assistant") {
      continue;
    }

    tokenUsed += extractAssistantTokenUsage(info);
  }

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const info = getAssistantMessageInfo(message);
    if (info?.role !== "assistant") {
      continue;
    }

    const text = readAssistantText(getMessageParts(message));
    if (text) {
      fallbackText = text;
    }

    const errorMessage = extractAssistantErrorMessage(info);
    if (errorMessage) {
      return { text: fallbackText ?? text, completed: false, failed: true, error: errorMessage, tokenUsed };
    }

    if (text && isCompletedAssistantMessage(info)) {
      return { text, completed: true, failed: false, tokenUsed };
    }

    break;
  }

  return { text: fallbackText, completed: false, failed: false, tokenUsed };
}

async function waitForSessionText(
  sessionId: string,
  timeoutMs: number,
): Promise<{ text?: string; completed: boolean; failed: boolean; error?: string; tokenUsed: number }> {
  const deadline = Date.now() + timeoutMs;
  let fallbackText: string | undefined;
  let fallbackTokenUsed = 0;

  while (Date.now() < deadline) {
    const messagesResult = await getSessionMessages(sessionId);
    if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
      return { text: fallbackText, completed: false, failed: false, tokenUsed: fallbackTokenUsed };
    }

    const assistantResult = extractAssistantResultFromMessages(messagesResult.data);
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
  return await opcall("GET", `/session?limit=${limit}`);
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
): Promise<OpencodeResponse & { sessionId?: string; text?: string; completed?: boolean }> {
  const sessionResult = await opcall("POST", "/session", { title });
  if (!sessionResult.ok) {
    return { ok: false, error: sessionResult.error || "Failed to create detached session" };
  }

  const sessionData = sessionResult.data as { id?: string; sessionID?: string };
  const sessionId = sessionData.id || sessionData.sessionID;
  if (!sessionId) {
    return { ok: false, error: "No session ID returned from OpenCode" };
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
    };
  }

  const result = await waitForSessionText(sessionId, options?.timeoutMs ?? 15000);
  return {
    ok: true,
    sessionId,
    text: result.text,
    completed: result.completed,
  };
}

export async function continueSession(
  sessionId: string,
  prompt: string,
  options?: { model?: { providerId: string; modelId: string } },
): Promise<OpencodeResponse> {
  return await opcall(
    "POST",
    `/session/${sessionId}/prompt_async`,
    buildPromptBody(prompt, { model: options?.model }),
  );
}
