# 任务域激进重构 Drizzle Schema 草稿

> 状态：主线已完成（2026-03-25；schema 草稿主体已兑现，当前仅保留历史说明、维护基线与可选 cleanup DDL 占位）  
> 日期：2026-03-22  
> 作者：GitHub Copilot
>
> 历史口径说明（2026-04-05）：本文保留的 `agent_runs` 表结构、索引和 bridge 字段草案均属于删除前迁移设计上下文。当前 schema 已通过 `0033_drop_agent_runs.sql` 删除 `agent_runs` 物理表；兼容 `agentRunId` 语义由 `task_operations`、`task_session_runs`、`task_sessions` 等 canonical task-domain 表投影提供。

## 1. 文档定位

本文档是下面两份文档的继续：

1. [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
2. [task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)

目标是把激进方案进一步压缩成接近可直接写进 [control-plane/service/src/db/schema.pg.ts](control-plane/service/src/db/schema.pg.ts) 的 Drizzle schema 草稿，并保留与当前 `control-plane/service/drizzle-pg` 迁移链兼容的 migration 编号历史说明。

本文档仍然不是最终代码，但它保留的价值主要在于：

1. 解释当前正式 schema 的设计来源
2. 作为历史 migration 编号与折中策略的参考
3. 为 cleanup DDL、兼容字段退役与少量约束补齐提供背景

## 2. 当前迁移链约束

仓库当前 PostgreSQL migration 链位于：

1. `control-plane/service/drizzle-pg/0000_safe_anthem.sql`
2. `...`
3. `control-plane/service/drizzle-pg/0012_project_tree_events_search.sql`

历史草案中，新链从 `0013` 开始。

历史编号草案：

1. `0013_task_domain_core.sql`
2. `0014_task_domain_conversations.sql`
3. `0015_task_domain_projections.sql`
4. `0016_task_domain_bridges.sql`
5. `0017_task_domain_indexes.sql`

说明：

1. `0013` 到 `0015` 只新增，不修改旧逻辑依赖。
2. `0016` 只做 bridge columns，不在该批做破坏式删字段。
3. `0017` 补索引与 `pg_trgm`，放到最后更稳妥。

## 3. Schema 草稿约定

延续当前 `schema.pg.ts` 风格：

1. 主键统一 `text("id")`
2. 时间字段继续用 `text("created_at")` + `CURRENT_TIMESTAMP`
3. 外键命名维持现有 snake_case 风格
4. 复杂结构先用 `jsonb()`，不在第一轮过度建枚举表
5. `task_domain_events.seq` 使用 `bigint`，需额外从 `drizzle-orm/pg-core` 导入 `bigint`

历史 TypeScript 类型草案：

```ts
export type TaskDomainStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskOrchestrationKind = "single" | "parallel" | "sequential-chain";

export type TaskRunTriggerType =
  | "user_execute"
  | "resume"
  | "reconcile"
  | "workflow_spawn"
  | "system_retry";

export type TaskRunNodeKind =
  | "execution"
  | "candidate"
  | "judge"
  | "chain-step"
  | "hook"
  | "resume";

export type ConversationSessionKind =
  | "task-root"
  | "parallel-candidate"
  | "parallel-judge"
  | "sequential-step"
  | "resume"
  | "manual-branch";

export type ConversationMessageRole = "user" | "assistant" | "system" | "tool";

export type ConversationMessagePartType =
  | "text"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "file_reference"
  | "diff";
```

## 4. `tasks` Drizzle 草稿

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
    status: text("status").$type<TaskDomainStatus>().notNull().default("pending"),
    category: text("category"),

    currentRunId: text("current_run_id"),
    currentSessionId: text("current_session_id"),
    currentAgentRunId: text("current_agent_run_id"),

    latestResult: text("latest_result"),
    latestResultSummary: text("latest_result_summary"),

    selectedModel: text("selected_model"),
    repoId: text("repo_id").references(() => repositories.id),
    workspaceRoot: text("workspace_root"),
    baseRevision: text("base_revision"),
    workingBranch: text("working_branch"),
    credentialId: text("credential_id").references(() => repositoryCredentials.id),

    strategyJson: jsonb("strategy_json").$type<Record<string, unknown>>(),
    finalCommitSha: text("final_commit_sha"),
    finalBranchName: text("final_branch_name"),
    changesSummaryJson: jsonb("changes_summary_json").$type<Record<string, unknown>>(),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_tasks_tree_node_id").on(table.treeNodeId),
    index("idx_tasks_project_created_at").on(table.projectId, table.createdAt),
    index("idx_tasks_project_status_created_at").on(table.projectId, table.status, table.createdAt),
    index("idx_tasks_current_run_id").on(table.currentRunId),
    index("idx_tasks_current_session_id").on(table.currentSessionId),
  ],
);
```

注意：

1. `currentRunId` 先不做 FK，避免循环依赖导致 migration 首批落地变复杂。
2. 第二轮 schema 清理时再加 FK 或通过 `ALTER TABLE` 补上。

## 5. `task_runs` Drizzle 草稿

```ts
export const taskRuns = pgTable(
  "task_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),

    orchestrationKind: text("orchestration_kind")
      .$type<TaskOrchestrationKind>()
      .notNull(),
    triggerType: text("trigger_type").$type<TaskRunTriggerType>().notNull(),
    sourceType: text("source_type"),

    status: text("status").$type<TaskDomainStatus>().notNull().default("pending"),
    rootSessionId: text("root_session_id"),
    winnerNodeId: text("winner_node_id"),
    judgeNodeId: text("judge_node_id"),

    requestedModel: text("requested_model"),
    effectiveModel: text("effective_model"),

    pipelineStepCount: integer("pipeline_step_count"),
    candidateCount: integer("candidate_count"),

    resultText: text("result_text"),
    resultSummary: text("result_summary"),
    errorText: text("error_text"),

    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_runs_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_runs_project_created_at").on(table.projectId, table.createdAt),
    index("idx_task_runs_status_created_at").on(table.status, table.createdAt),
  ],
);
```

历史草案注记：

1. `winnerNodeId`、`judgeNodeId` 第一轮也先不做 FK。
2. 等 `taskRunNodes` 数据稳定后再补 FK。

## 6. `task_run_nodes` Drizzle 草稿

```ts
export const taskRunNodes = pgTable(
  "task_run_nodes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => taskRuns.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),

    nodeKind: text("node_kind").$type<TaskRunNodeKind>().notNull(),
    nodeKey: text("node_key").notNull(),
    title: text("title"),
    instruction: text("instruction"),

    candidateIndex: integer("candidate_index"),
    chainStepIndex: integer("chain_step_index"),
    hookTrigger: text("hook_trigger"),

    agentType: text("agent_type"),
    modelUsed: text("model_used"),

    sessionId: text("session_id"),
    agentRunId: text("agent_run_id").references(() => agentRuns.id),

    status: text("status").$type<TaskDomainStatus>().notNull().default("pending"),
    resultText: text("result_text"),
    resultSummary: text("result_summary"),
    errorText: text("error_text"),

    tokenUsed: integer("token_used"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_run_nodes_run_node_key").on(table.runId, table.nodeKey),
    index("idx_task_run_nodes_run_created_at").on(table.runId, table.createdAt),
    index("idx_task_run_nodes_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_run_nodes_session_id").on(table.sessionId),
    index("idx_task_run_nodes_agent_run_id").on(table.agentRunId),
    index("idx_task_run_nodes_run_candidate_index").on(table.runId, table.candidateIndex),
    index("idx_task_run_nodes_run_chain_step_index").on(table.runId, table.chainStepIndex),
  ],
);
```

## 7. `task_run_edges` Drizzle 草稿

```ts
export type TaskRunEdgeKind = "depends_on" | "spawned_from" | "judges" | "resumes_from";

export const taskRunEdges = pgTable(
  "task_run_edges",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => taskRuns.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    fromNodeId: text("from_node_id")
      .notNull()
      .references(() => taskRunNodes.id),
    toNodeId: text("to_node_id")
      .notNull()
      .references(() => taskRunNodes.id),
    edgeKind: text("edge_kind").$type<TaskRunEdgeKind>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_run_edges_unique").on(
      table.runId,
      table.fromNodeId,
      table.toNodeId,
      table.edgeKind,
    ),
    index("idx_task_run_edges_run_id").on(table.runId),
  ],
);
```

## 8. `conversation_sessions` Drizzle 草稿

```ts
export const conversationSessions = pgTable(
  "conversation_sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: text("task_id").references(() => tasks.id),
    runId: text("run_id").references(() => taskRuns.id),
    runNodeId: text("run_node_id").references(() => taskRunNodes.id),

    parentSessionId: text("parent_session_id"),
    rootSessionId: text("root_session_id"),
    forkedFromMessageId: text("forked_from_message_id"),

    sessionKind: text("session_kind").$type<ConversationSessionKind>().notNull(),
    sourceType: text("source_type").notNull(),
    branchName: text("branch_name"),
    isActive: boolean("is_active").notNull().default(true),

    runtimeSessionId: text("runtime_session_id"),
    treeNodeId: text("tree_node_id").references(() => projectTreeNodes.id),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("idx_conversation_sessions_runtime_session_id").on(table.runtimeSessionId),
    uniqueIndex("idx_conversation_sessions_tree_node_id").on(table.treeNodeId),
    index("idx_conversation_sessions_task_created_at").on(table.taskId, table.createdAt),
    index("idx_conversation_sessions_run_created_at").on(table.runId, table.createdAt),
    index("idx_conversation_sessions_parent_session_id").on(table.parentSessionId),
    index("idx_conversation_sessions_root_session_id").on(table.rootSessionId),
  ],
);
```

注意：

1. `parentSessionId` 第一轮可不加 FK，避免自引用顺序问题。
2. 第二轮用 `ALTER TABLE` 补 FK 更稳。

## 9. `conversation_messages` Drizzle 草稿

```ts
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => conversationSessions.id),
    taskId: text("task_id").references(() => tasks.id),
    runId: text("run_id").references(() => taskRuns.id),
    runNodeId: text("run_node_id").references(() => taskRunNodes.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),

    runtimeMessageId: text("runtime_message_id"),
    role: text("role").$type<ConversationMessageRole>().notNull(),
    messageIndex: integer("message_index").notNull(),

    textContent: text("text_content"),
    summaryText: text("summary_text"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),

    tokenUsed: integer("token_used"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_conversation_messages_session_message_index").on(
      table.sessionId,
      table.messageIndex,
    ),
    uniqueIndex("idx_conversation_messages_session_runtime_message_id").on(
      table.sessionId,
      table.runtimeMessageId,
    ),
    index("idx_conversation_messages_task_created_at").on(table.taskId, table.createdAt),
    index("idx_conversation_messages_run_created_at").on(table.runId, table.createdAt),
    index("idx_conversation_messages_session_created_at").on(table.sessionId, table.createdAt),
  ],
);
```

## 10. `conversation_message_parts` Drizzle 草稿

```ts
export const conversationMessageParts = pgTable(
  "conversation_message_parts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => conversationMessages.id),
    partIndex: integer("part_index").notNull(),
    partType: text("part_type").$type<ConversationMessagePartType>().notNull(),

    textContent: text("text_content"),
    jsonPayload: jsonb("json_payload").$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_conversation_message_parts_message_part_index").on(
      table.messageId,
      table.partIndex,
    ),
    index("idx_conversation_message_parts_message_id").on(table.messageId),
  ],
);
```

## 11. `task_domain_events` Drizzle 草稿

```ts
export const taskDomainEvents = pgTable(
  "task_domain_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskId: text("task_id").references(() => tasks.id),
    runId: text("run_id").references(() => taskRuns.id),
    runNodeId: text("run_node_id").references(() => taskRunNodes.id),
    sessionId: text("session_id").references(() => conversationSessions.id),

    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_domain_events_task_seq").on(table.taskId, table.seq),
    index("idx_task_domain_events_run_created_at").on(table.runId, table.createdAt),
    index("idx_task_domain_events_session_created_at").on(table.sessionId, table.createdAt),
  ],
);
```

注意：

1. `seq` 使用 `bigint` 与文档1 SQL DDL 保持一致，`mode: "number"` 在 JS 可安全范围内使用。
2. 第一轮重点是事件模型与 projector 对接，不强求完美事件 taxonomy。

## 12. `task_snapshots` Drizzle 草稿

```ts
export const taskSnapshots = pgTable(
  "task_snapshots",
  {
    taskId: text("task_id")
      .primaryKey()
      .references(() => tasks.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),

    currentStatus: text("current_status").$type<TaskDomainStatus>().notNull(),
    orchestrationKind: text("orchestration_kind").$type<TaskOrchestrationKind>(),
    currentRunId: text("current_run_id"),
    currentSessionId: text("current_session_id"),

    latestResult: text("latest_result"),
    latestResultSummary: text("latest_result_summary"),
    latestErrorText: text("latest_error_text"),

    activeCandidateCount: integer("active_candidate_count").notNull().default(0),
    completedCandidateCount: integer("completed_candidate_count").notNull().default(0),
    failedCandidateCount: integer("failed_candidate_count").notNull().default(0),
    totalChainSteps: integer("total_chain_steps").notNull().default(0),
    completedChainSteps: integer("completed_chain_steps").notNull().default(0),

    winnerNodeId: text("winner_node_id"),
    lastActivityAt: text("last_activity_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_snapshots_project_status_last_activity").on(
      table.projectId,
      table.currentStatus,
      table.lastActivityAt,
    ),
    index("idx_task_snapshots_project_updated_at").on(table.projectId, table.updatedAt),
  ],
);
```

## 13. `task_timeline_views` Drizzle 草稿

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
    runId: text("run_id").references(() => taskRuns.id),
    runNodeId: text("run_node_id").references(() => taskRunNodes.id),
    sessionId: text("session_id").references(() => conversationSessions.id),
    messageId: text("message_id").references(() => conversationMessages.id),

    itemKind: text("item_kind").notNull(),
    itemRole: text("item_role"),
    title: text("title"),
    displayText: text("display_text"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),

    sortAt: text("sort_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_task_timeline_views_task_sort_at").on(table.taskId, table.sortAt, table.createdAt),
    index("idx_task_timeline_views_run_sort_at").on(table.runId, table.sortAt, table.createdAt),
    index("idx_task_timeline_views_session_sort_at").on(
      table.sessionId,
      table.sortAt,
      table.createdAt,
    ),
  ],
);
```

## 14. 现有表 bridge 字段草稿

### 14.1 `project_tree_nodes`

历史草案新增：

```ts
refType: text("ref_type"),
refId: text("ref_id"),
```

首轮仅加字段和索引，不加 FK。

历史索引草案：

```ts
index("idx_ptn_ref_type_ref_id").on(table.refType, table.refId)
```

### 14.2 `agent_runs`

历史草案新增：

```ts
runId: text("run_id").references(() => taskRuns.id),
runNodeId: text("run_node_id").references(() => taskRunNodes.id),
```

历史索引草案：

```ts
index("idx_agent_runs_run_id").on(table.runId),
index("idx_agent_runs_run_node_id").on(table.runNodeId),
```

### 14.3 `runtime_usage_ledgers`

历史草案新增：

```ts
runId: text("run_id").references(() => taskRuns.id),
runNodeId: text("run_node_id").references(() => taskRunNodes.id),
```

### 14.4 `runtime_usage_ledger_steps`

历史草案新增：

```ts
runId: text("run_id").references(() => taskRuns.id),
runNodeId: text("run_node_id").references(() => taskRunNodes.id),
```

## 15. Migration 历史编号草案

### `0013_task_domain_core.sql`

内容：

1. `tasks`
2. `task_runs`
3. `task_run_nodes`
4. `task_run_edges`

### `0014_task_domain_conversations.sql`

内容：

1. `conversation_sessions`
2. `conversation_messages`
3. `conversation_message_parts`

### `0015_task_domain_projections.sql`

内容：

1. `task_domain_events`
2. `task_snapshots`
3. `task_timeline_views`

### `0016_task_domain_bridges.sql`

内容：

1. `project_tree_nodes.ref_type/ref_id`
2. `agent_runs.run_id/run_node_id`
3. `runtime_usage_ledgers.run_id/run_node_id`
4. `runtime_usage_ledger_steps.run_id/run_node_id`

### `0017_task_domain_indexes.sql`

内容：

1. `conversation_messages` 上 `pg_trgm` 和搜索索引
2. projection 表补充排序索引
3. 高频过滤索引补齐

## 16. 历史第一轮编码范围

在当时的实施起点里，文档按分批落地思路，只优先覆盖以下范围：

1. `tasks`
2. `task_runs`
3. `task_run_nodes`
4. `task_run_edges`
5. `agent_runs.run_id`
6. `agent_runs.run_node_id`

原因：

1. 这是 legacy runtime plan（`executionPlan`）替代的最小闭环
2. 能先统一 single / parallel / sequential-chain 的执行建模
3. 对现有 BFF/service 改动面最可控

## 17. 历史实施起点说明

状态注记：本节属于历史实施起点，现已兑现。`0013+` migration 与对应 schema 已落地，因此这里不再保留“先写 schema 还是先写 SQL 草案”的未来式表述。

## 18. 当前 schema 已实现项 / 可删除的草稿假设 / 下一轮 cleanup DDL

这一节用于把本文档中的“Schema 草稿”与当前仓库真实实现状态对齐，区分哪些内容已经进入正式 schema，哪些内容仍属于当时的过渡性假设，以及下一轮应该补哪些 cleanup DDL。

### 18.1 当前 schema 已实现项

以下草稿内容已经不再只是设计，而是已经进入当前仓库的正式 schema 与 migration 链。

1. `tasks` 已进入正式 schema。
2. `task_runs`、`task_run_nodes`、`task_run_edges` 已进入正式 schema。
3. `conversation_sessions`、`conversation_messages`、`conversation_message_parts` 已进入正式 schema。
4. `task_domain_events`、`task_snapshots`、`task_timeline_views` 已进入正式 schema。
5. `project_tree_nodes.ref_type/ref_id` 已进入 bridge migration。
6. `agent_runs.run_id/run_node_id` 已进入 bridge migration。
7. `runtime_usage_ledgers.run_id/run_node_id` 已进入 bridge migration。
8. `runtime_usage_ledger_steps.run_id/run_node_id` 已进入 bridge migration。
9. `conversation_messages` 的搜索与排序相关索引、projection 表的补充索引已经进入 `0017_task_domain_indexes.sql`。

因此本文档第 4 节到第 15 节中，大部分核心表与 migration 编号草案已经完成落地，不再是“待编码草图”。

### 18.2 可删除的草稿假设

以下假设在文档撰写时是为了降低首轮落地复杂度，但按当前实现状态，已经可以从“核心假设”降为“历史说明”，后续可逐步删除或改写。

1. “推荐编号从 `0013` 开始”这一假设已经兑现，当前应改为“已落地编号事实”，而不是未来语气。
2. “第一轮只做新增、不修改旧逻辑依赖”这一假设已不完全成立，因为当前仓库已经进入 projection-first、dual-write、replay、bridge 引用等实际接线阶段。
3. “`currentRunId`、`winnerNodeId`、`judgeNodeId` 等 FK 先不做，第二轮再补”这一类假设需要重新核对正式 schema 与 migration 是否仍然保留该策略；若正式实现已确定，应从本文档中删除模糊表述，改成现状说明。
4. “第一轮只做 core schema”这一假设已经过时，因为 conversations、projections、bridges、indexes 都已经一并落地。
5. “当时的二选一实施起点：先写 schema.pg.ts 或先写 0013 SQL 草案”这一段已经过时，当前文档应理解为历史实施起点，而不是现阶段动作说明。

换句话说，本文档后半部分仍保留了不少“尚未开始实现时的时间语气”，这些内容现在可以逐步清理，避免误导后续阅读者以为 schema 还停留在前期设计阶段。

### 18.3 当前仍保留的过渡性 schema 状态

虽然核心 schema 已经实现，但下列状态说明 schema 层仍处于“新旧模型并存”的过渡期。

1. `executionPlan`、`parallelRunHistory` 仍然作为历史兼容字段存在于旧 schema 语境中，但已经从 service / BFF 主路径和运行时 tree 数据中退出。
2. `project_tree_nodes.content_json` 仍保留少量 task 兼容字段，树节点职责瘦身尚未完全结束，但已经不再承担“大量 task 业务事实主存储”的角色。
3. `project_tree_events` 当前只存在于历史 migration、历史索引和历史设计草稿语境中；现行 runtime schema 已删表，因此这里不应再被理解为可直接使用的运行时读取链路。
4. 新表已经是正式 schema，但旧字段还未经历一轮明确的 cleanup migration。

这意味着当前问题已经不是“缺表”，而是“需要继续维护历史 schema 收尾说明、cleanup DDL 占位和旧模型退役文档动作”。

### 18.4 Cleanup DDL 状态注记

按当前仓库状态，schema/migration 的后续动作已经不再是新增核心表，而是围绕旧模型退役维护 cleanup DDL 占位或 cleanup migration 文档。

当前更适合优先按以下几类 cleanup 变更理解收尾范围：

1. 关于旧字段退役的 migration 说明，本文统一结论是：`executionPlan`、`parallelRunHistory` 应继续停留在历史兼容字段定位，不再回到主写/主读语义。
2. 对 `project_tree_events` 相关历史 migration 与历史索引保留停读/归档说明，明确它只属于历史建模与演进解释语境，而不是当前运行时数据面。
3. 为 `project_tree_nodes.content_json` 制定瘦身白名单，把 task 业务事实字段与导航/缓存字段明确拆分。
4. 视正式 schema 现状，补充或确认仍缺失的 FK、唯一约束、索引命名统一项，避免“首轮先不加、后续也没补”的悬空状态。
5. 若确认旧字段长期保留但不再主用，可补 comment/文档约束，明确这些列只服务历史兼容与清理语境，防止新代码继续把它们当主模型写入。

### 18.5 cleanup migration 文档占位项

如果继续维护本文档，更合适的方向是保留一组 cleanup migration 占位章节，而不是继续扩写 core schema。

1. `0018_task_domain_legacy_write_deprecation.sql` 的设计说明。
2. `0019_task_domain_tree_payload_shrink.sql` 的设计说明。
3. `0020_task_domain_legacy_message_snapshot_retirement.sql` 的设计说明。

这些编号不要求立刻落地，但它们可以继续作为文档化收尾任务的占位，把“旧模型退出”维持在可追踪的 migration backlog 中。

### 18.6 本文档的现阶段角色

在当前仓库状态下，这份文档已经不应再被当作“等待开始编码的 schema 草稿”，而应被看作：

1. 对已落地任务域 schema 的设计来源说明。
2. 对首轮 schema 折中策略的历史记录。
3. 为下一轮 cleanup DDL 和旧字段退役提供边界约束的参考文档。

也就是说，本文档后续最有价值的更新方向，不是再补更多核心表定义，而是持续维护：

1. 哪些草稿假设已经兑现并可删。
2. 哪些兼容字段仍存在并需退役。
3. 哪些 cleanup DDL 应进入下一轮 migration backlog。
