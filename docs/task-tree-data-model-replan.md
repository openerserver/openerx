# Task 树数据模型重规划方案（Session Node 版）

> 状态：Draft v2  
> 日期：2026-04-01  
> 作者：GitHub Copilot

## 1. 核心结论

这份文档基于一个明确前提重写：

1. 一个 `session` 就代表一轮由用户发起的对话。
2. 用户每发起一次新的追问、补充、改写、分叉尝试，就新建一个 `session` 节点。
3. task 的树形结构直接由 `session` 构成，不再引入独立的 `branch` 主表。

因此，这次重规划的结论非常直接：

1. `session` 才是 task 树的 canonical node。
2. `branch` 只保留为展示概念，不再作为独立存储实体。
3. `run` 只表示某个 session 的执行尝试，不再承担树节点语义。
4. `message` 只表示该 session 内的消息内容，不承担 task 树节点语义。
5. `event log` 只做 debug / audit，不再进入主读链。

如果按这个定义实现，那么“4 轮连续对话”就是：

1. `1` 个 task
2. `4` 个 session 节点
3. `4` 个 session run
4. 每个 session 下若干 messages / operations

而不是：

1. `1` 个 branch
2. `4` 个 runs

## 2. 为什么上一版 branch 方案不适合现在的产品语义

上一版方案假设：

1. 同一条思路线程会跨越多轮连续对话。
2. 多轮对话属于同一个树节点。
3. 只有发生 fork 时才创建新树节点。

这个前提适合“一个 session 跨多轮”的产品。

但你当前明确给出的语义是：

1. 一个 session 就是一轮对话。
2. 用户发起一次，就应该形成一个新的树节点。

在这个前提下，再额外引入 branch 会出现三个问题：

1. `branch` 和 `session` 都在表示树节点，职责重复。
2. 一轮对话明明应该直接落成一个 session node，却被绕成“同一 branch 下的一次 run”，语义反而变模糊。
3. 前端真正要展示的是 session 树，而不是 branch 抽象层。

所以这里不应该继续引入 `task_branches`，而应该直接把 `task_sessions` 收敛成任务树节点主表。

## 3. 现状问题不是 session 这个概念错了，而是 session 表被塞了太多别的语义

当前问题的核心不是“session 不该存在”，而是“当前 task_sessions 被过载了”。

从现有实现看，至少混了四种职责：

1. 树节点关系。
2. 运行执行状态。
3. 编排语义，例如 candidate、judge、winner、step。
4. 展示摘要和统计汇总。

例如现在的 [control-plane/service/src/db/schema.pg.ts](control-plane/service/src/db/schema.pg.ts#L719) 里，`task_sessions` 同时包含：

1. `parentSessionId`、`rootSessionId` 这类树关系字段。
2. `runtimeSessionId`、`executionStatus`、`startedAt`、`finishedAt` 这类运行态字段。
3. `candidateIndex`、`stepIndex`、`winnerSessionId`、`judgeSessionId` 这类编排字段。
4. `selectedModel`、`effectiveModel`、`resultText`、`token`、`cost` 这类执行结果和统计字段。

这会直接导致：

1. session 到底是树节点还是一次运行，不清楚。
2. 树的父子关系无法和运行尝试分离。
3. 读路径必须拼一堆 fallback 才能拿到“看起来可用”的结构。

所以正确方向不是抛弃 session，而是把 session 还原成“树节点”，把运行态和调试态剥出去。

## 4. Session Node 模型的设计原则

新的方案只保留五条硬约束：

1. task 树只能从 session facts 重建，不能依赖 runtime 去重、时间猜测或 event fallback。
2. 一个新的用户回合，必须对应一个新的 session node。
3. 一个 session 内部可以有多次执行尝试，但这些尝试不应该改变树结构。
4. message 只属于一个 session，不跨 session 承担树关系。
5. event log 不能进入 UI/BFF 主读链。

由此推出四条实现原则：

1. `task_sessions` 是唯一 task tree node。
2. `task_session_runs` 是 session 的执行尝试层。
3. `task_messages` 是 session 内的可见内容层。
4. `task_event_log` 只是审计和调试层。

## 5. 新的主模型

新的主模型收敛为八类对象：

1. `tasks`：任务聚合根。
2. `task_sessions`：任务树节点，一次用户发起就是一个 session。
3. `task_session_runs`：某个 session 的一次执行尝试。
4. `task_messages`：session 内的消息节点。
5. `task_message_parts`：消息正文片段。
6. `task_operations`：工具调用、judge、hook、模型请求等低层执行事实。
7. `task_artifacts`：正式产物。
8. `task_event_log`：仅用于 debug / replay / audit 的事件流。

其中：

1. `tasks + task_sessions` 决定树。
2. `task_session_runs + task_messages + task_operations` 决定内容和执行细节。
3. `task_event_log` 不参与树重建。

这里要特别强调：

1. `workflow` 不是树节点，而是 task/session/run 的上下文信息。
2. `并行执行` 不是新的树层，而是某个 session 下的多条 run lane。
3. `工具调用` 不是 message 本体，而是挂在 run/message 下的 operation。

## 6. session 到底表示什么

这里把 session 的定义写死，避免后面继续摇摆。

### 6.1 session 的定义

一个 session 表示：

1. 用户在某个 task 下发起的一次明确回合。
2. 这次回合会带来一组新的消息、执行动作和结果。
3. 它会成为 task 树上的一个节点。

### 6.2 什么场景会创建新 session

以下场景都应创建新 session：

1. 用户首次创建任务并输入 prompt。
2. 用户基于上一轮回复继续追问。
3. 用户补充约束，开启新一轮指令。
4. 用户从历史某一轮结果处分叉，尝试另一种方案。

### 6.3 什么场景不创建新 session

以下场景不应创建新 session，而应写入同一个 session 的 run：

1. 对同一轮 prompt 重新生成 assistant 结果。
2. 同一轮响应中断后恢复执行。
3. 同一轮内部的 retry、resume、repair。

也就是说：

1. 新的一轮用户输入，创建新 session。
2. 同一轮内部的执行重试，只新增 session run。

### 6.4 三个最容易混淆的场景

这三个场景单独拍板，避免实现时再次摇摆。

#### 并行执行时，是否启动两个 session

默认不应该。

推荐规则：

1. 用户只发起了 1 轮输入，就只创建 1 个 session。
2. 如果这一轮内部需要并行候选，就在这个 session 下创建 2 个或更多 run。
3. 这些 run 通过 `coordinationKey + candidateIndex + laneRole` 组成并行组。

为什么不直接起两个 session：

1. 用户只发起了 1 次回合，不应该平白多出两个树节点。
2. 两个 candidate 本质是同一轮的并行执行 lane，不是两次新的对话发起。
3. 如果把 candidate 直接建成两个 session，session tree 会被系统内部执行策略污染。

例外：

1. 如果用户明确选择某个并行结果继续追问，下一轮才创建新的子 session。

#### judge 时，是否再启动一个 session

默认也不应该。

推荐规则：

1. judge 属于当前 session 内部的一条特殊 run。
2. `laneRole = judge`，`executionKind = judge`。
3. judge 的结果可以落成 operation、artifact、summary，但不应额外制造树节点。

为什么：

1. judge 是系统内部的比较/裁决动作，不是新的用户对话轮次。
2. 如果每次 judge 都创建 session，树上会充满用户根本不想看的内部决策节点。

例外：

1. 如果产品明确要求“judge 结论本身要成为一个可单独续聊的节点”，那可以把“基于 judge 结论继续”的那一轮建成新 session，但 judge 本身仍不建议直接当 session。

#### workflow 的每一步，是否都启动一个 session

默认不应该。

推荐规则：

1. workflow step 默认只是 task/session/run 的上下文状态变化。
2. workflow 阶段推进、审批检查、自动校验、收尾动作，优先落到 workflow snapshot、run、operation 或 artifact。
3. 只有当 workflow 真的产生了“新的用户可见回合”时，才创建新的 session。

什么叫“新的用户可见回合”：

1. workflow 自动生成了一条新的 follow-up prompt。
2. workflow 从上一轮结果派生出一条新的处理路径，且用户会把它当成新的节点继续操作。
3. workflow 触发了一个需要人工处理的新阶段任务。

什么不该创建 session：

1. 阶段状态从 `discover` 变成 `design`。
2. 自动跑一次 verify。
3. 自动做一次审批检查。
4. 自动做一次 finalize 或 artifact 汇总。

一句话规则：

1. session 只代表新的“回合”。
2. 并行、judge、workflow step 默认都是这个回合内部的执行细节。
3. 只有当系统真的产生了新的可操作轮次，才升级成新的 session。

### 6.5 底层 OpenCode 独立 session 与上层 run 的映射

这是这套模型能否落地的关键点。

当前底层 OpenCode 在执行时，确实经常会为不同 lane 启动独立的 runtime session：

1. 单次执行有自己的 runtime session。
2. 并行 candidate A、B 各有自己的 runtime session。
3. judge 也可能有自己的 runtime session。
4. resume / retry 也可能切到新的 runtime session。

这并不与上层 session-node 语义冲突，前提是映射关系要明确：

1. 上层 `task_session` 表示一次用户可见回合。
2. 底层每一个 OpenCode `runtime session` 映射为一条 `task_session_run`。
3. 也就是说，`runtime_session_id` 属于 run，不属于 session node。

推荐映射规则：

1. 1 个用户回合 = 1 个 `task_session`
2. 1 个 OpenCode `runtime session` = 1 个 `task_session_run`
3. 1 个 `task_session` 可以挂 1 个或多个 `task_session_run`

这样就能表达下面这些情况：

1. 单执行：1 个 session，1 个 run，1 个 runtime session。
2. 并行候选：1 个 session，2 个 candidate run，2 个 runtime session。
3. judge：仍是当前 session 下的 1 个 judge run，对应 1 个 runtime session。
4. retry/resume：仍是当前 session 下的新 run，对应新的 runtime session。

#### 能否把底层执行结果收集到多个 run 里

可以，而且应该这么做。

推荐收集方式：

1. 每条 runtime session 的 assistant 输出、tool call、judge 输出、usage/cost 都收进对应的 run。
2. `task_messages.created_by_run_id` 明确指向产出这条消息的 run。
3. `task_operations.run_id` 明确指向这次 tool/judge/hook 属于哪条 run。
4. 如果有 artifact，也挂到对应 run 或 session。

#### 需要避免的问题

不能把底层 runtime session 原样抬升成上层 session tree，否则会出两个问题：

1. 并行候选会把一轮用户输入错误膨胀成多个树节点。
2. judge / retry / resume 会把系统内部执行细节污染成对话树。

#### candidate user prompt 的去重规则

并行 candidate 的底层 runtime session 可能会各自回放一遍同样的 user prompt。

上层推荐规则：

1. 这条 user prompt 在 `task_session` 级只保留一份 canonical message。
2. candidate runtime session 自带的重复 prompt 不再扩增为多条新的 session message。
3. candidate 之间真正需要分开的，是 assistant 输出、tool call、judge 结果和 usage。

一句话总结：

1. 底层 OpenCode 的独立 session 是执行单元。
2. 上层 task tree 的 session 是用户回合单元。
3. 二者之间通过 `task_session_runs.runtime_session_id` 做映射。

## 7. 推荐表结构

### 7.1 tasks

保留任务聚合根，只保存任务级事实：

1. `id`
2. `project_id`
3. `title`
4. `status`
5. `root_session_id`
6. `current_session_id`
7. `summary`
8. `created_at`
9. `updated_at`

禁止把 session/run/message 级字段继续塞回 task。

### 7.2 task_sessions

这是树的唯一主表。

建议字段：

1. `id`
2. `task_id`
3. `project_id`
4. `tree_node_id`
5. `parent_session_id`
6. `root_session_id`
7. `source_message_id`
8. `session_type`
9. `workflow_stage_key`
10. `spawn_trigger_type`
11. `spawn_rule_key`
12. `user_prompt_summary`
13. `status`
14. `head_message_id`
15. `latest_run_id`
16. `depth`
17. `sort_key`
18. `archived_at`
19. `created_at`
20. `updated_at`

约束：

1. `parent_session_id` 是树父子关系唯一来源。
2. `source_message_id` 指向父 session 中触发当前 session 的那条 message。
3. root session 的 `parent_session_id` 和 `source_message_id` 必须为 `null`。
4. task 树只能从 `task_sessions` 重建，不能从 timeline/event 推导。
5. `workflow_stage_key` 是 session 创建时的 workflow 阶段快照，不代表整个 task 的唯一阶段历史。

### 7.3 task_session_runs

这是 session 的执行尝试层。

建议字段：

1. `id`
2. `task_id`
3. `session_id`
4. `attempt_index`
5. `runtime_session_id`
6. `trigger_type`
7. `execution_kind`
8. `coordination_key`
9. `candidate_index`
10. `lane_role`
11. `executor_kind`
12. `model_route`
13. `workflow_stage_key`
14. `status`
15. `input_tokens`
16. `output_tokens`
17. `total_tokens`
18. `cost_usd`
19. `result_summary`
20. `error_text`
21. `started_at`
22. `finished_at`
23. `created_at`

约束：

1. 一个 session 可以有多次 run。
2. run 的失败和重试不改变树结构。
3. run 是 trace/debug 主入口，不是树节点。
4. 当同一轮用户输入触发并行候选、judge、repair、resume 时，这些 lane 都应落在 run 层，而不是把 session 再拆成假的树节点。
5. 每个底层 OpenCode `runtime session` 应一对一映射到一条 run，并用 `runtime_session_id` 作为幂等与回放键。

一轮 prompt 到最终 reply 的闭环语义：

1. 用户发起 1 条 prompt，先创建 1 个 session，并写入 1 条 user message。
2. 这条 prompt 后面的执行过程可以产生 1 条或多条 run；run 里再继续拆成多条 operation。
3. 所以“从 prompt 到最终回复之间”并不都是 run；run 只是执行尝试层，tool、judge、resume 等更细步骤属于 operation。
4. 这一轮真正对用户可见的“最后回复”必须单独记录为 1 条 assistant message，不能只放在 run summary 或 operation 里。
5. session 的结尾由这条 canonical assistant message 来承接：`task_sessions.head_message_id` 指向它，`task_sessions.latest_run_id` 指向产出它的最后一条有效 run。
6. 如果这一轮执行失败且没有产出最终 assistant 回复，session 可以停在 `failed` 或 `interrupted`，此时 `head_message_id` 仍指向上一条已完成 message，不能伪造一条“结尾 message”。

### 7.4 task_messages

这是 session 内的可见消息主表。

建议字段：

1. `id`
2. `task_id`
3. `session_id`
4. `created_by_run_id`
5. `role`
6. `message_kind`
7. `parent_message_id`
8. `reply_to_message_id`
9. `seq`
10. `text_preview`
11. `part_count`
12. `token_used`
13. `status`
14. `created_at`
15. `updated_at`
16. `completed_at`

约束：

1. message 只能属于一个 session。
2. `parent_message_id` 只表达 session 内部的消息关系，不跨 session。
3. 如果需要表达“当前 session 是由上一轮哪条回复触发的”，用 `task_sessions.source_message_id`，不要把跨 session 关系塞到 message 里。
4. user message 的 `created_by_run_id` 可以为 `null`；assistant message 通常会关联某个 run。
5. 并行 candidate runtime session 如果重复回放同一条 user prompt，主读链应只保留 session 级 canonical user message，不再把这些重复 prompt 展开成多条 sibling message。
6. 一个已完成 session 通常至少有两条 canonical message：本轮 user message 和本轮最终 assistant message；后者才是这轮 session 的自然结尾。
7. 并行 candidate/judge 过程中如果需要保留多个 assistant 输出，可以继续写 message，但仍应明确其中哪一条是 session 的 canonical 结尾，并由 `head_message_id` 指向它。

把这条规则翻成 schema 约束，建议直接落成下面几类约束：

1. 给 `task_messages` 增加唯一键 `(session_id, id)`，给 `task_session_runs` 增加唯一键 `(session_id, id)`，这样后面才能做“必须属于同一个 session”的复合外键。
2. 给 `task_sessions` 增加延迟外键：`(id, head_message_id) -> task_messages(session_id, id)`，保证 `head_message_id` 指向的 message 一定属于当前 session。
3. 给 `task_sessions` 增加延迟外键：`(id, latest_run_id) -> task_session_runs(session_id, id)`，保证 `latest_run_id` 指向的 run 一定属于当前 session。
4. 给 `task_messages` 增加延迟外键：`(session_id, created_by_run_id) -> task_session_runs(session_id, id)`，保证 assistant message 的 `created_by_run_id` 不会串到别的 session。
5. 给 `task_messages` 增加普通 check：`role = user -> created_by_run_id is null`；`status = completed -> completed_at is not null`。
6. 给 `task_session_runs` 增加普通 check：`status = completed -> finished_at is not null`。
7. 给 `task_sessions` 增加一个 deferred trigger，例如 `validate_session_terminal_state()`，专门校验跨表闭环规则，因为这些规则无法仅靠单表 check 完成。

`validate_session_terminal_state()` 至少要校验：

1. 当 `task_sessions.status = completed` 时，`head_message_id` 和 `latest_run_id` 都必须非空。
2. `head_message_id` 指向的 message 必须满足：`role = assistant`、`status = completed`、`session_id = task_sessions.id`。
3. `latest_run_id` 指向的 run 必须满足：`status = completed`、`session_id = task_sessions.id`。
4. `head_message_id` 指向的 message 必须满足 `created_by_run_id = latest_run_id`，也就是“这条最终 assistant 回复就是由这条最终有效 run 产出的”。
5. 当 `task_sessions.status in (failed, interrupted)` 且没有最终回复时，不强制要求 assistant message 存在；但如果 `head_message_id` 非空，它指向的必须仍然是当前 session 内一条已完成 message。
6. 不要再额外增加 `final_message_id` 一类冗余字段；`head_message_id + latest_run_id + created_by_run_id` 的闭环已经足够表达“这一轮以哪条回复结束”。

### 7.5 task_message_parts

完整正文和结构化内容只放在 parts。

建议字段：

1. `id`
2. `message_id`
3. `part_index`
4. `part_type`
5. `text_content`
6. `json_payload`
7. `created_at`

规则：

1. 完整正文以 parts 为准。
2. `text_preview` 只服务于列表/树摘要，不承载完整正文。

### 7.6 task_operations

工具调用、judge、hook、模型请求等低层执行事实统一挂到 operation 表。

建议字段：

1. `id`
2. `task_id`
3. `session_id`
4. `run_id`
5. `message_id`
6. `parent_operation_id`
7. `operation_kind`
8. `tool_name`
9. `title`
10. `status`
11. `summary_json`
12. `started_at`
13. `finished_at`
14. `created_at`

规则：

1. `operationKind = model_request` 只表示一次真实的模型请求，`toolName` 必须为 `null`。
2. `operationKind = tool_call` 只表示一次工具调用及其结果，`toolName` 必填。
3. 如果一次 `tool_call` 的结果随后被继续喂给模型，必须再新建一条新的 `model_request` operation，不能把同一条 operation 同时当作 `tool_call` 和 `model_request`。
4. `parentOperationId` 只表达同一 run 内的直接前序关系；如果一次 `model_request` 同时消费了多个上游 `tool_call`，就在 `summaryJson.consumedOperationIds` 里记录依赖，contract 层再投影成 `edges.operationConsumes`。
5. `messageId` 在 operation 上表示“挂到哪个可见 message 下展示”，不等于“这条 message 的正文一定由它产出”；对 `tool_call` 来说它可以是 `null`，也可以指向最终展示这次工具活动的 assistant message。

### 7.7 task_event_log

这是纯调试层。

建议字段：

1. `id`
2. `task_id`
3. `session_id`
4. `run_id`
5. `message_id`
6. `operation_id`
7. `event_type`
8. `payload`
9. `created_at`

约束：

1. event log 不参与树重建。
2. event log 不参与主消息聚合。
3. event log 只能从 internal/debug route 暴露。

## 8. 对当前 task_sessions 的瘦身要求

既然保留 `task_sessions` 作为主表，就必须明确哪些字段要从当前实现中移出去。

### 8.1 留在 task_sessions 的字段

1. `id`
2. `taskId`
3. `projectId`
4. `treeNodeId`
5. `parentSessionId`
6. `rootSessionId`
7. `createdAt`
8. `updatedAt`
9. `archivedAt`

以及这次建议新增或重定义的字段：

1. `sourceMessageId`
2. `sessionType`
3. `userPromptSummary`
4. `headMessageId`
5. `latestRunId`
6. `depth`
7. `sortKey`
8. `status`

### 8.2 必须迁到 task_session_runs 的字段

下面这些都不该继续留在 node 表里：

1. `runtimeSessionId`
2. `triggerType`
3. `executionModeSnapshot`
4. `executionStatus`
5. `selectedModel`
6. `effectiveModel`
7. `resultText`
8. `resultSummary`
9. `errorText`
10. `inputTokens`
11. `outputTokens`
12. `totalTokens`
13. `costUsd`
14. `lastActivityAt`
15. `startedAt`
16. `finishedAt`

### 8.3 需要单独评估后删除或外迁的编排字段

这些字段都不是 session tree node 的基础属性：

1. `coordinationKey`
2. `candidateIndex`
3. `stepIndex`
4. `winnerSessionId`
5. `judgeSessionId`

它们应该进入更明确的 orchestration/read-model 层，而不是继续混在 canonical session node 表里。

推荐去向如下：

| 旧字段 | 建议去向 | 是否改名 | 原因 |
| --- | --- | --- | --- |
| `coordinationKey` | `task_session_runs.coordination_key`，必要时再投影到 `parallelGroups.coordinationKey` | 否 | 它表达的是同一轮内部并行/judge lane 的分组键，属于 run 组，不属于 session node |
| `candidateIndex` | `task_session_runs.candidate_index` | 否 | 它表达的是并行候选在同组 run 里的序号，属于 run lane 元信息 |
| `stepIndex` | 两种去向：如果是内部顺序执行链，放 `task_session_runs.step_index`；如果已经形成新的用户可见回合，就不要再存 `stepIndex`，直接用新的 child session 表达 | 视情况 | 它有两种语义：内部链路顺序，或用户可见轮次顺序；后者不应再靠编号冒充树结构 |
| `winnerSessionId` | 不再保留原名；改成 `parallelGroups.winnerRunId` 或 `task_session_runs.winner_run_id` 的组级投影字段 | 是，改成 `winnerRunId` | 在 session-node 模型里，winner 选中的是同一 session 内的一条 run，不是一个新的 session 节点 |
| `judgeSessionId` | 不再保留原名；改成 `parallelGroups.judgeRunId` 或 `task_session_runs.judge_run_id` 的组级投影字段 | 是，改成 `judgeRunId` | judge 是当前 session 内的一条 judge run，不是树节点 |

进一步拍板如下：

1. `coordinationKey`、`candidateIndex` 保留，但下沉到 run 层。
2. `stepIndex` 不再默认挂在 session 上；只有“内部顺序链”才保留在 run 层。
3. `winnerSessionId`、`judgeSessionId` 两个名字在 session-node 方案里应直接废弃。
4. 如果历史兼容接口还需要这两个字段，应只在 read projection 层临时做 alias，不再作为 canonical storage 名称。

一句话总结：

1. 分组和候选编号属于 run。
2. 顺序步骤编号只属于内部链路，不属于树节点。
3. winner 和 judge 在这套模型里都应该指向 run，而不是 session。

### 8.3.1 当前 schema.pg.ts `task_sessions` 逐字段归类清单

下面这张表直接对应 [control-plane/service/src/db/schema.pg.ts](control-plane/service/src/db/schema.pg.ts#L719) 当前 `task_sessions` 字段定义。

| 当前字段 | 处理方式 | 目标位置 | 说明 |
| --- | --- | --- | --- |
| `id` | 保留 | `task_sessions.id` | session tree node 主键 |
| `taskId` | 保留 | `task_sessions.task_id` | 所属 task 的外键 |
| `projectId` | 保留 | `task_sessions.project_id` | 所属 project 的外键 |
| `treeNodeId` | 保留 | `task_sessions.tree_node_id` | 与 project tree 的桥接字段 |
| `parentSessionId` | 保留 | `task_sessions.parent_session_id` | 树父子关系唯一来源 |
| `rootSessionId` | 保留 | `task_sessions.root_session_id` | 根 session 指针 |
| `coordinationKey` | 挪到 run | `task_session_runs.coordination_key` | 同一轮内部并行/judge lane 的分组键 |
| `sessionKind` | 删除 | 拆分为 `task_sessions.session_type` + `task_session_runs.execution_kind` + `task_session_runs.lane_role` | 当前字段混合了 node 语义和 execution lane 语义，不适合原样保留 |
| `triggerType` | 挪到 run | `task_session_runs.trigger_type` | 这是执行触发方式，不是树节点属性 |
| `executionModeSnapshot` | 挪到 run | `task_session_runs.execution_kind`，必要时投影到 `parallelGroups.executionMode` | 这是执行模式快照，不是 session tree node 属性 |
| `executionStatus` | 挪到 run | `task_session_runs.status` | 这是某次执行尝试的状态；session 自身只保留聚合后的 node 状态 |
| `branchName` | 改名后进 projection | `sessionSummary.displayTitle` 或 `task tree projection.displayLabel` | 当前更像展示标签，不应继续作为 canonical node 字段 |
| `candidateIndex` | 挪到 run | `task_session_runs.candidate_index` | 并行候选 lane 序号 |
| `stepIndex` | 挪到 run | `task_session_runs.step_index` | 仅内部顺序链保留；如果已形成新的用户回合，则不再靠编号表达 |
| `runtimeSessionId` | 挪到 run | `task_session_runs.runtime_session_id` | 底层 OpenCode runtime session 与 run 的一对一映射键 |
| `forkedFromMessageId` | 保留 | `task_sessions.source_message_id` | 当前名字过窄；在 session-node 模型里应泛化为来源 message |
| `selectedModel` | 挪到 run | `task_session_runs.requested_model_route` 或并入 run summary 模型字段 | 这是执行配置，不是 node 属性 |
| `effectiveModel` | 挪到 run | `task_session_runs.model_route` | 这是实际运行模型，应归 run summary |
| `winnerSessionId` | 改名后进 projection | `parallelGroups.winnerRunId` 或 `task_session_runs.winner_run_id` 的组级投影 | 在 session-node 模型里 winner 指向 run，不再指向 session |
| `judgeSessionId` | 改名后进 projection | `parallelGroups.judgeRunId` 或 `task_session_runs.judge_run_id` 的组级投影 | judge 是一条 judge run，不是新的树节点 |
| `resultText` | 删除 | 结果正文进入 `task_messages` / `task_message_parts`；正式产出进入 `task_artifacts` | 不再把大段结果正文挂在 session node 上 |
| `resultSummary` | 挪到 run | `task_session_runs.result_summary` | 这属于执行线摘要结果 |
| `errorText` | 挪到 run | `task_session_runs.error_text` | 这是某次执行尝试的错误信息 |
| `inputTokens` | 挪到 run | `task_session_runs.input_tokens` | usage/cost 归 run |
| `outputTokens` | 挪到 run | `task_session_runs.output_tokens` | usage/cost 归 run |
| `totalTokens` | 挪到 run | `task_session_runs.total_tokens` | usage/cost 归 run |
| `costUsd` | 挪到 run | `task_session_runs.cost_usd` | usage/cost 归 run |
| `lastActivityAt` | 改名后进 projection | `sessionSummary.lastActivityAt` 或 `task tree projection.lastActivityAt` | 这是可由 run/message 派生的展示排序字段 |
| `startedAt` | 挪到 run | `task_session_runs.started_at` | 这是执行开始时间，不是 node 时间 |
| `finishedAt` | 挪到 run | `task_session_runs.finished_at` | 这是执行结束时间，不是 node 时间 |
| `createdAt` | 保留 | `task_sessions.created_at` | session node 创建时间 |
| `updatedAt` | 保留 | `task_sessions.updated_at` | session node 更新时间 |
| `archivedAt` | 保留 | `task_sessions.archived_at` | session node 归档状态 |

按最终处理结果汇总：

1. 保留：`id`、`taskId`、`projectId`、`treeNodeId`、`parentSessionId`、`rootSessionId`、`forkedFromMessageId(重命名为 sourceMessageId)`、`createdAt`、`updatedAt`、`archivedAt`
2. 挪到 run：`coordinationKey`、`triggerType`、`executionModeSnapshot`、`executionStatus`、`candidateIndex`、`stepIndex`、`runtimeSessionId`、`selectedModel`、`effectiveModel`、`resultSummary`、`errorText`、`inputTokens`、`outputTokens`、`totalTokens`、`costUsd`、`startedAt`、`finishedAt`
3. 改名后进 projection：`branchName`、`winnerSessionId`、`judgeSessionId`、`lastActivityAt`
4. 删除：`sessionKind`、`resultText`

补充说明：

1. `sessionKind` 之所以直接列为删除，不是因为信息不要了，而是因为它当前把 node 语义和 execution lane 语义混在一起，必须拆成新的字段后分别存放。
2. `forkedFromMessageId` 之所以列为保留，是因为它的核心语义还在，只是需要从“仅 fork 语境”扩成更一般的 `sourceMessageId`。
3. `winnerSessionId` / `judgeSessionId` 之所以列为 projection，不是因为 winner/judge 不重要，而是因为在 session-node 模型里它们不再是树节点引用，而是并行组结果视图。

### 8.4 workflow、并行执行、工具调用与 run 的关系

这三个维度不是缺失，而是要放在正确的层里。

#### workflow 信息放在哪里

workflow 信息应分成两层：

1. task 级 workflow summary：用于页面顶部显示当前模板、当前阶段、审批状态。
2. session/run 级 workflow snapshot：用于说明某个 session 或某次 run 是在什么阶段、由什么规则触发创建的。

也就是说：

1. workflow 不是树节点。
2. workflow 是挂在 task/session/run 上的上下文元信息。

#### 并行执行怎么表达

并行执行应表达为“同一个 session 下的多条 run lane”，而不是额外再造一层树节点。

建议规则：

1. 一个用户回合，对应一个 session。
2. 如果这一轮触发并行候选，就在这个 session 下生成多个 run。
3. 这些 run 通过 `coordination_key + candidate_index + lane_role` 形成并行组。
4. 如果用户随后选择某个结果继续往下聊，再从这条结果创建下一个子 session。

这样既能保留 session 树，又能表达并行。

#### 工具调用怎么表达

工具调用应统一落到 `task_operations`：

1. 每个 operation 挂到某个 `run_id`。
2. 如有必要，再挂到某个 `message_id`，表示“这条 assistant 回复是由这些工具调用支撑出来的”。
3. 页面默认展示 assistant/user message；工具调用折叠在 message 下展开。

#### run 到底有没有意义

有意义，但前提要说清楚。

run 不是树节点，它的意义是“某个 session 的一次执行尝试或执行 lane”。

run 至少解决四类问题：

1. 同一轮 prompt 的 retry / resume / repair。
2. 同一轮 prompt 的并行候选执行。
3. 同一轮内部的工具调用归属。
4. 同一轮内部的 workflow / judge / hook 执行归属。

如果未来产品被证明永远满足下面三个条件：

1. 每个 session 永远只有一次执行。
2. 不存在 retry / resume。
3. 不存在并行候选和 judge。

那 run 层可以继续收缩，甚至可被 session 吸收。

但只要 workflow、并行执行、工具调用要被稳定展示，run 仍然有明确意义。

#### session / run summary / operation / artifact 职责对照

| session 存什么 | run summary 存什么 | operation 存什么 | artifact 存什么 |
| --- | --- | --- | --- |
| 一轮用户回合的树节点信息：`parentSessionId`、`sourceMessageId`、`sessionType`、`workflowStageKey`、`headMessageId`、`latestRunId` | 一条执行线的摘要结果：`laneRole`、`modelRoute`、`status`、`resultSummary`、`token/cost`、judge 或 winner 结论 | 一条执行线里的具体动作：`toolName`、`operationKind`、`title`、输入输出摘要、开始/结束时间 | 需要长期引用的正式产物：judge scorecard、changes summary、patch、approval record、final deliverable |

说明：

1. 这里的 `run summary` 是概念名，对应 `task_session_runs` 里的摘要字段，不是要求再新增一张独立的 `run_summaries` 表。

## 9. 对外读取模型

### 9.1 正式对外只保留两种读模型

1. Task Tree
2. Task Timeline

不要再把“normalized conversation”和“raw events”这种底层物理视图当成 product contract。

### 9.2 Task Tree Contract

建议唯一主读接口：

1. `GET /api/tasks/:taskId/tree`

返回结构：

1. `task`
2. `sessions`
3. `runs`
4. `messages`
5. `messageParts`
6. `operations`
7. `artifacts`
8. `edges`

### 9.3 Task Timeline Contract

时间线是投影视图，不是事实主源。

建议保留：

1. `GET /api/tasks/:taskId/timeline`

但这条接口只能从 `task_sessions`、`task_session_runs`、`task_messages`、`task_operations`、`task_artifacts` 投影而来，不能反过来作为树重建依据。

### 9.4 Debug Contract

调试层单独走 internal/debug route：

1. `GET /internal/tasks/:taskId/event-log`
2. `GET /internal/tasks/:taskId/sessions/:sessionId/events`
3. `GET /internal/tasks/:taskId/sessions/:sessionId/runs/:runId/events`

默认不进 BFF 聚合，不进 UI 主链。

## 10. 第一版 Task Tree JSON Contract

### 10.1 Route

1. `GET /api/tasks/:taskId/tree`

### 10.2 Top-level Shape

```json
{
  "meta": {
    "contractVersion": "2026-04-01.v2",
    "taskId": "task_123",
    "currentSessionId": "session_004",
    "rootSessionId": "session_001",
    "generatedAt": "2026-04-01T12:00:00.000Z",
    "incomplete": false
  },
  "task": {
    "id": "task_123",
    "projectId": "proj_1",
    "title": "设计任务树数据模型",
    "status": "active",
    "summary": "session 是树节点，run 是执行尝试",
    "currentSessionId": "session_004",
    "rootSessionId": "session_001",
    "createdAt": "2026-04-01T10:00:00.000Z",
    "updatedAt": "2026-04-01T12:00:00.000Z"
  },
  "workflow": {
    "templateId": "wf_task_delivery",
    "currentStageKey": "implement",
    "currentStageLabel": "实现",
    "status": "running",
    "approvalState": "not_required"
  },
  "parallelGroups": [],
  "sessions": [],
  "runs": [],
  "messages": [],
  "messageParts": [],
  "operations": [],
  "artifacts": [],
  "edges": {
    "sessionParent": [],
    "sessionSource": [],
    "sessionRun": [],
    "sessionMessage": [],
    "messageParent": [],
    "messageReply": [],
    "runMessage": [],
    "messageOperation": [],
    "operationConsumes": []
  }
}
```

### 10.3 Session Node

```json
{
  "id": "session_004",
  "taskId": "task_123",
  "parentSessionId": "session_003",
  "rootSessionId": "session_001",
  "sourceMessageId": "msg_006",
  "sessionType": "follow_up",
  "workflowStageKey": "implement",
  "spawnTriggerType": "assistant_reply",
  "spawnRuleKey": null,
  "userPromptSummary": "给我一个可落地的 contract。",
  "status": "completed",
  "headMessageId": "msg_008",
  "latestRunId": "run_004",
  "depth": 3,
  "sortKey": "0000.0001.0001.0001",
  "archivedAt": null,
  "createdAt": "2026-04-01T10:13:00.000Z",
  "updatedAt": "2026-04-01T10:14:00.000Z"
}
```

### 10.4 Run Node

```json
{
  "id": "run_004",
  "taskId": "task_123",
  "sessionId": "session_004",
  "attemptIndex": 1,
  "runtimeSessionId": "runtime_session_004",
  "triggerType": "user_prompt",
  "executionKind": "single",
  "coordinationKey": null,
  "candidateIndex": null,
  "laneRole": "primary",
  "executorKind": "assistant",
  "modelRoute": "openai:gpt-5.4",
  "workflowStageKey": "implement",
  "status": "completed",
  "inputTokens": 112,
  "outputTokens": 190,
  "totalTokens": 302,
  "costUsd": 0.0032,
  "resultSummary": "返回 task、sessions、runs、messages、messageParts、operations、edges。",
  "errorText": null,
  "startedAt": "2026-04-01T10:13:10.000Z",
  "finishedAt": "2026-04-01T10:14:00.000Z",
  "createdAt": "2026-04-01T10:13:10.000Z"
}
```

### 10.5 Message Node

```json
{
  "id": "msg_008",
  "taskId": "task_123",
  "sessionId": "session_004",
  "createdByRunId": "run_004",
  "role": "assistant",
  "messageKind": "reply",
  "parentMessageId": "msg_007",
  "replyToMessageId": "msg_007",
  "seq": 2,
  "textPreview": "返回 task、sessions、runs、messages、messageParts、operations、edges。",
  "partCount": 1,
  "tokenUsed": 190,
  "status": "completed",
  "createdAt": "2026-04-01T10:14:00.000Z",
  "updatedAt": "2026-04-01T10:14:00.000Z",
  "completedAt": "2026-04-01T10:14:00.000Z"
}
```

### 10.6 Operation Node

```json
{
  "id": "op_004",
  "taskId": "task_123",
  "sessionId": "session_004",
  "runId": "run_004",
  "messageId": "msg_008",
  "parentOperationId": null,
  "operationKind": "model_request",
  "toolName": null,
  "title": "主模型请求",
  "status": "completed",
  "summaryJson": {
    "promptMessageId": "msg_007"
  },
  "startedAt": "2026-04-01T10:13:10.000Z",
  "finishedAt": "2026-04-01T10:14:00.000Z",
  "createdAt": "2026-04-01T10:13:10.000Z"
}
```

### 10.7 Edge Shape

`edges` 的作用是让前端零推理消费：

```json
{
  "sessionParent": [
    { "sessionId": "session_002", "parentSessionId": "session_001" }
  ],
  "sessionSource": [
    { "sessionId": "session_002", "sourceMessageId": "msg_002" }
  ],
  "sessionRun": [
    { "sessionId": "session_002", "runId": "run_002" }
  ],
  "sessionMessage": [
    { "sessionId": "session_002", "messageId": "msg_003" },
    { "sessionId": "session_002", "messageId": "msg_004" }
  ],
  "messageParent": [
    { "messageId": "msg_004", "parentMessageId": "msg_003" }
  ],
  "messageReply": [
    { "messageId": "msg_004", "replyToMessageId": "msg_003" }
  ],
  "runMessage": [
    { "runId": "run_002", "messageId": "msg_004" }
  ],
  "messageOperation": [
    { "messageId": "msg_004", "operationId": "op_002_1" },
    { "messageId": "msg_004", "operationId": "op_002_2" }
  ],
  "operationConsumes": [
    { "operationId": "op_002_2", "consumedOperationId": "op_002_1" }
  ]
}
```

这里的语义要固定住：

1. `messageOperation` 表示“这个可见 message 下挂了哪些 operation 供 UI 展示”。
2. `operationConsumes` 表示“后一个 operation 消费了前一个 operation 的结果”。
3. 如果 assistant 先调用工具，再带着工具结果继续请求模型，那么通常会出现 `tool_call -> model_request` 两条 operation 同时挂在同一个 assistant message 下。

### 10.8 Tree Contract 字段约束

为了让前端零推理消费，contract 层也要把“最终回复是单独 message”固定成不变量，而不是让 UI 自己猜：

1. `sessions[].headMessageId` 表示当前 session 的 canonical head message；当 `sessions[].status = completed` 时，它必须存在，而且必须指向本 session 的最终 assistant message。
2. `sessions[].latestRunId` 表示当前 session 的最后一条有效 run；当 `sessions[].status = completed` 时，它必须存在，而且必须正好是产出 `headMessageId` 的那条 run。
3. `messages[]` 中被 `headMessageId` 指向的 message，必须满足：`role = assistant`、`status = completed`、`createdByRunId = latestRunId`。
4. `runs[]` 中被 `latestRunId` 指向的 run，必须满足：`status = completed`；如果 session 处于 `failed` 或 `interrupted`，则允许 `latestRunId` 存在但不要求它产出最终 assistant reply。
5. `edges.sessionMessage` 必须包含 `(sessionId, headMessageId)` 这一对边；如果 `session.status = completed`，`edges.runMessage` 也必须包含 `(latestRunId, headMessageId)` 这一对边。
6. `messages[]` 可以包含中间 assistant 输出、candidate 输出、judge 输出，但只允许 `headMessageId` 指向其中一条 canonical 结尾 message；前端不应再从消息列表里自己猜“哪条才是最终回复”。
7. `messageOperation` 可以把多个 operation 挂到同一个 `headMessageId` 下展示，但 message 正文语义只认最终那条 `model_request`；前面的 `tool_call`、judge、hook 都只是这条回复的执行证据。
8. `sessions[].status = completed` 但 `headMessageId` 缺失，或 `headMessageId` 指向非 assistant message，或 `messages[headMessageId].createdByRunId != latestRunId`，都应视为 contract 非法响应，route 层直接报错而不是静默容忍。

## 11. 四轮连续对话实例

这个例子对应最常见的情形：

1. 用户连续发起了 4 轮对话。
2. 每一轮都是一个新的 session node。
3. 每个 session 内有 1 条 user message 和 1 条 assistant message。
4. 每个 session 只有 1 次主要 run。

也就是说，4 轮对话会落成：

1. `1` 个 task
2. `4` 个 session 节点
3. `4` 个 session run
4. `8` 条 message
5. `8` 条 messagePart
6. `8` 条 operation

```json
{
  "meta": {
    "contractVersion": "2026-04-01.v2",
    "taskId": "task_demo_4_rounds",
    "currentSessionId": "session_004",
    "rootSessionId": "session_001",
    "generatedAt": "2026-04-01T12:00:00.000Z",
    "incomplete": false
  },
  "task": {
    "id": "task_demo_4_rounds",
    "projectId": "proj_demo",
    "title": "设计任务树数据模型",
    "status": "active",
    "summary": "同一个 task 下连续进行了 4 轮 session-node 对话",
    "currentSessionId": "session_004",
    "rootSessionId": "session_001",
    "createdAt": "2026-04-01T10:00:00.000Z",
    "updatedAt": "2026-04-01T10:14:00.000Z"
  },
  "workflow": {
    "templateId": "wf_task_delivery",
    "currentStageKey": "implement",
    "currentStageLabel": "实现",
    "status": "running",
    "approvalState": "not_required"
  },
  "parallelGroups": [],
  "sessions": [
    {
      "id": "session_001",
      "taskId": "task_demo_4_rounds",
      "parentSessionId": null,
      "rootSessionId": "session_001",
      "sourceMessageId": null,
      "sessionType": "root",
      "workflowStageKey": "discover",
      "spawnTriggerType": "task_create",
      "spawnRuleKey": null,
      "userPromptSummary": "先分析当前 task tree 的问题。",
      "status": "completed",
      "headMessageId": "msg_002",
      "latestRunId": "run_001",
      "depth": 0,
      "sortKey": "0000",
      "archivedAt": null,
      "createdAt": "2026-04-01T10:01:00.000Z",
      "updatedAt": "2026-04-01T10:02:00.000Z"
    },
    {
      "id": "session_002",
      "taskId": "task_demo_4_rounds",
      "parentSessionId": "session_001",
      "rootSessionId": "session_001",
      "sourceMessageId": "msg_002",
      "sessionType": "follow_up",
      "workflowStageKey": "design",
      "spawnTriggerType": "assistant_reply",
      "spawnRuleKey": null,
      "userPromptSummary": "那应该先怎么拆？",
      "status": "completed",
      "headMessageId": "msg_004",
      "latestRunId": "run_002",
      "depth": 1,
      "sortKey": "0000.0001",
      "archivedAt": null,
      "createdAt": "2026-04-01T10:05:00.000Z",
      "updatedAt": "2026-04-01T10:06:00.000Z"
    },
    {
      "id": "session_003",
      "taskId": "task_demo_4_rounds",
      "parentSessionId": "session_002",
      "rootSessionId": "session_001",
      "sourceMessageId": "msg_004",
      "sessionType": "follow_up",
      "workflowStageKey": "implement",
      "spawnTriggerType": "assistant_reply",
      "spawnRuleKey": null,
      "userPromptSummary": "那 message 和 event 怎么分？",
      "status": "completed",
      "headMessageId": "msg_006",
      "latestRunId": "run_003",
      "depth": 2,
      "sortKey": "0000.0001.0001",
      "archivedAt": null,
      "createdAt": "2026-04-01T10:09:00.000Z",
      "updatedAt": "2026-04-01T10:10:00.000Z"
    },
    {
      "id": "session_004",
      "taskId": "task_demo_4_rounds",
      "parentSessionId": "session_003",
      "rootSessionId": "session_001",
      "sourceMessageId": "msg_006",
      "sessionType": "follow_up",
      "workflowStageKey": "implement",
      "spawnTriggerType": "assistant_reply",
      "spawnRuleKey": null,
      "userPromptSummary": "给我一个可落地的 contract。",
      "status": "completed",
      "headMessageId": "msg_008",
      "latestRunId": "run_004",
      "depth": 3,
      "sortKey": "0000.0001.0001.0001",
      "archivedAt": null,
      "createdAt": "2026-04-01T10:13:00.000Z",
      "updatedAt": "2026-04-01T10:14:00.000Z"
    }
  ],
  "runs": [
    {
      "id": "run_001",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_001",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_001",
      "triggerType": "user_prompt",
      "executionKind": "single",
      "coordinationKey": null,
      "candidateIndex": null,
      "laneRole": "primary",
      "executorKind": "assistant",
      "modelRoute": "openai:gpt-5.4",
      "workflowStageKey": "discover",
      "status": "completed",
      "inputTokens": 96,
      "outputTokens": 168,
      "totalTokens": 264,
      "costUsd": 0.0026,
      "resultSummary": "现在的问题是 session、run、message、event 混在一起。",
      "errorText": null,
      "startedAt": "2026-04-01T10:01:10.000Z",
      "finishedAt": "2026-04-01T10:02:00.000Z",
      "createdAt": "2026-04-01T10:01:10.000Z"
    },
    {
      "id": "run_002",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_002",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_002",
      "triggerType": "user_prompt",
      "executionKind": "single",
      "coordinationKey": null,
      "candidateIndex": null,
      "laneRole": "primary",
      "executorKind": "assistant",
      "modelRoute": "openai:gpt-5.4",
      "workflowStageKey": "design",
      "status": "completed",
      "inputTokens": 88,
      "outputTokens": 142,
      "totalTokens": 230,
      "costUsd": 0.0023,
      "resultSummary": "第一步先把 session node 和 session run 拆开。",
      "errorText": null,
      "startedAt": "2026-04-01T10:05:10.000Z",
      "finishedAt": "2026-04-01T10:06:00.000Z",
      "createdAt": "2026-04-01T10:05:10.000Z"
    },
    {
      "id": "run_003",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_003",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_003",
      "triggerType": "user_prompt",
      "executionKind": "single",
      "coordinationKey": null,
      "candidateIndex": null,
      "laneRole": "primary",
      "executorKind": "assistant",
      "modelRoute": "openai:gpt-5.4",
      "workflowStageKey": "implement",
      "status": "completed",
      "inputTokens": 101,
      "outputTokens": 156,
      "totalTokens": 257,
      "costUsd": 0.0027,
      "resultSummary": "message 是可见内容，event 只保留 debug。",
      "errorText": null,
      "startedAt": "2026-04-01T10:09:10.000Z",
      "finishedAt": "2026-04-01T10:10:00.000Z",
      "createdAt": "2026-04-01T10:09:10.000Z"
    },
    {
      "id": "run_004",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_004",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_004",
      "triggerType": "user_prompt",
      "executionKind": "single",
      "coordinationKey": null,
      "candidateIndex": null,
      "laneRole": "primary",
      "executorKind": "assistant",
      "modelRoute": "openai:gpt-5.4",
      "workflowStageKey": "implement",
      "status": "completed",
      "inputTokens": 112,
      "outputTokens": 190,
      "totalTokens": 302,
      "costUsd": 0.0032,
      "resultSummary": "返回 task、sessions、runs、messages、messageParts、operations、edges。",
      "errorText": null,
      "startedAt": "2026-04-01T10:13:10.000Z",
      "finishedAt": "2026-04-01T10:14:00.000Z",
      "createdAt": "2026-04-01T10:13:10.000Z"
    }
  ],
  "messages": [
    {
      "id": "msg_001",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_001",
      "createdByRunId": null,
      "role": "user",
      "messageKind": "prompt",
      "parentMessageId": null,
      "replyToMessageId": null,
      "seq": 1,
      "textPreview": "先分析当前 task tree 的问题。",
      "partCount": 1,
      "tokenUsed": 0,
      "status": "completed",
      "createdAt": "2026-04-01T10:01:00.000Z",
      "updatedAt": "2026-04-01T10:01:00.000Z",
      "completedAt": "2026-04-01T10:01:00.000Z"
    },
    {
      "id": "msg_002",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_001",
      "createdByRunId": "run_001",
      "role": "assistant",
      "messageKind": "reply",
      "parentMessageId": "msg_001",
      "replyToMessageId": "msg_001",
      "seq": 2,
      "textPreview": "现在的问题是 session、run、message、event 混在一起。",
      "partCount": 1,
      "tokenUsed": 168,
      "status": "completed",
      "createdAt": "2026-04-01T10:02:00.000Z",
      "updatedAt": "2026-04-01T10:02:00.000Z",
      "completedAt": "2026-04-01T10:02:00.000Z"
    },
    {
      "id": "msg_003",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_002",
      "createdByRunId": null,
      "role": "user",
      "messageKind": "prompt",
      "parentMessageId": null,
      "replyToMessageId": null,
      "seq": 1,
      "textPreview": "那应该先怎么拆？",
      "partCount": 1,
      "tokenUsed": 0,
      "status": "completed",
      "createdAt": "2026-04-01T10:05:00.000Z",
      "updatedAt": "2026-04-01T10:05:00.000Z",
      "completedAt": "2026-04-01T10:05:00.000Z"
    },
    {
      "id": "msg_004",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_002",
      "createdByRunId": "run_002",
      "role": "assistant",
      "messageKind": "reply",
      "parentMessageId": "msg_003",
      "replyToMessageId": "msg_003",
      "seq": 2,
      "textPreview": "第一步先把 session node 和 session run 拆开。",
      "partCount": 1,
      "tokenUsed": 142,
      "status": "completed",
      "createdAt": "2026-04-01T10:06:00.000Z",
      "updatedAt": "2026-04-01T10:06:00.000Z",
      "completedAt": "2026-04-01T10:06:00.000Z"
    },
    {
      "id": "msg_005",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_003",
      "createdByRunId": null,
      "role": "user",
      "messageKind": "prompt",
      "parentMessageId": null,
      "replyToMessageId": null,
      "seq": 1,
      "textPreview": "那 message 和 event 怎么分？",
      "partCount": 1,
      "tokenUsed": 0,
      "status": "completed",
      "createdAt": "2026-04-01T10:09:00.000Z",
      "updatedAt": "2026-04-01T10:09:00.000Z",
      "completedAt": "2026-04-01T10:09:00.000Z"
    },
    {
      "id": "msg_006",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_003",
      "createdByRunId": "run_003",
      "role": "assistant",
      "messageKind": "reply",
      "parentMessageId": "msg_005",
      "replyToMessageId": "msg_005",
      "seq": 2,
      "textPreview": "message 是可见内容，event 只保留 debug。",
      "partCount": 1,
      "tokenUsed": 156,
      "status": "completed",
      "createdAt": "2026-04-01T10:10:00.000Z",
      "updatedAt": "2026-04-01T10:10:00.000Z",
      "completedAt": "2026-04-01T10:10:00.000Z"
    },
    {
      "id": "msg_007",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_004",
      "createdByRunId": null,
      "role": "user",
      "messageKind": "prompt",
      "parentMessageId": null,
      "replyToMessageId": null,
      "seq": 1,
      "textPreview": "给我一个可落地的 contract。",
      "partCount": 1,
      "tokenUsed": 0,
      "status": "completed",
      "createdAt": "2026-04-01T10:13:00.000Z",
      "updatedAt": "2026-04-01T10:13:00.000Z",
      "completedAt": "2026-04-01T10:13:00.000Z"
    },
    {
      "id": "msg_008",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_004",
      "createdByRunId": "run_004",
      "role": "assistant",
      "messageKind": "reply",
      "parentMessageId": "msg_007",
      "replyToMessageId": "msg_007",
      "seq": 2,
      "textPreview": "返回 task、sessions、runs、messages、messageParts、operations、edges。",
      "partCount": 1,
      "tokenUsed": 190,
      "status": "completed",
      "createdAt": "2026-04-01T10:14:00.000Z",
      "updatedAt": "2026-04-01T10:14:00.000Z",
      "completedAt": "2026-04-01T10:14:00.000Z"
    }
  ],
  "messageParts": [
    {
      "id": "part_001",
      "messageId": "msg_001",
      "partIndex": 0,
      "partType": "text",
      "textContent": "先分析当前 task tree 的问题。",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:01:00.000Z"
    },
    {
      "id": "part_002",
      "messageId": "msg_002",
      "partIndex": 0,
      "partType": "text",
      "textContent": "现在的问题是 session、run、message、event 混在一起。",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:02:00.000Z"
    },
    {
      "id": "part_003",
      "messageId": "msg_003",
      "partIndex": 0,
      "partType": "text",
      "textContent": "那应该先怎么拆？",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:05:00.000Z"
    },
    {
      "id": "part_004",
      "messageId": "msg_004",
      "partIndex": 0,
      "partType": "text",
      "textContent": "第一步先把 session node 和 session run 拆开。",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:06:00.000Z"
    },
    {
      "id": "part_005",
      "messageId": "msg_005",
      "partIndex": 0,
      "partType": "text",
      "textContent": "那 message 和 event 怎么分？",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:09:00.000Z"
    },
    {
      "id": "part_006",
      "messageId": "msg_006",
      "partIndex": 0,
      "partType": "text",
      "textContent": "message 是可见内容，event 只保留 debug。",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:10:00.000Z"
    },
    {
      "id": "part_007",
      "messageId": "msg_007",
      "partIndex": 0,
      "partType": "text",
      "textContent": "给我一个可落地的 contract。",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:13:00.000Z"
    },
    {
      "id": "part_008",
      "messageId": "msg_008",
      "partIndex": 0,
      "partType": "text",
      "textContent": "返回 task、sessions、runs、messages、messageParts、operations、edges。",
      "jsonPayload": null,
      "createdAt": "2026-04-01T10:14:00.000Z"
    }
  ],
  "operations": [
    {
      "id": "op_001",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_001",
      "runId": "run_001",
      "messageId": "msg_002",
      "parentOperationId": null,
      "operationKind": "model_request",
      "toolName": null,
      "title": "主模型请求",
      "status": "completed",
      "summaryJson": { "promptMessageId": "msg_001" },
      "startedAt": "2026-04-01T10:01:10.000Z",
      "finishedAt": "2026-04-01T10:02:00.000Z",
      "createdAt": "2026-04-01T10:01:10.000Z"
    },
    {
      "id": "op_002",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_002",
      "runId": "run_002",
      "messageId": "msg_004",
      "parentOperationId": null,
      "operationKind": "model_request",
      "toolName": null,
      "title": "主模型请求",
      "status": "completed",
      "summaryJson": { "promptMessageId": "msg_003" },
      "startedAt": "2026-04-01T10:05:10.000Z",
      "finishedAt": "2026-04-01T10:06:00.000Z",
      "createdAt": "2026-04-01T10:05:10.000Z"
    },
    {
      "id": "op_003_1",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_003",
      "runId": "run_003",
      "messageId": null,
      "parentOperationId": null,
      "operationKind": "model_request",
      "toolName": null,
      "title": "规划读取设计文档",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_005",
        "phase": "plan_tool_call"
      },
      "startedAt": "2026-04-01T10:09:10.000Z",
      "finishedAt": "2026-04-01T10:09:20.000Z",
      "createdAt": "2026-04-01T10:09:10.000Z"
    },
    {
      "id": "op_003_2",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_003",
      "runId": "run_003",
      "messageId": "msg_006",
      "parentOperationId": "op_003_1",
      "operationKind": "tool_call",
      "toolName": "read_file",
      "title": "读取设计文档",
      "status": "completed",
      "summaryJson": {
        "target": "docs/task-tree-data-model-replan.md"
      },
      "startedAt": "2026-04-01T10:09:21.000Z",
      "finishedAt": "2026-04-01T10:09:31.000Z",
      "createdAt": "2026-04-01T10:09:21.000Z"
    },
    {
      "id": "op_003_3",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_003",
      "runId": "run_003",
      "messageId": "msg_006",
      "parentOperationId": "op_003_2",
      "operationKind": "model_request",
      "toolName": null,
      "title": "消费文档内容后生成回复",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_005",
        "consumedOperationIds": ["op_003_2"]
      },
      "startedAt": "2026-04-01T10:09:32.000Z",
      "finishedAt": "2026-04-01T10:10:00.000Z",
      "createdAt": "2026-04-01T10:09:32.000Z"
    },
    {
      "id": "op_004_1",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_004",
      "runId": "run_004",
      "messageId": null,
      "parentOperationId": null,
      "operationKind": "model_request",
      "toolName": null,
      "title": "规划生成文档补丁",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_007",
        "phase": "plan_tool_call"
      },
      "startedAt": "2026-04-01T10:13:10.000Z",
      "finishedAt": "2026-04-01T10:13:18.000Z",
      "createdAt": "2026-04-01T10:13:10.000Z"
    },
    {
      "id": "op_004_2",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_004",
      "runId": "run_004",
      "messageId": "msg_008",
      "parentOperationId": "op_004_1",
      "operationKind": "tool_call",
      "toolName": "apply_patch",
      "title": "生成文档补丁",
      "status": "completed",
      "summaryJson": {
        "target": "docs/task-tree-data-model-replan.md"
      },
      "startedAt": "2026-04-01T10:13:19.000Z",
      "finishedAt": "2026-04-01T10:13:35.000Z",
      "createdAt": "2026-04-01T10:13:19.000Z"
    },
    {
      "id": "op_004_3",
      "taskId": "task_demo_4_rounds",
      "sessionId": "session_004",
      "runId": "run_004",
      "messageId": "msg_008",
      "parentOperationId": "op_004_2",
      "operationKind": "model_request",
      "toolName": null,
      "title": "消费补丁结果后生成回复",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_007",
        "consumedOperationIds": ["op_004_2"]
      },
      "startedAt": "2026-04-01T10:13:36.000Z",
      "finishedAt": "2026-04-01T10:14:00.000Z",
      "createdAt": "2026-04-01T10:13:36.000Z"
    }
  ],
  "artifacts": [],
  "edges": {
    "sessionParent": [
      { "sessionId": "session_002", "parentSessionId": "session_001" },
      { "sessionId": "session_003", "parentSessionId": "session_002" },
      { "sessionId": "session_004", "parentSessionId": "session_003" }
    ],
    "sessionSource": [
      { "sessionId": "session_002", "sourceMessageId": "msg_002" },
      { "sessionId": "session_003", "sourceMessageId": "msg_004" },
      { "sessionId": "session_004", "sourceMessageId": "msg_006" }
    ],
    "sessionRun": [
      { "sessionId": "session_001", "runId": "run_001" },
      { "sessionId": "session_002", "runId": "run_002" },
      { "sessionId": "session_003", "runId": "run_003" },
      { "sessionId": "session_004", "runId": "run_004" }
    ],
    "sessionMessage": [
      { "sessionId": "session_001", "messageId": "msg_001" },
      { "sessionId": "session_001", "messageId": "msg_002" },
      { "sessionId": "session_002", "messageId": "msg_003" },
      { "sessionId": "session_002", "messageId": "msg_004" },
      { "sessionId": "session_003", "messageId": "msg_005" },
      { "sessionId": "session_003", "messageId": "msg_006" },
      { "sessionId": "session_004", "messageId": "msg_007" },
      { "sessionId": "session_004", "messageId": "msg_008" }
    ],
    "messageParent": [
      { "messageId": "msg_002", "parentMessageId": "msg_001" },
      { "messageId": "msg_004", "parentMessageId": "msg_003" },
      { "messageId": "msg_006", "parentMessageId": "msg_005" },
      { "messageId": "msg_008", "parentMessageId": "msg_007" }
    ],
    "messageReply": [
      { "messageId": "msg_002", "replyToMessageId": "msg_001" },
      { "messageId": "msg_004", "replyToMessageId": "msg_003" },
      { "messageId": "msg_006", "replyToMessageId": "msg_005" },
      { "messageId": "msg_008", "replyToMessageId": "msg_007" }
    ],
    "runMessage": [
      { "runId": "run_001", "messageId": "msg_002" },
      { "runId": "run_002", "messageId": "msg_004" },
      { "runId": "run_003", "messageId": "msg_006" },
      { "runId": "run_004", "messageId": "msg_008" }
    ],
    "messageOperation": [
      { "messageId": "msg_002", "operationId": "op_001" },
      { "messageId": "msg_004", "operationId": "op_002" },
      { "messageId": "msg_006", "operationId": "op_003_2" },
      { "messageId": "msg_006", "operationId": "op_003_3" },
      { "messageId": "msg_008", "operationId": "op_004_2" },
      { "messageId": "msg_008", "operationId": "op_004_3" }
    ],
    "operationConsumes": [
      { "operationId": "op_003_3", "consumedOperationId": "op_003_2" },
      { "operationId": "op_004_3", "consumedOperationId": "op_004_2" }
    ]
  }
}
```

这个例子里最关键的观察点只有四个：

1. 4 轮连续对话直接对应 4 个 session node。
2. session 树靠 `parentSessionId` 和 `sourceMessageId` 重建。
3. message 不跨 session 承担树关系，只负责 session 内部内容。
4. run 只是每个 session 的执行尝试，不再承担树节点语义。
5. 发生工具调用时，仍然只是在同一个 session/run 里追加 operation chain，不会新增 session node。

### 11.1 单轮带 workflow、并行执行、工具调用的实例

上面的四轮示例是串行简化版，便于先看清 session tree。

如果你要把 workflow、并行执行、工具调用都展示出来，推荐看下面这个更接近真实系统的例子：

1. 用户发起 1 个新 session。
2. 这一轮处于 workflow 的 `implement` 阶段。
3. 系统对这 1 轮启动 2 条并行 candidate run，外加 1 条 judge run。
4. 每条 candidate run 都有自己的 tool call。

```json
{
  "workflow": {
    "templateId": "wf_task_delivery",
    "currentStageKey": "implement",
    "currentStageLabel": "实现",
    "status": "running",
    "approvalState": "not_required"
  },
  "parallelGroups": [
    {
      "coordinationKey": "pg_001",
      "sessionId": "session_005",
      "executionMode": "parallel_candidates",
      "winnerRunId": "run_005_b",
      "runIds": ["run_005_a", "run_005_b", "run_005_judge"]
    }
  ],
  "sessions": [
    {
      "id": "session_005",
      "taskId": "task_demo_parallel",
      "parentSessionId": "session_004",
      "rootSessionId": "session_001",
      "sourceMessageId": "msg_008",
      "sessionType": "follow_up",
      "workflowStageKey": "implement",
      "spawnTriggerType": "assistant_reply",
      "spawnRuleKey": null,
      "userPromptSummary": "给我两个实现方案并比较。",
      "status": "completed",
      "headMessageId": "msg_013",
      "latestRunId": "run_005_judge",
      "depth": 4,
      "sortKey": "0000.0001.0001.0001.0001",
      "archivedAt": null,
      "createdAt": "2026-04-01T10:20:00.000Z",
      "updatedAt": "2026-04-01T10:24:00.000Z"
    }
  ],
  "runs": [
    {
      "id": "run_005_a",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_005_a",
      "triggerType": "user_prompt",
      "executionKind": "parallel_candidate",
      "coordinationKey": "pg_001",
      "candidateIndex": 0,
      "laneRole": "candidate",
      "executorKind": "assistant",
      "modelRoute": "openai:gpt-5.4",
      "workflowStageKey": "implement",
      "status": "completed",
      "inputTokens": 120,
      "outputTokens": 220,
      "totalTokens": 340,
      "costUsd": 0.0038,
      "resultSummary": "方案 A：保持 session-node，不引入 branch。",
      "errorText": null,
      "startedAt": "2026-04-01T10:20:05.000Z",
      "finishedAt": "2026-04-01T10:21:00.000Z",
      "createdAt": "2026-04-01T10:20:05.000Z"
    },
    {
      "id": "run_005_b",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_005_b",
      "triggerType": "user_prompt",
      "executionKind": "parallel_candidate",
      "coordinationKey": "pg_001",
      "candidateIndex": 1,
      "laneRole": "candidate",
      "executorKind": "assistant",
      "modelRoute": "anthropic:claude-sonnet",
      "workflowStageKey": "implement",
      "status": "completed",
      "inputTokens": 118,
      "outputTokens": 240,
      "totalTokens": 358,
      "costUsd": 0.0041,
      "resultSummary": "方案 B：保留 session-node，并增加 run-group 投影。",
      "errorText": null,
      "startedAt": "2026-04-01T10:20:05.000Z",
      "finishedAt": "2026-04-01T10:21:10.000Z",
      "createdAt": "2026-04-01T10:20:05.000Z"
    },
    {
      "id": "run_005_judge",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "attemptIndex": 1,
      "runtimeSessionId": "runtime_session_005_judge",
      "triggerType": "parallel_result",
      "executionKind": "judge",
      "coordinationKey": "pg_001",
      "candidateIndex": null,
      "laneRole": "judge",
      "executorKind": "judge",
      "modelRoute": "openai:gpt-5.4-mini",
      "workflowStageKey": "implement",
      "status": "completed",
      "inputTokens": 90,
      "outputTokens": 80,
      "totalTokens": 170,
      "costUsd": 0.0012,
      "resultSummary": "判定 run_005_b 为更优方案。",
      "errorText": null,
      "startedAt": "2026-04-01T10:21:15.000Z",
      "finishedAt": "2026-04-01T10:24:00.000Z",
      "createdAt": "2026-04-01T10:21:15.000Z"
    }
  ],
  "operations": [
    {
      "id": "op_005_a_1",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_a",
      "messageId": null,
      "parentOperationId": null,
      "operationKind": "model_request",
      "toolName": null,
      "title": "规划候选方案 A",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_010",
        "phase": "plan_tool_call"
      },
      "startedAt": "2026-04-01T10:20:05.000Z",
      "finishedAt": "2026-04-01T10:20:07.000Z",
      "createdAt": "2026-04-01T10:20:05.000Z"
    },
    {
      "id": "op_005_a_2",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_a",
      "messageId": "msg_011",
      "parentOperationId": "op_005_a_1",
      "operationKind": "tool_call",
      "toolName": "read_file",
      "title": "读取 task-tree 文档",
      "status": "completed",
      "summaryJson": { "target": "docs/task-tree-data-model-replan.md" },
      "startedAt": "2026-04-01T10:20:08.000Z",
      "finishedAt": "2026-04-01T10:20:09.000Z",
      "createdAt": "2026-04-01T10:20:08.000Z"
    },
    {
      "id": "op_005_a_3",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_a",
      "messageId": "msg_011",
      "parentOperationId": "op_005_a_2",
      "operationKind": "model_request",
      "toolName": null,
      "title": "消费文档内容后生成候选方案 A",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_010",
        "consumedOperationIds": ["op_005_a_2"]
      },
      "startedAt": "2026-04-01T10:20:10.000Z",
      "finishedAt": "2026-04-01T10:21:00.000Z",
      "createdAt": "2026-04-01T10:20:10.000Z"
    },
    {
      "id": "op_005_b_1",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_b",
      "messageId": null,
      "parentOperationId": null,
      "operationKind": "model_request",
      "toolName": null,
      "title": "规划候选方案 B",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_010",
        "phase": "plan_tool_call"
      },
      "startedAt": "2026-04-01T10:20:05.000Z",
      "finishedAt": "2026-04-01T10:20:09.000Z",
      "createdAt": "2026-04-01T10:20:05.000Z"
    },
    {
      "id": "op_005_b_2",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_b",
      "messageId": "msg_012",
      "parentOperationId": "op_005_b_1",
      "operationKind": "tool_call",
      "toolName": "apply_patch",
      "title": "生成 schema 草案补丁",
      "status": "completed",
      "summaryJson": { "target": "control-plane/service/src/db/schema.pg.ts" },
      "startedAt": "2026-04-01T10:20:10.000Z",
      "finishedAt": "2026-04-01T10:20:12.000Z",
      "createdAt": "2026-04-01T10:20:10.000Z"
    },
    {
      "id": "op_005_b_3",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_b",
      "messageId": "msg_012",
      "parentOperationId": "op_005_b_2",
      "operationKind": "model_request",
      "toolName": null,
      "title": "消费补丁结果后生成候选方案 B",
      "status": "completed",
      "summaryJson": {
        "promptMessageId": "msg_010",
        "consumedOperationIds": ["op_005_b_2"]
      },
      "startedAt": "2026-04-01T10:20:13.000Z",
      "finishedAt": "2026-04-01T10:21:10.000Z",
      "createdAt": "2026-04-01T10:20:13.000Z"
    },
    {
      "id": "op_005_j_1",
      "taskId": "task_demo_parallel",
      "sessionId": "session_005",
      "runId": "run_005_judge",
      "messageId": "msg_013",
      "parentOperationId": null,
      "operationKind": "judge",
      "toolName": null,
      "title": "比较候选结果",
      "status": "completed",
      "summaryJson": { "winnerRunId": "run_005_b" },
      "startedAt": "2026-04-01T10:21:15.000Z",
      "finishedAt": "2026-04-01T10:24:00.000Z",
      "createdAt": "2026-04-01T10:21:15.000Z"
    }
  ]
}
```

这个例子说明 run 的意义非常具体：

1. 同一个 session 可以承载多条并行 run。
2. 每条并行 run 可以有独立的 `model_request -> tool_call -> model_request` 链。
3. judge 也是 run，不是 session。
4. assistant 最终可见回复通常由最后一条 `model_request` 产出，tool_call 只是挂在这条回复下面展示的执行证据。
5. 用户最终继续哪个方案，应该从胜出结果再创建下一个子 session，而不是把候选 run 直接当成树节点。

如果第 3 轮不是接着第 2 轮往下聊，而是从第 2 轮 assistant 回复 `msg_004` 处分叉出另一种思路，那么只需要：

1. 新增一个 `session_003b`
2. `parentSessionId = session_002`
3. `sourceMessageId = msg_004`

这样 `session_003` 和 `session_003b` 就是 `session_002` 下的两个子节点。这里仍然不需要单独的 branch 表。

## 12. 第一版 Contract 明确不返回的内容

1. 不返回 raw event payload。
2. 不返回 legacy message fallback。
3. 不返回 runtime 去重后的 synthetic normalized message。
4. 不返回大块 `rawPayload`。
5. 不返回只能靠前端猜语义的临时字段。

## 13. 落地顺序

### Phase 0：冻结边界

1. 把当前 `/query/normalized-conversation` 与 `/query/raw-events` 标记为 debug only。
2. 停止继续扩展 [control-plane/service/src/modules/tasks/task-session-read.ts](control-plane/service/src/modules/tasks/task-session-read.ts) 的 fallback 聚合逻辑。
3. 明确前端后续只接 `task tree` 和 `task timeline` 两类 contract。

### Phase 1：落 canonical schema

1. 保留 `task_sessions`，但收敛为 session-node 语义。
2. 新增 `task_session_runs`。
3. 新增 `task_messages`、`task_message_parts`、`task_operations`。
4. 保留 `task_event_log` 作为审计附属层。

### Phase 2：改写写路径

1. 每次新的用户发起，创建新 session。
2. 同一 session 的 retry / resume，只新增 run。
3. 用户可见消息只写 `task_messages + task_message_parts`。
4. tool / judge / hook 写 `task_operations`。
5. 调试事件单独写 `task_event_log`。

### Phase 3：改写读路径

1. service 侧产出 `GET /api/tasks/:taskId/tree`。
2. BFF 改为轻量透传，不再重组语义。
3. UI 直接消费 `sessions + messages + edges`。

### Phase 4：删旧模型

1. 删除 legacy conversation fallback。
2. 删除 runtime identity 去重聚合。
3. 删除 raw event 参与主读链的逻辑。
4. 把 current `task_sessions` 中与 run/编排相关的混合字段清理到新表或新投影里。

## 14. 验收标准

只要这套 session-node 方案要成立，必须满足下面六条：

1. 给定一个 taskId，可以只依赖 `task_sessions` 重建完整 session tree。
2. 给定一个 sessionId，可以明确知道它的父节点是谁、由哪条 source message 触发。
3. 给定一条 message，可以明确知道它属于哪个 session，而不是再去猜 branch。
4. 给定一个 run，可以明确知道它是哪个 session 的第几次尝试。
5. 删除 event log 后，task tree 仍然能完整重建。
6. 前端拿到 `task tree` contract 后，不需要再自己 dedupe、补 lineage、猜层级。

## 15. 当前建议执行点

从现在开始，代码层最值得先做的是：

1. 先新增一份 `GET /api/tasks/:taskId/tree` 的 contract test。
2. 再把当前 `task_sessions` 拆成“node 字段”和“run 字段”两组。
3. 最后再动 service 读写实现。

先锁 contract，再拆 schema，能最大限度避免又回到旧的混合模型。

## 16. schema.pg.ts 目标草案

这一步建议不要直接在现有混合表上做一次性硬切，而是按当前仓库的 Drizzle 习惯，把目标结构先落成 `schema.pg.ts` 的 task-domain 片段，再用 SQL migration 去补齐 deferred FK、cross-table trigger 和 backfill。

这里的分工建议固定成：

1. `schema.pg.ts` 负责列定义、普通外键、唯一键、查询索引。
2. 复合 `DEFERRABLE INITIALLY DEFERRED` 外键放 SQL migration。
3. `validate_session_terminal_state()` 这类跨表闭环校验也放 SQL migration。

### 16.1 建议补充的 task-domain 类型

```ts
export type TaskSessionNodeType = "root" | "follow_up" | "manual_branch" | "workflow_spawn";
export type TaskSessionNodeStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "archived";
export type TaskSessionRunTriggerType =
  | "user_prompt"
  | "assistant_reply"
  | "parallel_result"
  | "resume"
  | "workflow_spawn"
  | "system_retry";
export type TaskSessionRunExecutionKind =
  | "single"
  | "parallel_candidate"
  | "judge"
  | "repair"
  | "resume"
  | "workflow_step";
export type TaskSessionRunLaneRole =
  | "primary"
  | "candidate"
  | "judge"
  | "repair"
  | "resume"
  | "hook";
export type TaskMessageKind = "prompt" | "reply" | "note" | "tool_echo";
export type TaskMessageStatus = "streaming" | "completed" | "failed" | "cancelled";
export type TaskOperationKind =
  | "model_request"
  | "tool_call"
  | "judge"
  | "hook"
  | "resume"
  | "system";
```

### 16.2 建议的 task_sessions 目标结构

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
    sourceMessageId: text("source_message_id"),
    sessionType: text("session_type").$type<TaskSessionNodeType>().notNull(),
    workflowStageKey: text("workflow_stage_key"),
    spawnTriggerType: text("spawn_trigger_type").notNull(),
    spawnRuleKey: text("spawn_rule_key"),
    userPromptSummary: text("user_prompt_summary"),
    status: text("status").$type<TaskSessionNodeStatus>().notNull().default("running"),
    headMessageId: text("head_message_id"),
    latestRunId: text("latest_run_id"),
    depth: integer("depth").notNull().default(0),
    sortKey: text("sort_key"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_sessions_tree_node_id").on(table.treeNodeId),
    index("idx_task_sessions_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_sessions_task_parent_created_at").on(
      table.taskId,
      table.parentSessionId,
      table.createdAt,
    ),
    index("idx_task_sessions_task_sort_key").on(table.taskId, table.sortKey),
    index("idx_task_sessions_root_session_id").on(table.rootSessionId),
  ],
);
```

这里要点只有三个：

1. `coordination_key`、`candidate_index`、`step_index`、`winner_session_id`、`judge_session_id` 都不再留在 `task_sessions`。
2. `head_message_id` 和 `latest_run_id` 保留在 `task_sessions`，因为它们是 session 终态闭环的一部分。
3. `source_message_id` 最终要通过 SQL migration 的复合延迟外键约束到父 session 的 message。

### 16.3 建议新增的 task_session_runs

```ts
export const taskSessionRuns = pgTable(
  "task_session_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id),
    attemptIndex: integer("attempt_index").notNull(),
    runtimeSessionId: text("runtime_session_id"),
    triggerType: text("trigger_type").$type<TaskSessionRunTriggerType>().notNull(),
    executionKind: text("execution_kind").$type<TaskSessionRunExecutionKind>().notNull(),
    coordinationKey: text("coordination_key"),
    candidateIndex: integer("candidate_index"),
    laneRole: text("lane_role").$type<TaskSessionRunLaneRole>().notNull(),
    executorKind: text("executor_kind").notNull(),
    modelRoute: text("model_route"),
    workflowStageKey: text("workflow_stage_key"),
    status: text("status").$type<TaskSessionNodeStatus>().notNull().default("running"),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    resultSummary: text("result_summary"),
    errorText: text("error_text"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_session_runs_session_attempt_index").on(
      table.sessionId,
      table.attemptIndex,
    ),
    uniqueIndex("idx_task_session_runs_session_id_id").on(table.sessionId, table.id),
    uniqueIndex("idx_task_session_runs_runtime_session_id").on(table.runtimeSessionId),
    index("idx_task_session_runs_task_session_created_at").on(
      table.taskId,
      table.sessionId,
      table.createdAt,
    ),
    index("idx_task_session_runs_task_coordination_created_at").on(
      table.taskId,
      table.coordinationKey,
      table.createdAt,
    ),
  ],
);
```

### 16.4 建议新增的 task_messages / task_message_parts

```ts
export const taskMessages = pgTable(
  "task_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id),
    createdByRunId: text("created_by_run_id"),
    role: text("role").$type<ConversationMessageRole>().notNull(),
    messageKind: text("message_kind").$type<TaskMessageKind>().notNull(),
    parentMessageId: text("parent_message_id").references((): AnyPgColumn => taskMessages.id),
    replyToMessageId: text("reply_to_message_id").references((): AnyPgColumn => taskMessages.id),
    seq: integer("seq").notNull(),
    textPreview: text("text_preview"),
    partCount: integer("part_count").notNull().default(0),
    tokenUsed: bigint("token_used", { mode: "number" }).notNull().default(0),
    status: text("status").$type<TaskMessageStatus>().notNull().default("streaming"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("idx_task_messages_session_seq").on(table.sessionId, table.seq),
    uniqueIndex("idx_task_messages_session_id_id").on(table.sessionId, table.id),
    index("idx_task_messages_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_messages_session_created_at").on(table.sessionId, table.createdAt),
    index("idx_task_messages_session_role_created_at").on(
      table.sessionId,
      table.role,
      table.createdAt,
    ),
  ],
);

export const taskMessageParts = pgTable(
  "task_message_parts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => taskMessages.id),
    partIndex: integer("part_index").notNull(),
    partType: text("part_type").$type<ConversationMessagePartType>().notNull(),
    textContent: text("text_content"),
    jsonPayload: jsonb("json_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_message_parts_message_part_index").on(
      table.messageId,
      table.partIndex,
    ),
    index("idx_task_message_parts_message_id").on(table.messageId),
  ],
);
```

### 16.5 建议新增的 task_operations

```ts
export const taskOperations = pgTable(
  "task_operations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => taskSessions.id),
    runId: text("run_id")
      .notNull()
      .references(() => taskSessionRuns.id),
    messageId: text("message_id").references(() => taskMessages.id),
    parentOperationId: text("parent_operation_id").references((): AnyPgColumn => taskOperations.id),
    runtimeOperationId: text("runtime_operation_id"),
    operationIndex: integer("operation_index").notNull(),
    operationKind: text("operation_kind").$type<TaskOperationKind>().notNull(),
    toolName: text("tool_name"),
    title: text("title"),
    status: text("status").$type<TaskSessionNodeStatus>().notNull().default("running"),
    summaryJson: jsonb("summary_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_task_operations_run_operation_index").on(table.runId, table.operationIndex),
    uniqueIndex("idx_task_operations_runtime_operation_id").on(table.runtimeOperationId),
    index("idx_task_operations_task_created_at").on(table.taskId, table.createdAt),
    index("idx_task_operations_session_created_at").on(table.sessionId, table.createdAt),
    index("idx_task_operations_message_id").on(table.messageId),
    index("idx_task_operations_parent_operation_id").on(table.parentOperationId),
  ],
);
```

### 16.6 这版 schema.pg.ts 草案的边界

1. `task_message_events` 第一轮不改名，只继续承担 debug event log。
2. `task_session_messages`、`task_session_message_parts`、`session_operations` 先保留，直到新读写路径切走。
3. `head_message_id -> task_messages(session_id, id)`、`latest_run_id -> task_session_runs(session_id, id)`、`source_message_id -> parent session message` 这些复合延迟外键不建议强塞进 Drizzle 定义里，统一放 SQL migration。

## 17. SQL 迁移草案

这一步建议按 4 个 migration 文件拆，不要把建表、回填、约束、清理揉成一个大文件。并且每次新增 SQL 文件后，都必须同步更新 `control-plane/service/drizzle-pg/meta/_journal.json`。

### 17.1 0024_task_tree_v2_schema.sql

这个 migration 只做“加结构，不加硬约束”：

1. `ALTER TABLE task_sessions ADD COLUMN`：`source_message_id`、`session_type`、`workflow_stage_key`、`spawn_trigger_type`、`spawn_rule_key`、`user_prompt_summary`、`status`、`head_message_id`、`latest_run_id`、`depth`、`sort_key`。
2. `CREATE TABLE task_session_runs`。
3. `CREATE TABLE task_messages`。
4. `CREATE TABLE task_message_parts`。
5. `CREATE TABLE task_operations`。
6. 先创建复合唯一键和查询索引，但不立刻加复合延迟外键。

关键 DDL 草案：

```sql
ALTER TABLE "task_sessions"
  ADD COLUMN IF NOT EXISTS "source_message_id" text,
  ADD COLUMN IF NOT EXISTS "session_type" text,
  ADD COLUMN IF NOT EXISTS "workflow_stage_key" text,
  ADD COLUMN IF NOT EXISTS "spawn_trigger_type" text,
  ADD COLUMN IF NOT EXISTS "spawn_rule_key" text,
  ADD COLUMN IF NOT EXISTS "user_prompt_summary" text,
  ADD COLUMN IF NOT EXISTS "status" text,
  ADD COLUMN IF NOT EXISTS "head_message_id" text,
  ADD COLUMN IF NOT EXISTS "latest_run_id" text,
  ADD COLUMN IF NOT EXISTS "depth" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sort_key" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_session_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "session_id" text NOT NULL,
  "attempt_index" integer NOT NULL,
  "runtime_session_id" text,
  "trigger_type" text NOT NULL,
  "execution_kind" text NOT NULL,
  "coordination_key" text,
  "candidate_index" integer,
  "lane_role" text NOT NULL,
  "executor_kind" text NOT NULL,
  "model_route" text,
  "workflow_stage_key" text,
  "status" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "total_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "result_summary" text,
  "error_text" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "session_id" text NOT NULL,
  "created_by_run_id" text,
  "role" text NOT NULL,
  "message_kind" text NOT NULL,
  "parent_message_id" text,
  "reply_to_message_id" text,
  "seq" integer NOT NULL,
  "text_preview" text,
  "part_count" integer DEFAULT 0 NOT NULL,
  "token_used" bigint DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" text
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_session_runs_session_id_id"
  ON "task_session_runs" USING btree ("session_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_messages_session_id_id"
  ON "task_messages" USING btree ("session_id", "id");
```

### 17.2 0025_task_tree_v2_backfill.sql

这个 migration 才做数据迁移，核心原则是“先一对一保真回填，再慢慢消冗余”：

1. 每条 legacy `task_sessions` 先回填成 1 条 `task_session_runs`，把旧的运行态、tokens、cost、candidate/judge 信息全部落进 run。
2. 每条 legacy `task_session_messages` 回填成 1 条 `task_messages`。
3. 每条 legacy `task_session_message_parts` 直接回填到 `task_message_parts`；如果旧消息只有 `text_content` 没有 parts，就补 1 条默认 `text` part。
4. 每条 legacy `session_operations` 回填到 `task_operations`。
5. 最后再反推 `task_sessions.head_message_id` 和 `task_sessions.latest_run_id`。

关键回填草案：

```sql
INSERT INTO "task_session_runs" (
  "id",
  "task_id",
  "session_id",
  "attempt_index",
  "runtime_session_id",
  "trigger_type",
  "execution_kind",
  "coordination_key",
  "candidate_index",
  "lane_role",
  "executor_kind",
  "model_route",
  "workflow_stage_key",
  "status",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "cost_usd",
  "result_summary",
  "error_text",
  "started_at",
  "finished_at",
  "created_at"
)
SELECT
  concat('run_', ts."id"),
  ts."task_id",
  ts."id",
  1,
  ts."runtime_session_id",
  CASE ts."trigger_type"
    WHEN 'execute' THEN 'user_prompt'
    WHEN 'continue' THEN 'assistant_reply'
    WHEN 'resume' THEN 'resume'
    WHEN 'workflow_spawn' THEN 'workflow_spawn'
    ELSE 'system_retry'
  END,
  CASE ts."session_kind"
    WHEN 'candidate' THEN 'parallel_candidate'
    WHEN 'judge' THEN 'judge'
    WHEN 'sequential_step' THEN 'workflow_step'
    WHEN 'resume' THEN 'resume'
    ELSE 'single'
  END,
  ts."coordination_key",
  ts."candidate_index",
  CASE ts."session_kind"
    WHEN 'candidate' THEN 'candidate'
    WHEN 'judge' THEN 'judge'
    WHEN 'hook' THEN 'hook'
    ELSE 'primary'
  END,
  'assistant',
  COALESCE(ts."effective_model", ts."selected_model"),
  ts."trigger_type",
  CASE ts."execution_status"
    WHEN 'complete' THEN 'completed'
    WHEN 'cancelled' THEN 'interrupted'
    ELSE ts."execution_status"
  END,
  ts."input_tokens",
  ts."output_tokens",
  ts."total_tokens",
  ts."cost_usd",
  ts."result_summary",
  ts."error_text",
  ts."started_at",
  ts."finished_at",
  ts."created_at"
FROM "task_sessions" ts
ON CONFLICT DO NOTHING;
--> statement-breakpoint

UPDATE "task_sessions" ts
SET
  "status" = CASE ts."execution_status"
    WHEN 'complete' THEN 'completed'
    WHEN 'cancelled' THEN 'interrupted'
    ELSE ts."execution_status"
  END,
  "latest_run_id" = concat('run_', ts."id");
```

`head_message_id` 回填建议用“当前 session 最后一条 completed assistant message”规则：

```sql
WITH ranked AS (
  SELECT
    tm."session_id",
    tm."id",
    tm."created_by_run_id",
    row_number() OVER (
      PARTITION BY tm."session_id"
      ORDER BY tm."seq" DESC, tm."created_at" DESC
    ) AS rn
  FROM "task_messages" tm
  WHERE tm."role" = 'assistant' AND tm."status" = 'completed'
)
UPDATE "task_sessions" ts
SET
  "head_message_id" = ranked."id",
  "latest_run_id" = COALESCE(ranked."created_by_run_id", ts."latest_run_id")
FROM ranked
WHERE ranked."session_id" = ts."id" AND ranked.rn = 1;
```

### 17.3 0026_task_tree_v2_constraints.sql

这个 migration 再把真正关键的不变量锁死：

1. `task_messages(session_id, id)` 和 `task_session_runs(session_id, id)` 作为复合引用目标。
2. `task_sessions(id, head_message_id) -> task_messages(session_id, id)`。
3. `task_sessions(id, latest_run_id) -> task_session_runs(session_id, id)`。
4. `task_messages(session_id, created_by_run_id) -> task_session_runs(session_id, id)`。
5. `task_sessions(parent_session_id, source_message_id) -> task_messages(session_id, id)`。
6. `validate_session_terminal_state()` trigger。

关键约束草案：

```sql
ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_head_message_fk"
    FOREIGN KEY ("id", "head_message_id")
    REFERENCES "task_messages" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_latest_run_fk"
    FOREIGN KEY ("id", "latest_run_id")
    REFERENCES "task_session_runs" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_messages"
  ADD CONSTRAINT "task_messages_created_by_run_fk"
    FOREIGN KEY ("session_id", "created_by_run_id")
    REFERENCES "task_session_runs" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_source_message_fk"
    FOREIGN KEY ("parent_session_id", "source_message_id")
    REFERENCES "task_messages" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
```

trigger 草案：

```sql
CREATE OR REPLACE FUNCTION validate_session_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  head_message record;
  latest_run record;
BEGIN
  IF NEW."status" = 'completed' THEN
    IF NEW."head_message_id" IS NULL OR NEW."latest_run_id" IS NULL THEN
      RAISE EXCEPTION 'completed session % must have head_message_id and latest_run_id', NEW."id";
    END IF;

    SELECT * INTO head_message
    FROM "task_messages"
    WHERE "session_id" = NEW."id" AND "id" = NEW."head_message_id";

    IF NOT FOUND OR head_message."role" <> 'assistant' OR head_message."status" <> 'completed' THEN
      RAISE EXCEPTION 'session % head message must be a completed assistant message', NEW."id";
    END IF;

    SELECT * INTO latest_run
    FROM "task_session_runs"
    WHERE "session_id" = NEW."id" AND "id" = NEW."latest_run_id";

    IF NOT FOUND OR latest_run."status" <> 'completed' THEN
      RAISE EXCEPTION 'session % latest run must be completed', NEW."id";
    END IF;

    IF head_message."created_by_run_id" IS DISTINCT FROM NEW."latest_run_id" THEN
      RAISE EXCEPTION 'session % head message must be produced by latest run', NEW."id";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "task_sessions_terminal_state_chk"
AFTER INSERT OR UPDATE ON "task_sessions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_session_terminal_state();
```

### 17.4 0027_task_tree_v2_cutover.sql

最后一个 migration 不建议现在就写死 drop 逻辑，建议只预留 cutover checklist：

1. service 写路径改为 dual-write：旧表继续写，新表同步写。
2. `GET /api/tasks/:taskId/tree` 先只读新表。
3. 等 contract test、服务集成测试、BFF 透传都稳定后，再把 `task_session_messages`、`task_session_message_parts`、`session_operations` 标记为 legacy。
4. 真正 drop 旧表至少再晚一个 migration，避免读写切换和删表混在一起。

这套拆法的重点不是“今天就把表全改完”，而是先把三条最重要的不变量落成可执行结构：

1. session tree 只由 `task_sessions` 决定。
2. 最终 assistant reply 必须是单独的 canonical message。
3. `head_message_id + latest_run_id + created_by_run_id` 必须形成闭环。
