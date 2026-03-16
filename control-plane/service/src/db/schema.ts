import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type ApprovalPolicyMode = "balanced" | "strict" | "manual";

export interface EnvironmentApprovalPolicyBinding {
  approvalPolicy?: ApprovalPolicyMode;
  policyTemplateId?: string;
}

export interface ProjectSettings {
  defaultModel?: string;
  defaultEnvironmentId?: string;
  workflowTemplateId?: string;
  approvalPolicyTemplateId?: string;
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

// ── Organizations ──────────────────────────────────────────────────

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Projects ───────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  settings: text("settings", { mode: "json" }).$type<ProjectSettings>(),
  status: text("status", { enum: ["active", "archived"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Environments ───────────────────────────────────────────────────

export const environments = sqliteTable("environments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(), // dev | staging | production
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] })
    .notNull()
    .default("low"),
  requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Users ──────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
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
  accountStatus: text("account_status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  tokenVersion: integer("token_version").notNull().default(0),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectRoles = sqliteTable("project_roles", {
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

// ── Sessions (extends OpenCode sessions) ───────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // maps to OpenCode sessionId
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  taskId: text("task_id"),
  tokensUsed: integer("tokens_used").default(0),
  cost: real("cost").default(0),
  modelUsed: text("model_used"),
  agentUsed: text("agent_used"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
});

// ── Task Sessions (branch lineage for fork tree) ───────────────────

export const taskSessions = sqliteTable("task_sessions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  runtimeSessionId: text("runtime_session_id").notNull(), // OpenCode session ID
  parentRuntimeSessionId: text("parent_runtime_session_id"), // parent session, null = root
  forkedFromMessageId: text("forked_from_message_id"), // message-level fork point
  branchName: text("branch_name"),
  sourceType: text("source_type", {
    enum: ["root", "fork", "sub_session"],
  })
    .notNull()
    .default("root"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  archivedAt: text("archived_at"),
});

// ── Repositories ───────────────────────────────────────────────────

export const repositories = sqliteTable("repositories", {
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

export const repositoryCredentials = sqliteTable("repository_credentials", {
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
  scope: text("scope", { enum: ["project", "shared"] })
    .notNull()
    .default("project"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "revoked", "expired"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Tasks ──────────────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status", {
    enum: ["pending", "running", "paused", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  sessionId: text("session_id"), // OpenCode session ID once execution starts
  agentRunId: text("agent_run_id"),
  result: text("result"),
  category: text("category", {
    enum: ["quick", "deep", "ops", "security", "architecture"],
  }),
  strategy: text("strategy"), // JSON summary of execution strategy from orchestrator-plugin
  repoId: text("repo_id").references(() => repositories.id),
  workspaceRoot: text("workspace_root"),
  baseRevision: text("base_revision"),
  workingBranch: text("working_branch"),

  // ── Model selection ─────────────────────────────────────────────
  selectedModel: text("selected_model"), // user-chosen model at task creation

  // ── Multi-agent execution ───────────────────────────────────────
  executionMode: text("execution_mode", { enum: ["single", "parallel"] }).default("single"),
  executionPlan: text("execution_plan"), // JSON: ExecutionPlan

  // ── Identity snapshot (frozen at execution start) ───────────────
  credentialId: text("credential_id").references(() => repositoryCredentials.id),
  gitAuthorName: text("git_author_name"),
  gitAuthorEmail: text("git_author_email"),
  gitCommitterName: text("git_committer_name"),
  gitCommitterEmail: text("git_committer_email"),

  // ── Post-execution facts ────────────────────────────────────────
  finalCommitSha: text("final_commit_sha"),
  finalBranchName: text("final_branch_name"),
  changesSummary: text("changes_summary", { mode: "json" }).$type<{
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  }>(),

  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

// ── Policy Templates ───────────────────────────────────────────────

export const policyTemplates = sqliteTable("policy_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["tool_whitelist", "path_whitelist", "command_level", "concurrency", "model"],
  }).notNull(),
  rules: text("rules", { mode: "json" }).$type<Record<string, unknown>>(),
  appliesTo: text("applies_to", { enum: ["all", "environment", "agent"] })
    .notNull()
    .default("all"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Audit Events ───────────────────────────────────────────────────

export const auditEvents = sqliteTable("audit_events", {
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
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] }).default("low"),
  traceId: text("trace_id"),
  // Identity-chain fields
  credentialId: text("credential_id"),
  authorResolvedAs: text("author_resolved_as"), // e.g. "user:alice" or "shared:ci-bot"
});

// ── Cost Records ───────────────────────────────────────────────────

export const costRecords = sqliteTable("cost_records", {
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
  cost: real("cost").notNull(),
  budgetPeriod: text("budget_period", { enum: ["daily", "weekly", "monthly"] }),
});

// ── Approval Tickets ───────────────────────────────────────────────

export const approvalTickets = sqliteTable("approval_tickets", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  agentRunId: text("agent_run_id"),
  nodeId: text("node_id"),
  actionType: text("action_type", {
    enum: ["production_write", "level3_command", "budget_exceed", "batch_edit", "external_api"],
  }).notNull(),
  riskLevel: text("risk_level", { enum: ["medium", "high", "critical"] }).notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "expired"] })
    .notNull()
    .default("pending"),
  requestDetail: text("request_detail", { mode: "json" }).$type<Record<string, unknown>>(),
  approver: text("approver"),
  comment: text("comment"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
  expiresAt: text("expires_at").notNull(),
});

// ── Task Nodes (DAG mirror from runtime task-graph-plugin) ─────────

export const taskNodes = sqliteTable("task_nodes", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  graphId: text("graph_id").notNull(), // runtime task-graph-plugin graph ID
  subject: text("subject").notNull(),
  status: text("status", {
    enum: [
      "pending",
      "in_progress",
      "completed",
      "failed",
      "blocked",
      "stopped",
      "paused",
      "waiting_approval",
    ],
  })
    .notNull()
    .default("pending"),
  agentType: text("agent_type").notNull(),
  sessionId: text("session_id"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(2),
  output: text("output"),
  error: text("error"),
  tokenUsed: integer("token_used").notNull().default(0),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Task Edges (DAG dependencies from runtime) ─────────────────────

export const taskEdges = sqliteTable("task_edges", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  graphId: text("graph_id").notNull(),
  fromNodeId: text("from_node_id")
    .notNull()
    .references(() => taskNodes.id),
  toNodeId: text("to_node_id")
    .notNull()
    .references(() => taskNodes.id),
  edgeType: text("edge_type", { enum: ["blocks", "informs"] })
    .notNull()
    .default("blocks"),
});

// ── Agent Runs (individual agent execution records) ────────────────

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  nodeId: text("node_id").references(() => taskNodes.id),
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

export const codeChanges = sqliteTable("code_changes", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
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

export const fileChanges = sqliteTable("file_changes", {
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

export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  pluginPath: text("plugin_path").notNull(), // path in opencode.json plugin array
  version: text("version"),
  source: text("source", { enum: ["builtin", "local", "registry"] })
    .notNull()
    .default("local"),
  status: text("status", { enum: ["enabled", "disabled", "error", "not_installed"] })
    .notNull()
    .default("enabled"),
  description: text("description"),
  capabilities: text("capabilities", { mode: "json" }).$type<string[]>(), // tool names exposed
  lastVerifiedAt: text("last_verified_at"),
  errorDetail: text("error_detail"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Budget Configs ─────────────────────────────────────────────────

export const budgetConfigs = sqliteTable("budget_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  period: text("period", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  limitAmount: real("limit_amount").notNull(),
  warnThreshold: real("warn_threshold").notNull().default(0.8),
  throttleThreshold: real("throttle_threshold").notNull().default(0.95),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Workbench Layouts ──────────────────────────────────────────────

export const workbenchLayouts = sqliteTable("workbench_layouts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  layoutJson: text("layout_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Role Agents ───────────────────────────────────────────────────

export const roleAgents = sqliteTable("role_agents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  name: text("name").notNull(),
  description: text("description"),
  scope: text("scope", { enum: ["system", "project"] }).notNull().default("system"),
  status: text("status", { enum: ["active", "disabled", "deprecated"] })
    .notNull()
    .default("active"),
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
  requireConsensus: integer("require_consensus", { mode: "boolean" }).notNull().default(false),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] })
    .notNull()
    .default("low"),
  requiresApprovalForWrite: integer("requires_approval_for_write", { mode: "boolean" })
    .notNull()
    .default(false),
  allowedStagesJson: text("allowed_stages_json", { mode: "json" }).$type<string[]>().notNull(),
  outputSchemaId: text("output_schema_id"),
  tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roleAgentBindings = sqliteTable("role_agent_bindings", {
  id: text("id").primaryKey(),
  roleAgentId: text("role_agent_id")
    .notNull()
    .references(() => roleAgents.id),
  projectId: text("project_id").references(() => projects.id),
  bindingKey: text("binding_key").notNull(),
  runtimeAgent: text("runtime_agent").notNull(),
  label: text("label").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1),
  model: text("model"),
  tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roleAgentProjectOverrides = sqliteTable("role_agent_project_overrides", {
  id: text("id").primaryKey(),
  roleAgentId: text("role_agent_id")
    .notNull()
    .references(() => roleAgents.id),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name"),
  description: text("description"),
  status: text("status", { enum: ["active", "disabled", "deprecated"] }),
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
  requireConsensus: integer("require_consensus", { mode: "boolean" }),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] }),
  requiresApprovalForWrite: integer("requires_approval_for_write", { mode: "boolean" }),
  allowedStagesJson: text("allowed_stages_json", { mode: "json" }).$type<string[]>(),
  outputSchemaId: text("output_schema_id"),
  tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
  bindingsMode: text("bindings_mode", { enum: ["inherit", "replace"] }).notNull().default("inherit"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── Workflow Templates ────────────────────────────────────────────

export const workflowTemplates = sqliteTable("workflow_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  selectableByProjects: integer("selectable_by_projects", { mode: "boolean" })
    .notNull()
    .default(true),
  defaultCollaborationMode: text("default_collaboration_mode", {
    enum: ["solo", "team", "hybrid"],
  }),
  defaultAutopilotLevel: text("default_autopilot_level", {
    enum: ["L0", "L1", "L2"],
  }),
  defaultBossParticipationMode: text("default_boss_participation_mode", {
    enum: ["disabled", "advisory", "exception-only", "full-manager"],
  }),
  forceBossParticipation: integer("force_boss_participation", { mode: "boolean" })
    .notNull()
    .default(false),
  stageOrderJson: text("stage_order_json", { mode: "json" }).$type<string[]>().notNull(),
  defaultRolesJson: text("default_roles_json", { mode: "json" }).$type<string[]>(),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workflowTemplateStages = sqliteTable("workflow_template_stages", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id),
  stageKey: text("stage_key").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  mode: text("mode", { enum: ["single", "parallel", "pipeline"] })
    .notNull()
    .default("single"),
  primaryRoleAgentId: text("primary_role_agent_id").notNull(),
  participantRoleAgentIdsJson: text("participant_role_agent_ids_json", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  roleExecutionPoliciesJson: text("role_execution_policies_json", { mode: "json" }),
  entryCriteriaJson: text("entry_criteria_json", { mode: "json" }).$type<string[]>(),
  exitCriteriaJson: text("exit_criteria_json", { mode: "json" }).$type<string[]>(),
  hooksJson: text("hooks_json", { mode: "json" }),
  gatesJson: text("gates_json", { mode: "json" }),
  approvalsJson: text("approvals_json", { mode: "json" }),
  stageTemplateStrategyJson: text("stage_template_strategy_json", { mode: "json" }).$type<{
    onBlockedTemplateId?: string;
    onWaitingApprovalTemplateId?: string;
    note?: string;
  }>(),
  failurePolicyJson: text("failure_policy_json", { mode: "json" }),
  orderIndex: integer("order_index").notNull().default(0),
});

// ── Task Workflow Runs ────────────────────────────────────────────

export const taskWorkflowRuns = sqliteTable("task_workflow_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
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

export const taskStageRuns = sqliteTable("task_stage_runs", {
  id: text("id").primaryKey(),
  workflowRunId: text("workflow_run_id")
    .notNull()
    .references(() => taskWorkflowRuns.id),
  stageKey: text("stage_key").notNull(),
  status: text("status", {
    enum: ["pending", "running", "blocked", "waiting-approval", "failed", "completed", "skipped", "cancelled"],
  })
    .notNull()
    .default("pending"),
  primaryRoleAgentId: text("primary_role_agent_id").notNull(),
  participantRoleAgentIdsJson: text("participant_role_agent_ids_json", { mode: "json" }).$type<string[]>(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  blockingReason: text("blocking_reason"),
  approvalState: text("approval_state", {
    enum: ["not-required", "pending", "approved", "rejected", "expired", "cancelled"],
  })
    .notNull()
    .default("not-required"),
  artifactsSummaryJson: text("artifacts_summary_json", { mode: "json" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roleAggregateConclusions = sqliteTable("role_aggregate_conclusions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
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
  confidenceScore: real("confidence_score").notNull().default(0),
  consensusScore: real("consensus_score").notNull().default(0),
  winningRationale: text("winning_rationale").notNull(),
  mergedFindingsJson: text("merged_findings_json", { mode: "json" }).$type<Record<string, unknown>[]>(),
  minorityFindingsJson: text("minority_findings_json", { mode: "json" }).$type<Record<string, unknown>[]>(),
  conflictsJson: text("conflicts_json", { mode: "json" }).$type<Record<string, unknown>[]>(),
  approvalRecommendationJson: text("approval_recommendation_json", { mode: "json" }).$type<Record<string, unknown>>(),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const developerChangeRequests = sqliteTable("developer_change_requests", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  taskStageRunId: text("task_stage_run_id"),
  sourceRoleAgentId: text("source_role_agent_id").notNull(),
  assignedRoleAgentId: text("assigned_role_agent_id").notNull().default("role.developer"),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  requiredChangesJson: text("required_changes_json", { mode: "json" }).$type<string[]>().notNull(),
  relatedFindingKeysJson: text("related_finding_keys_json", { mode: "json" }).$type<string[]>(),
  blocking: integer("blocking", { mode: "boolean" }).notNull().default(false),
  approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(false),
  status: text("status", {
    enum: ["open", "acknowledged", "in-progress", "resolved", "won't-fix"],
  }).notNull().default("open"),
  resolutionNote: text("resolution_note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
});
