# OpenerX 接口边界说明

## 1. 原则

- 前端 (Web UI) 只访问 BFF（`:4098`），不直接访问控制平面服务
- BFF 对前端暴露统一的 `/api/*` 和 `/ws`
- 控制平面服务 (`:4097`) 仅由 BFF 回源调用，不对外暴露

当前这些接口边界继续保持为正式默认形态。虽然仓库中仍保留 `control-plane/app` 等兼容/实验入口，但不再把单入口合并作为本阶段默认路线。

OpenCode 的整体关注边界另见 [OpenCode 关注边界说明](./opencode-focus-boundary.md)。本文档只描述当前接口收敛方式，不覆盖 OpenCode 产品能力取舍。

execution trace 的最终公开读取边界以 [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) 为准。本文只保留接口层落点，不再单独演绎一套 trace contract 结论。

## 2. BFF 对前端暴露的接口

### 2.1 认证（公开，无需 token）

| 方法 | 路径 | 说明 | 回源目标 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 登录 | CP `/api/auth/login` |
| POST | `/api/auth/refresh` | 刷新 token | CP `/api/auth/refresh` |
| GET | `/api/auth/me` | 获取当前用户 | CP `/api/auth/me` |

### 2.2 任务（需要 token）

| 方法 | 路径 | 说明 | 回源目标 |
| --- | --- | --- | --- |
| GET | `/api/tasks` | 任务列表 | CP `/api/audit` 聚合 |
| GET | `/api/tasks/:taskId` | 任务详情 | CP `/api/audit` 聚合 |

补充边界：task / project execution trace 相关公开视图，应继续收敛在 task-domain 持久化读链上，而不是重新回到 OpenCode Runtime 原始消息接口。也就是说，trace 的正式来源应以 `task_timeline_views` 为首选，并只在 projection timeline 为空或不可用时，允许使用由 `conversation_messages` 与 conversation domain events 聚合得到的 service timeline 补位。

如需评审或变更这条边界，直接引用 [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)。

### 2.3 审批（需要 token）

说明：历史 `GET /api/tasks/:taskId/graph` 已下线，任务执行可视化统一收敛到 Workflow 阶段、运行流水线与审批/执行状态接口，不再暴露 Task Graph 独立接口。

| 方法 | 路径 | 说明 | 回源目标 |
| --- | --- | --- | --- |
| GET | `/api/approvals` | 审批列表 | CP `/api/approvals` |
| POST | `/api/approvals/:ticketId/resolve` | 处理审批 | CP `/api/approvals/:ticketId/resolve` |

### 2.4 Agent 控制（需要 token）

OpenCode Runtime 的真实协议差异见：

- [docs/opencode-runtime-protocol.md](docs/opencode-runtime-protocol.md)

| 方法 | 路径 | 说明 | 回源目标 |
| --- | --- | --- | --- |
| POST | `/api/agents/:agentRunId/pause` | 暂停 Agent | OpenCode Runtime |
| POST | `/api/agents/:agentRunId/resume` | 恢复 Agent | OpenCode Runtime |
| POST | `/api/agents/:agentRunId/guidance` | 注入指导 | OpenCode Runtime |
| POST | `/api/agents/:agentRunId/terminate` | 终止 Agent | OpenCode Runtime |
| GET | `/api/agents/:agentRunId/status` | Agent 状态 | BFF 内存 |
| GET | `/api/agents/:agentRunId/messages` | Agent 消息 | OpenCode Runtime |

边界说明：

1. `/api/agents/:agentRunId/messages` 表示 runtime 原始 Agent 会话消息读取接口，主要用于控制台查看、联调与低层协议排障。
2. 它不应被重新定义为 task-domain execution trace 的公开 fallback。
3. 对前端暴露的 task / project trace contract，应继续由 task-domain projection 与 conversation 持久化聚合结果提供，而不是直接透传 runtime message 结果。

相关最终决策见 [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)。

### 2.5 实时（需要 token）

| 方法 | 路径 | 说明 | 回源目标 |
| --- | --- | --- | --- |
| GET | `/api/realtime/status` | WS 客户端数 | BFF 自有 |
| POST | `/api/realtime/subscribe-session` | 订阅 SSE 会话 | BFF 自有 |
| WS | `/ws?token=xxx` | WebSocket 实时连接 | BFF 自有 |

### 2.6 WebSocket 消息协议

客户端 → 服务端：

```json
{ "type": "subscribe_task", "taskId": "xxx", "projectId": "optional" }
```

服务端 → 客户端：

```json
{ "type": "subscribed", "taskId": "xxx" }
{ "type": "error", "error": "No access to this project" }
```

实时事件推送为标准 `RealtimeEvent` JSON。

## 3. 控制平面服务内部接口

这些接口仅 BFF 可调用，不对外暴露：

| 模块 | 路径前缀 | 说明 |
| --- | --- | --- |
| auth | `/api/auth/*` | 登录、刷新、用户信息 |
| orgs | `/api/orgs/*` | 组织管理 |
| projects | `/api/projects/*` | 项目管理 |
| envs | `/api/envs/*` | 环境管理 |
| users | `/api/users/*` | 用户管理 |
| policies | `/api/policies/*` | 策略模板管理 |
| audit | `/api/audit/*` | 审计事件查询 |
| cost | `/api/cost/*` | 成本记录查询 |
| approvals | `/api/approvals/*` | 审批单管理 |

## 4. 回源调用规范

所有 BFF → 控制平面服务的调用必须使用 `cpFetch`，它会：

- 自动设置 `Content-Type: application/json`
- 透传 `Authorization` 头
- 生成并传递 `X-Request-Id`
- 记录结构化日志（方法、路径、状态码、耗时、requestId）
- 在网络失败时返回 502 而不是抛异常

## 5. 禁止事项

- 前端不得包含 `localhost:4097` 或 `CONTROL_PLANE_URL` 硬编码
- BFF 路由文件不得自行维护 `CONTROL_PLANE_URL` 常量（统一由 `cpFetch` 内部管理）
- 新增回源调用必须使用 `cpFetch` + `authHeader`
