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

// ── Control Operations ─────────────────────────────────────────────

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
