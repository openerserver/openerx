# 任务域收尾清理计划

> 状态：主线已完成（2026-03-25；A/B/C/D/E/F 已完成，后续仅保留防回退维护、发布验证与可选优化）
> 日期：2026-03-24
> 作者：GitHub Copilot

## 1. 文档目的

本文档把任务域三份激进重构文档里已经反复出现的收尾事项压缩成一份 cleanup 总览，用于记录已完成项、当前基线和验收口径，避免后续继续在历史文档里来回翻找。

如果需要按文件直接执行代码收尾，优先使用 [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md)；本文保留的是任务包划分、边界说明和验收口径。

配套文档：

1. [execution-trace-read-boundary-adr.md](../architecture/execution-trace-read-boundary-adr.md)
1. [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md)
1. [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
1. [task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
1. [task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md)

当前共识已经很明确：

1. 核心 schema、bridge 字段、projection 表已经落地。
2. 主问题已经不是“缺新模型”，而是“旧模型如何有边界地退出”。
3. 后续维护应以防回退、发布验证和可选优化为中心，而不是继续扩写 radical 方案主体。

## 2. 收尾目标

本轮收尾的最终目标只有五个：

1. `executionPlan`、`parallelRunHistory` 不再参与主业务判断。
2. `project_tree_events` 不再承担消息 canonical storage 或消息主投影输入职责。
3. `project_tree_nodes.content_json` 不再承担 task 业务事实主存储职责。
4. `TaskDetailV3`、trace、task list、monitor、project overview、Dashboard 的主读链路对旧模型依赖可被验证地清零或压缩到受控兼容面。
5. 对账结果、cleanup migration 和文档清单形成可重复执行的闭环，而不是停留在口头计划。

## 3. 非目标

本计划不包含以下内容：

1. 新增新的任务域核心表。
2. 重新设计 task domain schema 主体。
3. 再引入新的主写路径或新投影种类。
4. 为历史兼容层增加新能力。

## 4. 工作总览

| 优先级 | 工作项 | 影响面 | 验收标准 |
| --- | --- | --- | --- |
| P0 | `executionPlan` / `parallelRunHistory` 兼容引用边界 | service, web-ui-bff, tests, docs | 主路径代码已不再读写这两个字段；剩余保留点仅限显式兼容测试、历史文档或迁移语境 |
| P0 | `project_tree_events` 消息兼容层收口 | service, web-ui-bff, trace 读取链路 | `conversation_messages` 与 `task_timeline_views` 已成为消息主读来源；`project_tree_events` 仅保留历史回放或演进说明语义 |
| P0 | 主读切换验证基线 | TaskDetailV3, trace, task list, monitor, project overview, Dashboard | 主页面不再依赖 tree task snapshot、旧 message fallback 或 runtime fallback 才能成立；已形成一轮可追溯验证结果 |
| P1 | `project_tree_nodes.content_json` 白名单基线 | service, project tree, BFF 聚合 | task 业务事实字段已迁出；`content_json` 仅保留树导航、有限 cache 和必要 compat 元数据，并已形成白名单 |
| P1 | 对账报告与 gating artifact | db audit, CI/check scripts | 已覆盖 `status`、`currentSession`、`runGraph`、`messageCount`、`timelineItemCount` 五个口径，结果可重复执行 |
| P1 | cleanup migration backlog / checklist | docs, migration backlog | 已形成明确 backlog、执行顺序和验收标准，后续仅作维护 |
| P2 | 显式兼容测试与 repair-only 语义维护 | tests, maintenance code | 兼容测试范围可枚举；repair-only 分支有边界说明；不存在无文档旧模型依赖 |
| P2 | 历史文档状态维护 | docs | radical 文档已不再把已完成 schema 建设写成待做事项；后续仅同步外围历史文档 |

## 5. 任务包拆分

### 5.1 任务包 A：旧字段退役清点

目标：

1. 枚举 `executionPlan`、`parallelRunHistory` 的剩余读写点。
2. 区分哪些属于显式兼容、哪些属于 repair-only、哪些已经可以删除。
3. 输出一份保留点清单，作为后续 cleanup 任务输入。

历史盘点范围：

1. service task routes / projector / reconcile / finalize 相关代码。
2. web-ui-bff task routes / trace / branches / workflow 相关代码。
3. 测试中显式构造旧字段的 case。
4. 文档中仍把旧字段当主语义描述的段落。

历史盘点产出：

1. 一份 inventory 文档或 checklist。
2. 每个保留点标注为：
   1. `keep-for-compat`
   2. `keep-for-repair-only`
   3. `delete-now`

验收标准：

1. 主路径代码不再依赖这两个字段做正式状态判断。
2. 所有保留点都能解释为何保留。

#### 5.1.1 2026-03-24 inventory 快照

本轮已完成一次首轮盘点，扫描范围覆盖：

1. `control-plane/service/src/**`
2. `control-plane/web-ui-bff/src/**`
3. `control-plane/web-ui/src/**`
4. `tests/**`
5. `docs/**`
6. `control-plane/service/drizzle-pg/*.sql`

当前结论：

1. service 主 PATCH 写路径已经不再接受 `executionPlan`、`parallelRunHistory`。
2. web-ui-bff 主 PATCH / reconcile / finalize 路径没有发现对这两个字段的显式读写。
3. 当前未发现 source 代码中仍在使用 `task.executionPlan` 或 `task.parallelRunHistory` 的 repair-only 分支。
4. 剩余引用主要分布在三类位置：历史 migration、显式兼容测试、防回归测试与历史文档。

#### 5.1.2 当前保留点分类

| 分类 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| `keep-for-compat` | 保留 | [control-plane/service/drizzle-pg/0009_task_fk_to_project_tree_nodes.sql](../../control-plane/service/drizzle-pg/0009_task_fk_to_project_tree_nodes.sql) | 历史迁移会把旧 `tasks.execution_plan` 映射进 `project_tree_nodes.content_json.executionPlan`；属于既有数据迁移产物，不是当前主写路径 |
| `keep-for-compat` | 保留 | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) | 显式构造 legacy PATCH 输入，验证 tree/task aggregate 读写链路会忽略 `executionPlan`、`parallelRunHistory` |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/task-completion-routes.test.ts](../../tests/web-ui-bff/task-completion-routes.test.ts) | 显式构造 legacy parallel payload，验证候选 adopt 在缺少 domain runs 时不会退回旧字段主语义 |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/runtime-pipeline.test.ts](../../tests/web-ui-bff/runtime-pipeline.test.ts) | 验证非并行任务即使携带 legacy runtime plan，也只走 planning / projection 语义，不重新启用旧字段 |
| `keep-for-compat` | 保留 | tests/web-ui-bff/project-tree-task-composable.test.ts | 验证 tree node flatten 过程会主动丢弃 `executionPlan`、`parallelRunHistory` |
| `keep-for-compat` | 保留 | [tests/service/transform-export.test.ts](../../tests/service/transform-export.test.ts) | 验证导出迁移生成的 task node content 不再保留 `executionPlan` |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/task-finalize.test.ts](../../tests/web-ui-bff/task-finalize.test.ts), [tests/web-ui-bff/task-reconcile.test.ts](../../tests/web-ui-bff/task-reconcile.test.ts), [tests/web-ui-bff/lifecycle-hooks-behavior.test.ts](../../tests/web-ui-bff/lifecycle-hooks-behavior.test.ts), [tests/web-ui-bff/realtime-pipeline-events.test.ts](../../tests/web-ui-bff/realtime-pipeline-events.test.ts), [control-plane/web-ui/src/lib/taskExecutionMode.test.ts](../../control-plane/web-ui/src/lib/taskExecutionMode.test.ts) | 防回归护栏，统一验证主路径 PATCH body / tree payload / UI patch builder 不会重新写回 legacy 字段 |
| `keep-for-compat` | 保留 | [control-plane/service/src/modules/tasks/task-status-update.ts](../../control-plane/service/src/modules/tasks/task-status-update.ts), [control-plane/service/src/modules/tasks/task-core-routes.ts](../../control-plane/service/src/modules/tasks/task-core-routes.ts) | 这里的结论是“已完成退役”：schema 和 direct update keys 都不再接收 legacy 字段，应作为主写路径已清零的基线证据 |
| `keep-for-compat` | 保留 | [control-plane/web-ui-bff/src/lib/runtime-pipeline.ts](../../control-plane/web-ui-bff/src/lib/runtime-pipeline.ts) | 仅剩 `appendExecutionPlanStep` 这类命名；这里消费的是内存中的 `RuntimePlan` 结构，不是任务表 legacy 字段读写点 |
| `delete-now` | 部分完成 | [docs/task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md), [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md), [docs/task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md), [docs/research/parallel-judge-selection-plan.md](../research/parallel-judge-selection-plan.md), [docs/archive/runtime/historical-runtime-pipeline-upgrade-plan.md](../archive/runtime/historical-runtime-pipeline-upgrade-plan.md), [docs/multi-agent-hook-architecture.md](../architecture/multi-agent-hook-architecture.md) | 本轮已完成 schema/migration、project-tree 与 pg-event 文档的主口径收口；剩余对象主要是更外围的历史方案文档与少量旧字段回顾段落 |
| `keep-for-repair-only` | 暂无 | 无 | 本轮 source 扫描未找到仍显式依赖这两个字段的 repair-only 代码分支 |

#### 5.1.3 任务包 A 的当前判断

第一轮盘点后的落地结论：

1. 保留显式兼容测试，但继续评估是否能把同类 legacy-input case 合并到更少、命名更直白的 compat-only 测试中。
2. source 主路径已不再是 cleanup 重点；由于当前未发现需要保留旧字段读写的 repair-only 分支，后续仅需维护显式兼容测试、历史 migration 注记和文档语义。

### 5.2 任务包 B：消息兼容层收窄

状态：代码侧已完成当前范围收口。

目标：

1. 明确 `project_tree_events` 在消息读取链路里的剩余职责。
2. 将其压缩到“历史回放”或“受控 fallback”模式。
3. 禁止新主路径继续从 tree snapshot message 构建 canonical timeline。

历史盘点范围：

1. service `task-branch-compat-read`、`task-session-read` façade、timeline/projection 相关路径。
2. web-ui-bff branches/messages、trace、session tree 相关聚合逻辑。
3. 已退出的 runtime fallback 与 tree fallback 的历史调用边界，以及仍保留的兼容窗口。

历史盘点产出：

1. 一份边界说明：哪些 API 允许 fallback，哪些 API 不允许。
2. 一组测试，证明主路径不再依赖 tree snapshot message。

验收标准：

1. `conversation_messages` 和 `task_timeline_views` 成为默认主读源。
2. `project_tree_events` 不再承担消息主投影输入职责。

#### 5.2.1 2026-03-24 inventory 快照

本轮已完成一次首轮盘点，扫描范围覆盖：

1. `control-plane/service/src/modules/tasks/**`
2. `control-plane/service/src/modules/project-tree/**`
3. `control-plane/web-ui-bff/src/modules/tasks/**`
4. `control-plane/web-ui-bff/src/modules/projects/**`
5. `control-plane/web-ui-bff/src/modules/realtime/**`
6. `tests/**`
7. `docs/**`

当前结论：

1. source 代码里已经没有发现直接从 `project_tree_events` 读取消息的主路径实现。
2. service 的 session messages / events / timeline 读取，当前主源是 `conversation_messages` 与 `task_domain_events` 合成结果，而不是 tree event 表。
3. `project_tree_events` 已从当前 runtime schema 和前端 realtime backfill 中删除；剩余收尾项主要体现在历史 migration、历史文档与少量解释演进路径的旧测试语境。
4. 因此任务包 B 的重点，不再是“替换主读实现”，而是“压缩 outward compatibility surface，并明确最终停读边界”。

#### 5.2.2 当前保留点分类

| 分类 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| `keep-for-compat` | 保留 | control-plane/service/src/modules/tasks/task-branch-compat-read.ts | branch compat `messages` / `events` / `timeline` 实现已从旧 `task-session-read.ts` 拆出并独立命名；当前通过 `conversation_messages` 和 `conversation.message.upserted` 合成消息视图，仍保留 `session.message.created` / `updated` / `completed` / `snapshot` 的合成 eventType，用于兼容旧 timeline/sourceEventTypes 语义 |
| `delete-now` | 已完成 | [control-plane/service/src/modules/tasks/task-session-read.ts](../../control-plane/service/src/modules/tasks/task-session-read.ts) | 该文件已从历史上的重型 compat reader 收缩为纯 conversation/session utility façade，只保留 `buildConversationSessionId`、`shouldPersistStandalonePartEvent` 等会话持久化辅助导出，不再承载 branch compat 主实现 |
| `keep-for-compat` | 保留 | control-plane/service/src/modules/tasks/task-branch-routes.ts | `/branches/:runtimeSessionId/messages`、`/events`、`/timeline` 仍作为历史分支消息接口存在，但内部已不直接读取 `project_tree_events` |
| `delete-now` | 已完成 | [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) | 阶段 3 已删除剩余旧 readSource 翻译分支；BFF 仅接受并透传当前合法的 timeline readSource 集合，不再在此处消费 `conversation-table+tree-fallback`、`project-tree-events`、`tree-events` |
| `delete-now` | 已完成 | [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts), [control-plane/web-ui-bff/src/modules/projects/routes.ts](../../control-plane/web-ui-bff/src/modules/projects/routes.ts) | trace/timeline outward type 已移除 `conversation-table+legacy-fallback` 与 `legacy-project-tree-events`；当前对前端只暴露 `conversation-table`、`task-domain-events`、`conversation-table+task-domain-events`、`task-domain-projection` |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/task-execution-trace-route.test.ts](../../tests/web-ui-bff/task-execution-trace-route.test.ts), [tests/web-ui-bff/project-execution-trace-route.test.ts](../../tests/web-ui-bff/project-execution-trace-route.test.ts) | 覆盖 service timeline 作为正式但受限的 secondary source：仅在 projection timeline 为空或不可用时补位；只要 projection 已返回非空 timeline，即使 `complete=false` 也保持显式 incomplete，不再切到 service timeline 覆盖 |
| `delete-now` | 已完成 | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) | lineage-aware session message 测试命名已改为当前实现语义，强调 persisted conversation state / conversation tables，而不再暗示 tree-event message fallback 是主路径 |
| `delete-now` | 已完成 | [control-plane/service/src/db/schema.pg.ts](../../control-plane/service/src/db/schema.pg.ts), [control-plane/service/drizzle-pg/0021_drop_project_tree_events.sql](../../control-plane/service/drizzle-pg/0021_drop_project_tree_events.sql), [control-plane/web-ui/src/stores/realtime.ts](../../control-plane/web-ui/src/stores/realtime.ts), [control-plane/web-ui/src/lib/api.ts](../../control-plane/web-ui/src/lib/api.ts) | `project_tree_events` 已从当前 runtime schema 和前端 project-level realtime backfill 删除；项目级 tree-event feed 不再作为现行客户端能力保留 |
| `keep-for-compat` | 保留 | [tests/service/tree-task-aggregations.test.ts](../../tests/service/tree-task-aggregations.test.ts), [tests/service/task-route-registration-smoke.test.ts](../../tests/service/task-route-registration-smoke.test.ts), [tests/service/task-operating-runtime-tree.test.ts](../../tests/service/task-operating-runtime-tree.test.ts) | 测试仍保留 project tree 相关 cleanup 语境，但 `project_tree_events` 删除后这类清理已转移到 branches / links / tree nodes，自身不再是运行时前提 |
| `keep-for-compat` | 已完成当前范围 | [docs/task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md), [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md), [docs/task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md), [archive/task-domain/historical-pg-event-sourcing-optimization-plan.md](../archive/task-domain/historical-pg-event-sourcing-optimization-plan.md), [docs/project-tree-storage-design.md](project-tree-storage-design.md) | task-domain 主设计文档、project-tree 文档与 pg-event 文档已统一为“历史回放 / 审计窗口 / 测试清理副产物 / 可选优化”口径；后续仅需继续同步外围历史文档 |
| `keep-for-repair-only` | 暂无 | 无 | 本轮 source 扫描未找到直接查询 `project_tree_events` 作为消息读取来源的 repair-only 代码分支 |

#### 5.2.3 关键证据

1. control-plane/service/src/modules/tasks/task-branch-compat-read.ts 中 `buildTaskBranchCompatMessagesResponse()` 明确优先读 `conversation_messages`，缺失时回退到 `conversation.message.upserted` 生成的合成消息，而不是 tree events。
2. 同文件中的 `buildTaskBranchCompatTimelineResponse()` 和 `buildTaskBranchCompatEventsResponse()` 依赖的是 `conversation_sessions`、`conversation_messages`、`task_domain_events` 与 session lineage 记录；`project_tree_events` 未出现在实际查询路径中。
3. [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) 的旧 `readSource` 值归一逻辑已在阶段 3 删除，说明这一层剩余工作已从“兼容翻译”转向“确认上游 service 不再回吐旧枚举值”。
4. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 与 [control-plane/web-ui-bff/src/modules/projects/routes.ts](../../control-plane/web-ui-bff/src/modules/projects/routes.ts) 的 trace/timeline 类型已完成收口，不再把 legacy readSource 作为公开契约暴露给前端。

补充更新（2026-03-24）：

1. service 侧原 `task-session-read.ts` 已完成文件层拆分，branch compat 主实现迁入 control-plane/service/src/modules/tasks/task-branch-compat-read.ts，`task-session-read.ts` 仅保留会话持久化 utility façade。
2. tasks 模块与 project-tree storage 底层 `TaskSession*` helper 已同步收口为 `TaskBranchCompat*` 命名，当前剩余“session”词汇仅保留在真实 conversation/session 语义上，而非 branch compat 主链命名。

#### 5.2.4 任务包 B 的当前判断

第一轮盘点后的落地结论：

1. 收窄 BFF outward contract：已完成，trace 接口不再对前端暴露 `legacy-project-tree-events` 与 `conversation-table+legacy-fallback`。
2. 清理测试与命名：已完成，service 侧残留的 “legacy tree event history / tree cache” 测试命名已改为当前实现语义。
3. 文档收口已完成当前主线同步：`project_tree_events` 在消息链路中的剩余职责只限历史回放、审计窗口或测试环境清理。

#### 5.2.5 BFF outward contract 清单

第二轮盘点聚焦 BFF 对外接口。当前代码状态下，execution trace 的公开 contract 已经收紧到两条路由，且前端不再消费任何 legacy readSource。

阶段性结论：

1. 需要持续维护的 outward contract 只剩两个 execution trace 路由。
2. `fetchTaskSessionTimeline()`、`fetchTaskSessionCachedMessages()` 仍是内部 helper，但不再承担旧 readSource 翻译责任。
3. 当前没有发现 BFF 直接对前端开放 branch message/timeline cache API。

| 接口 | 文件 | 当前状态 | 可能返回的 legacy readSource | 说明 |
| --- | --- | --- | --- | --- |
| `GET /api/tasks/:taskId/execution-trace` | [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) | 对外暴露 | 无 | 返回 `TaskExecutionTraceRecord.timelineMeta`；当前主读链为 projection，service timeline 仅在 projection timeline 为空或不可用时补位 |
| `GET /api/projects/:projectId/task-execution-trace/:taskId` | [control-plane/web-ui-bff/src/modules/projects/routes.ts](../../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 对外暴露 | 无 | 返回项目视角 execution trace；当前与 task 路由对齐，projection 非空时即保留显式 incomplete，不再让 service timeline 覆盖 partial projection |
| `fetchTaskSessionTimeline()` / `fetchTaskSessionCachedMessages()` | [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) | 内部 helper | 无 | 只透传当前 `TaskSessionTimelineMeta`，不再规范化或翻译旧 readSource |
| `buildTaskExecutionTrace()` 内部 secondary source | [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts), [control-plane/web-ui-bff/src/modules/projects/routes.ts](../../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 对外间接暴露 | 无 | `service timeline` 现已收敛为正式但受限的 secondary source，只在 projection timeline 为空或不可用时补位 |

补充判断：

1. task/project 两条 trace 路由现在都以 projection 为首选结构化 timeline 来源。
2. `service timeline` 不是 projection 的别名；它来自 `conversation_messages` 与 conversation domain events 聚合，因此仍有保留为 secondary source 的价值。
3. 当前真正需要避免的是它覆盖已有的 partial projection，而不是彻底删除这条读链。

#### 5.2.6 Trace 接口收口方案

本节只针对以下两个 outward contract：

评审若只需要最终边界结论，直接引用 [execution-trace-read-boundary-adr.md](../architecture/execution-trace-read-boundary-adr.md)；本节保留的是 cleanup 计划和验收语境。

1. `GET /api/tasks/:taskId/execution-trace`
2. `GET /api/projects/:projectId/task-execution-trace/:taskId`

##### 当前目标

execution trace 对前端暴露的 `timelineMeta.readSource` 只保留当前真实来源集合：

1. `task-domain-projection`
2. `conversation-table`
3. `task-domain-events`
4. `conversation-table+task-domain-events`

已退出的历史 outward 值：

1. `legacy-project-tree-events`
2. `conversation-table+legacy-fallback`
3. `runtime-fallback`

##### 当前结论（2026-03-24）

1. task/project 两条 trace 路由都已移除 runtime message fallback，公开 contract 不再包含 `runtime-fallback`。
2. cached messages 的 runtime fallback 仍只允许存在于 session message compatibility contract，用于 lineage message 拼接、branch 预览与其他非公开 session consumer；它不属于公开 execution trace contract。
3. `service timeline` 不再被定义为“旧 fallback 层”，而是正式但受限的 secondary source。
4. 这条 secondary source 的启用边界已经收窄为：
   1. projection timeline 为空
   2. projection timeline 不可用
5. 只要 projection 已返回非空 timeline，即使 `complete=false`，路由也保留显式 incomplete，不再切到 service timeline 覆盖。

##### `timelineMeta.readSource` 语义

当前 `timelineMeta.readSource` 表示“最终保留下来的结构化 timeline 来源”，而不是“所有尝试过的上游来源列表”。

| 场景 | task-level trace | project-level trace | 当前语义 |
| --- | --- | --- | --- |
| projection 完整 | `task-domain-projection` | `task-domain-projection` | 一致 |
| projection 非空但 `complete=false` | `task-domain-projection` | `task-domain-projection` | 保持显式 incomplete，不切到 service timeline |
| projection 为空或不可用，但 service timeline 可用 | service timeline 的聚合来源值 | service timeline 的聚合来源值 | secondary source 补位 |
| projection 与 service timeline 都不可用 | 保留 projection incomplete meta 或空 timeline meta | 保留 projection incomplete meta 或空 timeline meta | 不再回落到 runtime messages |

##### 当前测试矩阵

1. task/project trace 路由都已覆盖 projection 完整场景。
2. task/project trace 路由都已覆盖 projection 非空 partial 时保持 projection、不启用 service timeline 的场景。
3. task/project trace 路由都已覆盖 projection 为空且 service timeline 可用时，由 service timeline 补位的场景。
4. task/project trace 路由都已覆盖 projection 与 service timeline 都不可用时，保持 explicit incomplete 的场景。

##### 验收口径

至少保留以下验收场景：

1. projection 完整时，trace 接口返回 `task-domain-projection`。
2. projection 非空但不完整时，trace 接口继续返回 `task-domain-projection`，并通过 `complete/cacheState` 暴露 incomplete 语义。
3. projection timeline 为空或不可用、且 service timeline 可用时，trace 接口返回非 legacy 的 service 聚合来源值。
4. 任何场景下，trace 接口都不再返回 `legacy-project-tree-events`。
5. 任何场景下，trace 接口都不再返回 `conversation-table+legacy-fallback`。
6. 任何场景下，trace 接口都不再返回 `runtime-fallback`。

##### 回退策略

若后续发现 projection read-path 存在新的持久化缺口，不回滚到 runtime message fallback，而是只在以下两层内调整：

1. 继续收紧 projection 物化完整性。
2. 在不覆盖 non-empty partial projection 的前提下，维护 service timeline 作为 secondary source 的补位边界。

### 5.3 任务包 C：Tree Payload 白名单化

目标：

1. 为 `project_tree_nodes.content_json` 建立白名单，而不是继续模糊保留。
2. 明确哪些字段属于结构导航、cache、兼容元数据。
3. 明确哪些 task 业务事实字段必须继续迁出或停止使用。

历史盘点范围：

1. task node 的 `content_json`。
2. session node 的 `content_json`。
3. 当前 BFF / service 对这些字段的读取点。

历史盘点产出：

- 一份与总方案/backlog 同步的字段白名单表：

| 字段组 | task node | session node | 仅历史 migration | 说明 |
| --- | --- | --- | --- | --- |
| task business facts：`prompt`、`status`、`sessionId`、`result`、`category`、`strategy`、`repoId`、`workspaceRoot`、`baseRevision`、`workingBranch`、`selectedModel`、`credentialId`、`agentRunId`、`userId` | 禁止 | 禁止 | 保留 | 这些字段现已由 `tasks`、`task_snapshots`、`task_runs` 等聚合/投影承担；若仍出现在树里，只能视为历史迁移产物，不得重新成为运行时读写面。 |
| execution/flow 字段：`executionMode`、`autoAdvanceStages`、`executionPlan`、`parallelRunHistory`、`startedAt`、`finishedAt` | 禁止 | 禁止 | 保留 | 这些字段已经退出 task node 运行时语义；主链应以 orchestration kind、domain run、snapshot 和显式 strategy/repair-only 语义为准。 |
| git/change 摘要：`changesSummary`、`gitAuthorName`、`gitAuthorEmail`、`gitCommitterName`、`gitCommitterEmail`、`finalCommitSha`、`finalBranchName` | 禁止 | 禁止 | 保留 | 当前结构化变更摘要与 git 元数据应走 task aggregate / projection；树节点不再承担这些业务事实镜像。 |
| branch compat lineage 元数据：`sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` | 禁止 | 允许 | 禁止 | 这是当前唯一仍允许保留在 `session` node `content_json` 中的运行时 payload，用于 branch/session lineage 兼容语义；它们不是 task 主状态字段。 |
| 其他候选字段 | 禁止，默认拒绝 | 禁止，默认拒绝 | 按历史语境单独说明 | 除非能证明该字段只承担树结构/lineage 元数据且无法由现有列或聚合替代，否则不应进入新的 whitelist。 |

补充边界：

- `runtimeSessionId`、`branchName`、`contentText`、`refType`、`refId`、`isActive` 等应优先使用树节点独立列表达；它们不是 `content_json` whitelist 的一部分。
- session node 当前允许保留的仅是 `sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` 这一组 branch compat lineage 元数据；不得顺手回填 task 执行状态、摘要、strategy 或 message snapshot。
- 历史 migration 中曾写入 task node `content_json` 的旧字段，应继续只保留为演进说明、回填来源或防回退测试语境，不得被重新解释为现行 runtime contract。

当前测试矩阵：

| 字段组 | 已有护栏测试 | 还缺的 session node lineage-only whitelist 测试 |
| --- | --- | --- |
| task business facts：`prompt`、`status`、`sessionId`、`result`、`category`、`strategy`、`repoId`、`workspaceRoot`、`baseRevision`、`workingBranch`、`selectedModel`、`credentialId`、`agentRunId`、`userId` | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 task patch 后 task node `content_json = {}`、且不回写 `status`、`sessionId`、`selectedModel`、`workingBranch`、`result`；同文件现已补充 session node lineage-only whitelist 精确键集合护栏测试，覆盖 create / activate / archive 后不回写 `status`、`result`、`strategy`、`selectedModel`、`workingBranch` 等 task 字段；[tests/service/task-operating-runtime-tree.test.ts](../../tests/service/task-operating-runtime-tree.test.ts) 已覆盖运行态 strategy 不再镜像进 tree payload；[tests/web-ui/project-tree-task-composable.test.ts](../../tests/web-ui/project-tree-task-composable.test.ts) 已覆盖即使 tree payload 带旧值，BFF 主读链仍以 task read model 为准。 | 当前未再缺少专门的 session node task-business-field 负向护栏；后续只需在新增 branch 写路径时复用同一精确键集合断言。 |
| execution/flow 字段：`executionMode`、`autoAdvanceStages`、`executionPlan`、`parallelRunHistory`、`startedAt`、`finishedAt` | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 task node 不回写 `executionMode`、`executionPlan`、`parallelRunHistory`，并覆盖 detail/list 在 tree payload stale 时仍以 aggregate 为准；同文件还覆盖旧 `strategy_json` 不会恢复 execution 字段，并新增 session node lineage-only whitelist 精确键集合护栏测试，锁定 branch create / activate / archive 后不会写回 execution/flow 字段；[tests/service/transform-export.test.ts](../../tests/service/transform-export.test.ts) 已覆盖历史导出合成 task node 时不再镜像 `executionPlan`、`executionMode`、`autoAdvanceStages`。 | 当前未再缺少专门的 session node execution/flow 负向护栏；后续只需在新增 branch mutation 时保持同一断言。 |
| git/change 摘要：`changesSummary`、`gitAuthorName`、`gitAuthorEmail`、`gitCommitterName`、`gitCommitterEmail`、`finalCommitSha`、`finalBranchName` | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 task node 不回写 `gitCommitterName`、`gitCommitterEmail`，并新增 session node lineage-only whitelist 精确键集合护栏测试，锁定 branch compat 不会写回 `changesSummary`、git author / committer 或最终提交摘要；[tests/web-ui/project-tree-task-composable.test.ts](../../tests/web-ui/project-tree-task-composable.test.ts) 已覆盖 tree payload 中旧 `changesSummary` 不会覆盖 BFF 读模型。 | 当前未再缺少专门的 session node git/change 负向护栏；后续只需保持精确键集合断言不被放宽。 |
| branch compat lineage 元数据：`sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` | [tests/service/task-conversation-session-sync.test.ts](../../tests/service/task-conversation-session-sync.test.ts) 已覆盖 root / fork session 同步到 `conversation_sessions` 时保留 lineage 元数据；[tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 branch 创建、激活、归档与列表读取，并新增 session node lineage-only whitelist 精确键集合护栏测试，直接断言运行时 session node `content_json` 只允许 `sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` 这一组键；[tests/service/tree-task-aggregations.test.ts](../../tests/service/tree-task-aggregations.test.ts) 已覆盖 fork branch timeline / lineage 聚合使用 `parentRuntimeSessionId` 与 `forkedFromMessageId`。 | 当前未再缺少核心 session node lineage-only whitelist 护栏；后续仅需在出现新的 branch compat 字段诉求时先更新白名单表再补测试。 |
| 其他候选字段 | 当前已有护栏以 task node 的显式空 payload、主读不回退旧 payload、导出不再镜像旧字段，以及 session node 的精确键集合断言四类测试为主，足以阻断已知历史字段回流。 | 当前未再缺少默认拒绝型 session 测试；现有精确键集合断言已可作为未来新增字段的统一闸门。 |

- 一组后续 cleanup migration 说明。

验收标准：

1. `content_json` 中的 task 业务事实字段有明确去留边界。
2. 上述测试矩阵已补齐一轮 session node lineage-only whitelist 精确键集合护栏；后续 branch mutation / compat 写路径必须复用同一精确键集合断言。
3. 树节点回归到结构导航和有限 cache 职责。
4. 继续保留一轮 session node lineage-only whitelist 三层闸门回归测试，且测试命名需直接暴露这一语义：
   1. storage 层：以 [tests/service/project-tree-storage.test.ts](../../tests/service/project-tree-storage.test.ts) 锁定 session node create / update / archive 写面不会扩张 session node lineage-only whitelist payload。
   2. branch-write 层：以 [tests/service/task-branch-write.test.ts](../../tests/service/task-branch-write.test.ts) 锁定 `upsertTaskBranch()`、`activateTaskBranch()`、`archiveTaskBranch()` 三条写路径对 storage / session sync 的参数集合不扩张，且 archive 路径不会回落到额外 payload 同步，从而保持 session node lineage-only whitelist 不被放宽。
   3. route 层：以 [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 锁定 create / activate / archive / legacy-lineage 场景下，实际落库后的 session node payload 仍然保持在 session node lineage-only whitelist 内。
5. 若未来新增 branch compat 字段，必须先同步更新白名单表、测试矩阵与 [tests/service/task-route-test-helpers.ts](../../tests/service/task-route-test-helpers.ts) 中的 `assertSessionNodeLineageOnlyContentJson(...)` 共享 helper，再允许修改运行时写路径。

### 5.4 任务包 D：主读切换闭环验证

状态：已完成一轮显式验证，后续进入防回退维护。

目标：

1. 证明主要页面和接口已真正站在新模型上。
2. 把“看起来已经切了”变成“有证据地确认切了”。

历史盘点范围：

1. TaskDetailV3。
2. task execution trace。
3. task list / dashboard / monitor。
4. branches/messages 相关主链路。

当前产出：

1. 已补 TaskDetailV3、task list、monitor、project overview、Dashboard 的主读模型验证矩阵。
2. 已补 task/project execution trace 路由的 projection-first、secondary-source、explicit-incomplete 回归用例。
3. 已补 task snapshot list/detail 两条 BFF 聚合入口的显式验证，确认 snapshot 合并结果会覆盖旧 task 行语义。

当前结论：

1. 主路径对旧模型依赖已经可枚举，且已压缩到受控兼容面。
2. 新模型已经可以单独支撑主要页面和公开 trace 接口读取，当前已完成一轮可追溯的主读模型唯一化验证。
3. 后续重点不再是补新的总验证草案，而是保持这些测试持续阻断 tree payload、runtime fallback 与旧混合读链回流。

### 5.5 任务包 E：对账与 Cleanup Gating

状态：E1 已完成，audit 已具备可持久化 artifact；后续只需要继续用于发布验证。

目标：

1. 让 cleanup 不只是“代码看起来没问题”，而是有对账依据。
2. 让 audit 脚本成为真正的 gating artifact。

必须覆盖的对账口径：

1. `status`
2. `currentSession`
3. `runGraph`
4. `messageCount`
5. `timelineItemCount`

当前命令与产物：

1. `bun run db:audit:task-domain -- --project-id <projectId>`
2. `bun run db:audit:task-domain -- --task-id <taskId> --json`
3. `bun run db:audit:task-domain -- --project-id <projectId> --fail-on-mismatch`
4. `bun run check:task-domain-audit-gate`
5. `bun run db:cleanup:task-domain-audit-fixtures`

当前结论：

1. 上述五个口径已可重复执行并产出稳定结果。
2. audit CLI 已支持 JSON artifact 输出，gate 已默认落盘到 `tmp/task-domain-audit/report.json`。
3. `--help` 路径已去除 DB eager init 副作用，gate 结果可直接用作旧字段退役准入条件。

### 5.6 任务包 F：Cleanup Migration 与文档收口

状态：F1 已完成当前范围的文档收口；migration backlog 仍保留为后续白名单/物理瘦身动作的占位。

目标：

1. 把收尾动作变成 migration backlog，而不是分散在三份 radical 文档里的描述。
2. 清理历史文档中的“未来时”陈述。

保留中的 cleanup migration 占位项：

1. `0018_task_domain_legacy_write_deprecation.sql`
2. `0019_task_domain_tree_payload_shrink.sql`
3. `0020_task_domain_legacy_message_snapshot_retirement.sql`

当前说明：

1. 这些编号不要求立刻落地成 SQL。
2. 已经形成文档化 backlog、边界和验收条件。
3. 本轮已同步收口 [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)、[docs/project-tree-storage-design.md](project-tree-storage-design.md)、[archive/task-domain/historical-pg-event-sourcing-optimization-plan.md](../archive/task-domain/historical-pg-event-sourcing-optimization-plan.md) 的历史/兼容口径。

当前结论：

1. radical 三份文档已经不再承担主 backlog 职责。
2. cleanup backlog 已具备独立入口、执行顺序和完成标准。

## 6. 当前基线与后续维护重点

已完成顺序：

1. 任务包 A：旧字段退役清点
2. 任务包 B：消息兼容层收窄
3. 任务包 C：Tree Payload 白名单化基础收口
4. 任务包 D：主读切换闭环验证
5. 任务包 E：对账与 Cleanup Gating
6. 任务包 F：Cleanup Migration 与文档收口

后续维护重点：

1. 保持 `project_tree_nodes.content_json` 白名单边界不被放宽，新增 branch compat 字段时必须先补文档和护栏测试。
2. 继续压缩显式兼容测试与少量外围历史文档中的旧名词暴露。
3. 将 audit artifact 持续纳入发布前验证，而不是把它视为一次性收尾动作。

## 7. 完成标准

以下条件当前已作为“迁移已收口”的完成判据与后续维护基线：

1. task 主状态不再依赖 tree task snapshot 中的 `executionPlan` 和 `parallelRunHistory`。
2. `TaskDetailV3`、trace、project overview 主路径已经与历史 tree 消息回放语义解耦，不再依赖它来解释当前运行时来源。
3. `project_tree_events` 不再承担消息 canonical storage、消息主投影输入或消息主写路径职责。
4. `project_tree_nodes.content_json` 不再承担 task 业务事实主存储职责。
5. 对账结果可以稳定产出，并能作为旧字段退役 gating artifact。
6. cleanup migration backlog 与文档清单已经固化，不再散落在历史方案文档中。

## 8. 与三份 radical 文档的关系

本文档的定位是：

1. 不替代 radical 方案主体。
2. 优先承接防回退维护、发布验证与少量可选优化说明。
3. 作为后续 cleanup / maintenance 工作的唯一总览入口。

后续更新原则：

1. radical 三份文档继续保留设计来源和历史背景。
2. 一切新的 cleanup 工作项，优先更新本文档，而不是继续扩写三份 radical 文档。
3. 若某项工作已经完成，应优先更新本文档的任务状态，再回写原文档中的状态注记。
