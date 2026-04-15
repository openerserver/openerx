# 任务域激进重构 Schema/Migration 计划

> 状态：主线已完成（2026-03-25；schema/migration 主体已落地，当前仅保留防回退维护、发布验证与可选优化）  
> 日期：2026-03-22  
> 作者：GitHub Copilot
>
> 历史口径说明（2026-04-05）：本文中涉及 `agent_runs` 的增字段、桥接字段、迁移批次与回填步骤，保留的是删除前迁移设计口径，不再代表当前主线待办。当前 schema 已删除 `agent_runs` 物理表，兼容 `agentRunId` 已改由 canonical task-domain 表投影承接。

## 1. 文档定位

本文档是 [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md) 的执行层补充，当前主要作为 schema/migration 设计来源说明、历史迁移背景与维护基线。

配套草稿文档：

1. [task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md)

本文档不直接给最终 SQL 文件，而是回答四个问题：

1. 先建哪些表
2. 哪些字段先保守，哪些字段一步到位
3. 如何双写和对账
4. 哪一批迁移完成后，哪些旧字段可以降级或停止依赖

历史注记：本文第 2-11 节里涉及 `TaskDetailV3`、tree payload、branch compat 的“准备 / 切换 / 收缩”表述，保留的是当时的迁移设计基线，不应再解读为当前主线待办。当前仓库状态以第 12 节以及 [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md)、[task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md) 的收尾口径为准。

## 2. 总体迁移策略

采用四阶段迁移，而不是一次性硬切。

### 阶段 1：预埋新事实表

目标：

1. 不影响现有主读路径
2. 不下线任何旧字段
3. 先让新事实表可以接住增量写入

结果：

1. 现有 UI 和 BFF 无感
2. service/BFF 可开始 shadow write

### 阶段 2：预埋 projection 表

目标：

1. 给 Task list / TaskDetailV3 / timeline 准备只读投影
2. 验证新事实表是否足以驱动 UI

结果：

1. 新旧模型可并行产出同一视图
2. 可以做对账与差异报表

### 阶段 3：切换主读路径

目标：

1. BFF 改读 projection / 新事实表
2. UI 不再主依赖 `executionPlan` / `parallelRunHistory`

结果：

1. 旧模型降为兼容层
2. 新模型开始承担真实线上读取压力

### 阶段 4：旧模型降级与瘦身

目标：

1. `project_tree_nodes.content_json` 只保留结构缓存
2. `project_tree_events` 退出消息主源
3. `executionPlan` / `parallelRunHistory` 停止继续写入

结果：

1. 树回归结构层
2. 任务域读写全面收敛到新模型

## 3. 迁移批次设计

历史设计拆分为 6 个 migration 批次。

### 批次 A：任务与执行事实表

先建：

1. `tasks`
2. `task_runs`
3. `task_run_nodes`
4. `task_run_edges`

理由：

1. 这是 legacy runtime plan（`executionPlan`）的替代核心
2. single / parallel / sequential-chain 都依赖这一层
3. 后续 session 和 messages 也要挂 run / run_node

### 批次 B：会话与消息事实表

再建：

1. `conversation_sessions`
2. `conversation_messages`
3. `conversation_message_parts`

理由：

1. 先让消息有唯一 canonical storage
2. 为 timeline projection 做准备

### 批次 C：领域事件与投影表

再建：

1. `task_domain_events`
2. `task_snapshots`
3. `task_timeline_views`

理由：

1. projection 在双写和切读前必须先到位
2. 否则新事实表只能存，不能稳定读

### 批次 D：现有表扩展字段

补充现有表：

1. `agent_runs` 增加 `run_id`、`run_node_id`
2. `runtime_usage_ledgers` 增加 `run_id`、`run_node_id` 可选引用
3. `runtime_usage_ledger_steps` 增加 `run_id`、`run_node_id` 可选引用
4. `project_tree_nodes` 增加 `ref_type`、`ref_id` 可选字段

理由：

1. 建立新旧模型桥接关系
2. 不需要第一天就删旧字段

### 批次 E：索引与搜索增强

补：

1. `conversation_messages.text_content` 上 `pg_trgm`
2. `task_timeline_views` 关键排序索引
3. `task_snapshots` 常用过滤索引

### 批次 F：旧字段降级/停止使用

最后执行：

1. 停止主写 `executionPlan`
2. 停止主写 `parallelRunHistory`
3. 停止主写 `project_tree_events` 消息 snapshot
4. 将 `project_tree_nodes.content_json` 缩减为非主事实缓存

## 4. 表级落地顺序

### 4.1 `tasks`

**迁移阶段**：批次 A

首版字段草案：

必须一步到位：

1. `id`
2. `project_id`
3. `tree_node_id`
4. `title`
5. `prompt`
6. `status`
7. `current_run_id`
8. `current_session_id`
9. `latest_result`
10. `created_at`
11. `updated_at`

可保守为 JSON：

1. `strategy_json`
2. `changes_summary_json`

可以后补：

1. `latest_result_summary`
2. `current_agent_run_id`
3. `selected_model`
4. `repo_id`
5. `credential_id`

初始填充策略：

从当前 `project_tree_nodes(node_type=task)` 回填：

1. `content_text -> title`
2. `content_json.prompt -> prompt`
3. `content_json.status -> status`
4. `content_json.sessionId -> current_session_id`
5. `content_json.result -> latest_result`

### 4.2 `task_runs`

**迁移阶段**：批次 A

首版字段草案：

必须一步到位：

1. `id`
2. `task_id`
3. `project_id`
4. `orchestration_kind`
5. `trigger_type`
6. `status`
7. `root_session_id`
8. `started_at`
9. `finished_at`

首版可空：

1. `winner_node_id`
2. `judge_node_id`
3. `requested_model`
4. `effective_model`
5. `result_text`
6. `result_summary`
7. `error_text`

初始回填策略：

历史语境说明：这里描述的是迁移设计早期“如何从旧 task blob 和 executionPlan 粗略生成第一批 run 数据”的方案起点。当前运行时已经不再依赖 `executionPlan` 作为主模型，因此本段应理解为历史回填策略，而不是现行主路径仍在执行的逻辑。

第一阶段不追求完整历史回填，只做：

1. 对活跃 task 生成一条 synthetic current run
2. `executionMode` / `executionPlan.mode` 推导 `orchestration_kind`
3. `startedAt` / `finishedAt` 从 task snapshot 取

说明：

历史 task 不需要在第一轮迁移中完美重建所有 run，否则复杂度失控。

### 4.3 `task_run_nodes`

**迁移阶段**：批次 A

首版字段草案：

必须一步到位：

1. `id`
2. `run_id`
3. `task_id`
4. `project_id`
5. `node_kind`
6. `node_key`
7. `status`

历史草案同步纳入：

1. `candidate_index`
2. `chain_step_index`
3. `session_id`
4. `agent_run_id`
5. `result_text`
6. `error_text`
7. `started_at`
8. `finished_at`

初始回填策略：

历史语境说明：以下 `task_run_nodes` 生成规则对应的是早期从 `executionPlan` 回填 node graph 的迁移思路。当前 node graph 的正式来源已经转向 task-domain writes / projections，本段只保留为迁移期背景。

从 `executionPlan` 解析生成：

1. single：生成一个 `execution` 节点
2. parallel：为每个 candidate 生成一个 `candidate` 节点；若有 judge，再生成一个 `judge` 节点
3. sequential-chain：为每个链步骤生成一个 `chain-step` 节点

### 4.4 `task_run_edges`

**迁移阶段**：批次 A

首版策略：

历史语境说明：这里的 `depends_on` / `executionPlan.dependsOn` 对照关系只用于解释当时如何从旧 runtime plan 过渡到 `task_run_edges`。当前实现不应再把 `executionPlan` 视为现行边关系来源。

历史草案先只支持 `depends_on`，其余边类型留在后续扩展语境。

理由：

1. 先覆盖现有 executionPlan 里的 `dependsOn`
2. 这已经足够支撑 DAG 可视化与推进顺序

### 4.5 `conversation_sessions`

**迁移阶段**：批次 B

首版字段草案：

必须一步到位：

1. `id`
2. `project_id`
3. `task_id`
4. `run_id`
5. `parent_session_id`
6. `session_kind`
7. `source_type`
8. `runtime_session_id`

历史草案同步纳入：

1. `run_node_id`
2. `root_session_id`
3. `forked_from_message_id`
4. `branch_name`
5. `tree_node_id`

初始回填策略：

从现有 session tree / branch lineage 回填：

1. `project_tree_nodes(node_type=session)`
2. 现有 branch 接口聚合结果
3. `runtime_session_id` 作为第一阶段唯一外部稳定键

### 4.6 `conversation_messages`

**迁移阶段**：批次 B

首版字段草案：

必须一步到位：

1. `id`
2. `session_id`
3. `project_id`
4. `role`
5. `message_index`
6. `text_content`
7. `raw_payload`
8. `created_at`

历史草案同步纳入：

1. `task_id`
2. `run_id`
3. `run_node_id`
4. `runtime_message_id`
5. `completed_at`

初始回填策略：

> 历史语境说明：以下内容描述的是迁移期一次性回填优先级，不代表当前 execution trace 的正式主读链。当前对外 trace contract 已经收敛到 `task_timeline_views` 与 conversation 持久化聚合，不再把 runtime messages 作为公开 fallback。

优先级：

1. `project_tree_events` 中已持久化的 snapshot 消息
2. 活跃 session 的 runtime messages
3. 若首条 user message 缺失，用 task.prompt 仅做一次迁移兜底写入，不再保留运行时 backfill 逻辑

### 4.7 `conversation_message_parts`

**迁移阶段**：批次 B

首版策略：

必须首版落地，否则消息仍会退回 blob 解析。

最低支持：

1. `text`
2. `tool_call`
3. `tool_result`

### 4.8 `task_domain_events`

**迁移阶段**：批次 C

首版策略：

首版只写新增 run 和消息相关的核心事件：

1. `task.created`
2. `task.run.started`
3. `task.run.node.started`
4. `task.run.node.completed`
5. `task.run.completed`
6. `conversation.session.started`
7. `conversation.message.recorded`

这样足以驱动 snapshot / timeline projector。

### 4.9 `task_snapshots`

**迁移阶段**：批次 C

首版读取目标：

先只支撑：

1. tasks list
2. task detail header
3. multi-task monitor 基础统计

首版聚合字段：

1. `current_status`
2. `orchestration_kind`
3. `current_run_id`
4. `current_session_id`
5. `latest_result_summary`
6. `active_candidate_count`
7. `completed_candidate_count`
8. `failed_candidate_count`
9. `total_chain_steps`
10. `completed_chain_steps`
11. `winner_node_id`

### 4.10 `task_timeline_views`

**迁移阶段**：批次 C

首版读取目标：

先只支撑：

1. TaskDetailV3
2. TaskConversationTrace

首版 `item_kind`：

1. `user-input`
2. `assistant-output`
3. `candidate-result`
4. `judge-decision`
5. `chain-step-result`
6. `status-transition`

## 5. 对现有 schema 的最小增量修改

### 5.1 `project_tree_nodes`

历史草案新增：

1. `ref_type TEXT`
2. `ref_id TEXT`

目的：

1. 树节点引用 `tasks` / `conversation_sessions`
2. 为后续移除肥大的 `content_json` 做准备

### 5.2 `agent_runs`

历史草案新增：

1. `run_id TEXT REFERENCES task_runs(id)`
2. `run_node_id TEXT REFERENCES task_run_nodes(id)`

这是激进方案里最关键的桥接字段之一。

### 5.3 `runtime_usage_ledgers`

历史草案新增：

1. `run_id TEXT REFERENCES task_runs(id)`
2. `run_node_id TEXT REFERENCES task_run_nodes(id)`

### 5.4 `runtime_usage_ledger_steps`

历史草案新增：

1. `run_id TEXT REFERENCES task_runs(id)`
2. `run_node_id TEXT REFERENCES task_run_nodes(id)`

## 6. 双写策略

### 6.1 第一阶段 shadow write

保持现有写路径不变，同时新增：

1. task create 时写 `tasks`
2. execute/finalize/reconcile 时写 `task_runs*`
3. session create/activate/fork 时写 `conversation_sessions`
4. message snapshot/runtime ingest 时写 `conversation_messages*`

要求：

1. 新写失败不能阻塞旧写
2. 但必须记录 error metric 和审计日志

### 6.2 第二阶段 strict dual write

当 shadow write 稳定后，升级为：

1. 新旧写都必须成功
2. 任一失败即请求失败或进入补偿队列

### 6.3 对账规则

至少要做以下对账：

1. `task.status` vs `task_snapshots.current_status`
2. `task.content_json.sessionId` vs `tasks.current_session_id`
3. `executionPlan` 解析出的 candidate/step 数 vs `task_run_nodes` 数量
4. `project_tree_events` snapshot message 数 vs `conversation_messages` 数

## 7. 切读顺序

### 7.1 先切列表

最先切：

1. task list
2. multi-task monitor 概览

理由：

1. 依赖聚合程度低
2. 对 timeline 完整性要求没那么高

### 7.2 再切详情头部

再切：

1. task detail summary
2. current run summary
3. candidate 统计信息

### 7.3 最后切 timeline / trace

最后切：

1. TaskDetailV3 timeline
2. TaskConversationTrace
3. execution trace segments

因为这一层最依赖消息完整性和排序正确性。

## 8. 旧字段退役条件

### 8.1 `executionPlan`

状态注记：本节原本是“退出主依赖前”的准入条件。按当前仓库实现，这些条件已经基本满足：`task_runs*` 已覆盖 single / parallel / sequential-chain，TaskDetailV3 与 reconcile/finalize 主路径也已不再把 `executionPlan` 当成正式状态源。

当前剩余语义应理解为：

1. `executionPlan` 只保留在历史文档、显式兼容测试与极小 repair-only 语境中。
2. 不再为该字段增加任何新语义或新主路径读取点。

### 8.2 `parallelRunHistory`

状态注记：本节原本是“停止写入前”的准入条件。按当前仓库实现，并行历史 run、candidate 详情、winner/judge 结果都已经可由 `task_runs` + `task_run_nodes` 表达，`parallelRunHistory` 的停写条件已经满足。

当前应将其视为：

1. 历史兼容名词，而不是当前模型组成部分。
2. 仅在文档回顾、兼容测试或数据清理语境中出现。

### 8.3 `project_tree_events` 的消息 snapshot

状态注记：本节原本是消息 snapshot 停写前的准入条件。当前主读路径已大幅转向 `conversation_messages`，tree timeline 也已降为兼容回放层；剩余工作重点不再是“是否具备停写条件”，而是继续压缩兼容窗口并明确可关闭边界。

## 9. 历史实施任务拆分

本节保留最初的分批视角，方便回顾建表、双写和切读是如何拆分的；当前仓库已不再按这里的 future task 顺序推进主线开发。

可以直接拆成以下执行任务：

1. Schema task 1：新增 `tasks` / `task_runs` / `task_run_nodes` / `task_run_edges`
2. Schema task 2：新增 `conversation_sessions` / `conversation_messages` / `conversation_message_parts`
3. Schema task 3：新增 `task_domain_events` / `task_snapshots` / `task_timeline_views`
4. Schema task 4：给 `agent_runs` / ledger / tree nodes 补桥接字段
5. Writer task 1：task create + task execute 双写新事实表
6. Writer task 2：message ingest 双写 `conversation_*`
7. Projector task 1：实现 `task_snapshots` projector
8. Projector task 2：实现 `task_timeline_views` projector
9. Read task 1：task list / monitor 切新投影
10. Read task 2：task detail header 切新投影
11. Read task 3：timeline / trace 切新模型
12. Cleanup task：逐步降级 `executionPlan` / `parallelRunHistory` / snapshot events

## 10. 历史第一批 DDL 落点

如果回看最初启动 schema 开发时的最小落点，首批只需要下面这些：

1. `tasks`
2. `task_runs`
3. `task_run_nodes`
4. `task_run_edges`
5. `agent_runs.run_id`
6. `agent_runs.run_node_id`

原因：

1. 这是当前 legacy runtime plan（`executionPlan`）替代的最小核心集合
2. 可以先解决顺序执行语义不统一和并行历史建模问题
3. 会话和消息模型可以放到第二批，避免第一轮爆炸式改动

## 11. 结论

这份 migration 计划的核心态度是：

1. 先立事实表
2. 再立投影表
3. 再切主读
4. 最后瘦旧模型

对当前仓库来说，这一轮 schema/migration 主体建设已经完成；剩余重点不再是继续建表，而是持续压缩旧字段、历史事件与 tree payload 的兼容暴露面。

## 12. 当前基线 / migration 维护要点

这一节用于补充当前仓库实际推进状态，说明哪些 migration 批次已经完成，以及后续哪些内容只属于兼容边界维护、发布验证或可选优化。

### 12.1 当前进度

按本文档第 2 节和第 3 节的批次设计，当前仓库已经完成以下事项。

1. 批次 A 已完成：`tasks`、`task_runs`、`task_run_nodes`、`task_run_edges` 已经落入 migration 链。
2. 批次 B 已完成：`conversation_sessions`、`conversation_messages`、`conversation_message_parts` 已经落入 migration 链。
3. 批次 C 已完成：`task_domain_events`、`task_snapshots`、`task_timeline_views` 已经落入 migration 链。
4. 批次 D 已基本完成：`agent_runs`、`runtime_usage_ledgers`、`runtime_usage_ledger_steps` 的 bridge 字段与外键已经补齐，`project_tree_nodes` 的引用字段也已经具备。
5. 批次 E 已完成：索引增强和 `pg_trgm` 已经进入 migration 链。

对应当前 migration 文件为：

1. `0013_task_domain_core.sql`
2. `0014_task_domain_conversations.sql`
3. `0015_task_domain_projections.sql`
4. `0016_task_domain_bridges.sql`
5. `0017_task_domain_indexes.sql`

这意味着本文档最初设定的“预埋事实表、预埋 projection 表、补齐桥接字段、补齐索引”已经完成，当前主要矛盾不再是建表本身，而是旧模型退场和 migration 闭环收口。

### 12.2 当前兼容边界与维护状态

虽然上述 migration 批次都已落地，但仍需保留少量兼容边界说明，原因如下。

1. service / BFF 主路径已经不再把 `executionPlan`、`parallelRunHistory` 当作正式读写字段；当前剩余内容主要落在显式兼容测试、历史文档和少量 repair-only 语义。
2. `project_tree_events` 已停止继续主写消息 snapshot 兼容事件，但历史事件、索引和少量读取链路仍然保留；它们当前应被视为历史回放、审计窗口与测试清理副产物，而不再承担消息主路径职责。
3. `project_tree_nodes.content_json` 已从 task 主事实镜像退回到“结构导航 + 少量 cache”，当前白名单边界已经形成，并转入防回退维护。
4. `project_tree_nodes.content_json` 仍保留少量历史兼容字段，但相关白名单边界已文档化；后续重点是不允许新增实现绕开该边界。
5. branch compat 主实现已迁入 `task-branch-compat-read.ts`，`task-session-read.ts` 已收缩为 conversation/session utility façade；剩余主要是 compat 测试命名与文档语义同步，而不是继续做主路径拆分。

因此当前状态更准确地说是：

1. schema/migration 预埋阶段完成。
2. 双写与 projection 阶段已完成主要接线。
3. 旧模型退出阶段已完成主线收口，后续重点转向文档维护、测试防回退与历史遗留清点。

### 12.3 migration 后续维护重点

从 migration 和 schema 维护角度看，后续重点主要集中在以下几项。

1. `executionPlan`、`parallelRunHistory` 相关工作已经从“主路径切换”降级为“历史兼容清点”：保持停写/退役状态，继续清理文档、测试与 repair-only 语义。
2. 继续把 `project_tree_events` 约束在历史回放、审计窗口与测试清理副产物语境内，避免旧链路被重新解释成运行时主路径。
3. 保持 `project_tree_nodes.content_json` 的瘦身白名单边界，区分“保留的导航/展示字段”和“必须迁出的业务事实字段”，并阻断回退。
4. branch compat 代码结构收口已完成；后续只需要围绕 compat 测试、历史命名与文档解释继续压缩误导性暴露面。
5. cleanup 文档、task checklist 与独立 backlog 已建立；主读模型唯一化验证也已完成一轮显式收口，后续只需要围绕白名单、少量历史名词与防回退维护继续保持同步。
6. 一致性对账基线与 gating artifact 已建立；后续只需要持续用于发布验证，而不是再次证明 schema 是否可切主读。

### 12.4 维护任务视图

本节保留为维护范围归纳；按当前仓库状态，应把它理解为历史 migration 计划遗留的 cleanup 分类，而不是新的核心建设清单。

1. Cleanup task A：维持 `executionPlan`、`parallelRunHistory` 的退役状态，并继续压缩显式兼容测试、历史文档和 repair-only 语义。
2. Cleanup task B：继续收窄 `project_tree_events` 消息 snapshot 的保留边界，直至只保留受控历史回放、审计窗口与测试清理副产物模式。
3. Cleanup task C：继续缩减 `project_tree_nodes.content_json` 中的 task 业务字段，直到只剩树导航 cache 与少量未规范化元数据。
4. Cleanup task D：`TaskDetailV3`、trace、task list、monitor、project overview、Dashboard 已完成一轮显式主读切换验证；后续进入防回退维护。
5. Cleanup task E：已输出对账结果和退役准入门槛，并落地为可持久化 JSON artifact 的 gating artifact。

### 12.5 Migration 完成标准

以下条件当前已作为本 migration 计划“主线已完成”的判据与后续维护基线：

1. 新表不只是存在，而且已经成为 task/run/message/timeline 的主写与主读来源。
2. `executionPlan`、`parallelRunHistory` 不再作为主路径写入和主路径读取依据。
3. `project_tree_events` 不再承担消息 canonical storage。
4. `project_tree_nodes.content_json` 不再承担 task 业务事实主存储。
5. 新旧模型已完成一轮可重复的对账，并具备明确的停写、降级、回滚边界。

按当前仓库状态，上述条件已经具备；后续重点只剩 `content_json` 白名单、防回退文案与发布验证的持续维护。

后续维护时，优先参考以下收尾文档，而不是回到这份历史 schema 计划重新排主线：

1. [docs/task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md)
2. [docs/task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)
3. [docs/execution-trace-read-boundary-adr.md](../architecture/execution-trace-read-boundary-adr.md)
