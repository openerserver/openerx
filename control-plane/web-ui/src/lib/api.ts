import { useAuthStore } from "@/stores/auth";

const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const authStore = useAuthStore();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (response.status === 401) {
    authStore.logout();
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
  return request<{
    token: string;
    user: {
      id: string;
      username: string;
      displayName: string;
      role: string;
      projects?: Array<{ id: string; role: string }>;
    };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

// ── Agent Control ──────────────────────────────────────────────────

export async function pauseAgent(agentRunId: string) {
  return request(`/agents/${agentRunId}/pause`, { method: "POST" });
}

export async function resumeAgent(agentRunId: string) {
  return request(`/agents/${agentRunId}/resume`, { method: "POST" });
}

export async function injectGuidance(
  agentRunId: string,
  content: string,
  mode: "reply" | "noReply" = "reply",
) {
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

export async function listAgentRuns() {
  return request<
    Array<{
      agentRunId: string;
      subSessionId: string;
      status: string;
      taskId: string;
    }>
  >("/agents");
}

export async function getAgentMessages(agentRunId: string) {
  return request<{ ok: boolean; data?: unknown }>(`/agents/${agentRunId}/messages`);
}

// ── Tasks ──────────────────────────────────────────────────────────

export interface Task {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  prompt: string;
  status: string;
  sessionId?: string;
  agentRunId?: string;
  result?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export async function listTasks(projectId?: string, status?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  return request<{ data: Task[] }>(`/tasks?${params.toString()}`);
}

export async function getTask(taskId: string) {
  return request<Task>(`/tasks/${taskId}`);
}

export async function createTask(data: { title: string; prompt: string; projectId: string }) {
  return request<{ id: string; status: string }>("/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function executeTask(taskId: string) {
  return request<{
    taskId: string;
    sessionId: string;
    agentRunId: string;
    status: string;
  }>(`/tasks/${taskId}/execute`, { method: "POST" });
}

// ── Approvals ──────────────────────────────────────────────────────

export async function listApprovals(status = "pending") {
  return request(`/approvals?status=${status}`);
}

export async function resolveApproval(
  ticketId: string,
  action: "approve" | "reject",
  comment?: string,
) {
  return request(`/approvals/${ticketId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ action, comment }),
  });
}
