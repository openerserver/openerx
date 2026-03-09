# OpenCode 底层运行原理与 Git 设计

> **适用版本**: OpenCode v1.2.22 (locked baseline: 2026-03-09)
>
> 本文档面向研发团队，完整描述 OpenCode 作为 AI Agent 运行时的内部工作机制，以及其围绕 Git 的全链路设计。

---

## 第一部分：底层运行原理

### 1. OpenCode 是什么

OpenCode 是一个**独立编译的 AI Agent 运行时二进制文件**，安装于 `/usr/local/bin/opencode`，以 HTTP 服务器模式运行：

```bash
/usr/local/bin/opencode serve --port 4096
```

它不是 Node.js 库，而是独立进程，对外暴露 REST API + SSE 事件流。通过插件系统（`@opencode-ai/plugin`）和 SDK（`@opencode-ai/sdk`）可扩展和集成。

在 OpenerX 体系中，OpenCode 位于最底层的执行层，与 BFF 聚合层、控制平面服务、Web UI 共同构成四层架构：

```
用户浏览器 → Web UI (:5173) → BFF (:4098) → Control Plane (:4097)
                                    ↓
                            OpenCode Runtime (:4096)
```

### 2. 协议层：REST + SSE

OpenCode Runtime 暴露 **5 个根路径端点**（无 `/api/` 前缀）：

| 方法 | 端点 | 用途 | 响应 |
|------|------|------|------|
| `POST` | `/session` | 创建会话 | `200` JSON (session object) |
| `POST` | `/session/:id/prompt_async` | 发送 prompt / guidance / resume | `204` No Content |
| `POST` | `/session/:id/abort` | 暂停/终止当前执行 | `200` JSON (`true`) |
| `GET` | `/session/:id/message?limit=200` | 读取会话消息 | `200` JSON (message array) |
| `GET` | `/global/event` | 全局 SSE 事件流 | SSE stream |

协议关键约束：

- 会话级 SSE (`/session/:id/event`) 当前版本不可用（返回 HTML），只能用全局 SSE
- `prompt_async` 成功返回 `204`，无响应体，不能调用 `.json()`
- 每条 prompt 必须显式指定 `model`（provider + modelID），否则可能落到未配置 API key 的 provider

详细协议规范见 [opencode-runtime-protocol.md](./opencode-runtime-protocol.md)。

### 3. 完整执行链路（7 个阶段）

#### 阶段 1：接收用户指令

用户指令通过两种方式进入 OpenCode：

**方式 A — TUI 终端直接输入**（本地开发）：用户在终端输入 → OpenCode TUI → 创建 Session → 发送 Prompt。

**方式 B — REST API 远程调用**（OpenerX 集成）：Web UI → BFF → `POST /session`（创建会话）→ `POST /session/:id/prompt_async`（发送指令）。

请求体结构：

```json
{
  "parts": [
    { "type": "text", "text": "帮我实现一个用户注册功能" }
  ],
  "model": {
    "providerID": "github-copilot",
    "modelID": "claude-sonnet-4"
  },
  "agent": "build"
}
```

#### 阶段 2：插件钩子拦截（Pre-LLM 处理）

OpenCode 在将消息发给 LLM 之前，按顺序触发插件钩子链：

| 序号 | 钩子 | 作用 | 典型使用者 |
|------|------|------|-----------|
| ① | `chat.message` | 检查/修改消息内容 | — |
| ② | `chat.system.transform` | 修改 System Prompt | context-injection-plugin（注入 AGENTS.md 规则）、skills-plugin（注入已激活 Skill 指令） |
| ③ | `chat.params` | 定制 temperature, topP, topK 等参数 | — |
| ④ | `chat.headers` | 添加自定义 HTTP 头 | — |
| ⑤ | `tool.definition` | 动态修改工具定义 | — |

**orchestrator-plugin** 在此阶段执行**意图分类**：用 63 个正则模式匹配用户消息，分为 5 类（quick / deep / ops / security / architecture），估算复杂度（low / medium / high），推荐最优 Agent 和模型。

#### 阶段 3：工具发现与注册

OpenCode 在调用 LLM 前，收集所有可用工具的 JSON Schema 定义，包括三类来源：

**内置工具**（OpenCode 自带）：

| 工具 | 作用 |
|------|------|
| `read_file` | 读取文件内容 |
| `edit_file` / `write_file` | 编辑/写入文件 |
| `shell` | 执行 shell 命令 |
| `find_text` / `find_files` / `find_symbols` | 搜索代码 |
| `lsp_rename` | LSP 重命名符号 |
| `todo` | 任务清单管理 |

**插件注册的工具**（通过 `opencode.json` 中 `plugin` 配置加载）：

| 来源插件 | 代表性工具 |
|----------|-----------|
| orchestrator | `classify_intent`, `select_model`, `create_sub_session`, `dispatch_to_agent` |
| task-graph | `task_graph_create`, `task_graph_update_node`, `task_graph_query` |
| hashline-edit | `hashline_read`, `hashline_edit`, `hashline_insert`, `hashline_delete` |
| tmux | `tmux_create_session`, `tmux_send_keys`, `tmux_read_output` |
| skills | `skill_list`, `skill_activate`, `skill_read` |

**MCP 服务器工具**（通过 `mcp` 配置启动子进程）：

| MCP Server | 工具能力 |
|------------|---------|
| exa | 网页搜索 |
| context7 | 官方库文档查询 |
| grep-app | GitHub 代码搜索 |

所有工具被序列化为 JSON Schema，作为 `tools` 参数传给 LLM。

#### 阶段 4：调用 LLM

OpenCode 构造完整的 LLM 请求：

```
┌─────────────────────────────────────────────┐
│  system: [                                   │
│    "You are an AI coding assistant...",      │
│    (AGENTS.md 注入的规则),                    │
│    (Skill 注入的指令)                         │
│  ]                                           │
│                                              │
│  messages: [                                 │
│    {role: "user", content: "实现注册功能"}     │
│    ... (历史消息)                             │
│  ]                                           │
│                                              │
│  tools: [                                    │
│    {name: "read_file", schema: {...}},       │
│    {name: "edit_file", schema: {...}},       │
│    {name: "shell", schema: {...}},           │
│    ... (所有可用工具的 JSON Schema)           │
│  ]                                           │
│                                              │
│  model: claude-sonnet-4                      │
│  temperature: 0.7                            │
│  max_tokens: 16384                           │
└─────────────────────────────────────────────┘
```

请求被路由到配置的 Provider：

| Provider | 认证方式 |
|----------|---------|
| `github-copilot` | `opencode auth login` → GitHub 设备码 OAuth → Copilot Token |
| `anthropic` | `ANTHROPIC_API_KEY` 环境变量 |
| `openai` | `OPENAI_API_KEY` 环境变量 |

#### 阶段 5：LLM 响应处理（Agentic Loop）

LLM 的响应是**流式**的，包含文本和工具调用（tool_use），OpenCode 运行一个**循环**处理：

```
                  ┌──────────────────────┐
                  │                      │
                  ▼                      │
          发送消息给 LLM                  │
                  │                      │
                  ▼                      │
          LLM 返回响应                    │
                  │                      │
          ┌───────┴───────┐              │
          │               │              │
     纯文本输出     工具调用请求           │
     (完成)              │               │
                         ▼               │
                    执行工具              │
                    (前后触发钩子)         │
                         │               │
                         ▼               │
                  工具结果反馈 ───────────┘
                  (作为新 message
                   送回 LLM)
```

每次循环：

1. 将工具执行结果追加到消息历史
2. 重新调用 LLM（LLM 看到工具结果后决定下一步）
3. 重复直到 LLM 不再调用工具（纯文本回复 = 任务完成）

工具执行过程中会触发两个关键钩子：

- `tool.execute.before`：检查/修改参数
- `tool.execute.after`：记录结果/元数据

#### 阶段 6：代码生成与命令执行

**代码生成**的底层流程：

```
LLM 决定编辑文件
    ↓
调用 hashline_read → 读取文件，每行加 hash 标注
    LINE#1#a3f2b1 | import express from 'express';
    LINE#2#c7d4e9 | const app = express();
    ↓
LLM 生成编辑指令
    ↓
调用 hashline_edit → 引用目标行 hash
    { anchor: "c7d4e9", newContent: "..." }
    ↓
OpenCode 验证 hash 匹配 → 写入文件
（hash 不匹配 → 拒绝编辑 → LLM 重新读取）
```

**命令执行**的底层流程：

```
LLM 调用 shell → { command: "bun test" }
    ↓
permission.ask 钩子触发安全等级检查
    Level 0 (Free): 读取操作 → 直接执行
    Level 1 (Audit): 文件写入 → 记录后执行
    Level 2 (Confirm): Shell 命令 → 需确认
    Level 3 (Approve): 生产写入 → 需审批
    ↓
shell.env 钩子注入环境变量
    ↓
子进程执行，stdout/stderr 返回给 LLM
```

**长运行命令**（服务器、调试器等）通过 tmux-plugin 管理：

```
tmux_create_session → 创建后台 tmux 会话
tmux_read_output    → 读取输出
tmux_send_keys      → 发送控制信号
```

#### 阶段 7：实时事件广播

整个过程中，OpenCode 通过 SSE 广播所有事件：

```
GET /global/event

data: {"payload":{"type":"session.created",...}}
data: {"payload":{"type":"message.updated","properties":{"parts":[...]}}}
data: {"payload":{"type":"tool.execute.before","properties":{"tool":"read_file",...}}}
data: {"payload":{"type":"tool.execute.after","properties":{"tool":"read_file","output":"..."}}}
data: {"payload":{"type":"session.idle",...}}
```

SSE 事件类型总览：

| 事件 | 说明 |
|------|------|
| `session.created` | 新会话创建 |
| `session.updated` | 会话状态更新 |
| `session.status` | 会话状态变更 |
| `session.error` | 会话错误（含 abort 副作用） |
| `session.idle` | 会话空闲 |
| `message.updated` | 消息内容更新 |
| `message.part.updated` | 消息片段更新 |
| `tool.execute.before` | 工具执行前 |
| `tool.execute.after` | 工具执行后 |

### 4. 插件系统

OpenCode 通过 `opencode.json` 配置加载 TypeScript 插件，每个插件通过导出 `tools`（工具函数）和 `hooks`（生命周期钩子）注册能力。

当前部署的 6 个插件：

#### 4.1 Orchestrator Plugin（编排器）

核心能力：

- **意图分类**：5 类（quick / deep / ops / security / architecture），63 个正则模式
- **模型路由**：按任务复杂度选择 Claude Sonnet（推理型）或 GPT-4（执行型）
- **子会话管理**：为每个专业 Agent 创建独立 Session
- **Ralph Loop**：连续迭代执行，内置停滞检测（3 轮无进展 → 终止）
- **上下文剪枝**：去重读取、压缩错误输出、追踪 token 节省

#### 4.2 Task Graph Plugin（DAG 任务图）

核心能力：

- 构建**有向无环图（DAG）**管理子任务依赖
- 节点状态机：`pending → in_progress → completed/failed/blocked`
- 边类型：`blocks`（硬依赖）/ `informs`（软依赖）
- 核心算法：`getReadyNodes()` 返回可执行节点、`unblockCompletedDependents()` 级联解锁下游、`checkGraphCompletion()` 检测全局完成
- 持久化到 `~/.opencode/state/task-graphs/{graphId}.json`

##### 4.2.1 历史 Graph 修复运维

当旧任务在控制平面或前端中显示为空图，但运行时目录里仍保留 `task-graphs/*.json` 时，可使用一次性修复脚本将历史图重新镜像回控制平面数据库。

脚本位置：`control-plane/service/src/cli/repair-historical-graphs.ts`

脚本入口：

```bash
cd control-plane/service
bun run cli:repair-graphs --dry-run
```

正式执行：

```bash
cd control-plane/service
bun run cli:repair-graphs
```

可选参数：

- `--dry-run`：仅输出将要修复的 graph，不写数据库、不改 runtime graph 文件
- `--graph-dir <path>`：覆盖默认运行时 graph 目录
- `--graph-id <id>`：只修复单个 graph 文件
- `--task-id <id>`：只修复将被解析到指定任务的 graph
- `--no-rewrite`：只回填控制平面数据库，不改写 runtime graph 文件中的 `taskId`

脚本行为：

- 扫描 runtime graph 目录中的 JSON 文件
- 优先使用控制平面中的 `tasks`、`sessions`、`agent_runs`、`task_nodes` 映射解析真实任务 ID
- 如历史 graph 使用了伪造 `taskId`，再回读主会话消息，从 `create_sub_session`、`task_graph_create`、`task_graph_query` 中反推真实任务 ID
- 将解析后的节点和边重建到控制平面数据库中的 `task_nodes`、`task_edges`
- 默认会把 runtime graph 文件中的 `taskId` 改写为真实任务 ID，便于后续排障

验收方式：

```bash
cd control-plane/service
sqlite3 data/openerx.db "select task_id, graph_id, count(*) as nodes from task_nodes where task_id = '<task-id>' group by task_id, graph_id;"
```

也可直接检查前端接口：

```bash
curl http://127.0.0.1:4098/api/tasks/<task-id>/graph
```

已知边界：

- 该脚本只能恢复运行时文件和主会话消息里确实存在的数据，不能凭空重建从未持久化的边或节点语义
- 如果原始 graph 文件只有节点、没有边，那么修复后前端仍会显示 `0` 条边，这是源数据缺失，不是修复失败
- 若 graph 无法映射到任何真实控制平面任务，脚本会将其标记为 `skipped`，不会强行落库

#### 4.3 Context Injection Plugin（上下文注入）

核心能力：

- 递归发现项目中的 `AGENTS.md` 文件
- 解析 YAML frontmatter（applyTo glob 模式、agent 过滤、优先级）
- 在 `before_prompt_build` 钩子中自动注入匹配规则

#### 4.4 Skills Plugin（技能模块）

核心能力：

- 技能 = 目录（`SKILL.md` 指令 + 可选 `mcp.json`）
- Frontmatter 定义权限：`allowedTools`、`deniedTools`、`filePatterns`、`maxConcurrency`
- MCP 服务器通过 Bun 子进程启动，环境隔离

#### 4.5 Hashline Edit Plugin（安全编辑）

核心能力：

- 每行标注 `LINE#{行号}#{sha256_hash6} | {内容}`
- 编辑引用 hash，文件变更后 hash 不匹配 → 编辑被拒绝
- 防止并发/竞态条件下的文件冲突

#### 4.6 Tmux Plugin（终端管理）

核心能力：

- 管理持久化终端会话（REPL、调试器、长运行进程）
- 输入清洗：屏蔽 `rm -rf /`、`mkfs`、fork bomb 等危险命令

### 5. 多 Agent 协作系统

OpenCode 配置了 9 个专业化 Agent（Markdown 定义在 `.opencode/agents/` 下）：

| Agent | 角色 |
|-------|------|
| **Sisyphus** | 主编排器：接收复杂任务 → 调度规划 → 创建 DAG → 分配子任务，从不直接写代码 |
| **Prometheus** | 规划器：强制面试用户（≥3 个问题）→ 生成结构化 JSON 计划 |
| **Metis** | 假设审计：识别技术/业务/集成/性能维度的隐藏假设 |
| **Momus** | 计划验证：评分 clarity/completeness/verifiability/feasibility（≥3 分通过） |
| **Hephaestus** | 编码实现：使用 hashline_edit 安全编辑，修改后必须跑测试 |
| **Oracle** | 架构诊断：架构评审、故障排查、运维操作 |
| **Librarian** | 代码搜索：上下文收集与知识检索 |
| **Explore** | 快速探索：1-3 次工具调用的简单查询 |
| **Multimodal** | 多模态分析：图片、文档等 |

**复杂任务的典型执行流**：

```
用户请求
  → Orchestrator.classify_intent() → category: "deep", complexity: "high"
  → create_sub_session(Sisyphus)
  → Sisyphus 调度 Prometheus 制定计划
  → Metis 审计隐藏假设
  → Momus 验证计划可行性
  → task_graph_create() 创建 DAG
  → 按依赖顺序分派节点给 Hephaestus/Oracle/Librarian
  → 节点完成 → 级联解锁下游
  → 全部完成 → Sisyphus 生成交接摘要
```

每个 Agent 运行在**独立的 OpenCode Session** 中，有自己的消息历史和工具调用上下文。

### 6. BFF 集成层

OpenerX 的 BFF 层通过以下三个模块实现与 OpenCode Runtime 的集成：

**OpenCode Adapter**（`web-ui-bff/src/modules/agent-control/opencode-adapter.ts`）：

- 维护 `agentRunRegistry`（agentRunId → subSessionId 映射）
- 封装 createSession / pauseAgent / injectGuidance / resumeAgent / terminateAgent
- 暂停安全窗口：`MIN_ACTIVE_BEFORE_PAUSE_MS = 3000ms`

**SSE Aggregator**（`web-ui-bff/src/modules/realtime/sse-aggregator.ts`）：

- 订阅 `/global/event`，将 OpenCode 事件转换为标准 `RealtimeEvent`
- 检测 Copilot 401/403 → 发出 `agent.auth-error`
- 检测完成信号 → 触发 `task.completed`
- 指数退避重连（最多 10 次）

**DAG Sync**（`web-ui-bff/src/modules/realtime/dag-sync.ts`）：

- 监听 `tool.execute.after` 中的 `task_graph_*` 事件
- 从文件系统读取 graph JSON → 同步到控制平面 DB

数据流闭环：

```
OpenCode Runtime → SSE → BFF Aggregator → WebSocket → 前端实时更新
                                        → DAG Sync → Control Plane DB
```

---

## 第二部分：Git 设计

### 7. 运行时内建的 Git 能力

OpenCode Runtime 本身内建了一套围绕 Git 的安全机制：

#### 7.1 Snapshot + Revert 系统

- **SnapshotPart**：每个 `StepStartPart`（工具调用开始）和 `StepFinishPart`（工具调用结束）都可以携带 `snapshot` 字段
- **Session.revert**：可以回滚到某条消息 / 某个快照点，附带 `diff` 信息
- **Session.unrevert**：撤销回滚

OpenCode 在**每次工具调用前自动创建文件快照**。如果 Agent 改坏了代码，可以精确回滚到某个步骤之前的状态。

#### 7.2 Worktree 感知

SDK 中 `Project` 类型包含 `worktree: string` 字段。OpenCode 感知当前 git worktree 路径，所有文件操作限定在此范围内。

#### 7.3 Session Fork

`POST /session/{id}/fork` 端点支持**会话分叉**——类似 git branch 的概念，可以在某条消息处分叉出新会话，走不同的执行路径。

#### 7.4 Session Diff

`EventSessionDiff` 事件和 `Session.summary.diffs` 字段提供会话中文件变更的 diff 追踪，类似 `git diff` 的能力但在会话粒度上。

### 8. 权限层：4 级 Git 命令分级

`SECURITY-BASELINE.md` 中定义了严格的 git 权限分级：

| 级别 | 策略 | 允许的 Git 操作 |
|------|------|----------------|
| **Level 0 — Free** | 无限制直接执行 | `git status`, `git log`, `git diff` |
| **Level 1 — Audit** | 执行 + 记录日志 | `git add`, `git commit` |
| **Level 2 — Confirm** | 需 Agent 自确认 | `git push` |
| **Level 3 — Approve** | 需人工审批 | `git push --force` |

设计意图：Agent 可以自由读取 git 状态、自动提交代码，但 **push 需要确认，force push 需要人工审批**。

### 9. git-master Skill：提交规范与分支策略

`.opencode/skills/git-master/SKILL.md` 是一个可激活的领域技能模块，被激活后注入到 Agent 的 System Prompt 中，强制约束 git 行为：

#### 9.1 提交规范（Conventional Commits）

```
type(scope): description

允许的 type:
  feat     — 新功能
  fix      — Bug 修复
  refactor — 代码重构
  chore    — 构建/工具/配置
  docs     — 文档
  test     — 测试
  build    — 构建系统
  ci       — CI 配置
  revert   — 回滚

约束:
  subject: 祈使语气，≤72 字符，不加句号
  body: 解释 WHY 而非 WHAT
```

#### 9.2 分支策略

| 分支模式 | 用途 |
|---------|------|
| `main` | 生产就绪，受保护 |
| `dev` | 集成分支 |
| `feat/<ticket>-<desc>` | 功能分支 |
| `fix/<ticket>-<desc>` | 修复分支 |
| `release/<version>` | 发布准备 |

#### 9.3 提交纪律

- **一次 commit = 一个逻辑变更**，绝不混合不相关的修改
- 使用 rebase 工作流（`git rebase -i`），不使用 merge commit
- 禁止对已发布的 commit 做 amend 或 rebase

#### 9.4 推送前检查清单

1. 所有测试通过
2. Lint 无错误
3. 提交信息符合 Conventional Commits 格式
4. 无 WIP 或调试代码残留
5. 分支已 rebase 到最新目标分支

#### 9.5 反模式（明确禁止）

- 禁止在共享分支上 `git push --force`
- 禁止提交 secrets、`.env`、凭证
- 禁止在 feature 分支上创建 merge commits
- 禁止 amend 已发布的 commits

### 10. 自动化 Git 工具

`quality.ts` 中提供了两个 git 专用工具：

#### 10.1 `git_commit_style` — 提交信息验证器

- 检查是否符合 Conventional Commits 格式
- 强制 ≤72 字符的 subject line
- 不合格时自动建议修改

#### 10.2 `git_history_search` — Git 历史搜索器

- `git log --grep` 搜索 commit message
- `git log -S` 搜索代码变更（pickaxe search）
- 可按 author、时间范围过滤
- 返回前 20 条匹配结果

### 11. 工作流中的 Git 操作时机

#### 11.1 `/start-work` 完整流程

```
意图分类 → 规划 → 审计 → 验证 → 创建 DAG → 执行代码修改
                                                  ↓
                                          每个子任务完成后：
                                          ① run_tests (测试通过？)
                                          ② run_lint (代码规范？)
                                          ③ git_commit_style (提交信息？)
                                                  ↓
                                          check_pr_readiness
                                          (lint + test + SAST + 依赖审计)
                                                  ↓
                                          /handoff 生成交接报告
```

#### 11.2 `/refactor` 的 Git 安全网

```
git stash (保存当前状态)
    ↓
执行重构 (lsp_rename → hashline_edit → ...)
    ↓
每步之后: run_tests + run_lint
    ↓
全部成功 → git stash drop
失败    → git stash pop (回滚)
```

#### 11.3 `/handoff` 的 Git 信息收集

```
task_graph_query → 获取已完成/进行中的节点
    ↓
git_history_search → 搜集相关 commit 记录
    ↓
生成报告：
  - Files Changed (来自 git diff)
  - Key Decisions Made (来自 commit history)
  - Test Status (来自 run_tests)
  - PR Readiness (来自 check_pr_readiness)
```

### 12. 何时提交代码

OpenCode 的 git 提交时机遵循以下原则：

1. **Agent 可以自主 commit**（Level 1 审计级），但**不会自主 push**（Level 2 需确认）
2. 提交时机由 Agent 自行判断——在完成一个逻辑单元的修改、测试通过、lint 通过之后
3. 每次 commit 必须符合 Conventional Commits 格式，通过 `git_commit_style` 工具验证
4. 复杂任务中，每个 DAG 节点完成后可产生一个或多个原子 commit
5. 最终推送到远端（push）需要更高的确认级别

---

## 第三部分：全景总览

```
┌─────────────────────────────────────────────────────────┐
│                     Runtime 内建层                        │
│  • Agentic Loop (LLM 调工具 → 执行 → 结果送回 → 循环)    │
│  • Snapshot/Revert (每步自动快照，可精确回滚)              │
│  • Session Fork (会话分叉)                                │
│  • Worktree 感知 (限定文件操作范围)                        │
│  • SSE 实时事件广播                                       │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│                     插件扩展层                            │
│  • Orchestrator (意图分类 + 模型路由 + 子会话 + Ralph)    │
│  • Task Graph (DAG 编排 + 状态机 + 依赖管理)             │
│  • Hashline Edit (hash 校验安全编辑)                      │
│  • Context Injection (AGENTS.md 规则注入)                 │
│  • Skills (领域技能模块化)                                │
│  • Tmux (终端会话管理)                                    │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│                  多 Agent 协作层                          │
│  Sisyphus(编排) → Prometheus(规划) → Metis(审计)         │
│  → Momus(验证) → Hephaestus(编码) / Oracle(诊断) / ...  │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│                   Git 安全层                              │
│  • 4 级权限分级 (Free / Audit / Confirm / Approve)       │
│  • Conventional Commits 强制约束                          │
│  • Rebase 工作流 (禁止 merge commit)                      │
│  • git stash 安全网 (重构前自动保存)                       │
│  • git_commit_style 自动验证                              │
│  • check_pr_readiness 门禁检查                            │
└─────────────────────────────────────────────────────────┘
```

本质上，OpenCode 是一个**带工具调用能力的 LLM Agent Loop 运行时**：接收指令 → 注入上下文 → 调用 LLM → 执行工具 → 将结果反馈给 LLM → 循环直到完成。所有的"智能"来自 LLM 的推理能力，OpenCode 本身是**执行引擎和工具协调器**。Git 操作作为其中的关键工具链，通过 4 级权限管控、Conventional Commits 约束、Snapshot/Revert 安全网和自动化质量门禁，确保代码变更的安全性和可追溯性。
