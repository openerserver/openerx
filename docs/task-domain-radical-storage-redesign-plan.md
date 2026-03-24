# 任务域激进存储重构方案

> 状态：主线已完成（2026-03-25；主体已落地，当前仅保留防回退维护、发布验证与可选优化）  
> 日期：2026-03-24  
> 作者：GitHub Copilot

## 1. 文档目的

这份文档不再作为“待启动的重构草案”，而是作为当前仓库任务域改造的状态说明与维护基线。

本文聚焦三件事：

1. 明确这轮 task domain radical redesign 已经完成了什么。
2. 明确当前哪些边界已经收口、哪些内容只属于后续维护或可选优化。
3. 给出可执行的验收清单，避免后续继续以旧的设计草案口吻维护这份文档。

相关背景文档：

- [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)
- [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md)
- [project-tree-storage-design.md](project-tree-storage-design.md)
- [architecture-target-evolution.md](architecture-target-evolution.md)
- [task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
- [task-thread-session-workbench-plan.md](task-thread-session-workbench-plan.md)
- [pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md)
- [task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)

## 2. 目标架构摘要

当前目标架构已经明确，不再是继续向 `project_tree_nodes.content_json` 堆叠任务业务快照，而是四层模型：

1. `tasks`：任务业务聚合根。
2. `task_runs` / `task_run_nodes` / `task_run_edges`：执行事实主源。
3. `conversation_sessions` / `conversation_messages` / `conversation_message_parts`：会话与消息事实主源。
4. `task_snapshots` / `task_timeline_views`：面向页面与接口的读取投影。

项目树的定位已经降级为结构和入口层：

1. `project_tree_nodes` 负责导航、层级和引用入口。
2. `project_tree_events` 不再承担消息 canonical storage；当前运行时已删表，相关内容只保留在历史 migration、历史设计文档和演进说明语境里。
3. `content_json` 只允许保留极少量 cache / 兼容字段，不再承担 task 业务事实主存储。

## 3. 已完成

以下事项已经完成或已经进入主路径，不再应被视为“当前主线工作”。

### 3.1 事实表与投影表已落地

1. `tasks`、`task_runs`、`task_run_nodes`、`task_run_edges` 已进入 PostgreSQL schema 与 migration 体系。
2. `conversation_sessions`、`conversation_messages`、`conversation_message_parts` 已进入 PostgreSQL schema 与 migration 体系。
3. `task_domain_events`、`task_snapshots`、`task_timeline_views` 已进入 PostgreSQL schema 与 migration 体系。
4. `agent_runs`、`runtime_usage_ledgers`、`runtime_usage_ledger_steps` 与新任务域表之间的桥接字段已经补齐。

### 3.2 写路径主体已切到 task domain 模型

1. 任务、运行、节点、边、会话、消息已经有对应的规范化落表路径。
2. task domain projector、projection replay、timeline projection 已经存在并可回放。
3. `executionPlan`、`parallelRunHistory` 已退出正式主写路径，不再是当前运行期主模型。

### 3.3 读路径主体已切到 projection-first

1. task snapshot 读取能力已经建立，并可作为任务主状态读取基础。
2. timeline view 读取能力已经建立，并可作为 timeline / trace 主投影基础。
3. service 侧已经提供 task projection 相关路由与读取能力。
4. projection-first trace 链路已经接入，rich trace 元信息已进入投影链路，包括 tool 参数摘要、file-reference、diff 等展示信息。

### 3.4 项目树职责已明显收缩

1. task 节点的 `content_json` 已经被大幅瘦身，task 写入时基本不再把业务事实写回树节点。
2. `project_tree_events` 已停止继续承担消息主写路径职责。
3. `project_tree_events` 中历史消息类事件已经退化为历史兼容数据和回放窗口，而非主事实来源。

### 3.5 前端与聚合接口已开始消费新模型

1. Dashboard、Projects、Task trace 已经开始消费 `task_snapshots` 和 `task_timeline_views`。
2. TaskDetailV3、trace、任务相关 BFF 聚合接口已能够读取 task domain projection，而不是只依赖树快照。
3. branch lineage 已有基于 `conversation_sessions` 的读链基础，不再完全依赖树结构推导。

## 4. 当前边界与后续维护

当前主线已经不是“重构主干未落地”，而是“兼容边界已收口，后续以防回退维护和可选优化为主”。

若需要直接执行代码收尾，优先按 [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md) 的文件级清单推进；本节保留的是状态判断和目标边界。

### 4.1 执行轨迹读链彻底收口

这是当前 execution trace 的最终边界说明，而不是新的主线待办。

评审与实现边界以 [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) 为单一引用来源；本节只保留任务域收尾视角，不再重复展开最终 contract。

目标状态：

1. execution trace 主路径稳定收敛到 `task_timeline_views` + `conversation_messages` + `conversation_message_parts`。
2. runtime messages fallback、snapshot fallback、`task.prompt` backfill 不再出现在正式主路径中。

当前状态与剩余点：

1. service timeline 已确认不再作为“覆盖 partial projection 的隐式 fallback”，而是收口为正式 secondary source：只有 projection timeline 为空或不可用时才补位；只要 projection 已经返回非空 timeline，即使 `cacheState=partial` 也保持显式 incomplete，不再切到 service timeline。
2. 这条 secondary source 目前仍有保留价值，因为 `branches/:runtimeSessionId/timeline` 实际读取的是 `conversation_messages` + conversation domain events 聚合，不是 projection 的别名；在 projection 未物化或暂时缺口时，它仍是比 runtime fallback 更稳定的持久化来源。
3. task/project 两条 BFF execution trace route 中残留的 `task.prompt` 用户输入注入已移除；当 projection 与 service timeline 都不可用时，当前会保留显式 incomplete 元信息并返回空 timeline，而不是再伪造 prompt segment。
4. 因此当前 execution trace 的边界不是继续推进 projection-only 读链，而是把 service timeline 固定在“projection empty/unavailable 才启用”的范围内，并保持前端显式 incomplete 语义。
5. branch/session compat 在 cached messages 读取上仍可能保留 runtime fallback，但该能力只服务于 session message compatibility contract，例如 lineage message 拼接、branch 预览与其他非公开 session consumer；它不属于 task/project 两条公开 execution trace route 的 contract。

### 4.2 `project_tree_nodes.content_json` 白名单基线

状态：`已完成当前主线收口（2026-03-25）；后续进入白名单防回退维护`

目标状态：

1. `content_json` 只保留树导航必要的 cache 字段。
2. task 业务字段不再通过树节点兜底参与主业务判断。

当前代码基线：

1. task node 的 `content_json` 运行时写面已经收缩为空对象；task 业务事实主链已不再从 task node payload 回退读取。
2. 当前仍存在的 tree payload 主要分成两类：一类是 session/branch compat node 的极少量 lineage 元数据；另一类是历史 migration / 历史导出 / 防回退测试里故意构造的旧 task payload。
3. 因此这一项剩余工作的重点，已经不是“继续让 task node 承载少量业务字段”，而是把允许保留的字段边界文档化、测试化，并持续阻断旧字段重新写回。

更硬的白名单草案：

| 字段组 | task node | session node | 仅历史 migration | 说明 |
| --- | --- | --- | --- | --- |
| task business facts：`prompt`、`status`、`sessionId`、`result`、`category`、`strategy`、`repoId`、`workspaceRoot`、`baseRevision`、`workingBranch`、`selectedModel`、`credentialId`、`agentRunId`、`userId` | 禁止 | 禁止 | 保留 | 这些字段现已由 `tasks`、`task_snapshots`、`task_runs` 等聚合/投影承担；若仍出现在树里，只能视为历史迁移产物，不得重新成为运行时读写面。 |
| execution/flow 字段：`executionMode`、`autoAdvanceStages`、`executionPlan`、`parallelRunHistory`、`startedAt`、`finishedAt` | 禁止 | 禁止 | 保留 | 这些字段已经退出 task node 运行时语义；主链应以 orchestration kind、domain run、snapshot 和显式 strategy/repair-only 语义为准。 |
| git/change 摘要：`changesSummary`、`gitAuthorName`、`gitAuthorEmail`、`gitCommitterName`、`gitCommitterEmail`、`finalCommitSha`、`finalBranchName` | 禁止 | 禁止 | 保留 | 当前结构化变更摘要与 git 元数据应走 task aggregate / projection；树节点不再承担这些业务事实镜像。 |
| branch compat lineage 元数据：`sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` | 禁止 | 允许 | 禁止 | 这是当前唯一仍允许保留在 `session` node `content_json` 中的运行时 payload，用于 branch/session lineage 兼容语义；它们不是 task 主状态字段。 |
| 其他候选字段 | 禁止，默认拒绝 | 禁止，默认拒绝 | 按历史语境单独说明 | 除非能证明该字段只承担树结构/lineage 元数据且无法由现有列或聚合替代，否则不应进入新的 whitelist。 |

补充边界：

1. `runtimeSessionId`、`branchName`、`contentText`、`refType`、`refId`、`isActive` 等应优先使用树节点独立列表达；它们不是 `content_json` whitelist 的一部分。
2. session node 当前允许保留的仅是 `sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` 这一组 branch compat lineage 元数据；不得顺手回填 task 执行状态、摘要、strategy 或 message snapshot。
3. 历史 migration 中曾写入 task node `content_json` 的旧字段，应继续只保留为演进说明、回填来源或防回退测试语境，不得被重新解释为现行 runtime contract。

测试矩阵（按上表逐项映射）：

| 字段组 | 已有护栏测试 | 还缺的 session node lineage-only whitelist 测试 |
| --- | --- | --- |
| task business facts：`prompt`、`status`、`sessionId`、`result`、`category`、`strategy`、`repoId`、`workspaceRoot`、`baseRevision`、`workingBranch`、`selectedModel`、`credentialId`、`agentRunId`、`userId` | `tests/service/project-tree-routes.test.ts` 已覆盖 task patch 后 task node `content_json = {}`、且不回写 `status`、`sessionId`、`selectedModel`、`workingBranch`、`result`；同文件现已补充 session node lineage-only whitelist 精确键集合护栏测试，覆盖 create / activate / archive 后不回写 `status`、`result`、`strategy`、`selectedModel`、`workingBranch` 等 task 字段；`tests/service/task-operating-runtime-tree.test.ts` 已覆盖运行态 strategy 不再镜像进 tree payload；`tests/web-ui/project-tree-task-composable.test.ts` 已覆盖即使 tree payload 带旧值，BFF 主读链仍以 task read model 为准。 | 当前未再缺少专门的 session node task-business-field 负向护栏；后续只需在新增 branch 写路径时复用同一精确键集合断言。 |
| execution/flow 字段：`executionMode`、`autoAdvanceStages`、`executionPlan`、`parallelRunHistory`、`startedAt`、`finishedAt` | `tests/service/project-tree-routes.test.ts` 已覆盖 task node 不回写 `executionMode`、`executionPlan`、`parallelRunHistory`，并覆盖 detail/list 在 tree payload stale 时仍以 aggregate 为准；同文件还覆盖旧 `strategy_json` 不会恢复 execution 字段，并新增 session node lineage-only whitelist 精确键集合护栏测试，锁定 branch create / activate / archive 后不会写回 execution/flow 字段；`tests/service/transform-export.test.ts` 已覆盖历史导出合成 task node 时不再镜像 `executionPlan`、`executionMode`、`autoAdvanceStages`。 | 当前未再缺少专门的 session node execution/flow 负向护栏；后续只需在新增 branch mutation 时保持同一断言。 |
| git/change 摘要：`changesSummary`、`gitAuthorName`、`gitAuthorEmail`、`gitCommitterName`、`gitCommitterEmail`、`finalCommitSha`、`finalBranchName` | `tests/service/project-tree-routes.test.ts` 已覆盖 task node 不回写 `gitCommitterName`、`gitCommitterEmail`，并新增 session node lineage-only whitelist 精确键集合护栏测试，锁定 branch compat 不会写回 `changesSummary`、git author / committer 或最终提交摘要；`tests/web-ui/project-tree-task-composable.test.ts` 已覆盖 tree payload 中旧 `changesSummary` 不会覆盖 BFF 读模型。 | 当前未再缺少专门的 session node git/change 负向护栏；后续只需保持精确键集合断言不被放宽。 |
| branch compat lineage 元数据：`sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` | `tests/service/task-conversation-session-sync.test.ts` 已覆盖 root / fork session 同步到 `conversation_sessions` 时保留 lineage 元数据；`tests/service/project-tree-routes.test.ts` 已覆盖 branch 创建、激活、归档与列表读取，并新增 session node lineage-only whitelist 精确键集合护栏测试，直接断言运行时 session node `content_json` 只允许 `sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` 这一组键；`tests/service/tree-task-aggregations.test.ts` 已覆盖 fork branch timeline / lineage 聚合使用 `parentRuntimeSessionId` 与 `forkedFromMessageId`。 | 当前未再缺少核心 session node lineage-only whitelist 护栏；后续仅需在出现新的 branch compat 字段诉求时先更新白名单表再补测试。 |
| 其他候选字段 | 当前已有护栏以 task node 的显式空 payload、主读不回退旧 payload、导出不再镜像旧字段，以及 session node 的精确键集合断言四类测试为主，足以阻断已知历史字段回流。 | 当前未再缺少默认拒绝型 session 测试；现有精确键集合断言已可作为未来新增字段的统一闸门。 |

后续维护重点：

1. 上述白名单已同步固化到 cleanup backlog、closure 文档和必要测试命名中，后续重点转为防止口径回退。
2. session node lineage-only whitelist 已补一轮精确键集合护栏测试；后续重点是新增 branch mutation / compat 写路径时继续复用该断言，防止 task 业务字段重新塞回 branch compat payload。
3. 继续保留一轮 session node lineage-only whitelist 三层闸门回归测试，确认没有新的 task 业务字段重新写回 task/session node `content_json`，且测试命名需直接暴露这一语义：
   1. storage 层：以 [tests/service/project-tree-storage.test.ts](../tests/service/project-tree-storage.test.ts) 锁定 session node create / update / archive 写面不会扩张 session node lineage-only whitelist payload。
   2. branch-write 层：以 [tests/service/task-branch-write.test.ts](../tests/service/task-branch-write.test.ts) 锁定 `upsertTaskBranch()`、`activateTaskBranch()`、`archiveTaskBranch()` 三条写路径对 storage / session sync 的参数集合不扩张，且 archive 路径不会回落到额外 payload 同步，从而保持 session node lineage-only whitelist 不被放宽。
   3. route 层：以 [tests/service/project-tree-routes.test.ts](../tests/service/project-tree-routes.test.ts) 锁定 create / activate / archive / legacy-lineage 场景下，实际落库后的 session node payload 仍然保持在 session node lineage-only whitelist 内。

### 4.3 `project_tree_events` 兼容边界退场

状态：已完成当前运行时收口

目标状态：

1. `project_tree_events` 只在历史 migration / 历史设计语境里被描述为树级事件、历史回放、审计窗口与测试清理副产物载体；不再对应当前运行时表。
2. 主路径不再依赖它承担消息 canonical storage、消息主读模型或主投影输入。

当前结果：

1. `project_tree_events` 已从当前 runtime schema 中移除，并补入独立 drop migration。
2. 前端 realtime store 的 project-level tree event backfill 已删除，当前不再保留 `/projects/:projectId/events` 这条 tree-event 增量读面的客户端消费。
3. branch compat 仍保留 `session.message.*` 的 synthetic eventType 命名，但这些事件现在来自 `conversation_messages` 与 conversation domain events 聚合，不再来自 `project_tree_events`。
4. 剩余 `project_tree_events` 相关内容只存在于历史 migration、历史设计文档和少量解释演进路径的旧测试语境，用于说明演进路径，而不是当前运行时能力。

### 4.4 主读模型唯一化验证

状态：已完成一轮显式验证，后续进入防回退维护

目标状态：

1. Task list、TaskDetailV3、trace、monitor、project overview 的主读模型都有清晰、唯一且可验证的说明。
2. 页面与 BFF 不再在主路径中混用 tree snapshot、runtime fallback 与 projection 数据源。

当前状态：

1. Task list 已有显式验证，确认页面首屏直接消费 `listTasks()` 返回，不会在主路径首屏再逐条补拉 task detail；对应测试见 `tests/web-ui/Tasks.test.ts`。
2. TaskDetailV3 已有显式验证，确认 tree 导航缺失时仍能依赖 task 主读链与 trace 主链渲染核心状态；对应测试见 `tests/web-ui/TaskDetailV3.test.ts` 与 `tests/web-ui/project-tree-task-composable.test.ts`。
3. monitor 已有显式验证，确认 branch/session 读取缺失时仍可依赖 `listTasks()` + `getTask()` 保持主卡片可读；对应测试见 `tests/web-ui/MultiTaskMonitor.test.ts`。
4. project overview 已补显式验证，确认页面首屏只读取 `getProject()`、付费执行预检与 project runtime ledger 聚合，不会在初始概览阶段下钻 ledger detail；对应测试见 `tests/web-ui/ProjectDetail.test.ts`。
5. Dashboard 已有显式验证，确认总览页只消费 dashboard / project 级聚合接口，不回退到 task detail、tree search 或 trace detail 读取；对应测试见 `tests/web-ui/Dashboard.test.ts`。
6. trace contract 的 task/project 两条公开路由已重跑显式回归，继续锁定 projection-first 与 restricted secondary source 边界；对应测试见 `tests/web-ui-bff/task-execution-trace-route.test.ts` 与 `tests/web-ui-bff/project-execution-trace-route.test.ts`。
7. task snapshot 路由已覆盖 list/detail 两条 task 主状态聚合入口，确认 BFF 会以 snapshot 合并结果覆盖旧 task 行；对应测试见 `tests/web-ui-bff/task-list-snapshot-route.test.ts`。
8. 这一项现在可以视为“主页面与公开 trace 接口已经完成一轮可追溯的主读模型唯一化验证”；后续重点不再是补一份新的总验证草案，而是保持这些测试继续阻断 tree payload、runtime fallback 与旧混合读链回流。

### 4.5 旧兼容语义与文档收尾

状态：`已完成当前范围收口（2026-03-25）；后续仅保留外围历史文档维护`

目标状态：

1. `executionPlan`、`parallelRunHistory`、tree message snapshot 等词汇只出现在历史兼容说明里。
2. 方案文档、清理文档、测试命名和注释都与当前实现状态一致。

当前基线：

1. service 侧已完成文件层拆分：branch compat 主实现已从 `task-session-read.ts` 迁入 `task-branch-compat-read.ts`，原文件收缩为纯 conversation/session utility façade，不再承载 branch compat 主实现。
2. tasks 模块与 project-tree storage 底层 `TaskSession*` helper 已完成一轮 `TaskBranchCompat*` 命名收口，branch compat 主链不再沿用旧 task-session 历史命名。
3. 当前 source 侧未再发现需要保留旧字段读写的 repair-only 分支；后续只需维护显式兼容测试，以及少量外围文档/注释里的历史命名同步。
4. “迁移草案”口吻已统一改成“已完成 + 维护基线”口吻。
5. 后续新开发默认以 task domain projection 为主链，不再回退到旧术语建模。

## 5. 验收清单

以下清单用于说明当前“主线已完成”的判据与后续维护基线。

### 5.1 读路径验收

1. Task list 主路径以 `task_snapshots` 为主，不再依赖 project tree task 大 JSON 拼装。
2. Task detail header 主路径以 `tasks` + `task_snapshots` + 最近一条 `task_runs` 为主。
3. Task execution trace 主路径以 `task_timeline_views` + `conversation_messages` + `conversation_message_parts` 为主。
4. Branch lineage 主路径以 `conversation_sessions.parent_session_id` 为主，项目树只作为跳转入口。
5. TaskDetailV3、trace、project overview、monitor 的主读链均有明确说明，且不存在“主路径必须 fallback 才能工作”的情况。

### 5.2 兼容层验收

1. `executionPlan`、`parallelRunHistory` 不再驱动正式业务判断。
2. `project_tree_events` 不再承担消息 canonical storage、消息主写路径或消息主投影输入职责。
3. `project_tree_nodes.content_json` 的运行时边界以 4.2 的“更硬的白名单草案”为准：task business facts、execution/flow 字段、git/change 摘要在 task node / session node 均为禁止；仅 `sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` 可作为 session node 的 lineage payload 保留；其余旧字段只允许存在于历史 migration 语境。
4. 4.2 的“测试矩阵”必须持续成立：task node 侧现有护栏测试继续阻断旧字段回流，session node 侧 lineage-only whitelist 精确键集合负向护栏测试与 branch-write 的 upsert / activate / archive 三路径闭环必须持续保持成立，不得再扩大 branch compat payload 范围。
5. runtime fallback、snapshot fallback、prompt backfill 若仍保留，必须被标注为兼容或 debug 语义，而不是主路径能力。

### 5.3 数据一致性验收

1. `tasks.status`、`task_snapshots.current_status`、当前 `task_runs.status` 一致。
2. `tasks.current_session_id`、`task_snapshots.current_session_id`、`conversation_sessions.runtime_session_id` 映射一致。
3. `task_runs.candidate_count`、`pipeline_step_count` 与 `task_run_nodes`、`task_snapshots` 聚合字段一致。
4. 当前会话 `conversation_messages` 数量与 `task_timeline_views` 中去重后的 `message_id` 数量一致。
5. `task_domain_events`、`conversation_*`、`task_run_nodes` 推导出的 timeline item 数与 `task_timeline_views` 实际数量一致。

### 5.4 巡检与闸门验收

状态：已落地

推荐命令：

1. `bun run db:audit:task-domain -- --project-id <projectId>`
2. `bun run db:audit:task-domain -- --task-id <taskId> --json`
3. `bun run db:audit:task-domain -- --project-id <projectId> --fail-on-mismatch`
4. `bun run check:task-domain-audit-gate`
5. `bun run db:cleanup:task-domain-audit-fixtures`

当前 gate 行为要求：

1. `bun run check:all` 在 lint 和 typecheck 之后执行 task domain audit gate。
2. PostgreSQL 方言下默认开启一致性闸门。
3. 本地若因历史 fixture 污染导致误报，应先执行清理脚本，再重跑 audit 和 gate。
4. 如需跳过本地非目标链路的 cleanup 闸门，必须显式设置环境变量关闭，而不是默认长期跳过。

## 6. 后续维护原则

从现在开始，这份文档的维护原则如下：

1. 不再把已落地能力写成“规划中”。
2. 新增内容优先写“维护基线”“可选优化”和“验收变化”，而不是重新展开整套迁移论证。
3. 若未来继续压缩兼容层，应同步更新本文第 4 节和第 5 节，而不是另起一份新的总方案草案。

一句话总结当前状态：任务域 radical redesign 的主线已经完成，execution trace、tree 白名单、历史 fallback 与主读链验证都已形成当前基线；后续仅保留防回退维护、发布验证与可选优化。
