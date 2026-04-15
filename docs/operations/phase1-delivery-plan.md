# OpenerX 阶段一落地任务清单与接口调整建议

> 状态说明：这是更早阶段形成的阶段一实施清单，保留了当时“暂不更换 OpenCode Runtime”的阶段性假设，不再代表今天的默认 runtime 路径。
>
> 当前默认 backend 已切到 `pi-mono` runtime-provider；现状请优先参考 [runtime/current-implementation-index.md](../runtime/current-implementation-index.md)、[runtime/pi-mono-upstream-development-plan.md](../runtime/pi-mono-upstream-development-plan.md) 和 [architecture-overview.md](../architecture/architecture-overview.md)。

## 1. 阶段一目标

阶段一的目标不是扩功能，而是完成“边界收敛”。

本阶段只解决以下问题：

- 前端入口统一到 BFF
- 认证链路闭环
- BFF 与控制平面职责边界明确
- 实时连接具备基础鉴权与订阅约束
- 为后续任务域独立打基础

本阶段不做：

- 不引入全新的任务域持久化模型
- 不迁移数据库到 PostgreSQL
- 不更换当时的 OpenCode Runtime
- 不进行大规模 UI 重构

关于 OpenCode 的进一步关注项与不关注项，采用独立文档维护，详见 [OpenCode 关注边界说明](../archive/runtime/historical-opencode-focus-boundary.md)。

## 2. 阶段一工作包

### WP1. 认证入口闭环

目标：让前端所有认证请求都统一走 BFF。

任务清单：

- 在 BFF 增加 `/api/auth/login`
- 在 BFF 增加 `/api/auth/refresh`
- 在 BFF 增加 `/api/auth/me`
- BFF 将上述请求转发给控制平面服务
- 统一认证错误响应格式
- 前端确认认证相关调用仅面向 BFF

交付结果：

- 登录链路闭环
- 前端不再依赖控制平面直连认证

### WP2. 接口边界收敛

目标：清楚区分 BFF 接口与控制平面接口。

任务清单：

- 定义“前端可访问接口清单”
- 定义“控制平面内部服务接口清单”
- 补充 docs 中的接口边界说明
- 清理前端中任何潜在的直连控制平面地址或假设
- 给 BFF 代理接口统一增加回源常量与封装

交付结果：

- 接口职责清晰
- 路由演进不再分散

### WP3. WebSocket 基础鉴权与隔离

目标：让实时链路至少具备最小可接受的访问约束。

任务清单：

- 在 WebSocket 连接建立时校验 token
- 将连接与 userId、project scope 绑定
- 对 `subscribe_task` 指令增加任务访问权限校验
- 对广播逻辑增加按用户/项目过滤能力
- 统一连接失败和鉴权失败事件格式

交付结果：

- 实时链路不再是弱绑定原型实现
- 后续多项目隔离改造有清晰起点

### WP4. BFF 回源与错误模型统一

目标：减少 BFF 中零散的转发写法，统一前后端错误处理体验。

任务清单：

- 封装 BFF 到控制平面服务的统一 fetch helper
- 封装 BFF 到 Runtime 的统一调用 helper
- 统一透传 Authorization 头
- 统一超时、5xx、网络失败的错误结构
- 统一日志字段，例如 requestId、upstream、path、status

交付结果：

- BFF 代理逻辑更可维护
- 问题定位更直接

### WP5. 文档与验收补齐

目标：避免阶段一改造完成后只有代码变化，没有团队共识。

任务清单：

- 更新架构说明文档
- 更新部署说明中的接口入口描述
- 增加认证链路验证步骤
- 增加 WebSocket 建链与订阅校验验证步骤
- 形成阶段一验收清单

交付结果：

- 阶段一成果可验证
- 团队对新边界有统一理解

## 3. 建议的执行顺序

建议顺序如下：

1. 先做 BFF auth 路由补齐。
2. 再统一 BFF 的回源封装和错误模型。
3. 然后补 WebSocket 鉴权与订阅校验。
4. 最后更新文档和验收项。

原因：

- 认证闭环是其他改造的前提
- 回源封装统一后，后续改动更可控
- WebSocket 改造需要依赖稳定的认证上下文

## 4. 接口调整建议

### 4.1 前端对外接口原则

原则：前端只访问 BFF，不直接访问控制平面服务。

建议保留的前端入口：

- `/api/auth/*`
- `/api/tasks/*`
- `/api/approvals/*`
- `/api/agents/*`
- `/api/realtime/*`
- `/ws`

禁止新增：

- 前端直连 `:4097`
- 前端同时维护两套后端 base URL

### 4.2 BFF 对控制平面服务接口建议

建议 BFF 回源以下控制平面接口：

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `GET /api/approvals`
- `POST /api/approvals/:ticketId/resolve`
- 与主数据、治理相关的后续接口

建议规则：

- 凡是主数据和治理事实接口，都由控制平面服务提供
- BFF 只做转发、聚合、格式适配和权限前置校验

### 4.3 BFF 自有接口建议

建议由 BFF 独立对外提供：

- `GET /api/tasks`
- `GET /api/tasks/:taskId`
- `GET /api/tasks/:taskId/graph`
- `POST /api/agents/:agentRunId/pause`
- `POST /api/agents/:agentRunId/resume`
- `POST /api/agents/:agentRunId/guidance`
- `POST /api/agents/:agentRunId/terminate`
- `GET /api/realtime/status`
- `POST /api/realtime/subscribe-session`
- `/ws`

原因：

- 这些接口天然带有前端视图聚合或运行时适配属性
- 不适合直接下沉为控制平面主数据接口

### 4.4 建议增加的 BFF 内部封装

建议抽象三个内部层：

- `controlPlaneClient`：负责到控制平面服务的统一调用
- `runtimeClient`：负责到 OpenCode Runtime 的统一调用
- `responseMapper`：负责上游错误和前端响应格式的映射

这样可以避免后续每个 route 文件都手写 fetch 和状态码转换。

## 5. 建议的验收标准

### 5.1 功能验收

- 登录、刷新 token、获取当前用户都通过 BFF 成功完成
- 任务、审批、Agent 控制和实时链路都仍然可用
- 无前端直连控制平面服务的场景残留

### 5.2 安全与边界验收

- WebSocket 未授权连接会被拒绝
- 无权订阅的任务不会收到事件
- BFF 与控制平面接口边界在文档中有明确说明

### 5.3 可维护性验收

- BFF 回源调用存在统一 helper
- 关键错误响应结构一致
- 文档已同步更新

## 6. 建议的产出物

阶段一完成后，建议至少形成以下产出物：

- 代码改造 PR
- 更新后的架构说明
- 接口边界说明文档
- 阶段一验收记录
- 后续阶段二任务池

## 7. 一页式结论

阶段一不追求把系统做完，而是先把“入口、边界、鉴权、实时约束”四件事做扎实。

如果这一步不做，后续任务域重构、治理前置和运行时解耦都会建立在不稳定边界上，返工成本会更高。
