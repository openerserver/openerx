# 控制平面角色工作流 Schema 与 Routes 草案

> 适用范围：OpenerX Control Plane Service
>
> 目标：把角色注册表、工作流模板、阶段运行、聚合结论、开发者修正请求落成贴近当前 Drizzle + Hono 风格的 schema 与 routes 草案，作为后续真实实现的起点

## 1. 文档目标

本文档回答以下问题：

- 在现有 [control-plane/service/src/db/schema.ts](control-plane/service/src/db/schema.ts) 基础上应新增哪些表
- 控制平面模块目录应该如何拆分，避免把新能力塞进现有 tasks 或 governance 模块
- 每个模块的 Hono 路由、请求体和返回体应大致长什么样
- 第一阶段哪些对象先落表，哪些仍可由 BFF 通过任务 strategy JSON 兼容

相关文档：

- [docs/role-workflow-data-api-design.md](docs/role-workflow-data-api-design.md)
- [docs/role-agent-registry-design.md](docs/role-agent-registry-design.md)
- [docs/workflow-template-stage-machine-design.md](docs/workflow-template-stage-machine-design.md)
- [docs/role-aggregation-conclusion-model.md](docs/role-aggregation-conclusion-model.md)

## 2. 与现有代码风格的对齐

当前控制平面服务的特点：

- 使用 Drizzle + SQLite，schema 集中定义在 [control-plane/service/src/db/schema.ts](control-plane/service/src/db/schema.ts)
- 模块按 `src/modules/<domain>/routes.ts` 组织，例如 [control-plane/service/src/modules/tasks/routes.ts](control-plane/service/src/modules/tasks/routes.ts)
- 路由层直接使用 `db.query.*` 和 `db.insert/update`
- 输入校验使用 `zod` + `zValidator`
- 权限控制使用 `authMiddleware` + `requireRole()`

因此本草案遵循同样风格：

- 先在 schema.ts 中新增表
- 每个新领域建独立模块目录
- 每个 routes.ts 仅处理本领域对象
- 不在第一阶段引入过度抽象的 repository/service 层

## 3. 建议新增表

建议首批新增 6 张表：

1. `roleAgents`
2. `roleAgentBindings`
3. `workflowTemplates`
4. `workflowTemplateStages`
5. `taskWorkflowRuns`
6. `taskStageRuns`

第二阶段再新增：

1. `roleAggregateConclusions`
2. `developerChangeRequests`

## 4. schema.ts 草案

### 4.1 roleAgents

```ts
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
  outputSchemaId: text("output_schema_id"),
  tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

### 4.2 roleAgentBindings

```ts
export const roleAgentBindings = sqliteTable("role_agent_bindings", {
  id: text("id").primaryKey(),
  roleAgentId: text("role_agent_id")
    .notNull()
    .references(() => roleAgents.id),
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
```

### 4.3 workflowTemplates

```ts
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
  stageOrderJson: text("stage_order_json", { mode: "json" }).$type<string[]>().notNull(),
  defaultRolesJson: text("default_roles_json", { mode: "json" }).$type<string[]>(),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

### 4.4 workflowTemplateStages

```ts
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
  failurePolicyJson: text("failure_policy_json", { mode: "json" }),
  orderIndex: integer("order_index").notNull().default(0),
});
```

### 4.5 taskWorkflowRuns

```ts
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
```

### 4.6 taskStageRuns

```ts
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
```

### 4.7 第二阶段扩展表

建议第二阶段新增：

- `roleAggregateConclusions`
- `developerChangeRequests`

这两张表与 [docs/role-workflow-data-api-design.md](docs/role-workflow-data-api-design.md) 保持一致，此处不重复展开完整 schema。

## 5. 建议模块目录

建议新增以下模块：

- `control-plane/service/src/modules/role-agents/routes.ts`
- `control-plane/service/src/modules/workflow-templates/routes.ts`
- `control-plane/service/src/modules/task-workflows/routes.ts`
- `control-plane/service/src/modules/role-conclusions/routes.ts`
- `control-plane/service/src/modules/developer-change-requests/routes.ts`

### 5.1 模块职责

`role-agents`

- 管理角色和 binding 主数据

`workflow-templates`

- 管理模板与阶段定义

`task-workflows`

- 管理任务工作流运行和阶段状态

`role-conclusions`

- 读写角色聚合结论

`developer-change-requests`

- 读写开发者修正请求状态

## 6. role-agents routes 草案

### 6.1 GET /api/role-agents

用途：

- 列出角色注册表

查询参数建议：

- `projectId?`
- `scope?`
- `status?`

返回：

```ts
{ data: Array<{ id: string; name: string; scope: string; status: string; defaultExecutionMode: string }> }
```

### 6.2 POST /api/role-agents

建议 schema：

```ts
z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.enum(["system", "project"]),
  projectId: z.string().optional(),
  permissionProfile: z.string().min(1),
  toolProfile: z.string().min(1),
  defaultExecutionMode: z.enum(["single", "parallel-review", "round-robin"]),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]).optional(),
})
```

### 6.3 GET/POST/PATCH /api/role-agents/:roleAgentId/bindings

用途：

- 管理角色实例绑定

binding schema 建议：

```ts
z.object({
  bindingKey: z.string().min(1),
  runtimeAgent: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1),
  model: z.string().optional(),
})
```

## 7. workflow-templates routes 草案

### 7.1 GET /api/workflow-templates

用途：

- 列出模板

### 7.2 POST /api/workflow-templates

建议 schema：

```ts
z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  enabled: z.boolean(),
  selectableByProjects: z.boolean(),
  stageOrder: z.array(z.string()).min(1),
  defaultRoles: z.array(z.string()).optional(),
})
```

### 7.3 GET/POST/PATCH /api/workflow-templates/:templateId/stages

用途：

- 管理模板阶段定义

stage schema 建议：

```ts
z.object({
  id: z.string().min(1),
  stageKey: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  mode: z.enum(["single", "parallel", "pipeline"]),
  primaryRoleAgentId: z.string().min(1),
  participantRoleAgentIds: z.array(z.string()).default([]),
  roleExecutionPolicies: z.array(z.object({
    roleAgentId: z.string().min(1),
    executionMode: z.enum(["single", "parallel-review", "round-robin"]),
    maxBindings: z.number().int().positive().optional(),
    aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]).optional(),
  })).optional(),
})
```

## 8. task-workflows routes 草案

### 8.1 GET /api/tasks/:taskId/workflow

用途：

- 获取任务工作流运行详情

返回建议：

```ts
{
  data: {
    workflowRun: { id: string; currentStage: string; status: string } | null,
    stages: Array<{ id: string; stageKey: string; status: string; approvalState: string }>
  }
}
```

### 8.2 POST /api/tasks/:taskId/workflow/initialize

用途：

- 初始化任务工作流运行

请求体：

```ts
z.object({
  templateId: z.string().min(1),
  currentStage: z.string().min(1).optional(),
})
```

### 8.3 POST /api/tasks/:taskId/workflow/advance

用途：

- 推进到下一阶段或回写当前阶段状态

请求体：

```ts
z.object({
  fromStage: z.string().min(1),
  toStage: z.string().min(1).optional(),
  status: z.enum(["running", "blocked", "waiting-approval", "failed", "completed"]),
  blockingReason: z.string().optional(),
  approvalState: z.enum(["not-required", "pending", "approved", "rejected", "expired", "cancelled"]).optional(),
})
```

### 8.4 POST /api/tasks/:taskId/workflow/retry-stage

用途：

- 阶段重试

## 9. role-conclusions routes 草案

### 9.1 GET /api/tasks/:taskId/role-conclusions

用途：

- 按任务读取所有角色聚合结论

### 9.2 GET /api/tasks/:taskId/stages/:stageKey/role-conclusions

用途：

- 读取某阶段角色结论

### 9.3 POST /api/tasks/:taskId/stages/:stageKey/role-conclusions

用途：

- 由 BFF 写入聚合结论

请求体建议：

```ts
z.object({
  roleAgentId: z.string().min(1),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]),
  status: z.enum(["aligned", "partially-aligned", "conflicted", "escalated", "blocked"]),
  finalDecision: z.enum(["allow", "notify-developer", "needs-approval", "block", "observe", "human-review"]),
  aggregateRiskLevel: z.enum(["low", "medium", "high", "critical"]),
  confidenceScore: z.number(),
  consensusScore: z.number(),
  winningRationale: z.string(),
  mergedFindings: z.array(z.any()).optional(),
  minorityFindings: z.array(z.any()).optional(),
  conflicts: z.array(z.any()).optional(),
  approvalRecommendation: z.any().optional(),
})
```

## 10. developer-change-requests routes 草案

### 10.1 GET /api/tasks/:taskId/developer-change-requests

用途：

- 列出开发者修正请求

### 10.2 POST /api/tasks/:taskId/developer-change-requests

用途：

- 由 BFF 创建开发者修正请求

请求体建议：

```ts
z.object({
  taskStageRunId: z.string().min(1),
  sourceRoleAgentId: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  requiredChanges: z.array(z.string()).min(1),
  relatedFindingKeys: z.array(z.string()).optional(),
  blocking: z.boolean(),
  approvalRequired: z.boolean(),
})
```

### 10.3 PATCH /api/developer-change-requests/:requestId

用途：

- 更新修正请求状态

请求体：

```ts
z.object({
  status: z.enum(["open", "acknowledged", "in-progress", "resolved", "won't-fix"]),
  resolutionNote: z.string().optional(),
})
```

## 11. 第一阶段落地建议

### 11.1 最小 schema 变更

第一阶段优先新增：

- `roleAgents`
- `roleAgentBindings`
- `workflowTemplates`
- `workflowTemplateStages`

原因：

- 这几张表是主数据，不应继续塞在 JSON 配置里

### 11.2 中间兼容策略

- `taskWorkflowRuns` 与 `taskStageRuns` 可先只做 API 草案，不立即强依赖
- `roleAggregateConclusions` 与 `developerChangeRequests` 第一阶段可继续通过 BFF 聚合读模型输出，并部分保存在 `tasks.strategy`

## 12. 建议的挂载方式

建议在服务入口按现有模块风格挂载：

- `/api/role-agents`
- `/api/workflow-templates`
- `/api/tasks/:taskId/workflow`
- `/api/tasks/:taskId/role-conclusions`
- `/api/tasks/:taskId/developer-change-requests`

## 13. 首批验收标准

1. schema 草案与当前 Drizzle 风格一致。
2. routes 草案与当前 Hono + zod 风格一致。
3. 主数据、运行态、聚合结论、修正请求的对象边界清晰。
4. 第一阶段和第二阶段的落地边界明确，没有一次性引入过多耦合。
