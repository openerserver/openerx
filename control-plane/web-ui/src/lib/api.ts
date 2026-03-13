import { useAuthStore } from "../stores/auth";
import { normalizeRecoverySuggestions, type RecoverySuggestion } from "./recovery-suggestions";

const BASE_URL = "/api";

export interface ApiErrorPayload {
  error: string;
  code?: string;
  status?: number;
  diagnostics?: Record<string, unknown>;
  recoverySuggestions?: Array<RecoverySuggestion | string>;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  diagnostics?: Record<string, unknown>;
  recoverySuggestions: RecoverySuggestion[];

  constructor(payload: ApiErrorPayload) {
    super(payload.error || `HTTP ${payload.status || 500}`);
    this.name = "ApiError";
    this.status = payload.status || 500;
    this.code = payload.code;
    this.diagnostics = payload.diagnostics;
    this.recoverySuggestions = normalizeRecoverySuggestions(payload.recoverySuggestions);
  }
}

export function toApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) {
    return error;
  }
  return null;
}

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
    const error = (await response.json().catch(() => ({ error: "Request failed" }))) as ApiErrorPayload;
    throw new ApiError({
      ...error,
      status: response.status,
      error: error.error || `HTTP ${response.status}`,
    });
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
      email?: string | null;
      role: string;
      accountStatus?: "active" | "disabled";
      mustChangePassword?: boolean;
      lastLoginAt?: string | null;
      createdAt?: string;
      projects?: Array<{ id: string; role: string }>;
    };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export interface CurrentUserProfile {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  accountStatus: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  projects: Array<{
    id: string;
    role: string;
    name?: string;
    slug?: string;
    orgId?: string | null;
    orgName?: string | null;
  }>;
}

export async function getMyProfile() {
  return request<CurrentUserProfile>("/auth/me");
}

export async function updateMyProfile(data: {
  displayName?: string;
  email?: string | null;
  currentPassword?: string;
  newPassword?: string;
}) {
  return request<CurrentUserProfile>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type UserAccountStatus = "active" | "disabled";
export type UserRole = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  accountStatus: UserAccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  projects?: Array<{ projectId: string; projectName: string; role: string }>;
}

export interface AuditEvent {
  id: string;
  ts: string;
  userId: string | null;
  projectId: string | null;
  sessionId: string | null;
  taskId: string | null;
  agentRunId: string | null;
  eventType: string;
  action: string;
  target: string | null;
  detail?: Record<string, unknown> | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  traceId: string | null;
}

export async function listUsers() {
  return request<AdminUser[]>("/users");
}

export async function listAuditEvents(params?: {
  projectId?: string;
  userId?: string;
  from?: string;
  to?: string;
  type?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params?.projectId) query.set("projectId", params.projectId);
  if (params?.userId) query.set("userId", params.userId);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.type) query.set("type", params.type);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  return request<{ data: AuditEvent[]; limit: number; offset: number }>(
    `/audit${query.toString() ? `?${query.toString()}` : ""}`,
  );
}

export async function createUser(data: {
  username: string;
  password: string;
  displayName: string;
  email?: string | null;
  mustChangePassword?: boolean;
  role?: UserRole;
}) {
  return request<AdminUser>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateUser(
  userId: string,
  data: { displayName?: string; email?: string | null; password?: string },
) {
  return request<{ id: string; displayName?: string; email?: string | null; password?: string }>(
    `/users/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export async function setUserRole(userId: string, role: UserRole) {
  return request<{ id: string; role: UserRole }>(`/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export async function setUserStatus(userId: string, status: UserAccountStatus) {
  return request<{ id: string; accountStatus: UserAccountStatus }>(`/users/${userId}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function resetUserPassword(
  userId: string,
  data: { password: string; mustChangePassword?: boolean },
) {
  return request<{ id: string; mustChangePassword: boolean }>(`/users/${userId}/password`, {
    method: "PUT",
    body: JSON.stringify(data),
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
  executionMode?: ExecutionMode;
  executionPlan?: string;
  repoId?: string | null;
  workspaceRoot?: string | null;
  baseRevision?: string | null;
  workingBranch?: string | null;
  repoName?: string | null;
  remoteUrl?: string | null;
  selectedModel?: string | null;
  // Identity snapshot
  credentialId?: string | null;
  credentialLabel?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  gitCommitterName?: string | null;
  gitCommitterEmail?: string | null;
  // Post-execution facts
  finalCommitSha?: string | null;
  finalBranchName?: string | null;
  changesSummary?: {
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  } | null;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunningTaskReconcileSummary {
  scanned: number;
  completed: number;
  failed: number;
  recovered: number;
  skipped: number;
  runtimeAvailable: boolean;
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

const TASK_LIST_LIMIT = 200;

export async function listTasks(projectId?: string, status?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  params.set("limit", String(TASK_LIST_LIMIT));
  return request<{ data: Task[] }>(`/tasks?${params.toString()}`);
}

export { TASK_LIST_LIMIT };

export async function getTask(taskId: string) {
  return request<Task>(`/tasks/${taskId}`);
}

export async function updateTask(taskId: string, data: { selectedModel?: string | null }) {
  return request<Partial<Task>>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function createTask(data: {
  title: string;
  prompt: string;
  projectId: string;
  repoId?: string;
  workingBranch?: string;
  credentialId?: string;
  selectedModel?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  gitCommitterName?: string;
  gitCommitterEmail?: string;
}) {
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

// ── Runtime Pipeline ───────────────────────────────────────────────

export type RuntimePipelineStatus = "idle" | "running" | "completed" | "failed" | "paused";
export type RuntimePipelineStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface RuntimePipelineStage {
  id: string;
  type: "hook" | "planning" | "execution" | "judge" | "post-hook" | "graph-node";
  label: string;
  status: RuntimePipelineStageStatus;
  order: number;
  sourceType: "executionPlan.step" | "strategy.hookExecution" | "taskGraph.node" | "session.message";
  sourceId: string | null;
  agent: string | null;
  model: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: string | null;
  error: string | null;
  tokens: { input: number; output: number } | null;
  graphNodeId: string | null;
  dependsOn: string[];
  messageCount?: number;
}

export interface PipelineSummary {
  totalStages: number;
  completedStages: number;
  failedStages: number;
  currentStageId: string | null;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
  replanCount: number;
}

export interface RuntimePipeline {
  taskId: string;
  sessionId: string | null;
  branchName: string | null;
  status: RuntimePipelineStatus;
  createdAt: string | null;
  updatedAt: string;
  stages: RuntimePipelineStage[];
  summary: PipelineSummary;
}

export async function getTaskPipeline(taskId: string, sessionId?: string) {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  return request<RuntimePipeline>(`/tasks/${taskId}/pipeline${params.toString() ? `?${params.toString()}` : ""}`);
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

export async function forkTaskSession(taskId: string, sessionId: string, title?: string, messageId?: string) {
  return request<{ ok: boolean; sessionId: string; title?: string; parentSessionId?: string; forkedFromMessageId?: string }>(
    `/tasks/${taskId}/sessions/${sessionId}/fork`,
    {
      method: "POST",
      body: JSON.stringify({ title, messageId }),
    },
  );
}

// ── Session Tree (Branch Lineage) ──────────────────────────────────

export interface SessionTreeNode {
  id: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  forkedFromMessageRole: string | null;
  forkedFromMessagePreview: string | null;
  firstPromptAfterFork: string | null;
  branchName: string | null;
  sourceType: string;
  isActive: boolean;
  title: string | null;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  children: SessionTreeNode[];
}

export async function getSessionTree(taskId: string) {
  return request<{ data: SessionTreeNode[] }>(`/tasks/${taskId}/session-tree`);
}

export async function activateSession(taskId: string, sessionId: string) {
  return request<{ ok: boolean; sessionId: string }>(
    `/tasks/${taskId}/sessions/${sessionId}/activate`,
    { method: "POST" },
  );
}

export async function archiveTaskSession(taskId: string, sessionId: string) {
  return request<{ ok: boolean }>(
    `/tasks/${taskId}/sessions/${sessionId}/archive`,
    { method: "POST" },
  );
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

// ── Workbench Layout ───────────────────────────────────────────────

export interface WorkbenchLayoutPayload {
  tabs: Array<{ taskId: string; title?: string; status?: string; pinned?: boolean }>;
  activeTaskId: string;
  secondaryPane: { taskId: string; sessionId?: string; label?: string } | null;
  splitMode: boolean;
}

export async function getWorkbenchLayout() {
  return request<{ data: WorkbenchLayoutPayload }>("/workbench/layout");
}

export async function saveWorkbenchLayout(layout: WorkbenchLayoutPayload) {
  return request<{ ok: boolean }>("/workbench/layout", {
    method: "PUT",
    body: JSON.stringify(layout),
  });
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

// ── Repository Credentials ─────────────────────────────────────────

export type CredentialType = "pat" | "oauth_token" | "ssh_key_ref" | "app_installation";
export type CredentialScope = "project" | "shared";
export type CredentialStatus = "active" | "revoked" | "expired";

export interface RepositoryCredential {
  id: string;
  projectId: string;
  repoId: string | null;
  label: string;
  provider: RepositoryProvider;
  credentialType: CredentialType;
  secretRefMasked: string;
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  scope: CredentialScope;
  isDefault: boolean;
  status: CredentialStatus;
  createdAt: string;
  updatedAt: string;
}

export async function listCredentials(projectId: string, repoId?: string) {
  const params = new URLSearchParams({ projectId });
  if (repoId) params.set("repoId", repoId);
  return request<{ data: RepositoryCredential[] }>(`/credentials?${params.toString()}`);
}

export async function createCredential(
  projectId: string,
  data: {
    repoId?: string;
    label: string;
    provider: RepositoryProvider;
    credentialType: CredentialType;
    secretRef: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
    scope?: CredentialScope;
    isDefault?: boolean;
  },
) {
  return request<{ id: string; label: string; status: string }>("/credentials", {
    method: "POST",
    body: JSON.stringify({ projectId, ...data }),
  });
}

export async function updateCredential(
  projectId: string,
  credentialId: string,
  data: {
    label?: string;
    secretRef?: string;
    gitAuthorName?: string | null;
    gitAuthorEmail?: string | null;
    isDefault?: boolean;
    status?: CredentialStatus;
  },
) {
  return request<{ id: string }>(`/credentials/${encodeURIComponent(credentialId)}`, {
    method: "PATCH",
    body: JSON.stringify({ projectId, ...data }),
  });
}

export async function revokeCredential(projectId: string, credentialId: string) {
  return request<{ ok: boolean }>(
    `/credentials/${encodeURIComponent(credentialId)}?projectId=${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
}

// ── Repositories ───────────────────────────────────────────────────

export type RepositoryProvider = "github" | "gitlab" | "gitea" | "local";
export type RepositoryStatus = "active" | "archived" | "error";

export interface Repository {
  id: string;
  projectId: string;
  name: string;
  provider: RepositoryProvider;
  remoteUrl: string;
  defaultBranch: string;
  description: string | null;
  status: RepositoryStatus;
  createdAt: string;
  updatedAt: string;
}

export async function listRepositories(projectId: string) {
  return request<{ data: Repository[] }>(
    `/repositories?projectId=${encodeURIComponent(projectId)}`,
  );
}

export async function createRepository(data: {
  projectId: string;
  name: string;
  provider: RepositoryProvider;
  remoteUrl: string;
  defaultBranch?: string;
  description?: string;
}) {
  return request<Repository>("/repositories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRepository(
  repoId: string,
  data: {
    projectId: string;
    name?: string;
    provider?: RepositoryProvider;
    remoteUrl?: string;
    defaultBranch?: string;
    description?: string | null;
    status?: RepositoryStatus;
  },
) {
  return request<Repository>(`/repositories/${repoId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function archiveRepository(repoId: string, projectId: string) {
  return request<{ ok: boolean }>(
    `/repositories/${repoId}?projectId=${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
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

// ── Project Overview ───────────────────────────────────────────────

export interface ProjectOverviewItem {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  slug: string;
  description?: string | null;
  projectStatus: "healthy" | "pending_config" | "archived" | "error";
  completedCount: number;
  totalRequiredCount: number;
  completionPercent: number;
  risks: string[];
  runningTasks: number;
  pendingApprovals: number;
  failedTasksToday: number;
  lastActivityAt?: string | null;
  memberCount: number;
  repositoryCount: number;
  environmentCount: number;
  currentUserRole?: string | null;
  isCurrentUserManager: boolean;
  createdAt?: string;
}

export interface ProjectOverviewResponse {
  data: ProjectOverviewItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: {
    totalProjects: number;
    pendingConfigCount: number;
    riskCount: number;
  };
}

export async function listProjectOverview(params?: {
  q?: string;
  orgId?: string;
  status?: string;
  configStatus?: string;
  onlyManaged?: boolean;
  sortBy?: string;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.orgId) query.set("orgId", params.orgId);
  if (params?.status) query.set("status", params.status);
  if (params?.configStatus) query.set("configStatus", params.configStatus);
  if (params?.onlyManaged) query.set("onlyManaged", "true");
  if (params?.sortBy) query.set("sortBy", params.sortBy);
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  return request<ProjectOverviewResponse>(`/projects/overview${qs ? `?${qs}` : ""}`);
}

export async function archiveProject(projectId: string) {
  return request<{ ok: boolean; id: string; status: string }>(`/projects/${projectId}/archive`, {
    method: "PATCH",
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

export async function updateTaskStatus(taskId: string, status: string) {
  return request<{ id: string; status: string }>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function reconcileRunningTasks() {
  return request<{ ok: boolean; data: RunningTaskReconcileSummary }>("/tasks/reconcile-running", {
    method: "POST",
  });
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

export interface DiscoveredProviderModel {
  id: string;
  name: string;
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
export async function getModelsList() {
  return request<{ data: Array<Record<string, unknown>> }>("/config/models/list");
}
export async function updateModelsConfig(data: ModelsConfig) {
  return request<{ ok: boolean; restartRequired: boolean }>("/config/models", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
export async function testModelProvider(data: { key?: string; provider: Record<string, unknown> }) {
  return request<{
    data: {
      ok: boolean;
      message: string;
      status?: number;
      modelCount?: number;
      models?: DiscoveredProviderModel[];
    };
  }>(
    "/config/models/providers/test",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
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

export type HookTrigger = "pre-execution" | "post-execution" | "on-failure" | "pre-resume";

export interface LifecycleHook {
  id: string;
  trigger: HookTrigger;
  enabled: boolean;
  agent: string;
  model?: string;
  promptTemplate: string;
  timeoutMs: number;
  order: number;
}

export type ExecutionMode = "single" | "parallel";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  mode: ExecutionMode;
  agents: string[];
  maxParallelCandidates?: number;
  enabled: boolean;
  categoryDefaults?: string[];
}

export interface JudgeConfig {
  enabled: boolean;
  agent: string;
  model: string;
  promptTemplate: string;
  timeoutMs: number;
  selectionStrategy: "judge-pick" | "highest-score";
}

export interface ExecutionCandidate {
  label: string;
  agent: string;
  model?: string;
  sessionId?: string;
  agentRunId?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExecutionPlan {
  templateId: string;
  mode: ExecutionMode;
  candidates: ExecutionCandidate[];
  judgeResult?: JudgeResult;
  winnerCandidateIndex?: number;
}

export interface JudgeResult {
  status: "completed" | "failed" | "skipped";
  sessionId?: string;
  winnerIndex?: number;
  scores?: number[];
  reasoning: string;
  completedAt: string;
}

export interface HookDecision {
  action:
    | "allow"
    | "deny"
    | "rewrite-prompt"
    | "request-approval"
    | "switch-model"
    | "spawn-followup";
  reason?: string;
  rewrittenPrompt?: string;
  targetModel?: string;
}

export interface HookExecutionRecord {
  hookId: string;
  trigger: HookTrigger;
  status: "completed" | "failed" | "skipped";
  agent: string;
  model?: string;
  result?: string;
  error?: string;
  sessionId?: string;
  decision?: HookDecision;
  completedAt: string;
}

export interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  hooks: LifecycleHook[];
  templates: WorkflowTemplate[];
  judge: JudgeConfig;
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

export async function getCopilotStatus(provider = "github-copilot") {
  return request<{ data: { authenticated: boolean; login_at?: string | null } }>(
    `/config/copilot/status?provider=${encodeURIComponent(provider)}`,
  );
}

export async function requestCopilotDeviceCode(provider = "github-copilot") {
  return request<{
    data: {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
  }>(`/config/copilot/device-code?provider=${encodeURIComponent(provider)}`, { method: "POST" });
}

export async function pollCopilotToken(device_code: string, provider = "github-copilot") {
  return request<{
    data: {
      status: string;
      error_description?: string;
      interval?: number;
    };
  }>(`/config/copilot/poll-token?provider=${encodeURIComponent(provider)}`, {
    method: "POST",
    body: JSON.stringify({ device_code }),
  });
}

export async function copilotLogout(provider = "github-copilot") {
  return request<{ ok: boolean }>(`/config/copilot/logout?provider=${encodeURIComponent(provider)}`, { method: "POST" });
}

export async function getCopilotModels(provider = "github-copilot") {
  return request<{ data: CopilotModelInfo[] }>(`/config/copilot/models?provider=${encodeURIComponent(provider)}`);
}

// ── Code Changes ───────────────────────────────────────────────────

export interface CodeChange {
  id: string;
  taskId: string;
  repoId: string | null;
  agentRunId: string | null;
  changeSource: "runtime_diff" | "task_snapshot" | "git_commit";
  commitSha: string | null;
  commitAuthorName: string | null;
  commitAuthorEmail: string | null;
  commitMessage: string | null;
  branchName: string | null;
  summary: string | null;
  createdAt: string;
}

export interface FileChange {
  id: string;
  changeId: string;
  filePath: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  oldPath: string | null;
  insertions: number;
  deletions: number;
}

export async function getTaskChanges(taskId: string) {
  return request<{ data: CodeChange[] }>(`/tasks/${encodeURIComponent(taskId)}/changes`);
}

export async function getChangeFiles(taskId: string, changeId: string) {
  return request<{ data: FileChange[] }>(
    `/tasks/${encodeURIComponent(taskId)}/changes/${encodeURIComponent(changeId)}/files`,
  );
}

// ── Governance ─────────────────────────────────────────────────────

export interface GovernanceSummary {
  overallRisk: "low" | "medium" | "high" | "critical";
  violations: Array<{
    ruleId: string;
    ruleName: string;
    level: string;
    detail: string;
  }>;
  approvalRequired: boolean;
}

export async function getTaskGovernance(taskId: string) {
  return request<GovernanceSummary>(`/tasks/${encodeURIComponent(taskId)}/governance`);
}
