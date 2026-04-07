# 当前全量表结构（去冗余整理版）

- 来源文件: control-plane/service/src/db/schema.pg.ts
- 生成时间: 2026-04-02T01:49:41.028Z
- 表数量: 49

> 说明: 本文档按源码顺序收录当前有效表结构，并已折叠会话域重复模型，优先展示 canonical 结构。
>
> 状态更新（2026-04-05）：当前源码已通过 `0033_drop_agent_runs.sql` 删除 `agent_runs`。本文尚未整体重新生成，因此后文如果还出现 `agentRuns` 或 `agent_run_id` 旧引用，应视为删除前快照；当前兼容 `agentRunId` 语义由 `task_operations`、`task_session_runs`、`task_sessions` 等 canonical 表投影提供。

## 冗余折叠说明

- 以下 3 张旧模型表已从正文展开中折叠：
- task_session_messages
- task_session_message_parts
- session_operations
- 对应 canonical 表：task_messages、task_message_parts、task_operations

## 表清单

- organizations (organizations)
- projects (projects)
- project_tree_nodes (projectTreeNodes)
- project_tree_branches (projectTreeBranches)
- project_tree_links (projectTreeLinks)
- environments (environments)
- users (users)
- project_roles (projectRoles)
- paid_execution_leases (paidExecutionLeases)
- runtime_usage_ledgers (runtimeUsageLedgers)
- runtime_usage_ledger_steps (runtimeUsageLedgerSteps)
- runtime_usage_baselines (runtimeUsageBaselines)
- repositories (repositories)
- repository_credentials (repositoryCredentials)
- tasks (tasks)
- policy_templates (policyTemplates)
- audit_events (auditEvents)
- cost_records (costRecords)
- approval_tickets (approvalTickets)
- task_sessions (taskSessions)
- task_session_runs (taskSessionRuns)
- task_messages (taskMessages)
- task_message_parts (taskMessageParts)
- task_operations (taskOperations)
- task_snapshots (taskSnapshots)
- task_artifacts (taskArtifacts)
- task_usage_ledger_entries (taskUsageLedgerEntries)
- task_timeline_views (taskTimelineViews)
- code_changes (codeChanges)
- file_changes (fileChanges)
- plugins (plugins)
- budget_configs (budgetConfigs)
- workbench_layouts (workbenchLayouts)
- role_agents (roleAgents)
- role_agent_bindings (roleAgentBindings)
- role_agent_project_overrides (roleAgentProjectOverrides)
- workflow_templates (workflowTemplates)
- workflow_template_stages (workflowTemplateStages)
- task_workflow_runs (taskWorkflowRuns)
- task_stage_runs (taskStageRuns)
- role_aggregate_conclusions (roleAggregateConclusions)
- developer_change_requests (developerChangeRequests)
- task_operating_modes (taskOperatingModes)
- boss_decisions (bossDecisions)
- human_escalations (humanEscalations)

## 表详细注释

### organizations
- 用途：组织租户根实体，承载跨项目的归属边界。
- 关键关系：`projects.org_id -> organizations.id`。
- 典型读写：组织初始化时写入，项目列表按组织维度过滤读取。

### projects
- 用途：项目主实体，管理项目级配置、状态与更新时间。
- 关键关系：关联组织、任务、环境、仓库、角色等多数业务子域。
- 典型读写：创建项目时写入基础信息，控制台首页按 `updated_at` 排序查询。

### project_tree_nodes
- 保留级别：Required（核心树模型主表）
- 用途：统一承载项目内树结构节点（task/session/message/context）。
- 关键关系：通过 `parent_id + path(ltree)` 表达层级，`ref_type/ref_id` 关联业务实体。
- 典型读写：构建项目树、节点回溯、按路径前缀查询子树。

### project_tree_branches
- 保留级别：Optional（仅在需要分支视图/分支切换时保留）
- 用途：记录项目树分支元数据，用于分支视角展示与切换。
- 关键关系：与 `project_tree_nodes` 通过 `head_node_id` 等字段建立映射。
- 典型读写：创建分支时写入，前端切换分支时读取当前 head。

### project_tree_links
- 保留级别：Optional（仅在需要跨节点图关系时保留）
- 用途：表达节点之间的显式关联边（依赖、阻塞、引用、分叉）。
- 关键关系：`from_node_id` 与 `to_node_id` 指向树节点。
- 典型读写：图谱视图聚合时读取，自动编排生成依赖边时写入。

### environments
- 用途：项目可用运行环境配置（本地、云、沙箱）。
- 关键关系：`project_id` 归属项目，供任务执行时选择。
- 典型读写：环境管理页维护，任务执行前按项目加载可选环境。

### users
- 用途：用户身份与基础账号属性。
- 关键关系：被 `tasks.created_by_user_id`、`workbench_layouts.user_id` 等引用。
- 典型读写：登录后拉取用户档案，布局与偏好按用户写回。

### project_roles
- 用途：项目内角色授权映射（谁在项目中拥有哪些权限）。
- 关键关系：关联 `projects` 与 `users`。
- 典型读写：权限校验时读取，项目成员管理页新增或更新。

### paid_execution_leases
- 用途：付费执行配额租约，控制可计费执行窗口。
- 关键关系：归属项目并与执行会话关联。
- 典型读写：执行前校验租约可用性，执行结束或撤销时更新状态。

### runtime_usage_ledgers
- 用途：运行期用量总账（任务/会话级汇总）。
- 关键关系：与 step 明细表 `runtime_usage_ledger_steps` 一对多。
- 典型读写：执行周期内累计更新，账单与报表聚合读取。

### runtime_usage_ledger_steps
- 用途：用量总账的步骤明细（execution/judge/hook/resume）。
- 关键关系：`ledger_id` 指向总账。
- 典型读写：每个执行子步骤结束后写入，问题排查按步骤回放。

### runtime_usage_baselines
- 用途：保存基线口径，用于预算对比与异常检测。
- 关键关系：按项目、模型、入口组合形成匹配范围。
- 典型读写：离线计算基线后写入，运行时按 scope 匹配读取。

### repositories
- 用途：代码仓库元信息（提供者、地址、默认分支等）。
- 关键关系：被 `tasks.repo_id`、`repository_credentials.repo_id` 关联。
- 典型读写：接入仓库时创建，任务发起时选择并读取。

### repository_credentials
- 用途：仓库凭据引用（仅保存 secret_ref，不存明文密钥）。
- 关键关系：归属项目，可选绑定具体仓库。
- 典型读写：仓库操作前解析默认凭据，凭据管理页维护。

### tasks
- 用途：任务聚合根，承载任务生命周期与上下文主键。
- 关键关系：连接 session/run/message/artifact 等任务域表。
- 典型读写：任务创建写入，任务列表与详情频繁读取与状态更新。

### policy_templates
- 用途：策略模板（工具白名单、路径限制、并发与模型策略）。
- 关键关系：项目级模板资源，被执行流程加载。
- 典型读写：策略配置页维护，执行前按 `applies_to` 匹配。

### audit_events
- 用途：审计日志主表，记录关键动作与风险等级。
- 关键关系：可关联用户、项目、任务、会话与 agent run。
- 典型读写：关键操作写入，审计与合规查询按时间与主体检索。

### cost_records
- 用途：成本记录事实表，记录模型调用成本快照。
- 关键关系：按项目/任务/会话/agent 维度聚合。
- 典型读写：计费事件产生时写入，成本报表按周期统计。

### approval_tickets
- 用途：高风险动作审批单。
- 关键关系：挂在任务或 agent run 上，记录审批状态流转。
- 典型读写：触发风险动作时创建，审批动作更新状态与评论。

### agent_runs
- 状态：已在 2026-04-05 从当前 schema 删除。
- 兼容说明：公共 `agentRunId` 标识与 `/api/tasks/:taskId/runs`、`/api/agent-runs/:agentRunId/summary` 仍保留，但现在由 `task_operations`、`task_session_runs`、`task_sessions` 投影生成。

### task_sessions
- 用途：Task 树节点层（回合级节点）。
- 关键关系：`parent_session_id` 构树，`head_message_id/latest_run_id` 指向终态。
- 典型读写：新回合创建节点，任务树接口按父子关系读取。

### task_session_runs
- 用途：Session 执行尝试层（candidate/judge/retry/resume）。
- 关键关系：`session_id` 归属 session，`runtime_session_id` 对应底层执行单元。
- 典型读写：每次执行尝试写入，执行追踪与成本统计按 run 聚合。

### task_messages
- 用途：会话可见消息主表（用户/助手/system/tool）。
- 关键关系：归属 `session_id`，助手消息可回指 `created_by_run_id`。
- 典型读写：消息流写入与状态更新，UI 按 `session_id + seq` 顺序读取。

### task_message_parts
- 用途：消息分片正文（text/tool_call/tool_result 等结构化片段）。
- 关键关系：`message_id` 指向 `task_messages`。
- 典型读写：流式输出逐片写入，渲染层按 `part_index` 重组正文。

### task_operations
- 用途：执行动作事实（model_request/tool_call/judge/hook）。
- 关键关系：挂在 `run_id`，可选关联 `message_id`。
- 典型读写：执行链路每一步写入，排障与时间线按 `operation_index` 读取。

### task_snapshots
- 用途：任务快照投影，服务任务列表的快速读取。
- 关键关系：`task_id` 一对一主键快照。
- 典型读写：任务状态变化时刷新，列表页与看板优先读取该表。

### task_artifacts
- 用途：任务产物存储（result/report/diff/file/link 等）。
- 关键关系：可关联 session/message/operation 形成可追踪来源。
- 典型读写：产物生成后写入，下载与成果页按任务读取。

### task_usage_ledger_entries
- 用途：任务域用量明细账本（请求次数、token、成本）。
- 关键关系：可关联 session/message/operation，支持 provider/model 聚合。
- 典型读写：每次计量事件写入，财务与限额策略按时间窗口读取。

### task_timeline_views
- 用途：任务时间线投影表，统一展示 message/operation/artifact 事件。
- 关键关系：按 `item_kind` 连接多类实体。
- 典型读写：投影器增量写入，前端时间线按 `sort_at` 读取。

### code_changes
- 用途：代码变更集合（一次变更快照或提交）。
- 关键关系：关联任务、仓库、agent run。
- 典型读写：生成补丁或提交后写入，变更记录页读取摘要。

### file_changes
- 用途：单文件级变更明细。
- 关键关系：`change_id` 指向 `code_changes`。
- 典型读写：变更解析后批量写入，代码审查页按文件展示。

### plugins
- 用途：插件注册与生命周期元数据。
- 关键关系：与具体任务弱关联，偏系统配置层。
- 典型读写：插件扫描后更新，插件管理页读取能力与状态。

### budget_configs
- 用途：预算策略配置（月度限额、告警阈值、节流阈值）。
- 关键关系：`project_id` 归属项目。
- 典型读写：预算设置页写入，执行前按项目读取阈值判断。

### workbench_layouts
- 用途：用户工作台布局持久化。
- 关键关系：`user_id` 一对一。
- 典型读写：前端布局变更即写回，登录后读取恢复界面。

### role_agents
- 用途：角色代理定义（权限、工具、默认执行模式、风险级别）。
- 关键关系：可被绑定表与项目覆盖表引用。
- 典型读写：角色模板管理时维护，编排阶段按角色读取能力。

### role_agent_bindings
- 用途：角色代理到运行时代理实例的绑定关系。
- 关键关系：`role_agent_id + project_id + binding_key` 唯一。
- 典型读写：角色配置发布时写入，执行调度按优先级读取。

### role_agent_project_overrides
- 用途：项目级角色代理覆盖配置。
- 关键关系：同一角色在同一项目唯一覆盖记录。
- 典型读写：项目定制角色策略时写入，执行时合并继承与覆盖。

### workflow_templates
- 用途：工作流模板主表（阶段顺序、默认模式、版本）。
- 关键关系：与 `workflow_template_stages` 一对多。
- 典型读写：模板编辑与发布写入，任务创建时按模板读取。

### workflow_template_stages
- 用途：工作流阶段定义（入口/出口条件、审批与失败策略）。
- 关键关系：`template_id` 指向模板。
- 典型读写：模板配置时写入，工作流引擎按 `order_index` 读取。

### task_workflow_runs
- 用途：任务级工作流运行实例。
- 关键关系：与 `task_stage_runs` 一对多，绑定任务和模板。
- 典型读写：任务进入流程时创建，阶段推进时更新状态。

### task_stage_runs
- 用途：工作流阶段运行实例。
- 关键关系：`workflow_run_id` 归属工作流运行。
- 典型读写：每阶段开始/结束更新，阻塞与审批状态同步写入。

### role_aggregate_conclusions
- 用途：多角色结论聚合结果（冲突、共识、最终决策）。
- 关键关系：关联任务与阶段运行。
- 典型读写：聚合器产出后写入，复核页读取最终建议与证据。

### developer_change_requests
- 用途：面向开发者的整改请求单。
- 关键关系：关联任务、阶段与来源角色代理。
- 典型读写：发现问题时创建，开发者处理后更新状态与结论。

### task_operating_modes
- 用途：任务运行模式快照（协作模式、自动驾驶等级、boss 参与）。
- 关键关系：`task_id` 一对一。
- 典型读写：任务策略切换时写入，执行入口读取当前模式。

### boss_decisions
- 用途：Boss 级决策事件记录。
- 关键关系：按任务与阶段记录时间序列。
- 典型读写：决策动作发生时写入，管理视图按 `ts` 回放。

### human_escalations
- 用途：人工升级/介入事件记录。
- 关键关系：按任务和阶段追踪人工介入状态。
- 典型读写：触发升级时写入，运维或管理页面查询处理进度。

### task_message_events
- 状态：已删除。
- 删除依据：[control-plane/service/drizzle-pg/0036_drop_task_message_events.sql](../../control-plane/service/drizzle-pg/0036_drop_task_message_events.sql)。
- 现状：消息主事实已完全收敛到 `task_sessions`、`task_session_runs`、`task_messages`、`task_message_parts` 与 `task_timeline_views`；不再保留独立 append-only message event log。

## organizations

- 常量名: organizations

```ts
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

## projects

- 常量名: projects

```ts
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
```

## project_tree_nodes

- 常量名: projectTreeNodes

```ts
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
    refType: text("ref_type"),
    refId: text("ref_id"),
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
    index("idx_ptn_ref_type_ref_id").on(table.refType, table.refId),
  ],
);
```

## project_tree_branches

- 常量名: projectTreeBranches

```ts
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
```

## project_tree_links

- 常量名: projectTreeLinks

```ts
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
    uniqueIndex("idx_ptl_unique_edge").on(table.sourceNodeId, table.targetNodeId, table.linkType),
    index("idx_ptl_source").on(table.sourceNodeId),
    index("idx_ptl_target").on(table.targetNodeId),
    index("idx_ptl_source_project").on(table.sourceProjectId, table.linkType),
    index("idx_ptl_target_project").on(table.targetProjectId, table.linkType),
  ],
);
```

## environments

- 常量名: environments

```ts
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
```

## users

- 常量名: users

```ts
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
```

## project_roles

- 常量名: projectRoles

```ts
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
```

## paid_execution_leases

- 常量名: paidExecutionLeases

```ts
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
```

## runtime_usage_ledgers

- 常量名: runtimeUsageLedgers

```ts
export const runtimeUsageLedgers = pgTable(
  "runtime_usage_ledgers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: text("task_id").references(() => projectTreeNodes.id),
    agentRunId: text("agent_run_id"),
    runId: text("run_id"),
    runNodeId: text("run_node_id"),
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
    index("idx_runtime_usage_ledgers_run_id").on(table.runId),
    index("idx_runtime_usage_ledgers_run_node_id").on(table.runNodeId),
  ],
);
```

## runtime_usage_ledger_steps

- 常量名: runtimeUsageLedgerSteps

```ts
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
    agentRunId: text("agent_run_id"),
    runId: text("run_id"),
    runNodeId: text("run_node_id"),
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
    index("idx_runtime_usage_ledger_steps_run_id").on(table.runId),
    index("idx_runtime_usage_ledger_steps_run_node_id").on(table.runNodeId),
    index("idx_runtime_usage_ledger_steps_task_type").on(
      table.taskId,
      table.stepType,
      table.triggerType,
    ),
  ],
);
```

## runtime_usage_baselines

- 常量名: runtimeUsageBaselines

```ts
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
```

## repositories

- 常量名: repositories

```ts
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
```

## repository_credentials

- 常量名: repositoryCredentials

```ts
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
```

## tasks

- 常量名: tasks

```ts
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    treeNodeId: text("tree_node_id").references(() => projectTreeNodes.id),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    category: text("category"),
    repoId: text("repo_id").references(() => repositories.id),
    workspaceRoot: text("workspace_root"),
    baseRevision: text("base_revision"),
    workingBranch: text("working_branch"),
    credentialId: text("credential_id").references(() => repositoryCredentials.id),
    strategyJson: jsonb("strategy_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    finalCommitSha: text("final_commit_sha"),
    finalBranchName: text("final_branch_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    gitCommitterName: text("git_committer_name"),
    gitCommitterEmail: text("git_committer_email"),
    gitAuthorName: text("git_author_name"),
    gitAuthorEmail: text("git_author_email"),
    // ─── columns added by migration 0022 ───
    workflowTemplateId: text("workflow_template_id"),
    workflowTemplateVersion: integer("workflow_template_version"),
    workflowSource: text("workflow_source").notNull().default("manual_seed"),
    stageKey: text("stage_key"),
    spawnedFromTaskId: text("spawned_from_task_id").references((): AnyPgColumn => tasks.id),
    spawnTriggerEvent: text("spawn_trigger_event"),
    spawnRuleKey: text("spawn_rule_key"),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    preferredModel: text("preferred_model"),
    activatedAt: text("activated_at"),
    doneAt: text("done_at"),
    archivedAt: text("archived_at"),
    // ─── legacy columns (kept until DROP COLUMN migration reruns) ───
    status: text("status"),
    currentRunId: text("current_run_id"),
    currentSessionId: text("current_session_id"),
    currentAgentRunId: text("current_agent_run_id"),
    latestResult: text("latest_result"),
    latestResultSummary: text("latest_result_summary"),
    selectedModel: text("selected_model"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    changesSummaryJson: jsonb("changes_summary_json").$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex("idx_tasks_tree_node_id").on(table.treeNodeId),
    index("idx_tasks_project_created_at").on(table.projectId, table.createdAt),
    index("idx_tasks_project_lifecycle_updated_at").on(
      table.projectId,
      table.lifecycleStatus,
      table.updatedAt,
    ),
    index("idx_tasks_project_repo_updated_at").on(table.projectId, table.repoId, table.updatedAt),
    index("idx_tasks_spawned_from_task_id").on(table.spawnedFromTaskId),
  ],
);
```

## policy_templates

- 常量名: policyTemplates

```ts
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
```

## audit_events

- 常量名: auditEvents

```ts
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
```

## cost_records

- 常量名: costRecords

```ts
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
```

## approval_tickets

- 常量名: approvalTickets

```ts
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
```

## agent_runs

- 当前状态：已从源码 schema 删除，不再作为独立物理表存在。
- 当前替代：`agentRunId` 兼容视图由 `task_operations`、`task_session_runs`、`task_sessions` 投影提供；如果需要当前 schema 真值，请以这些 canonical 表为准。

## task_sessions

- 常量名: taskSessions

```ts
export const taskSessions = pgTable(
  "task_sessions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    treeNodeId: text("tree_node_id").references(() => projectTreeNodes.id),
    parentSessionId: text("parent_session_id").references((): AnyPgColumn => taskSessions.id),
    rootSessionId: text("root_session_id").references((): AnyPgColumn => taskSessions.id),
    sourceMessageId: text("source_message_id"),
    sessionType: text("session_type").$type<TaskSessionNodeType>(),
    workflowStageKey: text("workflow_stage_key"),
    spawnTriggerType: text("spawn_trigger_type"),
    spawnRuleKey: text("spawn_rule_key"),
    userPromptSummary: text("user_prompt_summary"),
    status: text("status").$type<TaskSessionNodeStatus>().notNull().default("running"),
    headMessageId: text("head_message_id"),
    latestRunId: text("latest_run_id"),
    depth: integer("depth").notNull().default(0),
    sortKey: text("sort_key"),
    coordinationKey: text("coordination_key").notNull(),
    sessionKind: text("session_kind").$type<TaskSessionKind>().notNull(),
    triggerType: text("trigger_type").$type<TaskSessionTriggerType>().notNull(),
    executionModeSnapshot: text("execution_mode_snapshot").$type<TaskSessionMode>().notNull(),
    executionStatus: text("execution_status").$type<ExecutionStatus>().notNull().default("running"),
    branchName: text("branch_name"),
    candidateIndex: integer("candidate_index"),
    stepIndex: integer("step_index"),
    runtimeSessionId: text("runtime_session_id"),
    forkedFromMessageId: text("forked_from_message_id"),
    selectedModel: text("selected_model"),
    effectiveModel: text("effective_model"),
    winnerSessionId: text("winner_session_id").references((): AnyPgColumn => taskSessions.id),
    judgeSessionId: text("judge_session_id").references((): AnyPgColumn => taskSessions.id),
    resultText: text("result_text"),
    resultSummary: text("result_summary"),
    errorText: text("error_text"),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    lastActivityAt: text("last_activity_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("idx_task_sessions_tree_node_id").on(table.treeNodeId),
    uniqueIndex("idx_task_sessions_runtime_session_id").on(table.runtimeSessionId),
    uniqueIndex("idx_task_sessions_candidate_per_group").on(
      table.taskId,
      table.coordinationKey,
      table.candidateIndex,
    ),
    uniqueIndex("idx_task_sessions_step_per_group").on(
      table.taskId,
      table.coordinationKey,
      table.stepIndex,
    ),
    index("idx_task_sessions_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_sessions_task_execution_status_activity").on(
      table.taskId,
      table.executionStatus,
      table.lastActivityAt,
    ),
    index("idx_task_sessions_task_root_created_at").on(
      table.taskId,
      table.rootSessionId,
      table.createdAt,
    ),
    index("idx_task_sessions_task_coordination_created_at").on(
      table.taskId,
      table.coordinationKey,
      table.createdAt,
    ),
    index("idx_task_sessions_parent_session_id").on(table.parentSessionId),
    index("idx_task_sessions_task_parent_created_at").on(
      table.taskId,
      table.parentSessionId,
      table.createdAt,
    ),
    index("idx_task_sessions_task_sort_key").on(table.taskId, table.sortKey),
    index("idx_task_sessions_head_message_id").on(table.headMessageId),
    index("idx_task_sessions_latest_run_id").on(table.latestRunId),
  ],
);
```

## task_session_runs

- 常量名: taskSessionRuns

```ts
export const taskSessionRuns = pgTable(
  "task_session_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id),
    attemptIndex: integer("attempt_index").notNull(),
    runtimeSessionId: text("runtime_session_id"),
    triggerType: text("trigger_type").$type<TaskSessionRunTriggerType>().notNull(),
    executionKind: text("execution_kind").$type<TaskSessionRunExecutionKind>().notNull(),
    coordinationKey: text("coordination_key"),
    candidateIndex: integer("candidate_index"),
    laneRole: text("lane_role").$type<TaskSessionRunLaneRole>().notNull(),
    executorKind: text("executor_kind").notNull(),
    modelRoute: text("model_route"),
    workflowStageKey: text("workflow_stage_key"),
    status: text("status").$type<TaskSessionNodeStatus>().notNull().default("running"),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    resultSummary: text("result_summary"),
    errorText: text("error_text"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_session_runs_session_attempt_index").on(
      table.sessionId,
      table.attemptIndex,
    ),
    uniqueIndex("idx_task_session_runs_session_id_id").on(table.sessionId, table.id),
    uniqueIndex("idx_task_session_runs_runtime_session_id").on(table.runtimeSessionId),
    index("idx_task_session_runs_task_session_created_at").on(
      table.taskId,
      table.sessionId,
      table.createdAt,
    ),
    index("idx_task_session_runs_task_coordination_created_at").on(
      table.taskId,
      table.coordinationKey,
      table.createdAt,
    ),
    index("idx_task_session_runs_session_status_created_at").on(
      table.sessionId,
      table.status,
      table.createdAt,
    ),
  ],
);
```

## task_messages

- 常量名: taskMessages

```ts
export const taskMessages = pgTable(
  "task_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id),
    createdByRunId: text("created_by_run_id"),
    role: text("role").$type<TaskSessionMessageRole>().notNull(),
    messageKind: text("message_kind").$type<TaskMessageKind>().notNull(),
    parentMessageId: text("parent_message_id").references((): AnyPgColumn => taskMessages.id),
    replyToMessageId: text("reply_to_message_id").references((): AnyPgColumn => taskMessages.id),
    seq: integer("seq").notNull(),
    textPreview: text("text_preview"),
    partCount: integer("part_count").notNull().default(0),
    tokenUsed: bigint("token_used", { mode: "number" }).notNull().default(0),
    status: text("status").$type<TaskMessageStatus>().notNull().default("streaming"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("idx_task_messages_session_seq").on(table.sessionId, table.seq),
    uniqueIndex("idx_task_messages_session_id_id").on(table.sessionId, table.id),
    index("idx_task_messages_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_messages_session_created_at").on(table.sessionId, table.createdAt),
    index("idx_task_messages_session_role_created_at").on(
      table.sessionId,
      table.role,
      table.createdAt,
    ),
    index("idx_task_messages_created_by_run_id").on(table.createdByRunId),
  ],
);
```

## task_message_parts

- 常量名: taskMessageParts

```ts
export const taskMessageParts = pgTable(
  "task_message_parts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => taskMessages.id),
    partIndex: integer("part_index").notNull(),
    partType: text("part_type").$type<TaskSessionMessagePartType>().notNull(),
    textContent: text("text_content"),
    jsonPayload: jsonb("json_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_message_parts_message_part_index").on(
      table.messageId,
      table.partIndex,
    ),
    index("idx_task_message_parts_message_id").on(table.messageId),
  ],
);
```

## task_operations

- 常量名: taskOperations

```ts
export const taskOperations = pgTable(
  "task_operations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id),
    runId: text("run_id")
      .notNull()
      .references(() => taskSessionRuns.id),
    messageId: text("message_id").references(() => taskMessages.id),
    parentOperationId: text("parent_operation_id").references((): AnyPgColumn => taskOperations.id),
    runtimeOperationId: text("runtime_operation_id"),
    operationIndex: integer("operation_index").notNull(),
    operationKind: text("operation_kind").$type<TaskOperationKind>().notNull(),
    toolName: text("tool_name"),
    title: text("title"),
    status: text("status").$type<TaskSessionNodeStatus>().notNull().default("running"),
    summaryJson: jsonb("summary_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_operations_run_operation_index").on(table.runId, table.operationIndex),
    uniqueIndex("idx_task_operations_runtime_operation_id").on(table.runtimeOperationId),
    index("idx_task_operations_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_operations_session_created_at").on(table.sessionId, table.createdAt),
    index("idx_task_operations_message_id").on(table.messageId),
    index("idx_task_operations_parent_operation_id").on(table.parentOperationId),
  ],
);
```

## task_snapshots

- 常量名: taskSnapshots

```ts
export const taskSnapshots = pgTable(
  "task_snapshots",
  {
    taskId: text("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    lifecycleStatus: text("lifecycle_status").notNull(),
    currentExecutionMode: text("current_execution_mode"),
    currentExecutionStatus: text("current_execution_status"),
    currentSessionId: text("current_session_id"),
    latestSessionId: text("latest_session_id"),
    latestResultSummary: text("latest_result_summary"),
    latestErrorText: text("latest_error_text"),
    activeCandidateCount: integer("active_candidate_count").notNull().default(0),
    totalChainSteps: integer("total_chain_steps").notNull().default(0),
    completedChainSteps: integer("completed_chain_steps").notNull().default(0),
    lastActivityAt: text("last_activity_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_snapshots_project_lifecycle_execution_activity").on(
      table.projectId,
      table.lifecycleStatus,
      table.currentExecutionStatus,
      table.lastActivityAt,
    ),
    index("idx_task_snapshots_project_updated_at").on(table.projectId, table.updatedAt),
    index("idx_task_snapshots_current_session_id").on(table.currentSessionId),
    index("idx_task_snapshots_latest_session_id").on(table.latestSessionId),
  ],
);
```

## task_artifacts

- 常量名: taskArtifacts

```ts
export const taskArtifacts = pgTable(
  "task_artifacts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    sessionId: text("session_id").references(() => taskSessions.id),
    messageId: text("message_id").references(() => taskSessionMessages.id),
    operationId: text("operation_id").references(() => sessionOperations.id),
    parentArtifactId: text("parent_artifact_id").references((): AnyPgColumn => taskArtifacts.id),
    artifactKind: text("artifact_kind").$type<TaskArtifactKind>().notNull(),
    storageKind: text("storage_kind").$type<TaskArtifactStorageKind>().notNull().default("inline"),
    title: text("title"),
    mimeType: text("mime_type"),
    filePath: text("file_path"),
    externalUri: text("external_uri"),
    contentText: text("content_text"),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_artifacts_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_artifacts_session_created_at").on(table.sessionId, table.createdAt),
    index("idx_task_artifacts_message_id").on(table.messageId),
    index("idx_task_artifacts_operation_id").on(table.operationId),
    index("idx_task_artifacts_parent_artifact_id").on(table.parentArtifactId),
  ],
);
```

## task_usage_ledger_entries

- 常量名: taskUsageLedgerEntries

```ts
export const taskUsageLedgerEntries = pgTable(
  "task_usage_ledger_entries",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    sessionId: text("session_id").references(() => taskSessions.id),
    messageId: text("message_id").references(() => taskSessionMessages.id),
    operationId: text("operation_id").references(() => sessionOperations.id),
    entryKind: text("entry_kind").$type<TaskUsageEntryKind>().notNull(),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    requestCount: integer("request_count").notNull().default(1),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    currencyCode: text("currency_code").notNull().default("USD"),
    recordedAt: text("recorded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_usage_ledger_entries_project_recorded_at").on(table.projectId, table.recordedAt),
    index("idx_task_usage_ledger_entries_task_recorded_at").on(table.taskId, table.recordedAt),
    index("idx_task_usage_ledger_entries_session_recorded_at").on(
      table.sessionId,
      table.recordedAt,
    ),
    index("idx_task_usage_ledger_entries_operation_id").on(table.operationId),
    index("idx_task_usage_ledger_entries_provider_model_recorded_at").on(
      table.providerId,
      table.modelId,
      table.recordedAt,
    ),
  ],
);
```

## task_timeline_views

- 常量名: taskTimelineViews

```ts
export const taskTimelineViews = pgTable(
  "task_timeline_views",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id").references(() => taskSessions.id),
    messageId: text("message_id").references(() => taskSessionMessages.id),
    operationId: text("operation_id").references(() => sessionOperations.id),
    artifactId: text("artifact_id").references(() => taskArtifacts.id),
    itemKind: text("item_kind").$type<TaskTimelineItemKind>().notNull(),
    itemRole: text("item_role").$type<TaskSessionMessageRole>(),
    title: text("title"),
    displayText: text("display_text"),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sortAt: text("sort_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_timeline_views_task_sort_at").on(table.taskId, table.sortAt, table.createdAt),
    index("idx_task_timeline_views_session_sort_at").on(
      table.sessionId,
      table.sortAt,
      table.createdAt,
    ),
  ],
);
```

## code_changes

- 常量名: codeChanges

```ts
export const codeChanges = pgTable("code_changes", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => projectTreeNodes.id),
  repoId: text("repo_id").references(() => repositories.id),
  agentRunId: text("agent_run_id"),
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
```

## file_changes

- 常量名: fileChanges

```ts
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
```

## plugins

- 常量名: plugins

```ts
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
```

## budget_configs

- 常量名: budgetConfigs

```ts
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
```

## workbench_layouts

- 常量名: workbenchLayouts

```ts
export const workbenchLayouts = pgTable("workbench_layouts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  layoutJson: text("layout_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

## role_agents

- 常量名: roleAgents

```ts
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
```

## role_agent_bindings

- 常量名: roleAgentBindings

```ts
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
```

## role_agent_project_overrides

- 常量名: roleAgentProjectOverrides

```ts
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
```

## workflow_templates

- 常量名: workflowTemplates

```ts
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
```

## workflow_template_stages

- 常量名: workflowTemplateStages

```ts
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
```

## task_workflow_runs

- 常量名: taskWorkflowRuns

```ts
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
```

## task_stage_runs

- 常量名: taskStageRuns

```ts
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
```

## role_aggregate_conclusions

- 常量名: roleAggregateConclusions

```ts
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
```

## developer_change_requests

- 常量名: developerChangeRequests

```ts
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
```

## task_operating_modes

- 常量名: taskOperatingModes

```ts
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
```

## boss_decisions

- 常量名: bossDecisions

```ts
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
```

## human_escalations

- 常量名: humanEscalations

```ts
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
```

## task_message_events

- 状态：已删除。
- 删除方式：见 [control-plane/service/drizzle-pg/0036_drop_task_message_events.sql](../../control-plane/service/drizzle-pg/0036_drop_task_message_events.sql)。
- 说明：这里保留章节名，仅用于说明该历史表已退出当前 schema；现行消息事实层请改看 `task_messages`、`task_message_parts`、`task_sessions`、`task_session_runs` 与 `task_timeline_views`。
