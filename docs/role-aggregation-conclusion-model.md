# 角色聚合结论模型文档

> 适用范围：OpenerX 多实例辅助角色 Agent 体系
>
> 目标：定义同一角色下多个 Agent 实例的结果如何合并、冲突如何处理、何时升级为人工判断或审批，以及如何向开发者 Agent 输出统一修正请求

## 1. 文档目标

本文档回答以下问题：

- 同一角色下多个 Agent 实例的原始结果如何汇总为单一角色结论
- 不同实例之间出现建议冲突、风险级别冲突、通过/阻断冲突时如何处理
- 哪些情况下可以自动收敛，哪些情况下必须升级到人工或审批
- 聚合结论如何写回工作流状态机，并转化为开发者可执行的修正请求

相关文档：

- [docs/development-role-agents-plan.md](docs/development-role-agents-plan.md)
- [docs/role-agent-registry-design.md](docs/role-agent-registry-design.md)
- [docs/workflow-template-stage-machine-design.md](docs/workflow-template-stage-machine-design.md)
- [docs/approval-standards-management-plan.md](docs/approval-standards-management-plan.md)

## 2. 适用边界

本模型主要用于辅助角色的多实例聚合，包括：

- `role.security`
- `role.architect`
- `role.qa`
- `role.operations`
- 视场景可选：`role.product`
- 视场景可选：`role.release`

本模型默认不用于开发者 Agent 的主代码实现决策。

原因：

- 开发者 Agent 是主代码执行角色，重点是接收修正请求并实施变更
- 辅助角色的价值在于多视角发现问题，不在于直接改代码

## 3. 设计目标

角色聚合结论模型需要同时满足以下要求：

1. 能保留多实例的原始观点，不在聚合时丢失差异。
2. 能生成对工作流和开发者都可消费的单一角色结论。
3. 能明确区分“轻微分歧”和“不可自动收敛的冲突”。
4. 能对高风险结论采取保守策略，避免误放行。
5. 能和现有 `aggregationPolicy`、`notify-developer`、审批与 Gate 机制对齐。

## 4. 核心概念

### 4.1 三层对象

建议明确区分三层：

- `BindingResult`：单个角色实例的原始输出
- `RoleAggregateConclusion`：同一角色聚合后的统一结论
- `DeveloperChangeRequest`：聚合后发给开发者 Agent 的修正请求

### 4.2 聚合不是投票 UI

聚合不是简单统计“几票通过，几票不通过”。

它至少要综合以下因素：

- 风险级别
- 证据强度
- 建议是否可执行
- 是否触发审批标准
- 是否存在不可兼容结论

## 5. 原始结果模型

建议每个实例输出时统一外层结构。

```ts
type RoleBindingDecision =
  | "allow"
  | "warn"
  | "revise"
  | "block"
  | "needs-approval"
  | "observe";

type RiskLevel = "low" | "medium" | "high" | "critical";

interface BindingResult {
  roleAgentId: string;
  bindingId: string;
  runtimeAgent: string;
  stage: WorkflowStage;
  summary: string;
  decision: RoleBindingDecision;
  confidence: number;
  riskLevel: RiskLevel;
  findings: FindingItem[];
  evidence: EvidenceItem[];
  proposedActions: ProposedAction[];
  approvalSignals?: ApprovalSignal[];
  generatedAt: string;
}

interface FindingItem {
  key: string;
  category: string;
  severity: RiskLevel;
  title: string;
  detail: string;
  location?: string;
  dedupeKey?: string;
}

interface EvidenceItem {
  type: "code" | "config" | "test" | "log" | "doc" | "runtime";
  summary: string;
  location?: string;
}

interface ProposedAction {
  action: "notify-developer" | "request-approval" | "block-stage" | "observe-release";
  title: string;
  detail: string;
  ownerRoleAgentId?: string;
}

interface ApprovalSignal {
  standardId?: string;
  reason: string;
  severity: RiskLevel;
}
```

## 6. 聚合输出模型

```ts
type AggregateStatus =
  | "aligned"
  | "partially-aligned"
  | "conflicted"
  | "escalated"
  | "blocked";

type AggregateDecision =
  | "allow"
  | "notify-developer"
  | "needs-approval"
  | "block"
  | "observe"
  | "human-review";

interface RoleAggregateConclusion {
  roleAgentId: string;
  stage: WorkflowStage;
  aggregationStrategy: "first-pass" | "majority" | "merge-summary" | "human-review";
  status: AggregateStatus;
  finalDecision: AggregateDecision;
  aggregateRiskLevel: RiskLevel;
  confidenceScore: number;
  consensusScore: number;
  winningRationale: string;
  mergedFindings: FindingItem[];
  minorityFindings: FindingItem[];
  conflicts: AggregateConflict[];
  approvalRecommendation?: {
    required: boolean;
    reasons: string[];
    standardIds: string[];
  };
  developerChangeRequest?: DeveloperChangeRequest;
  rawBindingIds: string[];
  generatedAt: string;
}

interface AggregateConflict {
  type:
    | "decision-conflict"
    | "risk-conflict"
    | "finding-conflict"
    | "evidence-conflict"
    | "action-conflict";
  severity: RiskLevel;
  summary: string;
  bindingIds: string[];
  resolution: "merged" | "prefer-higher-risk" | "prefer-majority" | "escalate-human";
}

interface DeveloperChangeRequest {
  requestId: string;
  sourceRoleAgentId: string;
  stage: WorkflowStage;
  priority: RiskLevel;
  title: string;
  summary: string;
  requiredChanges: string[];
  relatedFindings: string[];
  blocking: boolean;
  approvalRequired: boolean;
}
```

## 7. 聚合流程

建议固定为 6 步。

### 7.1 标准化

对不同实例输出做字段归一：

- 决策枚举归一
- 风险等级归一
- finding key 和 dedupe key 补齐
- 证据类型归一

### 7.2 去重与分组

按以下维度做合并：

- `dedupeKey`
- `location`
- `category + title`

这样可以把“多个实例发现同一个问题”合成一条主 finding，并提高共识分数。

### 7.3 共识计算

建议同时计算两个分数：

- `confidenceScore`：结论可信度
- `consensusScore`：实例一致性

参考计算方式：

$$
confidenceScore = \frac{\sum (instanceConfidence \times weight)}{\sum weight}
$$

$$
consensusScore = \frac{supportingBindings}{totalBindings}
$$

其中 `weight` 可由实例优先级、证据数量、历史准确率决定。

### 7.4 风险提升

默认采用保守原则：

- 任一实例给出 `critical` 风险时，聚合风险不得低于 `high`
- 任一实例给出 `block`，且证据有效时，聚合结论至少进入人工复核或阻断候选
- 任一实例触发审批信号时，必须进入审批评估分支

### 7.5 冲突识别

重点识别以下冲突：

- 有实例 `allow`，有实例 `block`
- 有实例认为“仅观察”，有实例认为“必须审批`
- 同一 finding 的严重级别差异超过一级
- 对同一问题给出相反修正建议

### 7.6 结论生成

根据聚合策略生成统一结论，并决定：

- 是否推进阶段
- 是否阻断阶段
- 是否通知开发者
- 是否申请审批
- 是否升级人工判断

## 8. 聚合策略定义

### 8.1 `first-pass`

规则：

- 按绑定优先级取第一个有效结果
- 其余结果仅保留为审计参考

适用：

- 低风险、低成本场景
- 产品、视觉等非强治理角色

限制：

- 不适合安全、QA、架构评审主场景

### 8.2 `majority`

规则：

- 以多数实例的决策为主
- 如果少数派给出更高风险结论，则触发风险提升校验

适用：

- QA 回归、运维诊断等可做经验性投票的场景

限制：

- 不应简单覆盖高风险少数意见

### 8.3 `merge-summary`

规则：

- 合并同类 findings
- 保留少数派高风险意见到 `minorityFindings`
- 由系统生成统一结论与开发者修正请求

适用：

- 安全、架构、QA、运维的默认推荐策略

优点：

- 既能保留多视角，又不丢失差异

### 8.4 `human-review`

规则：

- 不自动收敛为最终动作
- 直接升级人工判断或审批

适用：

- 冲突严重
- 风险高且证据相互矛盾
- 对生产发布有直接影响

## 9. 冲突处理规则

### 9.1 决策冲突矩阵

| 冲突组合 | 默认处理 |
| ---- | ---- |
| `allow` vs `warn` | 合并为 `notify-developer` 或 `allow` |
| `allow` vs `revise` | 合并为 `notify-developer` |
| `allow` vs `needs-approval` | 至少进入审批评估 |
| `allow` vs `block` | 标记为重大冲突，至少 `human-review` |
| `revise` vs `block` | 默认 `notify-developer`，高风险时 `block` |
| `needs-approval` vs `block` | 默认 `block` 并触发审批记录 |

### 9.2 风险冲突规则

默认采用高风险优先：

- `critical` 优先于所有其他级别
- `high` 优先于 `medium` / `low`
- 如果高风险实例证据不足，可降为 `human-review`，但不能直接忽略

### 9.3 建议冲突规则

当不同实例对同一问题给出相反建议时：

- 如果都不影响安全与发布，可合并为多选修正建议交给开发者
- 如果建议互斥且影响架构或安全，升级为 `human-review`
- 如果其中一条建议会绕过安全边界，直接淘汰该建议

## 10. 角色特化规则

### 10.1 安全角色

默认策略：

- `merge-summary`

保守规则：

- 任一安全实例输出 `block` 且证据有效，聚合结论不得为 `allow`
- 任一安全实例命中审批标准，必须生成审批建议
- 安全实例之间意见冲突时，优先高风险，并保留少数派意见给开发者和审批人

默认输出：

- `notify-developer`
- `needs-approval`
- `block`

### 10.2 QA 角色

默认策略：

- `majority` 或 `merge-summary`

规则：

- 多个实例发现同一失败时，自动提升优先级
- 只有单个实例发现非阻断问题时，可归入 `minorityFindings`
- 如果关键路径测试一票失败，且有稳定复现证据，可直接 `notify-developer`

### 10.3 架构角色

默认策略：

- `merge-summary`

规则：

- 关注的是边界、兼容性、分层和演进风险，而不是风格性争论
- 风格偏好冲突不应阻断阶段
- 边界破坏、数据模型不兼容、职责下沉错误等问题可进入 `notify-developer` 或 `block`

## 11. 何时升级人工判断

以下情况建议直接进入 `human-review`：

1. 同一角色中同时出现 `allow` 与 `block`，且双方证据都充分。
2. 对生产发布有影响的结论出现结构性冲突。
3. 安全实例之间对是否需要审批存在分歧，且至少一个实例给出 `high` 或 `critical`。
4. QA 实例之间对关键链路是否通过存在分歧，且无法通过自动重跑消解。
5. 架构实例之间对数据模型兼容性结论相反。

## 12. 开发者通知模型

聚合后的辅助角色结论，不应直接把多份原始报告甩给开发者。

应该输出统一的开发者修正请求，至少包括：

- 要修什么
- 为什么要修
- 风险等级
- 是否阻塞当前阶段
- 是否需要审批
- 原始分歧在哪里

建议要求：

- `requiredChanges` 只写开发者可以执行的动作
- `relatedFindings` 指向聚合后的 finding key
- `blocking=true` 时，任务阶段不能自动推进

## 13. 与工作流状态机的衔接

聚合结论与状态机建议映射如下：

| 聚合结论 | 状态机动作 |
| ---- | ---- |
| `allow` | `advance` |
| `notify-developer` | `stay` + `notify-developer` |
| `needs-approval` | `request-approval` + `wait-approval` |
| `block` | `blocked` |
| `human-review` | `escalate-human` |
| `observe` | `advance` 或 `post-release` 挂观察项 |

## 14. 审计与可视化要求

每次聚合应记录：

- 聚合前的 `BindingResult[]`
- 使用的 `aggregationStrategy`
- 冲突列表
- 最终结论
- 是否触发审批
- 是否通知开发者

前端展示时建议三层视图：

1. 角色结论摘要：给普通用户看
2. 聚合说明与冲突详情：给管理员和审批人看
3. 原始实例输出：给排障和审计场景看

## 15. 首批验收标准

1. 同一角色下多个实例的输出可以被统一收敛为单一角色结论。
2. 聚合后仍能追溯原始实例输出，不丢失少数派高风险意见。
3. `allow` / `block` / `needs-approval` 冲突存在明确升级规则。
4. 聚合结论能直接映射为 `notify-developer`、审批或阻断动作。
5. 安全、QA、架构三个角色至少具备特化聚合规则。

## 16. 建议的下一步

在本模型确认后，建议继续补两项实现设计：

1. BFF 侧聚合执行器与冲突解析器设计。
2. 任务详情页中的“角色结论 / 冲突 / 开发者修正请求”视图设计。
