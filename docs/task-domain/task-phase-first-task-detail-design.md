# Task Phase-First TaskDetail 设计

> 状态：Proposed
> 日期：2026-04-16
> 作者：GitHub Copilot
>
> 关联文档：
> 1. [task-phase-first-schema-api-draft.md](task-phase-first-schema-api-draft.md)
> 2. [task-session-five-table-examples.md](task-session-five-table-examples.md)
> 3. [../task-detail/task-detail-display-write-logic.md](../task-detail/task-detail-display-write-logic.md)
> 4. [../task-detail/task-detail-realtime-event-contract.md](../task-detail/task-detail-realtime-event-contract.md)

## 1. 文档目的

本文把 TaskDetail 当前“并行卡片顺序错乱、用户 prompt 重复、采纳后显示不稳定”这类问题，正式收敛为一个领域设计问题，而不是前端投影 bug。

本文只回答四件事：

1. 当前页面为什么会乱。
2. `phase` 为什么必须成为任务详情页里的轮次 authority。
3. phase-first 下 TaskDetail、service、BFF、realtime 的主 contract 应该是什么。
4. 什么样的显示不变量，才能从结构上消掉“并行卡顶上来”和“同一条消息显示两次”。

本文不覆盖：

1. 具体代码改动细节。
2. 历史数据 backfill 方案。
3. 页面视觉稿。
4. 与 TaskDetail 无关的 task list / dashboard 读链改造。

## 2. 问题定义

当前 TaskDetail 的主要异常不是“单条消息内部顺序错了”，而是“同一轮执行内容被不同 authority 重复投影到了页面”。

已观察到的用户可见症状包括：

1. 并行卡片出现在顶层主聊天不该出现的位置。
2. 同一个用户 prompt 或模型回复在顶层主聊天和并行卡中各显示一次。
3. 采纳后不刷新时仍停留在 compare 状态，手动刷新后又恢复正常。
4. `currentPhaseId`、`currentSessionId`、`current-round`、parallel card 状态在短时间内给出不同答案。

这些症状说明当前页面并不是基于“一个稳定的轮次读模型”渲染，而是在拼接多个来源：

1. `/tasks/:taskId/sessions` 返回的 session 上下文与 `currentPhaseId`。
2. `/tasks/:taskId/current-round` 返回的当前 round 锚点。
3. `/tasks/:taskId/rounds/:roundId/messages` 返回的 round persisted baseline。
4. 前端对 parallel candidate、adoption、realtime patch 的二次投影。

只要这些来源在某个时刻没有完全对齐，页面就可能把同一份 phase 内容重复展示或错误插入。

## 3. 根因分析

### 3.1 当前主链混用了两类不同语义

当前实现同时混用了两套排序/归属语义：

1. lineage 语义：`parentSessionId`、`rootSessionId`、`sortKey`、active session。
2. phase 语义：`phaseId`、`phaseIndex`、`phaseRole`、`candidateIndex`、`winnerSessionId`。

lineage 适合回答“这个 session 是从哪里 fork/continue 出来的”。

phase 适合回答“这是任务的第几轮执行，这一轮有哪些 session，这一轮当前状态是什么”。

TaskDetail 主聊天要解决的是第二个问题，但当前主链仍然部分依赖第一个问题的答案。

### 3.2 页面已经拿到了 `currentPhaseId`，但没有以它作为主锚点

前端 session 上下文读取已经能拿到 `currentPhaseId`，但消息主链并没有直接以 `currentPhaseId` 读数据，而是继续走 `current-round -> round messages` 这条兼容路径。

这带来两个结构性后果：

1. 页面“知道当前 phase 是什么”，但主聊天不一定按这个 phase 渲染。
2. `current-round` 一旦通过 session 启发式选错，主聊天 persisted baseline 就会锚到错误 session。

### 3.3 `current-round` 仍然是 session-lineage 启发式，而不是 phase locator

当前 round facade 仍然要从 session lineage 和 active 状态里挑“当前 round”，它不是从 `task_snapshots.currentPhaseId` 直接定位 phase。

因此：

1. unresolved parallel 时，会存在“当前 phase 是 parallel phase，但 current-round 想回 mainline session”的兼容判断。
2. adopted parallel 时，会存在“winner session 已完成，但 round 仍在 compare-candidate 语义里”的短时分叉。
3. 页面只能通过更多 compat 规则去修正显示，而不是从一份 canonical phase 读模型直接得到答案。

### 3.4 同一份 phase 数据现在可能走两条渲染链

当前页面至少存在两条会消费同一份 phase 内容的路径：

1. 顶层主聊天 persisted baseline。
2. parallel card projector。

如果顶层主聊天已经锚到 candidate/winner session，而 parallel projector 又把相同 candidate session 组回并行卡，就会出现：

1. 相同模型回复在顶层和并行卡中各渲染一次。
2. synthetic candidate prompt 泄漏到主聊天，导致最后一条用户消息重复。

这不是渲染器缺少“去重 if”这么简单，而是读模型没有保证“一条消息只能属于一个 phase container”。

## 4. 设计结论

### 4.1 `phase` 是任务详情页的一轮对话

TaskDetail 主时间线的一级单位不再是 message，不再是 session，也不再是 current round。

一级单位必须是 phase block。

定义如下：

1. 一条 `task_execution_phases` 记录代表任务中的一轮执行。
2. 单轮 single 执行对应一个 single phase block。
3. 单轮 parallel 执行对应一个 parallel phase block。
4. sequential chain 的一个阶段组也对应一个 phase block。

页面先回答“这是第几轮”，再回答“这一轮有哪些 session、有哪些消息”。

### 4.2 TaskDetail 主时间线采用 phase-first，tree 继续采用 lineage-first

两个视图解决的问题不同，不应共享主排序语义：

1. task detail 主时间线：按 `phaseIndex` 排序。
2. session tree / branch tree：按 lineage 排序。

这两条链可以共存，但不能再让 lineage-first 结果反向决定主聊天的轮次顺序。

### 4.3 `currentPhaseId` 和 `currentSessionId` 的职责必须拆开

这两个指针在 parallel 阶段本来就不等价：

1. `currentPhaseId` 表示任务当前处于哪一轮。
2. `currentSessionId` 表示这轮里当前主线/锚点/焦点 session 是谁。

因此允许：

1. unresolved parallel 时，`currentPhaseId` 指向并行 phase，`currentSessionId` 仍指向 anchor session。
2. adopted parallel 后，`currentPhaseId` 仍指向该 parallel phase，`currentSessionId` 指向 winner session。

后续任何 API 或前端状态机，都不得再尝试把这两个字段压成一个“当前 round id”。

## 5. 目标显示模型

## 5.1 主时间线结构

TaskDetail 主时间线统一渲染为有序 phase blocks：

1. phase block 排序键固定为 `phaseIndex`。
2. 同一个 phase block 内只消费 `phaseId` 命中的 session 和消息。
3. 页面不得从相邻 phase 借消息补上下文。

### 5.2 single phase 的显示规则

single phase block 只展示该 phase 的 mainline session 内容。

规则：

1. 消息顺序按 session 内规范顺序展示。
2. 不额外插入 parallel card。
3. 不从 lineage ancestor 自动拼历史 phase 消息；历史只通过更早 phase block 展示。

### 5.3 parallel phase 的显示规则

parallel phase block 是一个独立容器，包含：

1. phase 头部信息：`phaseIndex`、状态、候选数、winner、anchor、judge 概览。
2. candidate subviews：每个 candidate session 的消息流。
3. 可选 judge subview。

关键规则：

1. 未采纳阶段，candidate session 的消息只能出现在 parallel phase block 内。
2. 已采纳阶段，winner 仍然属于该 parallel phase block，不得再复制一份到顶层主聊天单独渲染。
3. parallel phase block 可以突出 winner，但不能把 winner 复制为第二份 message list。

这条规则是消除“顶层一份、并行卡里再来一份”的核心。

### 5.4 adoption 后的时间线规则

adopt winner 不会把旧 parallel phase 重新改写成 single phase。

adoption 后：

1. 原 parallel phase 保持为一个已完成的 parallel phase block。
2. 该 phase 只更新 `winnerSessionId`、状态和展示标记。
3. 后续 continue 会基于 winner session 启动新的 phase。

也就是说，“采纳 winner”是完成一轮 phase，不是把 phase 内容再复制到主聊天后面。

## 6. 目标读模型与 API 合同

### 6.1 任务详情主读链

TaskDetail 主链改为：

1. 读 task 基本信息。
2. 读 phase timeline。
3. 按需读当前 phase 的详细消息视图。
4. realtime 只更新 phase 内局部状态，不再重新推断轮次归属。

当前 `current-round` 只允许作为兼容层存在，不再作为主聊天入口。

### 6.2 新的主接口

TaskDetail 主路径至少需要下面两类 phase-first 接口：

1. `GET /api/tasks/:taskId/phases`
   用途：返回按 `phaseIndex` 排序的 phase 列表和每个 phase 的成员 session 概览。
2. `GET /api/tasks/:taskId/phases/:phaseId/view`
   用途：返回单个 phase 的详细视图，包括 phase 元信息、session 列表、消息、judge 信息与状态。

如果需要更轻量的拆分，也可以分成：

1. `GET /api/tasks/:taskId/phases`
2. `GET /api/tasks/:taskId/phases/:phaseId/messages`
3. `GET /api/tasks/:taskId/phases/:phaseId/sessions`

但无论如何，主键都应该是 `phaseId`，而不是 round id、coordinationKey 或 active session id。

### 6.3 现有接口的边界调整

现有接口应收口为：

1. `/tasks/:taskId/sessions`
   责任：session lineage、session summaries、`currentPhaseId/currentSessionId` 元信息。
   不再负责为主聊天选 round。
2. `/tasks/:taskId/current-round`
   责任：兼容 locator，仅保留给旧调用方。
   不再作为 TaskDetail 主聊天 authority。
3. `/tasks/:taskId/rounds/:roundId/messages`
   责任：兼容读取口。
   新 TaskDetail 主链不再依赖它。
4. `/tasks/:taskId/messages`
   责任：兼容 task-wide conversation 读取。
   不再承担 parallel block 组装 authority。

## 7. 目标实时合同

### 7.1 基本原则

realtime 合同必须把“消息流式内容”和“执行轮次状态”拆成两条线：

1. `task.message.*` 只负责流式消息内容。
2. `task.phase.*` 只负责轮次状态和 phase 结构变化。

两类事件都必须显式携带 `phaseId`。

### 7.2 必需事件

至少需要下面这些 phase 级事件：

1. `task.phase.created`
2. `task.phase.updated`
3. `task.phase.awaiting_adoption`
4. `task.phase.completed`
5. `task.phase.failed`
6. `task.phase.cancelled`
7. `task.phase.resumed`

消息事件也应带：

1. `taskId`
2. `phaseId`
3. `sessionId`
4. `messageId`
5. 版本或时间戳字段

### 7.3 前端消费规则

前端只遵守下面的消费规则：

1. `task.message.delta` 只更新对应 phase 内、对应 session 的流式文本。
2. `task.message.updated` 只更新对应 phase 内的 message item。
3. `task.phase.*` 事件触发对应 phase 的状态刷新或局部重拉。
4. 页面不得再通过 `sessionId + coordinationKey` 反推 parallel group。
5. 页面不得再通过“消息停了 + current-round 变了”去猜 adoption 或 completed。

## 8. 显示不变量

TaskDetail phase-first 方案必须满足下面这些硬性不变量。

### 8.1 归属不变量

1. 每条 message 只属于一个 session。
2. 每个 session 只属于一个 phase。
3. 每条 message 在页面主时间线上只允许出现在一个 phase container 中。

### 8.2 顺序不变量

1. phase block 只按 `phaseIndex` 排。
2. phase 内 session 只按 `phaseRole + phaseItemIndex/candidateIndex/stepIndex` 排。
3. session 内消息只按规范消息顺序排。
4. 页面不得再基于 DOM 当前顺序或事件到达顺序做最终排序。

### 8.3 刷新不变量

1. 当前 phase 的 realtime 更新只影响当前 phase。
2. 非当前 phase 不会因为一个 candidate patch 被重新投影到顶层。
3. adoption 只更新对应 parallel phase 的状态，不会把 winner 复制成新的顶层 message group。

### 8.4 兼容不变量

1. tree 视图继续可用，但不再反向驱动主时间线。
2. legacy round API 可保留，但不再是 TaskDetail 主读链。
3. phase 数据缺失的历史任务，不进入新的主链保证范围，需显式走 compat 或被隔离。

## 9. 写路径要求

为了让读模型稳定，写路径必须保证下面这些事实一致：

1. 任何新一轮执行都先创建或更新 `task_execution_phases`。
2. `task_sessions.phaseId` 必须在 session 创建时就落稳，不能事后推断。
3. adopt winner 只更新 parallel phase 的 `winnerSessionId/status` 和 snapshot 指针，不复制消息。
4. continue from winner 只能创建新的 phase，不能把后续消息附着到旧 phase 上。
5. `task_snapshots.currentPhaseId/currentSessionId/latestPhaseId/latestSessionId` 必须由同一条事实写链维护，不能分散到多个 compat 写入口各自修补。

## 10. 迁移原则

### 10.1 主链 hard-cut，兼容链保留但降级

目标形态是：TaskDetail 主链 hard-cut 到 phase-first。

允许过渡期保留 compat 接口，但只允许：

1. 服务旧调用方。
2. 作为 debug/核验工具。

不允许继续让 compat round 读链参与新的主聊天渲染。

### 10.2 先冻结 contract，再拆实现

代码改造前，应先冻结下面这些 contract：

1. phase DTO shape。
2. phase timeline 的排序语义。
3. adoption 后 winner 的唯一展示策略。
4. realtime 事件必须带 `phaseId` 的要求。

没有先冻结 contract，就继续改 projector 或 mapper，只会继续制造新的兼容分叉。

## 11. 验收标准

当下面条件全部满足时，才能认为 TaskDetail phase-first 改造完成：

1. 新 TaskDetail 主链不再依赖 `/current-round` 作为消息入口。
2. 并行卡不再从 session lineage 或 coordinationKey 推断，而是直接从 phase DTO 渲染。
3. 单个 parallel phase 中，无论 pending、adopted、completed，候选消息都只在 phase block 内出现一次。
4. 顶层主时间线中不再出现“候选消息上浮到主聊天”的情况。
5. adoption 后无需手动刷新，页面即可稳定从待采纳态收敛到已采纳态。
6. `currentPhaseId` 和 `currentSessionId` 的展示职责清晰，测试中显式覆盖二者不相等的场景。
7. 页面排序测试不再依赖“当前 active session 恰好等于当前显示轮次”的隐含假设。

## 12. 一句话结论

TaskDetail 当前之所以容易乱，不是因为少了几条 suppression 规则，而是因为它还没有真正采用 phase-first 主语义。

要从根上解决顺序错乱和重复显示，必须把 `phase` 提升为任务详情页唯一的轮次 authority，让主时间线、BFF DTO、实时事件和页面刷新都围绕 `phaseId` 收口。