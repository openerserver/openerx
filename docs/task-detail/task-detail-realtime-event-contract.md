# TaskDetail Realtime Event Contract

> 状态：Draft v2，未来稳定 public contract
> 日期：2026-04-12
> 作者：GitHub Copilot
> 关联文档：[task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md)、[task-detail-message-state-machine-plan.md](task-detail-message-state-machine-plan.md)、[task-session-message-service-route-dto-draft.md](../task-domain/task-session-message-service-route-dto-draft.md)、[task-detail-realtime-broadcaster-mapper-draft.md](task-detail-realtime-broadcaster-mapper-draft.md)

## 0. 文档定位

这份文档是 TaskDetail realtime 的“未来稳定 public contract”，不是现网所有事件都已完全对齐的事实描述。

1. 当前实现：`task.message.persisted`、`task.round.synced`、`task.reconcile.required` 已在主聊天链路中落地，TaskDetailV3 也已经以 task-domain patch 为主消费 realtime。
2. 未来目标：把 service / BFF / Web UI 全部收敛到这里定义的 public DTO，彻底隔离 runtime 原始 SSE 与页面主逻辑。
3. 阅读建议：先看 [task-detail-realtime-persisted-coordination-plan.md](task-detail-realtime-persisted-coordination-plan.md) 理解为什么需要这套 contract，再把本文当成对外 DTO 规范；如果要继续做服务端出口收口，再接 [task-detail-realtime-broadcaster-mapper-draft.md](task-detail-realtime-broadcaster-mapper-draft.md)。

## 1. 文档目的

这份文档定义 service broadcaster 到 web-ui 的完整 realtime event DTO contract。

目标只有一个：

**把 web-ui 应消费的稳定 realtime 协议和 BFF / service 内部原始事件彻底分开。**

这份 contract 一旦确定，前后端都按这里实现：

1. service broadcaster 只广播这里定义的 public DTO
2. web-ui 只消费这里定义的 public DTO
3. OpenCode runtime 原始 SSE、BFF 内部 agent 事件、compat `message.updated` 事件都不再直接暴露给页面主逻辑

## 2. 适用范围

这份 contract 只定义 TaskDetail 及同类任务页需要的稳定实时事件，不覆盖整个系统的所有页面。

本期覆盖：

1. websocket 控制帧
2. 任务摘要更新
3. task-domain message patch 与 persisted ack
4. operation 更新
5. runtime permission 更新
6. workflow stage 更新
7. target-specific reconcile 事件

本期不覆盖：

1. 原始 runtime `session.*` / `message.updated` / `tool.execute.*`
2. agent console 的低层调试事件
3. 非任务页专属的全局监控大盘专用聚合事件

## 3. 关键设计决策

### 3.1 Public realtime DTO 不等于内部 runtime 事件

当前仓库里，BFF 会把 OpenCode runtime 的原始 SSE 事件映射成 `message.updated`、`tool.execute.before`、`agent.completed` 等事件再广播给前端。这种方式不适合作为长期 public contract。

目标口径是：

1. 原始 runtime 事件只在 service/BFF 内部流转
2. broadcaster 对外只发 task-domain 语义的稳定 DTO
3. web-ui 不再解析 runtime payload 细节，例如 `data.rawType`、`data.info`、`data.part`

### 3.2 WS contract 使用 camelCase

REST 接口可以继续使用 snake_case，但 websocket contract 建议统一使用 camelCase，原因如下：

1. broadcaster 和 web-ui 都是 TypeScript 直接消费
2. 前端 reducer 处理 camelCase 成本更低
3. 当前 `stores/realtime.ts` 已经是 camelCase top-level 形状

### 3.3 广播的是 authoritative patch，不是原始日志

每条 event 都必须满足：

1. 能够直接 patch 前端 normalized state
2. 即使 websocket 丢包，重新 GET REST 也能恢复一致
3. 不要求前端理解底层 executor 协议

### 3.4 必须有 escape hatch

任何实时系统最终都需要一个正式的“请重拉一次”的信号。因此本 contract 保留：

1. `task.reconcile.required`

它的 `scope` 必须直接对应前端 refresh target：`messages`、`flow`、`workflow`、`task`，而不是继续混用页面层术语。

前端收到后，只需要 silent refetch，不需要猜测怎么修补未知缺口。

## 4. 传输层协议

## 4.1 WebSocket endpoint

```text
GET /ws?token=<jwt>
```

认证仍由 JWT 完成。认证方式不是这份文档的重点，但它影响控制帧和订阅权限语义。

## 4.2 Client -> Server 控制命令

建议 web-ui 只发下面 5 类命令：

```ts
export type RealtimeClientCommand =
  | {
      type: "subscribe.task";
      taskId: string;
    }
  | {
      type: "unsubscribe.task";
      taskId: string;
    }
  | {
      type: "subscribe.project";
      projectId: string;
    }
  | {
      type: "unsubscribe.project";
      projectId: string;
    }
  | {
      type: "ping";
      clientTime: string;
    };
```

说明：

1. `subscribe.task` 是 TaskDetail 页主订阅命令
2. `subscribe.project` 适合 MultiTaskMonitor 这类项目级面板
3. `unsubscribe.*` 允许页面切换时释放不再需要的订阅
4. `ping` 只用于连接存活与时钟诊断

## 4.3 Server -> Client 控制帧

控制帧不是领域事件，不应进入页面业务 reducer。

```ts
export type RealtimeControlFrame =
  | {
      frameKind: "control";
      type: "connection.ready";
      connectionId: string;
      serverTime: string;
      schemaVersions: [1];
    }
  | {
      frameKind: "control";
      type: "subscription.confirmed";
      scope: "task" | "project";
      targetId: string;
      serverTime: string;
    }
  | {
      frameKind: "control";
      type: "subscription.rejected";
      scope: "task" | "project";
      targetId: string;
      errorCode: "unauthorized" | "not_found" | "invalid_request";
      message: string;
      serverTime: string;
    }
  | {
      frameKind: "control";
      type: "pong";
      serverTime: string;
    };
```

web-ui store 必须：

1. 处理控制帧
2. 但不要把控制帧放进 task 页面事件列表

## 5. Domain Event Envelope

所有 task 领域 realtime event 统一用同一个 envelope。

```ts
export interface TaskRealtimeEventEnvelope<
  TType extends TaskRealtimeEventType,
  TPayload,
> {
  frameKind: "domain";
  schemaVersion: 1;
  eventId: string;
  type: TType;
  occurredAt: string;
  projectId: string;
  taskId: string;
  sessionId?: string;
  ordering: {
    taskSequence: number;
    sessionSequence?: number;
  };
  payload: TPayload;
}
```

## 5.1 字段语义

1. `frameKind`：区分 control frame 和 domain event
2. `schemaVersion`：当前固定为 `1`
3. `eventId`：全局唯一，用于去重
4. `type`：稳定事件名
5. `occurredAt`：服务端确认该事件的时间
6. `projectId`：project 范围广播过滤主键
7. `taskId`：task 范围广播过滤主键
8. `sessionId`：session 范围 patch 的目标；非 session 事件可以省略
9. `ordering.taskSequence`：同一 task 内单调递增
10. `ordering.sessionSequence`：同一 session 内单调递增；非 session 事件可省略
11. `payload`：事件专属 DTO

## 5.2 顺序与幂等要求

1. 前端必须以 `eventId` 去重
2. 前端可以用 `taskSequence` / `sessionSequence` 检测乱序与缺口
3. 如果检测到缺口，不做复杂补丁，直接触发 silent reconcile

## 6. 共享子 DTO

```ts
export type TaskMessageRole = "user" | "assistant" | "tool" | "system";

export type TaskMessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskOperationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskMessagePartType = "text" | "toolCall" | "toolResult";

export interface TaskRealtimeMessagePartDto {
  id: string;
  partIndex: number;
  partType: TaskMessagePartType;
  text: string;
  finalizedAt?: string | null;
}

export interface TaskRealtimeMessageDto {
  id: string;
  role: TaskMessageRole;
  status: TaskMessageStatus;
  messageIndex: number;
  text: string;
  summaryText?: string | null;
  clientMessageId?: string | null;
  providerMessageId?: string | null;
  errorText?: string | null;
  parts: TaskRealtimeMessagePartDto[];
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRealtimeOperationDto {
  id: string;
  kind: "modelRequest" | "toolCall";
  status: TaskOperationStatus;
  providerId?: string | null;
  modelId?: string | null;
  sourceMessageId?: string | null;
  targetMessageId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  errorText?: string | null;
  updatedAt: string;
}

export interface TaskRealtimeSnapshotDto {
  lifecycleStatus: "pending" | "running" | "completed" | "failed" | "cancelled";
  currentExecutionStatus?: "queued" | "running" | "completed" | "failed" | "cancelled";
  currentSessionId?: string | null;
  latestMessageId?: string | null;
  lastActivityAt: string;
}

export interface TaskRealtimeRuntimePermissionDto {
  id: string;
  sessionId: string;
  permissionKey: string;
  path?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string | null;
}

export interface TaskRealtimeWorkflowStageDto {
  stageKey: string;
  stageLabel?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string | null;
  finishedAt?: string | null;
}

export type TaskRealtimeRefreshScope = "messages" | "flow" | "workflow" | "task";

export type TaskRealtimeReconcileReason =
  | "sequence_gap"
  | "alias_miss"
  | "projection_rebuilt"
  | "snapshot_lag"
  | "internal_repair";
```

## 7. 稳定事件集合

下面这些事件组成 TaskDetail 页完整 public contract。

## 7.1 `task.snapshot.updated`

作用：刷新 header、执行状态、当前 session 指针。

```ts
export type TaskSnapshotUpdatedEvent = TaskRealtimeEventEnvelope<
  "task.snapshot.updated",
  {
    snapshot: TaskRealtimeSnapshotDto;
  }
>;
```

约束：

1. 任何 task status 变化后都应该发
2. `currentSessionId` 变化也应该发
3. 它不替代 message event，只更新页面摘要层

## 7.2 `task.message.updated`

作用：广播某条消息当前 authoritative 状态。它既可以表示 assistant 首条占位，也可以表示 streaming 中的完整快照，或终态封账后的最终 message 形状。

```ts
export type TaskMessageUpdatedEvent = TaskRealtimeEventEnvelope<
  "task.message.updated",
  {
    roundId?: string;
    taskSessionId?: string;
    reason: "message.updated";
    message: TaskRealtimeMessageDto;
  }
>;
```

约束：

1. 这是单条 message 的 authoritative patch，不是 persisted authority 的确认信号。
2. `message.status` 可以是 `pending`、`streaming`、`completed`、`failed`、`cancelled`，页面不得再从事件名猜“是否已经结束”。
3. 即使 `message.status = completed`，前端也不能仅凭这一条事件认定 canonical snapshot 已追平。

## 7.3 `task.message.delta`

作用：给 assistant message 持续追加流式文本。

```ts
export type TaskMessageDeltaEvent = TaskRealtimeEventEnvelope<
  "task.message.delta",
  {
    roundId?: string;
    taskSessionId?: string;
    messageId: string;
    partType: "text";
    deltaText: string;
    fullText?: string;
    updatedAt?: string;
  }
>;
```

约束：

1. 如果 `fullText` 存在，前端应优先信任 `fullText`；`deltaText` 只是性能优化。
2. delta 事件只能用于 `assistant` message。
3. delta 不能单独承担 persisted 切换语义。

## 7.4 `task.message.persisted`

作用：告诉前端某条 message 已完成 canonical 写入，但这仍然只是 message-level ack，不等价于整轮 snapshot 已追平。

```ts
export type TaskMessagePersistedEvent = TaskRealtimeEventEnvelope<
  "task.message.persisted",
  {
    roundId: string;
    taskSessionId: string;
    messageId: string;
    persistedRevision: number;
    snapshotVersion?: number;
    persistedThroughRevision?: number;
  }
>;
```

约束：

1. 这条事件只负责 message-level ack，不直接触发 persisted text 接管。
2. `persistedRevision` 必须单调不减。
3. 如有 `snapshotVersion` / `persistedThroughRevision`，其语义必须与 REST snapshot 字段保持一致。

## 7.5 `task.round.synced`

作用：告诉前端某一轮 persisted snapshot 已至少追平到哪个 revision，这是主聊天 messages refresh 的正式边界。

```ts
export type TaskRoundSyncedEvent = TaskRealtimeEventEnvelope<
  "task.round.synced",
  {
    roundId: string;
    taskSessionId: string;
    messageId?: string;
    snapshotVersion?: number;
    persistedThroughRevision: number;
  }
>;
```

约束：

1. `task.round.synced` 才是前端拉 persisted messages snapshot 的主边界。
2. `persistedThroughRevision` 必须代表 round 级 canonical 覆盖上界，而不是任意实现细节字段。
3. 这条事件的存在是为了让页面不再把 `assistant completed = 已落库` 当成推断规则。

## 7.6 `task.operation.updated`

作用：更新 model request / tool call 的生命周期和 token / cost。

```ts
export type TaskOperationUpdatedEvent = TaskRealtimeEventEnvelope<
  "task.operation.updated",
  {
    operation: TaskRealtimeOperationDto;
  }
>;
```

约束：

1. operation 更新不应直接改变 message 文本
2. 但前端可以用它更新“执行中”“token/cost”“失败原因”

## 7.7 `task.runtimePermission.required`

作用：在任务页显示待审批卡片。

```ts
export type TaskRuntimePermissionRequiredEvent = TaskRealtimeEventEnvelope<
  "task.runtimePermission.required",
  {
    permission: TaskRealtimeRuntimePermissionDto;
  }
>;
```

## 7.8 `task.runtimePermission.resolved`

作用：移除或更新审批卡片。

```ts
export type TaskRuntimePermissionResolvedEvent = TaskRealtimeEventEnvelope<
  "task.runtimePermission.resolved",
  {
    permission: TaskRealtimeRuntimePermissionDto;
  }
>;
```

## 7.9 `task.workflowStage.updated`

作用：更新 TaskDetail 顶部工作流阶段视图。

```ts
export type TaskWorkflowStageUpdatedEvent = TaskRealtimeEventEnvelope<
  "task.workflowStage.updated",
  {
    stage: TaskRealtimeWorkflowStageDto;
  }
>;
```

## 7.10 `task.reconcile.required`

作用：显式通知前端放弃 patch 猜测，直接静默重拉。

```ts
export type TaskReconcileRequiredEvent = TaskRealtimeEventEnvelope<
  "task.reconcile.required",
  {
    roundId?: string;
    scope: TaskRealtimeRefreshScope;
    reason: TaskRealtimeReconcileReason;
    expectedRevision?: number;
  }
>;
```

这是 escape hatch，不应该高频触发，但必须存在。

约束：

1. `scope=messages` 只驱动主聊天 persisted messages reconcile，不得顺手触发 flow/workflow refresh。
2. `scope=flow` / `scope=workflow` 应与前端 `TaskDetailRefreshTargets` 一一对应。
3. 当 alias miss、projection rebuilt、sequence gap 导致 patch 流不再可靠时，应优先发这条事件，而不是让页面继续猜测修复。

## 8. 完整事件联合类型

```ts
export type TaskRealtimeEventType =
  | "task.snapshot.updated"
  | "task.message.updated"
  | "task.message.delta"
  | "task.message.persisted"
  | "task.round.synced"
  | "task.operation.updated"
  | "task.runtimePermission.required"
  | "task.runtimePermission.resolved"
  | "task.workflowStage.updated"
  | "task.reconcile.required";

export type TaskRealtimeEvent =
  | TaskSnapshotUpdatedEvent
  | TaskMessageUpdatedEvent
  | TaskMessageDeltaEvent
  | TaskMessagePersistedEvent
  | TaskRoundSyncedEvent
  | TaskOperationUpdatedEvent
  | TaskRuntimePermissionRequiredEvent
  | TaskRuntimePermissionResolvedEvent
  | TaskWorkflowStageUpdatedEvent
  | TaskReconcileRequiredEvent;

export type RealtimeServerFrame = RealtimeControlFrame | TaskRealtimeEvent;
```

## 9. Web UI 消费规则

## 9.1 Store 层规则

`useRealtimeStore` 应只负责：

1. 建立 websocket 连接
2. 发送订阅命令
3. 区分 control frame 和 domain event
4. 存放或分发 `TaskRealtimeEvent`

它不应再承担：

1. 解析 runtime `data.info`
2. 解析 runtime `data.part`
3. 解释 `rawType = message.part.updated`

## 9.2 Page 层规则

TaskDetail 页面只应消费这些稳定事件：

1. `task.message.updated`、`task.message.delta`、`task.message.persisted`、`task.round.synced`
2. `task.operation.updated`
3. `task.snapshot.updated`
4. `task.runtimePermission.*`
5. `task.workflowStage.updated`
6. `task.reconcile.required`

另外要固定两条页面规则：

1. `task.message.persisted` 只更新 ack/revision，不单独触发 messages snapshot refresh。
2. `task.round.synced` 与 `task.reconcile.required(scope=messages)` 才是主聊天 persisted refresh 的正式边界。

页面不得再直接消费：

1. `message.updated`
2. `tool.execute.before`
3. `tool.execute.after`
4. `session.idle`
5. `agent.*`

## 10. Broadcaster 实现规则

service broadcaster 必须满足：

1. 只广播 public DTO
2. 不把内部 raw payload 直接 `JSON.stringify` 给浏览器
3. 每条 domain event 都带 `eventId`
4. 同一 task 内 `ordering.taskSequence` 单调递增
5. session 事件带 `sessionSequence`

推荐实现形状：

1. 内部事件源可以很多：runtime SSE、DB outbox、operation pipeline、permission service
2. 但在进入 `wsBroadcaster.broadcast(...)` 之前，必须先过一个 `mapInternalEventToTaskRealtimeEvent(...)`
3. 这个 mapper 是 public contract 的唯一出口

## 11. 与现有事件体系的边界映射

为了切断 compat 语义，当前这些事件应视为内部事件，而不是 public web-ui contract：

1. `message.updated`
2. `tool.execute.before`
3. `tool.execute.after`
4. `session.created`
5. `session.updated`
6. `session.status`
7. `session.idle`
8. `agent.started`
9. `agent.completed`
10. `agent.failed`
11. `approval.required`
12. `approval.resolved`
13. `pipeline.stage.updated`

建议的 public 映射如下：

1. 内部 `message.updated` -> `task.message.updated`
2. 内部 `message.part.updated` -> `task.message.delta`
3. 内部 canonical write / mirror flush 完成 -> `task.message.persisted`、`task.round.synced`
4. 内部 `tool.execute.before/after` -> `task.operation.updated`
5. 内部 `approval.required/resolved` -> `task.runtimePermission.required/resolved`
6. 内部 `pipeline.stage.updated` -> `task.workflowStage.updated`
7. 内部 projection rebuild / sequence gap / alias repair -> `task.reconcile.required`
8. 内部各种状态落点 -> `task.snapshot.updated`

## 12. 版本策略

### 12.1 向后兼容原则

1. `schemaVersion = 1` 下不允许无声改字段含义
2. 只能增加可选字段，不能删除必填字段
3. 一旦新增 breaking event，必须升级 `schemaVersion`

### 12.2 Cutover 原则

新页面代码一旦切到这份 contract：

1. 不再依赖 raw `message.updated`
2. 不再依赖 `event.data.info` / `event.data.part`
3. 不再依赖 `rawType`

旧 compat 事件即使短期还存在，也不应进入新页面 reducer。

## 13. 一句话总结

TaskDetail 的稳定 realtime contract 应该是：

1. websocket 控制帧与领域事件分层
2. public 领域事件统一走 `TaskRealtimeEventEnvelope`
3. 主聊天 message 流只消费 `task.message.updated`、`task.message.delta`、`task.message.persisted`、`task.round.synced` 这组稳定 DTO
4. `task.reconcile.required` 明确使用 `messages` / `flow` / `workflow` / `task` 四类 target，而不是页面层术语
5. 原始 runtime SSE 和 compat `message.updated` 事件只留在 service/BFF 内部

也就是说，**浏览器端接收的应该是 task-domain patch，而不是 runtime protocol 本身。**
