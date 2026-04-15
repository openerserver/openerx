# 角色工作流统一数据表与 API 设计

> 适用范围：OpenerX 控制平面服务与 BFF 的角色注册、阶段状态机、角色聚合结论体系
>
> 目标：把角色注册表、阶段状态机、聚合模型三份文档收敛为一套统一的数据对象、数据库表结构和 API 设计，形成后续实现的单一事实来源

## 1. 文档目标

本文档回答以下问题：

- 角色注册表、阶段状态机、聚合结论分别对应哪些后端对象
- 哪些数据应该落控制平面数据库，哪些数据继续保存在任务策略 JSON 中
- 控制平面服务和 BFF 各自负责哪些 API
- 前端在任务详情页和管理页应该读哪些接口

相关文档：

- [docs/role-agent-registry-design.md](role-agent-registry-design.md)
- [docs/workflow-template-stage-machine-design.md](workflow-template-stage-machine-design.md)
- [docs/role-aggregation-conclusion-model.md](role-aggregation-conclusion-model.md)
- [docs/bff-role-aggregation-executor-design.md](bff-role-aggregation-executor-design.md)

## 2. 设计边界

### 2.1 控制平面服务负责

- 角色注册表主数据
- 角色实例绑定主数据
- 工作流模板主数据
- 任务阶段运行记录
- 角色聚合结论与开发者修正请求持久化
- 审批、审计和治理事实

### 2.2 BFF 负责

- 将任务执行上下文映射为角色聚合执行请求
- 调度角色实例运行
- 解析原始结果、执行聚合和冲突解析
- 调用控制平面 API 持久化运行结果
- 聚合前端视图所需数据

### 2.3 首阶段持久化策略

建议分两层：

- 稳定主数据落库：角色、模板、阶段记录、聚合结论、修正请求
- 短期兼容字段保留在任务策略 JSON：原始 binding 输出、临时中间态、调试信息

原因：

- 角色、模板、阶段记录属于长期治理对象，应该可查询、可审计、可统计
- 原始实例输出在第一阶段仍可能频繁演进，先保留在任务策略 JSON 更稳妥

## 3. 统一对象模型

建议统一抽象以下 8 类对象：

1. `role_agents`
2. `role_agent_bindings`
3. `workflow_templates`
4. `workflow_template_stages`
5. `task_workflow_runs`
6. `task_stage_runs`
7. `role_aggregate_conclusions`
8. `developer_change_requests`

## 4. 数据表设计

### 4.1 role_agents

用途：角色注册表。

建议字段：

```ts
role_agents = {
  id: string,
  name: string,
  description: string | null,
  scope: "system" | "project",
  status: "active" | "disabled" | "deprecated",
  ownerTeam: string | null,
  permissionProfile: string,
  toolProfile: string,
  defaultExecutionMode: "single" | "parallel-review" | "round-robin",
  aggregationStrategy: "first-pass" | "majority" | "merge-summary" | "human-review" | null,
  maxActiveBindings: number | null,
  requireConsensus: boolean,
  riskLevel: "low" | "medium" | "high" | "critical",
  requiresApprovalForWrite: boolean,
  allowedStagesJson: string,
  outputSchemaId: string | null,
  tagsJson: string | null,
  createdAt: string,
  updatedAt: string,
}
```

约束建议：

- `id` 全局唯一
- `scope=project` 时可增加 `projectId`
- `allowedStagesJson` 不为空，最少包含一个阶段
- 非 `role.developer` 角色不应通过 profile 组合间接获得主代码写权限

### 4.2 role_agent_bindings

用途：角色下的具体 Agent 实例绑定，例如安全 A、安全 B。

建议字段：

```ts
role_agent_bindings = {
  id: string,
  roleAgentId: string,
  bindingKey: string,
  runtimeAgent: string,
  label: string,
  enabled: boolean,
  priority: number,
  model: string | null,
  tagsJson: string | null,
  createdAt: string,
  updatedAt: string,
}
```

约束建议：

- `roleAgentId + bindingKey` 唯一
- 外键指向 `role_agents.id`

### 4.3 workflow_templates

用途：工作流模板主表。

建议字段：

```ts
workflow_templates = {
  id: string,
  name: string,
  description: string | null,
  category: string | null,
  enabled: boolean,
  selectableByProjects: boolean,
  stageOrderJson: string,
  defaultRolesJson: string | null,
  version: number,
  createdBy: string | null,
  updatedBy: string | null,
  createdAt: string,
  updatedAt: string,
}
```

### 4.4 workflow_template_stages

用途：模板中的阶段定义。

建议字段：

```ts
workflow_template_stages = {
  id: string,
  templateId: string,
  stageKey: string,
  name: string,
  enabled: boolean,
  mode: "single" | "parallel" | "pipeline",
  primaryRoleAgentId: string,
  participantRoleAgentIdsJson: string,
  roleExecutionPoliciesJson: string | null,
  entryCriteriaJson: string | null,
  exitCriteriaJson: string | null,
  hooksJson: string | null,
  gatesJson: string | null,
  approvalsJson: string | null,
  failurePolicyJson: string | null,
  orderIndex: number,
}
```

### 4.5 task_workflow_runs

用途：任务级工作流运行记录。

建议字段：

```ts
task_workflow_runs = {
  id: string,
  taskId: string,
  templateId: string,
  currentStage: string,
  status: "pending" | "running" | "blocked" | "waiting-approval" | "failed" | "completed" | "cancelled",
  startedAt: string,
  finishedAt: string | null,
  createdAt: string,
  updatedAt: string,
}
```

约束建议：

- `taskId` 唯一，表示一个任务当前只有一个主工作流运行对象

### 4.6 task_stage_runs

用途：任务每个阶段的执行记录。

建议字段：

```ts
task_stage_runs = {
  id: string,
  workflowRunId: string,
  stageKey: string,
  status: "pending" | "running" | "blocked" | "waiting-approval" | "failed" | "completed" | "skipped" | "cancelled",
  primaryRoleAgentId: string,
  participantRoleAgentIdsJson: string | null,
  startedAt: string | null,
  finishedAt: string | null,
  blockingReason: string | null,
  approvalState: "not-required" | "pending" | "approved" | "rejected" | "expired" | "cancelled",
  artifactsSummaryJson: string | null,
  createdAt: string,
  updatedAt: string,
}
```

### 4.7 role_aggregate_conclusions

用途：同一角色聚合后的统一结论。

建议字段：

```ts
role_aggregate_conclusions = {
  id: string,
  taskStageRunId: string,
  roleAgentId: string,
  aggregationStrategy: "first-pass" | "majority" | "merge-summary" | "human-review",
  status: "aligned" | "partially-aligned" | "conflicted" | "escalated" | "blocked",
  finalDecision: "allow" | "notify-developer" | "needs-approval" | "block" | "observe" | "human-review",
  aggregateRiskLevel: "low" | "medium" | "high" | "critical",
  confidenceScore: number,
  consensusScore: number,
  winningRationale: string,
  mergedFindingsJson: string | null,
  minorityFindingsJson: string | null,
  conflictsJson: string | null,
  approvalRecommendationJson: string | null,
  rawBindingResultRefJson: string | null,
  generatedAt: string,
}
```

### 4.8 developer_change_requests

用途：聚合后生成的开发者修正请求。

建议字段：

```ts
developer_change_requests = {
  id: string,
  taskId: string,
  taskStageRunId: string,
  sourceRoleAgentId: string,
  priority: "low" | "medium" | "high" | "critical",
  title: string,
  summary: string,
  requiredChangesJson: string,
  relatedFindingKeysJson: string | null,
  blocking: boolean,
  approvalRequired: boolean,
  status: "open" | "acknowledged" | "in-progress" | "resolved" | "won't-fix",
  resolutionNote: string | null,
  assignedRoleAgentId: string | null,
  createdAt: string,
  updatedAt: string,
}
```

建议默认：

- `assignedRoleAgentId = role.developer`

## 5. JSON 字段与渐进迁移建议

第一阶段建议保留以下数据在任务策略 JSON 中：

- `roleBindingResults`
- 解析失败的原始文本输出
- 调试权重、实例选择日志、prompt 快照

第二阶段再将高价值部分迁移到正式表：

- `bindingResults` 明细表
- `stage hook executions` 明细表

## 6. 注册表解析读模型建议

控制平面除了保存角色注册表写模型外，还应提供一个面向 BFF / 阶段推进器的解析读模型。

建议统一以下对象：

```ts
interface ResolvedRoleAgentView {
  id: string;
  name: string;
  scope: "system" | "project";
  status: "active" | "disabled" | "deprecated";
  riskLevel: "low" | "medium" | "high" | "critical";
  allowedStages: string[];
  permissionProfile: string;
  toolProfile: string;
  defaultExecutionMode: "single" | "parallel-review" | "round-robin";
  aggregationPolicy?: {
    strategy: "first-pass" | "majority" | "merge-summary" | "human-review";
    maxActiveBindings?: number;
    requireConsensus?: boolean;
  };
  requiresApprovalForWrite: boolean;
  outputSchemaId?: string | null;
  bindings: Array<{
    bindingId: string;
    runtimeAgent: string;
    label: string;
    enabled: boolean;
    priority: number;
    model?: string | null;
    tags?: string[] | null;
  }>;
}

interface ResolvedRoleAgentResponse {
  data: {
    role: ResolvedRoleAgentView;
    source: {
      baseScope: "system" | "project";
      overrideApplied: boolean;
      policySource: "role-default" | "template-stage";
    };
    validation: {
      executable: boolean;
      reasons: string[];
    };
  };
}
```

说明：

- 该对象不等同于数据库行，而是“项目覆盖 + 阶段校验 + bindings 过滤”后的执行视图
- BFF 不应自行重复实现项目覆盖和 allowedStages 校验逻辑
- 前端管理页可复用此模型显示“当前项目是否可执行某角色”

## 7. 控制平面服务 API 设计

### 7.1 角色注册表 API

建议新增：

- `GET /api/role-agents`
- `GET /api/role-agents/:roleAgentId`
- `POST /api/role-agents`
- `PATCH /api/role-agents/:roleAgentId`
- `GET /api/role-agents/:roleAgentId/bindings`
- `POST /api/role-agents/:roleAgentId/bindings`
- `PATCH /api/role-agents/:roleAgentId/bindings/:bindingId`
- `GET /api/role-agents/:roleAgentId/resolve`

用途：

- 管理角色定义和实例绑定
- 为 BFF、阶段推进器和审批引擎提供执行前解析结果

`GET /api/role-agents/:roleAgentId/resolve` 查询参数建议：

- `projectId?`
- `stage?`
- `templateId?`

返回建议：

- `ResolvedRoleAgentResponse`

用途说明：

- `projectId` 用于应用项目级覆盖
- `stage` 用于校验 `allowedStages`
- `templateId` 用于决定策略来源是否被模板阶段策略覆盖

### 7.2 工作流模板 API

建议新增：

- `GET /api/workflow-templates`
- `GET /api/workflow-templates/:templateId`
- `POST /api/workflow-templates`
- `PATCH /api/workflow-templates/:templateId`
- `GET /api/workflow-templates/:templateId/stages`

### 7.3 任务工作流运行 API

建议新增：

- `GET /api/tasks/:taskId/workflow`
- `POST /api/tasks/:taskId/workflow/initialize`
- `POST /api/tasks/:taskId/workflow/advance`
- `POST /api/tasks/:taskId/workflow/retry-stage`
- `POST /api/tasks/:taskId/workflow/block`
- `POST /api/tasks/:taskId/workflow/cancel`

返回内容建议包括：

- 当前阶段
- 阶段状态列表
- 当前阻塞原因
- 审批状态

### 7.4 聚合结论 API

建议新增：

- `GET /api/tasks/:taskId/role-conclusions`
- `GET /api/tasks/:taskId/stages/:stageKey/role-conclusions`
- `POST /api/tasks/:taskId/stages/:stageKey/role-conclusions`

说明：

- 读接口给前端页面和管理页使用
- 写接口主要由 BFF 内部调用

### 7.5 开发者修正请求 API

建议新增：

- `GET /api/tasks/:taskId/developer-change-requests`
- `POST /api/tasks/:taskId/developer-change-requests`
- `PATCH /api/developer-change-requests/:requestId`

典型状态流转：

- `open`
- `acknowledged`
- `in-progress`
- `resolved`
- `won't-fix`

## 8. 注册表种子策略建议

角色注册表与工作流模板存在强引用关系，因此首批默认角色不应只停留在文档中，而应作为平台种子主数据。

### 8.1 建议默认种子对象

建议平台初始化时默认写入：

- 8 个系统级角色：`role.product`、`role.architect`、`role.developer`、`role.visual`、`role.security`、`role.release`、`role.operations`、`role.qa`
- 每个角色的默认 bindings
- 受控的 `permissionProfile`、`toolProfile`、`outputSchemaId`

### 8.2 种子执行方式

建议种子以两种入口并存：

1. 启动/部署时的内部 seed 脚本，用于新环境初始化
2. 管理员显式触发的 bootstrap 动作，用于补齐历史环境缺失角色

建议接口：

- `POST /api/role-agents/bootstrap-defaults`

请求体建议：

```ts
z.object({
  applyBindings: z.boolean().default(true),
  overwriteUnmodifiedRecords: z.boolean().default(false),
  scope: z.enum(["system"]).default("system"),
})
```

返回建议：

```ts
{
  data: {
    createdRoles: string[];
    updatedRoles: string[];
    skippedRoles: string[];
    createdBindings: string[];
    updatedBindings: string[];
    skippedBindings: string[];
  };
}
```

### 8.3 种子幂等原则

- 以角色 `id` 和 binding 的 `roleAgentId + bindingKey` 作为幂等键
- 项目级角色和项目级 bindings 不应被系统种子覆盖
- 管理员显式修改过的系统角色默认不自动覆盖，除非 `overwriteUnmodifiedRecords=true`
- 若工作流模板引用了缺失角色，bootstrap 结果必须能明确指出未补齐项

## 9. BFF API 与聚合职责

### 9.1 BFF 对前端提供的聚合接口

建议新增：

- `GET /api/tasks/:taskId/workflow-view`
- `GET /api/tasks/:taskId/role-review-panel`

用途：

- 一次性返回任务详情页所需的阶段、角色结论、冲突和修正请求聚合视图

### 9.2 BFF 对控制平面调用的写入接口

BFF 在执行角色聚合后，按顺序调用：

1. 写阶段运行更新
2. 写角色聚合结论
3. 写开发者修正请求
4. 视情况写审批单或审计事件

## 10. 统一读模型建议

为减少前端多次拼装，建议 BFF 输出统一读模型。

```ts
interface TaskWorkflowViewModel {
  taskId: string;
  workflow: {
    templateId: string;
    currentStage: string;
    status: string;
    stages: TaskStageViewModel[];
  };
  roleConclusions: RoleConclusionViewModel[];
  developerChangeRequests: DeveloperChangeRequestViewModel[];
}

interface TaskStageViewModel {
  stageKey: string;
  status: string;
  approvalState: string;
  blockingReason?: string;
}

interface RoleConclusionViewModel {
  roleAgentId: string;
  stage: string;
  finalDecision: string;
  aggregateRiskLevel: string;
  consensusScore: number;
  winningRationale: string;
  mergedFindings: Array<{ key: string; title: string; severity: string }>;
  conflicts: Array<{ type: string; severity: string; summary: string }>;
}

interface DeveloperChangeRequestViewModel {
  id: string;
  sourceRoleAgentId: string;
  priority: string;
  title: string;
  summary: string;
  blocking: boolean;
  approvalRequired: boolean;
  status: string;
}
```

## 11. 权限建议

### 11.1 管理页权限

- 角色注册表和工作流模板仅管理员可编辑
- 项目成员可只读查看与本项目相关的模板生效结果

### 11.2 任务详情页权限

- 普通成员可查看角色结论摘要和开发者修正请求
- 冲突细节、原始实例输出可按角色或管理权限进一步控制

## 12. 落地顺序建议

### 12.1 Phase 1

- 先补控制平面表结构：`role_agents`、`role_agent_bindings`、`workflow_templates`、`workflow_template_stages`
- 在 `role_agents` 中补 `allowedStagesJson`
- 提供 `GET /api/role-agents/:roleAgentId/resolve` 与 bootstrap 默认角色能力
- BFF 继续把运行结果写入任务策略 JSON
- 前端先消费 BFF 聚合读模型

### 12.2 Phase 2

- 增加 `task_workflow_runs`、`task_stage_runs`
- 增加 `role_aggregate_conclusions`、`developer_change_requests`
- 将阶段状态和聚合结果从 JSON 转向正式表

### 12.3 Phase 3

- 增加 binding 级明细表
- 增加统计、治理报表和准确率回放能力

## 13. 首批验收标准

1. 后端对象能完整覆盖角色注册表、阶段状态机、角色聚合结论和开发者修正请求。
2. 控制平面 API 与 BFF 聚合职责边界明确。
3. 前端可以通过统一读模型拿到任务详情页所需主要数据。
4. 保持只有开发者角色可修改主代码，修正请求默认回交开发者。
5. 整套设计允许先 JSON 兼容、后表结构落地的渐进实现。
6. 角色注册表支持 `allowedStages` 校验、项目覆盖解析和默认种子补齐。
