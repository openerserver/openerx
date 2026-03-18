# oh-my-openagent 借鉴方案实现说明

## 1. 文档目的

本文档基于 [oh-my-openagent Issue 工作包清单](./oh-my-openagent-issue-breakdown.md) 的 4 个 Epic、19 个 Issue，记录全部实现内容。
涵盖数据模型、BFF 接口、前端页面、同步机制和配置管理。

相关文档：

- [oh-my-openagent 对比与可执行方案](./oh-my-openagent-comparison-plan.md)
- [oh-my-openagent Issue 工作包清单](./oh-my-openagent-issue-breakdown.md)
- [OpenerX 当前系统架构说明](./architecture-overview.md)

## 2. 实现总览

| Epic | Issue 数 | 状态 |
|------|---------|------|
| Epic 1: 任务编排主模型（运行时 → 控制面穿透） | 6 | ✅ 全部完成 |
| Epic 2: 规划与任务路由（运行时能力 UI 可视化） | 5 | ✅ 全部完成 |
| Epic 3: 插件生命周期控制面 | 6 | ✅ 全部完成 |
| Epic 4: 连续执行与恢复机制 | 3 | ✅ 全部完成 |

所有变更已通过 `tsc --noEmit`（BFF + Service）、`vue-tsc --noEmit`（Web UI）和 Biome 格式检查，零错误。

---

## 3. Epic 1: 任务编排主模型

### 3.1 控制面 DAG 镜像数据模型（Issue 1.1 + 1.2）

在控制面数据库中新增 4 张表，镜像运行时 task-graph-plugin 的 DAG 模型。

**`task_nodes` 表** — 任务图节点

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 节点 ID |
| task_id | text FK→tasks | 所属任务 |
| graph_id | text | 运行时图 ID |
| subject | text | 节点描述 |
| status | text | 状态枚举（见下方状态机） |
| agent_type | text | Agent 名称 |
| session_id | text? | OpenCode session ID |
| retry_count | integer | 已重试次数，默认 0 |
| max_retries | integer | 最大重试次数，默认 2 |
| output | text? | 执行输出 |
| error | text? | 错误信息 |
| token_used | integer | Token 消耗，默认 0 |
| started_at / finished_at | text? | 执行时间窗口 |
| created_at | timestamp | 创建时间 |

**`task_edges` 表** — DAG 依赖边

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 边 ID |
| task_id | text FK→tasks | 所属任务 |
| graph_id | text | 运行时图 ID |
| from_node_id | text FK→task_nodes | 起始节点 |
| to_node_id | text FK→task_nodes | 目标节点 |
| edge_type | text | `blocks` \| `informs`，默认 `blocks` |

**`agent_runs` 表** — Agent 执行记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 执行记录 ID |
| task_id | text FK→tasks | 所属任务 |
| node_id | text? FK→task_nodes | 关联 DAG 节点 |
| session_id | text? | OpenCode session ID |
| agent_type | text | Agent 名称 |
| status | text | pending\|running\|paused\|completed\|failed\|stopped\|terminated |
| model_used | text? | 使用的模型 |
| token_used | integer | Token 消耗 |
| result / error | text? | 结果或错误 |
| started_at / finished_at | text? | 执行时间窗口 |
| created_at | timestamp | 创建时间 |

**`plugins` 表** — 插件元数据（Epic 3 共用）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 插件 ID |
| name | text UNIQUE | 插件名称 |
| display_name | text | 显示名称 |
| plugin_path | text | opencode.json 中的路径 |
| version | text? | 版本号 |
| source | text | `builtin` \| `local` \| `registry` |
| status | text | `enabled` \| `disabled` \| `error` \| `not_installed` |
| description | text? | 插件描述 |
| capabilities | JSON | 工具名称数组 |
| last_verified_at / error_detail | text? | 最近验证时间和错误详情 |
| created_at / updated_at | timestamp | 时间戳 |

**迁移文件**：`control-plane/service/drizzle/0002_numerous_bastion.sql`

**tasks 表新增字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| category | text | 意图分类：quick\|deep\|ops\|security\|architecture |
| strategy | JSON | 编排策略详情 |

### 3.2 节点状态机与运行时对齐（Issue 1.3）

共享类型定义在 `control-plane/service/src/types/graph.ts`。

**节点状态集合**（与 task-graph-plugin 一致）：

```
pending → in_progress, blocked
in_progress → completed, failed, stopped, paused, waiting_approval
failed → in_progress, stopped
blocked → pending
paused → in_progress, stopped
waiting_approval → in_progress, stopped
completed → （终态）
stopped → （终态）
```

**状态颜色映射**（前端 TaskGraph 使用）：

| 状态 | 颜色 |
|------|------|
| completed | 绿色 |
| in_progress / running | 蓝色 |
| failed | 红色 |
| pending | 灰色 |
| paused / waiting_approval | 橙色 |

### 3.3 Graph 接口对接运行时 DAG（Issue 1.4）

**BFF 接口**：`GET /api/tasks/:taskId/graph`

工作流程：

1. 调用 `syncGraphsForTask(taskId)` 从运行时 JSON 文件同步最新 DAG
2. 访问控制面 `GET /api/tasks/:taskId/graph` 获取已持久化的图数据
3. 返回 `{ taskId, nodes: TaskGraphNode[], edges: TaskGraphEdge[] }`

控制面 Service 接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/:taskId/graph` | 查询持久化的 DAG 数据 |
| PUT | `/api/tasks/:taskId/graph` | 写入/更新 DAG 数据 |

### 3.4 运行时 DAG 到控制面 DB 同步（Issue 1.5）

实现在 `control-plane/web-ui-bff/src/modules/realtime/dag-sync.ts`。

**同步触发方式**：

1. **SSE 事件驱动**：当 SSE 聚合器收到 `tool.execute.after` 事件且 toolName 以 `task_graph_` 开头时，自动触发同步
2. **按需同步**：前端请求 graph 接口时，先调用 `syncGraphsForTask(taskId)` 确保数据最新
3. **批量同步**：`syncAllGraphs()` 可批量同步所有运行时图

**同步机制**：

- 读取 `{OPENCODE_DIR}/.opencode/state/task-graphs/{graphId}.json`
- 将运行时时间戳（ms）转换为 ISO 字符串
- 通过 `PUT /api/tasks/{taskId}/graph` 写入控制面 DB
- 维护 `lastSyncTimestamps` 避免重复同步

### 3.5 TaskGraph 基于真实接口渲染（Issue 1.6）

TaskGraph 组件（`control-plane/web-ui/src/components/TaskGraph.vue`）改造为 API 优先模式：

- **页面加载**：通过 `getTaskGraph(taskId)` 拉取完整 DAG 数据
- **增量更新**：WebSocket 实时事件仅做叠加刷新
- **降级方案**：无数据时显示占位符
- **布局算法**：使用 dagre 自动计算节点布局
- **可视化**：使用 @vue-flow/core 渲染，节点颜色按状态显示

---

## 4. Epic 2: 规划与任务路由

### 4.1 意图分类同步（Issue 2.1 + 2.3）

BFF 端实现了意图分类器（`control-plane/web-ui-bff/src/lib/intent-classifier.ts`），在任务执行时自动分类。

**分类类别**：

| 类别 | 识别关键词 | 默认 Agent |
|------|-----------|-----------|
| quick | what, explain, show, describe, brief, simple | `explore-enterprise` |
| deep | implement, build, develop, refactor, feature, fix bug | `sisyphus-enterprise` + 规划 Agent |
| ops | deploy, rollback, restart, monitor, log, metric | `oracle-enterprise` |
| security | vulnerability, auth, audit, compliance, secret | `oracle-enterprise`, `hephaestus-enterprise` |
| architecture | design, pattern, scalability, review, technical debt | `prometheus-enterprise`, `oracle-enterprise` |

**复杂度估算**：

- `high`：>100 词 或 涉及多文件 或 出现复杂关键词
- `medium`：>30 词
- `low`：其他

**分类结果**（写入 tasks.category 和 tasks.strategy）：

```typescript
{
  category: "deep",
  complexity: "high",
  suggestedAgents: ["sisyphus-enterprise", "prometheus-enterprise", "hephaestus-enterprise"],
  requiresPlan: true,
  confidence: 0.72
}
```

任务执行接口 `POST /api/tasks/:taskId/execute` 在创建 session 前进行分类，结果自动回写到控制面 tasks 表。

### 4.2 规划流水线可视化（Issue 2.2）

**BFF 接口**：`GET /api/tasks/:taskId/pipeline`

工作流程：

1. 查询任务关联的 session 消息
2. 扫描消息，提取 prometheus-enterprise、metis-enterprise、momus-enterprise 三个 Agent 的输出
3. 返回各阶段的状态、消息数量、Token 用量和输出内容

```typescript
interface PipelineStage {
  agent: string       // agent 名称
  label: string       // 显示标签
  status: "pending" | "running" | "completed"
  messageCount: number
  output: string      // 截取的输出内容
  tokens: { input: number; output: number }
}
```

**前端展示**（TaskDetail 规划流水线面板）：

- 使用 Ant Design Steps 组件展示 Prometheus → Metis → Momus 三阶段进度
- 每个阶段可展开查看详细输出（Collapse 折叠面板）
- 显示每阶段 Token 用量

### 4.3 编排决策面板（Issue 2.4）

在 TaskDetail 页面新增"编排决策"卡片，展示：

- **意图分类**：category（带颜色标签）
- **复杂度评估**：complexity（blue/orange/red）
- **置信度**：confidence（百分比）
- **是否需要规划**：requiresPlan
- **建议 Agent**：suggestedAgents 列表（Tag 组件）

### 4.4 编排策略配置 UI（Issue 2.5）

**BFF 接口**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config/orchestration-strategy` | 获取编排策略 |
| PUT | `/api/config/orchestration-strategy` | 更新编排策略 |

**持久化**：JSON 文件存储在 `.opencode/state/orchestration-strategy.json`

**策略结构**：

```json
{
  "categoryAgentMap": {
    "quick": ["explore-enterprise"],
    "deep": ["sisyphus-enterprise", "prometheus-enterprise", "hephaestus-enterprise"],
    "ops": ["oracle-enterprise"],
    "security": ["oracle-enterprise", "hephaestus-enterprise"],
    "architecture": ["prometheus-enterprise", "oracle-enterprise"]
  },
  "categoryModelMap": {
    "quick": "",
    "deep": "",
    "ops": "",
    "security": "",
    "architecture": ""
  },
  "pipelineEnabled": true
}
```

**前端**（Settings "编排策略" tab）：

- 类别 → Agent 映射表（分类名 | Agent 列表，可编辑 Tag-Select）
- 类别 → 模型覆盖（输入框）
- 规划流水线开关（Switch）

---

## 5. Epic 3: 插件生命周期控制面

### 5.1 插件元数据模型与持久化（Issue 3.1 + 3.2）

由 `plugins` 表（见 3.1 节）和控制面 Service 的插件 CRUD 路由提供：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 查询所有插件 |
| POST | `/api/plugins` | 注册插件 |
| PATCH | `/api/plugins/:id` | 更新插件状态/信息 |

### 5.2 插件启用 / 禁用（Issue 3.3）

**BFF 接口**：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/config/plugins/:name/disable` | 禁用插件 |
| POST | `/api/config/plugins/:name/enable` | 启用插件 |

**机制**：

- **禁用**：从 `opencode.json` 的 `plugins` 数组移除，加入 `_disabledPlugins` 数组
- **启用**：从 `_disabledPlugins` 移回 `plugins` 数组
- 插件列表接口返回时自动标注 `enabled` 布尔字段

### 5.3 插件安装 / 卸载（Issue 3.4）

**BFF 接口**：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/config/plugins/install` | 安装插件 |
| POST | `/api/config/plugins/:name/uninstall` | 卸载插件 |

**安装流程**：

1. 接收 `source`（源文件路径）和可选 `name`（插件名称）
2. 校验源文件存在性
3. 复制源文件到 `.opencode/plugins/{name}.ts`
4. 在 `opencode.json` 的 `plugins` 数组中注册路径
5. 返回注册结果

**卸载流程**：

1. 从 `opencode.json` 的 `plugins` 和 `_disabledPlugins` 数组中同时移除
2. 写回配置文件

### 5.4 插件兼容性检查（Issue 3.5）

**BFF 接口**：`GET /api/config/plugins/compatibility`

**检查逻辑**：

1. 读取 `opencode.json` 中注册的所有插件路径
2. 对每个插件执行基础文件级检查：
   - 文件是否存在
   - 文件是否有 `export` 语句
   - 文件是否包含插件相关代码（plugin、hook、command）
3. 返回检查结果数组

```typescript
interface PluginCompatResult {
  name: string
  path: string
  exists: boolean
  hasExports: boolean
  hasPluginCode: boolean
  compatible: boolean  // exists && hasExports && hasPluginCode
  error?: string
}
```

### 5.5 Settings 插件生命周期控制面（Issue 3.6）

Settings 页面的"插件"tab 从只读清单升级为完整生命周期控制台：

- **插件列表表格**：名称、路径、来源、状态、启用/禁用状态
- **操作按钮**：
  - 启用 / 禁用切换（Switch 或 Button）
  - 卸载（带 Popconfirm 确认）
- **安装入口**：弹窗输入源文件路径和插件名称
- **兼容性检查**：一键检查按钮 + 结果表格（文件存在/导出/代码 三项状态）

---

## 6. Epic 4: 连续执行与恢复机制

### 6.1 Session Tools BFF 接口（Issue 4.1）

OpenCode Adapter 新增函数：

```typescript
// 列出 session（通过 OpenCode HTTP API）
listSessions(limit?: number): Promise<OpencodeResponse>
// GET /session?limit={limit}

// 获取 session 消息历史
getSessionMessages(sessionId: string): Promise<OpencodeResponse>
// GET /session/{sessionId}/message?limit=200

// 向 session 发送续跑指令
continueSession(sessionId: string, prompt: string): Promise<OpencodeResponse>
// POST /session/{sessionId}/prompt_async
```

**BFF 路由**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/:taskId/sessions` | 列出任务相关的 session |
| GET | `/api/tasks/:taskId/sessions/:sessionId/messages` | 获取 session 消息历史 |
| POST | `/api/tasks/:taskId/continue` | 向 session 发送续跑指令 |

Session 列表通过 taskId 过滤：查询控制面 sessions 表获取任务关联的 sessionId，然后从 OpenCode 拉取对应 session 详情。

### 6.2 会话历史与续跑 UI（Issue 4.2）

TaskDetail 新增"会话历史"卡片：

- **Session 表格**：
  - Session ID（前 8 位）
  - 标题
  - 活跃状态（Tag 标签）
  - 变更摘要（新增/删除行数、文件数）
  - 创建时间
- **续跑按钮**：打开弹窗，输入后续提示词
- **续跑弹窗**：
  - 下拉选择目标 Session（默认当前活跃 session）
  - 文本框输入后续指令
  - 确认后调用 `POST /api/tasks/:taskId/continue`

前端触发续跑后发送 `task.continued` 实时事件。

### 6.3 恢复策略配置（Issue 4.3）

**BFF 接口**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config/continuation-policy` | 获取恢复策略 |
| PUT | `/api/config/continuation-policy` | 更新恢复策略 |

**持久化**：JSON 文件存储在 `.opencode/state/continuation-policy.json`

**策略结构**：

```json
{
  "autoRetryOnFailure": true,
  "maxRetries": 2,
  "retryableErrors": [
    "rate_limit",
    "timeout",
    "context_window_exceeded"
  ],
  "requireApprovalOnRetry": false,
  "fallbackModel": "gpt-4.1",
  "enableFallback": true
}
```

**前端**（Settings "恢复策略" tab）：

- 失败自动重试开关
- 最大重试次数输入
- 可重试错误类型列表（Select Tags 模式）
- 重试需审批开关
- Fallback 模型输入
- 启用 Fallback 开关

---

## 7. 变更文件清单

### 控制面 Service

| 文件 | 变更 |
|------|------|
| `src/db/schema.ts` | 新增 task_nodes、task_edges、agent_runs、plugins 四表；tasks 表新增 category、strategy 字段 |
| `src/types/graph.ts` | **新建** — 共享类型定义（NodeStatus、EdgeType、TaskCategory、AgentRunStatus 等） |
| `src/modules/tasks/routes.ts` | 新增 graph GET/PUT、runs GET/POST/PATCH、task PATCH 扩展 category/strategy |
| `src/modules/plugins/routes.ts` | **新建** — 插件 CRUD 路由 |
| `src/index.ts` | 注册 plugins 路由 |
| `drizzle/0002_numerous_bastion.sql` | **新建** — 迁移文件 |

### BFF 聚合层

| 文件 | 变更 |
|------|------|
| `src/modules/tasks/routes.ts` | 新增 pipeline、sessions、messages、continue、graph 同步路由 |
| `src/modules/config/routes.ts` | 新增插件启用/禁用/安装/卸载/兼容性检查、编排策略、恢复策略路由 |
| `src/modules/realtime/dag-sync.ts` | **新建** — DAG 同步服务 |
| `src/modules/realtime/sse-aggregator.ts` | 集成 DAG 同步触发 |
| `src/modules/agent-control/opencode-adapter.ts` | 新增 listSessions、getSessionMessages、continueSession |
| `src/lib/intent-classifier.ts` | **新建** — 意图分类器 |
| `src/types/events.ts` | 新增 `task.continued` 事件类型 |

### Web UI

| 文件 | 变更 |
|------|------|
| `src/lib/api.ts` | 新增 TaskGraphNode/Edge/Data、PipelineStage、SessionInfo 等接口；新增 15+ API 函数 |
| `src/components/TaskGraph.vue` | 重写为 API 优先渲染模式 |
| `src/pages/TaskDetail.vue` | 新增编排决策、规划流水线、会话历史面板 |
| `src/pages/Settings.vue` | 新增插件生命周期控制台、编排策略 tab、恢复策略 tab |

---

## 8. 数据流架构

```
┌─────────────────────────────────────────────────────────┐
│ OpenCode Runtime (:4096)                                │
│   task-graph-plugin → .opencode/state/task-graphs/*.json│
│   orchestrator-plugin → 意图分类 + Agent 路由           │
│   session-tools → session list/read/continue            │
│   SSE /global/event → 实时事件                          │
└────┬──────────────────────────┬──────────────────────────┘
     │ SSE events               │ HTTP API
     ▼                          ▼
┌─────────────────────────────────────────────────────────┐
│ BFF (:4098)                                             │
│   SSEAggregator → tool.execute.after → DAG sync trigger │
│   intent-classifier → 任务分类                          │
│   dag-sync → 读 JSON → PUT graph → 控制面 DB           │
│   opencode-adapter → session list/continue              │
└────┬──────────────────────────┬──────────────────────────┘
     │ WebSocket                │ HTTP → cpFetch
     ▼                          ▼
┌──────────────┐  ┌───────────────────────────────────────┐
│ Web UI       │  │ Control Plane Service (:4097)          │
│ (:5173)      │  │   tasks → graph → task_nodes/edges    │
│ TaskDetail   │  │   plugins → CRUD                      │
│ Settings     │  │   PostgreSQL                          │
│ TaskGraph    │  │                                       │
└──────────────┘  └───────────────────────────────────────┘
```

**DAG 同步路径**：Runtime JSON → BFF dag-sync → PUT CP Service → PostgreSQL → BFF GET → Frontend

**意图分类路径**：用户 prompt → BFF execute → intent-classifier → tasks.category/strategy → TaskDetail 编排决策面板

**插件管理路径**：Settings UI → BFF config → opencode.json + _disabledPlugins → CP plugins 表

**续跑路径**：TaskDetail 续跑按钮 → BFF continue → OpenCode prompt_async → session 续执行
