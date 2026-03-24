# 任务域激进存储重构方案

> 状态：主体已实现，进入收尾阶段  
> 日期：2026-03-24  
> 作者：GitHub Copilot

## 1. 文档目的

这份文档不再作为“待启动的重构草案”，而是作为当前仓库任务域改造的状态说明与收尾计划。

本文聚焦三件事：

1. 明确这轮 task domain radical redesign 已经完成了什么。
2. 明确当前还剩哪些真正需要收口的工作。
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
2. `project_tree_events` 不再承担消息 canonical storage，只保留历史回放、审计窗口和兼容过渡职责。
3. `content_json` 只允许保留极少量 cache / 兼容字段，不再承担 task 业务事实主存储。

## 3. 已完成

以下事项已经完成或已经进入主路径，不再应被视为“待建设能力”。

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

## 4. 剩余工作

当前剩余工作已经不是“重构主干未落地”，而是“旧兼容层没有完全退场”。

若需要直接执行代码收尾，优先按 [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md) 的文件级清单推进；本节保留的是状态判断和目标边界。

### 4.1 执行轨迹读链彻底收口

这是当前最重要的剩余工作。

评审与实现边界以 [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) 为单一引用来源；本节只保留任务域收尾视角，不再重复展开最终 contract。

目标状态：

1. execution trace 主路径稳定收敛到 `task_timeline_views` + `conversation_messages` + `conversation_message_parts`。
2. runtime messages fallback、snapshot fallback、`task.prompt` backfill 不再出现在正式主路径中。

当前状态与剩余点：

1. service timeline 已确认不再作为“覆盖 partial projection 的隐式 fallback”，而是收口为正式 secondary source：只有 projection timeline 为空或不可用时才补位；只要 projection 已经返回非空 timeline，即使 `cacheState=partial` 也保持显式 incomplete，不再切到 service timeline。
2. 这条 secondary source 目前仍有保留价值，因为 `branches/:runtimeSessionId/timeline` 实际读取的是 `conversation_messages` + conversation domain events 聚合，不是 projection 的别名；在 projection 未物化或暂时缺口时，它仍是比 runtime fallback 更稳定的持久化来源。
3. 因此当前不建议继续推进 execution trace 的 projection-only 读链；更合理的收口是继续把 service timeline 固定在“projection empty/unavailable 才启用”的边界内，并保持前端显式 incomplete 语义。

### 4.2 `project_tree_nodes.content_json` 继续白名单化

状态：未完成

目标状态：

1. `content_json` 只保留树导航必要的 cache 字段。
2. task 业务字段不再通过树节点兜底参与主业务判断。

当前仍需处理的点：

1. `changesSummary` 仍有 node `content_json` 兼容兜底。
2. `executionMode`、`autoAdvanceStages`、git committer / author 等字段仍保留部分兼容读取语义。
3. 需要明确最终白名单，并补一轮代码搜索确认没有新的 task 业务字段重新写回树节点。

### 4.3 `project_tree_events` 兼容边界退场

状态：已完成当前运行时收口

目标状态：

1. `project_tree_events` 只保留树级事件、历史回放、审计窗口与测试清理副产物职责。
2. 主路径不再依赖它承担消息 canonical storage、消息主读模型或主投影输入。

当前结果：

1. `project_tree_events` 已从当前 runtime schema 中移除，并补入独立 drop migration。
2. 前端 realtime store 的 project-level tree event backfill 已删除，当前不再保留 `/projects/:projectId/events` 这条 tree-event 增量读面的客户端消费。
3. branch compat 仍保留 `session.message.*` 的 synthetic eventType 命名，但这些事件现在来自 `conversation_messages` 与 conversation domain events 聚合，不再来自 `project_tree_events`。
4. 剩余 `project_tree_events` 相关内容只存在于历史 migration、历史设计文档和少量解释演进路径的旧测试语境，用于说明演进路径，而不是当前运行时能力。

### 4.4 主读模型唯一化验证

状态：未完成

目标状态：

1. Task list、TaskDetailV3、trace、monitor、project overview 的主读模型都有清晰、唯一且可验证的说明。
2. 页面与 BFF 不再在主路径中混用 tree snapshot、runtime fallback 与 projection 数据源。

当前状态：

1. Task list、TaskDetailV3、monitor、project overview 已补一轮显式主读链回归测试，证明这些页面的核心业务状态不依赖 tree payload 兜底。
2. trace contract 的 task/project 两条公开路由也已重跑回归，继续锁定 projection-first 与 restricted secondary source 边界。
3. 这一项目前只能视为“已形成基础验收矩阵”，还不能视为已收口完成；剩余工作仍包括补齐剩余页面/兼容面的显式主读链验证，以及持续防止测试语义回退到旧混合读链。

### 4.5 旧兼容语义与文档收尾

状态：进行中（代码层收口已完成，外围文档与历史命名仍待补齐）

目标状态：

1. `executionPlan`、`parallelRunHistory`、tree message snapshot 等词汇只出现在历史兼容说明里。
2. 方案文档、清理文档、测试命名和注释都与当前实现状态一致。

当前仍需处理的点：

1. service 侧已完成文件层拆分：branch compat 主实现已从 `task-session-read.ts` 迁入 `task-branch-compat-read.ts`，原文件收缩为纯 conversation/session utility façade，不再承载 branch compat 主实现。
2. tasks 模块与 project-tree storage 底层 `TaskSession*` helper 已完成一轮 `TaskBranchCompat*` 命名收口，branch compat 主链不再沿用旧 task-session 历史命名。
3. 剩余工作主要集中在 repair-only 分支、显式兼容测试和外围文档/注释里的历史命名同步。
4. 将“迁移草案”口吻统一改成“已完成 + 收尾项”口吻。
5. 后续新开发默认以 task domain projection 为主链，不再回退到旧术语建模。

## 5. 验收清单

以下清单用于判断本方案是否可以从“主体已实现，待收尾清理”推进到“基本完成”。

### 5.1 读路径验收

1. Task list 主路径以 `task_snapshots` 为主，不再依赖 project tree task 大 JSON 拼装。
2. Task detail header 主路径以 `tasks` + `task_snapshots` + 最近一条 `task_runs` 为主。
3. Task execution trace 主路径以 `task_timeline_views` + `conversation_messages` + `conversation_message_parts` 为主。
4. Branch lineage 主路径以 `conversation_sessions.parent_session_id` 为主，项目树只作为跳转入口。
5. TaskDetailV3、trace、project overview、monitor 的主读链均有明确说明，且不存在“主路径必须 fallback 才能工作”的情况。

### 5.2 兼容层验收

1. `executionPlan`、`parallelRunHistory` 不再驱动正式业务判断。
2. `project_tree_events` 不再承担消息 canonical storage、消息主写路径或消息主投影输入职责。
3. `project_tree_nodes.content_json` 不再承载 task 业务事实主存储。
4. `changesSummary`、`executionMode`、`autoAdvanceStages`、git committer / author 等剩余兼容字段已经进入明确白名单，且不再无边界扩散。
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
2. 新增内容优先写“剩余工作”和“验收变化”，而不是重新展开整套迁移论证。
3. 若未来继续压缩兼容层，应同步更新本文第 4 节和第 5 节，而不是另起一份新的总方案草案。

一句话总结当前状态：任务域 radical redesign 的主体已经完成，当前真正剩余的是 execution trace 读链收口、tree 兼容字段瘦身、历史 fallback 清理，以及主读链的最终验收。
