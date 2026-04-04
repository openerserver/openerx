# Task Session Message 最小可实施接口清单

> 状态：Draft v1
> 日期：2026-03-29
> 作者：GitHub Copilot
> 关联文档：[task-session-message-roundtrip-target-plan.md](task-session-message-roundtrip-target-plan.md)、[task-session-first-schema-plan.md](task-session-first-schema-plan.md)、[task-session-message-service-route-dto-draft.md](task-session-message-service-route-dto-draft.md)、[task-detail-message-state-machine-plan.md](task-detail-message-state-machine-plan.md)、[task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)

## 1. 文档目的

这份文档把目标方案压缩成最小可实施 contract，只保留三类内容：

1. messages API
2. realtime 事件
3. 数据库最小字段集

适用范围只覆盖最小闭环：

1. 用户发送 1 条消息
2. 服务端触发 1 次模型调用
3. 模型流式返回 1 条回复
4. 前端实时展示并可刷新恢复

## 2. MVP 边界

这一版最小 contract 不解决：

1. 并行 candidate
2. judge session
3. manual branch adopt
4. 多 session 切换
5. artifact 下载与 diff 预览

这一版必须解决：

1. 用户消息同步入库
2. assistant placeholder 创建
3. assistant 流式增量展示
4. 刷新后从数据库恢复
5. operation、usage、失败态可审计

## 3. Messages API

### 3.0 ID 约定

这一版 contract 里的 `sessionId` 有且只有一种公开形态：

1. 使用持久化 session 主键，例如 `task-session:<taskId>:<runtimeSessionId>`
2. 不返回 project tree node id 形态
3. 不把 `runtimeSessionId` 当成 public route 的 path 主键

也就是说：

1. `runtimeSessionId` 只是执行器和写链内部关联字段
2. 前端、BFF、service public route 一律以 canonical `sessionId` 交互

## 3.1 发送用户消息

### 路由

```http
POST /tasks/:taskId/sessions/:sessionId/messages
```

### 请求体

```json
{
  "client_message_id": "cli_01J123EXAMPLE",
  "text": "请帮我分析这个报错",
  "attachments": []
}
```

### 请求字段

1. `client_message_id`：前端生成的幂等键，必须全局唯一到当前 session 内
2. `text`：用户输入正文
3. `attachments`：可选，MVP 可以先固定为空数组

### 同步语义

服务端返回成功前，必须已经完成：

1. user message 入库
2. user message text part 入库
3. model_request operation 以 `queued` 状态入库
4. assistant placeholder message 已创建，或服务端明确承诺会立即创建

### 响应体

```json
{
  "task_id": "task_123",
  "session_id": "ses_456",
  "user_message": {
    "id": "msg_user_001",
    "client_message_id": "cli_01J123EXAMPLE",
    "role": "user",
    "status": "completed",
    "text": "请帮我分析这个报错",
    "message_index": 10,
    "created_at": "2026-03-29T10:00:00.000Z"
  },
  "assistant_message": {
    "id": "msg_asst_001",
    "role": "assistant",
    "status": "pending",
    "message_index": 11,
    "created_at": "2026-03-29T10:00:00.050Z"
  },
  "operation": {
    "id": "op_001",
    "kind": "model_request",
    "status": "queued"
  }
}
```

### 错误语义

1. 重复 `client_message_id`：返回同一条已存在消息，不重复创建
2. session 不可写：返回 409
3. task 或 session 不存在：返回 404
4. 参数非法：返回 400

## 3.2 读取 session 消息列表

### 路由

```http
GET /tasks/:taskId/sessions/:sessionId/messages?limit=100&cursor=...
```

### 返回语义

1. 只返回数据库中已知事实
2. 不临时透传底层 runtime message
3. 即使当前 assistant 仍在 streaming，也要返回已持久化的最新文本

### 响应体

```json
{
  "data": [
    {
      "id": "msg_user_001",
      "role": "user",
      "status": "completed",
      "message_index": 10,
      "text": "请帮我分析这个报错",
      "parts": [
        {
          "id": "part_user_001",
          "part_index": 0,
          "part_type": "text",
          "text": "请帮我分析这个报错"
        }
      ],
      "started_at": "2026-03-29T10:00:00.000Z",
      "completed_at": "2026-03-29T10:00:00.000Z"
    },
    {
      "id": "msg_asst_001",
      "role": "assistant",
      "status": "streaming",
      "message_index": 11,
      "text": "先看错误堆栈，再看最近一次变更。",
      "parts": [
        {
          "id": "part_asst_001",
          "part_index": 0,
          "part_type": "text",
          "text": "先看错误堆栈，再看最近一次变更。"
        }
      ],
      "started_at": "2026-03-29T10:00:00.050Z",
      "completed_at": null
    }
  ],
  "page": {
    "limit": 100,
    "next_cursor": null
  }
}
```

### 最小查询参数

1. `limit`
2. `cursor`

MVP 可以先不支持：

1. `includeLineage`
2. `includeArtifacts`
3. `includeUsage`

## 3.3 可选的单条消息读取

如果前端需要在发送后做轻量确认，可以加：

```http
GET /tasks/:taskId/sessions/:sessionId/messages/:messageId
```

但这不是 MVP 必需项。对最小闭环来说，列表读取已经足够。

## 4. Realtime 事件

## 4.1 设计原则

1. realtime 只做增量推送
2. 任何事件丢失后，重新 GET messages 仍能恢复一致状态
3. 事件 payload 必须带足够的定位键，让前端可以直接 patch 本地状态

## 4.2 必需事件列表

### `task.message.created`

用于通知前端某条 message 已由服务端正式创建。

```json
{
  "type": "task.message.created",
  "task_id": "task_123",
  "session_id": "ses_456",
  "message": {
    "id": "msg_asst_001",
    "role": "assistant",
    "status": "pending",
    "message_index": 11,
    "created_at": "2026-03-29T10:00:00.050Z"
  }
}
```

### `task.message.delta`

用于通知前端 assistant 正在生成中的最新文本增量。

```json
{
  "type": "task.message.delta",
  "task_id": "task_123",
  "session_id": "ses_456",
  "message_id": "msg_asst_001",
  "part_id": "part_asst_001",
  "part_type": "text",
  "delta_text": "接下来检查最近一次发布。",
  "full_text": "先看错误堆栈，再看最近一次变更。接下来检查最近一次发布。",
  "status": "streaming",
  "updated_at": "2026-03-29T10:00:01.200Z"
}
```

### `task.message.completed`

用于通知前端 assistant 消息已结束。

```json
{
  "type": "task.message.completed",
  "task_id": "task_123",
  "session_id": "ses_456",
  "message_id": "msg_asst_001",
  "status": "completed",
  "full_text": "先看错误堆栈，再看最近一次变更。接下来检查最近一次发布。",
  "completed_at": "2026-03-29T10:00:03.000Z"
}
```

### `task.message.failed`

用于通知前端消息生成失败。

```json
{
  "type": "task.message.failed",
  "task_id": "task_123",
  "session_id": "ses_456",
  "message_id": "msg_asst_001",
  "status": "failed",
  "error_text": "Provider timeout",
  "failed_at": "2026-03-29T10:00:03.000Z"
}
```

### `task.operation.updated`

用于通知前端 operation 生命周期与 token / cost 聚合变化。

```json
{
  "type": "task.operation.updated",
  "task_id": "task_123",
  "session_id": "ses_456",
  "operation": {
    "id": "op_001",
    "kind": "model_request",
    "status": "running",
    "input_tokens": 124,
    "output_tokens": 65,
    "cost_usd": 0.0019,
    "updated_at": "2026-03-29T10:00:02.000Z"
  }
}
```

### `task.snapshot.updated`

用于通知任务页上方摘要区域刷新，例如当前状态、最后活动时间、最新 session。

```json
{
  "type": "task.snapshot.updated",
  "task_id": "task_123",
  "snapshot": {
    "lifecycle_status": "running",
    "current_execution_status": "running",
    "current_session_id": "ses_456",
    "last_activity_at": "2026-03-29T10:00:02.000Z"
  }
}
```

## 4.3 前端消费规则

1. `task.message.created` 用于建立正式 message 节点
2. `task.message.delta` 用于 patch 当前 assistant 内容
3. `task.message.completed` 用于关闭 streaming 态
4. `task.message.failed` 用于显示失败态和重试入口
5. `task.operation.updated` 用于页内执行状态和 token 成本展示
6. `task.snapshot.updated` 用于刷新任务摘要，不用于替代 message list

## 5. 数据库最小字段集

## 5.1 `task_sessions`

### 必需字段

1. `id`
2. `task_id`
3. `project_id`
4. `execution_status`
5. `session_kind`
6. `trigger_type`
7. `execution_mode_snapshot`
8. `selected_model`
9. `effective_model`
10. `runtime_session_id`
11. `last_activity_at`
12. `started_at`
13. `finished_at`
14. `created_at`
15. `updated_at`

### 这一版可先不需要

1. `parent_session_id`
2. `root_session_id`
3. `coordination_key`
4. `winner_session_id`
5. `judge_session_id`
6. `candidate_index`
7. `step_index`
8. `forked_from_message_id`

如果实现只覆盖单 session 单轮消息，上面这些字段可以先保留 nullable。

## 5.2 `task_session_messages`

### 必需字段

1. `id`
2. `task_id`
3. `session_id`
4. `project_id`
5. `role`
6. `status`
7. `message_index`
8. `text_content`
9. `summary_text`
10. `client_message_id`
11. `provider_message_id`
12. `error_text`
13. `started_at`
14. `completed_at`
15. `created_at`
16. `updated_at`

### 说明

1. `status` 建议枚举：`pending`、`streaming`、`completed`、`failed`、`cancelled`
2. `client_message_id` 只对 `role = user` 必填
3. `provider_message_id` 只对 assistant 或 tool message 可选

## 5.3 `task_session_message_parts`

### 必需字段

1. `id`
2. `message_id`
3. `part_index`
4. `part_type`
5. `text_content`
6. `json_payload`
7. `created_at`
8. `updated_at`
9. `finalized_at`

### 说明

1. `part_type` MVP 至少支持：`text`、`tool_call`、`tool_result`
2. 纯文本 reply 可以只有 1 条 text part，不要求每个 chunk 一条新 part
3. `json_payload` 用于保留结构化内容，例如工具参数和工具结果原文

## 5.4 `session_operations`

### 必需字段

1. `id`
2. `task_id`
3. `session_id`
4. `project_id`
5. `operation_kind`
6. `execution_status`
7. `provider_id`
8. `model_id`
9. `source_message_id`
10. `target_message_id`
11. `input_tokens`
12. `output_tokens`
13. `total_tokens`
14. `cost_usd`
15. `output_text`
16. `error_text`
17. `metadata_json`
18. `started_at`
19. `finished_at`
20. `created_at`
21. `updated_at`

### 说明

MVP 下 `operation_kind` 至少支持：

1. `model_request`
2. `tool_call`

如果第一期还没有外部工具执行，甚至可以先只保留 `model_request`。

## 5.5 `task_usage_ledger_entries`

### 必需字段

1. `id`
2. `task_id`
3. `session_id`
4. `operation_id`
5. `entry_kind`
6. `provider_id`
7. `model_id`
8. `input_tokens`
9. `output_tokens`
10. `total_tokens`
11. `cost_usd`
12. `created_at`

### 说明

MVP 下 `entry_kind` 可以先只支持：

1. `model_request`

## 6. 最小约束

不把这几条约束写清楚，接口会很快失真。

### 6.1 幂等约束

1. 同一 `session_id + client_message_id` 只能创建 1 条 user message
2. 重复提交必须返回已存在记录，而不是重复插入

### 6.2 顺序约束

1. `message_index` 在单个 session 内单调递增
2. assistant message 的 `message_index` 必须大于其触发的 user message

### 6.3 状态约束

1. user message 创建后直接是 `completed`
2. assistant message 允许 `pending -> streaming -> completed`
3. assistant message 也允许 `pending|streaming -> failed|cancelled`
4. `completed` 之后不允许再回到 `streaming`

### 6.4 恢复约束

1. 页面刷新后只依赖 GET messages 即可恢复当前最新文本
2. realtime 事件丢失不能影响事实一致性

## 7. 最小实施顺序

如果要按最小闭环开工，建议顺序如下：

1. 先建 `task_session_messages`、`task_session_message_parts`、`session_operations`、`task_usage_ledger_entries` 最小字段
2. 实现 `POST /tasks/:taskId/sessions/:sessionId/messages`
3. 实现 `GET /tasks/:taskId/sessions/:sessionId/messages`
4. 实现 `task.message.created`、`task.message.delta`、`task.message.completed`、`task.message.failed`
5. 补 `task.operation.updated` 和 `task.snapshot.updated`
6. 前端任务页切到“数据库初始加载 + realtime 增量 patch”模式

## 8. 一句话总结

最小可实施 contract 的核心只有三件事：

1. 1 个 POST messages 接口负责把用户消息和模型调用起点正式写进数据库
2. 1 个 GET messages 接口负责让前端只从数据库恢复消息历史
3. 5 类 realtime 事件负责把 assistant 生成过程增量推给页面

只要这三块稳定，任务页单轮消息往返就已经可以脱离底层 runtime 直读，变成一个以数据库为真源的闭环。