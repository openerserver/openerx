import { useAuthStore } from "../stores/auth";

const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers: { ...headers, ...options?.headers } });

  if (response.status === 401) {
    useAuthStore.getState().logout();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Auth ───────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  return request<{ token: string; user: { id: string; username: string; displayName: string; role: string } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
}

// ── Agent Control ──────────────────────────────────────────────────

export async function pauseAgent(agentRunId: string) {
  return request(`/agents/${agentRunId}/pause`, { method: "POST" });
}

export async function resumeAgent(agentRunId: string) {
  return request(`/agents/${agentRunId}/resume`, { method: "POST" });
}

export async function injectGuidance(agentRunId: string, content: string, mode: "reply" | "noReply" = "reply") {
  return request(`/agents/${agentRunId}/guidance`, {
    method: "POST",
    body: JSON.stringify({ content, mode }),
  });
}

export async function terminateAgent(agentRunId: string) {
  return request(`/agents/${agentRunId}/terminate`, { method: "POST" });
}

export async function getAgentStatus(agentRunId: string) {
  return request(`/agents/${agentRunId}/status`);
}

// ── Tasks ──────────────────────────────────────────────────────────

export async function listTasks(projectId?: string) {
  const params = projectId ? `?projectId=${projectId}` : "";
  return request(`/tasks${params}`);
}

export async function getTask(taskId: string) {
  return request(`/tasks/${taskId}`);
}

// ── Approvals ──────────────────────────────────────────────────────

export async function listApprovals(status = "pending") {
  return request(`/approvals?status=${status}`);
}

export async function resolveApproval(ticketId: string, action: "approve" | "reject", comment?: string) {
  return request(`/approvals/${ticketId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, comment }),
  });
}
