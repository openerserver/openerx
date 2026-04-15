# 任务域收尾可执行 Backlog

> 状态：主线已完成（2026-03-25；A/B/C/D/E/F1 已完成，后续仅保留防回退维护与可选优化）  
> 日期：2026-03-24  
> 作者：GitHub Copilot

## 1. 文档目的

本文把当前 task-domain 未收尾项压成按文件执行的 backlog，避免后续继续从方案文档、评审记录和代码搜索结果里手工拼任务。

配套文档：

1. [execution-trace-read-boundary-adr.md](../architecture/execution-trace-read-boundary-adr.md)
2. [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
3. [task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)

## 2. 执行原则

1. 只把真正还存在于运行时代码里的兼容面列入本 backlog；纯历史结论不再重复。
2. 每个任务包都按“要改的文件”“代码动作”“验证方式”组织，执行时应直接对照文件落改。
3. `execution trace` 的公开边界已经由 ADR 锁定；本 backlog 不再讨论是否恢复 task/project public trace 的 runtime fallback。若仍保留 cached messages 的 runtime fallback，只能按 session message compatibility contract 理解，用于 lineage message 拼接、branch 预览与其他非公开 session consumer。
4. 本 backlog 的目标是收口旧兼容层，不是重做 schema，也不是新增新的主读模型。

## 3. 总体判断

当前代码状态可以分成三类：

1. 已基本完成：projection-first trace、service timeline restricted secondary source、audit gate 接线。
2. 本轮主线收尾已完成：tree payload 白名单边界、branch compat 显式兼容测试语义与文档口径都已有可追溯结果；当前未再发现需要保留旧字段读写的 repair-only source 分支。
3. 主读模型唯一化验证已完成一轮闭环：task list、TaskDetailV3、monitor、project overview、Dashboard 与 task/project trace 都已有显式验证；后续重点转为防回退维护。

## 4. 任务包 A

### A1. TaskDetailV3 主读链从 tree payload 解耦

状态：`已完成（2026-03-24）`

优先级：`P0`

目标：

1. TaskDetailV3 的业务字段以 BFF `getTask()` 返回为主。
2. project tree 只保留 breadcrumb、links、branch 入口等结构导航语义。
3. 不再把 `content_json` 展平结果重新 merge 回 task facade。

涉及文件：

1. [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../../control-plane/web-ui/src/composables/useProjectTreeTask.ts)
2. [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue)
3. [tests/web-ui/TaskDetailV3.test.ts](../../tests/web-ui/TaskDetailV3.test.ts)
4. tests/web-ui-bff/project-tree-task-composable.test.ts

当前结果：

1. [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../../control-plane/web-ui/src/composables/useProjectTreeTask.ts) 已停止让 tree payload 覆盖 BFF task 主字段，task 业务数据与 tree 导航数据的职责边界已经分开。
2. [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue) 已不再把 tree-derived `executionMode`、`autoAdvanceStages`、`changesSummary` 当作 task 主状态来源。
3. TaskDetailV3 当前只把 tree 信息用于 `nodeId`、ancestor breadcrumb、links panel、branch 入口等结构导航语义，不再把这些字段当作 task 主读模型。
4. 如仍保留 `flattenTreeNodeToTask(...)` 一类 helper，也只应按 compat/test 语义理解，而不是当前主页面的 task facade 主来源。

验收结论：

1. TaskDetailV3 在 tree node 请求失败时，仍可依赖 BFF task + trace 正常展示主业务状态。
2. `useProjectTreeTask` 不再把 tree payload 作为 task 业务字段兜底。
3. [tests/web-ui/TaskDetailV3.test.ts](../../tests/web-ui/TaskDetailV3.test.ts) 与 tests/web-ui-bff/project-tree-task-composable.test.ts 已显式覆盖“tree 可选、task 主读链仍成立”的场景。

### A2. TaskDetailV3 主读链验证补齐

状态：`已完成（2026-03-24）`

优先级：`P0`

涉及文件：

1. [tests/web-ui/TaskDetailV3.test.ts](../../tests/web-ui/TaskDetailV3.test.ts)

当前结果：

1. 已增加 tree node 缺失或 ancestors 拉取失败时，TaskDetailV3 仍依赖 `getTask()` 与 `getTaskExecutionTraceView()` 正常渲染的 case。
2. 已增加断言，证明主 header、执行模式、候选状态、trace warning 不需要 tree payload 才能成立。
3. breadcrumb / links 等 tree 结构信息当前已被明确标记为可降级区域，而不是 task 主状态兜底来源。

验收结论：

1. 测试里能区分“主业务数据”和“树导航数据”的失败影响面。
2. 不再出现“tree API 失败导致 task 主状态整体不可用”的断言空白。

## 5. 任务包 B

### B1. `project_tree_nodes.content_json` 白名单收口

状态：`已完成（2026-03-25）`

优先级：`P0`

目标：

1. 彻底枚举仍在读取 tree payload 业务字段的代码点。
2. 将这些字段拆成“继续保留的有限兼容字段”和“应删除的旧兜底”。

白名单草案（与总方案/closure 文档保持一致）：

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

测试矩阵（与总方案同步）：

| 字段组 | 已有护栏测试 | 还缺的 session node lineage-only whitelist 测试 |
| --- | --- | --- |
| task business facts：`prompt`、`status`、`sessionId`、`result`、`category`、`strategy`、`repoId`、`workspaceRoot`、`baseRevision`、`workingBranch`、`selectedModel`、`credentialId`、`agentRunId`、`userId` | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 task patch 后 task node `content_json = {}`、且不回写 `status`、`sessionId`、`selectedModel`、`workingBranch`、`result`；同文件现已补充 session node lineage-only whitelist 精确键集合护栏测试，覆盖 create / activate / archive 后不回写 `status`、`result`、`strategy`、`selectedModel`、`workingBranch` 等 task 字段；[tests/service/task-operating-runtime-tree.test.ts](../../tests/service/task-operating-runtime-tree.test.ts) 已覆盖运行态 strategy 不再镜像进 tree payload；[tests/web-ui/project-tree-task-composable.test.ts](../../tests/web-ui/project-tree-task-composable.test.ts) 已覆盖即使 tree payload 带旧值，BFF 主读链仍以 task read model 为准。 | 当前未再缺少专门的 session node task-business-field 负向护栏；后续只需在新增 branch 写路径时复用同一精确键集合断言。 |
| execution/flow 字段：`executionMode`、`autoAdvanceStages`、`executionPlan`、`parallelRunHistory`、`startedAt`、`finishedAt` | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 task node 不回写 `executionMode`、`executionPlan`、`parallelRunHistory`，并覆盖 detail/list 在 tree payload stale 时仍以 aggregate 为准；同文件还覆盖旧 `strategy_json` 不会恢复 execution 字段，并新增 session node lineage-only whitelist 精确键集合护栏测试，锁定 branch create / activate / archive 后不会写回 execution/flow 字段；[tests/service/transform-export.test.ts](../../tests/service/transform-export.test.ts) 已覆盖历史导出合成 task node 时不再镜像 `executionPlan`、`executionMode`、`autoAdvanceStages`。 | 当前未再缺少专门的 session node execution/flow 负向护栏；后续只需在新增 branch mutation 时保持同一断言。 |
| git/change 摘要：`changesSummary`、`gitAuthorName`、`gitAuthorEmail`、`gitCommitterName`、`gitCommitterEmail`、`finalCommitSha`、`finalBranchName` | [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 task node 不回写 `gitCommitterName`、`gitCommitterEmail`，并新增 session node lineage-only whitelist 精确键集合护栏测试，锁定 branch compat 不会写回 `changesSummary`、git author / committer 或最终提交摘要；[tests/web-ui/project-tree-task-composable.test.ts](../../tests/web-ui/project-tree-task-composable.test.ts) 已覆盖 tree payload 中旧 `changesSummary` 不会覆盖 BFF 读模型。 | 当前未再缺少专门的 session node git/change 负向护栏；后续只需保持精确键集合断言不被放宽。 |
| branch compat lineage 元数据：`sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` | [tests/service/task-conversation-session-sync.test.ts](../../tests/service/task-conversation-session-sync.test.ts) 已覆盖 root / fork session 同步到 `conversation_sessions` 时保留 lineage 元数据；[tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 已覆盖 branch 创建、激活、归档与列表读取，并新增 session node lineage-only whitelist 精确键集合护栏测试，直接断言运行时 session node `content_json` 只允许 `sourceType`、`parentRuntimeSessionId`、`forkedFromMessageId` 这一组键；[tests/service/tree-task-aggregations.test.ts](../../tests/service/tree-task-aggregations.test.ts) 已覆盖 fork branch timeline / lineage 聚合使用 `parentRuntimeSessionId` 与 `forkedFromMessageId`。 | 当前未再缺少核心 session node lineage-only whitelist 护栏；后续仅需在出现新的 branch compat 字段诉求时先更新白名单表再补测试。 |
| 其他候选字段 | 当前已有护栏以 task node 的显式空 payload、主读不回退旧 payload、导出不再镜像旧字段，以及 session node 的精确键集合断言四类测试为主，足以阻断已知历史字段回流。 | 当前未再缺少默认拒绝型 session 测试；现有精确键集合断言已可作为未来新增字段的统一闸门。 |

涉及文件：

1. [control-plane/service/src/modules/project-tree/task-view.ts](../../control-plane/service/src/modules/project-tree/task-view.ts)
2. [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../../control-plane/web-ui/src/composables/useProjectTreeTask.ts)
3. [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts)
4. tests/web-ui-bff/project-tree-task-composable.test.ts

代码动作：

1. 在 [control-plane/service/src/modules/project-tree/task-view.ts](../../control-plane/service/src/modules/project-tree/task-view.ts) 清理 `readNodeChangesSummary(...)` 对 `node.contentJson.changesSummary` 的业务兜底，改成只在明确允许的 compat 场景读取。
2. 在 [control-plane/service/src/modules/project-tree/task-view.ts](../../control-plane/service/src/modules/project-tree/task-view.ts) 清理 `normalizeTaskExecutionModeFromStrategy(...)`、`resolveAutoAdvanceStagesFromStrategy(...)` 这类把 strategy/tree payload 继续翻译成 task 主状态的兼容逻辑，改为 snapshot/run 聚合优先，compat 分支显式隔离。
3. 在 [control-plane/service/src/modules/project-tree/task-view.ts](../../control-plane/service/src/modules/project-tree/task-view.ts) 明确保留字段清单，例如 breadcrumb 必要字段、repo label、credential label 等展示性元数据；不再默认接受 task 业务事实继续从 tree payload 回流。
4. 同步调整 [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../../control-plane/web-ui/src/composables/useProjectTreeTask.ts)，避免前端继续消费这些旧兼容字段。

完成标准：

1. `changesSummary`、`executionMode`、`autoAdvanceStages` 不再无边界地从 `content_json` 回流到 task 主视图。
2. 上述三栏白名单表被视为当前唯一有效的 tree payload 边界说明；后续新增字段若未显式补入，不得默认进入 whitelist。
3. 上述测试矩阵已补齐一轮 session node lineage-only whitelist 精确键集合护栏；后续 branch mutation / compat 写路径必须复用同一精确键集合断言。
4. 对应测试要么删除旧断言，要么改成“compat only”语义。
5. 继续保留一轮 session node lineage-only whitelist 三层闸门回归测试，且测试命名需直接暴露这一语义：
   1. storage 层：以 [tests/service/project-tree-storage.test.ts](../../tests/service/project-tree-storage.test.ts) 锁定 session node create / update / archive 写面不会扩张 session node lineage-only whitelist payload。
   2. branch-write 层：以 [tests/service/task-branch-write.test.ts](../../tests/service/task-branch-write.test.ts) 锁定 `upsertTaskBranch()`、`activateTaskBranch()`、`archiveTaskBranch()` 三条写路径对 storage / session sync 的参数集合不扩张，且 archive 路径不会回落到额外 payload 同步，从而保持 session node lineage-only whitelist 不被放宽。
   3. route 层：以 [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 锁定 create / activate / archive / legacy-lineage 场景下，实际落库后的 session node payload 仍然保持在 session node lineage-only whitelist 内。
6. 若后续需要新增 branch compat 字段，必须先同步更新白名单表、测试矩阵与 [tests/service/task-route-test-helpers.ts](../../tests/service/task-route-test-helpers.ts) 中的 `assertSessionNodeLineageOnlyContentJson(...)` 共享 helper，再允许实现进入写路径。
7. 三层闸门相关测试命名必须直接暴露“session node lineage-only whitelist”语义；不得再使用会让人误解为一般 branch 写面或泛化 `content_json` 行为的标题。

### B2. Tree payload 白名单测试重写

状态：`已完成（2026-03-25）`

优先级：`P1`

涉及文件：

1. tests/web-ui-bff/project-tree-task-composable.test.ts
2. [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts)

代码动作：

1. 将 tests/web-ui-bff/project-tree-task-composable.test.ts 从“展平 tree task”改成“白名单字段不会扩散”的防回归测试。
2. 将 [tests/service/project-tree-routes.test.ts](../../tests/service/project-tree-routes.test.ts) 里仍依赖 task payload 展平语义的断言改成兼容边界断言。

完成标准：

1. 测试名和断言都不再暗示 tree payload 是 task 主读模型。
2. 白名单字段的保留原因可从测试名直接看出来。
3. 与 storage / branch-write / route 三层闸门对应的 case，命名中应优先出现 `lineage-only whitelist`、`branch compat whitelist` 或等价措辞，而不是只写宽泛的 `content_json` / `branch`。

## 6. 任务包 C

### C1. 历史 branch message/timeline 接口压缩为显式兼容面

优先级：`P1`

当前状态：已完成本轮代码收口；本节保留为验收与后续文档同步基线。

目标：

1. `/branches/:runtimeSessionId/messages`、`/events`、`/timeline` 不再被误读为当前 task 主读接口。
2. 这些接口的职责收口为 lineage/history/debug compat，而不是页面主路径依赖。

涉及文件：

1. control-plane/service/src/modules/tasks/task-branch-routes.ts
2. control-plane/service/src/modules/tasks/task-route-branch-registrations.ts
3. control-plane/service/src/modules/tasks/task-branch-compat-read.ts
4. [control-plane/service/src/modules/tasks/task-session-read.ts](../../control-plane/service/src/modules/tasks/task-session-read.ts)
5. [tests/service/task-route-registrar.test.ts](../../tests/service/task-route-registrar.test.ts)

当前结果：

1. control-plane/service/src/modules/tasks/task-branch-routes.ts 已明确把 `messages/events/timeline` 这三条 runtime session route 收口为 compat routes，而不是 task mainline routes。
2. control-plane/service/src/modules/tasks/task-route-branch-registrations.ts 已将 compat route 注册与 task 主读 route 注册分层。
3. control-plane/service/src/modules/tasks/task-branch-compat-read.ts 已成为 branch compat `messages/events/timeline` 的独立实现面，并与 execution trace 公共 contract 分开。
4. [control-plane/service/src/modules/tasks/task-session-read.ts](../../control-plane/service/src/modules/tasks/task-session-read.ts) 已收缩为纯 conversation/session utility façade，不再承载 branch compat 主实现。
5. `session.message.created/updated/completed/snapshot` 一类历史 eventType 合成逻辑当前只应按 compat-only helper 理解，不再代表主 timeline 语义。

完成标准：

1. service 代码结构上能一眼看出“task execution trace public path”和“branch compat path”是两层东西。
2. route 注册测试不再把 branch timeline route 当作主读链的一部分。

### C2. Branch compat 路由测试收口

状态：`已完成（2026-03-25）`

优先级：`P1`

涉及文件：

1. [tests/service/task-route-registrar.test.ts](../../tests/service/task-route-registrar.test.ts)
2. [tests/service/task-route-registration-smoke.test.ts](../../tests/service/task-route-registration-smoke.test.ts)
3. [tests/service/task-operating-runtime-tree.test.ts](../../tests/service/task-operating-runtime-tree.test.ts)

代码动作：

1. 将 branch route 相关测试命名改为 compat / lineage / history 语义。
2. 删除仍然暗示这些路由是 task 主 trace 读取面的断言。
3. 保留必要的集成测试，但让其验证“兼容面仍可用”，而不是“主页面依赖它”。

完成标准：

1. branch 相关测试语义全部收口到 compat 面。
2. 不再用 branch route 测试间接证明 task public trace contract。

当前结果：

1. [tests/service/task-route-registrar.test.ts](../../tests/service/task-route-registrar.test.ts) 与相关注册 smoke coverage 已把 branch route 语义收口到 compat / lineage 面，不再把它们表述成 task 主 trace 入口。
2. [tests/service/task-route-registration-smoke.test.ts](../../tests/service/task-route-registration-smoke.test.ts) 已保留“兼容面仍可用”的集成验证，但不再借此证明 task public trace contract。
3. [tests/service/task-operating-runtime-tree.test.ts](../../tests/service/task-operating-runtime-tree.test.ts) 与相关 branch / lineage 测试当前都按 compat-only 语义理解；public trace contract 继续由 task/project 两条公开路由的专门测试承担。

## 7. 任务包 D

### D1. 页面主读链验证矩阵补齐

状态：`已完成一轮显式验证，后续进入防回退维护（2026-03-24）`

优先级：`P1`

目标：

1. 把“应该已经切到新模型”变成“有测试证明不会退回旧模型”。
2. 这一批以验证为主，代码修改应最小化。

涉及文件：

1. [tests/web-ui/Tasks.test.ts](../../tests/web-ui/Tasks.test.ts)
2. [tests/web-ui/Dashboard.test.ts](../../tests/web-ui/Dashboard.test.ts)
3. [tests/web-ui/MultiTaskMonitor.test.ts](../../tests/web-ui/MultiTaskMonitor.test.ts)
4. [tests/web-ui/ProjectDetail.test.ts](../../tests/web-ui/ProjectDetail.test.ts)
5. [tests/web-ui/TaskDetailV3.test.ts](../../tests/web-ui/TaskDetailV3.test.ts)

代码动作：

1. 为任务列表、监控页、项目概览补充断言，证明页面消费的是 BFF task/project 读模型，而不是 tree task snapshot 展平结果。
2. 若页面仍存在隐式 tree 依赖，则在对应页面源文件内补最小修正，并同步记录到本 backlog。
3. 若页面已经不依赖 tree，只补测试，不额外改实现。

完成标准：

1. 这几类页面都能给出“主读数据源是什么”的显式测试证据。
2. 不再出现“页面默认靠 tree fallback 兜底，但测试没覆盖”的空白区。

当前结果：

1. [tests/web-ui/Tasks.test.ts](../../tests/web-ui/Tasks.test.ts) 已补首屏直接消费 `listTasks()` 的断言，明确任务列表不会在初始渲染时逐条回填 `getTask()`。
2. [tests/web-ui/Dashboard.test.ts](../../tests/web-ui/Dashboard.test.ts) 已补“只消费 dashboard / project 级聚合接口，不触发 task detail、tree search 或 trace detail 读取”的断言。
3. [tests/web-ui/MultiTaskMonitor.test.ts](../../tests/web-ui/MultiTaskMonitor.test.ts) 已补“branch/session 读取缺失时仍能依赖 `listTasks()` + `getTask()` + `getTaskPipeline()` 保持主卡片可读”的断言。
4. [tests/web-ui/ProjectDetail.test.ts](../../tests/web-ui/ProjectDetail.test.ts) 已补“secondary overview cards 失败时，项目基础信息仍由 `getProject()` 驱动渲染”的断言。
5. [tests/web-ui/ProjectDetail.test.ts](../../tests/web-ui/ProjectDetail.test.ts) 已补“首屏 overview 不会下钻 runtime usage ledger detail，只消费 project 级 reader”的断言。
6. [tests/web-ui/TaskDetailV3.test.ts](../../tests/web-ui/TaskDetailV3.test.ts) 已补 tree 导航缺失时仍可依赖 task 主读链渲染的断言。
7. [tests/web-ui-bff/task-list-snapshot-route.test.ts](../../tests/web-ui-bff/task-list-snapshot-route.test.ts) 已补 list/detail 两条 snapshot 聚合入口的显式验证。
8. 当前这一批页面与 BFF 聚合入口已经形成一轮可追溯的主读模型验证矩阵；后续重点是防回退，而不是继续补新的总验证草案。

### D2. trace contract 回归矩阵继续保留

状态：`已完成（2026-03-24）`

优先级：`P1`

涉及文件：

1. [tests/web-ui-bff/task-execution-trace-route.test.ts](../../tests/web-ui-bff/task-execution-trace-route.test.ts)
2. [tests/web-ui-bff/project-execution-trace-route.test.ts](../../tests/web-ui-bff/project-execution-trace-route.test.ts)

代码动作：

1. 保持现有 projection-first / partial 保留 / secondary source 边界测试，不允许因清理 compat 层而回归。
2. 如果 branch compat 路由收口导致 helper 重构，同步更新这两份测试，保证 public trace contract 不变。

完成标准：

1. public trace contract 的测试仍以 task/project 两条公开路由为唯一主入口。
2. compat route 的存在与否不影响这两份测试的语义。

当前结果：

1. [tests/web-ui-bff/task-execution-trace-route.test.ts](../../tests/web-ui-bff/task-execution-trace-route.test.ts) 已重跑并覆盖 projection-first、partial 保留、secondary source 边界。
2. [tests/web-ui-bff/project-execution-trace-route.test.ts](../../tests/web-ui-bff/project-execution-trace-route.test.ts) 已重跑并覆盖相同 contract。
3. 当前 public trace contract 仍稳定锁在 task/project 两条公开路由，不依赖 branch compat route 证明主链语义。

## 8. 任务包 E

### E1. 一致性审计与 gate 输出固化

状态：`已完成（2026-03-24）`

优先级：`P1`

涉及文件：

1. [control-plane/service/src/db/migration/audit-task-domain-consistency.ts](../../control-plane/service/src/db/migration/audit-task-domain-consistency.ts)
2. [scripts/check-all.sh](../../scripts/check-all.sh)
3. [package.json](../../package.json)

代码动作：

1. 保持 [scripts/check-all.sh](../../scripts/check-all.sh) 中 lint -> typecheck -> task-domain audit gate 的顺序不回退。
2. 如审计脚本当前还缺稳定 artifact 输出，则在 [control-plane/service/src/db/migration/audit-task-domain-consistency.ts](../../control-plane/service/src/db/migration/audit-task-domain-consistency.ts) 增加明确的 machine-readable 输出模式，方便作为 cleanup 准入证据留档。
3. 若命令入口或参数不一致，统一以 [package.json](../../package.json) 里现有脚本名为准，不再新增平行入口。

完成标准：

1. `status`、`currentSession`、`runGraph`、`messageCount`、`timelineItemCount` 五个口径能重复执行。
2. 审计结果可以被附在 cleanup PR 或评审记录里，而不是只看终端输出。

当前结果：

1. [control-plane/service/src/db/migration/audit-task-domain-consistency.ts](../../control-plane/service/src/db/migration/audit-task-domain-consistency.ts) 已支持 `--json-output <path>`，可将审计报告持久化为 JSON artifact。
2. [scripts/run-task-domain-audit-gate.sh](../../scripts/run-task-domain-audit-gate.sh) 已默认产出 `tmp/task-domain-audit/report.json`，并保持 `--fail-on-mismatch` 语义不变。
3. audit CLI 已改为按需懒加载数据库模块，`--help` 等无副作用命令不再触发数据库初始化。

## 9. 任务包 F

### F1. cleanup migration 与文档口径跟进

状态：`已完成（2026-03-25）`

优先级：`P2`

涉及文件：

1. [docs/task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)
2. [docs/task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
3. [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
4. [docs/project-tree-storage-design.md](project-tree-storage-design.md)
5. [archive/task-domain/historical-pg-event-sourcing-optimization-plan.md](../archive/task-domain/historical-pg-event-sourcing-optimization-plan.md)

代码动作：

1. 代码收口完成后，把这几份文档中的未来时表述改成“已完成 / compat only / 历史保留”的最终口径。
2. 为 cleanup migration 预留明确的 backlog 编号，但不要在代码尚未完成前伪造已落地的 SQL。

完成标准：

1. 文档不再暗示 tree payload 或 branch timeline 还是 task 主读模型。
2. radical 文档只做状态说明，不再承担执行 backlog 的角色。

当前结果：

1. [docs/project-tree-storage-design.md](project-tree-storage-design.md) 已同步为“主体已落地，剩余内容以历史记录与可选优化为主”的口径。
2. 本 backlog 已从“进行中”更新为主线已完成，只保留防回退维护与可选优化的说明，不再把 tree payload 白名单或 branch compat 语义继续描述成待收尾主任务。
3. cleanup migration 相关文档当前已统一按“已完成 / compat only / 历史保留 / 可选优化”四类口径描述，不再把 radical 文档当作执行型 backlog 使用。

## 10. 历史执行顺序

1. `A1` -> `A2`（已完成）
2. `B1` -> `B2`（已完成，现转入白名单防回退维护）
3. `C1` -> `C2`（已完成，branch compat 语义已收口）
4. `D1` -> `D2`（已完成一轮显式验证，后续进入防回退维护）
5. `E1`（已完成）
6. `F1`（已完成）

原因：

1. TaskDetailV3 主读链与 branch compat 主实现的代码收口已经完成；tree payload 白名单和 branch compat 测试/文档语义也已同步落到当前基线。
2. `E1` 作为 gate 已固化，可继续作为防回退准入证据使用。
3. 当前剩余动作以文档历史维护、测试防回退和可选优化为主，不再属于主线收尾阻塞项。

## 11. 完成定义

只有当以下条件同时满足时，本 backlog 才算完成：

1. TaskDetailV3 的主业务字段已不依赖 tree payload 兜底。
2. `project_tree_nodes.content_json` 的 compat 字段边界已形成明确白名单。
3. branch message / timeline 路由已在代码结构和测试语义上收口为 compat 面。
4. task list、task detail、project overview、monitor 至少有一轮显式主读链验证。
5. audit gate 可作为 cleanup 准入证据稳定执行。
