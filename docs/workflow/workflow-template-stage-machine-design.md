# 工作流模板与阶段状态机设计文档

> 适用范围：OpenerX 开发过程多角色 Agent 工作流编排
>
> 目标：定义工作流模板 schema、阶段枚举、状态流转规则、Hook 触发时机、审批动作和阻断行为，作为任务生命周期与角色 Agent 协作的统一状态机基础

## 1. 文档目标

本文档回答以下问题：

- 一个研发任务在系统里如何分阶段流转
- 每个阶段何时进入、何时退出、失败后怎么处理
- 工作流模板如何描述角色、阶段、Gate、审批和并行关系
- Hook 在哪些时机被触发，触发后可以做出什么决策
- 如何与当前已有的 `OrchestrationStrategy`、`LifecycleHook` 和审批标准兼容

相关文档：

- [docs/development-role-agents-plan.md](../organization/development-role-agents-plan.md)
- [docs/role-agent-registry-design.md](role-agent-registry-design.md)
- [docs/multi-agent-hook-architecture.md](../architecture/multi-agent-hook-architecture.md)
- [docs/approval-standards-management-plan.md](approval-standards-management-plan.md)

## 2. 设计目标

本设计要解决三类问题：

1. 让任务执行不再只有“执行前 / 执行后”两个粗粒度状态，而是具备研发过程的阶段感。
2. 让多角色 Agent 的参与点可配置、可审计、可阻断，而不是依赖人工口头约定。
3. 让审批、阻断、回退、重试和人工接管都成为状态机的一部分。
4. 让同一角色可以挂多个 Agent 实例，从多个视角做辅助分析、评审与交叉验证。

## 3. 设计原则

### 3.1 阶段优先于步骤

先定义稳定的阶段，再在每个阶段里定义步骤、角色和 Hook。

否则模板会退化成一串难以治理的执行脚本。

### 3.2 Gate 是一等公民

阶段结束时的准入检查不是附属逻辑，而是状态机核心节点。

### 3.3 审批动作不能只存在于 UI

审批请求、等待审批、审批通过、审批拒绝都必须是状态机可见状态。

### 3.4 与当前实现渐进兼容

当前代码中 `HookTrigger` 只有：

- `pre-execution`
- `post-execution`
- `on-failure`
- `pre-resume`

因此本设计分两层表达：

- 逻辑层：定义完整阶段 Hook
- 兼容层：将阶段 Hook 映射到当前生命周期 Hook 触发点或 BFF 内部阶段事件

### 3.5 角色与实例分离

工作流模板应优先引用角色，而不是直接引用某个具体 Agent 实例。

原因：

- 一个角色下可能存在多个实例，例如安全 A、安全 B
- 模板关心的是职责，不是某个底层实现名字
- 实例选择策略应由角色注册表或模板中的角色执行策略决定

## 4. 阶段枚举

建议首批定义以下阶段：

```ts
type WorkflowStage =
  | "intake"
  | "clarify"
  | "design"
  | "plan"
  | "implement"
  | "verify"
  | "release"
  | "post-release"
  | "retrospective"
  | "done"
  | "cancelled";
```

### 4.1 阶段说明

| 阶段 | 含义 | 主目标 |
| ---- | ---- | ---- |
| `intake` | 任务进入 | 受理请求、挂模板、补基础元信息 |
| `clarify` | 需求澄清 | 形成明确目标、范围和验收标准 |
| `design` | 方案设计 | 确定边界、接口、模块和风险 |
| `plan` | 任务拆解 | 形成执行计划、依赖、阶段 Gate 和开发者待办 |
| `implement` | 实现开发 | 仅由开发者 Agent 完成代码、配置、脚本与文档落地 |
| `verify` | 集成验证 | 测试、联调、权限与运行检查 |
| `release` | 发布准备与执行 | 发布计划、审批、部署、回滚 |
| `post-release` | 发布观察 | 指标、日志、告警、异常处理 |
| `retrospective` | 复盘沉淀 | 复盘经验、更新模板和规则 |
| `done` | 已完成 | 正常结束 |
| `cancelled` | 已取消 | 提前终止 |

## 5. 阶段状态机

### 5.1 阶段运行状态

```ts
type WorkflowStageRunStatus =
  | "pending"
  | "running"
  | "blocked"
  | "waiting-approval"
  | "failed"
  | "completed"
  | "skipped"
  | "cancelled";
```

### 5.2 顶层流转规则

正常路径：

```text
intake
→ clarify
→ design
→ plan
→ implement
→ verify
→ release
→ post-release
→ retrospective
→ done
```

异常路径：

- 任一阶段可进入 `blocked`
- 任一阶段可进入 `waiting-approval`
- 任一阶段失败可回退到前一阶段或进入 `cancelled`
- `release` 阶段失败后可进入 `post-release` 的故障观察子路径，随后决定 `rollback` 或回到 `implement`

### 5.3 关键流转约束

1. 没有 `clarify` 产物时，不允许进入 `design`。
2. 没有 `design` 产物和架构 Gate 时，不允许进入 `implement`。
3. 没有验证报告时，不允许进入 `release`。
4. 命中高风险规则时，阶段状态必须进入 `waiting-approval`，而不是继续执行。
5. `post-release` 观察未完成时，不允许直接 `done`。
6. 非开发者角色在任何阶段都不能直接修改项目主代码，只能通过 Gate、审批或 `notify-developer` 动作推动修复。

## 6. 工作流模板 Schema

### 6.1 逻辑模板结构

```ts
interface WorkflowTemplateDefinition {
  id: string;
  name: string;
  description: string;
  category?: string;
  enabled: boolean;
  selectableByProjects: boolean;
  defaultRoles: string[];
  stageOrder: WorkflowStage[];
  stages: WorkflowTemplateStage[];
  globalHooks?: StageHookDefinition[];
  gatePolicy?: WorkflowGatePolicy;
}

interface WorkflowTemplateStage {
  id: string;
  stage: WorkflowStage;
  name: string;
  enabled: boolean;
  mode: "single" | "parallel" | "pipeline";
  primaryRoleAgentId: string;
  participantRoleAgentIds: string[];
  roleExecutionPolicies?: RoleExecutionPolicy[];
  entryCriteria: string[];
  exitCriteria: string[];
  hooks: StageHookDefinition[];
  gates: StageGateDefinition[];
  approvals?: ApprovalRequirement[];
  failurePolicy: StageFailurePolicy;
}

interface RoleExecutionPolicy {
  roleAgentId: string;
  executionMode: "single" | "parallel-review" | "round-robin";
  maxBindings?: number;
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review";
}
```

### 6.2 Gate 与审批结构

```ts
interface StageGateDefinition {
  id: string;
  type: "quality" | "security" | "release" | "ops" | "product" | "architecture";
  required: boolean;
  evaluatorRoleAgentId: string;
  evaluatorBindingMode?: "single" | "parallel-review";
  passActions: StageAction[];
  failActions: StageAction[];
}

interface ApprovalRequirement {
  id: string;
  trigger: "always" | "conditional";
  standardId?: string;
  approverPolicy: "owner" | "project-admin" | "security-admin" | "release-manager";
  blockUntilResolved: boolean;
}

interface StageFailurePolicy {
  retryLimit: number;
  onFailure: "retry-stage" | "rollback-stage" | "jump-to-fix" | "cancel-workflow";
  fallbackStage?: WorkflowStage;
}
```

## 7. Hook 模型

### 7.1 逻辑 Hook 时机

建议在阶段层定义更清晰的 Hook：

```ts
type StageHookTrigger =
  | "before-stage"
  | "after-stage"
  | "before-role"
  | "after-role"
  | "on-stage-failure"
  | "before-gate"
  | "after-gate"
  | "before-approval"
  | "after-approval"
  | "before-resume";
```

### 7.2 与当前 `LifecycleHook` 的兼容映射

当前实现还没有完整阶段 Hook，可先按以下方式映射：

| 逻辑 Hook | 当前兼容触发点 |
| ---- | ---- |
| `before-stage` | `pre-execution` 或 BFF 阶段开始事件 |
| `after-stage` | `post-execution` 或阶段完成事件 |
| `on-stage-failure` | `on-failure` |
| `before-resume` | `pre-resume` |
| `before-gate` | BFF Gate 检查前 |
| `after-gate` | BFF Gate 检查后 |
| `before-approval` | 创建审批单前 |
| `after-approval` | 审批结果回写后 |

### 7.3 Hook 定义建议

```ts
interface StageHookDefinition {
  id: string;
  trigger: StageHookTrigger;
  roleAgentId: string;
  bindingExecutionMode?: "single" | "parallel-review";
  enabled: boolean;
  order: number;
  timeoutMs: number;
  promptTemplate: string;
  onDecision: HookDecisionRouting;
}

interface HookDecisionRouting {
  allow: StageAction[];
  block: StageAction[];
  revise: StageAction[];
  needsApproval: StageAction[];
}
```

## 8. 阶段动作与审批动作

### 8.1 阶段动作枚举

```ts
type StageAction =
  | "advance"
  | "stay"
  | "retry"
  | "rollback"
  | "notify-developer"
  | "request-approval"
  | "wait-approval"
  | "handoff"
  | "spawn-followup"
  | "escalate-human"
  | "cancel";
```

### 8.2 审批动作枚举

```ts
type ApprovalAction =
  | "create-ticket"
  | "attach-artifacts"
  | "pause-workflow"
  | "resume-on-approve"
  | "rollback-on-reject"
  | "notify-owners";
```

### 8.3 审批状态枚举

```ts
type ApprovalState =
  | "not-required"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";
```

## 9. 建议的首批模板

### 9.1 功能开发模板

```yaml
id: workflow.feature-delivery
stageOrder:
  - intake
  - clarify
  - design
  - plan
  - implement
  - verify
  - release
  - post-release
  - retrospective
```

角色：

- `role.product`
- `role.architect`
- `role.developer`
- `role.qa`
- `role.release`
- `role.operations`

角色执行建议：

- `role.architect` 可启用多个架构 Agent 并行审查方案
- `role.developer` 默认单主执行实例
- `role.qa` 可启用多个 QA Agent 交叉验证

### 9.2 UI 重设计模板

```yaml
id: workflow.ui-redesign
stageOrder:
  - intake
  - clarify
  - design
  - plan
  - implement
  - verify
  - retrospective
```

额外特征：

- `design` 阶段强制插入 `role.visual`
- `implement` 阶段唯一主责角色为 `role.developer`
- `release` 可按项目设置为可选阶段
- `design` 与 `verify` 阶段可为辅助角色启用多 Agent 并行评审

### 9.3 安全修复模板

```yaml
id: workflow.security-remediation
stageOrder:
  - intake
  - clarify
  - design
  - implement
  - verify
  - release
  - post-release
  - retrospective
```

额外特征：

- `role.security` 在 `clarify`、`design`、`verify`、`release` 均为必选
- `role.security` 可绑定多个安全 Agent 并行给出风险意见
- `release` 默认带审批要求

## 10. 典型阶段设计

### 10.1 `clarify` 阶段

主责角色：

- `role.product`

典型 Hooks：

- `before-stage`: 拉取上下文并补齐任务元信息
- `after-role`: 生成需求摘要与验收标准

典型 Gates：

- `product-clarity-gate`

通过条件：

- 存在需求摘要
- 存在非目标范围
- 存在验收标准

### 10.2 `design` 阶段

主责角色：

- `role.architect`

协作角色：

- `role.developer`
- `role.visual`
- `role.security`

协作规则：

- `role.architect` 与 `role.security` 都可以启用多实例评审
- 多实例输出先聚合，再形成对开发者的统一修正要求

典型审批：

- 涉及高风险权限、生产写操作、敏感配置修改时可提前请求审批

### 10.3 `implement` 阶段

主责角色：

- `role.developer`

约束：

- 只有 `role.developer` 允许执行项目主代码修改
- 其他角色在本阶段只能提交问题、建议、阻断或 `notify-developer` 动作

典型 Gate：

- `security-pre-merge-gate`
- `architecture-consistency-gate`

典型辅助动作：

- `role.security` 的多个实例发现风险后触发 `notify-developer`
- `role.qa` 的多个实例发现问题后触发 `notify-developer`

失败策略：

- 默认 `jump-to-fix`

### 10.4 `release` 阶段

主责角色：

- `role.release`

协作角色：

- `role.operations`
- `role.security`
- `role.qa`

典型审批：

- `standard.production-release`
- `standard.security-high-risk`

拒绝后动作：

- 进入 `blocked`
- 根据模板回退到 `implement` 或 `verify`

## 11. 与现有 `OrchestrationStrategy` 的对齐建议

当前 `orchestration-strategy.ts` 已具备：

- `hooks`
- `templates`
- `judge`

但尚缺：

- 阶段枚举
- 角色 Agent 引用层
- Gate 和审批要求结构
- 失败回退策略

因此建议演进顺序如下：

### 11.1 第一阶段

在现有 `WorkflowTemplate` 基础上补最小字段：

- `stageOrder`
- `roleAgentIds`
- `approvalMode`

### 11.2 第二阶段

引入：

- `WorkflowTemplateStage`
- `StageGateDefinition`
- `ApprovalRequirement`

### 11.3 第三阶段

将现有 `LifecycleHook` 扩展或包装为阶段 Hook

## 12. 页面与接口建议

### 12.1 管理页

新增“工作流模板”管理区，支持：

- 模板列表
- 模板启停
- 阶段配置
- Gate 配置
- 审批要求配置

### 12.2 任务详情页

新增“工作流阶段”视图，展示：

- 当前阶段
- 阶段状态
- 已执行角色
- Gate 结果
- 审批状态
- 人工接管入口

### 12.3 API 建议

建议后续增加：

- `GET /api/workflow-templates`
- `PUT /api/workflow-templates/:id`
- `GET /api/tasks/:id/workflow`
- `POST /api/tasks/:id/workflow/advance`
- `POST /api/tasks/:id/workflow/approve`
- `POST /api/tasks/:id/workflow/retry-stage`

## 13. 首批验收标准

1. 模板可以表达阶段顺序，而不是只有执行模式。
2. 每个阶段可以绑定主责角色、协作角色、Hook 和 Gate。
3. 命中高风险条件时，工作流可进入 `waiting-approval`。
4. 审批通过、拒绝、回退、重试都能体现在阶段状态机中。
5. 任务详情页可以展示阶段流转与阻塞原因。
6. `implement` 阶段主代码写权限仅授予 `role.developer`。
7. 辅助角色支持多 Agent 实例并行评审，系统可以聚合这些实例的建议与阻断结论。

## 14. 建议的下一步

在本设计确认后，建议继续补三项实现设计：

1. `orchestration-strategy.ts` 的增量类型演进草案。
2. 控制平面 / BFF 的阶段运行记录存储模型设计。
3. 前端任务详情页的阶段视图和模板管理页交互稿。
