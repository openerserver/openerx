import type { AgentRunStatus } from "../../types/events";

// ── OpenCode Adapter ───────────────────────────────────────────────
// Maps agent control operations to OpenCode SDK calls.

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";

interface OpencodeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

async function opcall(method: string, path: string, body?: unknown): Promise<OpencodeResponse> {
  try {
    const response = await fetch(`${OPENCODE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Agent Run Registry ─────────────────────────────────────────────
// Maps agentRunId → subSessionId for OpenCode adapter operations.

const agentRunRegistry = new Map<
  string,
  { subSessionId: string; status: AgentRunStatus; taskId: string }
>();

export function registerAgentRun(agentRunId: string, subSessionId: string, taskId: string): void {
  agentRunRegistry.set(agentRunId, { subSessionId, status: "running", taskId });
}

export function getAgentRun(agentRunId: string) {
  return agentRunRegistry.get(agentRunId);
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
  prompt: string,
): Promise<OpencodeResponse & { sessionId?: string; agentRunId?: string }> {
  // 1. Create a new session in OpenCode
  const sessionResult = await opcall("POST", "/api/session", {
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
  registerAgentRun(agentRunId, sessionId, taskId);

  // 3. Send initial prompt to start execution
  const messageResult = await opcall("POST", `/api/session/${sessionId}/message`, {
    parts: [{ type: "text", text: prompt }],
  });

  if (!messageResult.ok) {
    // Session created but message failed — still return IDs so caller can retry
    return {
      ok: false,
      error: messageResult.error || "Session created but failed to send prompt",
      sessionId,
      agentRunId,
    };
  }

  return { ok: true, data: messageResult.data, sessionId, agentRunId };
}

/**
 * Pause an agent run by aborting its OpenCode sub-session.
 */
export async function pauseAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "running") return { ok: false, error: `Cannot pause: status is ${run.status}` };

  const result = await opcall("POST", `/api/session/${run.subSessionId}/abort`);

  if (result.ok) {
    run.status = "paused";
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

  const result = await opcall("POST", `/api/session/${run.subSessionId}/message`, {
    parts: [{ type: "text", text: content }],
    noReply: mode === "noReply",
  });

  return result;
}

/**
 * Resume a paused agent run.
 */
export async function resumeAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };
  if (run.status !== "paused") return { ok: false, error: `Cannot resume: status is ${run.status}` };

  const result = await opcall("POST", `/api/session/${run.subSessionId}/message`, {
    parts: [{ type: "text", text: "Resume execution from where you paused." }],
  });

  if (result.ok) {
    run.status = "running";
  }
  return result;
}

/**
 * Terminate an agent run permanently.
 */
export async function terminateAgent(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };

  const result = await opcall("POST", `/api/session/${run.subSessionId}/abort`);

  if (result.ok) {
    run.status = "stopped";
  }
  return result;
}

/**
 * Get the list of messages for an agent run's sub-session.
 */
export async function getAgentMessages(agentRunId: string): Promise<OpencodeResponse> {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) return { ok: false, error: "Agent run not found" };

  return await opcall("GET", `/api/session/${run.subSessionId}/messages`);
}
