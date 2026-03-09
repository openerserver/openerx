import { useAuthStore } from "../stores/auth";

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
  category?: string;
  strategy?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string | null;
  settings?: ProjectSettings | null;
  createdAt?: string;
}

export type ApprovalPolicyMode = "balanced" | "strict" | "manual";

export interface EnvironmentApprovalPolicyBinding {
  approvalPolicy?: ApprovalPolicyMode;
  policyTemplateId?: string;
}

export interface ProjectSettings {
  defaultModel?: string;
  defaultEnvironmentId?: string;
  approvalPolicyTemplateId?: string;
  approvalPolicy?: ApprovalPolicyMode;
  environmentApprovalPolicies?: Record<string, EnvironmentApprovalPolicyBinding>;
  maxConcurrency?: number;
  budgetMonthly?: number;
  budgetConfigId?: string;
  warnThreshold?: number;
  throttleThreshold?: number;
}

export interface PolicyTemplate {
  id: string;
  projectId: string;
  name: string;
  type: "tool_whitelist" | "path_whitelist" | "command_level" | "concurrency" | "model";
  rules: Record<string, unknown>;
  appliesTo: "all" | "environment" | "agent";
}

export interface BudgetConfig {
  id: string;
  period: "daily" | "weekly" | "monthly";
  limit: number;
  currentSpend: number;
  usage: number;
  status: "ok" | "warn" | "throttle" | "blocked";
  warnThreshold: number;
  throttleThreshold: number;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  createdAt?: string;
}

export interface ProjectMember {
  userId: string;
  projectId: string;
  role: "project_admin" | "developer" | "viewer";
  username: string;
  displayName: string;
  globalRole: string;
  createdAt?: string;
}

export interface MemberCandidate {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt?: string;
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

export interface TaskGraphNode {
  id: string;
  taskId: string;
  graphId: string;
  subject: string;
  status: string;
  agentType: string;
  sessionId: string | null;
  retryCount: number;
  maxRetries: number;
  output: string | null;
  error: string | null;
  tokenUsed: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface TaskGraphEdge {
  id: string;
  taskId: string;
  graphId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
}

export interface TaskGraphData {
  taskId: string;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
}

export async function getTaskGraph(taskId: string) {
  return request<TaskGraphData>(`/tasks/${taskId}/graph`);
}

// ── Planning Pipeline ──────────────────────────────────────────────

export interface PipelineStage {
  agent: string;
  label: string;
  status: "pending" | "running" | "completed";
  messageCount: number;
  output: string | null;
  tokens: { input: number; output: number } | null;
}

export async function getTaskPipeline(taskId: string) {
  return request<{ stages: PipelineStage[] }>(`/tasks/${taskId}/pipeline`);
}

// ── Session History ────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  title: string;
  isActive: boolean;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getTaskSessions(taskId: string) {
  return request<{ data: SessionInfo[] }>(`/tasks/${taskId}/sessions`);
}

export async function getSessionMessages(taskId: string, sessionId: string) {
  return request<{ data: unknown[] }>(`/tasks/${taskId}/sessions/${sessionId}/messages`);
}

export async function continueTask(taskId: string, prompt: string, sessionId?: string) {
  return request<{ ok: boolean; sessionId: string }>(`/tasks/${taskId}/continue`, {
    method: "POST",
    body: JSON.stringify({ prompt, sessionId }),
  });
}

// ── Plugin Lifecycle ───────────────────────────────────────────────

export async function disablePlugin(name: string) {
  return request<{ ok: boolean }>(`/config/plugins/${name}/disable`, { method: "POST" });
}

export async function enablePlugin(name: string) {
  return request<{ ok: boolean }>(`/config/plugins/${name}/enable`, { method: "POST" });
}

export async function installPlugin(source: string, name?: string) {
  return request<{ ok: boolean; name: string }>("/config/plugins/install", {
    method: "POST",
    body: JSON.stringify({ source, name }),
  });
}

export async function uninstallPlugin(name: string) {
  return request<{ ok: boolean }>(`/config/plugins/${name}/uninstall`, { method: "POST" });
}

export async function checkPluginCompatibility() {
  return request<{ data: PluginCompatResult[] }>("/config/plugins/compatibility");
}

export interface PluginCompatResult {
  name: string;
  path: string;
  compatible: boolean;
  errors: string[];
}

export async function listProjects(orgId?: string) {
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  return request<Project[]>(`/projects${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function getProject(projectId: string) {
  return request<Project>(`/projects/${projectId}`);
}

export async function createProject(data: {
  orgId: string;
  name: string;
  slug: string;
  description?: string;
  settings?: ProjectSettings;
}) {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProject(
  projectId: string,
  data: { name?: string; description?: string; settings?: ProjectSettings },
) {
  return request<Project>(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function listProjectMembers(projectId: string) {
  return request<ProjectMember[]>(`/projects/${projectId}/members`);
}

export async function listProjectMemberCandidates(projectId: string) {
  return request<MemberCandidate[]>(`/projects/${projectId}/members/candidates`);
}

export async function addProjectMember(
  projectId: string,
  data: { userId: string; role: "project_admin" | "developer" | "viewer" },
) {
  return request<ProjectMember>(`/projects/${projectId}/members`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProjectMember(
  projectId: string,
  userId: string,
  data: { role: "project_admin" | "developer" | "viewer" },
) {
  return request<{ userId: string; projectId: string; role: string }>(
    `/projects/${projectId}/members/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export async function removeProjectMember(projectId: string, userId: string) {
  return request<{ ok: boolean }>(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
}

export async function listEnvironments(projectId: string) {
  return request<Environment[]>(`/envs?projectId=${encodeURIComponent(projectId)}`);
}

export async function createEnvironment(data: {
  projectId: string;
  name: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
}) {
  return request<Environment>("/envs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateEnvironment(
  envId: string,
  data: {
    name?: string;
    riskLevel?: "low" | "medium" | "high" | "critical";
    requiresApproval?: boolean;
  },
) {
  return request<Environment>(`/envs/${envId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function removeEnvironment(envId: string) {
  return request<{ ok: boolean }>(`/envs/${envId}`, {
    method: "DELETE",
  });
}

export async function listPolicies(projectId: string) {
  return request<PolicyTemplate[]>(`/policies?projectId=${encodeURIComponent(projectId)}`);
}

export async function createPolicy(data: {
  projectId: string;
  name: string;
  type: PolicyTemplate["type"];
  rules: Record<string, unknown>;
  appliesTo?: PolicyTemplate["appliesTo"];
}) {
  return request<PolicyTemplate>("/policies", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updatePolicy(
  policyId: string,
  data: { name?: string; rules?: Record<string, unknown>; appliesTo?: PolicyTemplate["appliesTo"] },
) {
  return request<PolicyTemplate>(`/policies/${policyId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function listBudgetConfigs(projectId: string) {
  return request<BudgetConfig[]>(`/cost/budget?projectId=${encodeURIComponent(projectId)}`);
}

export async function createBudgetConfig(data: {
  projectId: string;
  period: "daily" | "weekly" | "monthly";
  limitAmount: number;
  warnThreshold: number;
  throttleThreshold: number;
}) {
  return request<{
    id: string;
    projectId: string;
    period: "daily" | "weekly" | "monthly";
    limitAmount: number;
    warnThreshold: number;
    throttleThreshold: number;
  }>("/cost/budget", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateBudgetConfig(
  budgetId: string,
  data: {
    period?: "daily" | "weekly" | "monthly";
    limitAmount?: number;
    warnThreshold?: number;
    throttleThreshold?: number;
  },
) {
  return request<{
    id: string;
    projectId: string;
    period: "daily" | "weekly" | "monthly";
    limitAmount: number;
    warnThreshold: number;
    throttleThreshold: number;
  }>(`/cost/budget/${budgetId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── Organizations ──────────────────────────────────────────────────

export interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export async function listOrgs() {
  return request<Org[]>("/orgs");
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

export async function listApprovals(status?: "pending" | "approved" | "rejected" | "expired") {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  const query = params.toString();
  return request(`/approvals${query ? `?${query}` : ""}`);
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

// ── Config ─────────────────────────────────────────────────────────

export interface AgentSummary {
  fileName: string;
  name: string;
  description: string;
  model: string;
}

export interface AgentDetail {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface SkillSummary {
  dirName: string;
  name: string;
  description: string;
  permissions?: Record<string, unknown>;
}

export interface SkillDetail {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface CommandSummary {
  fileName: string;
  name: string;
  description: string;
}

export interface CommandDetail {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface ModelsConfig {
  defaults: Record<string, unknown>;
  providers: Record<string, unknown>;
  list: Array<Record<string, unknown>>;
}

export interface CopilotModelInfo {
  id: string;
  name: string;
  vendor: string;
  version: string;
  preview: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
}

export interface PluginInfo {
  path: string;
  name: string;
  exists?: boolean;
  enabled?: boolean;
}

export async function getConfigOverview() {
  return request<{
    data: {
      agents: AgentSummary[];
      skills: SkillSummary[];
      models: { defaults: Record<string, unknown>; list: Array<Record<string, unknown>> };
      mcp: Record<string, McpServer>;
      plugins: PluginInfo[];
    };
  }>("/config/overview");
}

// Agents
export async function listAgents() {
  return request<{ data: AgentSummary[] }>("/config/agents");
}
export async function getAgent(name: string) {
  return request<{ data: AgentDetail }>(`/config/agents/${name}`);
}
export async function updateAgent(
  name: string,
  data: { frontmatter: Record<string, unknown>; body: string },
) {
  return request<{ ok: boolean }>(`/config/agents/${name}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Skills
export async function listSkills() {
  return request<{ data: SkillSummary[] }>("/config/skills");
}
export async function getSkill(name: string) {
  return request<{ data: SkillDetail }>(`/config/skills/${name}`);
}
export async function updateSkill(
  name: string,
  data: { frontmatter: Record<string, unknown>; body: string },
) {
  return request<{ ok: boolean }>(`/config/skills/${name}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Commands
export async function listCommands() {
  return request<{ data: CommandSummary[] }>("/config/commands");
}
export async function getCommand(name: string) {
  return request<{ data: CommandDetail }>(`/config/commands/${name}`);
}
export async function updateCommand(
  name: string,
  data: { frontmatter: Record<string, unknown>; body: string },
) {
  return request<{ ok: boolean }>(`/config/commands/${name}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Models
export async function getModelsConfig() {
  return request<{ data: ModelsConfig }>("/config/models");
}
export async function updateModelsConfig(data: ModelsConfig) {
  return request<{ ok: boolean; restartRequired: boolean }>("/config/models", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// MCP
export async function getMcpConfig() {
  return request<{ data: Record<string, McpServer> }>("/config/mcp");
}
export async function updateMcpConfig(data: Record<string, McpServer>) {
  return request<{ ok: boolean; restartRequired: boolean }>("/config/mcp", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Security
export async function getSecurityBaseline() {
  return request<{ data: { raw: string } }>("/config/security");
}
export async function updateSecurityBaseline(raw: string) {
  return request<{ ok: boolean }>("/config/security", {
    method: "PUT",
    body: JSON.stringify({ raw }),
  });
}

// Plugins
export async function listPlugins() {
  return request<{ data: PluginInfo[] }>("/config/plugins");
}

// Orchestration Strategy
export interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
}

export async function getOrchestrationStrategy() {
  return request<{ data: OrchestrationStrategy }>("/config/orchestration-strategy");
}

export async function updateOrchestrationStrategy(data: OrchestrationStrategy) {
  return request<{ ok: boolean }>("/config/orchestration-strategy", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Continuation Policy
export interface ContinuationPolicy {
  autoRetryOnFailure: boolean;
  maxRetries: number;
  retryableErrors: string[];
  requireApprovalOnRetry: boolean;
  fallbackModel: string;
  enableFallback: boolean;
}

export async function getContinuationPolicy() {
  return request<{ data: ContinuationPolicy }>("/config/continuation-policy");
}

export async function updateContinuationPolicy(data: ContinuationPolicy) {
  return request<{ ok: boolean }>("/config/continuation-policy", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Copilot OAuth ──────────────────────────────────────────────────

export async function getCopilotStatus() {
  return request<{ data: { authenticated: boolean; login_at?: string | null } }>(
    "/config/copilot/status",
  );
}

export async function requestCopilotDeviceCode() {
  return request<{
    data: {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
  }>("/config/copilot/device-code", { method: "POST" });
}

export async function pollCopilotToken(device_code: string) {
  return request<{
    data: {
      status: string;
      error_description?: string;
      interval?: number;
    };
  }>("/config/copilot/poll-token", {
    method: "POST",
    body: JSON.stringify({ device_code }),
  });
}

export async function copilotLogout() {
  return request<{ ok: boolean }>("/config/copilot/logout", { method: "POST" });
}

export async function getCopilotModels() {
  return request<{ data: CopilotModelInfo[] }>("/config/copilot/models");
}
