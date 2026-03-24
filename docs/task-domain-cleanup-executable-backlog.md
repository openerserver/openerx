# 任务域收尾可执行 Backlog

> 状态：Ready  
> 日期：2026-03-24  
> 作者：GitHub Copilot

## 1. 文档目的

本文把当前 task-domain 未收尾项压成按文件执行的 backlog，避免后续继续从方案文档、评审记录和代码搜索结果里手工拼任务。

配套文档：

1. [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)
2. [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
3. [task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)

## 2. 执行原则

1. 只把真正还存在于运行时代码里的兼容面列入本 backlog；纯历史结论不再重复。
2. 每个任务包都按“要改的文件”“代码动作”“验证方式”组织，执行时应直接对照文件落改。
3. `execution trace` 的公开边界已经由 ADR 锁定；本 backlog 不再讨论是否恢复 runtime fallback。
4. 本 backlog 的目标是收口旧兼容层，不是重做 schema，也不是新增新的主读模型。

## 3. 总体判断

当前代码状态可以分成三类：

1. 已基本完成：projection-first trace、service timeline restricted secondary source、audit gate 接线。
2. 仍有运行时代码残留：tree payload 兼容读取、TaskDetailV3 主读链混用、branch history 兼容接口。
3. 仍缺闭环验证：task list、monitor、project overview 等页面虽然大概率已站在新读链上，但还缺“不会退回 tree task snapshot 语义”的显式验证。

## 4. 任务包 A

### A1. TaskDetailV3 主读链从 tree payload 解耦

优先级：`P0`

目标：

1. TaskDetailV3 的业务字段以 BFF `getTask()` 返回为主。
2. project tree 只保留 breadcrumb、links、branch 入口等结构导航语义。
3. 不再把 `content_json` 展平结果重新 merge 回 task facade。

涉及文件：

1. [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../control-plane/web-ui/src/composables/useProjectTreeTask.ts)
2. [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue)
3. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts)
4. [tests/web-ui-bff/project-tree-task-composable.test.ts](../tests/web-ui-bff/project-tree-task-composable.test.ts)

代码动作：

1. 在 [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../control-plane/web-ui/src/composables/useProjectTreeTask.ts) 停止使用 `flattenTreeNodeToTask(...)` 覆盖 BFF task 字段。
2. 让 [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../control-plane/web-ui/src/composables/useProjectTreeTask.ts) 返回“task 业务数据”和“tree 导航数据”两个清晰层次，而不是混合后的 `TreeTask` facade。
3. 在 [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue) 去掉对 tree-derived `executionMode`、`autoAdvanceStages`、`changesSummary` 等业务字段的隐式依赖。
4. 保留 [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue) 对 `nodeId`、ancestor breadcrumb、link panel 所需的 tree 结构信息，但这些信息不得再承担 task 主状态来源。
5. 如 `flattenTreeNodeToTask(...)` 只剩测试用途，则删除该 helper；若仍保留，必须明确标注为 legacy compat helper，不得再被主页面直接消费。

完成标准：

1. TaskDetailV3 在 tree node 请求失败时，仍可依赖 BFF task + trace 正常展示主业务状态。
2. `useProjectTreeTask` 不再把 tree payload 作为 task 业务字段兜底。
3. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts) 改为显式覆盖“tree 可选、task 主读链仍成立”的场景。

### A2. TaskDetailV3 主读链验证补齐

优先级：`P0`

涉及文件：

1. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts)

代码动作：

1. 增加 tree node 缺失或 ancestors 拉取失败时，TaskDetailV3 仍依赖 `getTask()` 与 `getTaskExecutionTraceView()` 正常渲染的 case。
2. 增加断言，证明主 header、执行模式、候选状态、trace warning 不需要 tree payload 才能成立。
3. 仅把 breadcrumb / links 等结构信息标记为可降级区域。

完成标准：

1. 测试里能区分“主业务数据”和“树导航数据”的失败影响面。
2. 不再出现“tree API 失败导致 task 主状态整体不可用”的断言空白。

## 5. 任务包 B

### B1. `project_tree_nodes.content_json` 白名单收口

优先级：`P0`

目标：

1. 彻底枚举仍在读取 tree payload 业务字段的代码点。
2. 将这些字段拆成“继续保留的有限兼容字段”和“应删除的旧兜底”。

涉及文件：

1. [control-plane/service/src/modules/project-tree/task-view.ts](../control-plane/service/src/modules/project-tree/task-view.ts)
2. [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../control-plane/web-ui/src/composables/useProjectTreeTask.ts)
3. [tests/service/project-tree-routes.test.ts](../tests/service/project-tree-routes.test.ts)
4. [tests/web-ui-bff/project-tree-task-composable.test.ts](../tests/web-ui-bff/project-tree-task-composable.test.ts)

代码动作：

1. 在 [control-plane/service/src/modules/project-tree/task-view.ts](../control-plane/service/src/modules/project-tree/task-view.ts) 清理 `readNodeChangesSummary(...)` 对 `node.contentJson.changesSummary` 的业务兜底，改成只在明确允许的 compat 场景读取。
2. 在 [control-plane/service/src/modules/project-tree/task-view.ts](../control-plane/service/src/modules/project-tree/task-view.ts) 清理 `normalizeTaskExecutionModeFromStrategy(...)`、`resolveAutoAdvanceStagesFromStrategy(...)` 这类把 strategy/tree payload 继续翻译成 task 主状态的兼容逻辑，改为 snapshot/run 聚合优先，compat 分支显式隔离。
3. 在 [control-plane/service/src/modules/project-tree/task-view.ts](../control-plane/service/src/modules/project-tree/task-view.ts) 明确保留字段清单，例如 breadcrumb 必要字段、repo label、credential label 等展示性元数据；不再默认接受 task 业务事实继续从 tree payload 回流。
4. 同步调整 [control-plane/web-ui/src/composables/useProjectTreeTask.ts](../control-plane/web-ui/src/composables/useProjectTreeTask.ts)，避免前端继续消费这些旧兼容字段。

完成标准：

1. `changesSummary`、`executionMode`、`autoAdvanceStages` 不再无边界地从 `content_json` 回流到 task 主视图。
2. 能产出一张明确白名单，说明 tree payload 仍允许承载哪些字段。
3. 对应测试要么删除旧断言，要么改成“compat only”语义。

### B2. Tree payload 白名单测试重写

优先级：`P1`

涉及文件：

1. [tests/web-ui-bff/project-tree-task-composable.test.ts](../tests/web-ui-bff/project-tree-task-composable.test.ts)
2. [tests/service/project-tree-routes.test.ts](../tests/service/project-tree-routes.test.ts)

代码动作：

1. 将 [tests/web-ui-bff/project-tree-task-composable.test.ts](../tests/web-ui-bff/project-tree-task-composable.test.ts) 从“展平 tree task”改成“白名单字段不会扩散”的防回归测试。
2. 将 [tests/service/project-tree-routes.test.ts](../tests/service/project-tree-routes.test.ts) 里仍依赖 task payload 展平语义的断言改成兼容边界断言。

完成标准：

1. 测试名和断言都不再暗示 tree payload 是 task 主读模型。
2. 白名单字段的保留原因可从测试名直接看出来。

## 6. 任务包 C

### C1. 历史 branch message/timeline 接口压缩为显式兼容面

优先级：`P1`

当前状态：已完成本轮代码收口；本节保留为验收与后续文档同步基线。

目标：

1. `/branches/:runtimeSessionId/messages`、`/events`、`/timeline` 不再被误读为当前 task 主读接口。
2. 这些接口的职责收口为 lineage/history/debug compat，而不是页面主路径依赖。

涉及文件：

1. [control-plane/service/src/modules/tasks/task-branch-routes.ts](../control-plane/service/src/modules/tasks/task-branch-routes.ts)
2. [control-plane/service/src/modules/tasks/task-route-branch-registrations.ts](../control-plane/service/src/modules/tasks/task-route-branch-registrations.ts)
3. [control-plane/service/src/modules/tasks/task-branch-compat-read.ts](../control-plane/service/src/modules/tasks/task-branch-compat-read.ts)
4. [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts)
5. [tests/service/task-route-registrar.test.ts](../tests/service/task-route-registrar.test.ts)

代码动作：

1. 在 [control-plane/service/src/modules/tasks/task-branch-routes.ts](../control-plane/service/src/modules/tasks/task-branch-routes.ts) 明确把 `messages/events/timeline` 这三条 runtime session route 归类为 compat routes，而不是 task mainline routes。
2. 在 [control-plane/service/src/modules/tasks/task-route-branch-registrations.ts](../control-plane/service/src/modules/tasks/task-route-branch-registrations.ts) 将 compat route 注册与 task 主读 route 注册分层，避免后续继续把它们视为同一等级接口。
3. 在 [control-plane/service/src/modules/tasks/task-branch-compat-read.ts](../control-plane/service/src/modules/tasks/task-branch-compat-read.ts) 保留 branch compat `messages/events/timeline` 实现，并把它与 execution trace 公共 contract 明确分开；compat route 可以保留，但命名和注释必须说明它不是 public trace primary path。
4. 将 [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts) 收缩为纯 conversation/session utility façade，避免 branch compat 主实现继续挂在旧文件名下。
5. 如果保留 `session.message.created/updated/completed/snapshot` 之类历史 eventType 合成逻辑，需限制在 compat-only helper 内，避免继续污染主 timeline 语义。

完成标准：

1. service 代码结构上能一眼看出“task execution trace public path”和“branch compat path”是两层东西。
2. route 注册测试不再把 branch timeline route 当作主读链的一部分。

### C2. Branch compat 路由测试收口

优先级：`P1`

涉及文件：

1. [tests/service/task-route-registrar.test.ts](../tests/service/task-route-registrar.test.ts)
2. [tests/service/task-route-registration-smoke.test.ts](../tests/service/task-route-registration-smoke.test.ts)
3. [tests/service/task-operating-runtime-tree.test.ts](../tests/service/task-operating-runtime-tree.test.ts)

代码动作：

1. 将 branch route 相关测试命名改为 compat / lineage / history 语义。
2. 删除仍然暗示这些路由是 task 主 trace 读取面的断言。
3. 保留必要的集成测试，但让其验证“兼容面仍可用”，而不是“主页面依赖它”。

完成标准：

1. branch 相关测试语义全部收口到 compat 面。
2. 不再用 branch route 测试间接证明 task public trace contract。

## 7. 任务包 D

### D1. 页面主读链验证矩阵补齐

状态：`基础矩阵已建立，未完成（2026-03-24）`

优先级：`P1`

目标：

1. 把“应该已经切到新模型”变成“有测试证明不会退回旧模型”。
2. 这一批以验证为主，代码修改应最小化。

涉及文件：

1. [tests/web-ui/Tasks.test.ts](../tests/web-ui/Tasks.test.ts)
2. [tests/web-ui/Dashboard.test.ts](../tests/web-ui/Dashboard.test.ts)
3. [tests/web-ui/MultiTaskMonitor.test.ts](../tests/web-ui/MultiTaskMonitor.test.ts)
4. [tests/web-ui/ProjectDetail.test.ts](../tests/web-ui/ProjectDetail.test.ts)
5. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts)

代码动作：

1. 为任务列表、监控页、项目概览补充断言，证明页面消费的是 BFF task/project 读模型，而不是 tree task snapshot 展平结果。
2. 若页面仍存在隐式 tree 依赖，则在对应页面源文件内补最小修正，并同步记录到本 backlog。
3. 若页面已经不依赖 tree，只补测试，不额外改实现。

完成标准：

1. 这几类页面都能给出“主读数据源是什么”的显式测试证据。
2. 不再出现“页面默认靠 tree fallback 兜底，但测试没覆盖”的空白区。

当前结果：

1. [tests/web-ui/Tasks.test.ts](../tests/web-ui/Tasks.test.ts) 已补首屏直接消费 `listTasks()` 的断言，明确任务列表不会在初始渲染时逐条回填 `getTask()`。
2. [tests/web-ui/MultiTaskMonitor.test.ts](../tests/web-ui/MultiTaskMonitor.test.ts) 已补“branch/session 读取缺失时仍能依赖 `listTasks()` + `getTask()` + `getTaskPipeline()` 保持主卡片可读”的断言。
3. [tests/web-ui/ProjectDetail.test.ts](../tests/web-ui/ProjectDetail.test.ts) 已补“secondary overview cards 失败时，项目基础信息仍由 `getProject()` 驱动渲染”的断言。
4. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts) 已补 tree 导航缺失时仍可依赖 task 主读链渲染的断言。
5. 但当前仍缺 dashboard 等剩余页面的显式主读链验证，因此该任务只能视为“基础矩阵已建立”，不能视为已关闭。

### D2. trace contract 回归矩阵继续保留

状态：`已完成（2026-03-24）`

优先级：`P1`

涉及文件：

1. [tests/web-ui-bff/task-execution-trace-route.test.ts](../tests/web-ui-bff/task-execution-trace-route.test.ts)
2. [tests/web-ui-bff/project-execution-trace-route.test.ts](../tests/web-ui-bff/project-execution-trace-route.test.ts)

代码动作：

1. 保持现有 projection-first / partial 保留 / secondary source 边界测试，不允许因清理 compat 层而回归。
2. 如果 branch compat 路由收口导致 helper 重构，同步更新这两份测试，保证 public trace contract 不变。

完成标准：

1. public trace contract 的测试仍以 task/project 两条公开路由为唯一主入口。
2. compat route 的存在与否不影响这两份测试的语义。

当前结果：

1. [tests/web-ui-bff/task-execution-trace-route.test.ts](../tests/web-ui-bff/task-execution-trace-route.test.ts) 已重跑并覆盖 projection-first、partial 保留、secondary source 边界。
2. [tests/web-ui-bff/project-execution-trace-route.test.ts](../tests/web-ui-bff/project-execution-trace-route.test.ts) 已重跑并覆盖相同 contract。
3. 当前 public trace contract 仍稳定锁在 task/project 两条公开路由，不依赖 branch compat route 证明主链语义。

## 8. 任务包 E

### E1. 一致性审计与 gate 输出固化

状态：`已完成（2026-03-24）`

优先级：`P1`

涉及文件：

1. [control-plane/service/src/db/migration/audit-task-domain-consistency.ts](../control-plane/service/src/db/migration/audit-task-domain-consistency.ts)
2. [scripts/check-all.sh](../scripts/check-all.sh)
3. [package.json](../package.json)

代码动作：

1. 保持 [scripts/check-all.sh](../scripts/check-all.sh) 中 lint -> typecheck -> task-domain audit gate 的顺序不回退。
2. 如审计脚本当前还缺稳定 artifact 输出，则在 [control-plane/service/src/db/migration/audit-task-domain-consistency.ts](../control-plane/service/src/db/migration/audit-task-domain-consistency.ts) 增加明确的 machine-readable 输出模式，方便作为 cleanup 准入证据留档。
3. 若命令入口或参数不一致，统一以 [package.json](../package.json) 里现有脚本名为准，不再新增平行入口。

完成标准：

1. `status`、`currentSession`、`runGraph`、`messageCount`、`timelineItemCount` 五个口径能重复执行。
2. 审计结果可以被附在 cleanup PR 或评审记录里，而不是只看终端输出。

当前结果：

1. [control-plane/service/src/db/migration/audit-task-domain-consistency.ts](../control-plane/service/src/db/migration/audit-task-domain-consistency.ts) 已支持 `--json-output <path>`，可将审计报告持久化为 JSON artifact。
2. [scripts/run-task-domain-audit-gate.sh](../scripts/run-task-domain-audit-gate.sh) 已默认产出 `tmp/task-domain-audit/report.json`，并保持 `--fail-on-mismatch` 语义不变。
3. audit CLI 已改为按需懒加载数据库模块，`--help` 等无副作用命令不再触发数据库初始化。

## 9. 任务包 F

### F1. cleanup migration 与文档口径跟进

优先级：`P2`

涉及文件：

1. [docs/task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)
2. [docs/task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
3. [docs/task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
4. [docs/project-tree-storage-design.md](project-tree-storage-design.md)
5. [docs/pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md)

代码动作：

1. 代码收口完成后，把这几份文档中的未来时表述改成“已完成 / compat only / 历史保留”的最终口径。
2. 为 cleanup migration 预留明确的 backlog 编号，但不要在代码尚未完成前伪造已落地的 SQL。

完成标准：

1. 文档不再暗示 tree payload 或 branch timeline 还是 task 主读模型。
2. radical 文档只做状态说明，不再承担执行 backlog 的角色。

## 10. 建议执行顺序

1. `A1` -> `A2`
2. `B1` -> `B2`
3. `C1` -> `C2`
4. `D1` -> `D2`（基础矩阵已建立，仍需继续收口）
5. `E1`（已完成）
6. `F1`

原因：

1. 先切掉 TaskDetailV3 和 tree payload 的主读混用，再压 branch compat 面，避免测试矩阵继续站在旧混合层上。
2. `E1` 作为 gate 应在代码收口后固化，避免过早把当前兼容态当作最终基线。
3. 文档应最后收口，否则会先于代码失真。

## 11. 完成定义

只有当以下条件同时满足时，本 backlog 才算完成：

1. TaskDetailV3 的主业务字段已不依赖 tree payload 兜底。
2. `project_tree_nodes.content_json` 的 compat 字段边界已形成明确白名单。
3. branch message / timeline 路由已在代码结构和测试语义上收口为 compat 面。
4. task list、task detail、project overview、monitor 至少有一轮显式主读链验证。
5. audit gate 可作为 cleanup 准入证据稳定执行。
