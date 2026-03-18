# OpenerX 运行架构图

本文档描述当前仓库在开发态的实际运行架构，重点标出各个进程、监听端口、依赖关系，以及关键共享文件。当前默认拓扑仍是 `5173 -> 4098 -> 4097 -> PostgreSQL`，并继续保留外部 Runtime `:4096`；不再继续推进单进程合并作为默认路线。

## 1. 总览图

```mermaid
flowchart LR
    Browser["用户浏览器\nChrome / Edge / Safari"]
    UI["Web UI Dev Server\nVite / Node\n:5173\ncontrol-plane/web-ui"]
    BFF["Web UI BFF\nBun + Hono\n:4098\ncontrol-plane/web-ui-bff"]
    CP["Control Plane Service\nBun + Hono\n:4097\ncontrol-plane/service"]
    DB[("PostgreSQL")]
    OCR["OpenCode Runtime\nopencode serve\n:4096\nopencode-fork"]
    CFG["运行时配置与状态文件\nopencode-fork/opencode.json\nopencode-fork/.opencode/state"]
    Qwen["Qwen 推理服务\nOpenAI Compatible API\n192.168.31.103:8000"]
    Copilot["GitHub Copilot / 外部模型服务"]
    MCP["MCP / Plugin 子进程\n按需由 Runtime 拉起"]

    Browser -->|访问页面| UI
    Browser -->|/api, /ws| UI
    UI -->|Vite 代理 /api, /ws| BFF
    BFF -->|cpFetch 业务查询/登录/任务/审批| CP
    CP -->|读写主数据| DB
    BFF -->|暂停/恢复/注入指导/读取会话| OCR
    OCR -->|SSE / Session / Message| BFF
    BFF <-->|读写模型、MCP、插件配置| CFG
    OCR -->|读取 provider/model/plugin 配置| CFG
    OCR -->|调用本地模型| Qwen
    OCR -->|调用云端模型| Copilot
    OCR -->|启动或连接工具进程| MCP
```

## 2. 进程清单

| 进程 | 代码位置 | 默认端口 | 启动方式 | 主要职责 |
| --- | --- | --- | --- | --- |
| Web UI Dev Server | `control-plane/web-ui` | 5173 | `bun run dev --host 0.0.0.0 --port 5173` | 提供前端页面静态资源，并在开发态代理 `/api` 和 `/ws` |
| Web UI BFF | `control-plane/web-ui-bff` | 4098 | `bun run src/index.ts` | 前端统一入口，JWT 校验，代理 Control Plane，适配 OpenCode Runtime |
| Control Plane Service | `control-plane/service` | 4097 | `bun run src/index.ts` | 认证、项目、用户、任务、审批、审计、配置主数据 |
| OpenCode Runtime | `opencode-fork` / 本机 `opencode` 可执行文件 | 4096 | `opencode serve --hostname 127.0.0.1 --port 4096 --print-logs` | Agent 会话执行、消息流、SSE 输出、模型调用、插件/MCP 调用 |
| PostgreSQL | 外部数据库实例 | 无 | 由 Control Plane 通过连接串访问 | Control Plane 主数据存储 |
| Qwen 推理服务 | 外部机器 | 192.168.31.103:8000 | 外部独立服务 | 为 `qwen-local` provider 提供 OpenAI 兼容推理接口 |
| GitHub Copilot / 其他外部模型服务 | 外部服务 | 外部 | 外部服务 | 为 Runtime 提供云端模型能力 |
| MCP / Plugin 子进程 | 由 Runtime 按需拉起 | 动态 | Runtime 内部触发 | 搜索、浏览器自动化、知识库、任务编排等工具能力 |

## 3. 关键调用关系

### 3.1 浏览器到前端

- 用户浏览器访问 `http://localhost:5173`。
- 页面资源由 Vite Dev Server 提供。

### 3.2 前端到 BFF

- 浏览器调用 `/api/*` 和 `/ws`。
- 在开发态，这两个入口由 Vite 代理到 BFF `:4098`。
- 因此前端本身不直接访问 Control Plane，也不直接访问 OpenCode Runtime。

### 3.3 BFF 到 Control Plane

- BFF 通过 `cpFetch` 调用 `http://localhost:4097`。
- 登录、任务列表、审批、项目、用户等主业务请求都走这条链路。
- 如果 Control Plane 未启动，前端就会看到 `Control plane unreachable`。

### 3.4 BFF 到 OpenCode Runtime

- BFF 直接访问 OpenCode Runtime `:4096`。
- 典型动作包括：暂停任务、恢复任务、注入指导、读取 Session 消息、订阅 SSE 事件。
- BFF 同时负责把 Runtime 的实时事件转换后再推送给前端。

### 3.5 Runtime 到模型服务

- Runtime 根据 `opencode-fork/opencode.json` 中的 provider 配置选择模型后端。
- 本地模型场景下，Runtime 调用 `qwen-local` 对应的 OpenAI 兼容服务。
- 云端模型场景下，Runtime 调用 GitHub Copilot 或其他外部 provider。

### 3.6 配置与状态文件

- BFF 的配置管理接口会读写 `opencode-fork/opencode.json`。
- BFF 也会读写 `opencode-fork/.opencode/state` 下的状态文件，例如 token、continuation policy、task graph 镜像等。
- OpenCode Runtime 启动和执行过程中也会读取这些文件，因此这是 BFF 与 Runtime 的共享文件边界。

## 4. 实际端口关系

```text
浏览器
  -> 5173 Web UI (Vite)
  -> 5173 下的 /api,/ws 代理到 4098 BFF

4098 BFF
  -> 4097 Control Plane Service
  -> 4096 OpenCode Runtime
  -> opencode-fork/opencode.json
  -> opencode-fork/.opencode/state/*

4097 Control Plane Service
  -> PostgreSQL

4096 OpenCode Runtime
  -> 192.168.31.103:8000 Qwen 推理服务
  -> GitHub Copilot / 其他外部模型
  -> MCP / Plugin 子进程
```

## 5. 典型启动顺序

建议按以下顺序启动，以避免页面报错或出现 `Control plane unreachable`：

1. 启动 Control Plane Service（`:4097`）
2. 启动 Web UI BFF（`:4098`）
3. 启动 OpenCode Runtime（`:4096`）
4. 启动 Web UI Dev Server（`:5173`）
5. 确认外部模型服务可达，例如 `qwen-local` 指向的推理地址

## 6. 当前已验证的运行事实

- Web UI 使用 Vite 开发服务器，当前需要显式以 `--host 0.0.0.0` 启动，才能同时支持 `localhost` 和 `127.0.0.1`。
- BFF 自身健康不代表系统完整可用；如果 Control Plane 没启动，任务列表与登录转发会失败。
- Runtime 模型配置来源于 `opencode-fork/opencode.json`，而不是前端内存状态本身。
- `qwen-local` 当前可用地址是 `http://192.168.31.103:8000/v1`；旧地址 `192.168.1.103:8000` 不可达。

## 7. 建议用途

这份图适合用于以下场景：

- 开发环境排障
- 新成员理解系统边界
- 解释“页面能打开但任务列表失败”的原因
- 对齐 BFF、Control Plane、Runtime 三层职责

## 8. 关键时序图

### 8.1 登录链路

```mermaid
sequenceDiagram
  participant Browser as 浏览器
  participant UI as Web UI :5173
  participant BFF as BFF :4098
  participant CP as Control Plane :4097
  participant DB as PostgreSQL

  Browser->>UI: 打开登录页
  Browser->>UI: 提交用户名/密码
  UI->>BFF: POST /api/auth/login
  BFF->>CP: POST /api/auth/login
  CP->>DB: 校验用户与密码哈希
  DB-->>CP: 用户记录
  CP-->>BFF: JWT + user profile
  BFF-->>UI: JWT + user profile
  UI-->>Browser: 保存 token，进入系统
```

### 8.2 任务列表链路

```mermaid
sequenceDiagram
  participant Browser as 浏览器
  participant UI as Web UI :5173
  participant BFF as BFF :4098
  participant CP as Control Plane :4097
  participant DB as PostgreSQL

  Browser->>UI: 打开任务列表页
  UI->>BFF: GET /api/tasks?status=running
  BFF->>BFF: 校验 Bearer Token
  BFF->>CP: GET /api/tasks?status=running
  CP->>DB: 查询 tasks / agent_runs / 相关数据
  DB-->>CP: 任务结果集
  CP-->>BFF: JSON data
  BFF-->>UI: JSON data
  UI-->>Browser: 渲染任务列表
```

### 8.3 模型调用链路

```mermaid
sequenceDiagram
  participant Browser as 浏览器
  participant UI as Web UI :5173
  participant BFF as BFF :4098
  participant OCR as OpenCode Runtime :4096
  participant CFG as opencode.json
  participant Qwen as Qwen API :8000

  Browser->>UI: 发起任务或对话
  UI->>BFF: POST /api/agents/... 或任务执行请求
  BFF->>OCR: 创建/控制 session
  OCR->>CFG: 读取 provider/model 配置
  CFG-->>OCR: qwen-local + model route
  OCR->>Qwen: POST /v1/chat/completions
  Qwen-->>OCR: 生成结果
  OCR-->>BFF: session message / SSE event
  BFF-->>UI: API 响应或 WebSocket 事件
  UI-->>Browser: 展示输出与状态
```

## 9. 故障定位版架构图

```mermaid
flowchart TD
  Browser["浏览器页面异常"]
  UI["5173 Web UI"]
  BFF["4098 BFF"]
  CP["4097 Control Plane"]
  OCR["4096 OpenCode Runtime"]
  Qwen["192.168.31.103:8000 Qwen API"]
  DB["PostgreSQL"]
  CFG["opencode-fork/opencode.json"]

  Browser --> UI
  UI --> BFF
  BFF --> CP
  BFF --> OCR
  CP --> DB
  OCR --> CFG
  OCR --> Qwen

  UI -. 页面打不开 .-> UI_ERR["检查 Vite 是否存活\n检查 5173 是否监听\n检查 localhost / 127.0.0.1 绑定"]
  BFF -. API 500 / 登录失败 .-> BFF_ERR["检查 4098 health\n检查 JWT 配置\n检查 BFF 日志"]
  CP -. Control plane unreachable .-> CP_ERR["检查 4097 是否启动\n检查 Control Plane 日志\n检查 PostgreSQL 连接是否正常"]
  OCR -. 任务不推进 / 无实时事件 .-> OCR_ERR["检查 4096 health/session\n检查 Runtime 是否启动\n检查 SSE 事件是否输出"]
  Qwen -. Provider 测试失败 / 选择模型失败 .-> QWEN_ERR["检查 baseURL / apiKey\n检查局域网连通性\n检查 /v1/models 与 /chat/completions"]
  CFG -. 配置改了不生效 .-> CFG_ERR["检查 BFF 写入的 opencode-fork/opencode.json\n检查 Runtime 是否读取同一份配置"]
```

## 10. 常见报错与对应断点

| 页面提示 | 直接怀疑点 | 首先检查 |
| --- | --- | --- |
| 页面无法访问 | Web UI Dev Server 未启动或监听地址不对 | `5173` 是否监听，是否仅监听 `::1` |
| `Control plane unreachable` | Control Plane Service 未启动或 `4097` 不通 | `http://127.0.0.1:4097/health` |
| 任务列表加载失败 | BFF 到 Control Plane 链路断开 | BFF 日志中的 `cpFetch` 返回码 |
| `Request failed` | BFF 非 JSON 错误响应，或上游抛异常 | 对应 API 的 HTTP 状态与 BFF 日志 |
| Provider 测试失败 | Runtime 所在机器到模型服务不通 | `baseURL`、`apiKey`、`/v1/models` 直连 |
| 模型能测通但任务无输出 | Runtime session 或 SSE 链路异常 | `4096`、SSE、WebSocket |
| 配置页修改后不生效 | 写入文件与 Runtime 实际读取文件不一致 | `opencode-fork/opencode.json` 与 `.opencode/state` |

## 11. 一句话排障顺序

当系统看起来“整体坏了”时，按这个顺序查最快：

1. `5173` 前端是否可访问
2. `4098/health` BFF 是否正常
3. `4097/health` Control Plane 是否正常
4. `4096` OpenCode Runtime 是否正常
5. 外部模型地址是否可达
6. `opencode-fork/opencode.json` 是否是当前生效配置
