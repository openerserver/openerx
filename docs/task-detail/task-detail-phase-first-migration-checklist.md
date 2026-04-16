# TaskDetail Phase-First 改造清单

> 状态：Draft
> 日期：2026-04-16
> 作者：GitHub Copilot
>
> 关联文档：
>
> 1. [../task-domain/task-phase-first-task-detail-design.md](../task-domain/task-phase-first-task-detail-design.md)
> 2. [../task-domain/task-phase-first-schema-api-draft.md](../task-domain/task-phase-first-schema-api-draft.md)
> 3. [task-detail-display-write-logic.md](task-detail-display-write-logic.md)

## 1. 文档目的

本文把 TaskDetail phase-first 改造拆成三段执行清单：service、BFF、web-ui。

目标不是“把现有 bug 再修一轮”，而是把主聊天从 round/session 兼容链切到 phase-first 主链。

## 2. 总体完成定义

满足下面条件时，本次改造才算完成：

1. TaskDetail 主时间线以 `phaseIndex` 为唯一一级排序键。
2. 主聊天不再依赖 `/tasks/:taskId/current-round` 和 `/tasks/:taskId/rounds/:roundId/messages`。
3. parallel block 只由 phase DTO 驱动，不再从 candidate session 和 coordinationKey 推断。
4. realtime 事件至少在 TaskDetail 主路径上显式携带 `phaseId`。
5. 同一条 candidate/winner 消息不再在顶层主聊天和 parallel card 中重复显示。

## 3. 执行顺序

固定顺序如下：

1. service 先行，先把 canonical facts 和 phase 读模型补齐。
2. BFF 第二，建立 phase-first DTO 与兼容隔离层。
3. web-ui 第三，切掉 current-round 主链并改造页面状态机。
4. 最后再做 compat 清理和回归收口。

原因很直接：如果 service 没有稳定 phase contract，BFF 只能继续拼 compat；如果 BFF 没有稳定 phase DTO，前端就只能继续在页面里猜轮次。

## 附录 A：历史演进与模块债务对照

下面这张表不是为了重复列“做过什么”，而是明确每一轮到底在清哪一层债。TaskDetail 之所以看起来被大改多次，根因不是同一层反复返工，而是页面壳、persisted baseline、realtime authority、feature boundary、business authority 这五层是在不同轮次才逐步硬切。

| 轮次 | 当时要硬切的主问题 | 代表模块 | 已清债 | 仍在债 |
| --- | --- | --- | --- | --- |
| 第 1 轮：TaskDetailV3 壳层化 | 页面壳、主区、侧栏各自拼状态，没有统一装配入口。 | [TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue)；[useTaskDetailPageModel.ts](../../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)；[useTaskDetailCoreContext.ts](../../control-plane/web-ui/src/composables/useTaskDetailCoreContext.ts)；[useTaskDetailPageSectionModels.ts](../../control-plane/web-ui/src/composables/useTaskDetailPageSectionModels.ts)；[TaskDetailV3MainPane.vue](../../control-plane/web-ui/src/components/task-detail-v3/TaskDetailV3MainPane.vue) | 页面壳变薄；task/session/message/workflow/sidebar 进入统一 page model；主区和侧栏不再各自维护全页装配。 | 只是“装配统一”，不是“事实统一”；主聊天 authority 仍分散在 tree、current-round、trace、parallel、workflow 多条链上。 |
| 第 2 轮：round facade baseline | 主聊天 persisted baseline 来源混乱，task-wide messages、tree 投影、trace fallback 会互相抢 authority。 | [useTaskMessageSnapshot.ts](../../control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts)；[useTreeBranches.ts](../../control-plane/web-ui/src/composables/useTreeBranches.ts)；[task-round-facade.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-round-facade.ts)；[task-session-read-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-read-compat.ts) | 主聊天 baseline 已切到 current-round 和 round messages facade；老的 task-wide messages 退出主路径；snapshot version 和 persisted revision 开始进入主链。 | `current-round` 仍是 session-lineage 启发式，不是 phase locator；round facade 仍是 compat 聚合，不是 canonical phase 读模型；`currentPhaseId` 与 round baseline 仍可能短时分叉。 |
| 第 3 轮：unified conversation store | persisted 列表和 live overlay 是两套真相，导致重复卡片、首 token 空白、正文闪回、落库后再冒出第二张卡。 | [useTaskMessageStore.ts](../../control-plane/web-ui/src/composables/useTaskMessageStore.ts)；[useTaskMessagePatchConsumer.ts](../../control-plane/web-ui/src/composables/useTaskMessagePatchConsumer.ts)；[task-live-assistant-state-manager.ts](../../control-plane/web-ui/src/lib/task-live-assistant-state-manager.ts)；[task-message-patch-event.ts](../../control-plane/web-ui/src/lib/task-message-patch-event.ts)；[task-detail-refresh-policy.ts](../../control-plane/web-ui/src/lib/task-detail-refresh-policy.ts) | 页面层双列表 merge 被删除；同一条消息开始沿 `local -> realtime -> persisted` 单 record 演进；`task.message.persisted` / `task.round.synced` 成为正式切换边界。 | refresh、reconcile、session focus 仍是隐式状态机；compare 和 workflow 仍会通过 refresh / patch / projector 间接污染主聊天；phase-local live authority 还没成立。 |
| 第 4 轮：feature 边界收口 | page model 和大 composable 同时承担 conversation、compare、workflow、sidebar、refresh，多套局部状态机缠在一起。 | [useTaskConversationFeature.ts](../../control-plane/web-ui/src/composables/useTaskConversationFeature.ts)；[useTaskDetailRealtimeFeature.ts](../../control-plane/web-ui/src/composables/useTaskDetailRealtimeFeature.ts)；[useTaskSidebarFeature.ts](../../control-plane/web-ui/src/composables/useTaskSidebarFeature.ts)；[useTaskWorkflowFeature.ts](../../control-plane/web-ui/src/composables/useTaskWorkflowFeature.ts)；[useTaskDetailMainPaneFeature.ts](../../control-plane/web-ui/src/composables/useTaskDetailMainPaneFeature.ts)；[useTaskDetailSidebarPaneFeature.ts](../../control-plane/web-ui/src/composables/useTaskDetailSidebarPaneFeature.ts)；[useTaskDetailParallelFlow.ts](../../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts) | conversation、sidebar、workflow、realtime glue 已有明确 feature 入口；member 读链吸收到 sidebar；页面不再把所有字段平铺到单一 coordinator。 | 这是代码结构收口，不是业务 authority hard-cut；parallel 仍通过 compat 组装回灌主聊天；page model 仍承担一部分跨 feature refresh 编排和兼容兜底。 |
| 第 5 轮：phase-first hard-cut（进行中） | 页面一级单位仍不是 phase block，lineage-first 和 phase-first 混用，导致 parallel/winner/prompt 重复显示。 | [TaskDetailPhaseBlockList.vue](../../control-plane/web-ui/src/components/task-detail-v3/TaskDetailPhaseBlockList.vue)；[task-detail-phase-blocks.ts](../../control-plane/web-ui/src/lib/task-detail-phase-blocks.ts)；[useTaskDetailParallelFlow.ts](../../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts)；[task-phase-write-api.ts](../../control-plane/service/src/modules/tasks/task-phase-write-api.ts)；[routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) | 页面已经能按 `phaseSlices` 渲染 ordered phase blocks；主面板不再默认退回单一扁平消息列表；phase block 路径已有页面和组件回归保护。 | `current-round` 仍在主 persisted 链路上；BFF 还没有真正的 phase-first DTO；realtime 还没有在 TaskDetail 主路径统一以 `phaseId` 作为第一定位键；parallel candidate 展示仍残留一层 compat 组装。 |

当前主债位置可以直接按模块看：

1. current-round / round baseline 债： [task-round-facade.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-round-facade.ts)、[task-session-read-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-read-compat.ts)、[useTaskMessageSnapshot.ts](../../control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts)。
2. parallel 展示回灌债： [useTaskDetailParallelFlow.ts](../../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts)、[task-detail-parallel-conversation-projector.ts](../../control-plane/web-ui/src/lib/task-detail-parallel-conversation-projector.ts)。
3. live authority 尚未 phase-local 化的债： [useTaskMessageStore.ts](../../control-plane/web-ui/src/composables/useTaskMessageStore.ts)、[task-message-patch-event.ts](../../control-plane/web-ui/src/lib/task-message-patch-event.ts)、[task-message-patch-effects.ts](../../control-plane/web-ui/src/lib/task-message-patch-effects.ts)。

因此，当前这轮 phase-first 改造不是“再做一次 UI 重构”，而是在清前四轮都没有真正硬切掉的最后一层债：让 service、BFF、web-ui 三层都围绕 `phaseId` 说同一种语言。

## 4. Service 清单

## 4.1 目标

service 层负责保证：`task_execution_phases` 和 `task_snapshots.currentPhaseId/currentSessionId` 成为一份可直接消费的 canonical truth。

## 4.2 事实模型与写链

1. 审计所有会创建新一轮执行的入口，确保先创建或更新 `task_execution_phases`，再创建该 phase 下的 session。
2. 审计所有 session 创建入口，确保 `task_sessions.phaseId` 在写入时就稳定存在，不能依赖后续修补。
3. 审计 adopt winner 写链，确保只更新 phase 的 `winnerSessionId/status` 与 snapshot 指针，不复制消息、不追加虚拟主线消息。
4. 审计 continue from winner 写链，确保后续执行一定创建新 phase，而不是把消息继续写进旧 parallel phase。
5. 审计 cancel/resume 路径，确保 phase 级状态转换是单独事实，不再依赖 session active 状态推断。

建议起点文件：

1. [../../control-plane/service/src/modules/tasks/task-phase-write-api.ts](../../control-plane/service/src/modules/tasks/task-phase-write-api.ts)
2. [../../control-plane/service/src/modules/tasks/task-session-write-api.ts](../../control-plane/service/src/modules/tasks/task-session-write-api.ts)
3. [../../control-plane/service/src/modules/tasks/task-branch-write.ts](../../control-plane/service/src/modules/tasks/task-branch-write.ts)
4. [../../control-plane/service/src/modules/tasks/task-aggregate-sync.ts](../../control-plane/service/src/modules/tasks/task-aggregate-sync.ts)

## 4.3 读模型与查询 helper

1. 提供按 `phaseIndex` 排序的 task phase 查询 helper。
2. 提供按 `phaseId` 读取 phase sessions 和 phase messages 的 helper。
3. 让 helper 直接返回 phase 元信息：`phaseKind`、`status`、`anchorSessionId`、`winnerSessionId`、`candidateCount`、`updatedAt`。
4. 不再要求上层通过 session lineage 反推 parallel group。

建议起点文件：

1. [../../control-plane/service/src/modules/tasks/task-session-read.ts](../../control-plane/service/src/modules/tasks/task-session-read.ts)
2. [../../control-plane/service/src/modules/tasks/task-session-store.ts](../../control-plane/service/src/modules/tasks/task-session-store.ts)
3. [../../control-plane/service/src/modules/tasks/task-route-builder-shared.ts](../../control-plane/service/src/modules/tasks/task-route-builder-shared.ts)

## 4.4 Realtime 事件

1. 为 TaskDetail 主路径新增或补齐 `task.phase.*` 事件。
2. 让 `task.message.*` 事件带上 `phaseId`。
3. 区分 phase 事件和 message 事件责任，不再让 session activation 事件承担 phase 级状态语义。

建议起点文件：

1. [../../control-plane/service/src/modules/tasks/task-route-builder-shared.ts](../../control-plane/service/src/modules/tasks/task-route-builder-shared.ts)
2. 当前 task-domain broadcaster / event append 相关模块

## 4.5 Service 验收

1. 单测覆盖：single、parallel pending、parallel adopted、parallel continue-after-adopt、cancel、resume。
2. 数据断言覆盖：`currentPhaseId != currentSessionId` 的合法场景。
3. 不再需要通过 legacy message 或 tree 写链修补 phase/snapshot 一致性。

## 5. BFF 清单

## 5.1 目标

BFF 层负责把 service 的 canonical phase facts 收口成稳定 DTO，明确隔离 compat 路径和 TaskDetail 主路径。

## 5.2 新 DTO 与新路由

1. 增加 `GET /api/tasks/:taskId/phases`。
2. 增加 `GET /api/tasks/:taskId/phases/:phaseId/view` 或等价细分接口。
3. DTO 中明确区分：phase 元信息、session summaries、message groups、judge/winner 信息。
4. DTO 返回时已按 `phaseIndex` 排好，不把排序责任留给前端。

建议起点文件：

1. [../../control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
2. 新增或重构 phase-first facade 模块

## 5.3 兼容隔离

1. 将 `/current-round` 明确降级为 compat route，不再作为 TaskDetail 主链。
2. 将 `task-round-facade.ts` 标记为兼容层，不再继续为新页面逻辑追加补丁。
3. 将 `task-session-read-compat.ts`、`task-session-parallel-compat.ts` 中与 parallel grouping、candidate suppression、mainline 回锚相关的逻辑，逐步退出主链。
4. `/tasks/:taskId/sessions` 只负责 session lineage 与 meta，不再偷偷承担 current round authority。

建议起点文件：

1. [../../control-plane/web-ui-bff/src/modules/tasks/task-round-facade.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-round-facade.ts)
2. [../../control-plane/web-ui-bff/src/modules/tasks/task-session-read-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-read-compat.ts)
3. [../../control-plane/web-ui-bff/src/modules/tasks/task-session-parallel-compat.ts](../../control-plane/web-ui-bff/src/modules/tasks/task-session-parallel-compat.ts)

## 5.4 Realtime 出口

1. BFF 对外转发的 task-domain event 至少在 TaskDetail 主路径上带 `phaseId`。
2. 新增 `task.phase.*` 到前端 patch feed 的公共 contract。
3. `session.activated` 这类旧事件可以继续存在，但不再承担 phase 级刷新主语义。

## 5.5 BFF 验收

1. `/phases` 和 `/phases/:phaseId/view` 足以独立驱动 TaskDetail，不再需要 round route 补信息。
2. adopted parallel 的 DTO 不会同时把 winner 作为顶层主聊天消息和 parallel candidate 结果返回两份。
3. `currentPhaseId/currentSessionId/latestPhaseId` 语义在 DTO 中清晰可测。

## 6. Web UI 清单

## 6.1 目标

web-ui 层负责把 TaskDetail 从“round snapshot + parallel projector + realtime patch 修补”改成“phase timeline + phase-local message updates”。

## 6.2 页面读取链

1. 新建 `useTaskPhaseTimeline` 或等价 feature，作为 TaskDetail 主时间线唯一 persisted baseline。
2. 停止把 `useTaskMessageSnapshot` 作为默认主聊天入口。
3. `useTreeBranches` 保留 session tree 责任，但不再反向决定主聊天显示顺序。
4. 当前 page model 中与 parallel card 组装相关的主逻辑迁到 phase timeline feature。

建议起点文件：

1. [../../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)
2. [../../control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts](../../control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts)
3. [../../control-plane/web-ui/src/composables/useTreeBranches.ts](../../control-plane/web-ui/src/composables/useTreeBranches.ts)
4. [../../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts](../../control-plane/web-ui/src/composables/useTaskDetailParallelFlow.ts)

## 6.3 展示模型改造

1. 主时间线组件改为渲染 ordered phase blocks。
2. single phase block 渲染 mainline session 消息。
3. parallel phase block 渲染 candidate subviews，不再把 candidate 内容插回顶层 message list。
4. adopted parallel phase 只在 phase block 内标记 winner，不复制 winner message 到顶层主聊天。
5. 页面不再基于 current round 或 selected session 去猜“这一轮该显示谁”。

当前进展（2026-04-16）：

1. `TaskDetailV3MainPane` 已接入 ordered phase blocks 渲染分支，页面在存在 `phaseSlices` 时不再默认退回单一扁平 `ChatMessageList`。
2. `buildTaskDetailPhaseBlocks()` 已开始承担 phase 内局部排序职责，块内消息与 parallel card 按 `createdAt` 稳定排序。
3. `TaskDetailV3` 主面板 phase 路径已改为原生 `TaskDetailPhaseBlockList` renderer，不再复用嵌入式 `ChatMessageList`。
4. 当前 phase 的 live assistant / pending assistant 以及 realtime user/tool message patch 已开始直接并入 current phase block，不再只靠旧扁平主聊天路径或整段 snapshot refresh 才能看到最新内容。进一步地，`useTaskDetailParallelFlow()` 现已把 phase block overlay 从“只认 current phase”扩成“按 phaseId 分发”：已加载的非 current phase 也会基于该 phase 对应 session 的 patch history 回放 live assistant state，并把 phase-scoped user/tool patch 一并合进自己的 block。最新一刀又把 `useTaskMessageSnapshot.loadPhaseSlice()` 的 phase view sessions 下沉成 `liveSessionIds`，`useTaskDetailParallelFlow()` 会优先按这组 phase-local session ids 回放并合并 live assistant state，不再主要依赖 `resolvedSessionId` / 单 session phase 的前端启发式；因此 sequential-chain 这类一个 phase 对应多个 mainline/step session 的场景也能把 live overlay 收回自己的 block。
5. `useTaskMessageSnapshot()` 的 message-only refresh 已优先收成 current phase 局部 refresh；`task.message.persisted` / `task.round.synced` 的 ack 也会抬高目标 phase 的本地 revision floor，并把那次 ack 对应 phase 的 realtime user/tool patch 与已知 assistant 更新直接吸收进对应 phase slice——无论目标 phase 是不是当前 phase。现在这条 ack 吸收链已不再依赖 current-session `storeLatestPersistenceAck` 过滤，而是由 `useTaskDetailCoreContext` 直接顺序消费 task 级 persistence patch feed，并把事件原始 `phaseId` 原样传给 snapshot；当前 phase 已本地追平最新 `round-synced` ack 且没有 reconcileRequired 时，前端会直接跳过那次冗余 message-only refresh，继续减少必须整段 message snapshot 重拉才能完成 authority 切换的依赖。
6. 当前 parallel phase 的 candidate baseline 已开始直接来自 `/phases/:phaseId/view` 的 `messageGroups`，并且 phase baseline 存在时不再优先拿 compat session fallback 覆盖显示；phase DTO 现已把 per-candidate `timelineMeta(cacheState/complete/itemCount)` 一并带下，前端 baseline 可直接推导 trace-specific timeline completeness。对于 phase DTO 已给出可展示内容且 candidate session 已终态的场景，前端也会直接短路 compat trace fetch；running / pending / paused 这类 non-terminal candidate 的 traceState 说明也已优先从 phase baseline 直接给出。最新一刀又把这层逻辑从 `buildPhaseParallelCandidateStates()` 里抽成更明确的 `buildPhaseParallelCandidateBaselines()`：phase view 的 candidate items / hasSettledReply / traceState / skipTraceLoad 现在先作为 baseline 独立产出，再由 `useTaskDetailParallelFlow()` 接线到并行候选可视状态。这样 parallel card 首帧就能直接吃到 phase baseline 的 traceState，不必再等 compat trace fallback 或 session fallback 跑完才显示 `incomplete/stale`。旧 trace/session 读路由继续保留，但职责已进一步退为补充 `reconcileRequired`、极端 timeline gap、补缺和失败兜底。
7. 页面测试、组件测试以及 snapshot/flow/source-policy 单测已覆盖 phase slice 驱动的主面板 phase block 路径，证明当前页面能按 phase 顺序渲染多个 block，且 parallel candidate 交互、current-phase live assistant、current-phase realtime user/tool patch、phase-local message refresh/ack floor 都可用；`useTaskMessageSnapshot` 的 snapshot test 已补上 non-current phase ack 能直接把 overlay 吸收进历史 phase slice 且不再回流到当前 phase 的断言，`useTaskDetailCoreContext` 也新增了 task 级 patch feed 回归，明确验证“旧 phase 的 round-synced 不会因为 current-session store 过滤而丢失”；现在 `task-detail-phase-blocks` / `useTaskDetailParallelFlow` 也已补上非 current phase live assistant overlay 的回归，并新增 `liveSessionIds` / 多 session live overlay merge 的定向回归，以及 phase candidate baseline 提取与 parallel flow baseline traceState 接线的定向回归。最新一轮 TaskDetail 广义回归共 8 个文件、99 个测试通过。
8. 未完成项：parallel candidate 的最终展示仍保留一层 compat trace/source-policy 补强，但主要已收窄到 phase baseline 缺失、`reconcileRequired` / projection 未追平这类 trace-only 信号，以及失败兜底场景；phase-local persisted patch / update ownership 现已对所有已加载 phase slice 成立（不再只限 current phase），同一条 patch 只会落到 ack 对应的 phase 里，且跨 phase key 会在吸收前显式回避，避免历史 phase 的消息被误拷贝到别的 phase。live authority 这一侧剩余的债也进一步具体化了：TaskDetail phase blocks 已能按 phase 复用 session-scoped live replay，phase slice 也已拿到更稳定的 `liveSessionIds`，但共享 live assistant state manager 仍然是 `taskId + sessionId` 键空间，`assistant-progress` / `assistant-delta` / `assistant-completed` 仍未在共享层直接 phase-key 化；后续若要彻底 phase-local 化，还需要把这层 contract 继续推到 manager / patch consumer，而不是只停留在页面组合层。

建议起点文件：

1. [../../control-plane/web-ui/src/lib/task-detail-parallel-conversation-projector.ts](../../control-plane/web-ui/src/lib/task-detail-parallel-conversation-projector.ts)
2. [../../control-plane/web-ui/src/lib/task-detail-parallel-runtime.ts](../../control-plane/web-ui/src/lib/task-detail-parallel-runtime.ts)
3. TaskDetail main pane 和 conversation 展示相关组件

## 6.4 Realtime 与刷新策略

1. patch consumer 以 `phaseId` 为第一定位键。
2. `task.phase.*` 事件只触发对应 phase 的局部刷新或状态更新。
3. `task.message.*` 事件只更新 phase 内当前 session 的流式文本。
4. 移除“收到 session.activated 后再去猜是不是要全局刷新主聊天”的主路径依赖。

建议起点文件：

1. [../../control-plane/web-ui/src/lib/task-message-patch-event.ts](../../control-plane/web-ui/src/lib/task-message-patch-event.ts)
2. [../../control-plane/web-ui/src/lib/task-message-patch-effects.ts](../../control-plane/web-ui/src/lib/task-message-patch-effects.ts)
3. [../../control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts](../../control-plane/web-ui/src/composables/useTaskDetailSnapshotCoordinator.ts)

## 6.5 Web UI 验收

1. 真实页面中，single、parallel、adopted parallel、continue-after-adopt 都按 phase 顺序稳定显示。
2. 不再出现同一条模型回复在主聊天和并行卡中重复显示。
3. 不再出现最后一条用户 prompt 重复。
4. adoption 后无需手动刷新即可自动收敛。
5. 页面测试覆盖 `currentPhaseId != currentSessionId`、realtime 乱序、candidate 完成先于 phase update 到达等场景。

当前进展（2026-04-16）：

1. 页面级回归已覆盖 TaskDetailV3 phase block 主路径，并保留 parallel/history/current-session 相关断言；当前 `TaskDetailV3.test.ts` 文件内 68 个回归测试通过。
2. 底层针对性验证已覆盖 `task-message-patch-event`、`useTaskDetailParallelFlow`、`task-detail-phase-blocks` 三层，共 26 个单测通过，已证明 current-phase realtime user/tool patch 会被过滤后直接并入 phase block。
3. 仍需补的验收空白：基于真实 `useTaskMessageSnapshot` phase slice 装载链的更大范围整页断言，以及 message persisted / round synced 后更完整的 phase-local patch/update ownership 断言。

## 7. 兼容清理清单

当前主链切完后，再处理下面这些清理项：

1. 删除或降级 current-round 主链依赖。
2. 删除 parallel projector 中只服务 compat 读链的 suppression 逻辑。
3. 删除从 session activation 事件推断 phase 刷新的补丁桥接。
4. 为保留的 compat route 增加显式历史注记，避免继续被误当主路径。

## 8. 推荐实施批次

建议按四批执行：

1. 批次 A：service phase query + realtime contract。
2. 批次 B：BFF phase DTO + `/phases` 路由。
3. 批次 C：web-ui phase timeline 渲染和 realtime phase-local 更新。
4. 批次 D：compat 清理、测试补齐、旧 route 降级。

## 9. 一句话结论

这次改造的关键不是继续修 projector，而是让 service、BFF、web-ui 三层都围绕 `phaseId` 说同一种语言。只有这样，TaskDetail 的顺序和归属才能真正稳定。
