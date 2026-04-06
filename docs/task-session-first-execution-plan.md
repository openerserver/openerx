# Task → Sessions 重建执行计划（硬切重写版）

> 状态：Draft v1
> 日期：2026-03-28
> 作者：GitHub Copilot
> 关联方案：[task-session-first-schema-plan.md](task-session-first-schema-plan.md)、[task-session-message-current-write-path.md](task-session-message-current-write-path.md)、[task-runtime-rewrite-phase0-checklist.md](task-runtime-rewrite-phase0-checklist.md)、[task-runtime-rewrite-decision-memo.md](task-runtime-rewrite-decision-memo.md)

## 1. 文档目的

这份文档只负责回答一件事：

在已经确认采用 `task -> sessions` 重建方案之后，如何按“冲突即删旧实现、不做兼容、允许阶段性不可运行”的原则，把当前代码库直接切到新模型。

这份文档不再讨论“要不要这么做”，也不再讨论平滑迁移路径。这里默认以下前提已经成立：

1. 旧实现不是约束条件
2. 旧 contract 不是保护对象
3. 中途不可运行是可接受代价
4. 设计正确性优先于渐进兼容

### 1.1 决策边界

本文默认采用 [task-runtime-rewrite-decision-memo.md](task-runtime-rewrite-decision-memo.md) 中的结论：

1. 不是整仓完全重写
2. 也不是继续在当前任务主链上长期删改
3. 而是在现有仓库内，对任务域 + runtime 接入 + BFF 任务聚合层实施硬切重写

因此本文中的“硬切”范围，指的是任务子系统硬切，而不是认证、项目管理、审计、外围页面框架等整个平台能力全部重来。

## 2. 执行总原则

### 2.1 硬切原则

1. 不做双写
2. 不做 alias
3. 不做 compat shim
4. 不保留 fallback 读链
5. 不为旧 route 保留代理层
6. 不为旧类型保留过渡名称

一句话说就是：**新模型一旦接管某一层，旧层当场删除。**

### 2.2 运行态原则

1. 允许 service、BFF、web-ui 在重写过程中阶段性不可运行
2. 不要求任一阶段都保持全链路绿灯
3. 每个阶段的目标是“替换并删旧”，不是“上线可用”
4. 真正的整体可运行，以阶段性验证 gate 为准，而不是以中间态兼容为准

### 2.3 旧实现处理原则

凡是下列对象，只要和新模型冲突，就直接删：

1. `task_runs`
2. `task_run_nodes`
3. `task_run_edges`
4. `task_domain_events`
5. `conversation_sessions`
6. `conversation_messages`
7. `conversation_message_parts`
8. `/tasks/:taskId/branches*`
9. `/tasks/:taskId/domain-runs*`
10. `task-session-compat`
11. execution-trace 里的 run / event fallback
12. 任何继续暴露旧字段语义的 BFF / web-ui 类型

## 3. 默认拍板实现口径

这一节不是开放问题，而是本执行计划的默认决策。除非后续明确推翻，否则按这里实现。

### 3.1 数据边界默认决策

1. `tasks` 是唯一任务聚合根
2. `task_sessions` 是唯一执行事实
3. `task_session_messages` / `task_session_message_parts` 是唯一消息事实
4. `task_operations` 是唯一低层调用事实
5. `task_artifacts` 是唯一正式产出主表
6. `task_usage_ledger_entries` 是唯一任务域 usage / cost 账务主表

### 3.2 `project_tree_nodes` 默认决策

1. `project_tree_nodes` 继续保留，但只用于导航、信息架构和树形关系
2. `tasks.tree_node_id` 允许保留为 bridge 字段
3. `task_sessions.tree_node_id` 允许保留为 session 节点桥接字段
4. tree `content_json` 不再承担任何 task / session 业务字段 fallback
5. 只要 tree 与 task / session 事实冲突，以新事实表为准

### 3.3 Public route 默认决策

service 最终 public contract 默认收敛到：

1. `GET /tasks/:taskId/sessions`
2. `POST /tasks/:taskId/sessions`
3. `GET /tasks/:taskId/sessions/:sessionId`
4. `GET /tasks/:taskId/sessions/:sessionId/messages`
5. `GET /tasks/:taskId/sessions/:sessionId/timeline`
6. `GET /tasks/:taskId/sessions/:sessionId/operations`
7. `GET /tasks/:taskId/artifacts`
8. `GET /tasks/:taskId/usage-ledger`
9. `POST /tasks/:taskId/session-groups/:coordinationKey/adopt`

这里的 adopt contract 默认使用：

1. `coordination_key`
2. `winner_session_id`

明确不再使用：

1. `runId`
2. `candidateIndex` 作为外部 contract 主键

### 3.4 workflow bridge 默认决策

1. `workflow_template_id`
2. `workflow_template_version`
3. `workflow_source`
4. `stage_key`
5. `spawned_from_task_id`
6. `spawn_trigger_event`
7. `spawn_rule_key`

这些字段一律视为 task create-time snapshot。

默认规则：

1. 运行后只读
2. 不从 `strategy_json` 回退读取
3. 不从 workflow runtime 表回退读取
4. 模板重绑只允许专用 command-style 管理动作

### 3.5 首批正式产物默认范围

`task_artifacts` 第一轮必须接管：

1. changes summary
2. diff
3. patch
4. judge scorecard
5. hook report

`task_usage_ledger_entries` 第一轮必须接管：

1. `model_request`
2. `judge_request`
3. `hook_request`

## 4. 当前代码冲突清单

下面这些模块已经与目标模型直接冲突，不应再被视为“可延用基础设施”。

### 4.1 Schema 冲突面

1. [../control-plane/service/src/db/schema.pg.ts](../control-plane/service/src/db/schema.pg.ts)
说明：当前仍定义 `task_runs`、`task_run_nodes`、`conversation_sessions`、`task_domain_events`，且 `tasks` 仍保留旧执行态字段。

### 4.2 写路径冲突面

1. [../control-plane/service/src/modules/tasks/task-route-builder-shared.ts](../control-plane/service/src/modules/tasks/task-route-builder-shared.ts)
说明：当前 route builder 仍以 aggregate sync、conversation sync、run sync、domain projector 拼装整条写链。

2. [../control-plane/service/src/modules/tasks/task-conversation-session-sync.ts](../control-plane/service/src/modules/tasks/task-conversation-session-sync.ts)
说明：旧 session 写面，直接冲突于新 `task_sessions`。

3. [../control-plane/service/src/modules/tasks/task-run-write-sync.ts](../control-plane/service/src/modules/tasks/task-run-write-sync.ts)
说明：旧 run / run node 写面，必须删除。

4. [../control-plane/service/src/modules/tasks/task-conversation-message-sync.ts](../control-plane/service/src/modules/tasks/task-conversation-message-sync.ts)
说明：消息写链需要改写到新消息表，旧命名和旧归属关系不能保留。

### 4.3 读模型冲突面

1. [../control-plane/service/src/modules/tasks/task-domain-projector.ts](../control-plane/service/src/modules/tasks/task-domain-projector.ts)
说明：当前 projection 直接依赖 `task_domain_events`、`task_run_nodes`、旧 timeline item 语义。

2. [../control-plane/service/src/modules/tasks/task-projection-read.ts](../control-plane/service/src/modules/tasks/task-projection-read.ts)
说明：当前 timeline read 还依赖 branch compat 读链和旧 session id 拼装。

3. [../control-plane/service/src/modules/tasks/task-branch-compat-read.ts](../control-plane/service/src/modules/tasks/task-branch-compat-read.ts)
说明：这是 compat 读链，不是新模型的一部分。

### 4.4 Route 冲突面

1. [../control-plane/service/src/modules/tasks/task-branch-routes.ts](../control-plane/service/src/modules/tasks/task-branch-routes.ts)
说明：`/branches*` 必删。

2. [../control-plane/service/src/modules/tasks/task-domain-run-routes.ts](../control-plane/service/src/modules/tasks/task-domain-run-routes.ts)
说明：`/domain-runs*` 必删。

### 4.5 BFF / 前端冲突面

1. [../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts)
说明：compat shim，必删。

2. [../control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue)
说明：当前仍直接依赖 `getTaskDomainRuns()` / `getTaskDomainRunDetail()`。

3. [../control-plane/web-ui/src/composables/useTreeMessages.ts](../control-plane/web-ui/src/composables/useTreeMessages.ts)
说明：execution trace 主链切换后需要一并改写。

4. [../control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts)
说明：前端 helper 中仍暴露旧 routes 与旧 payload 类型。

## 5. 工作流划分

为了控制实现复杂度，重写仍分工作流推进，但每个工作流都采用硬切删除。

1. WS1：schema 与 migration
2. WS2：事实写入
3. WS3：projection 与执行追踪
4. WS4：service public contract
5. WS5：BFF 与 web-ui
6. WS6：workflow bridge、artifacts、usage ledger
7. WS7：残余 legacy 清理

## 6. 分阶段细化计划

### 6.1 Phase 0：冻结实现决策

这一阶段不做大规模代码迁移，只做“后面不再反复讨论”的固定决策。

#### Phase 0 必须输出

1. sessions contract 草案
2. adopt contract 草案
3. tree bridge 决策
4. workflow bridge 决策
5. 首批 artifacts / ledger 范围
6. 旧实现删除清单
7. Phase 0 产品清单文档：明确 single / parallel / sequential-chain 三种模式都保留，且任务主交互只保留执行、终止、继续三种公共操作
8. 模型交互可见性清单：明确用户原始输入、系统合成上下文、最终发送文本、流式回复都属于必须保留能力

#### Phase 0 具体任务

1. 在本文确认 `coordination_key + winner_session_id` 是唯一并行采纳对外表达
2. 在本文确认 `project_tree_nodes` 只做导航，不再承担 fallback
3. 在本文确认 `/branches*`、`/domain-runs*` 直接删除，不做代理
4. 在本文确认 `task-session-compat` 不保留
5. 在本文确认 `strategy_json` 不再承担 workflow template / stage 的主读面

#### Phase 0 完成标准

1. 执行口径不再出现“兼容”“alias”“fallback”“双写”
2. 后续开发无需再为旧 contract 做保护

### 6.2 Phase 1：Schema 硬切

这一阶段就是数据库层和类型层的硬切入口。

#### Phase 1 直接改动范围

1. [../control-plane/service/src/db/schema.pg.ts](../control-plane/service/src/db/schema.pg.ts)
2. `control-plane/service/drizzle-pg/*.sql`
3. 任何引用旧表导出的 TS 类型与 helper

#### Phase 1 必做动作

1. 新增 `task_sessions`
2. 新增 `task_session_messages`
3. 新增 `task_session_message_parts`
4. 新增 `task_operations`
5. 新增 `task_artifacts`
6. 新增 `task_usage_ledger_entries`
7. 重构 `tasks`
8. 重构 `task_snapshots`
9. 重构 `task_timeline_views`
10. 删除 `task_runs`
11. 删除 `task_run_nodes`
12. 删除 `task_run_edges`
13. 删除 `conversation_sessions`
14. 删除 `conversation_messages`
15. 删除 `conversation_message_parts`
16. 删除 `task_domain_events`
17. 删除 `tasks.current_run_id`、`tasks.current_session_id`、`tasks.started_at`、`tasks.finished_at` 这类旧执行态列

#### Phase 1 编码策略

1. 先删旧 schema 导出
2. 再加新 schema
3. 接受中途大量 import 报错
4. 报错留给下一阶段成批修复，不为了“先能编译”把旧导出留着

#### Phase 1 完成标准

1. schema 文件中已经看不到旧事实表定义
2. migration 能创建新表结构
3. 所有后续 compile error 都是“还没改调用方”，而不是“schema 仍未切”

### 6.3 Phase 2：事实写链硬切

这一阶段负责替换所有任务域事实写入口。

#### Phase 2 直接删除

1. [../control-plane/service/src/modules/tasks/task-conversation-session-sync.ts](../control-plane/service/src/modules/tasks/task-conversation-session-sync.ts)
2. [../control-plane/service/src/modules/tasks/task-run-write-sync.ts](../control-plane/service/src/modules/tasks/task-run-write-sync.ts)
3. 旧消息写链里依赖 `conversation_messages` 的部分

#### Phase 2 新建或重写的能力

1. task session write API
2. task session message write API
3. session operation write API
4. task artifact write API
5. task usage ledger write API

#### Phase 2 具体要求

1. execute / continue / fork / resume 全部直接写 `task_sessions`
2. 并行候选、judge、sequential-step 全部直接建 session 事实，不再落 run node
3. 用户输入、模型回复、tool call、tool result 统一落新消息表
4. executor / judge / hook / resume 的低层调用统一落 `task_operations`
5. changes summary、judge scorecard、hook report 一旦形成正式输出，直接写 `task_artifacts`
6. usage / cost 直接写 `task_usage_ledger_entries`

#### Phase 2 route builder 处理规则

1. 重写 [../control-plane/service/src/modules/tasks/task-route-builder-shared.ts](../control-plane/service/src/modules/tasks/task-route-builder-shared.ts)
2. 删除 `appendTaskDomainEvent` 作为写链中心的角色
3. 删除 `createTaskRunWriteSyncApi(...)`
4. 删除 `createTaskConversationSessionSyncApi(...)`
5. 删除任何“先写旧表再投影到新面”的中转逻辑

#### Phase 2 完成标准

1. 任务域再无对旧事实表的写入
2. 任一运行时事实都能在新表中找到唯一落点

### 6.4 Phase 3：Projection 与 execution trace 重写

这一阶段只做一件事：让读模型彻底摆脱旧事实源。

#### Phase 3 直接删除

1. [../control-plane/service/src/modules/tasks/task-domain-projector.ts](../control-plane/service/src/modules/tasks/task-domain-projector.ts)
2. [../control-plane/service/src/modules/tasks/task-branch-compat-read.ts](../control-plane/service/src/modules/tasks/task-branch-compat-read.ts)
3. 所有基于 `task_domain_events` 的 timeline 生成逻辑

#### Phase 3 重写目标

1. `task_snapshots` 仅从 `tasks` + `task_sessions` + `task_operations` 聚合
2. `task_timeline_views` 仅从 `tasks` + `task_sessions` + messages + operations + artifacts 聚合
3. execution trace 只读新 projection 和新 session facts
4. 不保留 run / event fallback

#### Phase 3 重点改动文件

1. [../control-plane/service/src/modules/tasks/task-projection-read.ts](../control-plane/service/src/modules/tasks/task-projection-read.ts)
2. 任务域 projector 相关新文件
3. execution trace 构建相关 route / service

#### Phase 3 完成标准

1. execution trace 的 `readSource` 不再出现 `task-domain-events`
2. timeline 构建不再依赖 compat lineage 读链
3. snapshot / timeline rebuild 可以直接从新事实表重算

### 6.5 Phase 4：Service public contract 硬切

这一阶段的目标不是“先保留旧 route 再跳转”，而是直接换掉对外面。

#### Phase 4 直接删除

1. [../control-plane/service/src/modules/tasks/task-branch-routes.ts](../control-plane/service/src/modules/tasks/task-branch-routes.ts)
2. [../control-plane/service/src/modules/tasks/task-domain-run-routes.ts](../control-plane/service/src/modules/tasks/task-domain-run-routes.ts)

#### Phase 4 新增 / 重写

1. sessions routes
2. session detail routes
3. messages routes
4. timeline routes
5. operations routes
6. artifacts routes
7. usage ledger routes
8. adopt winner route
9. execution-trace route

#### Phase 4 处理规则

1. 不保留 `/branches*`
2. 不保留 `/domain-runs*`
3. 不保留 runtimeSessionId-only 的 public contract
4. public route 全量改名可接受，不要求兼容旧前端

#### Phase 4 完成标准

1. service 层已无旧任务域 public route
2. 新 contract 足够支撑 BFF 重写

### 6.6 Phase 5：BFF 与前端硬切

service contract 切掉之后，BFF 和前端同步跟进，不做中间兼容层。

#### Phase 5 直接删除

1. [../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-compat.ts)
2. [../control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts) 中的 `getTaskDomainRuns()`
3. [../control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts) 中的 `getTaskDomainRunDetail()`
4. [../control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts) 中任何继续暴露 `/branches*` / `/domain-runs*` 的 helper

#### Phase 5 重点重写

1. [../control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue)
2. [../control-plane/web-ui/src/composables/useTreeMessages.ts](../control-plane/web-ui/src/composables/useTreeMessages.ts)
3. BFF task routes 中 execution trace、session list、candidate adoption 拼装逻辑

#### Phase 5 具体要求

1. 并行候选块只从 session tree + coordination group + winner metadata 渲染
2. judge 结果只从 `task_operations` / `task_artifacts` 读取
3. candidate adoption 只接受新的 adopt winner contract
4. runtime permission 与 trace panel 统一对齐新的 session id 体系
5. 前端类型名可整体重命名，不保留 legacy 术语

#### Phase 5 完成标准

1. `TaskDetailV3` 不再请求 `/domain-runs*`
2. BFF 不再 import compat shim
3. 前端 API helper 中旧 routes 已不存在

### 6.7 Phase 6：workflow bridge 收口

这一阶段只做 task / session 与 workflow 规则域的桥接收口，不再回头补兼容。

#### Phase 6 必做动作

1. 把 workflow bridge 字段从策略 JSON 提升到 `tasks` 列
2. 删除读取 `selectedTemplateId` / `workflowTemplateId` / `currentStageKey` fallback 的逻辑
3. 为模板重绑增加专用治理动作
4. 规范 `task_operations.summary_json` 的 hook / judge 结构

#### Phase 6 冲突处理规则

1. 旧 workflow runtime 表若阻碍新 bridge 读源，直接绕开
2. 旧 operating runtime 中继续读 strategy fallback 的代码直接改掉
3. 不为“老任务还没补字段”留读取兜底

### 6.8 Phase 7：残余 legacy 扫尾

这一阶段只做最后一轮 grep 清零与清场。

#### Phase 7 必删对象

1. 旧 schema 引用
2. 旧 route 引用
3. 旧 BFF compat 引用
4. 旧 UI helper / type 引用
5. 旧 fixture 与测试里的 legacy 概念

#### Phase 7 结束标准

1. 仓库生产代码对 `taskRuns`、`taskRunNodes`、`taskRunEdges`、`taskDomainEvents`、`conversationSessions` 的引用归零
2. `branches*`、`domain-runs*`、`task-session-compat` 相关生产代码归零
3. 文档与代码实现一致

## 7. 首批可直接编码的任务细化

下面这组任务可以直接开始写代码，不需要再做方案讨论。

### 7.1 Batch A：schema 入口先砍旧面

1. 在 [../control-plane/service/src/db/schema.pg.ts](../control-plane/service/src/db/schema.pg.ts) 删除旧事实表导出
2. 同文件新增新表定义与新 enum
3. 删除 `tasks` 上旧执行态列导出
4. 新建对应 Drizzle migration
5. 接受所有由此产生的 import / type error，不回补旧导出

预期结果：

1. 仓库会出现一批 import 报错
2. 这些报错是预期结果，不回滚、不补 alias

### 7.2 Batch B：写链入口砍旧模块

1. 从 route builder 删除旧 sync API 装配
2. 删除 `task-run-write-sync.ts`
3. 删除 `task-conversation-session-sync.ts`
4. 删除旧消息写链里依赖 `conversation_messages` 的任务域入口
5. 新建 task session / message / operation / artifact / ledger 写 API 骨架

预期结果：

1. execute / continue / fork 相关调用会暂时报错
2. 下一批直接按新事实写链补回，不恢复旧模块

### 7.3 Batch C：route 面直接切断旧 contract

1. 删除 `/branches*` routes
2. 删除 `/domain-runs*` routes
3. 新增 `/sessions*` routes skeleton
4. 新增 adopt winner route skeleton
5. 重写 execution-trace route skeleton

预期结果：

1. BFF / web-ui 旧请求会立即失效
2. 这是预期结果，不做代理跳转

### 7.4 Batch D：前端主页面切到新 contract

1. 删除 web-ui API helper 中旧 routes
2. 删除 `TaskDetailV3` 对 domain-runs 的依赖
3. 删除 BFF compat shim
4. 用新 sessions contract 重建候选块与 trace 读取

预期结果：

1. 页面中途可能完全不可用
2. 直到新 contract 接通前，不做临时回退

## 8. 验证矩阵

虽然允许阶段性不可运行，但最终收口仍必须有完整验证。

### 8.1 Schema 验证

1. 新表可创建
2. 外键可生效
3. 唯一索引可生效
4. candidate / judge / step 约束正确

### 8.2 Service 验证

1. single execute
2. parallel + judge
3. sequential-chain
4. manual branch
5. resume / hook
6. adopt winner

### 8.3 Projection 验证

1. snapshot 重建
2. timeline 重建
3. winner / judge 指针
4. candidate count
5. lineage completeness

### 8.4 UI 验证

1. `TaskDetailV3` single
2. `TaskDetailV3` parallel
3. `TaskDetailV3` sequential-chain
4. `TaskDetailV3` manual branch
5. candidate adopt

## 9. 一句话总结

这份执行计划的核心要求只有一句话：

1. 先按新模型重写
2. 凡与新模型冲突的旧实现立即删除
3. 中途不可运行可以接受
4. 直到最后一轮验证通过之前，不为旧实现做任何兼容性让步
