import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ltree } from "./custom-types";

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
  collaborationMode?: "solo" | "team" | "hybrid";
  autopilotLevel?: "L0" | "L1" | "L2";
  bossParticipationMode?: "disabled" | "advisory" | "exception-only" | "full-manager";
  preferredTemplateId?: string | null;
  allowBossAutoTemplateSwitch?: boolean;
  allowHybridEscalation?: boolean;
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

export type PaidExecutionLeaseStatus = "active" | "revoked" | "expired";
export type RuntimeUsageLedgerStatus = "running" | "completed" | "failed" | "cancelled";
export type RuntimeUsageLedgerStepType = "execution" | "judge" | "hook" | "resume" | "other";
export type RuntimeUsageLedgerStepStatus = "pending" | "completed" | "failed" | "skipped";
export type RuntimeUsageBaselineMatchScope =
  | "project+provider+model+entrypoint+fingerprint"
  | "project+provider+model+entrypoint"
  | "project+provider+model"
  | "project+entrypoint"
  | "project";

// ── Organizations ──────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Projects ───────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  settings: jsonb("settings").$type<ProjectSettings>(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Project Tree ──────────────────────────────────────────────────

export const projectTreeNodes = pgTable(
  "project_tree_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    parentId: text("parent_id"),
    path: ltree("path").notNull(),
    depth: integer("depth").notNull().default(0),
    nodeType: text("node_type").$type<ProjectTreeNodeType>().notNull(),
    role: text("role"),
    contentText: text("content_text"),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>(),
    tokenCount: integer("token_count"),
    runtimeSessionId: text("runtime_session_id"),
    runtimeMessageId: text("runtime_message_id"),
    branchName: text("branch_name"),
    isActive: boolean("is_active").notNull().default(true),
    supersededBy: text("superseded_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("idx_ptn_project_path").using("gist", table.path),
    index("idx_ptn_project_id").on(table.projectId),
    index("idx_ptn_parent_id").on(table.parentId),
    index("idx_ptn_node_type").on(table.projectId, table.nodeType),
  ],
);

export const projectTreeBranches = pgTable("project_tree_branches", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  taskNodeId: text("task_node_id").references(() => projectTreeNodes.id),
  branchName: text("branch_name").notNull(),
  headNodeId: text("head_node_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectTreeEvents = pgTable(
  "project_tree_events",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id").references(() => projectTreeNodes.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    seq: integer("seq").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_pte_node_seq").on(table.nodeId, table.seq),
    index("idx_pte_project_time").on(table.projectId, table.createdAt),
  ],
);

export const projectTreeLinks = pgTable(
  "project_tree_links",
  {
    id: text("id").primaryKey(),
    sourceNodeId: text("source_node_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    sourceProjectId: text("source_project_id")
      .notNull()
      .references(() => projects.id),
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    targetProjectId: text("target_project_id")
      .notNull()
      .references(() => projects.id),
    linkType: text("link_type").$type<ProjectTreeLinkType>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    bidirectional: boolean("bidirectional").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_ptl_unique_edge").on(
      table.sourceNodeId,
      table.targetNodeId,
      table.linkType,
    ),
    index("idx_ptl_source").on(table.sourceNodeId),
    index("idx_ptl_target").on(table.targetNodeId),
    index("idx_ptl_source_project").on(table.sourceProjectId, table.linkType),
    index("idx_ptl_target_project").on(table.targetProjectId, table.linkType),
  ],
);

// ── Environments ───────────────────────────────────────────────────

export const environments = pgTable("environments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(), // dev | staging | production
  riskLevel: text("risk_level").notNull().default("low"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Users ──────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  role: text("role", {
    enum: ["platform_admin", "org_admin", "project_admin", "developer", "viewer"],
  })
    .notNull()
    .default("developer"),
  accountStatus: text("account_status").notNull().default("active"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  tokenVersion: integer("token_version").notNull().default(0),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectRoles = pgTable("project_roles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  role: text("role", {
    enum: ["project_admin", "developer", "viewer"],
  }).notNull(),
});

export const paidExecutionLeases = pgTable(
  "paid_execution_leases",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    issuedByUserId: text("issued_by_user_id")
      .notNull()
      .references(() => users.id),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id),
    reason: text("reason"),
    status: text("status").notNull().default("active"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("idx_paid_execution_leases_project_status").on(
      table.projectId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const runtimeUsageLedgers = pgTable(
  "runtime_usage_ledgers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: text("task_id").references(() => projectTreeNodes.id),
    agentRunId: text("agent_run_id").references(() => agentRuns.id),
    runtimeSessionId: text("runtime_session_id").notNull(),
    executionSource: text("execution_source").notNull(),
    entrypointType: text("entrypoint_type").notNull(),
    orchestrationFingerprint: text("orchestration_fingerprint"),
    defaultProviderId: text("default_provider_id"),
    defaultModelId: text("default_model_id"),
    requestCount: integer("request_count").notNull().default(0),
    stepCount: integer("step_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    candidateCount: integer("candidate_count").notNull().default(1),
    judgeRequestCount: integer("judge_request_count").notNull().default(0),
    hookRequestCount: integer("hook_request_count").notNull().default(0),
    status: text("status").notNull().default("running"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    syncedAt: text("synced_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_runtime_usage_ledgers_runtime_session").on(table.runtimeSessionId),
    index("idx_runtime_usage_ledgers_project_time").on(table.projectId, table.createdAt),
    index("idx_runtime_usage_ledgers_agent_run").on(table.agentRunId),
  ],
);

export const runtimeUsageLedgerSteps = pgTable(
  "runtime_usage_ledger_steps",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => runtimeUsageLedgers.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: text("task_id").references(() => projectTreeNodes.id),
    agentRunId: text("agent_run_id").references(() => agentRuns.id),
    runtimeSessionId: text("runtime_session_id"),
    stepType: text("step_type").notNull(),
    triggerType: text("trigger_type"),
    hookId: text("hook_id"),
    candidateIndex: integer("candidate_index"),
    requestIndex: integer("request_index").notNull().default(0),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    amplificationSource: text("amplification_source"),
    status: text("status").notNull().default("completed"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_runtime_usage_ledger_steps_ledger_request").on(table.ledgerId, table.requestIndex),
    index("idx_runtime_usage_ledger_steps_project_time").on(table.projectId, table.createdAt),
    index("idx_runtime_usage_ledger_steps_task_type").on(
      table.taskId,
      table.stepType,
      table.triggerType,
    ),
  ],
);

export const runtimeUsageBaselines = pgTable(
  "runtime_usage_baselines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    providerId: text("provider_id").notNull().default(""),
    modelId: text("model_id").notNull().default(""),
    entrypointType: text("entrypoint_type").notNull().default(""),
    orchestrationFingerprint: text("orchestration_fingerprint").notNull().default(""),
    matchScope: text("match_scope", {
      enum: [
        "project+provider+model+entrypoint+fingerprint",
        "project+provider+model+entrypoint",
        "project+provider+model",
        "project+entrypoint",
        "project",
      ],
    })
      .notNull()
      .default("project"),
    sampleSize: integer("sample_size").notNull().default(0),
    p50RequestCount: doublePrecision("p50_request_count"),
    p90RequestCount: doublePrecision("p90_request_count"),
    p50InputTokens: doublePrecision("p50_input_tokens"),
    p90InputTokens: doublePrecision("p90_input_tokens"),
    p50OutputTokens: doublePrecision("p50_output_tokens"),
    p90OutputTokens: doublePrecision("p90_output_tokens"),
    p50TotalTokens: doublePrecision("p50_total_tokens"),
    p90TotalTokens: doublePrecision("p90_total_tokens"),
    p50CostUsd: doublePrecision("p50_cost_usd"),
    p90CostUsd: doublePrecision("p90_cost_usd"),
    lastLedgerAt: text("last_ledger_at"),
    generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_runtime_usage_baselines_project_scope").on(
      table.projectId,
      table.providerId,
      table.modelId,
      table.entrypointType,
      table.orchestrationFingerprint,
      table.matchScope,
    ),
    index("idx_runtime_usage_baselines_project_generated").on(table.projectId, table.generatedAt),
  ],
);

// ── Repositories ───────────────────────────────────────────────────

export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  provider: text("provider", {
    enum: ["github", "gitlab", "gitea", "local"],
  }).notNull(),
  remoteUrl: text("remote_url").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  description: text("description"),
  status: text("status", {
    enum: ["active", "archived", "error"],
  })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Repository Credentials (references, not raw secrets) ───────────

export type CredentialType = "pat" | "oauth_token" | "ssh_key_ref" | "app_installation";

export const repositoryCredentials = pgTable("repository_credentials", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  repoId: text("repo_id").references(() => repositories.id), // null = project-wide
  label: text("label").notNull(),
  provider: text("provider", {
    enum: ["github", "gitlab", "gitea", "local"],
  }).notNull(),
  credentialType: text("credential_type", {
    enum: ["pat", "oauth_token", "ssh_key_ref", "app_installation"],
  }).notNull(),
  /** Where the real secret lives — e.g. env var name or secret-store path. Never a raw token. */
  secretRef: text("secret_ref").notNull(),
  gitAuthorName: text("git_author_name"),
  gitAuthorEmail: text("git_author_email"),
  scope: text("scope").notNull().default("project"),
  isDefault: boolean("is_default").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Policy Templates ───────────────────────────────────────────────

export const policyTemplates = pgTable("policy_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["tool_whitelist", "path_whitelist", "command_level", "concurrency", "model"],
  }).notNull(),
  rules: jsonb("rules").$type<Record<string, unknown>>(),
  appliesTo: text("applies_to").notNull().default("all"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Audit Events ───────────────────────────────────────────────────

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull().default(sql`CURRENT_TIMESTAMP`),
  userId: text("user_id"),
  projectId: text("project_id"),
  sessionId: text("session_id"),
  taskId: text("task_id"),
  agentRunId: text("agent_run_id"),
  eventType: text("event_type").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  riskLevel: text("risk_level").default("low"),
  traceId: text("trace_id"),
  // Identity-chain fields
  credentialId: text("credential_id"),
  authorResolvedAs: text("author_resolved_as"), // e.g. "user:alice" or "shared:ci-bot"
});

// ── Cost Records ───────────────────────────────────────────────────

export const costRecords = pgTable("cost_records", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull().default(sql`CURRENT_TIMESTAMP`),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  userId: text("user_id"),
  sessionId: text("session_id"),
  taskId: text("task_id"),
  agentRunId: text("agent_run_id"),
  modelId: text("model_id").notNull(),
  providerId: text("provider_id").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cost: doublePrecision("cost").notNull(),
  budgetPeriod: text("budget_period"),
});

// ── Approval Tickets ───────────────────────────────────────────────

export const approvalTickets = pgTable("approval_tickets", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  agentRunId: text("agent_run_id"),
  actionType: text("action_type", {
    enum: ["production_write", "level3_command", "budget_exceed", "batch_edit", "external_api"],
  }).notNull(),
  riskLevel: text("risk_level").notNull(),
  status: text("status").notNull().default("pending"),
  requestDetail: jsonb("request_detail").$type<Record<string, unknown>>(),
  approver: text("approver"),
  comment: text("comment"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
  expiresAt: text("expires_at").notNull(),
});

// ── Agent Runs (individual agent execution records) ────────────────

export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  sessionId: text("session_id"),
  agentType: text("agent_type").notNull(),
  status: text("status", {
    enum: ["pending", "running", "paused", "completed", "failed", "stopped", "terminated"],
  })
    .notNull()
    .default("pending"),
  modelUsed: text("model_used"),
  tokenUsed: integer("token_used").notNull().default(0),
  result: text("result"),
  error: text("error"),
  candidateIndex: integer("candidate_index"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Code Changes ───────────────────────────────────────────────────

export const codeChanges = pgTable("code_changes", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  repoId: text("repo_id").references(() => repositories.id),
  agentRunId: text("agent_run_id").references(() => agentRuns.id),
  changeSource: text("change_source", {
    enum: ["runtime_diff", "task_snapshot", "git_commit"],
  }).notNull(),
  commitSha: text("commit_sha"),
  commitAuthorName: text("commit_author_name"),
  commitAuthorEmail: text("commit_author_email"),
  commitMessage: text("commit_message"),
  branchName: text("branch_name"),
  summary: text("summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fileChanges = pgTable("file_changes", {
  id: text("id").primaryKey(),
  changeId: text("change_id")
    .notNull()
    .references(() => codeChanges.id),
  filePath: text("file_path").notNull(),
  changeType: text("change_type", {
    enum: ["added", "modified", "deleted", "renamed"],
  }).notNull(),
  oldPath: text("old_path"),
  insertions: integer("insertions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
});

// ── Plugins (lifecycle metadata) ───────────────────────────────────

export const plugins = pgTable("plugins", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  pluginPath: text("plugin_path").notNull(), // path in opencode.json plugin array
  version: text("version"),
  source: text("source").notNull().default("local"),
  status: text("status").notNull().default("enabled"),
  description: text("description"),
  capabilities: jsonb("capabilities").$type<string[]>(), // tool names exposed
  lastVerifiedAt: text("last_verified_at"),
  errorDetail: text("error_detail"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Budget Configs ─────────────────────────────────────────────────

export const budgetConfigs = pgTable("budget_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  period: text("period").notNull(),
  limitAmount: doublePrecision("limit_amount").notNull(),
  warnThreshold: doublePrecision("warn_threshold").notNull().default(0.8),
  throttleThreshold: doublePrecision("throttle_threshold").notNull().default(0.95),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Workbench Layouts ──────────────────────────────────────────────

export const workbenchLayouts = pgTable("workbench_layouts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  layoutJson: text("layout_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Role Agents ───────────────────────────────────────────────────

export const roleAgents = pgTable("role_agents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  name: text("name").notNull(),
  description: text("description"),
  scope: text("scope").notNull().default("system"),
  status: text("status").notNull().default("active"),
  ownerTeam: text("owner_team"),
  permissionProfile: text("permission_profile").notNull(),
  toolProfile: text("tool_profile").notNull(),
  defaultExecutionMode: text("default_execution_mode", {
    enum: ["single", "parallel-review", "round-robin"],
  })
    .notNull()
    .default("single"),
  aggregationStrategy: text("aggregation_strategy", {
    enum: ["first-pass", "majority", "merge-summary", "human-review"],
  }),
  maxActiveBindings: integer("max_active_bindings"),
  requireConsensus: boolean("require_consensus").notNull().default(false),
  riskLevel: text("risk_level").notNull().default("low"),
  requiresApprovalForWrite: boolean("requires_approval_for_write").notNull().default(false),
  allowedStagesJson: jsonb("allowed_stages_json").$type<string[]>().notNull(),
  outputSchemaId: text("output_schema_id"),
  tagsJson: jsonb("tags_json").$type<string[]>(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roleAgentBindings = pgTable(
  "role_agent_bindings",
  {
    id: text("id").primaryKey(),
    roleAgentId: text("role_agent_id")
      .notNull()
      .references(() => roleAgents.id),
    projectId: text("project_id").references(() => projects.id),
    bindingKey: text("binding_key").notNull(),
    runtimeAgent: text("runtime_agent").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(1),
    model: text("model"),
    tagsJson: jsonb("tags_json").$type<string[]>(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_role_agent_bindings_role_project_key").on(
      table.roleAgentId,
      table.projectId,
      table.bindingKey,
    ),
  ],
);

export const roleAgentProjectOverrides = pgTable(
  "role_agent_project_overrides",
  {
    id: text("id").primaryKey(),
    roleAgentId: text("role_agent_id")
      .notNull()
      .references(() => roleAgents.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name"),
    description: text("description"),
    status: text("status"),
    ownerTeam: text("owner_team"),
    permissionProfile: text("permission_profile"),
    toolProfile: text("tool_profile"),
    defaultExecutionMode: text("default_execution_mode", {
      enum: ["single", "parallel-review", "round-robin"],
    }),
    aggregationStrategy: text("aggregation_strategy", {
      enum: ["first-pass", "majority", "merge-summary", "human-review"],
    }),
    maxActiveBindings: integer("max_active_bindings"),
    requireConsensus: boolean("require_consensus"),
    riskLevel: text("risk_level"),
    requiresApprovalForWrite: boolean("requires_approval_for_write"),
    allowedStagesJson: jsonb("allowed_stages_json").$type<string[]>(),
    outputSchemaId: text("output_schema_id"),
    tagsJson: jsonb("tags_json").$type<string[]>(),
    bindingsMode: text("bindings_mode").notNull().default("inherit"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_role_agent_project_overrides_role_project").on(
      table.roleAgentId,
      table.projectId,
    ),
  ],
);

// ── Workflow Templates ────────────────────────────────────────────

export const workflowTemplates = pgTable("workflow_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  enabled: boolean("enabled").notNull().default(true),
  selectableByProjects: boolean("selectable_by_projects").notNull().default(true),
  defaultCollaborationMode: text("default_collaboration_mode", {
    enum: ["solo", "team", "hybrid"],
  }),
  defaultAutopilotLevel: text("default_autopilot_level", {
    enum: ["L0", "L1", "L2"],
  }),
  defaultBossParticipationMode: text("default_boss_participation_mode", {
    enum: ["disabled", "advisory", "exception-only", "full-manager"],
  }),
  forceBossParticipation: boolean("force_boss_participation").notNull().default(false),
  stageOrderJson: jsonb("stage_order_json").$type<string[]>().notNull(),
  defaultRolesJson: jsonb("default_roles_json").$type<string[]>(),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workflowTemplateStages = pgTable("workflow_template_stages", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id),
  stageKey: text("stage_key").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  mode: text("mode").notNull().default("single"),
  primaryRoleAgentId: text("primary_role_agent_id").notNull(),
  participantRoleAgentIdsJson: jsonb("participant_role_agent_ids_json").$type<string[]>().notNull(),
  roleExecutionPoliciesJson: jsonb("role_execution_policies_json"),
  entryCriteriaJson: jsonb("entry_criteria_json").$type<string[]>(),
  exitCriteriaJson: jsonb("exit_criteria_json").$type<string[]>(),
  initialTaskDefinitionJson: jsonb("initial_task_definition_json").$type<{
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
  }>(),
  hooksJson: jsonb("hooks_json"),
  gatesJson: jsonb("gates_json"),
  approvalsJson: jsonb("approvals_json"),
  stageTemplateStrategyJson: jsonb("stage_template_strategy_json").$type<{
    onBlockedTemplateId?: string;
    onWaitingApprovalTemplateId?: string;
    note?: string;
  }>(),
  failurePolicyJson: jsonb("failure_policy_json"),
  orderIndex: integer("order_index").notNull().default(0),
});

// ── Task Workflow Runs ────────────────────────────────────────────

export const taskWorkflowRuns = pgTable("task_workflow_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  templateId: text("template_id").notNull(),
  currentStage: text("current_stage").notNull(),
  status: text("status", {
    enum: ["pending", "running", "blocked", "waiting-approval", "failed", "completed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const taskStageRuns = pgTable("task_stage_runs", {
  id: text("id").primaryKey(),
  workflowRunId: text("workflow_run_id")
    .notNull()
    .references(() => taskWorkflowRuns.id),
  stageKey: text("stage_key").notNull(),
  status: text("status", {
    enum: [
      "pending",
      "running",
      "blocked",
      "waiting-approval",
      "failed",
      "completed",
      "skipped",
      "cancelled",
    ],
  })
    .notNull()
    .default("pending"),
  primaryRoleAgentId: text("primary_role_agent_id").notNull(),
  participantRoleAgentIdsJson: jsonb("participant_role_agent_ids_json").$type<string[]>(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  blockingReason: text("blocking_reason"),
  approvalState: text("approval_state", {
    enum: ["not-required", "pending", "approved", "rejected", "expired", "cancelled"],
  })
    .notNull()
    .default("not-required"),
  artifactsSummaryJson: jsonb("artifacts_summary_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roleAggregateConclusions = pgTable("role_aggregate_conclusions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  taskStageRunId: text("task_stage_run_id"),
  roleAgentId: text("role_agent_id").notNull(),
  stage: text("stage").notNull(),
  aggregationStrategy: text("aggregation_strategy", {
    enum: ["first-pass", "majority", "merge-summary", "human-review"],
  }).notNull(),
  status: text("status", {
    enum: ["aligned", "partially-aligned", "conflicted", "escalated", "blocked"],
  }).notNull(),
  finalDecision: text("final_decision", {
    enum: ["allow", "notify-developer", "needs-approval", "block", "observe", "human-review"],
  }).notNull(),
  aggregateRiskLevel: text("aggregate_risk_level", {
    enum: ["low", "medium", "high", "critical"],
  }).notNull(),
  confidenceScore: doublePrecision("confidence_score").notNull().default(0),
  consensusScore: doublePrecision("consensus_score").notNull().default(0),
  winningRationale: text("winning_rationale").notNull(),
  mergedFindingsJson: jsonb("merged_findings_json").$type<Record<string, unknown>[]>(),
  minorityFindingsJson: jsonb("minority_findings_json").$type<Record<string, unknown>[]>(),
  conflictsJson: jsonb("conflicts_json").$type<Record<string, unknown>[]>(),
  approvalRecommendationJson: jsonb("approval_recommendation_json").$type<
    Record<string, unknown>
  >(),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const developerChangeRequests = pgTable("developer_change_requests", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  taskStageRunId: text("task_stage_run_id"),
  sourceRoleAgentId: text("source_role_agent_id").notNull(),
  assignedRoleAgentId: text("assigned_role_agent_id").notNull().default("role.developer"),
  priority: text("priority").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  requiredChangesJson: jsonb("required_changes_json").$type<string[]>().notNull(),
  relatedFindingKeysJson: jsonb("related_finding_keys_json").$type<string[]>(),
  blocking: boolean("blocking").notNull().default(false),
  approvalRequired: boolean("approval_required").notNull().default(false),
  status: text("status", {
    enum: ["open", "acknowledged", "in-progress", "resolved", "won't-fix"],
  })
    .notNull()
    .default("open"),
  resolutionNote: text("resolution_note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
});

export const taskOperatingModes = pgTable("task_operating_modes", {
  taskId: text("task_id")
    .primaryKey()
    .references(() => projectTreeNodes.id),
  collaborationMode: text("collaboration_mode").notNull(),
  autopilotLevel: text("autopilot_level").notNull(),
  bossParticipationMode: text("boss_participation_mode").notNull(),
  selectedTemplateId: text("selected_template_id"),
  scenarioKey: text("scenario_key"),
  source: text("source").notNull().default("task-override"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const bossDecisions = pgTable(
  "boss_decisions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    ts: text("ts").notNull(),
    decisionType: text("decision_type").notNull(),
    reason: text("reason").notNull(),
    confidence: doublePrecision("confidence"),
    stageKey: text("stage_key"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_boss_decisions_task_ts").on(table.taskId, table.ts)],
);

export const humanEscalations = pgTable(
  "human_escalations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    ts: text("ts").notNull(),
    reason: text("reason").notNull(),
    status: text("status"),
    stageKey: text("stage_key"),
    requestedBy: text("requested_by"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_human_escalations_task_ts").on(table.taskId, table.ts)],
);
