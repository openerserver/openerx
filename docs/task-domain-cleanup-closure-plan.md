# 任务域收尾清理计划

> 状态：待执行
> 日期：2026-03-24
> 作者：GitHub Copilot

## 1. 文档目的

本文档把任务域三份激进重构文档里已经反复出现的“待收尾”事项压缩成一份可执行 backlog，避免后续继续在历史文档里来回翻找。

配套文档：

1. [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
2. [task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
3. [task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md)

当前共识已经很明确：

1. 核心 schema、bridge 字段、projection 表已经落地。
2. 主问题已经不是“缺新模型”，而是“旧模型如何有边界地退出”。
3. 后续工作应以 cleanup 为中心，而不是继续扩写 radical 方案主体。

## 2. 收尾目标

本轮收尾的最终目标只有五个：

1. `executionPlan`、`parallelRunHistory` 不再参与主业务判断。
2. `project_tree_events` 不再承担消息 canonical storage 或消息主投影输入职责。
3. `project_tree_nodes.content_json` 不再承担 task 业务事实主存储职责。
4. `TaskDetailV3`、trace、task list、monitor 的主读链路对旧模型依赖可被验证地清零或压缩到受控兼容面。
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
| P0 | 清理 `executionPlan` 与 `parallelRunHistory` 剩余兼容引用 | service, web-ui-bff, tests, docs | 主路径代码不再读写这两个字段；仅允许保留在显式兼容测试、历史文档或受控 repair-only 分支中；剩余保留点可枚举 |
| P0 | 收窄 `project_tree_events` 的消息兼容层 | service, web-ui-bff, trace 读取链路 | `conversation_messages` 与 `task_timeline_views` 成为消息主读来源；`project_tree_events` 只保留历史回放或显式 fallback 语义 |
| P0 | 完成主读切换验证 | TaskDetailV3, trace, task list, monitor | 主页面不再依赖 tree task snapshot、旧 message fallback 或 runtime fallback 才能成立；有一轮可追溯验证结果 |
| P1 | 继续瘦身 `project_tree_nodes.content_json` | service, project tree, BFF 聚合 | task 业务事实字段继续迁出；`content_json` 仅保留树导航、少量 cache 和必要兼容元数据；形成白名单 |
| P1 | 形成对账报告与 gating artifact | db audit, CI/check scripts | 至少覆盖 `status`、`currentSession`、`runGraph`、`messageCount`、`timelineItemCount` 五个口径；结果可重复执行 |
| P1 | 补 cleanup migration 计划或 checklist | docs, migration backlog | 收尾动作形成明确 migration backlog、执行顺序和验收标准 |
| P2 | 压缩显式兼容测试与 repair-only 语义 | tests, maintenance code | 兼容测试范围可枚举；repair-only 分支有边界说明；不存在无文档旧模型依赖 |
| P2 | 清理历史文档中的未来时表述 | docs | 三份 radical 文档不再把已完成 schema 建设写成待做事项；未完成项统一指向本计划 |

## 5. 任务包拆分

### 5.1 任务包 A：旧字段退役清点

目标：

1. 枚举 `executionPlan`、`parallelRunHistory` 的剩余读写点。
2. 区分哪些属于显式兼容、哪些属于 repair-only、哪些已经可以删除。
3. 输出一份保留点清单，作为后续 cleanup 任务输入。

建议范围：

1. service task routes / projector / reconcile / finalize 相关代码。
2. web-ui-bff task routes / trace / branches / workflow 相关代码。
3. 测试中显式构造旧字段的 case。
4. 文档中仍把旧字段当主语义描述的段落。

建议产出：

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
| `keep-for-compat` | 保留 | [control-plane/service/drizzle-pg/0009_task_fk_to_project_tree_nodes.sql](../control-plane/service/drizzle-pg/0009_task_fk_to_project_tree_nodes.sql) | 历史迁移会把旧 `tasks.execution_plan` 映射进 `project_tree_nodes.content_json.executionPlan`；属于既有数据迁移产物，不是当前主写路径 |
| `keep-for-compat` | 保留 | [tests/service/project-tree-routes.test.ts](../tests/service/project-tree-routes.test.ts) | 显式构造 legacy PATCH 输入，验证 tree/task aggregate 读写链路会忽略 `executionPlan`、`parallelRunHistory` |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/task-completion-routes.test.ts](../tests/web-ui-bff/task-completion-routes.test.ts) | 显式构造 legacy parallel payload，验证候选 adopt 在缺少 domain runs 时不会退回旧字段主语义 |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/runtime-pipeline.test.ts](../tests/web-ui-bff/runtime-pipeline.test.ts) | 验证非并行任务即使携带 legacy runtime plan，也只走 planning / projection 语义，不重新启用旧字段 |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/project-tree-task-composable.test.ts](../tests/web-ui-bff/project-tree-task-composable.test.ts) | 验证 tree node flatten 过程会主动丢弃 `executionPlan`、`parallelRunHistory` |
| `keep-for-compat` | 保留 | [tests/service/transform-export.test.ts](../tests/service/transform-export.test.ts) | 验证导出迁移生成的 task node content 不再保留 `executionPlan` |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/task-finalize.test.ts](../tests/web-ui-bff/task-finalize.test.ts), [tests/web-ui-bff/task-reconcile.test.ts](../tests/web-ui-bff/task-reconcile.test.ts), [tests/web-ui-bff/lifecycle-hooks-behavior.test.ts](../tests/web-ui-bff/lifecycle-hooks-behavior.test.ts), [tests/web-ui-bff/realtime-pipeline-events.test.ts](../tests/web-ui-bff/realtime-pipeline-events.test.ts), [control-plane/web-ui/src/lib/taskExecutionMode.test.ts](../control-plane/web-ui/src/lib/taskExecutionMode.test.ts) | 防回归护栏，统一验证主路径 PATCH body / tree payload / UI patch builder 不会重新写回 legacy 字段 |
| `keep-for-compat` | 保留 | [control-plane/service/src/modules/tasks/task-status-update.ts](../control-plane/service/src/modules/tasks/task-status-update.ts), [control-plane/service/src/modules/tasks/task-core-routes.ts](../control-plane/service/src/modules/tasks/task-core-routes.ts) | 这里的结论是“已完成退役”：schema 和 direct update keys 都不再接收 legacy 字段，应作为主写路径已清零的基线证据 |
| `keep-for-compat` | 保留 | [control-plane/web-ui-bff/src/lib/runtime-pipeline.ts](../control-plane/web-ui-bff/src/lib/runtime-pipeline.ts) | 仅剩 `appendExecutionPlanStep` 这类命名；这里消费的是内存中的 `RuntimePlan` 结构，不是任务表 legacy 字段读写点 |
| `delete-now` | 待清理 | [docs/task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md), [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md), [docs/task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md), [docs/parallel-judge-selection-plan.md](parallel-judge-selection-plan.md), [docs/runtime-pipeline-upgrade-plan.md](runtime-pipeline-upgrade-plan.md), [docs/multi-agent-hook-architecture.md](multi-agent-hook-architecture.md) | 这些文档仍保留较多旧字段历史描述；多数已带“历史语境”注记，但尚未统一指向本计划，属于后续文档收口对象 |
| `keep-for-repair-only` | 暂无 | 无 | 本轮 source 扫描未找到仍显式依赖这两个字段的 repair-only 代码分支 |

#### 5.1.3 任务包 A 的当前判断

第一轮盘点后，可以把任务包 A 拆成两个后续动作：

1. 保留显式兼容测试，但继续评估是否能把同类 legacy-input case 合并到更少的专门测试中。
2. 不再把 source 主路径视为 cleanup 重点，后续清理重点转向历史 migration 注记和文档语义收口。

### 5.2 任务包 B：消息兼容层收窄

目标：

1. 明确 `project_tree_events` 在消息读取链路里的剩余职责。
2. 将其压缩到“历史回放”或“受控 fallback”模式。
3. 禁止新主路径继续从 tree snapshot message 构建 canonical timeline。

建议范围：

1. service `task-session-read`、timeline/projection 相关路径。
2. web-ui-bff branches/messages、trace、session tree 相关聚合逻辑。
3. runtime fallback 与 tree fallback 的调用边界。

建议产出：

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
3. `project_tree_events` 的剩余收尾项，当前主要体现在测试仍保留少量 legacy 场景，以及历史文档仍在描述旧消息回放语境。
4. 因此任务包 B 的重点，不再是“替换主读实现”，而是“压缩 outward compatibility surface，并明确最终停读边界”。

#### 5.2.2 当前保留点分类

| 分类 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| `keep-for-compat` | 保留 | [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts) | session `messages` / `events` / `timeline` 当前通过 `conversation_messages` 和 `conversation.message.upserted` 合成消息视图；这里仍保留 `session.message.created` / `updated` / `completed` / `snapshot` 的合成 eventType，用于兼容旧 timeline/sourceEventTypes 语义 |
| `keep-for-compat` | 保留 | [control-plane/service/src/modules/tasks/task-branch-routes.ts](../control-plane/service/src/modules/tasks/task-branch-routes.ts) | `/branches/:runtimeSessionId/messages`、`/events`、`/timeline` 仍作为历史分支消息接口存在，但内部已不直接读取 `project_tree_events` |
| `delete-now` | 已完成 | [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) | 阶段 3 已删除剩余旧 readSource 翻译分支；BFF 仅接受并透传当前合法的 timeline readSource 集合，不再在此处消费 `conversation-table+tree-fallback`、`project-tree-events`、`tree-events` |
| `delete-now` | 已完成 | [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts), [control-plane/web-ui-bff/src/modules/projects/routes.ts](../control-plane/web-ui-bff/src/modules/projects/routes.ts) | trace/timeline outward type 已移除 `conversation-table+legacy-fallback` 与 `legacy-project-tree-events`；当前对前端只暴露 `conversation-table`、`task-domain-events`、`conversation-table+task-domain-events`、`task-domain-projection`、`runtime-fallback` |
| `keep-for-compat` | 保留 | [tests/web-ui-bff/task-execution-trace-route.test.ts](../tests/web-ui-bff/task-execution-trace-route.test.ts) | 覆盖 trace 在 projection 不完整时优先回退到 service timeline 聚合，而不是直接 runtime；当前测试仍保留 tree-cache 语境命名 |
| `delete-now` | 已完成 | [tests/service/project-tree-routes.test.ts](../tests/service/project-tree-routes.test.ts) | lineage-aware session message 测试命名已改为当前实现语义，强调 persisted conversation state / conversation tables，而不再暗示 tree-event message fallback 是主路径 |
| `keep-for-compat` | 保留 | [tests/service/tree-task-aggregations.test.ts](../tests/service/tree-task-aggregations.test.ts), [tests/service/task-route-registration-smoke.test.ts](../tests/service/task-route-registration-smoke.test.ts), [tests/service/task-operating-runtime-tree.test.ts](../tests/service/task-operating-runtime-tree.test.ts) | 大量测试清理逻辑仍显式删除 `project_tree_events`，说明它依旧是集成测试环境中的历史表与副产物，但不是消息主读源 |
| `keep-for-compat` | 部分完成 | [docs/task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md), [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md), [docs/task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md), [docs/pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md), [docs/project-tree-storage-design.md](project-tree-storage-design.md) | 三份 task-domain 设计文档已统一为“历史回放 / 审计窗口 / 测试清理副产物”口径；剩余待收口项主要在非 task-domain 的历史树模型文档 |
| `keep-for-repair-only` | 暂无 | 无 | 本轮 source 扫描未找到直接查询 `project_tree_events` 作为消息读取来源的 repair-only 代码分支 |

#### 5.2.3 关键证据

1. [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts) 中 `buildTaskSessionMessagesResponse()` 明确优先读 `conversation_messages`，缺失时回退到 `conversation.message.upserted` 生成的合成消息，而不是 tree events。
2. 同文件中的 `buildTaskSessionTimelineResponse()` 和 `buildTaskSessionEventsResponse()` 依赖的是 `conversation_sessions`、`conversation_messages`、`task_domain_events` 与 session lineage 记录；`project_tree_events` 未出现在实际查询路径中。
3. [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) 的旧 `readSource` 值归一逻辑已在阶段 3 删除，说明这一层剩余工作已从“兼容翻译”转向“确认上游 service 不再回吐旧枚举值”。
4. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 与 [control-plane/web-ui-bff/src/modules/projects/routes.ts](../control-plane/web-ui-bff/src/modules/projects/routes.ts) 的 trace/timeline 类型已完成收口，不再把 legacy readSource 作为公开契约暴露给前端。

#### 5.2.4 任务包 B 的当前判断

第一轮盘点后，任务包 B 可以拆成三个后续动作：

1. 收窄 BFF outward contract：已完成，trace 接口不再对前端暴露 `legacy-project-tree-events` 与 `conversation-table+legacy-fallback`。
2. 清理测试与命名：已完成，service 侧残留的 “legacy tree event history / tree cache” 测试命名已改为当前实现语义。
3. 文档收口：统一声明 `project_tree_events` 在消息链路中的剩余职责只限历史回放、审计窗口或测试环境清理。

#### 5.2.5 BFF outward contract 清单

第二轮盘点聚焦 BFF 对外接口。以下内容保留为阶段 1/2 的执行记录；当前代码状态下，前端已不再把 `legacy-project-tree-events` 或 `conversation-table+legacy-fallback` 当作公开 readSource 契约。

阶段性盘点结论：

1. 在阶段 1/2 盘点时，明确需要收口的对外接口只确认到两个 execution trace 路由。
2. 当前 `fetchTaskSessionTimeline()`、`fetchTaskSessionCachedMessages()` 仍是内部 helper，但旧 readSource 翻译已删除，不再承担向前端屏蔽或转换旧契约的责任。
3. 当前没有发现 BFF 直接对前端开放 `/api/tasks/:taskId/branches/:runtimeSessionId/messages` 或 `/timeline` 这类消息缓存接口。

| 接口 | 文件 | 当前状态 | 可能返回的 legacy readSource | 说明 |
| --- | --- | --- | --- | --- |
| `GET /api/tasks/:taskId/execution-trace` | [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) | 对外暴露 | 无 | 返回 `TaskExecutionTraceRecord.timelineMeta`；当前 outward type 已收紧到非 legacy 集合，内部按 projection、service timeline、runtime fallback 顺序构造最终 trace |
| `GET /api/projects/:projectId/task-execution-trace/:taskId` | [control-plane/web-ui-bff/src/modules/projects/routes.ts](../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 对外暴露 | 无 | 返回项目视角下的 execution trace；`timelineMeta` 与 tasks 路由一致，不再透传 legacy readSource |
| `fetchTaskSessionTimeline()` / `fetchTaskSessionCachedMessages()` | [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) | 内部 helper | 无 | 这里现在只透传当前 `TaskSessionTimelineMeta`，不再规范化或翻译旧 readSource |
| `buildTaskExecutionTrace()` 内部 timeline fallback | [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts), [control-plane/web-ui-bff/src/modules/projects/routes.ts](../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 对外间接暴露 | 无 | 该汇聚点仍决定 trace 接口的最终来源语义，但返回值已限制在非 legacy readSource 集合 |

补充判断：

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 当前只搜索到 `GET /api/tasks/:taskId/execution-trace` 这一条真正对外返回 `timelineMeta` 的任务级路由。
2. [control-plane/web-ui-bff/src/modules/projects/routes.ts](../control-plane/web-ui-bff/src/modules/projects/routes.ts) 当前只搜索到 `GET /api/projects/:projectId/task-execution-trace/:taskId` 这一条真正对外返回 `timelineMeta` 的项目级路由。
3. 这意味着任务包 B 第二步的实际收口范围很小，优先级应集中在这两个 trace 接口，而不是泛化到所有 task/branch API。

#### 5.2.6 Trace 接口收口方案

本节只针对以下两个 outward contract：

1. `GET /api/tasks/:taskId/execution-trace`
2. `GET /api/projects/:projectId/task-execution-trace/:taskId`

以下 5.2.6 保留的是阶段 1 到阶段 3 的执行记录；相关 legacy readSource 名称只用于描述历史收口目标，不再代表当前公开契约。

##### 方案目标

最终对前端暴露的 `timelineMeta.readSource` 只允许保留以下集合：

1. `task-domain-projection`
2. `runtime-fallback`
3. 可选：`conversation-table`
4. 可选：`task-domain-events`
5. 可选：`conversation-table+task-domain-events`

明确退出的 outward 值：

1. `legacy-project-tree-events`
2. `conversation-table+legacy-fallback`

##### 分阶段执行

##### 阶段 1：观测收敛，不改对外契约

目标：

1. 证明这两个 trace 接口在当前实现下已经几乎不会真实返回 legacy readSource。
2. 把“类型允许”与“运行时实际出现”分开。

建议动作：

1. 为两个 trace 接口补一轮测试，覆盖：
   1. projection 完整
   2. projection 不完整但 service timeline 可用
   3. service timeline 不可用，退到 runtime fallback
2. 统计这三类路径下实际返回的 `timelineMeta.readSource`。
3. 明确是否还存在任何测试或真实路径会返回：
   1. `legacy-project-tree-events`
   2. `conversation-table+legacy-fallback`

阶段 1 通过条件：

1. 新增或现有测试中，不再需要显式断言这两个 legacy readSource 才能通过。
2. 运行时样本里没有新的主路径依赖这两个值做 UI 分支判断。

阶段 1 当前观测结果（2026-03-24）：

1. 已为 task-level 与 project-level trace 路由补齐一轮测试矩阵，覆盖：
   1. projection 完整
   2. projection 不完整但 service timeline 可用
   3. projection 与 service timeline 都不可用时的 runtime message fallback
2. 当前测试矩阵下，没有任何一条响应返回：
   1. `legacy-project-tree-events`
   2. `conversation-table+legacy-fallback`
3. task-level trace 路由在 projection 与 service timeline 都不可用时，会返回 `timelineMeta.readSource = runtime-fallback`。
4. project-level trace 路由在 projection 与 service timeline 都不可用时，现已对齐为返回 `timelineMeta.readSource = runtime-fallback`，并同时标记 `cacheState = none`。
5. 当前两个 trace 路由在 runtime fallback 场景下已经给前端返回同一组 readSource 语义。

##### `timelineMeta.readSource` 语义差异整理

当前两个 trace 路由的核心差异，不在数据来源优先级，而在 `timelineMeta.readSource` 的语义解释：

| 场景 | task-level trace | project-level trace | 当前问题 |
| --- | --- | --- | --- |
| projection 完整 | `task-domain-projection` | `task-domain-projection` | 一致 |
| projection 不完整，但 service timeline 可用 | service timeline 的聚合来源值 | service timeline 的聚合来源值 | 基本一致 |
| projection 与 service timeline 都不可用，最终改走 runtime messages | `runtime-fallback` | `runtime-fallback` | 已对齐 |

当前 task-level 路由的 `readSource` 更接近：

1. 最终用于构造 `finalPrompt` / `latestResponse` / trace segments 的消息来源。

当前两个路由已经按方案 A 对齐：

1. `readSource` 代表最终用于生成 trace 文本的消息来源。
2. 不再把 project-level 的 `readSource` 当作“最后一次成功拿到的上游 timeline/meta 来源”。

##### 可选统一方案

方案 A：把 `readSource` 统一解释为“最终消息来源”

规则：

1. 如果最终 `finalPrompt` / `latestResponse` / trace segments 主要来自 runtime messages，则 `readSource = runtime-fallback`。
2. 如果最终主要来自 service timeline 聚合，则 `readSource` 记为对应 service 聚合来源。
3. 如果最终主要来自 projection timeline，则 `readSource = task-domain-projection`。

优点：

1. 对前端最直观。
2. task-level 已经接近这个语义。
3. 更适合作为用户可见 contract。

代价：

1. project-level 路由需要调整 `loadTaskExecutionTraceRuntimeFallbackSegments()` 一类逻辑，让 meta 随最终 fallback 一起切换。

##### 阶段 3 当前落地结果（2026-03-24）

1. [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) 已删除 `conversation-table+tree-fallback`、`project-tree-events`、`tree-events` 的 wire 类型与归一函数。
2. `fetchTaskSessionTimeline()` 与 `fetchTaskSessionCachedMessages()` 现在直接以当前 `TaskSessionTimelineMeta` 作为响应类型，不再在 BFF 侧做旧枚举翻译。
3. 这一步把阶段 3 的边界收紧为：若上游 service 仍返回旧 readSource 值，应由 service 侧直接修复，而不是继续由 BFF 吞掉并转换。

方案 B：把 `readSource` 统一解释为“最优先的结构化 timeline 来源”

规则：

1. 只要 projection meta 存在，就优先保留 `task-domain-projection`。
2. runtime fallback 只影响 segments/messages，不回写 `timelineMeta.readSource`。

优点：

1. project-level 当前实现已经接近这个语义。
2. 可以把 `timelineMeta` 理解为 timeline cache 的状态，而不是完整 trace 的最终来源。

代价：

1. task-level 路由需要改。
2. 前端看到 `task-domain-projection` 时，不能直接推断最终 trace 文本不是来自 runtime fallback，语义更绕。

##### 推荐方案

推荐采用方案 A：`readSource` 统一表示“最终消息来源”。

原因：

1. 这是更适合 outward contract 的语义。
2. 当前任务包 B 的目标是收窄前端契约，而不是保留内部 cache 细节。
3. 若前端只看到 `task-domain-projection`，但实际文本来自 runtime fallback，会让 `readSource` 失去判读价值。
4. task-level 已经证明这种语义可以稳定工作，统一成本低于继续保留双语义。

##### 推荐改动方案

若采用方案 A，阶段 2 之前先完成以下统一：

1. task-level 与 project-level trace 都以“最终用于生成 trace 文本的消息来源”作为 `timelineMeta.readSource`。
2. 当 runtime fallback 真的参与生成 `finalPrompt` / `latestResponse` / trace segments，且没有更完整的 timeline 数据覆盖时，统一输出 `runtime-fallback`。
3. 若存在完整或足够的 timeline 数据，runtime 仅作为兜底探测但未参与最终文本生成，则保持 timeline 的原始来源值。
4. 若后续仍需要表达“projection 曾参与过尝试”，应新增内部调试字段或日志，而不是继续复用 outward `readSource`。

阶段 2 当前落地结果（2026-03-24）：

1. project-level trace 已改为在 runtime fallback 真正参与生成 trace 文本时输出 `readSource = runtime-fallback`。
2. tasks/projects 两个 trace 接口相关的 outward 联合类型，已移除：
   1. `legacy-project-tree-events`
   2. `conversation-table+legacy-fallback`
3. web-ui 侧的 `ExecutionTraceReadSource` 联合类型与来源标签映射已同步收紧，不再展示 legacy 值。
4. `task-session-compat.ts` 的旧 wire 值吞吐能力已在阶段 3 删除，BFF 不再承担旧 readSource 的兼容翻译。

##### 推荐验收判断

采用方案 A 后，应按下列口径验收：

1. 前端读取 `timelineMeta.readSource` 时，可以直接把它理解成“最终 trace 文本主要来自哪里”。
2. task-level 与 project-level 在相同 fallback 场景下，返回相同的 `readSource`。
3. `timelineMeta.readSource` 不再同时承担“cache 来源”和“最终消息来源”两个含义。

##### 阶段 2：收窄 BFF 类型与归一化输出

目标：

1. 从 outward contract 中删除 legacy readSource。
2. 即使 service 未来短期仍返回旧值，BFF 也不继续向前端透出。

建议动作：

1. 收紧 [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) 的 outward 类型定义。
2. 收紧 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 与 [control-plane/web-ui-bff/src/modules/projects/routes.ts](../control-plane/web-ui-bff/src/modules/projects/routes.ts) 中 `timelineMeta.readSource` 的联合类型。
3. 对旧值采取以下策略之一：
   1. 映射为更抽象但非 legacy 的内部兼容值
   2. 直接省略 `readSource`
   3. 若 timeline 来自 service 聚合层，则统一记为 `conversation-table` 或 `task-domain-events` 语义

建议优先策略：

1. 前端 contract 不再暴露 legacy 标签。
2. 若 service 仍回旧值，BFF 内部先吞掉并映射到非 legacy 值或省略该字段。
3. 不要求阶段 2 同步删除 service 兼容代码，只要求对前端不可见。

阶段 2 通过条件：

1. 两个 trace 接口的 response type 不再声明 `legacy-project-tree-events`。
2. 两个 trace 接口的 response type 不再声明 `conversation-table+legacy-fallback`。
3. 前端代码中不存在针对这两个值的条件分支。

##### 阶段 3：删除兼容翻译层

目标：

1. 删除 `task-session-compat.ts` 中专门针对旧 readSource 名称的归一化分支。
2. 让 BFF 与 service 对消息来源命名回到当前真实模型。

建议动作：

1. 删除 `conversation-table+tree-fallback -> conversation-table+legacy-fallback` 的翻译。
2. 删除 `project-tree-events` / `tree-events -> legacy-project-tree-events` 的翻译。
3. 把测试 fixtures 与 mocks 改成当前 contract 值。

阶段 3 通过条件：

1. [control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts) 不再包含 legacy readSource 归一逻辑。
2. 相关 trace 测试全部改为断言 `task-domain-projection`、非 legacy service 聚合值或 `runtime-fallback`。
3. 没有任何 BFF route 或 type 继续提到这两个 legacy outward 值。

##### 什么时候可以停止对前端暴露 legacy 值

以下条件是阶段 2 当时的进入门槛，现已满足并完成执行：

1. 两个 trace 接口在现有测试矩阵下，能够稳定覆盖 projection、service timeline、runtime fallback 三种路径。
2. trace 页面或其消费者不存在对这两个 legacy readSource 的显式分支依赖。
3. service timeline 聚合在 projection 不完整时，已经能够提供足够的 `timeline` / `messages` 数据，不需要靠 legacy readSource 值提示前端额外兜底。
4. 对前端而言，区分“service 聚合但来源曾带 legacy 语义”已经没有产品价值，只需要知道它不是 `runtime-fallback` 即可。

##### 不应提前移除的情形

以下风险判断保留为历史记录；当前扫描结果显示这些情形已不再成立：

1. 阶段 2 前若前端页面仍根据 `legacy-project-tree-events` 决定展示警告、刷新策略或 lineage 行为，则不应提前移除旧 outward 值。
2. 阶段 2 前若 service 仍可能返回旧值，且 BFF 还没有吞掉这些值的映射策略，则不应提前移除旧 outward 值。
3. 阶段 2 前若测试仍只能通过断言 legacy readSource 来证明“用了 service timeline 而不是 runtime fallback”，则不应提前移除旧 outward 值。

##### 建议验收用例

至少保留以下验收场景：

1. projection 完整时，trace 接口返回 `task-domain-projection`。
2. projection 不完整但 service timeline 可用时，trace 接口返回非 legacy 的聚合来源值，且不触发 runtime fallback。
3. projection 与 service timeline 都不可用时，trace 接口返回 `runtime-fallback`。
4. 任何场景下，trace 接口都不再返回 `legacy-project-tree-events`。
5. 任何场景下，trace 接口都不再返回 `conversation-table+legacy-fallback`。

##### 回退策略

若阶段 2 后发现真实前端仍依赖 legacy 值，不回滚到底层读取实现，只回滚 outward 映射层：

1. 临时恢复 BFF 内部 readSource 归一映射。
2. 保持 service timeline / projection / runtime fallback 优先级不变。
3. 先补齐前端或测试依赖，再继续推进阶段 2。

### 5.3 任务包 C：Tree Payload 白名单化

目标：

1. 为 `project_tree_nodes.content_json` 建立白名单，而不是继续模糊保留。
2. 明确哪些字段属于结构导航、cache、兼容元数据。
3. 明确哪些 task 业务事实字段必须继续迁出或停止使用。

建议范围：

1. task node 的 `content_json`。
2. session node 的 `content_json`。
3. 当前 BFF / service 对这些字段的读取点。

建议产出：

1. 一份字段白名单表。
2. 一组后续 cleanup migration 说明。

验收标准：

1. `content_json` 中的 task 业务事实字段有明确去留边界。
2. 树节点回归到结构导航和有限 cache 职责。

### 5.4 任务包 D：主读切换闭环验证

目标：

1. 证明主要页面和接口已真正站在新模型上。
2. 把“看起来已经切了”变成“有证据地确认切了”。

建议范围：

1. TaskDetailV3。
2. task execution trace。
3. task list / dashboard / monitor。
4. branches/messages 相关主链路。

建议产出：

1. 一份验证矩阵，按页面列出主读数据源。
2. 每条链路注明是否仍有旧字段 fallback。

验收标准：

1. 主路径对旧模型依赖可枚举且足够小。
2. 新模型可单独支撑正常页面读取。

### 5.5 任务包 E：对账与 Cleanup Gating

目标：

1. 让 cleanup 不只是“代码看起来没问题”，而是有对账依据。
2. 让 audit 脚本成为真正的 gating artifact。

必须覆盖的对账口径：

1. `status`
2. `currentSession`
3. `runGraph`
4. `messageCount`
5. `timelineItemCount`

建议命令：

1. `bun run db:audit:task-domain -- --project-id <projectId>`
2. `bun run db:audit:task-domain -- --task-id <taskId> --json`
3. `bun run db:audit:task-domain -- --project-id <projectId> --fail-on-mismatch`
4. `bun run check:task-domain-audit-gate`
5. `bun run db:cleanup:task-domain-audit-fixtures`

验收标准：

1. 上述五个口径可以重复执行并产出稳定结果。
2. gate 结果可被用作旧字段退役准入条件。

### 5.6 任务包 F：Cleanup Migration 与文档收口

目标：

1. 把收尾动作变成 migration backlog，而不是分散在三份 radical 文档里的描述。
2. 清理历史文档中的“未来时”陈述。

建议新增的 cleanup migration 占位项：

1. `0018_task_domain_legacy_write_deprecation.sql`
2. `0019_task_domain_tree_payload_shrink.sql`
3. `0020_task_domain_legacy_message_snapshot_retirement.sql`

说明：

1. 这些编号不要求立刻落地成 SQL。
2. 但至少要先形成文档化 backlog、边界和验收条件。

验收标准：

1. radical 三份文档不再承担主 backlog 职责。
2. cleanup backlog 有独立入口、执行顺序和完成标准。

## 6. 建议执行顺序

推荐顺序：

1. 任务包 A：旧字段退役清点
2. 任务包 B：消息兼容层收窄
3. 任务包 C：Tree Payload 白名单化
4. 任务包 D：主读切换闭环验证
5. 任务包 E：对账与 Cleanup Gating
6. 任务包 F：Cleanup Migration 与文档收口

原因：

1. 先知道旧模型还剩什么，再去删。
2. 先压缩 runtime/tree fallback，再做最终切读验证，避免验证矩阵失真。
3. 对账和 migration backlog 应建立在边界已经明确之后。

## 7. 完成标准

只有当以下条件同时满足时，任务域 radical 重构才算从“主体已实现，待收尾清理”升级为“迁移已收口”：

1. task 主状态不再依赖 tree task snapshot 中的 `executionPlan` 和 `parallelRunHistory`。
2. `TaskDetailV3`、trace、project overview 主路径已经与历史 tree 消息回放语义解耦，不再依赖它来解释当前运行时来源。
3. `project_tree_events` 不再承担消息 canonical storage、消息主投影输入或消息主写路径职责。
4. `project_tree_nodes.content_json` 不再承担 task 业务事实主存储职责。
5. 对账结果可以稳定产出，并能作为旧字段退役 gating artifact。
6. cleanup migration backlog 与文档清单已经固化，不再散落在历史方案文档中。

## 8. 与三份 radical 文档的关系

本文档的定位是：

1. 不替代 radical 方案主体。
2. 只接管“还没完成的收尾事项”。
3. 作为后续 cleanup 工作的唯一总览入口。

后续更新原则：

1. radical 三份文档继续保留设计来源和历史背景。
2. 一切新的 cleanup 工作项，优先更新本文档，而不是继续扩写三份 radical 文档。
3. 若某项工作已经完成，应优先更新本文档的任务状态，再回写原文档中的状态注记。
