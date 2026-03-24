# 运行流水线（Runtime Pipeline）升级方案

> 适用范围：OpenerX 控制平面 — 任务运行可观测性与流水线引擎升级
> 目标：将当前"消息回溯式规划摘要"升级为"分支感知、事件驱动的运行流水线"，在 UI 上呈现"计划步骤 → 运行节点 → 输出结果"的完整映射
> 状态说明：本文档中涉及旧版图模型兼容层的设计已经过时。
> 当前实现已移除独立 DAG 兼容层；并且 runtime pipeline 主路径已经不再读取 `tasks.executionPlan` / `parallelRunHistory`。并行任务以 task domain runs 为主数据源，规划阶段仅作为补充展示层。阅读本文件时，请以 [docs/dag-node-execution-plan-v2.md](docs/dag-node-execution-plan-v2.md) 的清理结论为准。

## 1. 文档目标

本文档回答以下问题：

- 当前 pipeline 面板的技术限制是什么
- 运行流水线的目标模型是什么
- 数据模型、API、BFF、前端分别需要做哪些变更
- 分哪几个阶段推进，每阶段交付什么
- 与现有 RuntimePlan / session 机制怎样复用与对齐

## 2. 现状分析

### 2.1 当前 pipeline 面板做了什么

| 维度 | 实现 | 位置 |
| ---- | ---- | ---- |
| 数据来源 | 读取 task 主 sessionId 的消息历史，过滤 3 个硬编码 agent 的最后一条回复 | `web-ui-bff/.../tasks/routes.ts` GET `/:taskId/pipeline` |
| Agent 列表 | 硬编码 `["prometheus-enterprise", "metis-enterprise", "momus-enterprise"]` | 同上 |
| 状态推断 | 有消息 → completed/running，无消息 → pending | 同上 |
| 刷新时机 | 前端收到 `task.continued` 事件时全量重新拉取 | `TaskDetail.vue` `scheduleTaskRefresh` |
| 分支感知 | 无 — 始终读 task 创建时的 sessionId，不跟随用户切换的活跃分支 | 同上 |
| 与 RuntimePlan 关系 | 历史版本曾与 RuntimePlan 独立；当前实现优先消费 task domain runs、hook 执行记录与 planning messages，不再依赖 `tasks.executionPlan` | — |

### 2.2 核心问题

1. **静态快照而非运行态**：只反映任务首次规划阶段的 3 个 agent 输出，后续追问不更新也不新增步骤。
2. **不感知分支**：用户 fork 到新分支后，pipeline 仍然读 root session 的消息。
3. **历史痛点：不消费已有编排数据**：早期 pipeline 端点曾完全绕过编排与运行数据，只能回看 planning messages；当前实现已经改为优先聚合 task domain runs、hookExecutions 与 lineage。
4. **无增量更新**：前端只在 `task.continued` 时做全量 HTTP 拉取，没有事件驱动增量推送。

### 2.3 可复用的基础设施

| 基础设施 | 当前状态 | 复用方式 |
| -------- | -------- | -------- |
| `RuntimePlan` 数据模型 | 历史设计中包含 steps + candidates + dependsOn + judgeResult，并曾通过 `tasks.executionPlan` 承载 | 保留为方案语境；当前 runtime pipeline 主路径不再把它当核心数据源 |
| `PersistedTaskStrategy` | hookExecutions 追加记录，已持久化到 `tasks.strategy` JSON 字段 | 作为 hook 阶段数据源 |
| SSE 事件体系 | `agent.started`, `task.completed`, `task.continued`, `task.hooks.updated` 等 | 作为增量推送通道 |
| session lineage | 通过 `/api/tasks/:taskId/branches*` 路由暴露的 root/fork/sub_session 血统，底层由 project-tree/session 节点承载 | 作为分支感知的数据依据 |
| `mergeTaskStrategy()` | 追加 hookExecutions 到 strategy JSON | 复用追加逻辑扩展到 pipeline steps |

## 3. 目标模型

### 3.1 概念定义

**运行流水线（Runtime Pipeline）** 是一个分支感知、事件驱动的执行进度视图。它将任务的 RuntimePlan、hook 执行记录和实时 SSE 事件统一投射到一条有序的阶段序列上，让用户在 UI 上看到"当前分支正在执行到哪一步"。

它不是独立的 DAG 执行引擎（这部分由 OpenCode Runtime + SSE Aggregator 承担），而是一个**聚合视图层**，从多个已有数据源计算出统一的流水线状态。

### 3.2 数据模型

```text
RuntimePipeline {
  taskId: string
  sessionId: string          // 当前分支的 session
  branchName: string | null  // 当前分支名
  status: "idle" | "running" | "completed" | "failed" | "paused"
  createdAt: string
  updatedAt: string          // 最后一次状态变更时间

  stages: RuntimePipelineStage[]
  summary: PipelineSummary
}

RuntimePipelineStage {
  id: string                 // 全局唯一，如 "hook:pre-execution:0" 或 "exec:candidate:1"
  type: "hook" | "planning" | "execution" | "judge" | "post-hook"
  label: string              // UI 显示名
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  order: number              // 排序序号

  // 关联引用
  sourceType: "runtimePlan.step" | "strategy.hookExecution" | "session.message"
  sourceId: string | null    // 对应 step.id / hookExecution.hookId / messageId

  // 执行详情
  agent: string | null
  model: string | null
  sessionId: string | null   // 执行该步骤的 session
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null

  // 输出
  output: string | null      // 截断到 2000 字符
  error: string | null

  // 成本
  tokens: { input: number; output: number } | null
  dependsOn: string[]         // 依赖的 stage id 列表
}

PipelineSummary {
  totalStages: number
  completedStages: number
  failedStages: number
  currentStageId: string | null   // 正在运行的 stage
  totalTokens: { input: number; output: number }
  totalDurationMs: number
  replanCount: number             // 重规划次数（新增步骤或跳过步骤的次数）
}
```

### 3.3 与现有模型的映射关系

```text
RuntimePlan.steps → RuntimePipelineStage（type = step.type）
RuntimePlan.candidates → RuntimePipelineStage（type = "execution"，一个 candidate 一个 stage）
PersistedTaskStrategy.hookExecutions → RuntimePipelineStage（type = "hook" 或 "post-hook"）
Session messages（规划 agent） → RuntimePipelineStage（type = "planning"，保留向后兼容）
```

映射优先级：RuntimePlan > hookExecutions > session messages。当多个来源指向同一逻辑步骤时，以 RuntimePlan 的步骤为锚点，其余合并到同一 stage。

### 3.4 分支感知逻辑

```text
1. 前端传入 sessionId（当前活跃分支的 session）
2. BFF 根据 sessionId 从 `/api/tasks/:taskId/branches*` lineage 视图确认属于该 task
3. 若 task 为并行运行，读取 task domain runs / domain run detail，按候选与 judge 节点构造 execution/judge stages
4. 读该 session 的消息历史用于填充 planning stage
5. 汇总 hook 执行记录
  a. Phase 1-3：hookExecutions 仍按 task 级记录展示，不承诺严格 session 隔离
  b. 更严格的 session 级 hook 过滤仅保留为历史高级扩展设想，不属于当前主路径范围
6. 计算 stages 排序和状态
```

### 3.5 增量更新通道

不再依赖全量 HTTP 拉取，改为事件驱动 + 增量补丁：

| 事件 | 前端动作 |
| ---- | -------- |
| `agent.started` | 标记 execution stage → running |
| `task.hooks.updated` | 追加或更新 hook stage |
| `task.completed` / `agent.completed` | 标记 execution stage → completed，触发全量刷新确保一致性 |
| `task.continued` | 触发当前分支流水线重算或刷新；是否新增 execution stage 取决于是否进入重规划能力 |
| `session.activated` | 切换 pipeline 到新分支的 session，全量刷新 |
| `session.idle` | 推进 execution stage → completed |
| `session.error` | 标记当前 running stage → failed |
| **新增** `pipeline.stage.updated` | BFF 计算出 stage 变化后推送增量 patch |

增量推送格式：

```typescript
// pipeline.stage.updated 事件 data
{
  taskId: string
  sessionId: string
  patch: {
    type: "upsert" | "remove"
    stage: RuntimePipelineStage  // upsert 时携带完整 stage
    stageId: string              // remove 时只需 id
  }
  summary: PipelineSummary       // 始终携带最新 summary
}
```

## 4. API 变更

### 4.1 BFF — 升级现有 pipeline 端点

```http
GET /tasks/:taskId/pipeline?sessionId=<optional>
```

**变更要点**：

- 新增可选 `sessionId` 查询参数。不传时使用 task 当前活跃 sessionId。
- 响应在保留 `stages` 语义的基础上扩展为 `RuntimePipeline` 完整结构。
- 向后兼容：旧客户端如果只读取 `stages` 字段，不会因新增元数据字段而中断。

**实现逻辑（BFF 侧，不新增 service 端点）**：

```typescript
async function buildRuntimePipeline(taskId: string, sessionId?: string): Promise<RuntimePipeline> {
  // 1. 获取 task 记录
  const task = await getTask(taskId)

  // 2. 确定目标 session
  const targetSessionId = sessionId || task.sessionId
  const lineage = await getTaskSessionLineage(taskId)
  const sessionRecord = lineage.find(r => r.runtimeSessionId === targetSessionId)

  // 3. 读取策略与并行运行明细
  const strategy: PersistedTaskStrategy | null = task.strategy ? JSON.parse(task.strategy) : null
  const parallelRunDetail = task.orchestrationKind === "parallel"
    ? await loadParallelDomainRunDetail(task.id)
    : null

  // 4. 获取 session 消息用于 planning stages
  const messages = await getSessionMessages(targetSessionId)

  // 6. 组装 stages
  const stages: RuntimePipelineStage[] = []
  let order = 0

  // 6a. Pre-execution hooks
  if (strategy?.hookExecutions) {
    for (const he of strategy.hookExecutions.filter(h => h.trigger === "pre-execution")) {
      stages.push(hookExecutionToStage(he, order++))
    }
  }

  // 6b. Planning stages（向后兼容现有 3 agent 提取逻辑）
  for (const agentName of PIPELINE_AGENTS) {
    const agentMessages = filterAgentMessages(messages, agentName)
    if (agentMessages.length > 0) {
      stages.push(planningMessageToStage(agentName, agentMessages, order++))
    }
  }

  // 6c. Execution steps（优先从 task domain runs / judge detail）
  if (parallelRunDetail) {
    for (const stage of domainRunDetailToStages(parallelRunDetail)) {
      if (step.type === "hook") {
        stages.push(planHookStepToStage(step, order++))
      } else if (step.type === "execution") {
        for (const candidate of plan.candidates) {
          stages.push(candidateToStage(candidate, step, order++))
        }
      } else if (step.type === "judge") {
        stages.push(judgeStepToStage(step, plan.judgeResult, order++))
      }
    }
  }

  // 6d. Graph nodes（补充不在 RuntimePlan 中的独立 DAG 节点）
  for (const node of sessionNodes) {
    if (!stages.some(s => s.graphNodeId === node.id)) {
      stages.push(graphNodeToStage(node, order++))
    }
  }

  // 6e. Post-execution hooks
  if (strategy?.hookExecutions) {
    for (const he of strategy.hookExecutions.filter(h => h.trigger === "post-execution")) {
      stages.push(hookExecutionToStage(he, order++))
    }
  }

  // 7. 对齐 graph nodes → stages（双向关联）
  alignGraphNodesToStages(stages, sessionNodes)

  // 8. 计算 summary
  const summary = computePipelineSummary(stages)

  return {
    taskId,
    sessionId: targetSessionId,
    branchName: sessionRecord?.branchName ?? null,
    status: derivePipelineStatus(task.status, stages),
    createdAt: task.createdAt,
    updatedAt: new Date().toISOString(),
    stages,
    summary,
  }
}
```

### 4.2 BFF — 增量事件推送

在 `sse-aggregator.ts` 中，每次已有事件触发 task 状态变更后，额外计算 pipeline stage diff 并广播：

```typescript
// 在运行结束、hook 完成或阶段状态刷新后调用
async function emitPipelineStagePatch(taskId: string, sessionId: string, changedStage: RuntimePipelineStage) {
  const summary = await computeQuickSummary(taskId, sessionId)
  broadcastToTask(taskId, {
    type: "pipeline.stage.updated",
    data: {
      taskId,
      sessionId,
      patch: { type: "upsert", stage: changedStage },
      summary,
    },
  })
}
```

### 4.3 Service 层 — Phase 1-3 无新增端点

运行流水线在 Phase 1-3 保持为 BFF 聚合视图，不在 service 层新建表或端点。当前现有数据源以 task domain runs、兼容 lineage 路由、hook 执行记录和任务图数据为主；`tasks.executionPlan` 已不再是正式输入。历史上关于“分支级 plan 快照”或额外专用表的设想，当前统一视为高级扩展背景，不作为默认落地方向。

### 4.4 前端 — 新增 API 调用

```typescript
// api.ts
export function getTaskRuntimePipeline(taskId: string, sessionId?: string) {
  return get<RuntimePipeline>(`/tasks/${taskId}/pipeline`, { params: { sessionId } })
}
```

## 5. 前端变更

### 5.1 Pipeline 面板升级

将 `TaskDetail.vue` 中的 `pipelineStages` 从简单的 `PipelineStage[]` 替换为完整的 `RuntimePipeline` 对象。

**状态管理**：

```typescript
const runtimePipeline = ref<RuntimePipeline | null>(null)

// 当前步骤（正在运行的 stage）
const pipelineCurrentStage = computed(() =>
  runtimePipeline.value?.stages.find(s => s.status === "running") ?? null
)

// 进度百分比
const pipelineProgress = computed(() => {
  if (!runtimePipeline.value) return 0
  const { totalStages, completedStages } = runtimePipeline.value.summary
  return totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0
})
```

**刷新策略**：

```typescript
// 全量刷新 — 分支切换、任务完成时
async function refreshPipeline(sessionId?: string) {
  const sid = sessionId || activeSessionId.value
  if (!sid) return
  runtimePipeline.value = await getTaskRuntimePipeline(taskId, sid)
}

// 增量更新 — pipeline.stage.updated 事件
function handlePipelineStagePatch(event: RealtimeEvent) {
  if (!runtimePipeline.value) return
  const { patch, summary } = event.data
  if (patch.type === "upsert") {
    const idx = runtimePipeline.value.stages.findIndex(s => s.id === patch.stage.id)
    if (idx >= 0) {
      runtimePipeline.value.stages[idx] = patch.stage
    } else {
      // 按 order 插入
      const insertIdx = runtimePipeline.value.stages.findIndex(s => s.order > patch.stage.order)
      if (insertIdx >= 0) {
        runtimePipeline.value.stages.splice(insertIdx, 0, patch.stage)
      } else {
        runtimePipeline.value.stages.push(patch.stage)
      }
    }
  } else if (patch.type === "remove") {
    runtimePipeline.value.stages = runtimePipeline.value.stages.filter(s => s.id !== patch.stageId)
  }
  runtimePipeline.value.summary = summary
}
```

**分支切换联动**：

```typescript
// 监听 session.activated 事件或用户在 SessionTree 中切换分支
watch(activeSessionId, (newSid) => {
  if (newSid) refreshPipeline(newSid)
})
```

### 5.2 UI 设计

当前 `<a-steps>` 垂直展示保留，但扩展为：

```text
┌────────────────────────────────────────────┐
│ 运行流水线                    分支: main ▼  │
│ 进度: 3/5 (60%)         耗时: 2m 34s       │
├────────────────────────────────────────────┤
│ ● Pre-Hook: 凭证检查          ✓ 0.2s       │
│ ● 规划: prometheus             ✓ 1.1s 820t  │
│ ● 规划: metis                  ✓ 0.8s 610t  │
│ ◉ 执行: build agent           ⟳ 运行中...   │
│   ├─ DAG: 代码分析             ✓             │
│   ├─ DAG: 编写实现             ⟳ 运行中      │
│   └─ DAG: 单元测试              ○ 待执行     │
│ ○ Post-Hook: 代码审查           ○ 待执行     │
├────────────────────────────────────────────┤
│ Token: 入 3,240 / 出 1,870    成本: $0.08  │
└────────────────────────────────────────────┘
```

**关键 UI 交互**：

| 交互 | 行为 |
| ---- | ---- |
| 点击任意 stage | 展开详情：output 预览、token、耗时、agent、model |
| 点击 stage | 展开详情：output 预览、token、耗时、agent、model |
| 分支下拉切换 | 调用 `refreshPipeline(newSessionId)`，切换视图 |
| Stage 状态为 failed | 红色标记 + 展开 error 信息 |
| 续问后新增步骤 | 插入新 stage 并标记"重规划"标签 |

## 6. 分阶段交付计划

> 历史注记：本节保留最初的 phase 切分，用于解释设计推进顺序。
> 其中 Phase 1-2 的核心能力已经进入当前实现；Phase 3-4 更适合作为历史扩展方向参考，而不是当前默认排期。

### Phase 1：数据源统一 + 分支感知（历史基础层）

**目标**：pipeline 端点从 RuntimePlan + strategy + graph 读取真实数据，支持 sessionId 参数，先实现“同一 RuntimePlan 在不同分支下的运行视图”。

**变更清单**：

| 层 | 文件 | 变更 |
| -- | ---- | ---- |
| BFF | `modules/tasks/routes.ts` | 重写 `GET /:taskId/pipeline`，接受 `sessionId` 参数，实现 `buildRuntimePipeline()` |
| BFF | `lib/runtime-pipeline.ts`（新建） | 提取 pipeline 聚合逻辑：`buildRuntimePipeline()`、stage 转换函数、summary 计算 |
| 前端 | `lib/api.ts` | 更新 `getTaskPipeline` 签名，透传 sessionId |
| 前端 | `pages/TaskDetail.vue` | `pipelineStages` → `runtimePipeline`，分支切换时重新拉取 |
| 前端 | `types/pipeline.ts`（新建） | `RuntimePipeline`、`RuntimePipelineStage`、`PipelineSummary` 类型定义 |

**验收标准**：

- Pipeline 面板显示 RuntimePlan 的实际步骤（hook / execution / judge）而非硬编码 3 agent
- 切换分支后 pipeline 至少切换到对应分支的消息、graph 节点和当前 session 视角
- Phase 1 不要求不同分支拥有独立 RuntimePlan
- 向后兼容：旧客户端继续读取 `stages` 字段不受影响

### Phase 2：增量事件推送 + 实时状态（历史实时层）

**目标**：pipeline stage 状态通过 SSE 事件增量更新，降低对全量 HTTP 拉取的依赖。

**变更清单**：

| 层 | 文件 | 变更 |
| -- | ---- | ---- |
| BFF | `modules/realtime/sse-aggregator.ts` | 在 `maybeFinalizeRun()`、hook 完成后调用 `emitPipelineStagePatch()` |
| BFF | `lib/runtime-pipeline.ts` | 新增 `computeStageDiff()`，对比前后 stage 状态 |
| 前端 | `pages/TaskDetail.vue` | 监听 `pipeline.stage.updated` 事件，增量 patch `runtimePipeline` |
| 前端 | `stores/realtime.ts` | 注册 `pipeline.stage.updated` 事件类型 |

**验收标准**：

- 任务执行中，pipeline 面板 stage 状态实时推进（pending → running → completed）
- 不再出现"pipeline 从不更新"的感觉
- Hook 执行结果实时追加到 pipeline
- `task.continued` 在 Phase 2 只要求触发刷新，不要求自动生成新的 plan/stage

### Phase 3：续问重规划 + 差异对比（历史扩展方向）

**目标**：用户续问后，pipeline 能展示新增/跳过/失效的步骤，并可对比初始计划。

**变更清单**：

| 层 | 文件 | 变更 |
| -- | ---- | ---- |
| BFF | `modules/tasks/routes.ts` | `POST /:taskId/continue` 中调用 `evaluateReplan()` 检测新消息是否改变了 plan |
| BFF | `lib/runtime-pipeline.ts` | `evaluateReplan()`：对比 continue 前后 stage 列表，标记 `added` / `skipped` / `invalidated` |
| BFF | `lib/runtime-pipeline.ts` | `GET /:taskId/pipeline/diff?baseSessionId=&targetSessionId=`（新端点）返回两条 pipeline 的差异 |
| 前端 | `pages/TaskDetail.vue` | 重规划后 stage 显示变更标签（🆕 新增 / ⏭️ 跳过 / ❌ 失效） |
| 前端 | 新组件 `PipelineDiff.vue` | 初始计划 vs 当前执行路径的并排对比视图 |

**验收标准**：

- 续问后 pipeline 中新增步骤标记可见
- Diff 视图可展示"原计划步骤 A→B→C" vs "实际路径 A→B→D→E"

### Phase 4：人工干预 + 成本分析 + 异常诊断（历史高级扩展）

状态注记：本阶段保留为历史高级扩展草案，不再展开为当前待实施清单。其原始范围主要包括三类方向：

1. 让 pipeline 从“观测面”继续向“控制面”延伸，例如单 stage 的暂停、重跑、跳过或 agent 替换。
2. 补充 stage 级成本与失败诊断视图，例如 token、耗时、成功率、hook/agent/依赖失败点。
3. 支持分支间 pipeline 对比或更细粒度的重规划差异展示。

按当前仓库状态，这些内容都应视为历史扩展背景，而不是 runtime pipeline 收尾阶段的默认工作项。

## 7. 技术约束与决策

### 7.0 历史决策记录

#### 决策 A：planning stage 是保留层，不是主锚点

Phase 1 中 planning stage 仍然保留，原因是当前 UI 上用户已经看过“规划阶段”信息，完全移除会让体验突然倒退；但它只作为补充层，不作为运行流水线的主锚点。真正的主锚点始终是 `RuntimePlan.steps`、`RuntimePlan.candidates` 和 task graph nodes。

这意味着：

- 有 RuntimePlan 时，planning stage 只做前置说明，不参与当前步骤判定
- 没有可用 domain run / execution detail 的旧任务，才退化为 planning stage 驱动的展示
- 是否把 planning stage 提升为可 diff 的一级对象，当前保留为历史高级扩展背景，不属于现行收尾范围

#### 决策 B：Phase 1-2 不引入 stage 可写能力

文档里的人工干预（暂停某步、跳过某步、替换 agent）价值很高，但它们本质上要求 pipeline 成为“可控制执行面”，而不是“运行观测面”。这会显著提高实现复杂度，因为需要定义 stage → runtime action 的精确映射。

因此本方案默认：

- Phase 1-2 只做只读观测，不开放 stage action API
- Phase 3 只做重规划与差异展示，不写执行状态
- “把 pipeline 从观测面升级为控制面”保留为历史高级扩展设想，当前不纳入默认范围

### 7.1 不新增 DB 表

运行流水线是 BFF 聚合视图，stage 数据从多个已有数据源计算得出，不在 service 层新增 `pipeline_stages` 表。原因：

- RuntimePlan/strategy/graph 已落库，再存一份 stage 会导致数据一致性问题
- BFF 聚合计算量很小（单个 task 的 stages 通常 < 20 条），无性能瓶颈
- 历史上关于持久化 pipeline 快照用于对比的设想，当前统一视为可选扩展背景

### 7.2 向后兼容

- API 响应从 `{ stages }` 扩展为 `RuntimePipeline`，旧字段 `stages` 保留在内部，前端新版本读 `runtimePipeline.stages`
- 旧前端版本如果不传 sessionId，行为等同现有逻辑但数据更丰富
- 新事件 `pipeline.stage.updated` 对不监听的旧客户端无影响

### 7.3 性能考量

- `buildRuntimePipeline()` 需要 2-3 次 IO（getTask、getSessionMessages，以及按需读取其他聚合数据），可并行
- 增量推送后，前端正常场景下只在分支切换和任务完成时做全量 HTTP 拉取

### 7.4 RuntimePlan 冻结与分支快照

历史方案里 RuntimePlan 曾被视作 task 级共享对象；但当前 runtime pipeline 已不再依赖该字段。Phase 1-3 的“分支感知”准确含义是“分支视角下的运行状态、lineage 与图节点不同”，而不是“分支拥有独立 executionPlan”。至于更细粒度的重规划或分支对比，本文只保留一条历史结论：不应继续把新语义叠加到 `task_sessions` 兼容表。

## 8. 相关代码位置索引

| 模块 | 文件 | 现有职责 | 需要变更的阶段 |
| ---- | ---- | -------- | -------------- |
| Pipeline 端点 | `web-ui-bff/src/modules/tasks/routes.ts` | GET `/:taskId/pipeline` 消息回溯 | Phase 1 |
| 聚合逻辑 | `web-ui-bff/src/lib/runtime-pipeline.ts`（新建） | — | Phase 1 |
| 编排策略 | `web-ui-bff/src/lib/orchestration-strategy.ts` | 策略读写、plan 构建 | 只读复用 |
| SSE 聚合器 | `web-ui-bff/src/modules/realtime/sse-aggregator.ts` | 事件转换、完成检测 | Phase 2 |
| 任务执行 | `web-ui-bff/src/modules/tasks/routes.ts` | 任务创建/执行/续问 | 历史高级扩展若继续推进时再评估 |
| 前端 API | `web-ui/src/lib/api.ts` | pipeline API 调用 | Phase 1 |
| 任务详情 | `web-ui/src/pages/TaskDetail.vue` | pipeline 面板渲染 | Phase 1-3 为主；更重交互仅留作历史扩展 |
| 类型定义 | `web-ui/src/types/pipeline.ts`（新建） | — | Phase 1 |
| Service 任务 | `service/src/modules/tasks/routes.ts` | task CRUD | 不变 |
| Service Schema | `service/src/db/schema.ts` | tasks + 兼容 lineage 表 / tree schema | 当前不新增；历史扩展也不应回到 `task_sessions` 叠加语义 |

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
| ---- | ---- | -------- |
| 无可用 domain run / execution detail | pipeline 退化为只有 planning agent stages | 当缺少更丰富运行明细时 fallback 到现有消息回溯逻辑 |
| fork session 无独立 plan 快照 | 多分支共享同一 plan，细粒度分支对比价值有限 | 当前不做分支 plan diff；若未来另立高级扩展，再单独定义快照模型 |
| 增量推送导致前端 stage 列表与服务端不一致 | 极端情况下 stage 丢失或重复 | 每次 task.completed 时做全量刷新兜底 |
| hook 异步完成导致 stage 顺序错乱 | UI 显示跳跃 | stage 始终按 order 排序，hook 完成时更新 finishedAt 但不改 order |

## 10. 后端改造清单

> 历史注记：本节主要是最初的后端实施 checklist。
> 其中 `buildRuntimePipeline()`、pipeline 端点重写、execution detail fallback 和核心测试覆盖已经进入当前实现；仍未兑现的条目应视为历史扩展 backlog。

### 10.1 BFF 新增聚合模块

历史方案建议新建 `web-ui-bff/src/lib/runtime-pipeline.ts`，集中承载运行流水线的纯计算逻辑；当前该聚合模块已经存在，本段保留为设计来源说明。

历史草案中的导出函数如下：

```typescript
export async function buildRuntimePipeline(args: {
  taskId: string;
  sessionId?: string;
}): Promise<RuntimePipeline>

export function computePipelineSummary(stages: RuntimePipelineStage[]): PipelineSummary

export function taskStatusToPipelineStatus(
  taskStatus: string,
  stages: RuntimePipelineStage[],
): RuntimePipeline["status"]

export function stageFromHookExecution(...): RuntimePipelineStage
export function stageFromPlanningMessages(...): RuntimePipelineStage | null
export function stageFromExecutionStep(...): RuntimePipelineStage[]
export function stageFromJudgeStep(...): RuntimePipelineStage
export function stageFromGraphNode(...): RuntimePipelineStage
```

拆分原则：

- `buildRuntimePipeline()` 只负责编排数据读取与拼装
- `stageFrom*()` 系列函数只做数据映射，不做 IO
- `computePipelineSummary()` 保持纯函数，便于单测
- 事件增量 patch 所需的 diff 逻辑放同一模块，避免散落到 SSE Aggregator

### 10.2 重写 pipeline 端点

目标文件：`web-ui-bff/src/modules/tasks/routes.ts`

历史实施项：

1. 保留原有 `GET /:taskId/pipeline` 路由，不改路径。
2. 增加 `sessionId` query 参数校验。
3. route handler 改为调用 `buildRuntimePipeline({ taskId, sessionId })`。
4. 如果 task 缺少可用 execution detail，fallback 到现有 planning message 提取逻辑。
5. 对非法 `sessionId` 返回 404 或 400，避免跨 task 读取。

历史伪代码：

```typescript
taskRoutes.get("/:taskId/pipeline", async (c) => {
  const taskId = c.req.param("taskId")
  const sessionId = c.req.query("sessionId")
  const pipeline = await buildRuntimePipeline({ taskId, sessionId })
  return c.json(pipeline)
})
```

### 10.3 SSE Aggregator 增量事件接入

目标文件：`web-ui-bff/src/modules/realtime/sse-aggregator.ts`

Phase 2 只做“已知事件触发后的 pipeline patch 推送”，不做独立 pipeline 状态机。

需要接入的时机：

1. `agent.started` 广播前后：把对应 execution stage 置为 `running`
2. `task.hooks.updated` 产生后：补发 hook stage upsert
3. `maybeFinalizeRun()` 成功收尾后：把相关 stage 置为 `completed`
4. `maybeFinalizeFailure()` 后：把当前 stage 置为 `failed`
5. `session.activated` 不直接发 patch，只让前端全量刷新

历史辅助函数草案：

```typescript
async function emitPipelinePatchForTask(args: {
  taskId: string;
  sessionId?: string;
  reason:
    | "agent.started"
    | "task.hooks.updated"
    | "task.completed"
    | "task.failed";
}): Promise<void>
```

Phase 2 的现实做法不是精确计算最小 diff，而是：

- 先在 BFF 内重算一遍当前 session 的 pipeline
- 找出当前最可能变更的 stage
- 推一个 upsert patch + 最新 summary
- 任务完成时前端仍做一次全量刷新兜底

### 10.4 Service 层约束

Phase 1-2 不新增 service 端点，但后端实现时要遵守以下边界：

- 不把 `RuntimePipeline` 持久化回 service
- 不向 `tasks` 表新增字段
- 兼容 `task_sessions` 视图/存储仍只作为 session 血统来源，不承载 pipeline 运行态，也不应继续承接新业务字段

### 10.5 后端测试清单

历史测试 checklist 如下；其中核心读取/fallback 场景已进入现有 BFF 测试，剩余条目更适合视为补强方向：

| 场景 | 断言 |
| ---- | ---- |
| 单执行任务读取 pipeline | 返回 hook / execution / judge 的正确顺序 |
| 并行任务读取 pipeline | candidate stages 数量与 RuntimePlan 一致 |
| 传入 fork sessionId | 返回 session 对应的 planning message 与 graph node 视角 |
| 缺少可用 execution detail | 自动退化为 planning stage 展示 |
| 非法 sessionId | 返回错误而不是越权读数据 |
| task 完成后 patch | summary.completedStages 正确更新 |

## 11. 前端改造清单

> 历史注记：本节保留前端改造草案作为来源说明。
> 其中 pipeline 类型与 API 升级已经完成，后续未兑现条目应视为可选增强而非当前必做项。

### 11.1 类型与 API

目标文件：`web-ui/src/lib/api.ts`

实施项：

1. 新增 `RuntimePipeline`、`RuntimePipelineStage`、`PipelineSummary` 类型。
2. `getTaskPipeline()` 升级为支持 `sessionId` 参数，或新增 `getTaskRuntimePipeline()`。
3. 统一前端只认新结构，不再在组件里拼旧式 `PipelineStage`。

建议不要把类型直接塞进 `TaskDetail.vue`，而是抽到单独文件：

- `web-ui/src/types/pipeline.ts`

### 11.2 TaskDetail 页面状态改造

目标文件：`web-ui/src/pages/TaskDetail.vue`

需要替换的核心状态：

```typescript
const runtimePipeline = ref<RuntimePipeline | null>(null)
const selectedPipelineStageId = ref<string | null>(null)
const selectedPipelineGraphNodeId = ref<string | null>(null)
```

需要调整的逻辑：

1. `refreshTask()` 中 pipeline 分支改为读取 `sessionId ?? activeSessionId`。
2. 收到 `session.activated` 后，不只刷新消息流，也刷新 pipeline。
3. 收到 `pipeline.stage.updated` 后，优先增量 patch；关键状态变化后再全量拉取兜底。
4. `pipelineCurrentStep` 改为从 `runtimePipeline.summary.currentStageId` 或首个 `running/pending` stage 推导。

### 11.3 Pipeline 面板渲染

保留当前垂直 steps 的整体方向，但结构应从“单层阶段”升级为“可展开阶段列表”。

建议 UI 最小改造：

- 顶部摘要栏：分支名、总进度、总耗时、token 汇总
- 中部阶段列表：按 `order` 纵向排列
- 单个阶段卡片：状态点、标签、agent/model、耗时、token
- 展开区：output / error / graph 关联信息

建议新增的派生状态：

```typescript
const pipelineStages = computed(() => runtimePipeline.value?.stages ?? [])

const pipelineCurrentStage = computed(() =>
  pipelineStages.value.find((stage) => stage.status === "running")
    ?? pipelineStages.value.find((stage) => stage.status === "pending")
    ?? null,
)

const pipelineCompletionPercent = computed(() => {
  const summary = runtimePipeline.value?.summary
  if (!summary || summary.totalStages === 0) return 0
  return Math.round((summary.completedStages / summary.totalStages) * 100)
})
```

### 11.4 前端测试清单

建议补充以下测试：

| 场景 | 断言 |
| ---- | ---- |
| activeSessionId 切换 | pipeline API 带上新的 sessionId |
| 收到 `pipeline.stage.updated` | 列表按 order 插入或覆盖正确 stage |
| pipeline summary 更新 | 进度百分比与摘要栏同步更新 |

## 12. 事件契约草案

本节定义前后端围绕运行流水线的最小事件契约，Phase 2 先只引入一个新事件：`pipeline.stage.updated`。

### 12.1 事件命名

```typescript
type RuntimePipelineRealtimeEvent =
  | "pipeline.stage.updated"
```

命名原则：

- 先只做 `updated`，不拆成 `created/completed/removed`
- 事件名保持与现有实时事件命名风格一致
- 具体动作放进 `patch.type`

### 12.2 事件载荷

```typescript
interface PipelineStageUpdatedEventData {
  taskId: string;
  sessionId: string;
  patch: {
    type: "upsert" | "remove";
    stage?: RuntimePipelineStage;
    stageId?: string;
  };
  summary: PipelineSummary;
  reason:
    | "agent.started"
    | "task.hooks.updated"
    | "task.completed"
    | "task.failed";
}
```

约束：

- `patch.type = "upsert"` 时必须携带 `stage`
- `patch.type = "remove"` 时必须携带 `stageId`
- `summary` 每次都带，前端不自行累加汇总值
- `sessionId` 必填，用于前端忽略非当前分支 patch

### 12.3 前端消费规则

```typescript
function shouldApplyPipelinePatch(event: PipelineStageUpdatedEventData) {
  return event.taskId === currentTaskId.value
    && event.sessionId === activeSessionId.value
}
```

处理规则：

1. 当前页面 taskId 不匹配，直接忽略
2. sessionId 不匹配，直接忽略
3. `upsert` 时按 stage.id 覆盖，否则按 order 插入
4. `remove` 时删除对应 stage
5. 无论 `patch` 如何，始终用服务端返回的 `summary` 覆盖本地 summary

### 12.4 全量刷新兜底规则

为了避免增量 patch 和服务端状态漂移，以下事件仍触发全量拉取：

- `task.completed`
- `task.failed`
- `session.activated`
- 用户手动点击刷新

### 12.5 Phase 4 预留事件

状态注记：本节仅保留历史事件设计草案。若未来单独推进高级扩展，不建议复用 `pipeline.stage.updated` 塞入过多语义，而应另起事件类型：

```typescript
type FutureRuntimePipelineEvent =
  | "pipeline.replanned"
  | "pipeline.diff.available"
```

这样可以避免在 Phase 2 就把事件载荷设计得过重。

## 13. 推荐开工顺序

如果按最小风险推进，建议顺序如下：

1. 后端先落 `runtime-pipeline.ts`，把聚合逻辑独立出来
2. 重写 `GET /:taskId/pipeline`，先让接口返回新结构
3. 前端 TaskDetail 改成消费 `RuntimePipeline`
4. 补单测，确认单执行 / 并行 / fork session 三类任务都能读
5. 再接 `pipeline.stage.updated` 事件，做增量 patch
6. 最后做前端交互与事件收尾
