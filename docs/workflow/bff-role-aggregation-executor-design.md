# BFF 角色聚合执行器与冲突解析器设计草案

> 适用范围：OpenerX BFF 多实例辅助角色聚合执行
>
> 目标：在现有 BFF 编排、Hook 和任务收口机制上，增加角色聚合执行器与冲突解析器，使安全、QA、架构、运维等辅助角色可以在 BFF 中并行运行多个 Agent 实例，并收敛为统一角色结论与开发者修正请求

## 1. 文档目标

本文档回答以下问题：

- 角色聚合逻辑在 BFF 中应该放在哪里，而不是散落在任务路由和 SSE 收口逻辑中
- 多实例辅助角色如何被调度执行
- 原始实例结果如何标准化、聚合、冲突解析并回写任务状态
- 聚合结论如何转为 `notify-developer`、审批、阻断和前端事件
- 应该按什么顺序落地，避免一次性改坏现有任务执行主路径

相关文档：

- [docs/role-aggregation-conclusion-model.md](role-aggregation-conclusion-model.md)
- [docs/role-agent-registry-design.md](role-agent-registry-design.md)
- [docs/workflow-template-stage-machine-design.md](workflow-template-stage-machine-design.md)
- [docs/development-role-agents-plan.md](../organization/development-role-agents-plan.md)

## 2. 现状与接入边界

当前 BFF 已经具备以下基础能力：

- 通过 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 执行任务启动、模型解析、Hook 触发和执行计划构建
- 通过 [control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks.ts](../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks.ts) 执行单 Agent 生命周期 Hook
- 通过 [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) 处理执行完成、执行后 Hook、并行 candidate 跟踪和最终收口
- 通过 [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](../../control-plane/web-ui-bff/src/lib/orchestration-strategy.ts) 存储编排策略、执行计划和任务 strategy JSON
- 通过 [control-plane/web-ui-bff/src/modules/tasks/finalize.ts](../../control-plane/web-ui-bff/src/modules/tasks/finalize.ts) 更新任务最终状态和执行计划

这意味着：

- 不需要重新发明执行通道，`runDetachedPrompt()` 已经足够作为辅助角色实例的执行底座
- 不应把聚合逻辑继续堆进 `tasks/routes.ts` 或 `sse-aggregator.ts`
- 应该新增独立聚合模块，由任务路由和实时收口在合适时机调用

## 3. 设计目标

本设计的目标如下：

1. 不改变“只有开发者能修改主代码”的主规则。
2. 让辅助角色实例的调度和聚合成为 BFF 的一等能力。
3. 让聚合后的结论可以被任务状态机、审批流和前端视图直接消费。
4. 在第一阶段尽量复用现有 `task.strategy` JSON 落库方式，避免马上引入大量新表。
5. 把冲突处理从自然语言约定提升为代码可执行规则。

## 4. 推荐模块拆分

建议在 BFF 中新增以下模块。

### 4.1 聚合执行器

建议文件：

- `control-plane/web-ui-bff/src/modules/role-aggregation/executor.ts`

职责：

- 根据角色配置解析需要运行的绑定实例
- 并行或顺序执行多个实例
- 收集原始输出并标准化为 `BindingResult`
- 调用冲突解析器和聚合器，生成 `RoleAggregateConclusion`
- 根据聚合结果构建 `DeveloperChangeRequest`

### 4.2 冲突解析器

建议文件：

- `control-plane/web-ui-bff/src/modules/role-aggregation/conflict-resolver.ts`

职责：

- 分析多个 `BindingResult` 之间的决策冲突、风险冲突和证据冲突
- 产出 `AggregateConflict[]`
- 根据策略决定 `merged`、`prefer-higher-risk`、`prefer-majority` 还是 `escalate-human`

### 4.3 结果标准化器

建议文件：

- `control-plane/web-ui-bff/src/modules/role-aggregation/normalizer.ts`

职责：

- 将不同运行时 Agent 的文本结果解析为标准结构
- 补齐 `decision`、`riskLevel`、`findings`、`proposedActions` 等字段
- 对缺失字段做安全保守兜底

### 4.4 策略解析器

建议文件：

- `control-plane/web-ui-bff/src/modules/role-aggregation/policy-resolver.ts`

职责：

- 从角色注册表和工作流模板中解析 `roleExecutionPolicies`
- 决定当前阶段某角色应使用 `single`、`parallel-review` 还是 `round-robin`
- 决定启用哪些 binding，最多运行多少个实例

### 4.5 任务状态回写适配器

建议文件：

- `control-plane/web-ui-bff/src/modules/role-aggregation/task-strategy-store.ts`

职责：

- 将 `BindingResult[]`、`RoleAggregateConclusion[]`、`DeveloperChangeRequest[]` 写入任务 `strategy`
- 封装 `mergeTaskStrategy()` 的聚合字段更新，避免路由层直接拼 JSON

## 5. 推荐接入点

### 5.1 执行前接入

接入位置：

- [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts)

适用角色：

- `role.architect`
- `role.security`
- `role.product`

用途：

- 在任务正式进入主执行前，先对需求、方案和高风险点做辅助角色评审
- 如果聚合结论为 `notify-developer` 或 `block`，则不直接进入主执行

### 5.2 执行后接入

接入位置：

- [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)

适用角色：

- `role.qa`
- `role.security`
- `role.operations`
- `role.architect`

用途：

- 在开发者执行完成后，基于任务结果、代码变更和运行上下文做复核
- 输出修正请求、审批建议或发布阻断信号

### 5.3 发布前 Gate 接入

接入位置：

- 第一阶段可放在 `sse-aggregator.ts` 的任务完成收口和后续发布前逻辑中
- 第二阶段可独立抽到工作流阶段推进器中

适用角色：

- `role.security`
- `role.qa`
- `role.release`
- `role.operations`

## 6. BFF 数据结构增量建议

第一阶段建议继续沿用 `task.strategy` 持久化，先补字段，不急着上新表。

建议在 [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](../../control-plane/web-ui-bff/src/lib/orchestration-strategy.ts) 的 `PersistedTaskStrategy` 中增量加入：

```ts
interface PersistedTaskStrategy {
  selectedTemplateId?: string;
  complexity?: string;
  suggestedAgents?: string[];
  requiresPlan?: boolean;
  confidence?: number;
  selectedAgent?: string;
  effectiveModel?: string;
  executionMode?: ExecutionMode;
  hookExecutions?: HookExecutionRecord[];

  roleBindingResults?: BindingResult[];
  roleAggregateConclusions?: RoleAggregateConclusion[];
  developerChangeRequests?: DeveloperChangeRequest[];
}
```

### 6.1 说明

- `roleBindingResults` 保留原始实例输出，便于审计和排障
- `roleAggregateConclusions` 提供角色层统一结论
- `developerChangeRequests` 提供给开发者的统一待修正项

## 7. 聚合执行器接口建议

```ts
interface ExecuteRoleAggregationOptions {
  taskId: string;
  projectId: string;
  taskTitle: string;
  taskPrompt: string;
  stage: WorkflowStage;
  roleAgentId: string;
  authorization: string;
  context: Record<string, string | undefined | null>;
  repoContext?: {
    repoName?: string;
    remoteUrl?: string;
    workingBranch?: string;
  };
}

interface ExecuteRoleAggregationResult {
  bindingResults: BindingResult[];
  aggregateConclusion: RoleAggregateConclusion;
  developerChangeRequest?: DeveloperChangeRequest;
}

async function executeRoleAggregation(
  options: ExecuteRoleAggregationOptions,
): Promise<ExecuteRoleAggregationResult>;
```

### 7.1 内部执行步骤

建议固定 7 步：

1. 读取角色注册表，解析 `runtimeBindings`、`defaultExecutionMode`、`aggregationPolicy`
2. 读取模板中的 `roleExecutionPolicies`，覆盖默认执行策略
3. 挑选本阶段可用的 bindings
4. 对每个 binding 生成 prompt，并调用 `runDetachedPrompt()`
5. 对结果执行标准化
6. 调用冲突解析器 + 聚合器生成统一结论
7. 回写任务 strategy，并根据结论触发事件或审批动作

## 8. 冲突解析器接口建议

```ts
interface ResolveAggregateConflictsInput {
  roleAgentId: string;
  stage: WorkflowStage;
  strategy: "first-pass" | "majority" | "merge-summary" | "human-review";
  bindingResults: BindingResult[];
}

interface ResolveAggregateConflictsResult {
  conflicts: AggregateConflict[];
  preferredDecision?: AggregateDecision;
  preferredRiskLevel: RiskLevel;
  requiresHumanReview: boolean;
}

function resolveAggregateConflicts(
  input: ResolveAggregateConflictsInput,
): ResolveAggregateConflictsResult;
```

### 8.1 冲突解析规则

建议按顺序执行：

1. 找出 `allow` / `block` / `needs-approval` 等硬冲突
2. 找出相同 finding 的严重级别冲突
3. 找出建议动作冲突
4. 对安全与发布相关角色应用高风险优先
5. 如果仍不可收敛，则标记 `requiresHumanReview=true`

## 9. 结果标准化设计

由于 `runDetachedPrompt()` 当前只返回 `text`，标准化器必须做“文本转结构化对象”工作。

建议策略：

### 9.1 第一阶段

- 要求辅助角色 Agent 按 JSON 模板输出
- BFF 先尝试 `JSON.parse`
- 失败时进入保守降级：
  - `decision = "revise"`
  - `riskLevel = "medium"`
  - `summary = 原始文本摘要`

### 9.2 第二阶段

- 引入更稳定的 schema prompt
- 为不同角色分别定义输出 schema

### 9.3 标准化伪代码

```ts
function normalizeBindingResult(rawText: string, meta: BindingMeta): BindingResult {
  const parsed = tryParseJson(rawText);
  if (parsed) return coerceParsedResult(parsed, meta);

  return {
    roleAgentId: meta.roleAgentId,
    bindingId: meta.bindingId,
    runtimeAgent: meta.runtimeAgent,
    stage: meta.stage,
    summary: summarize(rawText),
    decision: "revise",
    confidence: 0.4,
    riskLevel: "medium",
    findings: [],
    evidence: [{ type: "runtime", summary: "Non-structured output from reviewer agent" }],
    proposedActions: [{ action: "notify-developer", title: "Review output needs manual refinement", detail: summarize(rawText) }],
    generatedAt: new Date().toISOString(),
  };
}
```

## 10. 任务状态回写策略

### 10.1 回写入口

建议封装：

```ts
async function persistRoleAggregationResult(args: {
  authorization: string;
  taskId: string;
  strategyRaw?: string | null;
  bindingResults: BindingResult[];
  aggregateConclusion: RoleAggregateConclusion;
  developerChangeRequest?: DeveloperChangeRequest;
}): Promise<boolean>;
```

### 10.2 回写原则

- 原始实例结果追加写入 `roleBindingResults`
- 同一角色同一阶段只保留最新一条 `roleAggregateConclusion`
- `developerChangeRequests` 按 `requestId` 去重

### 10.3 任务状态映射

| 聚合结论 | 任务/阶段动作 |
| ---- | ---- |
| `allow` | 继续执行 |
| `notify-developer` | 保持当前阶段，等待开发者修正 |
| `needs-approval` | 创建审批并进入等待审批 |
| `block` | 标记阻断 |
| `human-review` | 标记需人工介入 |
| `observe` | 记录观察项，不阻断流程 |

## 11. 实时事件设计

聚合执行器完成后，BFF 应发出统一实时事件，避免前端直接处理底层 binding 细节。

建议新增事件类型：

```ts
type RealtimeEventType =
  | "task.role-review.started"
  | "task.role-review.completed"
  | "task.role-review.conflicted"
  | "task.developer-change-request.created";
```

### 11.1 事件载荷建议

```ts
interface RoleReviewCompletedPayload {
  roleAgentId: string;
  stage: WorkflowStage;
  finalDecision: AggregateDecision;
  aggregateRiskLevel: RiskLevel;
  consensusScore: number;
  blocking: boolean;
  approvalRequired: boolean;
}
```

## 12. 与现有文件的关系

### 12.1 第一阶段尽量不改动的文件

- [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
- [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)

原则：

- 只在这些文件里增加调用聚合执行器的接入点
- 不把聚合规则本身写回这些文件

### 12.2 第一阶段需要演进的文件

- [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](../../control-plane/web-ui-bff/src/lib/orchestration-strategy.ts)
- [control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks.ts](../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks.ts)

原则：

- `orchestration-strategy.ts` 增量增加 persisted strategy 字段
- `lifecycle-hooks.ts` 可抽出与聚合执行器共享的 prompt 渲染和 detached prompt 调用能力

## 13. 落地顺序建议

### 13.1 Phase 1：最小可运行聚合

目标：

- 支持一个角色多个 binding 并行执行
- 支持 `merge-summary` 聚合
- 支持 `notify-developer` 与 `block`
- 将结果写入 `task.strategy`

不做：

- 不做复杂审批联动
- 不做单独数据库表
- 不做通用阶段推进器

### 13.2 Phase 2：审批与工作流联动

目标：

- 让 `needs-approval` 直接触发审批单
- 聚合结论推动阶段状态机变更
- 前端可显示角色冲突与开发者修正请求

### 13.3 Phase 3：持久化与可观测性增强

目标：

- 从 `task.strategy` 迁移到正式表结构
- 增加聚合统计、冲突热区与角色准确率

## 14. 首批验收标准

1. BFF 中存在独立的角色聚合执行器模块，而不是把逻辑散落在路由和 SSE 文件中。
2. 同一辅助角色下的多个 binding 可以被 BFF 并行执行并聚合。
3. 冲突解析器能识别 `allow` / `block` / `needs-approval` 等核心冲突。
4. 聚合结论可以回写任务 strategy，并能产生 `notify-developer` 或阻断动作。
5. 现有开发者主执行路径不被破坏，且仍保持只有开发者可修改主代码。

## 15. 建议的下一步

在本草案确认后，建议继续补两项内容：

1. `orchestration-strategy.ts` 的增量类型草案。
2. 聚合执行器与冲突解析器的 TypeScript 接口文件雏形。
