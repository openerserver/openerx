# TaskDetail Continue 简化方案实施清单（映射现有模块与文件）

> 状态：Draft v1
> 日期：2026-04-11
> 作者：GitHub Copilot
> 关联文档：[task-detail-continue-simplified-design.md](task-detail-continue-simplified-design.md)、[task-detail-continue-sequence-diagrams.md](task-detail-continue-sequence-diagrams.md)、[task-detail-message-state-machine-plan.md](task-detail-message-state-machine-plan.md)、[task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)、[task-detail-continue-target-module-architecture.md](task-detail-continue-target-module-architecture.md)

## 1. 文档目的

这份文档把“简化后的 continue 方案”拆成一版按仓库现状可执行的改造清单，重点回答三个问题：

1. 现在哪些模块承担了 continue 主链路
2. 每个阶段应该改哪些现有文件
3. 哪些模块短期保留不动，哪些必须优先收口

## 2. 根因与改造总策略

当前问题不在于单个函数写复杂了，而在于三类能力被塞进了一条主链路：

1. 普通 continue
2. parallel compare
3. sequential workflow

这导致 [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)、[control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)、[control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) 都在各自维护一套局部状态机。

改造总策略是：

1. 先把 continue 收敛成 single-only 主链路
2. 再把主聊天页收敛成“单 active round 或单 active session”的消息流
3. 然后把 compare 和 workflow 从主聊天链路里拆成独立功能
4. 最后再清理兼容 DTO、刷新策略和测试债务

短期原则：

1. 第一阶段优先在 web-ui 和 web-ui-bff 收口，不要求马上重写 service 存储模型
2. service 现有 session / tree / canonical message 表继续做真源
3. round 可以先作为 BFF 对外 DTO 抽象，不必第一阶段就落独立数据库表

## 3. 现有模块分组

### 3.1 页面与视图装配

主页面与主区视图：

1. [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue)
2. [control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue](../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue)
3. [control-plane/web-ui/src/components/task-detail-shared/ChatComposer.vue](../control-plane/web-ui/src/components/task-detail-shared/ChatComposer.vue)
4. [control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts](../control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts)

页面总装配：

1. [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)
2. [control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts](../control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts)

### 3.2 主聊天数据与 realtime

主聊天消息读链与实时 patch：

1. [control-plane/web-ui/src/composables/useTreeMessages.ts](../control-plane/web-ui/src/composables/useTreeMessages.ts)
2. [control-plane/web-ui/src/composables/useTaskMessageStore.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.ts)
3. [control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts](../control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts)
4. [control-plane/web-ui/src/lib/message-normalize.ts](../control-plane/web-ui/src/lib/message-normalize.ts)
5. [control-plane/web-ui/src/lib/task-detail-refresh-policy.ts](../control-plane/web-ui/src/lib/task-detail-refresh-policy.ts)
6. [control-plane/web-ui/src/composables/useTaskDetailRefreshController.ts](../control-plane/web-ui/src/composables/useTaskDetailRefreshController.ts)
7. [control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts)

### 3.3 可选功能耦合点

parallel 相关：

1. [control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts](../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts)
2. [control-plane/web-ui/src/lib/task-detail-parallel-conversation.ts](../control-plane/web-ui/src/lib/task-detail-parallel-conversation.ts)
3. [control-plane/web-ui/src/lib/task-detail-parallel-runtime.ts](../control-plane/web-ui/src/lib/task-detail-parallel-runtime.ts)

workflow 相关：

1. [control-plane/web-ui/src/composables/useTaskDetailSequentialStepsCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailSequentialStepsCoordinator.ts)
2. [control-plane/web-ui/src/composables/useTaskDetailExecutionModeCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailExecutionModeCoordinator.ts)

动作编排：

1. [control-plane/web-ui/src/composables/useTaskDetailActionCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailActionCoordinator.ts)

### 3.4 BFF 入口与 realtime 桥接

主路由与任务编排：

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
2. [control-plane/web-ui-bff/src/modules/tasks/finalize.ts](../control-plane/web-ui-bff/src/modules/tasks/finalize.ts)
3. [control-plane/web-ui-bff/src/modules/tasks/reconcile.ts](../control-plane/web-ui-bff/src/modules/tasks/reconcile.ts)
4. [control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts](../control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts)
5. [control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution.ts](../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution.ts)

runtime 事件桥与对外广播：

1. [control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono.ts](../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono.ts)
2. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)
3. [control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster.ts](../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster.ts)
4. [control-plane/web-ui-bff/src/modules/realtime/pipeline-events.ts](../control-plane/web-ui-bff/src/modules/realtime/pipeline-events.ts)
5. [control-plane/web-ui-bff/src/modules/agent-control/continue-latency-tracer.ts](../control-plane/web-ui-bff/src/modules/agent-control/continue-latency-tracer.ts)

### 3.5 Service 真源层

路由注册与读写 API：

1. [control-plane/service/src/modules/tasks/task-route-registrations.ts](../control-plane/service/src/modules/tasks/task-route-registrations.ts)
2. [control-plane/service/src/modules/tasks/task-route-session-registrations.ts](../control-plane/service/src/modules/tasks/task-route-session-registrations.ts)
3. [control-plane/service/src/modules/tasks/task-route-projection-registrations.ts](../control-plane/service/src/modules/tasks/task-route-projection-registrations.ts)
4. [control-plane/service/src/modules/tasks/task-session-routes.ts](../control-plane/service/src/modules/tasks/task-session-routes.ts)
5. [control-plane/service/src/modules/tasks/task-projection-routes.ts](../control-plane/service/src/modules/tasks/task-projection-routes.ts)
6. [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts)
7. [control-plane/service/src/modules/tasks/task-session-message-write-api.ts](../control-plane/service/src/modules/tasks/task-session-message-write-api.ts)
8. [control-plane/service/src/modules/tasks/task-domain-projector.ts](../control-plane/service/src/modules/tasks/task-domain-projector.ts)
9. [control-plane/service/src/modules/tasks/task-phase-write-api.ts](../control-plane/service/src/modules/tasks/task-phase-write-api.ts)

### 3.6 当前高价值测试入口

前端：

1. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts)
2. [tests/web-ui/useTaskDetailActionCoordinator.test.ts](../tests/web-ui/useTaskDetailActionCoordinator.test.ts)
3. [control-plane/web-ui/src/composables/useTaskMessageStore.test.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.test.ts)
4. [control-plane/web-ui/src/composables/useTaskDetailRefreshController.test.ts](../control-plane/web-ui/src/composables/useTaskDetailRefreshController.test.ts)
5. [control-plane/web-ui/src/lib/task-message-patch-event.test.ts](../control-plane/web-ui/src/lib/task-message-patch-event.test.ts)
6. [control-plane/web-ui/src/lib/task-message-patch-effects.test.ts](../control-plane/web-ui/src/lib/task-message-patch-effects.test.ts)

BFF：

1. [tests/web-ui-bff/lifecycle-hooks-behavior.test.ts](../tests/web-ui-bff/lifecycle-hooks-behavior.test.ts)
2. [tests/web-ui-bff/task-completion-routes.test.ts](../tests/web-ui-bff/task-completion-routes.test.ts)
3. [tests/web-ui-bff/task-execute-stage-dispatch-route.test.ts](../tests/web-ui-bff/task-execute-stage-dispatch-route.test.ts)
4. [tests/web-ui-bff/task-workflow-view-route.test.ts](../tests/web-ui-bff/task-workflow-view-route.test.ts)
5. [tests/web-ui-bff/workflow-stage-execution.test.ts](../tests/web-ui-bff/workflow-stage-execution.test.ts)
6. [tests/web-ui-bff/continue-latency-tracer.test.ts](../tests/web-ui-bff/continue-latency-tracer.test.ts)

## 4. 分阶段改造清单

## 4.1 阶段一：把 continue 收敛成 single-only 主链路

目标：

1. `POST /tasks/:taskId/continue` 只负责 child session continue
2. 不再接受 `executionMode`
3. 页面不再支持 continue 排队

### 需要修改的现有文件

接口与 BFF：

1. [control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts)
2. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)

页面动作与视图：

1. [control-plane/web-ui/src/composables/useTaskDetailActionCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailActionCoordinator.ts)
2. [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)
3. [control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts](../control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts)
4. [control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue](../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue)
5. [control-plane/web-ui/src/components/task-detail-shared/ChatComposer.vue](../control-plane/web-ui/src/components/task-detail-shared/ChatComposer.vue)

### 具体动作

1. 在 [control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts) 删除 `continueTask(...)` 的 `executionMode` 参数，只保留 `taskId + prompt + sessionId`。
2. 在 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 收紧 continue schema，去掉 `executionMode`，并让 `continueTaskExecution(...)` 永远只走 single continue flow。
3. 在 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 把 `resolveTaskContinuationParallelPlan(...)`、parallel continue dispatch、`sequential-chain` continue 兼容分支从 `/continue` 调用链移出；短期可保留 helper，但不能再由 route 触发。
4. 在 [control-plane/web-ui/src/composables/useTaskDetailActionCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailActionCoordinator.ts) 删除 `queueContinuation(...)`、`queuedContinuations`、自动续发队列逻辑。当前 round 运行中时，直接提示“当前回复未完成，不能继续发送”。
5. 在 [control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts](../control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts) 移除与 `queuedContinuations`、`handleClearQueuedContinuations`、`handleRemoveQueuedContinuation` 相关的主区 model 暴露。
6. 在 [control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue](../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue) 和 [control-plane/web-ui/src/components/task-detail-shared/ChatComposer.vue](../control-plane/web-ui/src/components/task-detail-shared/ChatComposer.vue) 删除排队 UI。

### 同步调整的测试

1. 更新 [tests/web-ui/useTaskDetailActionCoordinator.test.ts](../tests/web-ui/useTaskDetailActionCoordinator.test.ts)：把“正在执行时进入队列”的断言改为“直接拒绝发送”。
2. 更新 [tests/web-ui-bff/lifecycle-hooks-behavior.test.ts](../tests/web-ui-bff/lifecycle-hooks-behavior.test.ts)：删除 continue route 的 parallel continuation 断言，改为只覆盖 single continue。
3. 保留并扩充 [tests/web-ui-bff/continue-latency-tracer.test.ts](../tests/web-ui-bff/continue-latency-tracer.test.ts)：确认 single continue 的 runtime 首事件到 `task.message.*` 映射不退化。

### 这一阶段先不要动的文件

1. [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts)
2. [control-plane/service/src/modules/tasks/task-session-message-write-api.ts](../control-plane/service/src/modules/tasks/task-session-message-write-api.ts)
3. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)

原因：这一阶段只改 continue 路由语义，不碰底层消息真源和 realtime patch contract。

## 4.2 阶段二：把主聊天页收敛成单一消息流

目标：

1. TaskDetail 主聊天只消费 active session 的消息
2. 主聊天不再被 parallel candidate 卡和 workflow step 状态污染
3. 页面从“tree + overlay + compare merge”回到“snapshot + patch”模式

### 需要修改的现有文件

1. [control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts](../control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts)
2. [control-plane/web-ui/src/composables/useTreeMessages.ts](../control-plane/web-ui/src/composables/useTreeMessages.ts)
3. [control-plane/web-ui/src/composables/useTaskMessageStore.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.ts)
4. [control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts](../control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts)
5. [control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts)
6. [control-plane/web-ui/src/composables/useTaskDetailRefreshController.ts](../control-plane/web-ui/src/composables/useTaskDetailRefreshController.ts)
7. [control-plane/web-ui/src/lib/task-detail-refresh-policy.ts](../control-plane/web-ui/src/lib/task-detail-refresh-policy.ts)

### 具体动作

1. 在 [control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts](../control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts) 明确“baseConversationItems 只代表主聊天 active session”，不再让 parallel flow 改写主消息流。
2. 在 [control-plane/web-ui/src/composables/useTreeMessages.ts](../control-plane/web-ui/src/composables/useTreeMessages.ts) 把职责收敛到两件事：读取持久化消息、拼 active session 的最小 pending assistant。不要再负责 parallel candidate 的展示语义。
3. 在 [control-plane/web-ui/src/composables/useTaskMessageStore.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.ts) 和 [control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts](../control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts) 固定主聊天只消费 `task.message.updated` / `task.message.delta` / `task.reconcile.required` 触发的状态变化。
4. 在 [control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts) 让 `refreshTaskSnapshot` 的主路径优先服务主聊天；parallel 和 workflow 触发单独的 snapshot refresh，不再和主聊天 refresh 绑成一组。
5. 在 [control-plane/web-ui/src/composables/useTaskDetailRefreshController.ts](../control-plane/web-ui/src/composables/useTaskDetailRefreshController.ts) 调整 refresh reason 分组，把 compare/workflow 专属事件从主聊天消息刷新条件里拆出去。

### 建议新增的相邻模块

建议在 [control-plane/web-ui/src/composables](../control-plane/web-ui/src/composables) 新增单 round 或单 active session 的消息 composable，命名可放在 `useTreeMessages.ts` 旁边，用来承接后续 round DTO，而不是继续把所有逻辑塞回 `useTreeMessages.ts`。

### 同步调整的测试

1. 扩充 [control-plane/web-ui/src/composables/useTaskMessageStore.test.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.test.ts)：覆盖 active session 切换、reconcile 后恢复、pending assistant 清理。
2. 扩充 [control-plane/web-ui/src/composables/useTaskDetailRefreshController.test.ts](../control-plane/web-ui/src/composables/useTaskDetailRefreshController.test.ts)：覆盖 compare/workflow 事件不再误触发主聊天高频刷新。
3. 补充 [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts)：验证主聊天在有 compare/workflow 历史时仍只显示 active session 对话流。

## 4.3 阶段三：把 parallel compare 从 TaskDetail 主链路拆出去

目标：

1. compare 变成独立功能入口，不再是 continue mode
2. 候选结果不再插回主聊天流式链路
3. adoption 只发生在 compare feature 内

### 需要修改的现有文件

前端：

1. [control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts](../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts)
2. [control-plane/web-ui/src/lib/task-detail-parallel-conversation.ts](../control-plane/web-ui/src/lib/task-detail-parallel-conversation.ts)
3. [control-plane/web-ui/src/lib/task-detail-parallel-runtime.ts](../control-plane/web-ui/src/lib/task-detail-parallel-runtime.ts)
4. [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)
5. [control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts](../control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts)
6. [control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue](../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue)

BFF：

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
2. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)
3. [control-plane/web-ui-bff/src/modules/tasks/finalize.ts](../control-plane/web-ui-bff/src/modules/tasks/finalize.ts)
4. [control-plane/web-ui-bff/src/modules/tasks/reconcile.ts](../control-plane/web-ui-bff/src/modules/tasks/reconcile.ts)

### 具体动作

1. 在 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 新增独立 compare route，把当前 parallel continue 逻辑迁过去；`registerParallelTask(...)` 仅由 compare 或 execute parallel 入口调用。
2. 在 [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts) 让 `useTaskDetailParallelFlow(...)` 不再参与 `conversationItems` 主链路合成；主页面只按需要挂一个 compare 面板 model。
3. 在 [control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts](../control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts) 和 [control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue](../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue) 移除“主聊天区直接承载候选采纳”的耦合，采纳动作迁到 compare 视图。
4. 在 [control-plane/web-ui/src/lib/task-detail-parallel-conversation.ts](../control-plane/web-ui/src/lib/task-detail-parallel-conversation.ts) 保留候选态展示与 fallback，但它只服务 compare feature，不再参与主聊天 conversation splice。
5. 在 [control-plane/web-ui-bff/src/modules/tasks/finalize.ts](../control-plane/web-ui-bff/src/modules/tasks/finalize.ts) 和 [control-plane/web-ui-bff/src/modules/tasks/reconcile.ts](../control-plane/web-ui-bff/src/modules/tasks/reconcile.ts) 继续维护 compare 生命周期，但不要再要求主聊天页感知候选内部状态。

### 同步调整的测试

1. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts) 中与候选卡插入主对话流相关的用例应拆成独立 compare 视图测试。
2. [tests/web-ui-bff/lifecycle-hooks-behavior.test.ts](../tests/web-ui-bff/lifecycle-hooks-behavior.test.ts) 中 continue route 的 parallel 断言迁到新的 compare route 套件。
3. [tests/web-ui-bff/task-completion-routes.test.ts](../tests/web-ui-bff/task-completion-routes.test.ts) 保留 adoption 路由验证，但要从“主聊天采纳按钮”迁成“compare feature 采纳动作”。

## 4.4 阶段四：把 sequential workflow 从 continue 语义中彻底移除

目标：

1. workflow 只从 execute 或 workflow 入口启动
2. continue 不再知道 sequential-chain
3. 步骤状态展示不再与聊天 composer 共用同一套执行模式配置

### 需要修改的现有文件

前端：

1. [control-plane/web-ui/src/composables/useTaskDetailSequentialStepsCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailSequentialStepsCoordinator.ts)
2. [control-plane/web-ui/src/composables/useTaskDetailExecutionModeCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailExecutionModeCoordinator.ts)
3. [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)
4. [control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue](../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue)

BFF：

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
2. [control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts](../control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts)
3. [control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution.ts](../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution.ts)
4. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)

### 具体动作

1. 在 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 确保 `/continue` 永远不再接受 `sequential-chain`，顺序链只保留在 `/execute` 或后续独立 workflow route。
2. 在 [control-plane/web-ui/src/composables/useTaskDetailExecutionModeCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailExecutionModeCoordinator.ts) 取消“主聊天 composer 下选择 sequential-chain”的入口，把 workflow 配置移到独立 workflow 视图。
3. 在 [control-plane/web-ui/src/composables/useTaskDetailSequentialStepsCoordinator.ts](../control-plane/web-ui/src/composables/useTaskDetailSequentialStepsCoordinator.ts) 保留 step 解析与展示能力，但它只服务 workflow feature，不再反向决定主聊天的执行模式。
4. 在 [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) 保留 `registerSequentialChainTask(...)` 和自动推进逻辑，但它只归 workflow 运行时模块消费，不再通过主聊天 refresh policy 间接驱动页面。

### 同步调整的测试

1. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts) 中与 sequential-chain 直接绑定主聊天区的用例迁到 workflow 视图或 workflow panel 套件。
2. [tests/web-ui-bff/task-execute-stage-dispatch-route.test.ts](../tests/web-ui-bff/task-execute-stage-dispatch-route.test.ts)、[tests/web-ui-bff/task-workflow-view-route.test.ts](../tests/web-ui-bff/task-workflow-view-route.test.ts)、[tests/web-ui-bff/workflow-stage-execution.test.ts](../tests/web-ui-bff/workflow-stage-execution.test.ts) 继续作为 workflow 真正回归入口。

## 4.5 阶段五：补 round facade 与公共 DTO 收口

目标：

1. 对外逐步把 session lineage 包成 round DTO
2. 前端按 round 读取，不再直接理解太多 lineage 细节
3. BFF 成为 round facade，service 继续做底层真源

### 需要修改的现有文件

1. [control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts)
2. [control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts](../control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts)
3. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
4. [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts)
5. [control-plane/service/src/modules/tasks/task-route-session-registrations.ts](../control-plane/service/src/modules/tasks/task-route-session-registrations.ts)

### 具体动作

1. 在 BFF 侧新增 round facade 读接口，位置建议放在 [control-plane/web-ui-bff/src/modules/tasks](../control-plane/web-ui-bff/src/modules/tasks) 目录下，与 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts) 同层。
2. 第一阶段 round facade 可直接复用 [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts) 的 session/tree 读结果做转换，不要求 service 立刻新增 round 表。
3. 在 [control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts) 增加 round DTO 读接口，并逐步替换 `getTaskMessages()` 这类直接面向 tree 的聊天读法。
4. 在 [control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts](../control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts) 逐步从“selectedSessionId”过渡到“activeRoundId + activeSessionId”。

### 这一阶段可选的 service 增强

如果 round facade 长期稳定，再考虑在 service 侧正式加入 round 读模型；在此之前不要为了 round 名字过早改动 canonical message 写链。

## 4.6 阶段六：测试与清理收尾

目标：

1. 测试按 continue / compare / workflow 三条链重组
2. 清理主聊天链路中的历史兼容残留

### 需要清理的现有文件

前端：

1. [tests/web-ui/useTaskDetailActionCoordinator.test.ts](../tests/web-ui/useTaskDetailActionCoordinator.test.ts)
2. [tests/web-ui/TaskDetailV3.test.ts](../tests/web-ui/TaskDetailV3.test.ts)
3. [control-plane/web-ui/src/composables/useTaskMessageStore.test.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.test.ts)
4. [control-plane/web-ui/src/lib/task-message-patch-event.test.ts](../control-plane/web-ui/src/lib/task-message-patch-event.test.ts)
5. [control-plane/web-ui/src/lib/task-message-patch-effects.test.ts](../control-plane/web-ui/src/lib/task-message-patch-effects.test.ts)

BFF：

1. [tests/web-ui-bff/lifecycle-hooks-behavior.test.ts](../tests/web-ui-bff/lifecycle-hooks-behavior.test.ts)
2. [tests/web-ui-bff/task-completion-routes.test.ts](../tests/web-ui-bff/task-completion-routes.test.ts)
3. [tests/web-ui-bff/task-execute-stage-dispatch-route.test.ts](../tests/web-ui-bff/task-execute-stage-dispatch-route.test.ts)
4. [tests/web-ui-bff/task-workflow-view-route.test.ts](../tests/web-ui-bff/task-workflow-view-route.test.ts)
5. [tests/web-ui-bff/workflow-stage-execution.test.ts](../tests/web-ui-bff/workflow-stage-execution.test.ts)

### 清理原则

1. continue 套件只测 single-only child session 语义。
2. compare 套件只测 candidate run 创建、结果展示、winner adopt。
3. workflow 套件只测 step 启动、自动推进、最终收尾。
4. 主聊天页测试不再断言 parallel candidate 卡和 workflow step 同时混在一条 conversation list 中。

## 5. 推荐实施顺序

建议按下面顺序推进，避免一次性大改：

1. 阶段一：收口 continue route 与 composer 队列。
2. 阶段二：收口主聊天消息流和 refresh policy。
3. 阶段三：拆出 compare feature。
4. 阶段四：拆出 workflow feature。
5. 阶段五：补 round facade 与对外 DTO。
6. 阶段六：重组测试与删除历史兼容逻辑。

## 6. 阶段完成判定

可以用下面的标准判断是否真正收口完成：

1. `/continue` 请求体里不再出现 `executionMode`。
2. TaskDetail 主聊天页没有 queued continue UI，也没有 candidate 卡插入主消息流。
3. compare 入口不再复用主聊天 continue 按钮。
4. workflow 入口不再复用主聊天 composer mode。
5. 主聊天页的消息刷新只围绕 active session 或 active round，而不是被 parallel 和 workflow 状态驱动。