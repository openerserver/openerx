# 当前表结构冗余审查（仅文档）

- 日期：2026-04-02
- 范围：当前 PostgreSQL Drizzle 定义
- 来源： [control-plane/service/src/db/schema.pg.ts](control-plane/service/src/db/schema.pg.ts)
- 约束：本文件只做结构审查，不涉及任何实际数据库操作

## 审查结论（摘要）

当前主要冗余不是单表字段多，而是“新旧模型并存 + 下游引用未切换”。

核心表现：

1. 会话域存在新旧双轨表并存。
2. `task_sessions` 与 `task_session_runs` 存在 run 语义重叠。
3. 下游汇总/视图类表仍主要引用旧消息与旧操作表。
4. `tasks` 聚合根保留了新旧生命周期字段并存。
5. 用量/成本在多层重复记录，存在多口径风险。

## 冗余清单（按优先级）

### P0-1 会话消息与操作双轨冗余

新模型：

- [control-plane/service/src/db/schema.pg.ts#L914](control-plane/service/src/db/schema.pg.ts#L914) `task_messages`
- [control-plane/service/src/db/schema.pg.ts#L952](control-plane/service/src/db/schema.pg.ts#L952) `task_message_parts`
- [control-plane/service/src/db/schema.pg.ts#L977](control-plane/service/src/db/schema.pg.ts#L977) `task_operations`

旧模型：

- [control-plane/service/src/db/schema.pg.ts#L1017](control-plane/service/src/db/schema.pg.ts#L1017) `task_session_messages`
- [control-plane/service/src/db/schema.pg.ts#L1072](control-plane/service/src/db/schema.pg.ts#L1072) `task_session_message_parts`
- [control-plane/service/src/db/schema.pg.ts#L1102](control-plane/service/src/db/schema.pg.ts#L1102) `session_operations`

问题描述：

- 同一业务语义由两套表承载。
- 容易出现双写、漏写、读路径分叉和语义漂移。

建议 canonical：

- 会话可见消息：`task_messages` + `task_message_parts`
- 执行动作事实：`task_operations`

### P0-2 task_sessions 与 task_session_runs 语义重叠

涉及位置：

- [control-plane/service/src/db/schema.pg.ts#L765](control-plane/service/src/db/schema.pg.ts#L765) `task_sessions`
- [control-plane/service/src/db/schema.pg.ts#L858](control-plane/service/src/db/schema.pg.ts#L858) `task_session_runs`

重叠字段类型：

- runtime 标识：`runtimeSessionId`
- 执行状态：`executionStatus` vs `status`
- 并行编排：`coordinationKey` / `candidateIndex`
- 用量成本：`inputTokens` / `outputTokens` / `totalTokens` / `costUsd`
- 执行时间：`startedAt` / `finishedAt`

问题描述：

- session node 和 run attempt 边界混叠。
- 统计与追踪口径可能不一致。

建议 canonical：

- session 只承载树节点语义。
- run 只承载执行尝试语义。

### P0-3 下游表仍绑定旧消息/旧操作模型

涉及位置：

- [control-plane/service/src/db/schema.pg.ts#L1187](control-plane/service/src/db/schema.pg.ts#L1187) `task_artifacts`
- [control-plane/service/src/db/schema.pg.ts#L1226](control-plane/service/src/db/schema.pg.ts#L1226) `task_usage_ledger_entries`
- [control-plane/service/src/db/schema.pg.ts#L1271](control-plane/service/src/db/schema.pg.ts#L1271) `task_timeline_views`

当前绑定：

- `messageId` 指向 `task_session_messages`
- `operationId` 指向 `session_operations`

问题描述：

- 即使上层切到新模型，下游仍会被旧模型锁定。
- 冗余会持续固化，影响后续收敛。

建议 canonical：

- 下游统一对齐到 `task_messages` 和 `task_operations`。

### P1-1 tasks 聚合根新旧生命周期字段并存

涉及位置：

- [control-plane/service/src/db/schema.pg.ts#L589](control-plane/service/src/db/schema.pg.ts#L589) `tasks`

表现：

- 新字段：`lifecycleStatus`、`activatedAt`、`doneAt`、`archivedAt`
- 旧字段：`status`、`currentSessionId`、`latestResult`、`startedAt`、`finishedAt` 等（源码注释已标记 legacy）

问题描述：

- 聚合根真值字段重复，业务读写可能混用。

建议 canonical：

- 任务生命周期只保留新字段集。
- 旧字段只作为兼容读取，不继续承接新语义。

### P1-2 用量与成本多口径冗余

涉及位置：

- [control-plane/service/src/db/schema.pg.ts#L695](control-plane/service/src/db/schema.pg.ts#L695) `cost_records`
- [control-plane/service/src/db/schema.pg.ts#L858](control-plane/service/src/db/schema.pg.ts#L858) `task_session_runs`
- [control-plane/service/src/db/schema.pg.ts#L1102](control-plane/service/src/db/schema.pg.ts#L1102) `session_operations`
- [control-plane/service/src/db/schema.pg.ts#L1226](control-plane/service/src/db/schema.pg.ts#L1226) `task_usage_ledger_entries`

问题描述：

- 成本与 token 在 run、operation、ledger、cost record 多处重复记录。
- 若未定义主账本，报表口径容易分裂。

建议 canonical：

- 主账本以 `task_usage_ledger_entries` 为准。
- 其他表仅保留摘要字段或缓存字段。

### P2-1 已解决：agent_runs 与 run 体系重叠

涉及位置：

- [control-plane/service/src/modules/tasks/agent-run-compat.ts](control-plane/service/src/modules/tasks/agent-run-compat.ts)
- [control-plane/service/src/modules/tasks/task-agent-run-read-routes.ts](control-plane/service/src/modules/tasks/task-agent-run-read-routes.ts)
- [control-plane/service/src/modules/tasks/task-agent-run-write-routes-canonical.ts](control-plane/service/src/modules/tasks/task-agent-run-write-routes-canonical.ts)
- [control-plane/service/drizzle-pg/0033_drop_agent_runs.sql](control-plane/service/drizzle-pg/0033_drop_agent_runs.sql)

问题描述：

- 这项重叠已经在当前 schema 中收口：`agent_runs` 已删除，兼容 `agentRunId` 读写改由 canonical task-domain 表投影与回写。

建议 canonical：

- 业务主链路执行事实统一由 `task_sessions`、`task_session_runs`、`task_operations` 承接。
- 对外仍可保留 `agentRunId` 兼容接口，但不再恢复独立 `agent_runs` 表。

## 影响评估

1. 读路径复杂度上升：需要在新旧模型间选择或回退。
2. 写路径一致性风险：双写容易出现部分成功。
3. 报表口径漂移：同一指标在多表可计算且结果不同。
4. 测试维护成本高：同语义要覆盖两套模型。

## 文档化收敛目标（不含执行动作）

1. Session Tree Node：`task_sessions`
2. Session Run Attempt：`task_session_runs`
3. Message Canonical：`task_messages` + `task_message_parts`
4. Operation Canonical：`task_operations`
5. Artifact Canonical：`task_artifacts`（message/operation 引用对齐新模型）
6. Usage Canonical Ledger：`task_usage_ledger_entries`
7. Event Log：`task_message_events`（仅调试审计）

## 附：与全量表结构文档的关系

- 全量表结构快照： [docs/current/all-table-structures.md](docs/current/all-table-structures.md)
- 本文：只标注冗余与 canonical 归属，不重复展开全部建表代码
