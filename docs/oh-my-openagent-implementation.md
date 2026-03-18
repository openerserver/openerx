# oh-my-openagent 借鉴方案实现说明

> 状态说明：本文档记录的是一轮历史实现方案，其中涉及旧图模型兼容层的章节已不再代表当前代码。
>
> 当前系统已完成旧兼容层下线与数据库清理；阅读本文件时，请将相关章节视为历史背景，而不是现行架构说明。

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

### 3.1 已归档的历史编排实现

本章原先记录的是一套旧版运行时编排镜像实现，包括图模型持久化、同步链路和独立可视化视图。

上述内容已经全部下线，不再属于当前系统实现：

1. 旧版 runtime 兼容插件已移除
2. 图模型相关 schema、migration 与关联字段已删除
3. 旧版图查询接口已下线
4. 独立图视图页面与组件已删除

现行替代方案：

1. Workflow Stage 作为唯一执行骨架
2. ExecutionPlan 承载 single / parallel / sequential-chain 模式
3. Hook 与 runtime pipeline 承担阶段执行治理与可观测性

详细现行方案见 [docs/dag-node-execution-plan-v2.md](docs/dag-node-execution-plan-v2.md)。

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

## 7. 历史实现附录 [归档]

本节原先逐文件记录了一套旧版图模型兼容实现清单，并附带对应的数据流图。

这些内容已整体失效，原因如下：

1. 相关 runtime 插件、BFF 同步链路、前端图视图和 service schema 已在当前仓库中删除。
2. 当前系统不再通过图镜像表达执行主路径，而是以 Workflow Stage、ExecutionPlan、Hook、agent_runs 和 runtime pipeline 为中心。
3. 若继续保留旧文件清单和旧数据流图，会把已经移除的能力误写成现状。

因此本附录不再展开旧版文件级设计。当前有效实现与后续迭代方向，请以 [docs/dag-node-execution-plan-v2.md](docs/dag-node-execution-plan-v2.md) 为准。
