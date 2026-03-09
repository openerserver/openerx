# OpenCode 1.1.57 Runtime 协议差异说明

本文档记录 OpenerX 当前接入的 OpenCode 1.1.57 `serve` 运行时与历史旧协议的差异，避免后续维护时继续沿用旧的 `/api/*` 假设。

## 1. 结论

- OpenCode 1.1.57 使用根路径接口，不再使用旧版 `/api/session`、`/api/event` 风格。
- BFF 对 OpenCode 的接入必须基于真实运行时协议，而不是历史适配器残留代码。
- 会话级 `GET /session/:id/event` 在当前版本下未提供可用 SSE，直接请求会返回前端 HTML 页面；实时事件应统一订阅 `GET /global/event`。
- `POST /session/:id/prompt_async` 成功时返回 `204 No Content`，不能再强依赖 JSON body。
- 当前仓库实跑时，若不显式指定模型，runtime 可能落到不可用 provider；BFF 应显式发送可用模型 `opencode/big-pickle`。

## 2. 历史旧假设与新版真实协议

| 场景 | 旧假设 | 1.1.57 真实接口 | 备注 |
|------|--------|------------------|------|
| 创建会话 | `POST /api/session` | `POST /session` | 返回 session JSON |
| 发送 prompt | `POST /api/session/:id/message` | `POST /session/:id/prompt_async` | 成功返回 `204` |
| 暂停/终止 | `POST /api/session/:id/abort` | `POST /session/:id/abort` | 返回 JSON `true` |
| 读取消息 | `GET /api/session/:id/messages` | `GET /session/:id/message?limit=200` | 返回消息数组 |
| 全局 SSE | `GET /api/event` | `GET /global/event` | 当前唯一可用 SSE 入口 |
| 会话 SSE | `GET /api/session/:id/event` | 不可用 | 当前版本直接返回 HTML |

## 3. 已验证的真实接口

以下接口已在本仓库本地运行环境中通过实机请求验证。

### 3.1 会话与消息

#### 创建会话

`POST /session`

请求示例：

```json
{
  "title": "[Task 88b44ef4] Inspect the repository..."
}
```

响应示例：

```json
{
  "id": "ses_32f3c52adffeK27hCtBT5WCQSX",
  "slug": "shiny-engine",
  "version": "1.1.57",
  "projectID": "32c51b4e9e0df026668735b4bf0a401d5ff52b58",
  "directory": "/Users/wanglei/Downloads/phones-cloud/openerx",
  "title": "[Task 88b44ef4] Inspect the repository...",
  "time": {
    "created": 1773029010770,
    "updated": 1773029010770
  }
}
```

#### 异步发送 prompt

`POST /session/:id/prompt_async`

请求示例：

```json
{
  "parts": [
    {
      "type": "text",
      "text": "Inspect the repository, identify the main subsystems..."
    }
  ],
  "model": {
    "providerID": "opencode",
    "modelID": "big-pickle"
  },
  "agent": "build"
}
```

成功响应：

- 状态码：`204 No Content`
- 响应体：空

注入 guidance 时也走同一路径，只是 body 不同：

```json
{
  "parts": [
    {
      "type": "text",
      "text": "Keep the plan focused on backend/BFF/runtime integration and resume only when explicitly asked."
    }
  ],
  "model": {
    "providerID": "opencode",
    "modelID": "big-pickle"
  },
  "noReply": true
}
```

#### 读取消息

`GET /session/:id/message?limit=200`

返回数组，单条消息包含 `info` 和 `parts`：

```json
[
  {
    "info": {
      "id": "msg_xxx",
      "sessionID": "ses_xxx",
      "role": "user",
      "model": {
        "providerID": "opencode",
        "modelID": "big-pickle"
      }
    },
    "parts": [
      {
        "type": "text",
        "text": "..."
      }
    ]
  }
]
```

### 3.2 暂停 / 终止

`POST /session/:id/abort`

成功响应：

```json
true
```

注意：

- 从 runtime 视角看，`abort` 会触发会话内一条 `session.error`，错误名通常是 `MessageAbortedError`。
- 对 OpenerX 的业务语义来说，这代表“暂停当前执行”，不应直接把它解释成失败。

### 3.3 全局事件流

`GET /global/event`

SSE 数据格式不是旧版的 `event:` + `data:` 组合，而是主要通过 `data:` 承载一个带 `payload` 的 JSON：

```text
data: {"directory":"/Users/.../openerx","payload":{"type":"session.created","properties":{"info":{...}}}}

data: {"directory":"/Users/.../openerx","payload":{"type":"message.updated","properties":{"info":{...}}}}
```

实测出现过的事件类型包括：

- `server.connected`
- `server.heartbeat`
- `session.created`
- `session.updated`
- `session.status`
- `session.error`
- `session.idle`
- `session.diff`
- `message.updated`
- `message.part.updated`

其中与 OpenerX 当前 BFF 实时透传直接相关的主要是：

- `session.created`
- `session.updated`
- `session.error`
- `session.idle`
- `message.updated`
- `message.part.updated`

## 4. 当前 BFF 应遵循的接入规则

### 4.1 Adapter 层

当前 BFF 适配逻辑位于：

- [control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts](control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts)

维护要求：

- 创建会话必须调用 `POST /session`。
- 发送 prompt / guidance / resume 必须调用 `POST /session/:id/prompt_async`。
- 读取消息必须调用 `GET /session/:id/message?limit=200`。
- 暂停与终止必须调用 `POST /session/:id/abort`。
- 对 `204` 空响应必须兼容，不能强制 `response.json()`。
- 必须显式发送：

```json
{
  "model": {
    "providerID": "opencode",
    "modelID": "big-pickle"
  }
}
```

原因：本仓库当前 OpenCode runtime 的默认 provider 可能落到未配置鉴权的 `google/gemini`，从而触发 `ProviderAuthError`。

### 4.2 SSE 聚合层

当前 BFF 聚合逻辑位于：

- [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)

维护要求：

- 只订阅 `GET /global/event`。
- 不要再假设 `GET /session/:id/event` 可用。
- 解析 `data: { directory, payload: { type, properties } }` 结构。
- 对 `message.part.updated` 应按 `message.updated` 同类事件处理。
- 应通过 `sessionId -> agentRunRegistry` 回填 `taskId`、`projectId`、`agentRunId`，否则前端项目过滤会丢事件。

## 5. 已验证的 BFF 事件链

2026-03-09 已在本仓库本地环境实跑通过以下链路：

1. BFF 登录
2. 创建任务
3. 执行任务
4. 收到 `agent.started`
5. 收到 runtime 透传的 `message.updated`、`session.updated`
6. 暂停任务
7. 收到 `agent.paused`
8. runtime 发出 `session.error`（`MessageAbortedError`）与 `session.idle`
9. 注入 guidance
10. 收到 `guidance.injected`
11. guidance 作为新的 user message 落入同一 session

说明：

- `agent.started / agent.paused / guidance.injected` 由 OpenerX BFF 主动广播。
- `message.updated / session.updated / session.error / session.idle` 来自 OpenCode `/global/event`，由 BFF 聚合后转发。

## 6. 常见误区

### 误区 1：继续使用 `/api/*`

错误示例：

- `/api/session`
- `/api/session/:id/message`
- `/api/session/:id/messages`
- `/api/event`

这些都是历史旧协议假设，在 1.1.57 下会直接失效或行为错误。

### 误区 2：把 pause 视为普通失败

调用 `abort` 后，runtime 会发出 `session.error`，错误名为 `MessageAbortedError`。这是暂停动作的副产物，不应直接映射为 OpenerX 的 `agent.failed`。

### 误区 3：忽略 `204 No Content`

`prompt_async` 成功时无 JSON body。如果调用方直接 `await response.json()`，会得到解析错误。

### 误区 4：依赖 runtime 默认模型

当前环境里，runtime 默认模型不一定可用。未显式指定模型时，可能落到缺少 API key 的 provider，导致请求从一开始就失败。

## 7. 后续维护建议

- 升级 OpenCode 版本前，优先重新验证本文件第 3 节中的接口集合。
- 若未来出现可用的会话级事件流，再评估是否需要从全局 SSE 切回更细粒度订阅。
- 新增任何 runtime 相关逻辑前，先读本文件，再读 [docs/api-boundary.md](docs/api-boundary.md)。
