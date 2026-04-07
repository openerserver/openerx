import { useAuthStore } from "../stores/auth";
import { type RecoverySuggestion, normalizeRecoverySuggestions } from "./recovery-suggestions";
import { buildMergedTraceTimelineItems } from "./task-trace-conversation";

const BASE_URL = "/api";

export interface ApiErrorPayload {
  error: string;
  code?: string;
  status?: number;
  diagnostics?: Record<string, unknown>;
  recoverySuggestions?: Array<RecoverySuggestion | string>;
  taskId?: string;
  allowed?: boolean;
  effectiveModel?: string;
  guardDecision?: GuardDecision;
  guardReason?: string;
  suggestedModel?: string;
  activeLease?: PaidExecutionLeaseRecord | null;
  policy?: ModelExecutionPolicy;
  requirements?: PaidExecutionRequirements;
  preflight?: PaidExecutionEstimate;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  diagnostics?: Record<string, unknown>;
  recoverySuggestions: RecoverySuggestion[];
  taskId?: string;
  allowed?: boolean;
  effectiveModel?: string;
  guardDecision?: GuardDecision;
  guardReason?: string;
  suggestedModel?: string;
  activeLease?: PaidExecutionLeaseRecord | null;
  policy?: ModelExecutionPolicy;
  requirements?: PaidExecutionRequirements;
  preflight?: PaidExecutionEstimate;

  constructor(payload: ApiErrorPayload) {
    super(payload.error || `HTTP ${payload.status || 500}`);
    this.name = "ApiError";
    this.status = payload.status || 500;
    this.code = payload.code;
    this.diagnostics = payload.diagnostics;
    this.recoverySuggestions = normalizeRecoverySuggestions(payload.recoverySuggestions);
    this.taskId = payload.taskId;
    this.allowed = payload.allowed;
    this.effectiveModel = payload.effectiveModel;
    this.guardDecision = payload.guardDecision;
    this.guardReason = payload.guardReason;
    this.suggestedModel = payload.suggestedModel;
    this.activeLease = payload.activeLease;
    this.policy = payload.policy;
    this.requirements = payload.requirements;
    this.preflight = payload.preflight;
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
    const error = (await response
      .json()
      .catch(() => ({ error: "Request failed" }))) as ApiErrorPayload;
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

export async function getWorkspaceFileContent(path: string) {
  const query = new URLSearchParams({ path });
  return request<{
    path: string;
    content: string;
    size: number;
    truncated: boolean;
    previewBytes: number;
    canExpand: boolean;
  }>(`/workspace-files/content?${query.toString()}`);
}

export async function getWorkspaceFileContentFull(path: string) {
  const query = new URLSearchParams({ path, full: "true" });
  return request<{
    path: string;
    content: string;
    size: number;
    truncated: boolean;
    previewBytes: number;
    canExpand: boolean;
  }>(`/workspace-files/content?${query.toString()}`);
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

export interface AgentRunSummary {
  agentRunId: string;
  subSessionId: string;
  status: string;
  taskId: string;
  projectId?: string;
  agentType?: string;
  startedAt?: number;
  finishedAt?: string;
  pausedAt?: number;
  candidateIndex?: number;
}

export interface TaskAgentRunRecord {
  id: string;
  taskId: string;
  sessionId?: string | null;
  runId?: string | null;
  runNodeId?: string | null;
  agentType: string;
  status: string;
  modelUsed?: string | null;
  tokenUsed: number;
  result?: string | null;
  error?: string | null;
  candidateIndex?: number | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface TaskDomainRunRecord {
  id: string;
  taskId: string;
  projectId: string;
  orchestrationKind: string;
  triggerType: string;
  sourceType?: string | null;
  status: string;
  rootSessionId?: string | null;
  winnerNodeId?: string | null;
  judgeNodeId?: string | null;
  requestedModel?: string | null;
  effectiveModel?: string | null;
  pipelineStepCount?: number | null;
  candidateCount?: number | null;
  resultText?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDomainRunNodeRecord {
  id: string;
  runId: string;
  taskId: string;
  projectId: string;
  nodeKind: string;
  nodeKey: string;
  title?: string | null;
  instruction?: string | null;
  candidateIndex?: number | null;
  chainStepIndex?: number | null;
  hookTrigger?: string | null;
  agentType?: string | null;
  modelUsed?: string | null;
  sessionId?: string | null;
  agentRunId?: string | null;
  status: string;
  resultText?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
  tokenUsed?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDomainRunDetailRecord {
  run: TaskDomainRunRecord;
  nodes: TaskDomainRunNodeRecord[];
  candidateNodes: TaskDomainRunNodeRecord[];
  judgeNode: TaskDomainRunNodeRecord | null;
  winnerCandidateIndex: number | null;
}

export async function listAgentRuns() {
  return request<AgentRunSummary[]>("/agents");
}

export type AgentOpsViewMode = "user" | "admin";
export type AgentOpsOwnerScope = "mine" | "all";
export type AgentOpsQueue = "attention" | "running" | "recent";
export type AgentOpsEntryContext = "nav" | "task" | "workbench" | "approval" | "alert";

export interface AgentOpsActionPermissions {
  canPause: boolean;
  canResume: boolean;
  canTerminate: boolean;
  canInjectGuidance: boolean;
  canViewApproval: boolean;
  canViewAudit: boolean;
  canViewCodeChanges: boolean;
  canExport: boolean;
}

export interface AgentOpsPageQuery {
  ownerScope?: AgentOpsOwnerScope;
  queue?: AgentOpsQueue;
  projectId?: string;
  taskId?: string;
  agentRunId?: string;
  search?: string;
  status?: "running" | "paused" | "failed" | "completed" | "stopped" | "terminated";
  riskLevel?: "low" | "medium" | "high" | "critical";
  approvalBlocked?: boolean;
  requiresIntervention?: boolean;
  agentType?: string;
  model?: string;
  from?: string;
  to?: string;
  entryContext?: AgentOpsEntryContext;
}

export interface AgentOpsOverview {
  viewScope?: "mine" | "project" | "global";
  summary: {
    attentionCount: number;
    runningCount: number;
    completedCount: number;
    failureRate: number;
    avgDurationMs: number | null;
    humanInterventionRate: number;
  };
  queueCounts: {
    attention: number;
    running: number;
    recent: number;
  };
  blockerBreakdown?: {
    failedHighRisk: number;
    approvalBlocked: number;
    pausedAwaitingResume: number;
    stalled: number;
    stoppedPendingReview: number;
  };
  generatedAt: string;
}

export interface AgentOpsQueueItem {
  agentRunId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  agentType: string;
  status: string;
  currentStage: string | null;
  blockerType: string | null;
  blockerLabel: string;
  blockerReason: string | null;
  riskLevel: string | null;
  approvalStatus: string | null;
  requiresIntervention: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  durationMs: number | null;
  modelUsed: string | null;
  tokenUsed: number;
  resultSummary: string | null;
  guidanceCount: number;
  primaryAttentionReason?: string | null;
  quickActions?: string[];
  actionPermissions?: Partial<AgentOpsActionPermissions> | null;
}

export interface AgentOpsQueueResponse {
  data: AgentOpsQueueItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AgentOpsQueueQuery extends AgentOpsPageQuery {
  page?: number;
  pageSize?: number;
}

export interface AgentRunOpsSummary {
  agentRunId: string;
  entryContext?: AgentOpsEntryContext;
  viewScope?: "mine" | "project" | "global";
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  agentType: string;
  status: string;
  sessionId: string | null;
  modelUsed: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  durationMs: number | null;
  tokenUsed: number;
  blockerType: string | null;
  blockerLabel: string;
  riskLevel: string | null;
  guidanceCount: number;
  resultSummary: string | null;
  result: string | null;
  error: string | null;
  longSummary: string | null;
  latestEvents: Array<{ ts: string; type: string; summary: string }>;
  actionPermissions?: Partial<AgentOpsActionPermissions> | null;
  governance?: {
    approvalTickets?: number;
    pendingApprovals?: number;
    latestApprovalStatus?: string | null;
    recentAuditEvents?: number;
    latestHighRiskAction?: string | null;
  } | null;
  codeChanges?: {
    changeCount?: number;
    files?: number;
    insertions?: number;
    deletions?: number;
    latestSummary?: string | null;
  } | null;
  subSessionId?: string;
}

export interface AgentOpsAnalyticsRankingItem {
  key: string;
  label: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  attentionCount: number;
  interventionCount: number;
  successRate: number;
  failureRate: number;
  avgDurationMs: number | null;
  avgTokenUsed: number | null;
}

export interface AgentOpsAnalyticsHealthView {
  viewScope?: "mine" | "project" | "global";
  generatedAt: string;
  totals: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    stoppedRuns: number;
    humanInterventionRuns: number;
    attentionRuns: number;
    approvalBlockedRuns: number;
    avgDurationMs: number | null;
    failureRate: number;
    interventionRate: number;
  };
  agentRanking: AgentOpsAnalyticsRankingItem[];
  modelRanking: AgentOpsAnalyticsRankingItem[];
}

export interface AgentOpsAnalyticsBreakdownItem {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface AgentOpsAnalyticsFailuresView {
  generatedAt: string;
  totalAttentionRuns: number;
  blockerBreakdown: AgentOpsAnalyticsBreakdownItem[];
  failureReasons: AgentOpsAnalyticsBreakdownItem[];
  riskBreakdown: AgentOpsAnalyticsBreakdownItem[];
}

export interface AgentOpsAnalyticsTimelineBucket {
  bucket: string;
  label: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  attentionRuns: number;
  interventionRuns: number;
}

export interface AgentOpsAnalyticsTimelineView {
  generatedAt: string;
  bucketUnit: "hour" | "day";
  buckets: AgentOpsAnalyticsTimelineBucket[];
}

export interface AgentOpsAnalyticsView {
  health: AgentOpsAnalyticsHealthView;
  failures: AgentOpsAnalyticsFailuresView;
  timeline: AgentOpsAnalyticsTimelineView;
}

export type DashboardProviderTokenRange = "24h" | "7d" | "30d" | "monthly";

export interface DashboardProviderTokenBucket {
  bucket: string;
  tokenUsed: number;
  completedRuns: number;
}

export interface DashboardProviderMonthlyBucket {
  month: string;
  tokenUsed: number;
  completedRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerCompletedRun: number;
}

export interface DashboardProviderModelItem {
  route: string;
  modelId: string;
  label: string;
  tokenUsed: number;
  requestCount: number;
  tokenShareWithinProvider: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerRun: number;
  avgTokensPerCompletedRun: number;
  latestRunAt: string | null;
}

export interface DashboardProviderTokenItem {
  providerId: string;
  label: string;
  tokenUsed: number;
  requestCount: number;
  tokenShare: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerRun: number;
  avgTokensPerCompletedRun: number;
  latestRunAt: string | null;
  trend: DashboardProviderTokenBucket[];
  monthly: DashboardProviderMonthlyBucket[];
  health: "healthy" | "warn" | "risk";
  reasons: string[];
  recommendationAction: "keep" | "observe" | "downgrade";
  recommendationLabel: string;
  recommendationMessage: string;
  models: DashboardProviderModelItem[];
}

export interface DashboardProviderTokenSummary {
  range: DashboardProviderTokenRange;
  totalTokens: number;
  requestCount: number;
  totalRuns: number;
  completedRuns: number;
  topProviderId: string | null;
  topProviderShare: number;
  avgTokensPerCompletedRun: number;
  riskProviderCount: number;
  monthlyTotals?: Array<{ month: string; tokenUsed: number; completedRuns: number }>;
}

export interface DashboardProviderTokenResponse {
  projectId: string;
  range: DashboardProviderTokenRange;
  generatedAt: string;
  summary: DashboardProviderTokenSummary;
  providers: DashboardProviderTokenItem[];
}

export interface DashboardGovernanceTopRiskTaskItem {
  taskId: string;
  projectId: string;
  title: string;
  runtimeSessionId: string | null;
  requestCount: number;
  totalTokens: number;
  costUsd: number;
  blockedCount: number;
  breakerCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  parallelCandidateCount: number;
  riskScore: number;
  dominantDriver: string;
  lastGuardDecision: string | null;
  lastGuardReason: string | null;
  lastBreakerReason: string | null;
  lastActivityAt: string | null;
}

export interface DashboardGovernanceRecentEventItem {
  id: string;
  projectId: string;
  taskId: string | null;
  title: string;
  runtimeSessionId: string | null;
  eventKind: "guard" | "breaker";
  action: string;
  guardDecision: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface DashboardGovernanceOverviewResponse {
  range: DashboardProviderTokenRange;
  generatedAt: string;
  summary: {
    blockedCount: number;
    breakerCount: number;
    activeLeaseCount: number;
    topRiskTaskCount: number;
    runningTaskCount: number;
    activeSessionCount: number;
    parallelTaskCount: number;
    sequentialChainTaskCount: number;
    recentTimelineItemCount: number;
    pausedTaskCount: number;
    failedTaskCount: number;
    activeCandidateCount: number;
    pendingChainStepCount: number;
    toolTimelineItemCount: number;
    decisionTimelineItemCount: number;
  };
  topRiskTasks: DashboardGovernanceTopRiskTaskItem[];
  recentEvents: DashboardGovernanceRecentEventItem[];
}

export async function getAgentOpsOverview(query: AgentOpsPageQuery = {}) {
  const params = new URLSearchParams();
  if (query.ownerScope) params.set("ownerScope", query.ownerScope);
  if (query.projectId) params.set("projectId", query.projectId);
  if (query.taskId) params.set("taskId", query.taskId);
  if (query.agentRunId) params.set("agentRunId", query.agentRunId);
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.riskLevel) params.set("riskLevel", query.riskLevel);
  if (typeof query.approvalBlocked === "boolean") {
    params.set("approvalBlocked", String(query.approvalBlocked));
  }
  if (typeof query.requiresIntervention === "boolean") {
    params.set("requiresIntervention", String(query.requiresIntervention));
  }
  if (query.agentType) params.set("agentType", query.agentType);
  if (query.model) params.set("model", query.model);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.entryContext) params.set("entryContext", query.entryContext);
  return request<AgentOpsOverview>(
    `/agents/overview${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

function appendAgentOpsQueueQueryParams(params: URLSearchParams, query: AgentOpsQueueQuery) {
  appendAgentOpsQueueIdentityParams(params, query);
  appendAgentOpsQueueFilterParams(params, query);
  appendAgentOpsQueuePaginationParams(params, query);
}

function appendAgentOpsQueueIdentityParams(params: URLSearchParams, query: AgentOpsQueueQuery) {
  if (query.ownerScope) params.set("ownerScope", query.ownerScope);
  if (query.projectId) params.set("projectId", query.projectId);
  if (query.taskId) params.set("taskId", query.taskId);
  if (query.agentRunId) params.set("agentRunId", query.agentRunId);
}

function appendAgentOpsQueueFilterParams(params: URLSearchParams, query: AgentOpsQueueQuery) {
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.riskLevel) params.set("riskLevel", query.riskLevel);
  if (typeof query.approvalBlocked === "boolean") {
    params.set("approvalBlocked", String(query.approvalBlocked));
  }
  if (typeof query.requiresIntervention === "boolean") {
    params.set("requiresIntervention", String(query.requiresIntervention));
  }
  if (query.agentType) params.set("agentType", query.agentType);
  if (query.model) params.set("model", query.model);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.entryContext) params.set("entryContext", query.entryContext);
}

function appendAgentOpsQueuePaginationParams(params: URLSearchParams, query: AgentOpsQueueQuery) {
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
}

export async function getAgentOpsQueue(queue: AgentOpsQueue, query: AgentOpsQueueQuery = {}) {
  const params = new URLSearchParams({ queue });
  appendAgentOpsQueueQueryParams(params, query);
  return request<AgentOpsQueueResponse>(`/agents/queues?${params.toString()}`);
}

export async function getAgentRunOpsSummary(
  agentRunId: string,
  query: Pick<AgentOpsPageQuery, "entryContext" | "ownerScope"> = {},
) {
  const params = new URLSearchParams();
  if (query.entryContext) params.set("entryContext", query.entryContext);
  if (query.ownerScope) params.set("ownerScope", query.ownerScope);
  return request<AgentRunOpsSummary>(
    `/agents/${agentRunId}/summary${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

function buildAgentOpsAnalyticsParams(query: AgentOpsPageQuery = {}) {
  const params = new URLSearchParams();
  if (query.ownerScope) params.set("ownerScope", query.ownerScope);
  if (query.projectId) params.set("projectId", query.projectId);
  if (query.taskId) params.set("taskId", query.taskId);
  if (query.agentRunId) params.set("agentRunId", query.agentRunId);
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.riskLevel) params.set("riskLevel", query.riskLevel);
  if (typeof query.approvalBlocked === "boolean")
    params.set("approvalBlocked", String(query.approvalBlocked));
  if (typeof query.requiresIntervention === "boolean")
    params.set("requiresIntervention", String(query.requiresIntervention));
  if (query.agentType) params.set("agentType", query.agentType);
  if (query.model) params.set("model", query.model);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.entryContext) params.set("entryContext", query.entryContext);
  return params;
}

export async function getAgentOpsAnalyticsHealth(query: AgentOpsPageQuery = {}) {
  const params = buildAgentOpsAnalyticsParams(query);
  return request<AgentOpsAnalyticsHealthView>(
    `/agents/analytics/health${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export async function getAgentOpsAnalyticsFailures(query: AgentOpsPageQuery = {}) {
  const params = buildAgentOpsAnalyticsParams(query);
  return request<AgentOpsAnalyticsFailuresView>(
    `/agents/analytics/failures${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export async function getAgentOpsAnalyticsTimeline(query: AgentOpsPageQuery = {}) {
  const params = buildAgentOpsAnalyticsParams(query);
  return request<AgentOpsAnalyticsTimelineView>(
    `/agents/analytics/timeline${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export async function getDashboardProviderTokens(
  projectId: string,
  range: DashboardProviderTokenRange = "24h",
) {
  const params = new URLSearchParams({ projectId, range });
  return request<DashboardProviderTokenResponse>(`/dashboard/provider-tokens?${params.toString()}`);
}

export async function getDashboardGovernanceOverview(range: DashboardProviderTokenRange = "24h") {
  const params = new URLSearchParams({ range });
  return request<DashboardGovernanceOverviewResponse>(
    `/dashboard/governance-overview?${params.toString()}`,
  );
}

export async function getAgentMessages(agentRunId: string) {
  return request<{ ok: boolean; data?: unknown }>(`/agents/${agentRunId}/messages`);
}

// ── Tasks ──────────────────────────────────────────────────────────

export interface Task {
  id: string;
  projectId: string;
  userId: string | null;
  title: string;
  prompt: string;
  status: string;
  sessionId?: string;
  agentRunId?: string;
  result?: string;
  category?: string;
  strategy?: string;
  executionMode?: ExecutionMode;
  autoAdvanceStages?: boolean;
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
  orchestrationKind?: string | null;
  currentRunId?: string | null;
  currentRunStatus?: string | null;
  currentRunStartedAt?: string | null;
  currentRunFinishedAt?: string | null;
  currentRunCandidateCount?: number | null;
  currentRunPipelineStepCount?: number | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  activeCandidateCount?: number;
  completedCandidateCount?: number;
  failedCandidateCount?: number;
  totalChainSteps?: number;
  completedChainSteps?: number;
  winnerNodeId?: string | null;
  lastActivityAt?: string | null;
}

export interface ProjectionRunCandidate {
  label: string;
  agent?: string;
  model?: string;
  role?: string;
  status: string;
  sessionId?: string;
  agentRunId?: string;
  result?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ProjectionRunRecord {
  parallelRunId: string;
  templateId?: string;
  startedAt: string;
  finishedAt?: string;
  parentSessionId?: string | null;
  executionSessionId?: string | null;
  winnerCandidateIndex?: number;
  judgeResult?: RuntimePlan["judgeResult"];
  candidateSessions: ProjectionRunCandidate[];
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
  allowPaidExecution?: boolean;
  workflowTemplateId?: string;
  approvalPolicyTemplateId?: string;
  projectGroupKey?: string | null;
  projectGroupLabel?: string | null;
  approvalPolicy?: ApprovalPolicyMode;
  environmentApprovalPolicies?: Record<string, EnvironmentApprovalPolicyBinding>;
  maxConcurrency?: number;
  budgetMonthly?: number;
  budgetConfigId?: string;
  warnThreshold?: number;
  throttleThreshold?: number;
  collaborationMode?: CollaborationMode;
  autopilotLevel?: AutopilotLevel;
  bossParticipationMode?: BossParticipationMode;
  preferredTemplateId?: string | null;
  allowBossAutoTemplateSwitch?: boolean;
  allowHybridEscalation?: boolean;
}

export type GuardDecision = "allow" | "allow-with-downgrade" | "require-approval" | "deny";

export interface ExecutionEstimateRange {
  min: number;
  max: number;
}

export interface PaidExecutionRiskDriver {
  type: "parallel" | "judge" | "hook" | "suite" | "model" | "budget";
  label: string;
  impact: "low" | "medium" | "high";
  detail: string;
}

export interface PaidExecutionEstimate {
  providerId: string;
  modelId: string;
  requestCount: ExecutionEstimateRange;
  inputTokens: ExecutionEstimateRange;
  outputTokens: ExecutionEstimateRange;
  totalTokens: ExecutionEstimateRange;
  costUsd: ExecutionEstimateRange;
  riskDrivers: PaidExecutionRiskDriver[];
  budgetHeadroom: {
    remainingUsd: number | null;
    enoughForSingleRun: boolean;
    enoughForSuiteRun: boolean;
  };
  baselineSource?: {
    source: "historical" | "heuristic";
    matchScope?: string;
    sampleSize?: number;
    lastLedgerAt?: string | null;
  };
  guardDecision: GuardDecision;
  guardReason: string;
  generatedAt: string;
}

export interface ModelExecutionPolicy {
  providerId: string;
  modelId: string;
  modelRoute: string;
  environment: "dev" | "test" | "staging" | "prod";
  costTier: "free" | "low" | "medium" | "high" | "premium";
  isPaid: boolean;
  defaultDecision: GuardDecision;
  maxRequestsPerRun: number;
  maxEstimatedCostUsdPerRun: number;
  maxParallelCandidates: number;
  allowJudge: boolean;
  allowHooks: boolean;
  requiresExplicitGate: boolean;
  requiresLease: boolean;
  suggestedModel?: string;
}

export interface PaidExecutionLeaseRecord {
  id: string;
  projectId: string;
  issuedByUserId?: string | null;
  revokedByUserId?: string | null;
  reason?: string | null;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string | null;
}

export interface PaidExecutionRequirements {
  allowPaidExecution: boolean;
  leaseRequired: boolean;
  hasAllowPaidExecution: boolean;
  hasLease: boolean;
  leaseId: string | null;
}

export interface TaskExecutionPreflightResponse {
  taskId: string;
  allowed: boolean;
  effectiveModel: string;
  activeLease: PaidExecutionLeaseRecord | null;
  policy: ModelExecutionPolicy;
  requirements: PaidExecutionRequirements;
  preflight: PaidExecutionEstimate;
}

export interface ProjectExecutionPreflightResponse {
  projectId: string;
  defaultModel: string | null;
  effectiveModel: string;
  allowed: boolean;
  activeLease: PaidExecutionLeaseRecord | null;
  policy: ModelExecutionPolicy;
  requirements: PaidExecutionRequirements;
  preflight: PaidExecutionEstimate;
}

export interface PaidExecutionLeaseStateResponse {
  projectId: string;
  activeLease: PaidExecutionLeaseRecord | null;
  now: string;
}

export interface RuntimeUsageLedgerRecord {
  id: string;
  projectId: string;
  taskId?: string | null;
  agentRunId?: string | null;
  runtimeSessionId: string;
  executionSource: string;
  entrypointType: string;
  orchestrationFingerprint?: string | null;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  requestCount: number;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  candidateCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt?: string | null;
  finishedAt?: string | null;
  syncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeUsageLedgerStepRecord {
  id: string;
  ledgerId: string;
  projectId: string;
  taskId?: string | null;
  agentRunId?: string | null;
  runtimeSessionId?: string | null;
  stepType: "execution" | "judge" | "hook" | "resume" | "other";
  triggerType?: string | null;
  hookId?: string | null;
  candidateIndex?: number | null;
  requestIndex: number;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  amplificationSource?: string | null;
  status: "pending" | "completed" | "failed" | "skipped";
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRuntimeUsageLedgerListResponse {
  projectId: string;
  totals: {
    ledgerCount: number;
    requestCount: number;
    stepCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  items: RuntimeUsageLedgerRecord[];
}

export interface ProjectRuntimeUsageLedgerDetailResponse {
  projectId: string;
  ledger: RuntimeUsageLedgerRecord;
  steps: RuntimeUsageLedgerStepRecord[];
  breakdown: {
    byStepType: Record<string, number>;
  };
}

export type CollaborationMode = "solo" | "team" | "hybrid";

export type AutopilotLevel = "L0" | "L1" | "L2";

export type BossParticipationMode = "disabled" | "advisory" | "exception-only" | "full-manager";

export interface RecommendedOperatingProfile {
  scenarioKey: string;
  collaborationMode: CollaborationMode;
  autopilotLevel: AutopilotLevel;
  bossParticipationMode: BossParticipationMode;
  templateHints?: string[];
  requiredRoleHints?: string[];
  reason: string;
}

export interface PlatformOrganizationSettings {
  defaultCollaborationMode: CollaborationMode;
  defaultAutopilotLevel: AutopilotLevel;
  defaultBossParticipationMode: BossParticipationMode;
  allowProjectModeOverride: boolean;
  allowTaskModeOverride: boolean;
  requireHumanApprovalForL2: boolean;
  hybridEscalationRules?: Array<Record<string, unknown>>;
  recommendedProfiles: RecommendedOperatingProfile[];
}

export interface OperatingModeSelection {
  collaborationMode: CollaborationMode;
  autopilotLevel: AutopilotLevel;
  bossParticipationMode: BossParticipationMode;
  selectedTemplateId?: string | null;
  scenarioKey?: string;
  source: "system-default" | "project-default" | "task-override" | "boss-decision";
}

export interface BossDecisionRecord {
  id: string;
  ts: string;
  decisionType: string;
  reason: string;
  confidence?: number;
  stageKey?: string;
  metadata?: Record<string, unknown>;
}

export interface HumanEscalationRequest {
  id: string;
  ts: string;
  reason: string;
  status?: string;
  stageKey?: string;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskOperatingState {
  collaborationMode?: CollaborationMode;
  autopilotLevel?: AutopilotLevel;
  bossParticipationMode?: BossParticipationMode;
  operatingModeSource?: OperatingModeSelection["source"];
  currentStageKey?: string;
  currentStageStatus?: string;
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

// Task detail read model only. This endpoint is not the canonical task tree contract.
export async function getTask(taskId: string) {
  return request<Task>(`/tasks/${taskId}`);
}

export async function getTaskOperatingState(taskId: string) {
  return request<TaskOperatingState>(`/tasks/${taskId}/operating-state`);
}

export async function getTaskOperatingMode(taskId: string) {
  return request<{ data: OperatingModeSelection | null }>(`/tasks/${taskId}/operating-mode`);
}

export async function updateTaskOperatingMode(taskId: string, data: OperatingModeSelection) {
  return request<{ ok: boolean; data: OperatingModeSelection | null }>(
    `/tasks/${taskId}/operating-mode`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
}

export async function deleteTaskOperatingMode(taskId: string) {
  return request<{ ok: boolean }>(`/tasks/${taskId}/operating-mode`, {
    method: "DELETE",
  });
}

export async function getTaskBossDecisions(taskId: string) {
  return request<{ data: BossDecisionRecord[] }>(`/tasks/${taskId}/boss-decisions`);
}

export async function getTaskEscalations(taskId: string) {
  return request<{ data: HumanEscalationRequest[] }>(`/tasks/${taskId}/escalations`);
}

export async function updateTask(
  taskId: string,
  data: {
    selectedModel?: string | null;
    autoAdvanceStages?: boolean;
    strategy?: string;
    executionMode?: ExecutionMode;
  },
) {
  return request<Partial<Task>>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteTask(taskId: string) {
  return request<{ ok: boolean; id: string }>(`/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function getTaskExecutionPreflight(taskId: string) {
  return request<TaskExecutionPreflightResponse>(`/tasks/${taskId}/execute/preflight`);
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
  relations?: Array<{
    sourceTaskId?: string;
    targetTaskId?: string;
    type: "depends-on" | "blocks" | "spawned-from";
    metadata?: Record<string, unknown>;
  }>;
  relationContext?: {
    spawnedFromTaskId?: string;
    dependsOnTaskIds?: string[];
    blockedByTaskIds?: string[];
    blocksTaskIds?: string[];
    metadata?: Record<string, unknown>;
  };
  operatingMode?: OperatingModeSelection;
}) {
  return request<{ id: string; status: string }>("/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Runtime Pipeline ───────────────────────────────────────────────

export type RuntimePipelineStatus = "idle" | "running" | "completed" | "failed" | "paused";
export type RuntimePipelineStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface RuntimePipelineStage {
  id: string;
  type: "hook" | "planning" | "execution" | "judge" | "post-hook";
  label: string;
  status: RuntimePipelineStageStatus;
  order: number;
  sourceType: "runtimePlan.step" | "taskRun.node" | "strategy.hookExecution" | "session.message";
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
  return request<RuntimePipeline>(
    `/tasks/${taskId}/pipeline${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

// ── Session History ────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  taskSessionId?: string | null;
  title: string;
  isActive: boolean;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  coordinationKey?: string | null;
  winnerSessionId?: string | null;
  executionStatus?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  executionModeSnapshot?: string | null;
}

export type TaskSessionRecord = SessionInfo;

export interface TaskRuntimePermission {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown> | null;
  always: string[];
  tool: {
    messageId: string;
    callId: string;
  } | null;
}

export type TaskRuntimePermissionReply = "once" | "always" | "reject";

export interface TaskTreeMeta {
  contractVersion?: string;
  taskId: string;
  currentSessionId?: string | null;
  rootSessionId?: string | null;
  generatedAt?: string;
  incomplete?: boolean;
}

export interface TaskTreeSessionRecord {
  id: string;
  taskId: string;
  parentSessionId?: string | null;
  runtimeSessionId?: string | null;
  sessionKind?: string | null;
  sessionType?: string | null;
  sourceMessageId?: string | null;
  userPromptSummary?: string | null;
  headMessageId?: string | null;
  latestRunId?: string | null;
  status?: string | null;
  depth?: number | null;
  sortKey?: string | null;
  title?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TaskTreeRunRecord {
  id: string;
  taskId: string;
  sessionId: string;
  runtimeSessionId?: string | null;
  laneRole?: string | null;
  modelRoute?: string | null;
  workflowStageKey?: string | null;
  createdAt?: string | null;
}

export interface TaskTreeMessageRecord {
  id: string;
  taskId: string;
  sessionId: string;
  createdByRunId?: string | null;
  role: string;
  messageKind?: string | null;
  parentMessageId?: string | null;
  replyToMessageId?: string | null;
  seq?: number | null;
  textPreview?: string | null;
  partCount?: number | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface TaskTreeMessagePartRecord {
  id: string;
  messageId: string;
  partIndex: number;
  partType: string;
  textContent?: string | null;
  jsonPayload?: Record<string, unknown> | null;
  createdAt?: string | null;
}

export interface TaskTreeParallelGroupRecord {
  coordinationKey: string;
  sessionId: string;
  executionMode?: string | null;
  winnerRunId?: string | null;
  runIds: string[];
}

export interface TaskConversationTreeResponse {
  meta: TaskTreeMeta;
  task: {
    id: string;
    projectId?: string | null;
    title?: string | null;
    status?: string | null;
    summary?: string | null;
    currentSessionId?: string | null;
    rootSessionId?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  workflow?: Record<string, unknown> | null;
  parallelGroups: TaskTreeParallelGroupRecord[];
  sessions: TaskTreeSessionRecord[];
  runs: TaskTreeRunRecord[];
  messages: TaskTreeMessageRecord[];
  messageParts: TaskTreeMessagePartRecord[];
  operations: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  edges?: Record<string, unknown>;
}

export interface TaskTreeTaskMeta {
  id: string;
  projectId?: string | null;
  title?: string | null;
  status?: string | null;
  summary?: string | null;
  currentSessionId?: string | null;
  rootSessionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function asTaskTreeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildTaskTreePartLookup(parts: TaskTreeMessagePartRecord[]) {
  const lookup = new Map<string, TaskTreeMessagePartRecord[]>();
  for (const part of parts) {
    const existing = lookup.get(part.messageId) ?? [];
    existing.push(part);
    lookup.set(part.messageId, existing);
  }
  for (const [messageId, messageParts] of lookup.entries()) {
    lookup.set(
      messageId,
      messageParts.slice().sort((left, right) => left.partIndex - right.partIndex),
    );
  }
  return lookup;
}

function buildTaskTreeWorkflowContextDisplayText(text: string | undefined) {
  const normalized = typeof text === "string" ? text.replace(/\r\n?/gu, "\n").trim() : "";
  if (!normalized) {
    return undefined;
  }

  const withoutPrefix = normalized.replace(/^Execution context:\s*/u, "").trim();
  if (!withoutPrefix) {
    return undefined;
  }

  const cutMarkers = [
    "\n请只完成当前阶段的目标。",
    "\n完成后请输出本阶段产出摘要。",
    "\n如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "\n如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
    "\n/start-work ",
  ];

  let cutIndex = withoutPrefix.length;
  for (const marker of cutMarkers) {
    const markerIndex = withoutPrefix.indexOf(marker);
    if (markerIndex >= 0) {
      cutIndex = Math.min(cutIndex, markerIndex);
    }
  }

  const cleaned = withoutPrefix.slice(0, cutIndex).trim();
  return cleaned.length > 0 ? cleaned : withoutPrefix;
}

function extractTaskTreeWorkflowStageLabel(text: string | undefined) {
  if (!text) {
    return undefined;
  }

  const stageMatch = /当前阶段：([^\n]+)/u.exec(text);
  return stageMatch?.[1]?.trim() || undefined;
}

function buildTaskTreeLegacyPart(part: TaskTreeMessagePartRecord) {
  const payload = part.jsonPayload ?? {};
  const text = asTaskTreeString(part.textContent) ?? asTaskTreeString(payload.text);
  return {
    ...payload,
    id: part.id,
    type: asTaskTreeString(payload.type) ?? part.partType,
    ...(text ? { text, content: text, textContent: text, contentText: text } : {}),
  } satisfies Record<string, unknown>;
}

function extractTaskTreeMessageText(
  message: TaskTreeMessageRecord,
  parts: TaskTreeMessagePartRecord[],
) {
  const textChunks = parts
    .filter((part) => {
      const payloadType = asTaskTreeString(part.jsonPayload?.type);
      const partType = payloadType ?? part.partType;
      return !partType || partType === "text";
    })
    .map((part) => asTaskTreeString(part.textContent) ?? asTaskTreeString(part.jsonPayload?.text))
    .filter((value): value is string => Boolean(value));

  if (textChunks.length > 0) {
    return textChunks.join("\n").trim();
  }

  return asTaskTreeString(message.textPreview);
}

function buildTaskTreeLegacyMessage(args: {
  message: TaskTreeMessageRecord;
  parts: TaskTreeMessagePartRecord[];
  runsById: Map<string, TaskTreeRunRecord>;
  latestRunBySessionId: Map<string, TaskTreeRunRecord>;
}) {
  const { message, parts, runsById, latestRunBySessionId } = args;
  const run = message.createdByRunId
    ? runsById.get(message.createdByRunId)
    : message.role === "assistant"
      ? latestRunBySessionId.get(message.sessionId)
      : undefined;
  const text = extractTaskTreeMessageText(message, parts);
  const createdAt = message.createdAt ?? message.updatedAt ?? undefined;
  const completedAt = message.completedAt ?? undefined;

  return {
    id: message.id,
    role: message.role,
    text,
    textContent: text,
    contentText: text,
    summaryText: message.textPreview ?? text,
    createdAt,
    updatedAt: message.updatedAt ?? createdAt,
    completedAt,
    parts: parts.map((part) => buildTaskTreeLegacyPart(part)),
    info: {
      id: message.id,
      role: message.role,
      ...(run?.laneRole ? { agent: run.laneRole } : {}),
      ...(run?.modelRoute
        ? {
            model: { modelID: run.modelRoute },
            modelID: run.modelRoute,
          }
        : {}),
      time: {
        ...(createdAt ? { created: createdAt } : {}),
        ...(completedAt ? { completed: completedAt } : {}),
      },
    },
  } satisfies Record<string, unknown>;
}

function buildTaskTreeWorkflowGroup(args: {
  taskId: string;
  sessions: TaskTreeSessionRecord[];
  messages: TaskTreeMessageRecord[];
  partsByMessageId: Map<string, TaskTreeMessagePartRecord[]>;
}) {
  type WorkflowStepProjection = {
    agentName: string;
    sessionId: string;
    createdAt: string | undefined;
    messages: Record<string, unknown>[];
  };

  const sessionById = new Map(args.sessions.map((session) => [session.id, session]));
  const workflowSteps = args.messages
    .filter((message) => message.role === "user")
    .map<WorkflowStepProjection | null>((message) => {
      const session = sessionById.get(message.sessionId);
      const text = extractTaskTreeMessageText(message, args.partsByMessageId.get(message.id) ?? []);
      if (!text?.startsWith("Execution context:")) {
        return null;
      }

      if (session?.parentSessionId) {
        return null;
      }

      if (session?.sessionKind && session.sessionKind !== "primary") {
        return null;
      }

      const displayText = buildTaskTreeWorkflowContextDisplayText(text);
      if (!displayText) {
        return null;
      }

      const createdAt = message.createdAt ?? session?.createdAt ?? undefined;
      const workflowMessage = {
        id: `${message.id}:workflow-context`,
        role: "workflow",
        text: displayText,
        textContent: displayText,
        contentText: displayText,
        summaryText: displayText,
        createdAt,
        parts: [
          {
            id: `${message.id}:workflow-context:text`,
            type: "text",
            text: displayText,
            content: displayText,
            textContent: displayText,
            contentText: displayText,
          },
        ],
        info: {
          id: `${message.id}:workflow-context`,
          role: "workflow",
          preview: displayText,
          time: {
            ...(createdAt ? { created: createdAt } : {}),
          },
        },
      } satisfies Record<string, unknown>;

      return {
        agentName: extractTaskTreeWorkflowStageLabel(text) ?? "当前工作流",
        sessionId: message.sessionId,
        createdAt,
        messages: [workflowMessage],
      };
    })
    .filter((step): step is WorkflowStepProjection => step != null)
    .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));

  if (workflowSteps.length === 0) {
    return null;
  }

  return {
    _type: "workflow_group",
    info: {
      id: `workflow-group-${args.taskId}`,
      role: "workflow",
      variant: "context",
      label: "工作流消息",
      hint: "当前阶段与执行上下文",
    },
    steps: workflowSteps,
  } satisfies Record<string, unknown>;
}

function projectTaskConversationTreeToMessages(tree: TaskConversationTreeResponse): {
  data: unknown[];
  meta?: ExecutionTraceTimelineMeta & {
    sessionId?: string;
    messageCount?: number;
  };
} {
  const partsByMessageId = buildTaskTreePartLookup(
    Array.isArray(tree.messageParts) ? tree.messageParts : [],
  );
  const runs = Array.isArray(tree.runs) ? tree.runs : [];
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const latestRunBySessionId = new Map<string, TaskTreeRunRecord>();
  for (const run of runs) {
    const previous = latestRunBySessionId.get(run.sessionId);
    const previousCreatedAt = previous?.createdAt ?? "";
    const currentCreatedAt = run.createdAt ?? "";
    if (!previous || currentCreatedAt >= previousCreatedAt) {
      latestRunBySessionId.set(run.sessionId, run);
    }
  }

  const regularMessages = (Array.isArray(tree.messages) ? tree.messages : []).map((message) =>
    buildTaskTreeLegacyMessage({
      message,
      parts: partsByMessageId.get(message.id) ?? [],
      runsById,
      latestRunBySessionId,
    }),
  );

  const workflowGroup = buildTaskTreeWorkflowGroup({
    taskId: tree.meta.taskId,
    sessions: Array.isArray(tree.sessions) ? tree.sessions : [],
    messages: Array.isArray(tree.messages) ? tree.messages : [],
    partsByMessageId,
  });

  const data = workflowGroup
    ? (() => {
        const insertionIndex = regularMessages.findIndex((message) => message.role !== "user");
        if (insertionIndex < 0) {
          return [...regularMessages, workflowGroup];
        }
        return [
          ...regularMessages.slice(0, insertionIndex),
          workflowGroup,
          ...regularMessages.slice(insertionIndex),
        ];
      })()
    : regularMessages;

  return {
    data,
    meta: {
      sessionId: tree.meta.currentSessionId ?? tree.task.currentSessionId ?? undefined,
      messageCount: regularMessages.length,
      readSource: "task-domain-projection",
      complete: tree.meta.incomplete !== true,
      itemCount: regularMessages.length,
    },
  };
}

function buildTaskTreeMessageLookup(tree: TaskConversationTreeResponse) {
  const partsByMessageId = buildTaskTreePartLookup(
    Array.isArray(tree.messageParts) ? tree.messageParts : [],
  );
  const messages = Array.isArray(tree.messages) ? tree.messages : [];
  return new Map(
    messages.map((message) => [
      message.id,
      {
        message,
        text: extractTaskTreeMessageText(message, partsByMessageId.get(message.id) ?? []),
      },
    ]),
  );
}

function projectTaskTreeToTaskMeta(tree: TaskConversationTreeResponse): TaskTreeTaskMeta {
  return {
    id: tree.task.id,
    projectId: tree.task.projectId ?? undefined,
    title: tree.task.title ?? undefined,
    status: tree.task.status ?? undefined,
    summary: tree.task.summary ?? undefined,
    currentSessionId: tree.meta.currentSessionId ?? tree.task.currentSessionId ?? undefined,
    rootSessionId: tree.meta.rootSessionId ?? tree.task.rootSessionId ?? undefined,
    createdAt: tree.task.createdAt ?? undefined,
    updatedAt: tree.task.updatedAt ?? undefined,
  };
}

function projectTaskTreeToSessionSummaries(
  tree: TaskConversationTreeResponse,
): TaskSessionRecord[] {
  const messageLookup = buildTaskTreeMessageLookup(tree);
  const currentSessionId = tree.meta.currentSessionId ?? tree.task.currentSessionId ?? undefined;

  return (Array.isArray(tree.sessions) ? tree.sessions : [])
    .map((session) => {
      const runtimeSessionId = session.runtimeSessionId ?? session.id;
      const promptSummary =
        asTaskTreeString(session.userPromptSummary) ??
        asTaskTreeString(session.title) ??
        messageLookup.get(asTaskTreeString(session.sourceMessageId) ?? "")?.text ??
        "";

      return {
        id: runtimeSessionId,
        taskSessionId: session.id,
        title: promptSummary,
        isActive: runtimeSessionId === currentSessionId,
        summary: null,
        createdAt: session.createdAt ?? null,
        updatedAt: session.updatedAt ?? null,
        executionStatus: session.status ?? null,
        sessionKind: session.sessionType ?? session.sessionKind ?? null,
      } satisfies TaskSessionRecord;
    })
    .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
}

function buildTaskBranchNodeId(taskId: string, runtimeSessionId: string) {
  return `branch-node:${taskId}:${runtimeSessionId}`;
}

function projectTaskTreeToSessionLineage(
  tree: TaskConversationTreeResponse,
): TaskSessionLineageNode[] {
  const messageLookup = buildTaskTreeMessageLookup(tree);
  const currentSessionId = tree.meta.currentSessionId ?? tree.task.currentSessionId ?? undefined;
  const sessions = Array.isArray(tree.sessions) ? tree.sessions : [];
  const byParent = new Map<string | null, TaskTreeSessionRecord[]>();

  for (const session of sessions) {
    const parentId = session.parentSessionId ?? null;
    const existing = byParent.get(parentId) ?? [];
    existing.push(session);
    byParent.set(parentId, existing);
  }

  const buildNodes = (parentId: string | null): TaskSessionLineageNode[] => {
    const children = (byParent.get(parentId) ?? []).slice().sort((left, right) => {
      const leftSort = left.sortKey ?? left.createdAt ?? "";
      const rightSort = right.sortKey ?? right.createdAt ?? "";
      return leftSort.localeCompare(rightSort);
    });

    return children.map((session) => {
      const runtimeSessionId = session.runtimeSessionId ?? session.id;
      const branchNodeId = buildTaskBranchNodeId(tree.meta.taskId, runtimeSessionId);
      const sourceMessageId = asTaskTreeString(session.sourceMessageId) ?? null;
      const sourceMessage = sourceMessageId
        ? messageLookup.get(sourceMessageId)?.message
        : undefined;
      const title =
        asTaskTreeString(session.title) ??
        asTaskTreeString(session.userPromptSummary) ??
        messageLookup.get(sourceMessageId ?? "")?.text ??
        null;

      return {
        id: branchNodeId,
        branchNodeId,
        runtimeSessionId,
        taskSessionId: session.id,
        parentRuntimeSessionId: session.parentSessionId ?? null,
        parentTaskSessionId: session.parentSessionId ?? null,
        forkedFromMessageId: sourceMessageId,
        forkedFromMessageRole: sourceMessage?.role ?? null,
        forkedFromMessagePreview: sourceMessageId
          ? (messageLookup.get(sourceMessageId)?.text ?? null)
          : null,
        firstPromptAfterFork: asTaskTreeString(session.userPromptSummary) ?? null,
        branchName: title,
        sourceType:
          session.sessionType ??
          session.sessionKind ??
          (session.parentSessionId ? "follow_up" : "root"),
        isActive: runtimeSessionId === currentSessionId,
        title,
        summary: null,
        createdAt: session.createdAt ?? null,
        updatedAt: session.updatedAt ?? null,
        children: buildNodes(session.id),
      } satisfies TaskSessionLineageNode;
    });
  };

  return buildNodes(null);
}

export async function getTaskConversationTree(
  taskId: string,
  options?: { sessionId?: string; includeLineage?: boolean },
) {
  const params = new URLSearchParams();
  if (options?.sessionId) {
    params.set("sessionId", options.sessionId);
  }
  if (options?.includeLineage === false) {
    params.set("includeLineage", "false");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";

  return request<TaskConversationTreeResponse>(
    `/tasks/${encodeURIComponent(taskId)}/tree${suffix}`,
  );
}

export async function getTaskTreeMeta(taskId: string): Promise<TaskTreeTaskMeta> {
  const tree = await getTaskConversationTree(taskId, { includeLineage: false });
  return projectTaskTreeToTaskMeta(tree);
}

export async function getTaskSessions(taskId: string) {
  const tree = await getTaskConversationTree(taskId, { includeLineage: false });
  return { data: projectTaskTreeToSessionSummaries(tree) };
}

export async function getTaskAgentRuns(_taskId: string) {
  return { data: [] as TaskAgentRunRecord[] };
}

export async function getTaskDomainRuns(taskId: string) {
  return request<{ data: TaskDomainRunRecord[] }>(`/tasks/${taskId}/domain-runs`);
}

export async function getTaskDomainRunDetail(taskId: string, runId: string) {
  return request<{ data: TaskDomainRunDetailRecord }>(`/tasks/${taskId}/domain-runs/${runId}`);
}

export async function listTaskRuntimePermissions(taskId: string, sessionId?: string) {
  const query = new URLSearchParams();
  if (sessionId) query.set("sessionId", sessionId);
  return request<{ data: TaskRuntimePermission[] }>(
    `/tasks/${taskId}/runtime-permissions${query.toString() ? `?${query.toString()}` : ""}`,
  );
}

export async function replyTaskRuntimePermission(
  taskId: string,
  requestId: string,
  data: { reply: TaskRuntimePermissionReply; message?: string },
) {
  return request<{
    ok: boolean;
    requestId: string;
    sessionId: string;
    reply: TaskRuntimePermissionReply;
  }>(`/tasks/${taskId}/runtime-permissions/${requestId}/reply`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getTaskConversationMessages(
  taskId: string,
  sessionId: string,
  options?: { includeLineage?: boolean },
): Promise<{
  data: unknown[];
  meta?: ExecutionTraceTimelineMeta & {
    sessionId?: string;
    messageCount?: number;
  };
}> {
  const tree = await getTaskConversationTree(taskId, {
    sessionId,
    includeLineage: options?.includeLineage,
  });

  return projectTaskConversationTreeToMessages(tree);
}

export async function getTaskMessages(
  taskId: string,
  options?: { sessionId?: string; includeLineage?: boolean },
): Promise<{
  data: unknown[];
  meta?: ExecutionTraceTimelineMeta & {
    sessionId?: string;
    messageCount?: number;
  };
}> {
  const tree = await getTaskConversationTree(taskId, options);
  return projectTaskConversationTreeToMessages(tree);
}

export async function continueTask(
  taskId: string,
  prompt: string,
  sessionId?: string,
  executionMode?: ExecutionMode,
) {
  return request<{ ok: boolean; sessionId: string; taskSessionId?: string | null }>(
    `/tasks/${taskId}/continue`,
    {
      method: "POST",
      body: JSON.stringify({ prompt, sessionId, executionMode }),
    },
  );
}

export async function forkTaskSession(
  taskId: string,
  sessionId: string,
  title?: string,
  messageId?: string,
) {
  return request<{
    ok: boolean;
    sessionId: string;
    taskSessionId?: string | null;
    title?: string;
    parentSessionId?: string;
    parentTaskSessionId?: string | null;
    forkedFromMessageId?: string;
  }>(`/tasks/${taskId}/sessions/${sessionId}/fork`, {
    method: "POST",
    body: JSON.stringify({ title, messageId }),
  });
}

// ── Session Lineage Tree ───────────────────────────────────────────

export interface SessionLineageNode {
  id: string;
  branchNodeId?: string | null;
  runtimeSessionId: string;
  taskSessionId?: string | null;
  parentRuntimeSessionId: string | null;
  parentTaskSessionId?: string | null;
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
  children: SessionLineageNode[];
}

export type TaskSessionLineageNode = SessionLineageNode;

export async function getTaskSessionLineage(taskId: string) {
  const tree = await getTaskConversationTree(taskId);
  return { data: projectTaskTreeToSessionLineage(tree) };
}

export async function activateTaskSession(taskId: string, sessionId: string) {
  return request<{ ok: boolean; sessionId: string }>(
    `/tasks/${taskId}/sessions/${sessionId}/activate`,
    { method: "POST" },
  );
}

export async function archiveTaskSession(taskId: string, sessionId: string) {
  return request<{ ok: boolean }>(`/tasks/${taskId}/sessions/${sessionId}/archive`, {
    method: "POST",
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

// ── Workbench Layout ───────────────────────────────────────────────

export interface WorkbenchLayoutPayload {
  // New multi-pane format
  panes?: Array<{
    id: string;
    taskId: string;
    sessionId?: string;
    title?: string;
    status?: string;
    pinned?: boolean;
  }>;
  activePaneId?: string;
  columns?: number;
  // Legacy format (readable for migration)
  tabs?: Array<{ taskId: string; title?: string; status?: string; pinned?: boolean }>;
  activeTaskId?: string;
  secondaryPane?: { taskId: string; sessionId?: string; label?: string } | null;
  splitMode?: boolean;
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

export type ProjectTreeNodeType =
  | "project_root"
  | "task"
  | "session"
  | "message"
  | "context"
  | "fork_point";

export type ProjectTreeLinkType =
  | "depends-on"
  | "blocks"
  | "cites"
  | "forked-from"
  | "spawned"
  | "related";

export interface ProjectTreeNodeRecord {
  id: string;
  projectId: string;
  parentId?: string | null;
  path: string;
  depth: number;
  nodeType: ProjectTreeNodeType;
  role?: string | null;
  contentText?: string | null;
  contentJson?: Record<string, unknown> | null;
  tokenCount?: number | null;
  runtimeSessionId?: string | null;
  runtimeMessageId?: string | null;
  branchName?: string | null;
  isActive: boolean;
  supersededBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

export interface ProjectTreeBranchRecord {
  id: string;
  projectId: string;
  taskNodeId?: string | null;
  branchName: string;
  headNodeId: string;
  isDefault: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectTreeLinkRecord {
  id: string;
  sourceNodeId: string;
  sourceProjectId: string;
  targetNodeId: string;
  targetProjectId: string;
  linkType: ProjectTreeLinkType;
  metadata?: Record<string, unknown> | null;
  bidirectional?: boolean;
  createdBy?: string | null;
  createdAt?: string | null;
  direction?: "incoming" | "outgoing" | "self";
}

export type ProjectTreeSearchNodeType = "all" | "message" | "context";

export interface ProjectTreeSearchResultRecord {
  source: "message" | "context";
  eventId?: string | null;
  nodeId: string;
  path: string;
  taskId?: string | null;
  taskTitle?: string | null;
  runtimeSessionId?: string | null;
  runtimeMessageId?: string | null;
  branchName?: string | null;
  parentNodeId?: string | null;
  parentNodeType?: string | null;
  parentTitle?: string | null;
  contentText: string;
  excerpt: string;
  score: number;
  directHit: boolean;
  createdAt: string;
  eventType?: string | null;
}

export interface ProjectTreeSearchResponseRecord {
  data: ProjectTreeSearchResultRecord[];
  meta?: {
    query: string;
    nodeType: ProjectTreeSearchNodeType;
    limit: number;
    resultCount: number;
    messageCount: number;
    contextCount: number;
  };
}

export interface CreateProjectTreeChildInput {
  id?: string;
  nodeType: ProjectTreeNodeType;
  role?: string | null;
  contentText?: string | null;
  contentJson?: Record<string, unknown> | null;
  tokenCount?: number | null;
  runtimeSessionId?: string | null;
  runtimeMessageId?: string | null;
  branchName?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
}

export interface UpdateProjectTreeBranchInput {
  headNodeId: string;
  isDefault?: boolean;
}

export interface CreateProjectTreeLinkInput {
  targetNodeId: string;
  targetProjectId?: string;
  linkType: ProjectTreeLinkType;
  metadata?: Record<string, unknown> | null;
  bidirectional?: boolean;
}

export async function getProjectTree(
  projectId: string,
  options: { depth?: number; nodeType?: ProjectTreeNodeType } = {},
) {
  const params = new URLSearchParams();
  if (typeof options.depth === "number") {
    params.set("depth", String(options.depth));
  }
  if (options.nodeType) {
    params.set("nodeType", options.nodeType);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await request<{ data: ProjectTreeNodeRecord[] }>(
    `/projects/${encodeURIComponent(projectId)}/tree${suffix}`,
  );
  return response.data;
}

export async function getProjectTreeNode(projectId: string, nodeId: string) {
  return request<ProjectTreeNodeRecord>(
    `/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}`,
  );
}

export async function getProjectTreeChildren(projectId: string, nodeId: string) {
  const response = await request<{ data: ProjectTreeNodeRecord[] }>(
    `/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/children`,
  );
  return response.data;
}

export async function createProjectTreeChild(
  projectId: string,
  nodeId: string,
  body: CreateProjectTreeChildInput,
) {
  return request<ProjectTreeNodeRecord>(
    `/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/children`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function getProjectTreeAncestors(projectId: string, nodeId: string) {
  const response = await request<{ data: ProjectTreeNodeRecord[] }>(
    `/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/ancestors`,
  );
  return response.data;
}

export async function getProjectTreeBranches(projectId: string) {
  const response = await request<{ data: ProjectTreeBranchRecord[] }>(
    `/projects/${encodeURIComponent(projectId)}/branches`,
  );
  return response.data;
}

export async function updateProjectTreeBranch(
  projectId: string,
  branchId: string,
  body: UpdateProjectTreeBranchInput,
) {
  return request<ProjectTreeBranchRecord>(
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export async function getProjectTreeNodeLinks(projectId: string, nodeId: string) {
  const response = await request<{ data: ProjectTreeLinkRecord[] }>(
    `/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/links`,
  );
  return response.data;
}

export async function searchProjectTree(
  projectId: string,
  query: string,
  options: {
    nodeType?: ProjectTreeSearchNodeType;
    limit?: number;
    taskId?: string;
    runtimeSessionId?: string;
  } = {},
) {
  const params = new URLSearchParams();
  params.set("q", query);
  if (options.nodeType) {
    params.set("nodeType", options.nodeType);
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (options.taskId) {
    params.set("taskId", options.taskId);
  }
  if (options.runtimeSessionId) {
    params.set("runtimeSessionId", options.runtimeSessionId);
  }
  return request<ProjectTreeSearchResponseRecord>(
    `/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`,
  );
}

export async function createProjectTreeLink(
  projectId: string,
  nodeId: string,
  body: CreateProjectTreeLinkInput,
) {
  return request<ProjectTreeLinkRecord>(
    `/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/links`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function getProjectTreeLinks(projectId: string) {
  const response = await request<{ data: ProjectTreeLinkRecord[] }>(
    `/projects/${encodeURIComponent(projectId)}/links`,
  );
  return response.data;
}

export async function deleteProjectTreeLink(projectId: string, linkId: string) {
  return request<{ ok: boolean }>(
    `/projects/${encodeURIComponent(projectId)}/links/${encodeURIComponent(linkId)}`,
    {
      method: "DELETE",
    },
  );
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

export async function getProjectPaidExecutionLease(projectId: string) {
  return request<PaidExecutionLeaseStateResponse>(`/projects/${projectId}/paid-execution-lease`);
}

export async function createProjectPaidExecutionLease(
  projectId: string,
  data: { durationMinutes: number; reason?: string },
) {
  return request<PaidExecutionLeaseStateResponse>(`/projects/${projectId}/paid-execution-lease`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function revokeProjectPaidExecutionLease(
  projectId: string,
  leaseId: string,
  data?: { reason?: string },
) {
  return request<{ ok: boolean; leaseId: string; projectId: string }>(
    `/projects/${projectId}/paid-execution-lease/${leaseId}`,
    {
      method: "DELETE",
      body: JSON.stringify(data || {}),
    },
  );
}

export async function getProjectPaidExecutionPreflight(projectId: string) {
  return request<ProjectExecutionPreflightResponse>(
    `/projects/${projectId}/paid-execution-preflight`,
  );
}

export async function getProjectRuntimeUsageLedgers(
  projectId: string,
  params?: { limit?: number; taskId?: string; status?: string },
) {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.taskId) search.set("taskId", params.taskId);
  if (params?.status) search.set("status", params.status);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<ProjectRuntimeUsageLedgerListResponse>(
    `/projects/${projectId}/runtime-usage-ledgers${suffix}`,
  );
}

export async function getProjectRuntimeUsageLedgerDetail(projectId: string, ledgerId: string) {
  return request<ProjectRuntimeUsageLedgerDetailResponse>(
    `/projects/${projectId}/runtime-usage-ledgers/${ledgerId}`,
  );
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
  settings?: Pick<ProjectSettings, "projectGroupKey" | "projectGroupLabel"> | null;
  projectStatus: "healthy" | "pending_config" | "archived" | "error";
  completedCount: number;
  totalRequiredCount: number;
  completionPercent: number;
  risks: string[];
  runningTasks: number;
  activeSessionCount: number;
  parallelTaskCount: number;
  sequentialChainTaskCount: number;
  recentTimelineItemCount: number;
  failedTaskCount: number;
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
    activeProjectCount: number;
    runningTaskCount: number;
    activeSessionCount: number;
    parallelTaskCount: number;
    sequentialChainTaskCount: number;
    failedTaskCount: number;
    recentTimelineItemCount: number;
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

export async function executeTask(
  taskId: string,
  overrides?: {
    mode?: ExecutionMode;
    candidates?: Array<{ model: string; label?: string }>;
    steps?: ChainStepInput[];
  },
) {
  return request<{
    taskId: string;
    sessionId: string;
    agentRunId: string;
    status: string;
  }>(`/tasks/${taskId}/execute`, {
    method: "POST",
    ...(overrides ? { body: JSON.stringify(overrides) } : {}),
  });
}

export async function adoptParallelCandidate(taskId: string, candidateIndex: number) {
  return request<{ ok: boolean; winnerCandidateIndex: number }>(
    `/tasks/${taskId}/candidates/${candidateIndex}/adopt`,
    { method: "POST" },
  );
}

export async function updateTaskStatus(taskId: string, status: string) {
  return request<{ id: string; status: string }>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function completeTask(taskId: string) {
  return request<{ ok: boolean }>(`/tasks/${taskId}/complete`, {
    method: "POST",
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
  category?: string;
  tags?: string[];
  applyTo?: string[];
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
  category?: string;
  tags?: string[];
  applyTo?: string[];
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

export interface ModelsTestPolicy {
  configuredModel: string | null;
  effectiveModel: string;
  allowedModels: string[];
  enforced: boolean;
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
export async function getModelsTestPolicy() {
  return request<{ data: ModelsTestPolicy }>("/config/models/test-policy");
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
  }>("/config/models/providers/test", {
    method: "POST",
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

export type ExecutionMode = "single" | "parallel" | "sequential-chain";

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

export interface ExecutionStep {
  id: string;
  type: "hook" | "execution" | "judge" | "chain-step";
  status: "pending" | "running" | "completed" | "failed";
  dependsOn?: string[];
  title?: string;
  instruction?: string;
  model?: string | null;
  sourceType?: string;
  result?: string;
  finishedAt?: string;
}

export interface ChainStepInput {
  id: string;
  title: string;
  instruction: string;
  model?: string;
}

export interface RuntimePlan {
  templateId: string;
  mode: ExecutionMode;
  steps?: ExecutionStep[];
  candidates: ExecutionCandidate[];
  judgeResult?: JudgeResult;
  winnerCandidateIndex?: number;
  currentChainStepIndex?: number;
  chainResult?: string;
  pipelineMetadata?: {
    requestedMode?: "sequential-chain";
    stepCount?: number;
  };
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
  followupTemplateId?: string;
  followupGoal?: string;
  targetAgent?: string;
  targetModel?: string;
}

export interface FollowupTemplate {
  id: string;
  enabled: boolean;
  agent: string;
  model?: string;
  promptTemplate: string;
  timeoutMs: number;
  resultMode?: "append" | "replace" | "advisory";
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
  followups: FollowupTemplate[];
  judge: JudgeConfig;
  organizationSettings?: PlatformOrganizationSettings;
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

export interface ChatSettingsPendingPatch {
  index: number;
  action: "preview" | "apply" | "explain" | "validate";
  configType:
    | "orchestration-strategy"
    | "models"
    | "agents"
    | "mcp"
    | "skills"
    | "commands"
    | "security"
    | "plugins";
  patch: Record<string, unknown>;
  explanation: string;
  rawText: string;
  mermaidPreview?: Record<string, string>;
  visualizations?: Array<{ kind: "mermaid" | "json"; title: string; content: string }>;
  orchestrationPreview?: OrchestrationPreviewModel;
  configVersion: string;
  createdAt: string;
  signature?: string;
}

export interface OrchestrationCategorySummary {
  category: string;
  templateName: string;
  executionMode: ExecutionMode | "unknown";
  pipelineEnabled: boolean;
  judgeEnabled: boolean;
  judgeAgent: string;
  judgeModel: string;
  primaryAgents: string[];
  primaryModel: string;
  followupEnabledCount?: number;
  followupTemplateIds?: string[];
  followupSummary?: string;
  notes: string[];
}

export interface OrchestrationJudgeChange {
  changed: boolean;
  beforeEnabled: boolean;
  afterEnabled: boolean;
  beforeAgent: string;
  afterAgent: string;
  beforeModel: string;
  afterModel: string;
}

export interface OrchestrationTemplateChange {
  category: string;
  beforeTemplate: string;
  afterTemplate: string;
  beforeMode: ExecutionMode | "unknown";
  afterMode: ExecutionMode | "unknown";
}

export interface OrchestrationStrategyChangeCard {
  id: string;
  category: string;
  changeType: "template" | "judge" | "model" | "agent" | "pipeline";
  title: string;
  summary: string;
  beforeLabel: string;
  afterLabel: string;
  riskLevel: "low" | "medium" | "high";
  affectsJudge: boolean;
  affectsTemplate: boolean;
  mermaidCode?: string;
}

export interface OrchestrationRiskHint {
  level: "low" | "medium" | "high";
  summary: string;
}

export interface OrchestrationPreviewModel {
  configVersion: string;
  explanation: string;
  affectedCategories: string[];
  changeCards: OrchestrationStrategyChangeCard[];
  judgeChange: OrchestrationJudgeChange;
  templateChanges: OrchestrationTemplateChange[];
  strategySummaryBefore?: OrchestrationCategorySummary[];
  strategySummaryAfter?: OrchestrationCategorySummary[];
  riskHints?: OrchestrationRiskHint[];
  mermaidPreview: Record<string, string>;
  rawPatch: Record<string, unknown>;
}

export interface ChatSettingsCurrentContext {
  configVersion: string;
  configVersions: {
    "orchestration-strategy": string;
    models: string;
    mcp: string;
    security: string;
    plugins: string;
    agents: Record<string, string>;
    skills: Record<string, string>;
    commands: Record<string, string>;
  };
  strategy: OrchestrationStrategy;
  orchestrationVersion?: string;
  categorySummaries?: OrchestrationCategorySummary[];
  supportedCategories?: string[];
  modelsConfig: ModelsConfig;
  mcpConfig: Record<string, McpServer>;
  mermaidByCategory: Record<string, string>;
  modelsVisualizations: Array<{ kind: "mermaid" | "json"; title: string; content: string }>;
  agents: string[];
  models: string[];
  agentSummaries: AgentSummary[];
  skillSummaries: SkillSummary[];
  commandSummaries: CommandSummary[];
  securityBaseline: { raw: string };
  pluginsConfig: { plugins: PluginInfo[] };
  allowedPluginSourcePrefixes: string[];
  installablePluginSources: Array<{
    source: string;
    name: string;
    installed: boolean;
    enabled: boolean;
  }>;
  supportedConfigTypes: string[];
}

export interface ChatSettingsConversationState {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
  pendingPatches: ChatSettingsPendingPatch[];
}

export async function getChatSettingsCurrentContext() {
  return request<{ data: ChatSettingsCurrentContext }>("/chat-settings/current-context");
}

export async function chatWithChatSettings(data: {
  conversationId?: string;
  message: string;
  model?: string;
}) {
  return request<{
    data: {
      conversationId: string;
      configVersion: string;
      message: string;
      patch: ChatSettingsPendingPatch;
    };
  }>("/chat-settings/chat", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function applyChatSettingsPatch(data: {
  conversationId: string;
  patchIndex: number;
  configVersion: string;
  pendingPatch?: ChatSettingsPendingPatch;
}) {
  return request<{
    data: {
      ok: boolean;
      configVersion: string;
      strategy: OrchestrationStrategy;
      mermaidByCategory: Record<string, string>;
      visualizations: Array<{ kind: "mermaid" | "json"; title: string; content: string }>;
      configVersions: ChatSettingsCurrentContext["configVersions"];
    };
  }>("/chat-settings/apply", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getChatSettingsHistory(conversationId?: string) {
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
  return request<{ data: ChatSettingsConversationState | Array<Record<string, unknown>> }>(
    `/chat-settings/history${query}`,
  );
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
  return request<{ ok: boolean }>(
    `/config/copilot/logout?provider=${encodeURIComponent(provider)}`,
    { method: "POST" },
  );
}

export async function getCopilotModels(provider = "github-copilot") {
  return request<{ data: CopilotModelInfo[] }>(
    `/config/copilot/models?provider=${encodeURIComponent(provider)}`,
  );
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

// ── Role Workflow / Review ────────────────────────────────────────

export interface RoleAgentRecord {
  id: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  scope: "system" | "project";
  status: "active" | "disabled" | "deprecated";
  ownerTeam?: string | null;
  permissionProfile: string;
  toolProfile: string;
  defaultExecutionMode: "single" | "parallel-review" | "round-robin";
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review" | null;
  maxActiveBindings?: number | null;
  requireConsensus: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApprovalForWrite: boolean;
  allowedStages?: string[];
  outputSchemaId?: string | null;
  tagsJson?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleAgentBindingRecord {
  id: string;
  roleAgentId: string;
  projectId?: string | null;
  bindingKey: string;
  runtimeAgent: string;
  label: string;
  enabled: boolean;
  priority: number;
  model?: string | null;
  tagsJson?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleAgentProjectOverrideRecord {
  id: string;
  roleAgentId: string;
  projectId: string;
  name?: string | null;
  description?: string | null;
  status?: "active" | "disabled" | "deprecated" | null;
  ownerTeam?: string | null;
  permissionProfile?: string | null;
  toolProfile?: string | null;
  defaultExecutionMode?: "single" | "parallel-review" | "round-robin" | null;
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review" | null;
  maxActiveBindings?: number | null;
  requireConsensus?: boolean | null;
  riskLevel?: "low" | "medium" | "high" | "critical" | null;
  requiresApprovalForWrite?: boolean | null;
  allowedStages?: string[];
  outputSchemaId?: string | null;
  tagsJson?: string[] | null;
  bindingsMode?: "inherit" | "replace" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRoleExecutionViewRow {
  role: RoleAgentRecord;
  override: RoleAgentProjectOverrideRecord | null;
  mode: "platform-default" | "project-extend" | "project-takeover";
  effectiveStages: string[];
  overrideSummary: string;
}

export interface ProjectRoleExecutionView {
  project: {
    id: string;
    name: string;
    slug: string;
  };
  summary: {
    totalRoles: number;
    customizedRoles: number;
    takeoverRoles: number;
    riskyRoles: number;
  };
  rows: ProjectRoleExecutionViewRow[];
  access: {
    overrideReadable: boolean;
    fallbackToSystemDefaults: boolean;
    message?: string | null;
  };
}

export interface UpsertRoleAgentProjectOverrideInput {
  name?: string;
  description?: string;
  status?: "active" | "disabled" | "deprecated";
  ownerTeam?: string;
  permissionProfile?: string;
  toolProfile?: string;
  defaultExecutionMode?: "single" | "parallel-review" | "round-robin";
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review";
  maxActiveBindings?: number;
  requireConsensus?: boolean;
  riskLevel?: "low" | "medium" | "high" | "critical";
  requiresApprovalForWrite?: boolean;
  allowedStages?: string[];
  outputSchemaId?: string;
  tagsJson?: string[];
  bindingsMode?: "inherit" | "replace";
}

export interface UpsertRoleAgentBindingInput {
  projectId?: string;
  bindingKey: string;
  runtimeAgent: string;
  label: string;
  enabled?: boolean;
  priority: number;
  model?: string;
  tagsJson?: string[];
}

export interface UpdateRoleAgentBindingInput {
  projectId?: string;
  bindingKey?: string;
  runtimeAgent?: string;
  label?: string;
  enabled?: boolean;
  priority?: number;
  model?: string;
  tagsJson?: string[];
}

export interface TaskStageViewModel {
  id?: string;
  stageKey: string;
  stageLabel?: string;
  status: string;
  approvalState: string;
  blockingReason?: string;
  primaryRoleLabel?: string;
  gateCount: number;
  approvalCount: number;
  runtimeSummary: {
    conclusionCount: number;
    blockDecisionCount: number;
    approvalDecisionCount: number;
    manualReviewCount: number;
    openChangeRequestCount: number;
    blockingChangeRequestCount: number;
    gateResult: "not-configured" | "pending" | "passed" | "blocked";
    approvalResult: "not-configured" | "pending" | "approved" | "rejected";
    latestBlockingRoleLabel?: string;
    latestApprovalRoleLabel?: string;
  };
}

export interface RoleConclusionViewModel {
  id: string;
  roleAgentId: string;
  roleLabel: string;
  stage: string;
  finalDecision: string;
  aggregateRiskLevel: string;
  consensusScore: number;
  winningRationale: string;
  mergedFindings: Array<{ key: string; title: string; severity: string }>;
  minorityFindings: Array<{ key: string; title: string; severity: string }>;
  conflicts: Array<{ type: string; severity: string; summary: string }>;
  approvalRequired: boolean;
}

export interface DeveloperChangeRequestViewModel {
  id: string;
  sourceRoleAgentId: string;
  sourceRoleLabel: string;
  stageKey?: string;
  priority: string;
  title: string;
  summary: string;
  requiredChanges: string[];
  blocking: boolean;
  approvalRequired: boolean;
  status: string;
}

export interface TaskWorkflowViewModel {
  taskId: string;
  workflow: {
    templateId?: string | null;
    currentStage: string;
    status: string;
    stages: TaskStageViewModel[];
  };
  roleConclusions: RoleConclusionViewModel[];
  developerChangeRequests: DeveloperChangeRequestViewModel[];
}

export interface TaskMemberViewMember {
  id: string;
  kind: "manager" | "user" | "agent";
  displayName: string;
  handle: string | null;
  identitySource: "human" | "agent";
  intentSource: "original" | "derived";
  responsibilityLabels: string[];
  stageLabels: string[];
  statusLabel: string;
  statusTone: "default" | "processing" | "success" | "warning";
  summary: string;
  capabilityBadges: string[];
  runCount: number;
  latestActivityAt: string | null;
}

export interface TaskMemberViewModel {
  taskId: string;
  projectId: string | null;
  workflowStatus: string;
  currentStageKey: string;
  currentStageLabel: string;
  summary: {
    managerCount: number;
    userCount: number;
    agentCount: number;
    activeAgentCount: number;
  };
  members: TaskMemberViewMember[];
}

export interface WorkflowTemplateRecord {
  id: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  enabled: boolean;
  selectableByProjects: boolean;
  defaultCollaborationMode?: CollaborationMode | null;
  defaultAutopilotLevel?: AutopilotLevel | null;
  defaultBossParticipationMode?: BossParticipationMode | null;
  forceBossParticipation: boolean;
  stageOrderJson: string[];
  defaultRolesJson?: string[] | null;
  version: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateStageRecord {
  id: string;
  templateId: string;
  stageKey: string;
  name: string;
  enabled: boolean;
  mode: "single" | "parallel" | "sequential-chain";
  primaryRoleAgentId: string;
  participantRoleAgentIdsJson: string[];
  roleExecutionPoliciesJson?: Array<Record<string, unknown>> | null;
  entryCriteriaJson?: string[] | null;
  exitCriteriaJson?: string[] | null;
  initialTaskDefinitionJson?: WorkflowTemplateStageInitialTaskDefinition | null;
  hooksJson?: Array<Record<string, unknown>> | null;
  gatesJson?: Array<Record<string, unknown>> | null;
  approvalsJson?: Array<Record<string, unknown>> | null;
  stageTemplateStrategyJson?: {
    onBlockedTemplateId?: string;
    onWaitingApprovalTemplateId?: string;
    note?: string;
  } | null;
  failurePolicyJson?: Record<string, unknown> | null;
  orderIndex: number;
}

export interface WorkflowTemplateStageInitialTaskDefinition {
  version: 1;
  titleTemplate: string;
  goalTemplate: string;
  instructionTemplate: string;
  doneWhen?: string[];
  defaultExecutionMode?: "single" | "parallel" | "sequential-chain";
  defaultCandidates?: Array<{
    model: string;
    label?: string;
  }>;
  defaultSteps?: Array<{
    id: string;
    title: string;
    instruction: string;
    model?: string;
  }>;
  contextBindings?: {
    includeProjectBrief?: boolean;
    includePreviousStageSummary?: boolean;
    includeCurrentStageExitCriteria?: boolean;
  };
  outputContract?: {
    summaryLabel?: string;
    artifactKeys?: string[];
    requireStageCompleteMarker?: boolean;
  };
}

export interface WorkflowStageCatalogItem {
  key: string;
  label: string;
  description: string;
}

export interface WorkflowTemplateEditorView {
  template: WorkflowTemplateRecord | null;
  stages: WorkflowTemplateStageRecord[];
  availableRoles: Array<{
    id: string;
    name: string;
    riskLevel?: string;
    defaultExecutionMode?: string;
    allowedStages?: string[];
  }>;
  stageCatalog: WorkflowStageCatalogItem[];
  diagnostics: {
    duplicateStageKeys: string[];
    missingConfiguredStages: string[];
    hasCustomStages: boolean;
  };
}

export interface ProjectWorkflowTemplateView {
  project: {
    id: string;
    name: string;
    slug: string;
  };
  currentTemplate: WorkflowTemplateRecord | null;
  workflowTemplateId: string | null;
  currentTemplateSource: "bound" | "unbound";
  stages: WorkflowTemplateStageRecord[];
  selectableTemplates: WorkflowTemplateRecord[];
  projectSettings: {
    preferredTemplateId: string | null;
    allowBossAutoTemplateSwitch: boolean;
  };
  currentTemplatePolicy: {
    defaultCollaborationMode?: CollaborationMode | null;
    defaultAutopilotLevel?: AutopilotLevel | null;
    defaultBossParticipationMode?: BossParticipationMode | null;
    forceBossParticipation: boolean;
  } | null;
  stageCatalog: WorkflowStageCatalogItem[];
  access: {
    canManage: boolean;
    message?: string | null;
  };
}

export interface OrchestrationBindingViewModel {
  id: string;
  bindingKey: string;
  label: string;
  runtimeAgent: string;
  enabled: boolean;
  priority: number;
  model?: string | null;
  source: "system" | "project";
}

export interface OrchestrationBindingResolutionViewModel {
  source: "system" | "project" | "mixed" | "none";
  sourceReason: string;
  activeBindings: OrchestrationBindingViewModel[];
  standbyBindings: OrchestrationBindingViewModel[];
  candidatePoolSize: number;
  maxBindings: number | null;
}

export interface OrchestrationStageRoleMatrixRowViewModel {
  roleAgentId: string;
  roleLabel: string;
  involvementKinds: string[];
  reasons: string[];
  executionMode: string;
  executionModeLabel: string;
  executionMethodSource: "stage-policy" | "project-override" | "system-default";
  executionMethodSourceLabel: string;
  projectMode: "platform-default" | "project-extend" | "project-takeover" | "unregistered";
  projectModeLabel: string;
  impactSummary: string;
  riskLevel: string;
  stageCovered: boolean;
  bindingResolution: OrchestrationBindingResolutionViewModel;
  warnings: string[];
}

export interface OrchestrationStageViewModel {
  id: string;
  stageKey: string;
  name: string;
  enabled: boolean;
  mode: "single" | "parallel" | "sequential-chain";
  orderIndex: number;
  primaryRoleAgentId: string;
  primaryRoleLabel: string;
  participantRoleAgentIdsJson: string[];
  gatesJson?: Array<Record<string, unknown>> | null;
  approvalsJson?: Array<Record<string, unknown>> | null;
  failurePolicyJson?: Record<string, unknown> | null;
  roleMatrix: OrchestrationStageRoleMatrixRowViewModel[];
  runtimeSummary: {
    totalTasks: number;
    runningCount: number;
    blockedCount: number;
    waitingApprovalCount: number;
    completedCount: number;
    failedCount: number;
    blockDecisionCount: number;
    approvalDecisionCount: number;
    openChangeRequestCount: number;
    blockingChangeRequestCount: number;
    latestTask: {
      taskId: string;
      title: string;
      workflowStatus: string;
      stageStatus: string;
      approvalState: string;
      blockingReason?: string;
      timestamp?: string | null;
    } | null;
  } | null;
}

export interface OrchestrationScenarioViewModel {
  source: "current" | "candidate";
  template: WorkflowTemplateRecord | null;
  stages: OrchestrationStageViewModel[];
}

export interface ProjectOrchestrationView {
  project: {
    id: string;
    name: string;
    slug: string;
  };
  workflowTemplateId: string | null;
  currentTemplate: WorkflowTemplateRecord | null;
  selectableTemplates: WorkflowTemplateRecord[];
  access: {
    canManage: boolean;
    message?: string | null;
  };
  roleCapabilities: Array<
    ProjectRoleExecutionViewRow & {
      executionModeLabel: string;
      projectModeLabel: string;
      bindingCounts: {
        system: number;
        project: number;
      };
    }
  >;
  scenarios: {
    current: OrchestrationScenarioViewModel;
    candidate: OrchestrationScenarioViewModel | null;
  };
}

export interface ProjectBossOperationTimelineItem extends BossDecisionRecord {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  workflowStatus: string;
  currentStageKey: string;
  openEscalationCount: number;
}

export interface ProjectBossEscalationItem extends HumanEscalationRequest {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  workflowStatus: string;
  currentStageKey: string;
}

export interface ProjectBossAttentionTaskItem {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  workflowStatus: string;
  currentStageKey: string;
  currentStageLabel: string;
  currentStageStatus: string;
  blockingReason?: string;
  openEscalationCount: number;
  bossDecisionCount: number;
  latestDecisionType?: string;
  latestDecisionReason?: string;
  latestDecisionTs?: string | null;
}

export interface ProjectManagementAttentionTaskItem extends ProjectBossAttentionTaskItem {
  managementDecisionCount: number;
}

export interface ProjectBossOverrideHistoryItem extends BossDecisionRecord {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  workflowStatus: string;
  currentStageKey: string;
  actorId?: string | null;
  overrideAction?: string | null;
  previousMode?: OperatingModeSelection | null;
  nextMode?: OperatingModeSelection | null;
}

export interface ProjectBossOperationsView {
  project: {
    id: string;
    name: string;
    slug: string;
  };
  summary: {
    totalTasks: number;
    tasksWithBossDecisions: number;
    totalBossDecisions: number;
    openEscalations: number;
    blockedTasks: number;
    waitingApprovalTasks: number;
    tasksNeedingAttention: number;
    manualOverrides: number;
  };
  timeline: ProjectBossOperationTimelineItem[];
  overrideHistory: ProjectBossOverrideHistoryItem[];
  escalations: ProjectBossEscalationItem[];
  attentionTasks: ProjectBossAttentionTaskItem[];
}

export interface ProjectManagementOperationsView {
  project: {
    id: string;
    name: string;
    slug: string;
  };
  summary: {
    totalTasks: number;
    tasksWithManagementDecisions: number;
    totalManagementDecisions: number;
    openEscalations: number;
    blockedTasks: number;
    waitingApprovalTasks: number;
    tasksNeedingAttention: number;
    manualOverrides: number;
    tasksWithBossDecisions?: number;
    totalBossDecisions?: number;
  };
  timeline: ProjectBossOperationTimelineItem[];
  overrideHistory: ProjectBossOverrideHistoryItem[];
  escalations: ProjectBossEscalationItem[];
  attentionTasks: ProjectManagementAttentionTaskItem[];
}

export async function listRoleAgents(projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ data: RoleAgentRecord[] }>(`/role-agents${suffix}`);
}

export async function listWorkflowTemplates(projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ data: WorkflowTemplateRecord[] }>(`/workflow-templates${suffix}`);
}

export async function createWorkflowTemplate(data: {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  category?: string;
  enabled: boolean;
  selectableByProjects: boolean;
  defaultCollaborationMode?: CollaborationMode;
  defaultAutopilotLevel?: AutopilotLevel;
  defaultBossParticipationMode?: BossParticipationMode;
  forceBossParticipation?: boolean;
  stageOrder: string[];
  defaultRoles?: string[];
}) {
  return request<WorkflowTemplateRecord>("/workflow-templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateWorkflowTemplate(
  templateId: string,
  data: Partial<{
    projectId: string;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
    selectableByProjects: boolean;
    defaultCollaborationMode: CollaborationMode;
    defaultAutopilotLevel: AutopilotLevel;
    defaultBossParticipationMode: BossParticipationMode;
    forceBossParticipation: boolean;
    stageOrder: string[];
    defaultRoles: string[];
  }>,
) {
  return request<WorkflowTemplateRecord>(`/workflow-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function cloneWorkflowTemplate(
  templateId: string,
  data: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    projectId?: string;
    enabled?: boolean;
    selectableByProjects?: boolean;
    defaultCollaborationMode?: CollaborationMode;
    defaultAutopilotLevel?: AutopilotLevel;
    defaultBossParticipationMode?: BossParticipationMode;
    forceBossParticipation?: boolean;
    defaultRoles?: string[];
  },
) {
  return request<{
    template: WorkflowTemplateRecord;
    stages: WorkflowTemplateStageRecord[];
    sourceTemplateId: string;
  }>(`/workflow-templates/${encodeURIComponent(templateId)}/clone`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listWorkflowTemplateStages(templateId: string) {
  return request<{ data: WorkflowTemplateStageRecord[] }>(
    `/workflow-templates/${encodeURIComponent(templateId)}/stages`,
  );
}

export async function createWorkflowTemplateStage(
  templateId: string,
  data: {
    id: string;
    stageKey: string;
    name: string;
    enabled: boolean;
    mode: "single" | "parallel" | "sequential-chain";
    primaryRoleAgentId: string;
    participantRoleAgentIds: string[];
    roleExecutionPolicies?: Array<Record<string, unknown>>;
    entryCriteria?: string[];
    exitCriteria?: string[];
    initialTaskDefinition?: WorkflowTemplateStageInitialTaskDefinition;
    hooks?: Array<Record<string, unknown>>;
    gates?: Array<Record<string, unknown>>;
    approvals?: Array<Record<string, unknown>>;
    stageTemplateStrategy?: {
      onBlockedTemplateId?: string;
      onWaitingApprovalTemplateId?: string;
      note?: string;
    };
    failurePolicy?: Record<string, unknown>;
    orderIndex: number;
  },
) {
  return request<WorkflowTemplateStageRecord>(
    `/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

export async function updateWorkflowTemplateStage(
  templateId: string,
  stageId: string,
  data: Partial<{
    stageKey: string;
    name: string;
    enabled: boolean;
    mode: "single" | "parallel" | "sequential-chain";
    primaryRoleAgentId: string;
    participantRoleAgentIds: string[];
    roleExecutionPolicies: Array<Record<string, unknown>>;
    entryCriteria: string[];
    exitCriteria: string[];
    initialTaskDefinition: WorkflowTemplateStageInitialTaskDefinition;
    hooks: Array<Record<string, unknown>>;
    gates: Array<Record<string, unknown>>;
    approvals: Array<Record<string, unknown>>;
    stageTemplateStrategy: {
      onBlockedTemplateId?: string;
      onWaitingApprovalTemplateId?: string;
      note?: string;
    };
    failurePolicy: Record<string, unknown>;
    orderIndex: number;
  }>,
) {
  return request<WorkflowTemplateStageRecord>(
    `/workflow-templates/${encodeURIComponent(templateId)}/stages/${encodeURIComponent(stageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export async function deleteWorkflowTemplateStage(templateId: string, stageId: string) {
  return request<{ ok: boolean; id: string }>(
    `/workflow-templates/${encodeURIComponent(templateId)}/stages/${encodeURIComponent(stageId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function getWorkflowTemplateEditorView(templateId: string) {
  return request<WorkflowTemplateEditorView>(
    `/workflow-templates/${encodeURIComponent(templateId)}/editor-view`,
  );
}

export async function getProjectWorkflowTemplateView(projectId: string) {
  return request<ProjectWorkflowTemplateView>(
    `/workflow-templates/projects/${encodeURIComponent(projectId)}/view`,
  );
}

export async function updateProjectWorkflowTemplateBinding(
  projectId: string,
  data: {
    workflowTemplateId: string | null;
    preferredTemplateId?: string | null;
    allowBossAutoTemplateSwitch?: boolean;
  },
) {
  return request<{
    projectId: string;
    workflowTemplateId: string | null;
    template: WorkflowTemplateRecord | null;
    projectSettings: {
      preferredTemplateId: string | null;
      allowBossAutoTemplateSwitch: boolean;
    };
  }>(`/workflow-templates/projects/${encodeURIComponent(projectId)}/selection`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getProjectRoleExecutionView(projectId: string) {
  return request<ProjectRoleExecutionView>(
    `/projects/${encodeURIComponent(projectId)}/role-execution-view`,
  );
}

export async function getProjectOrchestrationView(projectId: string, candidateTemplateId?: string) {
  const params = new URLSearchParams();
  if (candidateTemplateId) params.set("candidateTemplateId", candidateTemplateId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<ProjectOrchestrationView>(
    `/projects/${encodeURIComponent(projectId)}/orchestration-view${suffix}`,
  );
}

export async function getProjectBossOperationsView(projectId: string) {
  return request<ProjectBossOperationsView>(
    `/projects/${encodeURIComponent(projectId)}/boss-operations-view`,
  );
}

export async function getProjectManagementOperationsView(projectId: string) {
  return request<ProjectManagementOperationsView>(
    `/projects/${encodeURIComponent(projectId)}/management-operations-view`,
  );
}

export interface ProjectTaskGraphTaskView {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  prompt: string;
  status: string;
  category?: string | null;
  strategy?: string | null;
  repoName?: string | null;
  workingBranch?: string | null;
  selectedModel?: string | null;
  changesSummary?: {
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  } | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  currentStageLabel?: string | null;
  latestActivityAt?: string | null;
}

export interface ProjectTaskGraphEdgeView {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: "depends-on" | "blocks" | "spawned-from";
  source: "task-graph" | "task-fork" | "future-source";
}

export interface ProjectTaskGraphView {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  tasks: ProjectTaskGraphTaskView[];
  edges: ProjectTaskGraphEdgeView[];
  capabilities: {
    supportsDependsOn: boolean;
    supportsBlocks: boolean;
    supportsSpawnedFrom: boolean;
  };
  refreshedAt: string;
}

export async function getProjectTaskGraphView(projectId: string) {
  return request<ProjectTaskGraphView>(
    `/projects/${encodeURIComponent(projectId)}/task-graph-view`,
  );
}

// ── Task Execution Trace ──────────────────────────────────────────

export interface ExecutionTraceSegment {
  type:
    | "user-input"
    | "workflow-context"
    | "hook-injection"
    | "hook-result"
    | "hook-rewrite"
    | "final-prompt"
    | "model-response"
    | "tool-call"
    | "tool-output"
    | "thinking"
    | "file-reference"
    | "diff"
    | "candidate-result"
    | "judge-decision"
    | "chain-step-result"
    | "status-transition"
    | "session-activate"
    | "session-branch"
    | "session-archive";
  label: string;
  content: string;
  hookId?: string;
  hookTrigger?: string;
  hookAgent?: string;
  hookDecisionAction?: string;
  timestamp?: string;
  toolName?: string;
  toolArgumentsSummary?: string;
  toolStatus?: string;
  filePath?: string;
  fileRange?: string;
  diffSummary?: string;
}

export interface ExecutionTraceMessage {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  raw: unknown;
}

export interface ExecutionTraceTimelineItem {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
  sourceEventTypes?: string[];
}

export type ExecutionTraceReadSource =
  | "conversation-table"
  | "task-domain-events"
  | "conversation-table+task-domain-events"
  | "runtime-fallback"
  | "task-domain-projection";

export interface ExecutionTraceTimelineMeta {
  readSource?: ExecutionTraceReadSource;
  cacheState?: "none" | "partial" | "complete";
  complete?: boolean;
  includeLineage?: boolean;
  lineagePath?: string[];
  cachedSessionCount?: number;
  itemCount?: number;
}

export interface ExecutionTraceProjectionSnapshot {
  status: string;
  latestResult?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  activeCandidateCount: number;
  completedCandidateCount: number;
  failedCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
  lastActivityAt?: string | null;
  updatedAt: string;
  debugSnapshot?: {
    orchestrationKind?: string | null;
    currentStatus: string;
    currentRunId?: string | null;
    currentSessionId?: string | null;
    winnerNodeId?: string | null;
  };
}

export interface TaskExecutionTrace {
  taskId: string;
  sessionId: string | null;
  traceId?: string | null;
  workflowContext?: string | null;
  finalPrompt?: string | null;
  latestResponse?: string | null;
  truncated?: boolean;
  messageLimit?: number;
  segments: ExecutionTraceSegment[];
  messages?: ExecutionTraceMessage[];
  timeline?: ExecutionTraceTimelineItem[];
  timelineMeta?: ExecutionTraceTimelineMeta;
  snapshot?: ExecutionTraceProjectionSnapshot | null;
  hookExecutions: Array<{
    hookId: string;
    trigger: string;
    status: string;
    agent: string;
    model?: string;
    prompt: string;
    result?: string;
    decision?: {
      action: string;
      reason?: string;
      rewrittenPrompt?: string;
      followupTemplateId?: string;
      followupGoal?: string;
      targetAgent?: string;
      targetModel?: string;
    };
    completedAt: string;
  }>;
  followupExecutions: Array<{
    templateId: string;
    triggerHookId: string;
    status: string;
    failureType?: "template-missing" | "runtime-error";
    agent: string;
    model?: string;
    prompt: string;
    result?: string;
    error?: string;
    completedAt: string;
  }>;
}

export async function getTaskExecutionTrace(projectId: string, taskId: string) {
  return request<TaskExecutionTrace>(
    `/projects/${encodeURIComponent(projectId)}/task-execution-trace/${encodeURIComponent(taskId)}`,
  );
}

export async function getTaskExecutionTraceView(
  taskId: string,
  sessionId?: string,
  options?: { includeLineage?: boolean; includeDebug?: boolean },
) {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  if (options?.includeLineage === false) {
    params.set("includeLineage", "false");
  }
  if (options?.includeDebug === true) {
    params.set("includeDebug", "true");
  }
  const query = params.toString();
  const trace = await request<TaskExecutionTrace>(
    `/tasks/${encodeURIComponent(taskId)}/execution-trace${query ? `?${query}` : ""}`,
  );

  const includeLineage = options?.includeLineage ?? trace.timelineMeta?.includeLineage ?? true;
  const mergedTimeline = buildMergedTraceTimelineItems(trace, { includeLineage });
  if (mergedTimeline.length === 0) {
    return trace;
  }

  return {
    ...trace,
    timeline: mergedTimeline,
  };
}

export async function getRoleAgentProjectOverride(roleAgentId: string, projectId: string) {
  return request<{ data: RoleAgentProjectOverrideRecord }>(
    `/role-agents/${encodeURIComponent(roleAgentId)}/projects/${encodeURIComponent(projectId)}/override`,
  );
}

export async function upsertRoleAgentProjectOverride(
  roleAgentId: string,
  projectId: string,
  data: UpsertRoleAgentProjectOverrideInput,
) {
  return request<{ data: RoleAgentProjectOverrideRecord }>(
    `/role-agents/${encodeURIComponent(roleAgentId)}/projects/${encodeURIComponent(projectId)}/override`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
}

export async function listRoleAgentBindings(roleAgentId: string, projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ data: RoleAgentBindingRecord[] }>(
    `/role-agents/${encodeURIComponent(roleAgentId)}/bindings${suffix}`,
  );
}

export async function createRoleAgentBinding(
  roleAgentId: string,
  data: UpsertRoleAgentBindingInput,
) {
  return request<RoleAgentBindingRecord>(
    `/role-agents/${encodeURIComponent(roleAgentId)}/bindings`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

export async function updateRoleAgentBinding(
  roleAgentId: string,
  bindingId: string,
  data: UpdateRoleAgentBindingInput,
) {
  return request<RoleAgentBindingRecord>(
    `/role-agents/${encodeURIComponent(roleAgentId)}/bindings/${encodeURIComponent(bindingId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export async function getTaskWorkflow(taskId: string) {
  return request<{
    data: { workflowRun: Record<string, unknown> | null; stages: TaskStageViewModel[] };
  }>(`/tasks/${encodeURIComponent(taskId)}/workflow`);
}

export async function getTaskRoleConclusions(taskId: string) {
  return request<{ data: RoleConclusionViewModel[] }>(
    `/tasks/${encodeURIComponent(taskId)}/role-conclusions`,
  );
}

export async function getDeveloperChangeRequests(taskId: string) {
  return request<{ data: DeveloperChangeRequestViewModel[] }>(
    `/tasks/${encodeURIComponent(taskId)}/developer-change-requests`,
  );
}

export async function updateDeveloperChangeRequest(
  taskId: string,
  data: {
    requestId: string;
    status: "open" | "acknowledged" | "in-progress" | "resolved" | "won't-fix";
    resolutionNote?: string;
  },
) {
  return request<{ ok: boolean }>(
    `/tasks/${encodeURIComponent(taskId)}/developer-change-requests`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export async function getTaskWorkflowView(taskId: string) {
  return request<TaskWorkflowViewModel>(`/tasks/${encodeURIComponent(taskId)}/workflow-view`);
}

export async function getTaskMemberView(taskId: string) {
  return request<TaskMemberViewModel>(`/tasks/${encodeURIComponent(taskId)}/member-view`);
}
