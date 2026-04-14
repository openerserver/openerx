# TaskDetail 消息状态机与 Realtime Patch 实施文档

> 状态：Draft v1，目标状态机文档
> 日期：2026-03-29
> 作者：GitHub Copilot
> 关联文档：[task-session-message-minimal-contract.md](task-session-message-minimal-contract.md)、[task-session-message-service-route-dto-draft.md](task-session-message-service-route-dto-draft.md)、[task-session-message-roundtrip-target-plan.md](task-session-message-roundtrip-target-plan.md)、[task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)

## 0. 文档定位

这份文档属于“未来目标状态机文档”，但开头已经补了当前实现映射，避免把现网行为和目标 reducer 混写。

1. 当前实现：TaskDetailV3 主聊天已经由 `useTaskMessageSnapshot` + `useTaskMessageStore` 组合，页面不再直接 merge `realtime.events[]`。
2. 未来目标：把现网已落地的模式继续固定成标准 state slice、状态机与 patch 规则，作为后续删兼容层的目标口径。
3. 阅读建议：先读第 4 节确认现网，再从第 5 节开始把后文视为目标状态机设计；如果要对齐事件字段，再接着看 [task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)。

## 1. 文档目的

这份文档定义 TaskDetail 页在最小消息 contract 下的前端实施方案，只聚焦两件事：

1. 本地状态机应该如何组织
2. realtime 事件应该如何 patch 本地状态

目标不是复用当前页面的兼容逻辑，而是给出一个可以直接落到 Vue + Pinia + composable 的稳定实现口径。

## 2. 适用范围

这份文档只覆盖最小闭环：

1. 单 task
2. 单 active session
3. 用户发送 1 条消息
4. assistant 返回 1 条流式回复
5. 页面可刷新恢复
6. realtime 断线可重连

这份文档暂不覆盖：

1. parallel candidate 比较块
2. session tree 切换历史
3. judge / hook 独立 message 流
4. 多 tab 协同冲突解决

## 3. 总体原则

### 3.1 真源原则

1. 页面初始数据只来自数据库读接口
2. realtime 只做增量 patch
3. 任意时刻重新 GET messages，都必须能恢复完整页面状态

### 3.2 本地状态原则

1. TaskDetail 不应直接拿 `realtime.events[]` 原始数组当消息真相
2. TaskDetail 应维护自己的标准化消息状态
3. realtime 事件进入页面后，应先经过 reducer，再写入本地状态

### 3.3 恢复原则

1. websocket 断开不会清空页面消息
2. websocket 重连后先静默 reconcile，再继续收流
3. 刷新后从 GET messages 恢复，而不是请求底层 runtime replay

## 4. 当前实现映射与仍需纠偏的方向

当前前端里，TaskDetailV3 的主聊天读链已经收敛为：

1. 先由 `useTaskMessageSnapshot` 读取 active round 的持久化消息
2. 再由 `useTaskMessageStore` 接收 `task.message.*` patch、pending assistant 与 reconcile 状态
3. 最后由 store 统一产出页面消息列表

相关入口包括：

1. [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue)
2. [control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts](../control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts) 与 [control-plane/web-ui/src/composables/useTaskMessageStore.ts](../control-plane/web-ui/src/composables/useTaskMessageStore.ts)
3. [control-plane/web-ui/src/stores/realtime.ts](../control-plane/web-ui/src/stores/realtime.ts)
4. [control-plane/web-ui/src/lib/message-normalize.ts](../control-plane/web-ui/src/lib/message-normalize.ts)

这套模式已经接近目标实现，但后续仍应继续保持：

1. 初始 GET messages 建立本地实体状态
2. 之后只接受标准化 `task.message.*` 事件做 patch
3. 原始 `realtime.events[]` 只作为调试缓存，不再参与页面主渲染归并

## 5. 建议的前端状态切片

TaskDetail 页建议拆成 5 个本地状态切片。

## 5.1 `pageState`

负责页面整体加载与恢复状态。

```ts
type PageLoadState = "idle" | "loading" | "ready" | "reloading" | "error";

interface TaskDetailPageState {
  taskId: string;
  sessionId: string;
  loadState: PageLoadState;
  errorText?: string;
  lastLoadedAt?: string;
  needsReconcile: boolean;
}
```

## 5.2 `composerState`

负责输入框、提交按钮、optimistic message 和发送错误。

```ts
type ComposerState = "idle" | "submitting" | "waiting-assistant" | "error";

interface TaskDetailComposerState {
  draftText: string;
  sendState: ComposerState;
  pendingClientMessageId?: string;
  errorText?: string;
}
```

## 5.3 `connectionState`

负责 websocket 连接状态和重连后的 reconcile 触发。

```ts
type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stale";

interface TaskDetailRealtimeState {
  connectionState: ConnectionState;
  lastEventAt?: string;
  lastReconnectAt?: string;
}
```

## 5.4 `messageState`

这是页面最关键的状态切片，必须是 normalized entity store。

```ts
type MessageLocalStatus =
  | "optimistic"
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

interface TaskDetailMessagePartState {
  id: string;
  partIndex: number;
  partType: "text" | "tool_call" | "tool_result";
  text: string;
  jsonPayload: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  finalizedAt?: string | null;
}

interface TaskDetailMessageState {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  localStatus: MessageLocalStatus;
  messageIndex?: number;
  text: string;
  summaryText?: string | null;
  clientMessageId?: string | null;
  providerMessageId?: string | null;
  errorText?: string | null;
  parts: TaskDetailMessagePartState[];
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  optimistic: boolean;
  provisional: boolean;
}

interface TaskDetailMessageStoreState {
  orderedMessageIds: string[];
  messageById: Record<string, TaskDetailMessageState>;
  messageIdByClientMessageId: Record<string, string>;
}
```

## 5.5 `operationState`

负责“当前是否在执行”“当前 token / cost”“最后一次失败原因”等辅助信息。

```ts
interface TaskDetailOperationState {
  id: string;
  kind: "model_request" | "tool_call";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  providerId?: string | null;
  modelId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  updatedAt?: string;
}

interface TaskDetailOperationStoreState {
  operationById: Record<string, TaskDetailOperationState>;
  latestOperationId?: string;
}
```

## 6. 页面状态机

TaskDetail 不需要一台大而全的巨型状态机，而应拆成 4 台小状态机。

## 6.1 页面加载状态机

```text
idle
  -> loading
  -> ready
  -> reloading
  -> ready
  -> error
```

### 进入 `loading`

1. 首次进入任务页
2. taskId 变化
3. sessionId 变化

### 进入 `reloading`

1. websocket 重连后需要 reconcile
2. 收到未知 message 的 realtime 事件
3. 收到顺序异常事件

### 进入 `error`

1. 初始 GET messages 失败
2. 必要 task/session 读接口失败

## 6.2 composer 状态机

```text
idle
  -> submitting
  -> waiting-assistant
  -> idle

idle
  -> submitting
  -> error
  -> idle
```

### `idle`

1. 用户可输入
2. 发送按钮可用

### `submitting`

1. 已创建 optimistic user bubble
2. 正在等待 POST messages ack

### `waiting-assistant`

1. user message 已被服务端接收
2. assistant placeholder 已存在或即将出现
3. 页面等待 `task.message.created` 或 `task.message.delta`

### `error`

1. POST messages 失败
2. optimistic message 应显示失败态

## 6.3 assistant message 状态机

每条 assistant message 独立运行以下状态机：

```text
pending
  -> streaming
  -> completed

pending
  -> failed

streaming
  -> failed

streaming
  -> cancelled
```

### 解释

1. `pending`：服务端已创建 placeholder，但还没收到第一段文本
2. `streaming`：已经收到至少一段文本 delta
3. `completed`：已收到完成事件并封账
4. `failed`：生成失败
5. `cancelled`：用户或系统取消

## 6.4 realtime 连接状态机

```text
disconnected
  -> connecting
  -> connected
  -> reconnecting
  -> connected

connected
  -> stale
  -> reconnecting
```

### 进入 `stale`

1. 页面显示 assistant 正在 `streaming`
2. 但超过阈值时间没有任何新事件

建议阈值：

1. 普通消息流：10 秒
2. 长工具调用场景：20 秒

`stale` 不是失败态，它的作用只是提示页面应该做一次静默 reconcile。

## 7. 初始化流程

TaskDetail 页面初始化建议顺序如下：

1. 读取 task 基本信息
2. 确定 active session id
3. 调 `GET /tasks/:taskId/sessions/:sessionId/messages`
4. 用返回值建立 `messageState`
5. 建立 `operationState` 和页面顶部摘要状态
6. 连接 websocket
7. 订阅当前 task 或当前 session
8. 页面进入 `ready`

注意：

1. 先建数据库快照，再接 realtime
2. 不要先连 realtime 再等初始消息列表
3. 否则很容易把“流式中间态”错当成完整历史

## 8. 发送消息流程

## 8.1 用户点击发送

前端应执行以下步骤：

1. 生成 `clientMessageId`
2. 在本地插入 1 条 `optimistic user message`
3. `composerState.sendState = submitting`
4. 调 `POST /tasks/:taskId/sessions/:sessionId/messages`

## 8.2 POST 成功

收到成功响应后，前端应立即：

1. 用服务端 `user_message.id` 替换 optimistic user message
2. 把该 user message 标记为 `completed`
3. upsert `assistant_message`
4. upsert `operation`
5. `composerState.sendState = waiting-assistant`
6. 清空输入框

## 8.3 POST 失败

如果 POST 失败：

1. optimistic user message 标成 `failed`
2. `composerState.sendState = error`
3. 保留用户原始输入，允许重发

## 9. Realtime Patch 规则

这一节是文档核心。所有 realtime 事件进入页面后，必须走统一 reducer：

```ts
function applyTaskDetailRealtimePatch(
  state: TaskDetailMessageStoreState,
  event: TaskMessageRealtimeEvent,
): TaskDetailMessageStoreState
```

不要在组件里直接散落 `if (event.type === ...)` 式局部改状态。

## 9.1 通用预处理规则

任何事件进入 reducer 之前，都先执行这 6 条检查：

1. `task_id` 不匹配当前 task，直接忽略
2. `session_id` 不匹配当前 active session，直接忽略
3. `event.id` 已处理过，直接忽略
4. payload 缺 `message_id` 或关键字段不完整，记录诊断并触发静默 refetch
5. 如果事件时间戳明显早于当前消息 `updatedAt`，按过期事件忽略
6. 如果事件把 terminal message 改回 streaming，直接忽略

## 9.2 `task.message.created`

### 9.2 patch 规则

1. 若 `message.id` 不存在，插入新消息
2. 若已存在，按“单调字段 merge”更新
3. 若存在同 `clientMessageId` 的 optimistic user message，做 id 替换合并
4. assistant message 创建后，若状态为 `pending`，页面应显示“生成中”但正文可为空

### 顺序规则

1. 优先按 `message_index` 插入
2. 若缺少 `message_index`，临时按 `created_at` 放到尾部
3. 缺少两者都不是致命错误，但必须标记 `needsReconcile = true`

## 9.3 `task.message.delta`

### 9.3 patch 规则

1. 若目标 assistant message 不存在，创建 1 条 provisional assistant message
2. `localStatus` 设为 `streaming`
3. 优先使用 `full_text` 覆盖正文
4. 若只有 `delta_text`，再按追加规则 merge
5. upsert 对应 text part
6. 更新 `updatedAt`
7. 清除 `composerState.waiting-assistant`

### 文本 merge 规则

推荐顺序：

1. 若 payload 有 `full_text`，直接信任 `full_text`
2. 若没有 `full_text`，且 `delta_text` 非空，则 append
3. 若 append 后出现重复尾巴，可做轻量去重

页面不应该只靠 `delta_text` 去盲拼全量正文，只要后端已经给了 `full_text`，应始终优先以 `full_text` 为准。

### provisional 规则

如果先收到 delta，后收到 created：

1. provisional message 先继续展示
2. created 到达后，把 provisional 转成正式 message
3. 如果 created 数据和本地 provisional 冲突，以 created 的主字段为准，正文仍保留更长的 `full_text`

## 9.4 `task.message.completed`

### 9.4 patch 规则

1. 若消息不存在，创建 provisional completed message
2. 状态设为 `completed`
3. `completedAt` 写入
4. `text` 用 `full_text` 最终覆盖
5. 所有 text part 标记 finalized
6. 若该消息是当前等待中的 assistant，则 composer 相关等待态复位到 `idle`

### 额外动作

1. 触发底部自动滚动，但只在用户接近底部时执行
2. 若页面处于 `stale`，收到 completed 后应立刻恢复为正常 connected 状态

## 9.5 `task.message.failed`

### 9.5 patch 规则

1. 若消息不存在，创建 provisional failed message
2. 状态设为 `failed`
3. 写入 `errorText`
4. 若正文已有部分文本，不要清空
5. composerState 从 `waiting-assistant` 回到 `idle`

### 展示规则

1. 已生成的部分 assistant 文本仍保留
2. 失败原因显示在消息卡片附属区，不混入正文

## 9.6 `task.operation.updated`

### 9.6 patch 规则

1. upsert operation
2. 若状态为 `running`，页面头部和 composer 显示“执行中”
3. 若状态转为 terminal，则更新 token / cost 展示
4. operation 更新不直接改写 message 文本

## 9.7 `task.snapshot.updated`

### 9.7 patch 规则

1. 更新 header 区的 task status、lastActivityAt、currentSessionId
2. 不直接替代 message state
3. 如果 snapshot 指向的 `current_session_id` 已变化，而页面还在旧 session，标记 `needsReconcile`

## 10. Silent Reconcile 规则

遇到下面任一条件，都应触发静默 `GET messages`：

1. websocket 从断线恢复到 connected
2. 收到 unknown message 的 completed / failed 事件
3. 收到缺少 `message_index` 且顺序无法判断的 created 事件
4. 页面进入 `stale`
5. 发送消息成功后，超过 2 秒仍未看到 assistant created 或 delta

静默 reconcile 的规则：

1. 不显示全页 loading
2. 保留当前本地消息列表
3. 用服务端列表做 authoritative merge
4. 合并后清除 provisional / optimistic 残留

## 11. 数据合并规则

从服务端重新 GET messages 后，建议按以下顺序合并：

1. 以服务端 message id 为主键
2. 若本地有 optimistic user message 且 `clientMessageId` 对上，则替换成本地正式 id
3. 若本地有 provisional assistant message 而服务端已有同 `message_index` 或同 `providerMessageId` 的正式消息，则吸收本地更长正文后，用服务端主记录替换
4. terminal message 以服务端状态为准
5. `parts` 以服务端为主，本地未落库内容只在服务端缺失时短暂保留

## 12. 建议的前端实现形状

建议拆成 3 层，而不是把逻辑都塞进页面组件。

## 12.1 composable 层

建议新增：

1. `useTaskDetailMessageState.ts`
2. `useTaskDetailRealtimePatches.ts`

职责：

1. `useTaskDetailMessageState`：拉初始数据、持有 normalized state、暴露页面 computed
2. `useTaskDetailRealtimePatches`：订阅 realtime store，调用 reducer patch 本地状态

## 12.2 reducer 层

建议新增纯函数：

1. `task-detail-message-reducer.ts`
2. `task-detail-message-reconcile.ts`

职责：

1. reducer：处理单个 realtime event
2. reconcile：处理服务端全量消息列表与本地 state 的 authoritative merge

## 12.3 页面层

`TaskDetail` 或 `TaskDetailV3` 页面只做：

1. 绑定 taskId / sessionId
2. 调 composable
3. 渲染 header / messages / composer
4. 响应用户交互

页面层不应直接：

1. 手写事件去重
2. 手写 delta 拼接
3. 手写 optimistic -> server message 替换
4. 手写 reconnect reconcile

## 13. 推荐的 computed 输出

提供给页面的最小 computed 建议如下：

```ts
interface UseTaskDetailMessageStateResult {
  messages: ComputedRef<TaskDetailMessageState[]>;
  isInitialLoading: ComputedRef<boolean>;
  isReconnecting: ComputedRef<boolean>;
  isStreaming: ComputedRef<boolean>;
  canSend: ComputedRef<boolean>;
  composerState: Ref<TaskDetailComposerState>;
  sendMessage: (text: string) => Promise<void>;
  reconcileMessages: (reason: string) => Promise<void>;
}
```

## 14. UI 规则

## 14.1 消息列表

1. optimistic user message 使用弱化样式
2. pending assistant 显示固定占位，例如“正在生成...”
3. streaming assistant 只做纯文本展示
4. completed assistant 才进入 markdown / 富文本渲染

## 14.2 自动滚动

1. 只在用户接近底部时自动滚动
2. streaming 期间只滚消息容器，不滚全页
3. 若用户已经向上滚动，则停止自动滚动

## 14.3 断线与恢复

1. `reconnecting` 时页面保留现有消息
2. 头部显示“实时连接恢复中”
3. 重连成功后不闪全页 loading，只做 silent reconcile

## 15. 一句话总结

TaskDetail 页的目标前端实现，不应再是“持久化消息 + 原始 realtime 事件日志临时拼接”，而应是：

1. 用数据库消息列表初始化本地 normalized store
2. 用统一 reducer 消化 `task.message.*` 事件
3. 用 silent reconcile 处理断线、乱序和缺口
4. 页面组件只消费标准化 state，不直接处理 raw realtime 事件

这样 TaskDetail 才能在 streaming、刷新恢复、断线重连和后续 session 扩展上保持稳定，而不会继续积累 compat 风格的页面内 patchwork。
