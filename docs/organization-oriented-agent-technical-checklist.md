# 组织架构化 Agent 方案技术清单

> 适用范围：OpenerX 组织架构化 Agent 方案的工程落地
>
> 目标：将协作模式、自动托管等级、老板 Agent、模板中心、阶段推进器、角色聚合器等概念，收敛为可执行的技术实施清单

## 1. 文档目标

本文档回答以下问题：

- 组织架构化方案落地时需要新增或修改哪些核心配置项
- 后端需要抽象哪些策略对象和运行态对象
- BFF、控制平面、前端分别需要增加哪些模块或页面能力
- 协作模式和自动托管等级应该如何编码
- 默认推荐策略如何在系统中表达，而不是只停留在文档描述
- 应该按什么顺序实施，避免一次性改坏现有执行主链

相关文档：

- [docs/organization-oriented-agent-dev-task-list.md](docs/organization-oriented-agent-dev-task-list.md)
- [docs/workflow-template-stage-machine-design.md](docs/workflow-template-stage-machine-design.md)
- [docs/bff-role-aggregation-executor-design.md](docs/bff-role-aggregation-executor-design.md)

## 2. 实施边界

若需要进一步进入研发排期层，可继续参考按 BFF、控制平面、前端、数据结构、测试五类拆分的开发任务清单：

- [docs/organization-oriented-agent-dev-task-list.md](docs/organization-oriented-agent-dev-task-list.md)

本轮技术清单的目标不是重写全部任务执行链路，而是以“增量接入”的方式补齐以下能力：

1. 协作模式可配置
2. 自动托管等级可配置
3. 老板 Agent 可配置启用
4. 模板可表达单兵模式、组织化协作模式和混合模式
5. 阶段推进与角色聚合可逐步接入，而不是一次性替换现有任务主链

默认原则：

- 尽量复用现有 `orchestration-strategy`、`workflow templates`、`task.strategy`、`hooks`、`sse-aggregator`
- 第一阶段优先以 BFF 编排增强和前端可视化为主
- 第一阶段避免引入过多新表，优先落在现有 JSON 和模板结构中
- 前端默认采用“新增页面 / 新路由承载”策略，尽量不直接重构现有主页面
- 现有页面只承担最小入口挂接职责，例如跳转入口、摘要入口、详情入口

## 3. 核心技术对象

### 3.1 协作模式

建议定义如下枚举：

```ts
type CollaborationMode = "solo" | "team" | "hybrid";
```

语义：

- `solo`：单兵模式
- `team`：组织化协作模式
- `hybrid`：混合模式

### 3.2 自动托管等级

建议定义如下枚举：

```ts
type AutopilotLevel = "L0" | "L1" | "L2";
```

语义：

- `L0`：手动监督
- `L1`：半自动经营
- `L2`：全自动托管

### 3.3 老板参与模式

建议在运行态中显式表达老板参与强度，而不是仅靠协作模式推导：

```ts
type BossParticipationMode =
  | "disabled"
  | "advisory"
  | "exception-only"
  | "full-manager";
```

语义：

- `disabled`：老板不参与
- `advisory`：老板只给建议
- `exception-only`：老板只在异常、高风险和审批场景介入
- `full-manager`：老板负责项目经营与阶段推进

### 3.4 推荐策略对象

建议增加统一的推荐策略对象，用于把文档中的“推荐使用场景表”落为系统规则：

```ts
interface RecommendedOperatingProfile {
  scenarioKey: string;
  collaborationMode: CollaborationMode;
  autopilotLevel: AutopilotLevel;
  bossParticipationMode: BossParticipationMode;
  templateHints?: string[];
  requiredRoleHints?: string[];
  reason: string;
}
```

### 3.5 项目运行档位对象

建议在项目或任务运行时有一个统一的“运行档位”对象：

```ts
interface OperatingModeSelection {
  collaborationMode: CollaborationMode;
  autopilotLevel: AutopilotLevel;
  bossParticipationMode: BossParticipationMode;
  selectedTemplateId?: string | null;
  source: "system-default" | "project-default" | "task-override" | "boss-decision";
}
```

## 4. 配置项清单

### 4.1 平台级配置

建议在系统级治理配置中新增以下字段：

```ts
interface PlatformOrganizationSettings {
  defaultCollaborationMode: CollaborationMode;
  defaultAutopilotLevel: AutopilotLevel;
  defaultBossParticipationMode: BossParticipationMode;
  allowProjectModeOverride: boolean;
  allowTaskModeOverride: boolean;
  requireHumanApprovalForL2: boolean;
  hybridEscalationRules: HybridEscalationRule[];
  recommendedProfiles: RecommendedOperatingProfile[];
}
```

建议放置位置：

- 第一阶段：并入现有 `orchestration-strategy.json`
- 第二阶段：可视情况拆到独立配置对象

### 4.2 项目级配置

建议在项目设置中增加以下字段：

```ts
interface ProjectOrganizationSettings {
  collaborationMode?: CollaborationMode;
  autopilotLevel?: AutopilotLevel;
  bossParticipationMode?: BossParticipationMode;
  preferredTemplateId?: string | null;
  allowBossAutoTemplateSwitch?: boolean;
  allowHybridEscalation?: boolean;
}
```

说明：

- 项目级配置优先于平台默认
- 但不能越过平台红线，例如被平台禁用的 `L2` 不能在项目层单独打开

### 4.3 任务级覆盖配置

建议在任务创建时允许带入以下可选覆盖：

```ts
interface TaskOperatingModeOverride {
  collaborationMode?: CollaborationMode;
  autopilotLevel?: AutopilotLevel;
  bossParticipationMode?: BossParticipationMode;
  preferredTemplateId?: string;
}
```

说明：

- 适用于特殊任务临时切换模式
- 需受平台与项目权限约束

## 5. 后端策略对象清单

### 5.1 编排策略对象扩展

建议扩展 [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](control-plane/web-ui-bff/src/lib/orchestration-strategy.ts)：

```ts
interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  hooks: LifecycleHook[];
  templates: WorkflowTemplate[];
  judge: JudgeConfig;

  organizationSettings?: PlatformOrganizationSettings;
  categoryTemplateMap?: Record<string, string[]>;
}
```

### 5.2 任务运行态对象扩展

建议扩展 `PersistedTaskStrategy`：

```ts
interface PersistedTaskStrategy {
  selectedTemplateId?: string;
  workflowTemplateId?: string | null;
  complexity?: string;
  suggestedAgents?: string[];
  requiresPlan?: boolean;
  confidence?: number;
  selectedAgent?: string;
  effectiveModel?: string;
  executionMode?: ExecutionMode;
  hookExecutions?: HookExecutionRecord[];

  collaborationMode?: CollaborationMode;
  autopilotLevel?: AutopilotLevel;
  bossParticipationMode?: BossParticipationMode;
  operatingModeSource?: OperatingModeSelection["source"];

  currentStageKey?: string;
  currentStageStatus?: string;
  bossDecisions?: BossDecisionRecord[];
  escalationRequests?: HumanEscalationRequest[];

  roleBindingResults?: BindingResult[];
  roleAggregateConclusions?: RoleAggregateConclusion[];
  developerChangeRequests?: DeveloperChangeRequest[];
}
```

### 5.3 老板决策对象

建议定义：

```ts
interface BossDecisionRecord {
  id: string;
  ts: string;
  decisionType:
    | "accept-task"
    | "request-clarification"
    | "select-template"
    | "form-team"
    | "advance-stage"
    | "hold-stage"
    | "request-revision"
    | "request-approval"
    | "pause-project"
    | "rollback-stage"
    | "complete-project"
    | "escalate-human";
  reason: string;
  confidence?: number;
  stageKey?: string;
  relatedRoleIds?: string[];
  requiresHumanConfirmation?: boolean;
}
```

### 5.4 升级请求对象

建议定义：

```ts
interface HumanEscalationRequest {
  id: string;
  ts: string;
  reasonCode:
    | "policy-conflict"
    | "security-redline"
    | "approval-required"
    | "low-confidence"
    | "budget-limit"
    | "cross-role-conflict";
  summary: string;
  stageKey?: string;
  status: "open" | "resolved" | "dismissed";
}
```

## 6. 模块改造清单

### 6.1 BFF 编排层

建议新增模块：

- `control-plane/web-ui-bff/src/modules/operating-mode/profile-resolver.ts`
- `control-plane/web-ui-bff/src/modules/operating-mode/recommendation-engine.ts`
- `control-plane/web-ui-bff/src/modules/boss-agent/decision-engine.ts`
- `control-plane/web-ui-bff/src/modules/boss-agent/context-builder.ts`
- `control-plane/web-ui-bff/src/modules/boss-agent/escalation-policy.ts`
- `control-plane/web-ui-bff/src/modules/workflow-runtime/stage-runner.ts`
- `control-plane/web-ui-bff/src/modules/workflow-runtime/stage-status-store.ts`
- `control-plane/web-ui-bff/src/modules/workflow-runtime/stage-gate-evaluator.ts`

### 6.2 角色聚合层

延续现有建议，保持独立模块：

- `control-plane/web-ui-bff/src/modules/role-aggregation/executor.ts`
- `control-plane/web-ui-bff/src/modules/role-aggregation/normalizer.ts`
- `control-plane/web-ui-bff/src/modules/role-aggregation/conflict-resolver.ts`
- `control-plane/web-ui-bff/src/modules/role-aggregation/policy-resolver.ts`
- `control-plane/web-ui-bff/src/modules/role-aggregation/task-strategy-store.ts`

### 6.3 任务执行主链接入点

建议修改位置：

- [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts)
- [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)

建议接入顺序：

1. 创建任务后先解析 `OperatingModeSelection`
2. 根据 `collaborationMode` 决定是否启用老板 Agent 和阶段推进器
3. 根据 `bossParticipationMode` 决定老板是全程参与、异常参与还是禁用
4. 根据 `autopilotLevel` 决定是否自动应用老板决策或等待人工确认

## 7. 前端页面改造清单

### 7.1 设置页

建议在现有治理设置页中新增“组织运行策略”区块，至少包含：

- 默认协作模式
- 默认自动托管等级
- 默认老板参与模式
- 是否允许项目覆盖
- 是否允许任务覆盖
- 混合模式触发条件配置
- 推荐使用场景表预览

### 7.2 项目编排页

建议在项目编排页增加：

- 当前协作模式
- 当前自动托管等级
- 当前老板参与方式
- 当前模板来源：平台默认 / 项目绑定 / 老板切换 / 任务覆盖
- 推荐组合说明

### 7.3 任务详情页

建议增加：

- 当前运行档位卡片
- 老板最近决策卡片
- 当前阶段卡片
- 是否触发人类升级
- 当前是否处于单兵 / 团队 / 混合切换状态

## 8. 默认推荐策略编码

建议将文档中的“推荐使用场景表”编码成配置数据，而不是写死在前端文案里。

### 8.1 场景键建议

```ts
type RecommendedScenarioKey =
  | "small-task"
  | "cross-system-refactor"
  | "production-release"
  | "security-fix";
```

### 8.2 默认配置示例

```ts
const DEFAULT_RECOMMENDED_PROFILES: RecommendedOperatingProfile[] = [
  {
    scenarioKey: "small-task",
    collaborationMode: "solo",
    autopilotLevel: "L1",
    bossParticipationMode: "exception-only",
    reason: "小任务优先效率，默认只在异常和高风险时引入老板建议。",
  },
  {
    scenarioKey: "cross-system-refactor",
    collaborationMode: "team",
    autopilotLevel: "L1",
    bossParticipationMode: "full-manager",
    reason: "跨系统改造需要架构、开发、测试和运维共同参与。",
  },
  {
    scenarioKey: "production-release",
    collaborationMode: "hybrid",
    autopilotLevel: "L0",
    bossParticipationMode: "exception-only",
    reason: "生产发布前期追求效率，进入发布阶段后加强治理与人工确认。",
  },
  {
    scenarioKey: "security-fix",
    collaborationMode: "team",
    autopilotLevel: "L0",
    bossParticipationMode: "full-manager",
    reason: "安全修复需要安全、架构、开发和测试共同参与，并保留人工把关。",
  },
];
```

### 8.3 混合模式触发规则编码

建议定义：

```ts
interface HybridEscalationRule {
  id: string;
  enabled: boolean;
  conditionType:
    | "risk-level"
    | "template-tag"
    | "stage-key"
    | "task-category"
    | "project-label";
  operator: "eq" | "in" | "gte";
  value: string | string[] | number;
  escalateToMode: CollaborationMode;
  escalateBossParticipationMode: BossParticipationMode;
}
```

## 9. 接口清单

### 9.1 配置接口

建议增加或扩展：

- `GET /api/config/organization-settings`
- `PUT /api/config/organization-settings`
- `GET /api/config/recommended-operating-profiles`

### 9.2 项目接口

建议增加或扩展：

- `GET /api/projects/:projectId/organization-settings`
- `PUT /api/projects/:projectId/organization-settings`
- `GET /api/projects/:projectId/orchestration-view` 返回当前运行档位字段

### 9.3 任务接口

建议增加或扩展：

- 创建任务时允许传 `operatingModeOverride`
- `GET /api/tasks/:taskId` 返回 `collaborationMode`、`autopilotLevel`、`bossParticipationMode`
- `GET /api/tasks/:taskId/boss-decisions`
- `GET /api/tasks/:taskId/escalations`

## 10. 实施顺序建议

### Phase 1

目标：先把概念落成可配置对象与页面显示。

建议完成：

- 协作模式与自动托管等级枚举
- 平台级 / 项目级 / 任务级配置结构
- 推荐策略配置对象
- 项目编排页和任务详情页展示当前运行档位

### Phase 2

目标：把老板 Agent 真正接入执行主链。

建议完成：

- `OperatingModeSelection` 解析器
- 老板决策引擎 MVP
- `PersistedTaskStrategy` 扩展
- 人类升级请求对象

### Phase 3

目标：把阶段推进与角色聚合接成闭环。

建议完成：

- 阶段推进器
- 角色聚合器
- 混合模式自动切换规则
- 审批与阻断联动

## 11. 验收标准

1. 系统中可以显式配置协作模式和自动托管等级，而不是靠隐式规则推导。
2. 项目和任务都能看出当前运行档位及其来源。
3. 推荐使用场景表已被编码为系统策略对象，而不是只存在于文档中。
4. 老板 Agent 是否参与、以什么强度参与、何时升级给人类，都有结构化表达。
5. 单兵模式、组织化协作模式和混合模式都能在任务主链中被正确解释和执行。

## 12. 总结

组织架构化方案要真正落地，关键不是再写更多概念文档，而是把以下几点编码进系统：

- 协作模式
- 自动托管等级
- 老板参与方式
- 推荐使用场景
- 运行态来源与升级规则

只要这五类对象被稳定表达出来，后续老板 Agent、阶段推进器、角色聚合器和前端治理视图就都有一致的工程落点。
