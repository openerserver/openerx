import type { AgentRunStatus } from "../../types/events";

// ── OpenCode Adapter ───────────────────────────────────────────────
// Maps agent control operations to OpenCode SDK calls.

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";
const OPENCODE_PROVIDER_ID = process.env.OPENCODE_PROVIDER_ID || "opencode";
const OPENCODE_MODEL_ID = process.env.OPENCODE_MODEL_ID || "big-pickle";

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
  finishedAt?: string;
}

function buildPromptBody(
  text: string,
  options?: { noReply?: boolean; agent?: string },
): Record<string, unknown> {
  return {
    parts: [{ type: "text", text }],
    model: {
      providerID: OPENCODE_PROVIDER_ID,
      modelID: OPENCODE_MODEL_ID,
    },
    ...(options?.agent ? { agent: options.agent } : {}),
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

const agentRunRegistry = new Map<
  string,
  AgentRunRecord
>();

export function registerAgentRun(
  agentRunId: string,
  subSessionId: string,
  taskId: string,
  projectId: string,
): void {
  agentRunRegistry.set(agentRunId, { subSessionId, status: "running", taskId, projectId });
}

function setFinishedAt(run: AgentRunRecord, status: AgentRunStatus): void {
  if (status === "completed" || status === "failed" || status === "stopped") {
    run.finishedAt = new Date().toISOString();
    return;
  }

  delete run.finishedAt;
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

// ── Control Operations ─────────────────────────────────────────────

/**
 * Create a new OpenCode session and send the initial prompt to start agent execution.
 * Returns the sessionId and agentRunId.
 */
export async function createSession(
  taskId: string,
  projectId: string,
  prompt: string,
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
  registerAgentRun(agentRunId, sessionId, taskId, projectId);

  // 3. Send initial prompt to start execution
  const messageResult = await opcall(
    "POST",
    `/session/${sessionId}/prompt_async`,
    buildPromptBody(prompt, { agent: "build" }),
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

  return { ok: true, data: sessionResult.data, sessionId, agentRunId };
}

/**
 * Pause an agent run by aborting its OpenCode sub-session.
 */
export async function pauseAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "running") return { ok: false, error: `Cannot pause: status is ${run.status}` };

  const result = await opcall("POST", `/session/${run.subSessionId}/abort`);

  if (result.ok) {
    updateAgentRunStatus(agentRunId, "paused");
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
  if (run.status !== "paused") return { ok: false, error: `Cannot inject guidance: status is ${run.status}` };

  const result = await opcall(
    "POST",
    `/session/${run.subSessionId}/prompt_async`,
    buildPromptBody(content, { noReply: mode === "noReply" }),
  );

  return result;
}

/**
 * Resume a paused agent run.
 */
export async function resumeAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "paused") return { ok: false, error: `Cannot resume: status is ${run.status}` };

  const result = await opcall(
    "POST",
    `/session/${run.subSessionId}/prompt_async`,
    buildPromptBody("Resume execution. Apply any guidance provided above and continue your current task."),
  );

  if (result.ok) {
    updateAgentRunStatus(agentRunId, "running");
  }
  return result;
}

/**
 * Terminate an agent run permanently.
 */
export async function terminateAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };

  const result = await opcall("POST", `/session/${run.subSessionId}/abort`);

  if (result.ok) {
    updateAgentRunStatus(agentRunId, "stopped");
  }
  return result;
}

/**
 * Get the list of messages for an agent run's sub-session.
 */
export async function getAgentMessages(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };

  return await opcall("GET", `/session/${run.subSessionId}/message?limit=200`);
}

export async function getSessionMessages(sessionId: string): Promise<OpencodeResponse> {
  return await opcall("GET", `/session/${sessionId}/message?limit=200`);
}
