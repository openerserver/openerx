# Historical: OpenCode Runtime 协议文档

> 文档类型：历史资料
> 历史注记（2026-04-15）：本文描述的是旧 OpenCode `serve` 运行时协议，不再代表当前默认 `pi-mono` runtime 的主路径协议；仅保留回退、排障和历史兼容语境使用。

> **适用版本**: OpenCode v1.2.22+ (locked baseline: v1.2.22, 2026-03-09)
>
> 本文档从 v1.1.57 版本起维护，自 v1.2.x 起 REST/SSE 协议无 breaking change，已对齐最新 baseline。

本文档记录 OpenerX BFF 层与 OpenCode `serve` 运行时之间的集成协议，是开发和维护的首要参考。

## 1. 接口总览

OpenCode serve 运行时使用**根路径端点**（不带 `/api/` 前缀）。

| 方法 | 端点 | 用途 | 响应 |
|------|------|------|------|
| `POST` | `/session` | 创建会话 | `200` JSON (session object) |
| `POST` | `/session/:id/prompt_async` | 发送 prompt / guidance / resume | `204` No Content |
| `POST` | `/session/:id/abort` | 暂停/终止当前执行 | `200` JSON (`true`) |
| `GET` | `/session/:id/message?limit=200` | 读取会话消息 | `200` JSON (message array) |
| `GET` | `/global/event` | 全局 SSE 事件流 | SSE stream |

> **注意**: `GET /session/:id/event`（会话级 SSE）在当前版本下返回 HTML 页面，**不可用**。实时事件统一走 `/global/event`。

## 2. 接口详情

### 2.1 创建会话

`POST /session`

请求体:

```json
{
  "title": "[Task 88b44ef4] Inspect the repository..."
}
```

响应 `200`:

```json
{
  "id": "ses_32f3c52adffeK27hCtBT5WCQSX",
  "slug": "shiny-engine",
  "version": "1.2.22",
  "projectID": "32c51b4e9e0df026668735b4bf0a401d5ff52b58",
  "directory": "/Users/.../openerx",
  "title": "[Task 88b44ef4] Inspect the repository...",
  "time": {
    "created": 1773029010770,
    "updated": 1773029010770
  }
}
```

v1.2.16+ 新增字段:
- `workspace_id` — 多工作区隔离标识，可用于 BFF 路由优化（当前未接入，后续迭代评估）

### 2.2 发送 Prompt（异步）

`POST /session/:id/prompt_async`

请求体:

```json
{
  "parts": [
    {
      "type": "text",
      "text": "Inspect the repository, identify the main subsystems..."
    }
  ],
  "model": {
    "providerID": "github-copilot",
    "modelID": "claude-sonnet-4"
  },
  "agent": "build"
}
```

成功响应: **`204 No Content`**（无响应体，不能调用 `.json()`）

**必须显式指定 `model`**。未指定时 runtime 可能落到缺少 API key 的 provider，导致 `ProviderAuthError`。

当前 BFF 默认走 GitHub Copilot 直连 provider；运行前需先完成 `opencode auth login` 的 Copilot 登录。

#### Guidance 注入

使用同一端点，设置 `noReply: true`:

```json
{
  "parts": [
    {
      "type": "text",
      "text": "Keep the plan focused on backend/BFF/runtime integration..."
    }
  ],
  "model": {
    "providerID": "github-copilot",
    "modelID": "claude-sonnet-4"
  },
  "noReply": true
}
```

### 2.3 暂停 / 终止

`POST /session/:id/abort`

成功响应: `200` JSON `true`

行为说明:
- Runtime 触发 `session.error` 事件，错误名: `MessageAbortedError`
- 这是暂停的预期副作用，**不应**映射为 `agent.failed`

### 2.4 读取消息

`GET /session/:id/message?limit=200`

响应 `200`:

```json
[
  {
    "info": {
      "id": "msg_xxx",
      "sessionID": "ses_xxx",
      "role": "user",
      "model": {
        "providerID": "github-copilot",
        "modelID": "claude-sonnet-4"
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

### 2.5 全局事件流（SSE）

`GET /global/event`

数据格式（仅 `data:` 行，非标准 `event:` + `data:` 组合）:

```text
data: {"directory":"/Users/.../openerx","payload":{"type":"session.created","properties":{"info":{...}}}}
```

#### 事件类型

| 事件 | 说明 | BFF 处理 |
|------|------|---------|
| `server.connected` | SSE 连接建立 | 日志记录 |
| `server.heartbeat` | 心跳保活 | 忽略 |
| `session.created` | 新会话创建 | 透传前端 |
| `session.updated` | 会话状态更新 | 透传前端 |
| `session.status` | 会话状态变更 | 透传前端 |
| `session.error` | 会话错误（含 abort 副作用） | 判断是否为 abort，非 abort 才标记失败 |
| `session.idle` | 会话空闲 | 触发完成检测 |
| `session.diff` | 会话 diff | 透传前端 |
| `message.updated` | 消息内容更新 | 透传前端，关联 taskId |
| `message.part.updated` | 消息片段更新 | 同 `message.updated` 处理 |
| `tool.execute.before` | 工具执行前 | 透传前端 |
| `tool.execute.after` | 工具执行后 | 透传前端 |

## 3. BFF 集成架构

### 3.0 Execution Trace 边界

OpenCode runtime 当前仍提供 `GET /session/:id/message?limit=200`，但这条接口在 OpenerX 中的定位需要明确区分：

1. 它是 runtime 原始会话消息读取接口，不等于 task-domain execution trace 的公开 contract。
2. task / project execution trace 的主读链应以 `task_timeline_views` 为首选来源。
3. 当 projection timeline 为空或暂不可用时，BFF 允许退到 service timeline 这一条持久化 secondary source；该 secondary source 由 `conversation_messages` 与 conversation domain events 聚合得到，不是 runtime message fallback。
4. 只要 projection 已返回非空 timeline，即使 `complete=false` 或 `cacheState=partial`，也必须保留显式 incomplete，而不是重新切回 runtime messages 覆盖结果。
5. 因此，后续协议接入或 trace 设计讨论中，不应再把 `GET /session/:id/message` 重新定义为 execution trace 的对外 fallback 层。

### 3.1 Adapter 层

文件: `control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts`

职责:
- `createSession(title)` → `POST /session`
- `sendPrompt(sessionId, prompt, model, agent)` → `POST /session/:id/prompt_async`
- `injectGuidance(sessionId, text)` → `POST /session/:id/prompt_async` (`noReply: true`)
- `abortSession(sessionId)` → `POST /session/:id/abort`
- `getMessages(sessionId)` → `GET /session/:id/message?limit=200`
- 维护 `agentRunRegistry: Map<agentRunId, {subSessionId, status, taskId, projectId}>`

约束补充:
- `getMessages(sessionId)` 主要用于 runtime 诊断、实时联调与低层协议排障。
- task / project execution trace 的前端 contract 不应再直接以该接口结果构造 `runtime-fallback` 语义。
- 若 trace 页面出现 projection 缺口，应优先修正 projection 物化或 service timeline 聚合，而不是恢复 runtime message fallback。

### 3.2 SSE 聚合层

文件: `control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts`

职责:
- 订阅 `GET /global/event`（**唯一** SSE 入口）
- 解析 `data: { directory, payload: { type, properties } }` 结构
- 通过 `sessionId → agentRunRegistry` 回填 `taskId`、`projectId`、`agentRunId`
- 检测完成信号并 PATCH control plane 更新任务状态
- 转发事件到 WebSocket broadcaster

### 3.3 完成检测

`session.idle` 不可靠（已知问题）。当前策略:
1. 收到 `session.idle` 后，GET 最新消息
2. 检查最后一条 assistant 消息是否已完成
3. 确认后 PATCH task 状态为 `completed`，写入 `result` 字段

## 4. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCODE_URL` | `http://localhost:4096` | OpenCode serve 地址 |
| `OPENCODE_PROVIDER_ID` | `github-copilot` | 默认 provider |
| `OPENCODE_MODEL_ID` | `claude-sonnet-4` | 默认模型 |
| `OPENCODE_SKIP_MIGRATIONS` | _(未设置)_ | v1.2.22+: 设为任意值可跳过数据库迁移，加速生产启动 |

## 5. 已验证的事件链

以下链路已在本地环境实跑验证 (2026-03-09):

1. BFF 登录 → 创建任务 → 执行任务
2. 收到 `agent.started`（BFF 广播）
3. 收到 runtime 透传 `message.updated`、`session.updated`
4. 暂停任务 → `agent.paused`（BFF 广播）
5. Runtime 发出 `session.error`（`MessageAbortedError`）与 `session.idle`
6. 注入 guidance → `guidance.injected`（BFF 广播）
7. Guidance 作为 user message 落入同一 session
8. GitHub Copilot 重新登录后，pause/guidance/resume 与直接执行两条 completion-sync 集成测试均恢复通过

## 6. 常见误区

| 误区 | 说明 |
|------|------|
| 使用 `/api/*` 前缀 | 端点均为根路径，`/api/session` 等旧路径不可用 |
| 把 abort 视为失败 | `abort` 触发的 `session.error (MessageAbortedError)` 是暂停副作用，非业务失败 |
| 把 GitHub Copilot 403 视为 runtime 卡死 | `session.error` 中若出现 Copilot 403 / `Please reauthenticate...` / `unauthorized: not licensed to use Copilot`，根因是凭证或授权，不是 runtime 死锁 |
| 对 204 响应调用 `.json()` | `prompt_async` 成功返回 `204 No Content`，无响应体 |
| 不指定模型 | 必须显式传 `model`，否则可能落到未配置 key 的 provider |
| 使用会话级 SSE | `GET /session/:id/event` 当前返回 HTML，只能用 `/global/event` |

## 7. GitHub Copilot 排障

当 BFF 默认模型为 `github-copilot/claude-sonnet-4` 时，最容易误判的是 Copilot 授权问题。

### 7.1 典型症状

若 raw SSE 中出现如下模式，应优先怀疑 Copilot 凭证，而不是 runtime 挂死：

1. `prompt_async` / `abort` / `resume` 在 HTTP 层都成功返回
2. session 很快进入 `session.error`
3. `session.error` 的错误名为 `APIError`
4. error data 中出现 `Please reauthenticate with the copilot provider to ensure your credentials work properly with OpenCode.`、`unauthorized: not licensed to use Copilot` 或 `statusCode: 403`
5. session 随后反复回到 `idle`，但没有稳定的 assistant 完成结果

本次排障的对照样本：

- 登录前诊断文件: [tmp/diag-copilot-delayed.json](../../../tmp/diag-copilot-delayed.json)
- 登录后诊断文件: [tmp/diag-copilot-delayed-after-login.json](../../../tmp/diag-copilot-delayed-after-login.json)

### 7.2 判断方法

可直接运行以下检查：

```bash
cd opencode-fork
opencode auth list
```

若需要复现实验并抓原始 SSE / 消息快照：

```bash
cd /Users/wanglei/Downloads/phones-cloud/openerx
OPENCODE_PROVIDER_ID=github-copilot \
OPENCODE_MODEL_ID=claude-sonnet-4 \
OUTPUT_PATH=tmp/diag-copilot-delayed-after-login.json \
PAUSE_AFTER_MS=3000 \
GUIDANCE_DELAY_MS=1500 \
RESUME_DELAY_MS=1500 \
MAX_RUNTIME_MS=45000 \
node tmp/opencode-early-abort-diagnostic.mjs
```

### 7.3 处理步骤

1. 先执行 `opencode auth login`，选择 `GitHub Copilot` 和正确的 GitHub 部署类型
2. 完成浏览器设备码授权后，再执行 `opencode auth list` 确认凭证已刷新
3. 重新跑最小诊断脚本，确认 403 消失
4. 再跑 `bun run test:bff:completion-sync` 验证端到端链路恢复

### 7.4 本次实测结论

本次故障经历了两个阶段：

1. 登录前，`github-copilot/claude-sonnet-4` 路径下的原始 SSE 明确返回 Copilot 403，属于授权问题，不是 runtime 卡死
2. 重新执行 `opencode auth login` 后，403 消失，runtime 恢复输出 assistant 文本增量，completion-sync 集成测试恢复通过

因此，后续如果再次看到 GitHub Copilot 403，应先重登并重跑诊断，不要先沿着 BFF / SSE 聚合 / task completion 检测方向误判。

## 8. 后续维护

- 升级 OpenCode 前，优先重新验证本文档第 2 节所有接口
- 若会话级 SSE 恢复可用，评估是否从全局 SSE 切回细粒度订阅
- 新增 runtime 相关逻辑前，先读本文档，再读 [docs/api-boundary.md](../../api-boundary.md)
- v1.2.16 引入的 `workspace_id` 可用于多项目 session 隔离，后续迭代评估接入
