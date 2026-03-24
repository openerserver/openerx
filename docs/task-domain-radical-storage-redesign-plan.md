# 任务域激进存储重构方案草案

> 状态：主体已实现，待收尾清理  
> 日期：2026-03-22  
> 作者：GitHub Copilot

## 1. 文档目标

本文档给出一版可落到当前仓库的激进改造方案，目标不是继续在 `project_tree_nodes.content_json` 上叠加字段，而是把任务、执行、会话、消息、时间线拆回规范化事实模型，并让项目树退回到结构导航层。

这份方案默认以下判断已经成立：

1. 多执行模式（single / parallel / sequential-chain）是长期核心能力。
2. branch lineage、execution trace、TaskDetailV3、MultiTaskMonitor 都将持续增强，而不是过渡页面。
3. 当前 legacy runtime plan（`executionPlan`）、`parallelRunHistory`、session snapshot 兼容层已经足够证明需求存在；本文后续涉及旧字段迁出或模型收敛的段落，应视为历史方案背景，而不是当前仍待启动的补丁路线。

相关背景文档：

- [project-tree-storage-design.md](project-tree-storage-design.md)
- [architecture-target-evolution.md](architecture-target-evolution.md)
- [task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
- [task-thread-session-workbench-plan.md](task-thread-session-workbench-plan.md)
- [pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md)

## 2. 目标结论

目标架构不是“树里继续塞更多快照”，而是切成四层：

1. `tasks`：任务业务聚合根。
2. `task_runs` / `task_run_nodes` / `task_run_edges`：执行事实主源。
3. `conversation_sessions` / `conversation_messages` / `conversation_message_parts`：消息事实主源。
4. `task_snapshots` / `task_timeline_views`：前端读取投影。

同时对现有项目树做降级处理：

1. `project_tree_nodes` 保留为结构树与入口引用层。
2. `project_tree_events` 不再承担消息 canonical storage，只保留树级事件与兼容过渡职责。
3. `task.content_json.executionPlan`、`parallelRunHistory`、`task.prompt` 回填逻辑已经进入退场语境；后文若提及这些字段，应理解为历史兼容清点，而不是主路径设计目标。

## 3. 设计原则

### 3.1 单一真相源

每类数据只允许一个 authoritative source：

1. 任务主状态：`tasks` + `task_snapshots`
2. 执行状态：`task_runs*`
3. 消息内容：`conversation_*`
4. 审计：现有 audit 域
5. 成本：现有 runtime usage ledger 域

### 3.2 当前态与历史态分离

1. 历史事实 append-only。
2. 当前态通过 projection 聚合得出。
3. 不再用一个 JSON 同时兼顾“当前态”和“历史回放”。

### 3.3 结构与业务事实分离

1. `project_tree_nodes` 只负责 containment / navigation。
2. 执行、消息、候选、步骤不再嵌在树节点 JSON 中。

### 3.4 三种执行模式统一建模

single、parallel、sequential-chain 都必须落到统一执行图模型：

1. 一个任务可有多次 `task_run`
2. 一次 `task_run` 可有多个 `task_run_node`
3. 节点依赖关系由 `task_run_edges` 表达

## 4. 当前模型的结构性问题

### 4.1 `task.content_json` 承载过重

当前 task 节点同时承载：

1. prompt
2. result
3. strategy
4. executionMode
5. legacy runtime plan（`executionPlan`）
6. parallelRunHistory
7. changesSummary
8. workflow 运行态

问题：

1. 更新频率过高，写放大严重。
2. 局部字段查询困难。
3. reconcile / finalize / route patch 都在写同一块大 JSON。
4. 历史和当前态纠缠。

### 4.2 顺序执行语义不统一

当前顺序链很多时候以：

1. `executionMode = single`
2. `executionPlan.pipelineMetadata.requestedMode = sequential-chain`（即 legacy runtime plan 请求顺序接力）

来表达，这会导致前后端、报表、修复逻辑都要靠组合判断。

### 4.3 消息主源不统一

当前消息实际是双轨：

1. runtime session messages
2. `project_tree_events` 的 snapshot/timeline 兼容持久化

问题：

1. 查询要 fallback
2. prompt 需要 backfill
3. lineage 聚合要混合 source
4. 很难声明“哪边才是准的”

### 4.4 `parallelRunHistory` 是必要补丁，但不是最终模型

它解决了“当前 plan 覆盖历史”的问题，但本质仍是 task 快照继续变胖，而不是历史事实模型正确。

## 5. 目标数据模型

下面的表设计按当前仓库命名风格、现有 PostgreSQL 体系、Drizzle schema 约束来拟定。

### 5.1 `tasks`

任务业务聚合根，不再依附 `project_tree_nodes.content_json`。

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  tree_node_id TEXT UNIQUE REFERENCES project_tree_nodes(id),
  created_by_user_id TEXT REFERENCES users(id),

  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  category TEXT,

  current_run_id TEXT,
  current_session_id TEXT,
  current_agent_run_id TEXT,

  latest_result TEXT,
  latest_result_summary TEXT,

  selected_model TEXT,
  repo_id TEXT REFERENCES repositories(id),
  workspace_root TEXT,
  base_revision TEXT,
  working_branch TEXT,
  credential_id TEXT REFERENCES repository_credentials(id),

  strategy_json JSONB,
  final_commit_sha TEXT,
  final_branch_name TEXT,
  changes_summary_json JSONB,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

说明：

1. `tree_node_id` 保留与项目树的双向引用。
2. `latest_result` 是当前投影，不承担完整历史职责。
3. `strategy_json` 初期保留 JSON，避免一次性过度规范化。

建议索引：

1. `(project_id, created_at desc)`
2. `(project_id, status, created_at desc)`
3. `(current_run_id)`
4. `(current_session_id)`

### 5.2 `task_runs`

一次任务运行就是一条 `task_run`。它替代现在“legacy runtime plan（`executionPlan`）当前态 + parallelRunHistory 历史态”的混合方案。

```sql
CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  project_id TEXT NOT NULL REFERENCES projects(id),

  orchestration_kind TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  source_type TEXT,

  status TEXT NOT NULL,
  root_session_id TEXT,
  winner_node_id TEXT,
  judge_node_id TEXT,

  requested_model TEXT,
  effective_model TEXT,

  pipeline_step_count INTEGER,
  candidate_count INTEGER,

  result_text TEXT,
  result_summary TEXT,
  error_text TEXT,

  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

约束建议：

1. `orchestration_kind in ('single', 'parallel', 'sequential-chain')`
2. 一个 task 可有多个 run
3. `tasks.current_run_id` 指向最近活跃 run

建议索引：

1. `(task_id, created_at desc)`
2. `(project_id, created_at desc)`
3. `(status, created_at desc)`

### 5.3 `task_run_nodes`

这是执行图的核心表。single、parallel、sequential-chain 都映射为节点。

```sql
CREATE TABLE task_run_nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  project_id TEXT NOT NULL REFERENCES projects(id),

  node_kind TEXT NOT NULL,
  node_key TEXT NOT NULL,
  title TEXT,
  instruction TEXT,

  candidate_index INTEGER,
  chain_step_index INTEGER,
  hook_trigger TEXT,

  agent_type TEXT,
  model_used TEXT,

  session_id TEXT,
  agent_run_id TEXT REFERENCES agent_runs(id),

  status TEXT NOT NULL,
  result_text TEXT,
  result_summary TEXT,
  error_text TEXT,

  token_used INTEGER,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(run_id, node_key)
);
```

`node_kind` 约束建议：

1. `execution`
2. `candidate`
3. `judge`
4. `chain-step`
5. `hook`
6. `resume`

示例映射：

1. single：一个 `execution` 节点
2. parallel：多个 `candidate` 节点 + 可选一个 `judge` 节点
3. sequential-chain：多个 `chain-step` 节点

建议索引：

1. `(run_id, created_at)`
2. `(task_id, created_at desc)`
3. `(session_id)`
4. `(agent_run_id)`
5. `(run_id, candidate_index)`
6. `(run_id, chain_step_index)`

### 5.4 `task_run_edges`

节点依赖关系表，替代 `executionPlan.steps[].dependsOn`。

```sql
CREATE TABLE task_run_edges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  from_node_id TEXT NOT NULL REFERENCES task_run_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES task_run_nodes(id),
  edge_kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(run_id, from_node_id, to_node_id, edge_kind)
);
```

`edge_kind`：

1. `depends_on`
2. `spawned_from`
3. `judges`
4. `resumes_from`

### 5.5 `conversation_sessions`

会话成为一级事实表，不再仅由 tree node + runtime session 临时拼装。

```sql
CREATE TABLE conversation_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  run_id TEXT REFERENCES task_runs(id),
  run_node_id TEXT REFERENCES task_run_nodes(id),

  parent_session_id TEXT REFERENCES conversation_sessions(id),
  root_session_id TEXT,
  forked_from_message_id TEXT,

  session_kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  branch_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  runtime_session_id TEXT UNIQUE,
  tree_node_id TEXT UNIQUE REFERENCES project_tree_nodes(id),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
```

`session_kind` 建议：

1. `task-root`
2. `parallel-candidate`
3. `parallel-judge`
4. `sequential-step`
5. `resume`
6. `manual-branch`

建议索引：

1. `(task_id, created_at)`
2. `(run_id, created_at)`
3. `(parent_session_id)`
4. `(root_session_id)`
5. `(runtime_session_id)`

### 5.6 `conversation_messages`

消息 canonical storage。runtime 只负责接入，不再作为长期读取主源。

```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(id),
  task_id TEXT REFERENCES tasks(id),
  run_id TEXT REFERENCES task_runs(id),
  run_node_id TEXT REFERENCES task_run_nodes(id),
  project_id TEXT NOT NULL REFERENCES projects(id),

  runtime_message_id TEXT,
  role TEXT NOT NULL,
  message_index INTEGER NOT NULL,

  text_content TEXT,
  summary_text TEXT,
  raw_payload JSONB,

  token_used INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(session_id, message_index),
  UNIQUE(session_id, runtime_message_id)
);
```

建议索引：

1. `(session_id, message_index)`
2. `(task_id, created_at)`
3. `(run_id, created_at)`
4. `GIN(raw_payload)` 可后续按需加
5. `pg_trgm(text_content)` 可后续按需加

### 5.7 `conversation_message_parts`

消息 part 一定要拆出来，否则 tool call / tool result / visible text 迟早又回到 JSON 内部手搓解析。

```sql
CREATE TABLE conversation_message_parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id),
  part_index INTEGER NOT NULL,
  part_type TEXT NOT NULL,

  text_content TEXT,
  json_payload JSONB,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(message_id, part_index)
);
```

`part_type` 建议：

1. `text`
2. `tool_call`
3. `tool_result`
4. `thinking`
5. `file_reference`
6. `diff`

### 5.8 `task_domain_events`

激进改造建议补一层领域事件流，作为 projection 的统一输入。

```sql
CREATE TABLE task_domain_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  run_id TEXT REFERENCES task_runs(id),
  run_node_id TEXT REFERENCES task_run_nodes(id),
  session_id TEXT REFERENCES conversation_sessions(id),

  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  seq BIGINT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(task_id, seq)
);
```

用途：

1. 驱动 snapshot projector
2. 驱动 timeline projector
3. 为 monitor / analytics 提供统一回放流

### 5.9 `task_snapshots`

面向 Task list / detail header / cards / filters 的前端投影。

```sql
CREATE TABLE task_snapshots (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  project_id TEXT NOT NULL REFERENCES projects(id),

  current_status TEXT NOT NULL,
  orchestration_kind TEXT,
  current_run_id TEXT,
  current_session_id TEXT,

  latest_result TEXT,
  latest_result_summary TEXT,
  latest_error_text TEXT,

  active_candidate_count INTEGER NOT NULL DEFAULT 0,
  completed_candidate_count INTEGER NOT NULL DEFAULT 0,
  failed_candidate_count INTEGER NOT NULL DEFAULT 0,
  total_chain_steps INTEGER NOT NULL DEFAULT 0,
  completed_chain_steps INTEGER NOT NULL DEFAULT 0,

  winner_node_id TEXT,
  last_activity_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 5.10 `task_timeline_views`

面向 TaskDetailV3 / trace / workbench 的按时间展开投影。

```sql
CREATE TABLE task_timeline_views (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  run_id TEXT REFERENCES task_runs(id),
  run_node_id TEXT REFERENCES task_run_nodes(id),
  session_id TEXT REFERENCES conversation_sessions(id),
  message_id TEXT REFERENCES conversation_messages(id),

  item_kind TEXT NOT NULL,
  item_role TEXT,
  title TEXT,
  display_text TEXT,
  metadata_json JSONB,

  sort_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

建议索引：

1. `(task_id, sort_at, created_at)`
2. `(run_id, sort_at, created_at)`

## 6. 对现有表的处理建议

### 6.1 `project_tree_nodes`

保留，但职责降级。

建议最终只保留：

1. 结构导航
2. 引用入口
3. 少量 cache 字段

建议新增：

1. `ref_type TEXT`
2. `ref_id TEXT`

示例：

1. task 节点：`ref_type = 'task'`, `ref_id = tasks.id`
2. session 节点：`ref_type = 'conversation_session'`, `ref_id = conversation_sessions.id`

不再建议把任务主事实继续存进 `content_json`。

### 6.2 `project_tree_events`

保留，但从消息主源降级为：

1. 树级操作事件
2. 兼容迁移过渡层
3. 非业务主事实变更记录

建议停止新增：

1. `session.message.snapshot`
2. `session.message.updated`
3. 任何把完整 message 当 canonical payload 的事件

### 6.3 `agent_runs`

保留并增强。

建议新增：

1. `run_id TEXT REFERENCES task_runs(id)`
2. `run_node_id TEXT REFERENCES task_run_nodes(id)`

这样 `agent_runs` 才能从“task 附属执行记录”升级为“编排节点真实执行记录”。

### 6.4 `runtime_usage_ledgers`

保留。

建议补充与 `task_runs` / `task_run_nodes` 的引用，避免成本账单只能回溯到 task 或 agent_run。

## 7. 写路径重构建议

### 7.1 创建任务

当前：

1. 写 task tree node
2. task 状态主要进 `content_json`

目标：

1. 插入 `tasks`
2. 插入 `project_tree_nodes(node_type=task, ref_type='task', ref_id=task.id)`
3. 触发 `task_domain_events(task.created)`
4. projector 刷新 `task_snapshots`

### 7.2 启动执行

目标统一路径：

1. 插入 `task_runs`
2. 根据 orchestration kind 插入 `task_run_nodes`
3. 插入 `task_run_edges`
4. 更新 `tasks.current_run_id`
5. 发出 `task.run.started`

### 7.3 创建 session

1. 插入 `conversation_sessions`
2. 插入或更新对应 `project_tree_nodes(node_type=session, ref_id=session.id)`
3. 发出 `conversation.session.started`

### 7.4 持久化消息

1. upsert `conversation_messages`
2. 写 `conversation_message_parts`
3. 发出 `conversation.message.recorded`
4. timeline projector 增量更新 `task_timeline_views`

不再写 `project_tree_events.session.message.snapshot` 作为主源。

### 7.5 完成 candidate / chain-step / judge

1. 更新 `task_run_nodes.status/result`
2. 若需要，更新 `agent_runs`
3. 发出 `task.run.node.completed`
4. snapshot projector 刷新任务聚合态

### 7.6 完成整个 run

1. 更新 `task_runs.status/result`
2. 更新 `tasks.status/latest_result/current_run_id`
3. 发出 `task.run.completed`
4. projector 刷新 `task_snapshots`

## 8. 读路径重构建议

### 8.1 Task list

不再读：

1. `/api/project-tree/tasks` 的大 JSON 拼装

改为读：

1. `task_snapshots`
2. 必要时 join `tasks`

### 8.2 Task detail header

读：

1. `tasks`
2. `task_snapshots`
3. `task_runs` 最近一条

### 8.3 Task timeline / execution trace

读：

1. `task_timeline_views`
2. `conversation_messages`
3. `conversation_message_parts`

不再混读：

1. runtime messages
2. tree snapshot events
3. task.prompt backfill

### 8.4 Branch lineage

改为读：

1. `conversation_sessions`
2. `parent_session_id`

项目树只负责提供跳转入口，不再作为 lineage 事实主表。

## 9. API 收敛建议

### 9.1 新增/替换 BFF 聚合接口

建议引入以下聚合视图接口：

1. `GET /api/task-snapshots`
2. `GET /api/task-snapshots/:taskId`
3. `GET /api/tasks/:taskId/runs`
4. `GET /api/tasks/:taskId/runs/:runId/graph`
5. `GET /api/tasks/:taskId/timeline`
6. `GET /api/tasks/:taskId/sessions`
7. `GET /api/sessions/:sessionId/messages`

### 9.2 下线方向

状态注记：本节原本描述“最终目标下线项”。其中前两项已经不再是现行主路径约束，当前只需把它们视为历史兼容接口语境；真正仍需继续收口的是 `/branches/messages` snapshot 兼容层。

## 10. 迁移计划

> 历史注记：本节保留最初的四阶段切换草案，用于解释方案当时的推进顺序。
> 当前阅读时，应将其视为历史迁移框架；其中阶段 1-3 的主体已经基本兑现，阶段 4 才是仍待收尾的部分。

### 阶段 1：Schema 预埋 + 双写

1. 新建上述新表
2. 保持旧逻辑继续写 `project_tree_nodes.content_json`
3. 同时双写 `tasks` / `task_runs*` / `conversation_*`
4. 加校验脚本对比 task snapshot 与新表聚合结果

### 阶段 2：Projection 落地

1. 新建 `task_snapshots` / `task_timeline_views`
2. 在 BFF 增加读取新 projection 的内部接口
3. Task list / detail 逐步切读

### 阶段 3：主读切换

1. TaskDetailV3、MultiTaskMonitor、trace 统一切新投影
2. runtime fallback 只作为 debug 兜底
3. `executionPlan` / `parallelRunHistory` 已退出主路径；当前收尾重点是压缩历史兼容面

### 阶段 4：旧模型降级

1. `project_tree_events` 退出消息主源，仅保留历史回放、审计窗口与测试清理副产物语义
2. `project_tree_nodes.content_json` 只保留缓存级字段
3. `parallelRunHistory` 保持停写状态，剩余工作仅限历史引用压缩
4. `executionPlan` 保持历史兼容字段定位，不再作为主判断依据

## 11. 风险与代价

### 11.1 成本

1. schema 数量明显增加
2. BFF / service 写路径复杂度提高
3. 双写期需要一致性校验
4. projector 需要补充测试基建

### 11.2 风险

1. 投影延迟导致 UI 短时间读到旧态
2. 双写期可能产生事实分叉
3. 历史数据回填不完整会影响 trace 页面

### 11.3 风险控制

1. 所有新表先 shadow write
2. UI 切流前做对账报表；当前仓库已提供 `bun run db:audit:task-domain -- --project-id <projectId>` 作为基础一致性巡检入口，且 `bun run check:all` 已接入 fail-on-mismatch 闸门脚本
3. 为 `task_runs` 与 `conversation_messages` 做增量一致性巡检
4. 主读切换先从内部 debug 页面开始

## 12. 推荐实施顺序

状态注记：这一节原本给出“只允许做一轮大改”时的优先级排序。按当前仓库实现，这个排序已经大体兑现：事实表、conversation_*、projection 与 domain events 已落地，当前真正剩余的是 `project_tree_nodes` / `project_tree_events` 的职责瘦身和旧兼容层收尾。

## 13. 最终判断

状态注记：本节的核心判断已经兑现，即系统正在从“树快照驱动”收口到“事实模型驱动 + 树结构引用 + 投影读取”。后续阅读重点不再是重复论证这一路线是否成立，而是查看第 14 节里哪些部分已经完成、哪些旧模型仍待退场。

## 14. 已完成 / 未完成 / 收尾清单

这一节用于补充当前仓库实现状态，避免本文档只描述目标结构，而没有明确方案推进到哪一步。

### 14.1 已完成

按本文档的阶段划分，以下事项已经完成或基本完成。

1. 新事实表与桥接表已经落地到 PostgreSQL migration 链。
2. `tasks`、`task_runs`、`task_run_nodes`、`task_run_edges` 已落 schema 与 migration。
3. `conversation_sessions`、`conversation_messages`、`conversation_message_parts` 已落 schema 与 migration。
4. `task_domain_events`、`task_snapshots`、`task_timeline_views` 已落 schema 与 migration。
5. `agent_runs`、`runtime_usage_ledgers`、`runtime_usage_ledger_steps` 与新任务域表的 bridge 字段和外键已经补齐。
6. task domain projector、projection replay、projection-first trace 读取链路已经接入。
7. Dashboard、Projects、Task trace 已经开始消费 `task_snapshots` 和 `task_timeline_views`。
8. richer trace 语义已经进入 projection 链路，包括 tool 参数摘要、file-reference、diff 等展示元信息。

对应判断：

1. 阶段 1：基本完成。
2. 阶段 2：基本完成。
3. 阶段 3：已进入主路径，但仍保留若干旧兼容读取和写入。

### 14.2 未完成

当前剩余工作主要集中在“旧模型真正退场”，也就是本文档中的阶段 4。

1. service / BFF 主路径已经停止把 legacy runtime plan 字段 `executionPlan`、`parallelRunHistory` 作为正式读写依据；当前遗留主要集中在显式兼容测试、文档语境与少量 repair-only 分支。
2. `project_tree_events` 已经停止继续写入 `session.message.created`、`session.message.updated`、`session.message.completed`、`session.message.snapshot`；这组事件现在只作为历史兼容数据与回放窗口存在。
3. `project_tree_nodes.content_json` 已继续瘦身，task 节点中的 `executionPlan`、`parallelRunHistory` 运行时残留已清理完毕；当前仍保留少量树级 cache / 兼容字段（如 `executionMode`、`autoAdvanceStages`、committer 元数据）。
4. task 读取逻辑仍有一部分直接从 tree task snapshot 解析，而不是以 `tasks` + `task_snapshots` 为唯一主读模型。
5. web-ui-bff 主路径已经不再让 runtime pipeline、candidate adoption、parallel continue 依赖 legacy runtime plan；剩余 legacy 语义已收敛到更小的兼容/修复面，不再构成正式主路径依赖。
6. `/branches/messages` 已经收敛到 `conversation_*` 与 domain events 写入；历史 tree snapshot events 只剩历史回放、审计窗口与测试清理副产物职责，主路径已不再依赖它们。

当前判断可收敛为一句：新事实表和主读投影已经建立，剩余问题主要是旧兼容层退场，而不是模型主体缺失。

### 14.3 收尾清单

收尾重点可压缩为四项：

1. 保持 `executionPlan`、`parallelRunHistory` 的退役状态，并继续清理显式兼容测试、文档和 repair-only 语义。
2. 继续把 TaskDetailV3、monitor、trace 等页面的主读模型收敛到 `task_snapshots`、`task_timeline_views`、`task_runs`、`conversation_*`。
3. 继续收窄 `project_tree_events` 的历史回放 / 审计窗口边界，并缩减 `project_tree_nodes.content_json` 中残留的 task 业务字段。
4. 补对账与巡检，确认新事实表、投影与旧兼容层在关键视图上已经一致，再决定是否进一步清理历史 schema / 文档残留。

当前可直接使用的最小巡检口径：

1. `status`：`tasks.status`、`task_snapshots.current_status`、当前 `task_runs.status`
2. `currentSession`：`tasks.current_session_id`、`task_snapshots.current_session_id`、`conversation_sessions.runtime_session_id`
3. `runGraph`：`task_runs.candidate_count` / `pipeline_step_count` 与 `task_run_nodes`、`task_snapshots` 聚合字段是否一致
4. `messageCount`：当前会话 `conversation_messages` 数量与 `task_timeline_views` 中去重后的 `message_id` 数量是否一致
5. `timelineItemCount`：`task_domain_events` / `conversation_*` / `task_run_nodes` 推导出的期望 item 数与 `task_timeline_views` 实际数量是否一致

推荐命令：

1. `bun run db:audit:task-domain -- --project-id <projectId>`
2. `bun run db:audit:task-domain -- --task-id <taskId> --json`
3. `bun run db:audit:task-domain -- --project-id <projectId> --fail-on-mismatch`
4. `bun run check:task-domain-audit-gate`
5. `bun run db:cleanup:task-domain-audit-fixtures`

当前 gate 入口与默认行为：

1. `bun run check:all` 会在 lint 与 typecheck 之后执行 `scripts/run-task-domain-audit-gate.sh`。
2. gate 默认在 PostgreSQL 方言下启用，默认作用域是 `proj-default`，并带 `--fail-on-mismatch --limit 200`。
3. 可用 `TASK_DOMAIN_AUDIT_PROJECT_ID`、`TASK_DOMAIN_AUDIT_TASK_ID`、`TASK_DOMAIN_AUDIT_LIMIT` 调整巡检范围。
4. 若某条本地开发链路不应被 cleanup 闸门阻断，可显式设置 `TASK_DOMAIN_AUDIT_ENABLED=0` 跳过；非 PostgreSQL 方言会自动跳过。
5. 若 runtime Postgres 中残留了 `tree-cache-state-*`、`tree-primary-task-*`、`tree-task-sync-*`、`conversation-dual-write-*`、`task-run-dual-write-*`、`dashboard-tree-*`、`agent-run-tree-*` 这类 service 回归测试 fixture，可运行 `bun run db:cleanup:task-domain-audit-fixtures` 做定向清理，再重跑 gate。

### 14.4 完成标准

可以将本方案从“Draft”提升到“基本完成”的最低标准定义为：

1. task 主状态读取不再依赖 tree task snapshot 中的 `executionPlan` 和 `parallelRunHistory`。
2. TaskDetailV3 / trace / project overview 主路径不再依赖 `project_tree_events` 承担消息读取职责；它只保留历史回放、审计窗口与测试清理副产物职责。
3. `project_tree_events` 不再承担消息 canonical storage、消息主投影输入或消息主写路径职责。
4. `project_tree_nodes.content_json` 不再作为 task 业务事实主存储。
5. 旧兼容字段仍可暂存，但不再驱动主业务判断。

当上述条件满足时，本文档第 2 节里提出的四层模型才算真正闭环，而不是“新旧模型并存但旧模型仍在主路径上施加影响”。
