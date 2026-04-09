# Task Phase-First Schema And API 草案

> 状态：Draft v1
> 日期：2026-04-09
> 作者：GitHub Copilot
>
> 相关上下文：
> 1. [docs/task-session-first-schema-plan.md](docs/task-session-first-schema-plan.md)
> 2. [docs/task-tree-data-model-replan.v2-final.md](docs/task-tree-data-model-replan.v2-final.md)
> 3. [control-plane/service/src/modules/tasks/task-session-read.ts](control-plane/service/src/modules/tasks/task-session-read.ts)
> 4. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts)

## 1. 文档目的

本文只回答一件事：

在不做双写、不做历史回填的前提下，如何把当前 task session 模型改成 phase-first 主模型，使下面两件事同时成立：

1. 同一轮并行批次在 task 级平铺列表里连续成组。
2. 并行结束后的后续单次执行整体排在该并行批次之后，而不是被 session 树 DFS 拆开。

本文覆盖：

1. canonical schema 草案
2. service API 变更草案
3. BFF API 变更草案
4. 主要读写路径调整

本文不覆盖：

1. 双写方案
2. 历史数据 backfill
3. legacy contract 兼容层
4. 灰度开关与回滚方案

## 2. 当前问题与根因

当前主链把两类排序语义混在了同一套 `task_sessions` 字段里：

1. lineage 语义：`parentSessionId`、`rootSessionId`、`sortKey`
2. 局部分组语义：`coordinationKey`、`candidateIndex`、`stepIndex`

这导致 [control-plane/service/src/modules/tasks/task-session-topology-order.ts](control-plane/service/src/modules/tasks/task-session-topology-order.ts) 只能做 lineage-first 排序，不能做 phase-first 排序。

根因不是比较器不够复杂，而是当前 schema 缺少一层一等实体来表达“任务的第几轮执行”。

当前模型能回答：

1. 这条 session 挂在哪个父 session 下面。
2. 这条 session 在自己那一小组里排第几。

当前模型不能回答：

1. 这条 session 属于 task 的第几个执行 phase。
2. 这一轮是 single、parallel 还是 sequential-chain。
3. 这一轮并行的 anchor、winner、judge 属于哪一组组级事实。

因此需要把“执行轮次”从 session 记录里抽出来，提升成 phase 级实体。

## 3. 设计目标

### 3.1 必须达成

1. task 级平铺 session 列表按 phase 排序，而不是按 parent DFS 排序。
2. tree 视图仍按 lineage 排序，不受 phase 排序影响。
3. session 内消息继续按消息时间排序，不改变现有 message contract。
4. adopt winner 后，后续 continue 创建新的 phase，而不是试图在旧 parallel 批次里重排。
5. unresolved parallel 阶段允许 `currentPhaseId` 和 `currentSessionId` 表达不同语义。
6. 中断后的 phase 状态必须能区分 `paused`、`awaiting_adoption`、`failed`、`cancelled`，不能只复用 task 级状态。
7. 恢复必须区分“原 phase 原地 resume”和“从中断点派生 recovery phase”两种语义。
8. realtime 事件必须显式携带 `phaseId`，前端不得再从 `sessionId + coordinationKey` 反推当前 phase。

### 3.2 明确不做

1. 不保留 `coordinationKey` 驱动的并行主语义。
2. 不在新读链上兼容没有 phase 数据的旧 task。
3. 不做 session-first 和 phase-first 并存读语义。
4. 不把 phase cancel / resume 继续折叠成旧的 `session.updated` / `task.updated` 模糊事件。

## 4. Hard-Cut 约束

本草案明确采用 hard-cut：

1. schema migration 直接创建新表并修改现有表。
2. 写路径在 cutover 后只写 phase-first 模型。
3. 读路径在 cutover 后只读 phase-first 模型。
4. 旧 task 数据不做 backfill，不纳入新读链保证范围。

这意味着本草案默认适用于两种场景之一：

1. 新环境 / 新项目直接建表。
2. 明确接受旧 task 数据不进入新 phase-first 主链的生产硬切。

## 5. Schema 草案

### 5.1 新增类型

```ts
export type TaskExecutionPhaseKind =
  | "root"
  | "single"
  | "parallel"
  | "sequential_chain"
  | "manual_branch"
  | "hook";

export type TaskExecutionPhaseTriggerType =
  | "execute"
  | "continue"
  | "resume"
  | "workflow_spawn"
  | "candidate_adopt"
  | "manual_branch"
  | "hook_spawn";

export type TaskPhaseRole =
  | "mainline"
  | "candidate"
  | "judge"
  | "step"
  | "aux";

export type TaskExecutionPhaseStatus =
  | "pending"
  | "running"
  | "paused"
  | "awaiting_adoption"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskExecutionPhaseTerminalReason =
  | "winner_adopted"
  | "user_cancelled"
  | "runtime_terminated"
  | "runtime_failed"
  | "timeout"
  | "superseded";
```

### 5.2 新增 `task_execution_phases`

`task_execution_phases` 是新的组级事实表，用来表达 task 的执行轮次。

```ts
export const taskExecutionPhases = pgTable(
  "task_execution_phases",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),

    parentPhaseId: text("parent_phase_id").references(
      (): AnyPgColumn => taskExecutionPhases.id,
    ),
    phaseIndex: integer("phase_index").notNull(),
    phaseKind: text("phase_kind").$type<TaskExecutionPhaseKind>().notNull(),
    triggerType: text("trigger_type")
      .$type<TaskExecutionPhaseTriggerType>()
      .notNull(),
    status: text("status")
      .$type<TaskExecutionPhaseStatus>()
      .notNull()
      .default("pending"),
    resumedFromPhaseId: text("resumed_from_phase_id").references(
      (): AnyPgColumn => taskExecutionPhases.id,
    ),
    awaitingAdoptionSince: text("awaiting_adoption_since"),
    cancelRequestedAt: text("cancel_requested_at"),
    cancelledAt: text("cancelled_at"),
    terminalReason: text("terminal_reason").$type<TaskExecutionPhaseTerminalReason>(),
    lastHeartbeatAt: text("last_heartbeat_at"),

    anchorSessionId: text("anchor_session_id").references(
      (): AnyPgColumn => taskSessions.id,
    ),
    anchorMessageId: text("anchor_message_id"),

    coordinationKey: text("coordination_key"),
    candidateCount: integer("candidate_count"),
    winnerSessionId: text("winner_session_id").references(
      (): AnyPgColumn => taskSessions.id,
    ),
    judgeSessionId: text("judge_session_id").references(
      (): AnyPgColumn => taskSessions.id,
    ),

    requestedModel: text("requested_model"),
    effectiveModel: text("effective_model"),
    resultSummary: text("result_summary"),
    errorText: text("error_text"),

    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_execution_phases_task_phase_index").on(
      table.taskId,
      table.phaseIndex,
    ),
    index("idx_task_execution_phases_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_execution_phases_task_status_phase_index").on(
      table.taskId,
      table.status,
      table.phaseIndex,
    ),
    index("idx_task_execution_phases_task_parent_phase_index").on(
      table.taskId,
      table.parentPhaseId,
      table.phaseIndex,
    ),
    index("idx_task_execution_phases_task_resumed_from_phase_id").on(
      table.taskId,
      table.resumedFromPhaseId,
    ),
    index("idx_task_execution_phases_task_coordination_key").on(
      table.taskId,
      table.coordinationKey,
    ),
    index("idx_task_execution_phases_task_anchor_session_id").on(
      table.taskId,
      table.anchorSessionId,
    ),
  ],
);
```

字段语义：

1. `phaseIndex`：task 内全局单调递增序号，是 phase-first 排序第一关键字。
2. `phaseKind`：该轮执行类型，决定平铺列表的组语义。
3. `anchorSessionId`：该轮执行从哪条 session 继续出来。
4. `anchorMessageId`：触发该轮执行的 user prompt，用于 conversation 和 timeline 锚点。
5. `coordinationKey`：仅 parallel phase 保留，作为低层 runtime / session 绑定键，不再承担 API 主语义。
6. `winnerSessionId` / `judgeSessionId`：组级事实，只存一份，不再重复散落到每条 session 上。
7. `status`：必须使用 phase 专属状态，而不是直接复用 task 级 status；parallel 在候选全部结束但未 adopt 时进入 `awaiting_adoption`。
8. `awaitingAdoptionSince`：并行比较完成后开始等待人工采纳的时间点。
9. `cancelRequestedAt` / `cancelledAt` / `terminalReason`：表达 phase 中断与终止原因，避免只从 session status 反推。
10. `resumedFromPhaseId`：当恢复不是“原地 resume”，而是创建新的 recovery phase 时，显式指回被恢复的旧 phase。
11. `lastHeartbeatAt`：记录 runtime 最近一次存活信号，用于 realtime 降级与 running / stalled 判定。

### 5.3 修改 `task_sessions`

`task_sessions` 保留 lineage 语义，移除 phase 级组事实。

建议修改为：

1. 新增 `phaseId`
2. 新增 `phaseRole`
3. 新增 `phaseItemIndex`
4. `sortKey` 改名为 `lineageSortKey`
5. 删除 `coordinationKey`
6. 删除 `candidateIndex`
7. 删除 `stepIndex`
8. 删除 `winnerSessionId`
9. 删除 `judgeSessionId`
10. 删除 `executionModeSnapshot`

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
    phaseId: text("phase_id")
      .notNull()
      .references(() => taskExecutionPhases.id),

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
    lineageSortKey: text("lineage_sort_key"),

    operationId: text("operation_id"),
    sessionKind: text("session_kind").$type<TaskSessionKind>().notNull(),
    triggerType: text("trigger_type").$type<TaskSessionTriggerType>().notNull(),
    executionStatus: text("execution_status").$type<ExecutionStatus>().notNull().default("running"),
    branchName: text("branch_name"),
    phaseRole: text("phase_role").$type<TaskPhaseRole>().notNull(),
    phaseItemIndex: integer("phase_item_index").notNull().default(0),
    runtimeSessionId: text("runtime_session_id"),
    forkedFromMessageId: text("forked_from_message_id"),
    selectedModel: text("selected_model"),
    effectiveModel: text("effective_model"),

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
    index("idx_task_sessions_task_phase_item").on(
      table.taskId,
      table.phaseId,
      table.phaseRole,
      table.phaseItemIndex,
    ),
    index("idx_task_sessions_task_parent_created_at").on(
      table.taskId,
      table.parentSessionId,
      table.createdAt,
    ),
    index("idx_task_sessions_task_lineage_sort_key").on(table.taskId, table.lineageSortKey),
  ],
);
```

### 5.4 修改 `task_session_runs`

`task_session_runs` 也必须显式挂到 phase 上，否则 trace / operation 查询仍要回到 session 去反推阶段。

```ts
// delta only
phaseId: text("phase_id")
  .notNull()
  .references(() => taskExecutionPhases.id),

index("idx_task_session_runs_task_phase_created_at").on(
  table.taskId,
  table.phaseId,
  table.createdAt,
)
```

### 5.5 修改 `task_snapshots`

`task_snapshots` 新增 phase 指针，但保留 `currentSessionId`。

```ts
// delta only
currentPhaseId: text("current_phase_id").references(() => taskExecutionPhases.id),
latestPhaseId: text("latest_phase_id").references(() => taskExecutionPhases.id),
```

这里需要明确一条语义：

1. unresolved parallel 阶段时，`currentPhaseId` 指向并行 phase。
2. unresolved parallel 阶段时，`currentSessionId` 继续指向 anchor session。
3. winner 确定后，`currentSessionId` 才切到 winner session。
4. phase 进入 `paused` / `failed` / `cancelled` 且尚未创建 recovery phase 时，`currentPhaseId` 可以继续指向被中断的 phase，而 `currentSessionId` 回落到最后稳定的 anchor / winner session，作为恢复锚点。

这样可以把“当前执行轮次”和“当前主线 session”解耦。

### 5.6 修改 `task_timeline_views`

`task_timeline_views` 是投影层，不是 canonical table，但建议一起补：

```ts
// delta only
phaseId: text("phase_id"),
phaseIndex: integer("phase_index"),
phaseKind: text("phase_kind").$type<TaskExecutionPhaseKind>(),
phaseRole: text("phase_role").$type<TaskPhaseRole>(),
phaseItemIndex: integer("phase_item_index"),
```

原因是 timeline 读链需要廉价地做 phase 分组，不能每次依赖 session join 才知道该条 item 属于哪一轮执行。

## 6. Service API 变更草案

### 6.1 保留但改语义的接口

#### `GET /api/tasks/:taskId/sessions`

保留路径，但响应从“拓扑顺序 session 列表”改为“phase-first 顺序 session 列表”。

新增返回要求：

1. `data` 数组按 `phaseIndex -> phaseRole -> phaseItemIndex -> createdAt` 排序。
2. 每条 session 都返回 `phaseId`、`phaseRole`、`phaseItemIndex`。
3. `meta` 新增 `currentPhaseId`、`latestPhaseId`、`phaseCount`。

响应示意：

```json
{
  "data": [
    {
      "id": "task-session:1:root",
      "phaseId": "phase-1",
      "phaseRole": "mainline",
      "phaseItemIndex": 0
    },
    {
      "id": "task-session:1:candidate-0",
      "phaseId": "phase-2",
      "phaseRole": "candidate",
      "phaseItemIndex": 0
    }
  ],
  "meta": {
    "currentSessionId": "task-session:1:root",
    "currentPhaseId": "phase-2",
    "latestSessionId": "task-session:1:candidate-0",
    "latestPhaseId": "phase-2",
    "phaseCount": 2
  }
}
```

#### `GET /api/tasks/:taskId/tree`

保留路径，但明确拆成两层：

1. `sessions`：lineage tree 节点集合，不按 phase 平铺。
2. `phases`：phase-first 阶段列表，用于 UI 在树外做“执行轮次条”或“并行组块”。

删掉当前 `parallelGroups` 输出，改成 `phases`。

#### `GET /api/tasks/:taskId/timeline`

保留路径，timeline item 增加 `phaseId`、`phaseIndex`、`phaseKind`、`phaseRole`。

#### `GET /api/tasks/:taskId/query/normalized-conversation`

保留路径，不改消息时间排序语义；但 parallel block 的组装来源从 `coordinationKey + candidate session` 切为 `task_execution_phases`。

### 6.2 新增接口

#### `GET /api/tasks/:taskId/phases`

新增 phase 主接口，返回按 `phaseIndex` 排序的 phase 列表与成员 session 概览。

响应示意：

```json
{
  "data": [
    {
      "id": "phase-1",
      "phaseIndex": 1,
      "phaseKind": "single",
      "status": "completed",
      "anchorSessionId": null,
      "winnerSessionId": null,
      "sessionIds": ["task-session:1:root"]
    },
    {
      "id": "phase-2",
      "phaseIndex": 2,
      "phaseKind": "parallel",
      "status": "completed",
      "anchorSessionId": "task-session:1:root",
      "winnerSessionId": "task-session:1:candidate-0",
      "sessionIds": [
        "task-session:1:candidate-0",
        "task-session:1:candidate-1",
        "task-session:1:judge"
      ]
    }
  ]
}
```

#### `POST /api/tasks/:taskId/phases/:phaseId/cancel`

用于中断当前 phase。这个接口是 phase-first 模型里“用户终止 / 系统终止”的唯一组级入口，不再让前端逐条 session 停止后自行拼状态。

请求体：

```json
{
  "reason": "user_cancelled",
  "terminateRunningSessions": true
}
```

响应体：

```json
{
  "taskId": "task-1",
  "phaseId": "phase-2",
  "status": "cancelled",
  "terminalReason": "user_cancelled",
  "currentSessionId": "task-session:1:root"
}
```

service 内部动作：

1. 校验 phase 当前状态只能是 `pending`、`running`、`paused`、`awaiting_adoption`。
2. 如请求要求终止 runtime，则对该 phase 下仍在运行的 session 执行统一终止。
3. 更新 `task_execution_phases.status = "cancelled"`。
4. 写入 `cancelRequestedAt`、`cancelledAt`、`terminalReason`。
5. 如该 phase 尚未产出 winner，则 `task_snapshots.currentSessionId` 回落到 `anchorSessionId`；如已有 winner，则保持 winner。
6. 保留 `task_snapshots.currentPhaseId = phaseId`，直到后续显式创建 recovery phase。

#### `POST /api/tasks/:taskId/phases/:phaseId/resume`

只用于“原地 resume”的场景，即 phase 当前处于 `paused`，且 runtime handle 仍可复用。若无法原地 resume，service 返回 409，要求调用方改走 recovery phase。

请求体：

```json
{
  "mode": "reuse"
}
```

响应体：

```json
{
  "taskId": "task-1",
  "phaseId": "phase-2",
  "status": "running"
}
```

service 内部动作：

1. 校验 `phase.status = "paused"`。
2. 校验该 phase 下所有需恢复的 runtime session 仍可被 resume。
3. 更新 `task_execution_phases.status = "running"`。
4. 保持 `task_snapshots.currentPhaseId = phaseId` 与当前主线 session 不变。
5. 发出 `task.phase.resumed` 事件。

### 6.3 替换接口

#### 删除 `POST /api/tasks/:taskId/adopt-winner`

当前这个接口的问题是把组级主语义建立在 `coordinationKey` 上，而 `coordinationKey` 在新模型里只保留为内部绑定键，不再是 API 主键。

#### 新增 `POST /api/tasks/:taskId/phases/:phaseId/adopt`

请求体：

```json
{
  "winnerSessionId": "task-session:1:candidate-0"
}
```

响应体：

```json
{
  "taskId": "task-1",
  "phaseId": "phase-2",
  "winnerSessionId": "task-session:1:candidate-0",
  "currentSessionId": "task-session:1:candidate-0"
}
```

service 内部动作：

1. 更新 `task_execution_phases.winnerSessionId`
2. 更新 `task_execution_phases.status`
3. 更新 `task_snapshots.currentSessionId`
4. 更新 `task_snapshots.currentPhaseId`
5. 更新 `task_snapshots.latestPhaseId`

## 7. BFF API 变更草案

### 7.1 `POST /api/tasks/:taskId/execute`

保留路径，但响应改成 phase envelope，而不是只返回单条 session 上下文。

响应示意：

```json
{
  "ok": true,
  "phase": {
    "id": "phase-2",
    "phaseIndex": 2,
    "phaseKind": "parallel",
    "status": "running"
  },
  "sessions": [
    {
      "sessionId": "candidate-0",
      "taskSessionId": "task-session:1:candidate-0",
      "phaseRole": "candidate",
      "phaseItemIndex": 0
    },
    {
      "sessionId": "candidate-1",
      "taskSessionId": "task-session:1:candidate-1",
      "phaseRole": "candidate",
      "phaseItemIndex": 1
    }
  ]
}
```

### 7.2 `POST /api/tasks/:taskId/continue`

保留路径与请求体，但响应同样改成 phase envelope。

这使前端不需要再从 `sessionId` 自己推测“这是新一轮 single，还是并行 batch，还是顺序链”。

### 7.3 替换 adopt 路径

删除：

1. `POST /api/tasks/:taskId/candidates/:index/adopt`

新增：

1. `POST /api/tasks/:taskId/phases/:phaseId/candidates/:index/adopt`

原因：candidate index 只在某个 parallel phase 内有意义，不应该脱离 phase 单独成为全 task 的接口主键。

### 7.4 `GET /api/tasks/:taskId/tree`

保留路径，但 BFF 应直接透传并标准化 phase 数据：

1. 顶层返回 `phases`
2. 删除 `parallelGroups` 兼容重组逻辑
3. 前端所有并行分组与历史并行卡片都改为 phase-first 驱动

### 7.5 `POST /api/tasks/:taskId/phases/:phaseId/cancel`

BFF 负责把当前已经散落在 candidate adoption / terminate 逻辑里的 runtime stop 行为，提升成 phase 级动作。

要求：

1. 并行 phase 的取消必须统一停止 candidate / judge session，而不是只停当前选中 session。
2. 返回 phase envelope，供前端立即刷新 phase 条与 task detail 状态。
3. 当 phase 取消来自人工采纳 winner 后的非胜者清理时，也必须通过 phase 级 contract 回写最终状态。

### 7.6 `POST /api/tasks/:taskId/phases/:phaseId/resume`

当 phase 是“可原地恢复”的 `paused` 场景时，BFF 直接调用 service resume；如果 service 返回 409，则 BFF 不做隐式 fallback，而是改由 `continue` / `execute` 显式创建 recovery phase。

### 7.7 `POST /api/tasks/:taskId/execute` / `continue` 补充恢复上下文

`execute` 与 `continue` 的请求体增加可选 `resumeFromPhaseId`。这用于“不能原地 resume，只能新开 recovery phase”的场景。

请求体示意：

```json
{
  "prompt": "继续从上次中断处执行",
  "sessionId": "task-session:1:root",
  "resumeFromPhaseId": "phase-2"
}
```

响应 phase envelope 需补：

```json
{
  "phase": {
    "id": "phase-3",
    "phaseIndex": 3,
    "phaseKind": "single",
    "status": "running",
    "resumedFromPhaseId": "phase-2"
  }
}
```

这样前端可以清楚区分：这是普通 continue，还是从一个已中断 phase 恢复出来的新 phase。

## 8. 写路径草案

### 8.1 首次 single execute

1. 创建 `task_execution_phases`，`phaseIndex = 1`，`phaseKind = "single"`
2. 创建 root session，`phaseId = phase-1`，`phaseRole = "mainline"`
3. 创建 `task_session_runs`，显式写入 `phaseId`
4. 更新 `task_snapshots.currentPhaseId = phase-1`
5. 更新 `task_snapshots.currentSessionId = root session`
6. 更新 `task_snapshots.latestPhaseId = phase-1`

### 8.2 parallel execute

1. 创建 `task_execution_phases`，`phaseKind = "parallel"`
2. 写入 `anchorSessionId` 与 `anchorMessageId`
3. 为每个 candidate 创建 session：
   1. `phaseId = 当前 parallel phase`
   2. `phaseRole = "candidate"`
   3. `phaseItemIndex = candidateIndex`
4. 如有 judge，再创建一条 `phaseRole = "judge"` 的 session
5. 创建对应 `task_session_runs`
6. 更新 `task_snapshots.currentPhaseId = 当前 parallel phase`
7. 保持 `task_snapshots.currentSessionId = anchorSessionId`

### 8.3 adopt winner

1. 通过 `phaseId` 定位 parallel phase
2. 更新 `winnerSessionId`
3. phase 状态切到 `completed`
4. `task_snapshots.currentSessionId = winnerSessionId`
5. `task_snapshots.currentPhaseId = phaseId`
6. `task_snapshots.latestPhaseId = phaseId`

### 8.4 continue single after adopt

1. 创建新的 single phase，`phaseIndex = previous + 1`
2. `anchorSessionId = winnerSessionId`
3. fork child session，`parentSessionId = winnerSessionId`
4. child session 写入：
   1. `phaseId = 新 phase`
   2. `phaseRole = "mainline"`
   3. `phaseItemIndex = 0`
5. 更新 snapshot 的 `currentPhaseId/currentSessionId/latestPhaseId`

### 8.5 continue parallel after adopt

1. 创建新的 parallel phase
2. `anchorSessionId = winnerSessionId`
3. 写入新一轮 candidate sessions
4. 旧 parallel phase 不重排、不合并、不复写

### 8.6 sequential-chain execute / continue

1. 创建一个 `phaseKind = "sequential_chain"` 的 phase
2. 该 phase 下所有 step sessions 共用同一个 `phaseId`
3. 每个 step session 用 `phaseRole = "step"`
4. 每个 step session 用 `phaseItemIndex = stepIndex`

结果是：顺序链作为一个完整 phase 连续出现，而不是被 parent DFS 打散。

### 8.7 cancel active phase

1. 只允许取消 `pending`、`running`、`paused`、`awaiting_adoption` 的 phase。
2. BFF / service 按 phase 维度终止仍在运行的 runtime session，而不是让前端逐个 session 自己停。
3. phase 写入：
  1. `status = "cancelled"`
  2. `cancelRequestedAt = now`
  3. `cancelledAt = now`
  4. `terminalReason = "user_cancelled" | "runtime_terminated"`
4. snapshot 回退规则：
  1. unresolved parallel：`currentSessionId = anchorSessionId`
  2. adopted parallel：`currentSessionId = winnerSessionId`
  3. single / hook：`currentSessionId = anchorSessionId ?? 当前主线 session`
5. `currentPhaseId` 保持在被取消的 phase，直到用户显式恢复。
6. 发出 `task.phase.cancelled` 与 `task.snapshot.updated(reason = "phase.cancelled")`。

### 8.8 resume paused phase in-place

1. 只允许 `status = "paused"` 的 phase 原地恢复。
2. 只在 runtime handle 仍有效时允许原地 resume。
3. 原地 resume 不创建新 phase，不改变 `phaseIndex`。
4. 更新 `status = "running"`，保留 `currentPhaseId = 原 phase`。
5. 如 runtime handle 不可复用，则返回 409，由调用方改走 recovery phase。

### 8.9 recover failed / cancelled / non-resumable paused phase

1. 恢复不是重开旧 phase，而是创建一个新的 recovery phase。
2. 新 phase 满足：
  1. `phaseIndex = latest + 1`
  2. `triggerType = "resume"`
  3. `resumedFromPhaseId = oldPhaseId`
3. anchor 选择规则：
  1. single / hook：取旧 phase 的 `anchorSessionId`，或最后稳定 mainline session
  2. parallel 未 adopt：取旧 phase 的 `anchorSessionId`
  3. parallel 已 adopt：取 `winnerSessionId`
  4. sequential_chain：取最后一个已完成 step session；没有已完成 step 时回退到 `anchorSessionId`
4. recovery phase 的 session / run 全部新建，旧 phase 永不 reopen。
5. 前端通过 `resumedFromPhaseId` 在历史视图上把 recovery phase 挂回被中断的 phase，而不是误以为只是普通 continue。

## 9. 读路径草案

### 9.1 `listTaskSessions`

当前 [control-plane/service/src/modules/tasks/task-session-read.ts](control-plane/service/src/modules/tasks/task-session-read.ts) 里的 `loadTaskSessionRecords(...)` 不应再把 phase-first 平铺列表交给拓扑 helper。

应拆成两类 helper：

1. `orderTaskSessionsByPhase(...)`：只给 `GET /sessions`、`GET /phases`、平铺汇总列表使用
2. `orderTaskSessionsByTopology(...)`：只给 `GET /tree`、lineage path、tree scope 使用

phase-first helper 排序规则固定为：

1. `phaseIndex ASC`
2. `phaseRole` 桶顺序：`mainline -> step -> candidate -> judge -> aux`
3. `phaseItemIndex ASC`
4. `createdAt ASC`
5. `runtimeSessionId / id` 稳定 tie-break

### 9.2 `buildTaskTreeResponse`

读链改为：

1. 先加载 phases
2. 再加载 sessions
3. 树节点按 topology 组装
4. phase 列表单独按 `phaseIndex` 返回

返回结构建议：

1. `task`
2. `phases`
3. `sessions`
4. `messages`
5. `operations`
6. `artifacts`
7. `edges`

删除：

1. `parallelGroups`

### 9.3 `buildTaskTimelineResponse`

timeline item 顺序仍按时间，但投影里必须带 phase 字段，前端可按 phase 做连续组块。

### 9.4 `buildTaskNormalizedConversationQueryResponse`

消息顺序不变，仍由消息时间决定。

并行卡片的组装来源改成：

1. 从 phase 表拿到 `phaseKind = parallel` 的阶段
2. 用 `phaseId` 找 candidate sessions
3. 用 `anchorMessageId` 或 `anchorSessionId` 计算插入锚点

也就是说，当前基于 `coordinationKey`、`executionModeSnapshot`、candidate session 聚合的兼容推断应全部退出主链。

## 10. 实时推送与刷新 Contract

### 10.1 Event envelope

当前 realtime store 的公共 envelope 已经有 `id/type/ts/projectId/taskId/sessionId/agentRunId/data`。phase-first 方案要求在 task-domain 事件上补充 `phaseId`，并允许 phase 级事件没有 `sessionId`。

事件示意：

```json
{
  "id": "evt-1",
  "type": "task.phase.updated",
  "ts": "2026-04-09T10:00:00.000Z",
  "projectId": "proj-1",
  "taskId": "task-1",
  "phaseId": "phase-2",
  "sessionId": "task-session:1:candidate-0",
  "agentRunId": "agent-run-1",
  "data": {
    "phaseIndex": 2,
    "phaseKind": "parallel",
    "status": "running"
  }
}
```

要求：

1. `task.phase.*` 事件必须带 `phaseId`。
2. `task.message.updated` / `task.message.delta` 也必须带 `phaseId`，避免前端从 session 反查。
3. `task.snapshot.updated` 的 reason 要扩展出 `phase.created`、`phase.updated`、`phase.cancelled`、`phase.resumed` 等枚举。

### 10.2 必需新增的事件类型

phase-first 至少需要新增下面这些 realtime 事件：

1. `task.phase.created`
2. `task.phase.updated`
3. `task.phase.awaiting_adoption`
4. `task.phase.paused`
5. `task.phase.resumed`
6. `task.phase.cancelled`
7. `task.phase.completed`
8. `task.phase.failed`

语义边界：

1. `task.message.*` 只负责消息流式内容。
2. `task.phase.*` 只负责执行轮次状态。
3. `task.snapshot.updated` 只负责通知前端需要刷新 canonical snapshot。

不能再让前端通过“消息停了 + session status 变了”去猜 phase 是否完成、暂停或取消。

### 10.3 前端消费规则

前端现有 realtime / patch feed 体系应改成两条线：

1. live assistant overlay：继续只由 `task.message.updated` / `task.message.delta` 驱动。
2. task detail snapshot refresh：由 `task.phase.*` 与 `task.snapshot.updated` 驱动。

建议规则：

1. `task.message.delta` / assistant in-progress：只更新本地流式文本，不触发 canonical refresh。
2. `task.message.updated` assistant completed：触发消息 refresh，可继续沿用现有 patch policy。
3. `task.phase.created` / `updated` / `paused` / `resumed` / `cancelled` / `completed` / `failed` / `awaiting_adoption`：触发 `flow: true` 的 snapshot refresh，默认不强制刷新 canonical messages。
4. `task.followup.*` / `task.hooks.updated`：继续 bump trace refresh key。
5. 当前正在查看的 task 若收到 `task.phase.awaiting_adoption`，UI 应立即把 phase 标记为“待采纳”，而不是等 polling 才出现 adopt CTA。

### 10.4 降级与乱序处理

1. realtime 断开时，running / paused / awaiting_adoption phase 继续走 polling；polling 至少刷新 `phases + flow`。
2. polling 是否刷新 canonical messages，仍可沿用“仅在 realtime 断开时刷新 messages”的现有策略。
3. 事件乱序时，前端以 `phaseIndex + updatedAt` 为准，而不是只信客户端到达顺序。
4. 若 message 事件先到而本地尚未见到 `phase.created`，前端允许先把消息挂到 session，下一个 phase refresh 后再对齐 phase 归属。
5. 所有 realtime 事件继续按 `event.id` 去重。

## 11. 实施边界

本草案的边界是：

1. 新 schema 一次性 cutover
2. service / BFF / UI 同步切 phase-first 主语义
3. 所有旧的 `coordinationKey`-as-public-group-key contract 一并下线

不做的事情：

1. 不写兼容查询
2. 不保留旧 `adopt-winner` contract
3. 不回填旧 task 到新 phase 模型

## 12. 最终结论

如果目标是“并行批次连续成组，后续串行整体后移”，那么必须把 phase 提升成一等事实表。

最终的职责拆分应该固定为：

1. `task_execution_phases`：执行轮次与组级事实
2. `task_sessions`：lineage 节点与 session 级事实
3. `task_session_runs`：session 内运行尝试
4. `task_snapshots`：当前 phase / 当前主线 session 指针

一旦接受这条边界，当前 `task-session-topology-order.ts` 就不再承担“task 级平铺顺序”的职责，只保留“tree / lineage 顺序”的职责。