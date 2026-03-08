import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ── Organizations ──────────────────────────────────────────────────

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ── Projects ───────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  settings: text("settings", { mode: "json" }).$type<{
    defaultModel?: string;
    maxConcurrency?: number;
    budgetMonthly?: number;
  }>(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ── Environments ───────────────────────────────────────────────────

export const environments = sqliteTable("environments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(), // dev | staging | production
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] })
    .notNull()
    .default("low"),
  requiresApproval: integer("requires_approval", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ── Users ──────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", {
    enum: ["platform_admin", "org_admin", "project_admin", "developer", "viewer"],
  })
    .notNull()
    .default("developer"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

export const projectRoles = sqliteTable("project_roles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  role: text("role", {
    enum: ["project_admin", "developer", "viewer"],
  }).notNull(),
});

// ── Sessions (extends OpenCode sessions) ───────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // maps to OpenCode sessionId
  projectId: text("project_id").notNull().references(() => projects.id),
  userId: text("user_id").notNull().references(() => users.id),
  taskId: text("task_id"),
  tokensUsed: integer("tokens_used").default(0),
  cost: real("cost").default(0),
  modelUsed: text("model_used"),
  agentUsed: text("agent_used"),
  startedAt: text("started_at").notNull().default("(datetime('now'))"),
  finishedAt: text("finished_at"),
});

// ── Policy Templates ───────────────────────────────────────────────

export const policyTemplates = sqliteTable("policy_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["tool_whitelist", "path_whitelist", "command_level", "concurrency", "model"],
  }).notNull(),
  rules: text("rules", { mode: "json" }).$type<Record<string, unknown>>(),
  appliesTo: text("applies_to", { enum: ["all", "environment", "agent"] })
    .notNull()
    .default("all"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// ── Audit Events ───────────────────────────────────────────────────

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull().default("(datetime('now'))"),
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
});

// ── Cost Records ───────────────────────────────────────────────────

export const costRecords = sqliteTable("cost_records", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull().default("(datetime('now'))"),
  projectId: text("project_id").notNull().references(() => projects.id),
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
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  resolvedAt: text("resolved_at"),
  expiresAt: text("expires_at").notNull(),
});

// ── Budget Configs ─────────────────────────────────────────────────

export const budgetConfigs = sqliteTable("budget_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  period: text("period", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  limitAmount: real("limit_amount").notNull(),
  warnThreshold: real("warn_threshold").notNull().default(0.8),
  throttleThreshold: real("throttle_threshold").notNull().default(0.95),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});
