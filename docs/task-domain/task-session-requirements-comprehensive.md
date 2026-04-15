# Task & Session 领域综合需求文档

> 最后更新：2026-04-10
> 本文档全面整理 Opener-X 平台中"任务（Task）"与"会话（Session）"两大核心领域的需求，涵盖数据模型、生命周期、执行模式、消息系统、展示规则、API 边界和已锁定的架构决策。
>
> 运行时口径更新（2026-04-15）：当前默认 runtime backend 已切到 `pi-mono`。本文中若出现 `OpenCode` / `opencode runtime` 相关措辞，应优先理解为历史接入背景或底层 raw runtime 接口示例，而不是当前默认执行主链命名。

---

## 目录

1. [核心概念与术语](#1-核心概念与术语)
2. [领域模型总览](#2-领域模型总览)
3. [Task（任务）需求](#3-task任务需求)
4. [Session（会话）需求](#4-session会话需求)
5. [Execution Phase（执行阶段）需求](#5-execution-phase执行阶段需求)
6. [消息系统需求](#6-消息系统需求)
7. [三种执行模式](#7-三种执行模式)
8. [Workflow（工作流）需求](#8-workflow工作流需求)
9. [Timeline 与 Execution Trace](#9-timeline-与-execution-trace)
10. [快照与投影系统](#10-快照与投影系统)
11. [API 边界与路由契约](#11-api-边界与路由契约)
12. [前端展示规则](#12-前端展示规则)
13. [实时事件与流式传输](#13-实时事件与流式传输)
14. [成本核算与用量追踪](#14-成本核算与用量追踪)
15. [已锁定的架构决策（ADR）](#15-已锁定的架构决策adr)
16. [历史兼容与退役计划](#16-历史兼容与退役计划)
17. [关键约束与不变量](#17-关键约束与不变量)

---

## 1. 核心概念与术语

### 1.1 基础概念

| 概念 | 定义 | 说明 |
|------|------|------|
| **Task** | 用户可见的业务工作单元 | 稳定锚点；生命周期跨越多次执行 |
| **Session** | 一次执行尝试 | Task 下可以有多个 Session（重试、分支、并行候选） |
| **Execution Phase** | 一次编排轮次 | 管理 parallel/sequential 的候选分组与 winner 选择 |
| **Session Run** | Session 内的一次运行尝试 | Session 重试、resume、repair 时产生新 Run；`attemptIndex` 从 0 自增 |
| **Message** | 对话中的一条消息 | user/assistant/system/tool 四种角色 |
| **Message Part** | 消息的结构化组成部分 | text/tool_call/tool_result/thinking/file_reference/diff |
| **Operation** | 一次原子操作 | model_request/tool_call/judge/hook/resume/system |
| **Artifact** | 执行产出物 | result/report/diff/patch/file/image/archive/link |
| **Timeline View** | 统一时间线视图 | 跨 session/message/operation/artifact 的投影 |
| **Task Snapshot** | 任务快照 | 反范式化的当前状态，用于快速查询 |

### 1.2 层次关系

```
Organization
  └── Project
        └── Task (业务工作单元)
              ├── Task Snapshot (状态快照)
              ├── Execution Phase (编排轮次)
              │     └── Session (执行分支)
              │           ├── Session Run (运行尝试)
              │           ├── Message (对话消息)
              │           │     └── Message Part (消息部件)
              │           ├── Operation (原子操作)
              │           └── Artifact (产出物)
              ├── Timeline View (时间线投影)
              └── Usage Ledger Entry (用量账本)
```

### 1.3 两大子系统分离

- **Control Plane（控制面）**：治理、持久化、状态管理、审计
- **Runtime Backend（运行时后端）**：实际代码执行、LLM 调用、工具执行；当前默认接入为 `pi-mono`
- **BFF（前端聚合层）**：统一入口、认证代理、runtime 适配、任务聚合

> **关键分离**：Task/Session 是 Control Plane 的持久化概念；runtime session 是当前 runtime backend 的执行概念。历史上这层曾由 OpenCode runtime 承载，但今天默认主链已经切到 `pi-mono`。两者通过 `runtimeSessionId` 关联，但 ID 形态不同。

---

## 2. 领域模型总览

### 2.1 核心实体表

| 表名 | 主键 | 说明 |
|------|------|------|
| `tasks` | `id` (UUID) | 任务主表 |
| `task_execution_phases` | `id` | 执行阶段（编排轮次） |
| `task_sessions` | `id` (`task-session:{taskId}:{runtimeSessionId}`) | 会话（执行分支） |
| `task_session_runs` | `id` | 会话运行实例 |
| `task_messages` | `id` | 规范消息表 |
| `task_message_parts` | `id` | 消息部件表 |
| `task_operations` | `id` | 操作记录 |
| `task_artifacts` | `id` | 产出物 |
| `task_snapshots` | `task_id` (1:1) | 快照（反范式） |
| `task_timeline_views` | `id` | 时间线投影 |
| `task_usage_ledger_entries` | `id` | 用量账本 |

### 2.2 ID 命名规范

- **Canonical Session ID**: `task-session:{taskId}:{runtimeSessionId}` — 唯一标准形态
- **Legacy Alias**: `task_session:{taskId}:{runtimeSessionId}` — 仅内部兼容，不对外暴露
- **Runtime Session ID**: runtime backend 返回的原始 session ID；历史上常见形态是 OpenCode 的 `ses_xxx`
- **Branch Compat Node ID**: `branch-node:{taskId}:{runtimeSessionId}` — 项目树兼容节点

> **规则**：公共 API 响应只使用 `task-session:` 前缀的 canonical ID；内部存储可保留 legacy alias 但不泄漏到 BFF/前端。

---

## 3. Task（任务）需求

### 3.1 Task 生命周期

Task 有两套状态维度，分别记录在不同字段：

**持久化生命周期 (`tasks.lifecycleStatus`)**：
```
draft → active → done → archived
```

**执行状态 (`task_snapshots.currentExecutionStatus`)**：
```
queued → running → [awaiting_adoption] → complete → (failed / cancelled)
```

**公共 API 对外暴露的 `status` 是由上述两套状态归一后的合成值**，通过 `public-task-status.ts` 的 `resolvePublicTaskStatus()` 统一映射。归一优先级：`currentExecutionStatus` → `fallbackStatus` → `lifecycleStatus` → 默认 `pending`。

公共 status 只有以下 7 个值（`TaskStatus` 类型）：

| 公共 status | 来源 | 含义 |
|-------------|------|------|
| `pending` | executionStatus=queued 或 lifecycleStatus=draft | 待处理 |
| `running` | executionStatus=running 或 lifecycleStatus=active | 执行中 |
| `paused` | executionStatus=paused | 已暂停 |
| `awaiting_adoption` | executionStatus=awaiting_adoption | 待采纳 |
| `completed` | executionStatus=complete/completed 或 lifecycleStatus=done | 已完成 |
| `failed` | executionStatus=failed | 已失败 |
| `cancelled` | executionStatus=cancelled 或 lifecycleStatus=archived | 已取消 |

> **注意**：公共 API 中**不存在** `draft`、`active`、`archived` 值。`normalizePublicTaskStatusValue()` 将 `complete` → `completed`、`queued` → `pending`；`mapLifecycleStatusToPublicTaskStatus()` 将 `draft` → `pending`、`active` → `running`、`done` → `completed`、`archived` → `cancelled`。

### 3.2 Task 核心字段

```typescript
{
  id: string;                          // UUID
  projectId: string;                   // 所属项目
  title: string;                       // 任务标题
  prompt: string;                      // 用户原始 Prompt
  category: string;                    // 任务类别（影响 agent 选择）
  lifecycleStatus: TaskLifecycleStatus; // "draft" | "active" | "done" | "archived"
  strategyJson: object;                // 编排策略快照
  workflowTemplateId?: string;         // 关联工作流模板
  preferredModel?: string;             // 偏好模型
  // Git 相关
  repoId?: string;
  workspaceRoot?: string;
  baseRevision?: string;
  workingBranch?: string;
  finalCommitSha?: string;
  finalBranchName?: string;
  // 时间戳
  activatedAt?: string;
  doneAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 3.3 Task 策略对象 (strategyJson)

```typescript
interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  hooks: LifecycleHook[];
  followups: FollowupTemplate[];
  templates: WorkflowTemplate[];
  judge: JudgeConfig;
  organizationSettings?: PlatformOrganizationSettings;
}
```

> **注意**：`executionMode` 不在 `OrchestrationStrategy` 接口内，它是 task 级独立字段（`TaskExecutionMode = "single" | "parallel" | "sequential-chain"`）。并行相关的 `parallelCandidates` / `parallelJudge` 配置由执行层从 strategy + task 级字段组合构建，不直接存储在此接口中。

> **BFF ↔ DB 格式转换**：BFF 层 `executionMode` 用连字符 `"sequential-chain"`（`TaskOrchestrationKind`）；数据库层 `TaskSessionMode` 用下划线 `"sequential_chain"`。转换通过 `task-execution-mode.ts` 的 `toStoredTaskExecutionMode()` / `fromStoredTaskExecutionMode()` 完成。

> **重要**：`strategyJson` 从 service 返回时可能是 object 也可能是 JSON string，消费者必须兼容两种形态。

### 3.4 Task 权威状态源

- Task 页面和 Workbench tab 的主状态以 `/api/tasks/:id` 的显式 `status` 为准
- `/tasks/:id/tree` 只用于会话/树投影，**不当作权威状态源**
- `resolveTaskDisplayStatus()` 遇到显式 `completed` 必须显示已完成；并行候选数等启发式信息不能把已完成反推为"待采纳"

---

## 4. Session（会话）需求

### 4.1 Session 类型枚举 (sessionKind)

| sessionKind | 说明 | 典型场景 |
|-------------|------|---------|
| `primary` | 主会话 | 单一执行、首次执行 |
| `candidate` | 并行候选 | parallel 模式下的每个候选 |
| `judge` | 评判会话 | parallel 模式下的自动评判 |
| `sequential_step` | 顺序步骤 | sequential-chain 模式下的每一步 |
| `resume` | 恢复会话 | 从暂停/失败恢复 |
| `manual_branch` | 手动分支 | 用户手动创建分支 |
| `hook` | 钩子会话 | 生命周期钩子执行 |

### 4.2 Session 节点类型 (sessionType)

| sessionType | 说明 |
|-------------|------|
| `root` | 根会话 |
| `follow_up` | 跟进会话（continue） |
| `manual_branch` | 手动分支 |
| `workflow_spawn` | 工作流派生 |

### 4.3 Session 触发类型 (triggerType)

| triggerType | 说明 |
|-------------|------|
| `execute` | 首次执行 |
| `continue` | 继续对话 |
| `resume` | 恢复（从暂停/失败） |
| `workflow_spawn` | 工作流阶段派生 |
| `manual_branch` | 手动分支 |
| `hook_spawn` | 钩子派生 |
| `system_retry` | 系统自动重试 |

### 4.4 Session 两套状态字段

Session 同样有两套状态字段，职责不同：

**`status` (TaskSessionNodeStatus)** — 节点生命周期：
`queued` | `running` | `completed` | `failed` | `cancelled` | `interrupted` | `archived`

**`executionStatus` (ExecutionStatus)** — 执行进度：
`queued` | `running` | `awaiting_adoption` | `complete` | `failed` | `cancelled`

> **易混淆点**：`status=completed` 但 `executionStatus=running` 是历史脏数据的常见形态。采纳校验依赖 `executionStatus`，读取时必须兼容归一。`executionStatus` 用 `complete` 而非 `completed`。

**两套状态轨逻对比**：

| 场景 | `status` (NodeStatus) | `executionStatus` (ExecutionStatus) | 说明 |
|------|---|---|---|
| 创建未启动 | `queued` | `queued` | 初始状态 |
| 执行中 | `running` | `running` | 正常运行 |
| 执行完成 | `completed` | `complete` | ⨉ 拼写不同，这是设计意图不是事故 |
| 并行待采纳 | `completed` | `awaiting_adoption` | status 已进入终态但执行层未接结 |
| 失败 | `failed` | `failed` | 一致 |
| 取消 | `cancelled` | `cancelled` | 一致 |
| 中断 | `interrupted` | — | 仅 status 有此值，外部强制中断时触发 |
| 归档 | `archived` | — | 仅 status 有此值，用户主动归档时触发 |
| — | — | `awaiting_adoption` | 仅 executionStatus 有此值，并行全部完成后设置 |

> **更新时机**：`status` 由 session 生命周期事件驱动（创建、完成、归档）；`executionStatus` 由执行层状态机驱动（queued → running → complete/failed/cancelled/awaiting_adoption）。

### 4.5 Phase Role

| phaseRole | 说明 |
|-----------|------|
| `mainline` | 主线 |
| `candidate` | 候选 |
| `judge` | 评判 |
| `step` | 步骤 |
| `aux` | 辅助 |

### 4.6 Session 核心字段

```typescript
{
  id: string;                           // task-session:{taskId}:{runtimeSessionId}
  taskId: string;
  projectId: string;
  treeNodeId?: string;                  // 项目树关联节点
  parentSessionId?: string;             // 父会话（树结构）
  rootSessionId?: string;               // 根会话
  phaseId?: string;                     // 所属执行阶段
  sourceMessageId?: string;             // 源消息（fork/continue 的起点）
  sessionType: TaskSessionNodeType;     // root | follow_up | manual_branch | workflow_spawn
  sessionKind: TaskSessionKind;         // primary | candidate | judge | ...
  triggerType: TaskSessionTriggerType;  // execute | continue | resume | ...
  executionModeSnapshot: TaskSessionMode; // single | parallel | sequential_chain
  executionStatus: ExecutionStatus;     // queued | running | awaiting_adoption | complete | failed | cancelled
  status: TaskSessionNodeStatus;        // queued | running | completed | failed | cancelled | interrupted | archived
  // 工作流
  workflowStageKey?: string;            // 工作流阶段键
  spawnTriggerType?: string;            // 派生触发类型
  spawnRuleKey?: string;                // 派生规则键
  userPromptSummary?: string;           // 用户提示摘要
  // 并行/顺序元数据
  phaseRole?: TaskPhaseRole;
  phaseItemIndex?: number;
  candidateIndex?: number;
  stepIndex?: number;
  // 树层级与排序
  depth: number;                        // 树深度
  sortKey?: string;                     // 排序键
  operationId?: string;                 // 关联操作
  // 运行时关联
  runtimeSessionId?: string;
  branchName?: string;
  selectedModel?: string;
  effectiveModel?: string;
  forkedFromMessageId?: string;         // Fork 源消息
  // 会话级 winner/judge 引用
  winnerSessionId?: string;
  judgeSessionId?: string;
  // 会话头
  headMessageId?: string;               // 最新 completed assistant 消息
  latestRunId?: string;
  // Token 统计
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  // 结果
  resultText?: string;
  resultSummary?: string;
  errorText?: string;
  // 时间戳
  lastActivityAt: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
```

### 4.7 Session 层级与排序

- **Session 树由 `parentSessionId` 构成**，是层级结构
- **Task 级 session 排序按父拓扑（topology-first）**，不是按 `createdAt`
- **Session 内消息按时间序（time-ordered）**：`seq ASC, createdAt ASC`
- `latestSessionId` / 默认选中 session 不能从拓扑排序末尾推导，必须从生命周期时间戳单独计算

### 4.8 Session ID 规范化

- 公共 API 响应只使用 `task-session:` 前缀
- BFF 对外只接受 canonical `task-session:` 或 runtime session id
- BFF continue 调用 runtime 时必须还原为 runtime session id（pi-mono 按 runtime id 建索引）
- Agent-control pause/resume/terminate 也必须把 canonical id 先归一成 runtime session id

### 4.9 Session 完成判定

- **assistant message 有 `completedAt` 不等于 session 完成**：若 `info.finish` 是 `tool-calls` 或仍有非终态 tool_call，session 必须保持 `running`
- **`headMessageId` 只能推进到 completed assistant message**：completed tool/system message 只更新活动时间
- `awaiting_adoption` 兜底不能只看 `task.status`；必须同时满足：无 active live run + 存在 completed assistant message 或终态 run 证据

---

## 5. Execution Phase（执行阶段）需求

### 5.1 Phase Kind

| phaseKind | 说明 | 典型 Session 构成 |
|-----------|------|-------------------|
| `root` | 根阶段 | 初始化阶段 |
| `single` | 单一执行 | 1 个 primary session |
| `parallel` | 并行执行 | N 个 candidate session + 可选 judge session |
| `sequential_chain` | 顺序链 | N 个 sequential_step session（有序） |
| `manual_branch` | 手动分支 | 用户主动创建 |
| `hook` | 钩子执行 | 生命周期钩子 |

### 5.2 Phase Status

```
pending → running → completed
             │          ↑
             ├→ paused →┘
             │
             ├→ awaiting_adoption → completed
             │                         │
             ├→ failed                └→ cancelled
             └→ cancelled
```

> **常见路径**：`running → awaiting_adoption`（并行候选全部完成）、`running → completed`（单一执行完成）、`running → failed`（执行失败）。

### 5.3 Phase Trigger Type

| triggerType | 说明 |
|-------------|------|
| `execute` | 首次执行 |
| `continue` | 继续 |
| `resume` | 恢复 |
| `workflow_spawn` | 工作流派生 |
| `candidate_adopt` | 候选采纳 |
| `manual_branch` | 手动分支 |
| `hook_spawn` | 钩子派生 |

### 5.4 Phase Terminal Reason

| terminalReason | 说明 |
|---------------|------|
| `winner_adopted` | Winner 已采纳 |
| `user_cancelled` | 用户取消 |
| `runtime_terminated` | 运行时终止 |
| `runtime_failed` | 运行时失败 |
| `timeout` | 超时 |
| `superseded` | 被后续 phase 取代 |

### 5.5 Phase 核心字段

```typescript
{
  id: string;
  taskId: string;
  projectId: string;                    // 项目关联
  parentPhaseId?: string;               // 父 Phase（Phase 可嵌套）
  phaseIndex: number;
  phaseKind: TaskExecutionPhaseKind;
  triggerType: TaskExecutionPhaseTriggerType;
  status: TaskExecutionPhaseStatus;
  terminalReason?: TaskExecutionPhaseTerminalReason;
  // 并行相关
  candidateCount?: number;
  winnerSessionId?: string;
  judgeSessionId?: string;
  anchorSessionId?: string;
  anchorMessageId?: string;
  // 模型配置
  requestedModel?: string;
  effectiveModel?: string;
  // 结果
  resultSummary?: string;
  errorText?: string;
  // 时间戳
  awaitingAdoptionSince?: string;
  cancelRequestedAt?: string;
  cancelledAt?: string;
  lastHeartbeatAt?: string;
  startedAt?: string;
  finishedAt?: string;
  resumedFromPhaseId?: string;
}
```

### 5.6 Phase 采纳流程

1. 并行候选全部完成 → Phase 状态变为 `awaiting_adoption`
2. `awaitingAdoptionSince` 记录时间戳
3. Task 快照同步 `currentExecutionStatus: "awaiting_adoption"`
4. 用户手动选择 winner → `POST /api/tasks/:taskId/phases/:phaseId/candidates/:index/adopt`
5. BFF 先 adopt winner → 再 PATCH task `{ status: "completed", sessionId: winnerRuntimeSessionId }`
6. **不能只 adopt 不 patch**：否则页面刷新后任务回到 running

> ⚠ 旧的 `POST /api/tasks/:taskId/candidates/:index/adopt` 已返回 410，前端必须使用 phase-based 路由。

---

## 6. 消息系统需求

### 6.1 消息角色与类型

**Message Role** (`TaskSessionMessageRole`)：`user` | `assistant` | `system` | `tool`

**Message Kind** (`TaskMessageKind`)：`prompt` | `reply` | `note` | `tool_echo`

**Message Status** (`TaskMessageStatus`)：`pending` | `streaming` | `completed` | `failed` | `cancelled`

**Message Part Type** (`TaskSessionMessagePartType`)：`text` | `tool_call` | `tool_result` | `thinking` | `file_reference` | `diff`

> **类型同义词**：schema 中 `TaskSessionMessageRole` / `TaskSessionMessageStatus` / `TaskSessionMessagePartType` 与 `ConversationMessageRole` / `ConversationMessagePartType` 值完全相同，后者为已弃用的遗留名称。

### 6.2 消息核心字段

```typescript
{
  id: string;
  taskId: string;
  sessionId: string;
  role: TaskSessionMessageRole;
  messageKind: TaskMessageKind;
  seq: number;
  textContent?: string;
  textPreview?: string;
  partCount: number;
  status: TaskMessageStatus;
  // 规范字段（0034 迁移后）
  userInputText?: string;
  systemContextText?: string;
  finalSentText?: string;
  // ID 关联
  runtimeMessageId?: string;
  clientMessageId?: string;
  providerMessageId?: string;
  parentMessageId?: string;
  replyToMessageId?: string;
  createdByRunId?: string;
  // 时间戳
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 6.3 消息写入规则

1. **统一写入口**：`POST /api/tasks/:taskId/sessions/messages`
2. **稳定 message ID 必须**：service 从 `message.id` / `runtimeMessageId` / `messageID` / `info.id` 等字段解析；缺 id 时直接拒绝（HTTP 400），不回退到随机 UUID
3. **共享 runtime message schema**：`parseTaskSessionRuntimeMessage(...)` 归一入站 payload
4. **去重规则**：按 `runtimeMessageId` 做语义去重，优先保留终态（completed/error）记录
5. **时间戳修复**：
   - runtime `info.time.created/completed` 数值时间戳必须转 ISO string
   - terminal message 缺 timestamps 时：只有 completedAt → 复用为 createdAt；有 createdAt 无 completedAt → 从 createdAt 回填
6. **并行候选 user prompt 重路由**：候选子 session 的首条 user message 重路由到父 session，后续留在子 session

### 6.4 Tool 消息处理

- tool 事实 ID 必须统一为 `sessionId:tool:<callId>` 格式
- `tool.execute.before/after` 是单个 `message.part` 快照，不是 `parts[]`
- 同一 tool call 可能从 assistant message part 和 top-level snapshot 各写一次，必须按 `runtimeOperationId` 归一
- `task_message_parts` 对并发更新按 `(messageId, partIndex)` upsert，不能 `delete + insert`

### 6.5 空壳消息处理

- 旧数据可能包含 metadata-only shell 消息（空 text_content，无 parts）
- Service hydrate 规则：root session 用户壳用 `task.prompt` 补全；assistant 壳用 `snapshot.latestResult` 补全
- **`task.prompt` 只代表根 session 首条输入**，不能用于 child session 或后续空 user shell
- 已有结构化 tool-call parts 的 assistant 不做 hydrate

### 6.6 消息已退役的双写

- `task_session_messages` / `task_session_message_parts` 表已 drop（迁移 0030）
- 新写入只进入 `task_messages` / `task_message_parts`
- `rawPayload` 不再承担列值回填职责，只用于读取尚未拆列的结构化信息

---

## 7. 三种执行模式

### 7.1 Single（单一执行）

```
Task → Phase(single) → Session(primary) → Messages
```

- 生成 1 个候选
- 标签：`"主执行"`
- 完成后直接 `completed`

### 7.2 Parallel（并行竞争）

```
Task → Phase(parallel) → Session(candidate) × N
                       → Session(judge) × 0..1
```

**流程**：
1. 从模板 agent 或用户配置生成 N 个候选
2. 每个候选独立执行（first-class session）
3. 全部完成 → Phase `awaiting_adoption`
4. 可选 judge 自动评分 / 用户手动采纳
5. Winner 采纳 → Task `completed`

**关键规则**：
- 候选是 session，不是辅助数据
- 无 judge 时不自动选 winner，保留手动采纳
- `coordinationKey` 不再用于 UI 分组，只认 `phaseId`
- 新并行批次必须锚到显式 `parentSessionId`，不能从历史 root 推断

### 7.3 Sequential Chain（顺序链）

```
Task → Phase(sequential_chain) → Session(sequential_step) × N [有序]
```

**流程**：
1. 从策略生成带依赖关系的步骤
2. 每个步骤按依赖顺序执行
3. Phase 状态跟踪当前步骤进度（通过 `task_snapshots.completedChainSteps` / `totalChainSteps` 反映）
4. 全部完成 → Task `completed`

> **注意**：`currentChainStepIndex` 和 `chainResult` 是 BFF 内存运行时概念，不存储在数据库表中。持久化进度通过 `task_snapshots.completedChainSteps` / `totalChainSteps` 字段跟踪。

**关键规则**：
- 步骤有 `id`, `type: "chain-step"`, `title`, `instruction`, `status`, `dependsOn`
- BFF 注册时必须带 `sessionKind=sequential_step`, `executionModeSnapshot=sequential_chain`, `stepIndex`
- 后续 mirror writes 不能覆盖已有的 `sessionKind` / `executionModeSnapshot`

---

## 8. Workflow（工作流）需求

### 8.1 定位

> **Workflow 是规则域，不是状态机**：定义的是 stage/gate/hook/approval 条件；Task 才是运行时主体。

### 8.2 核心组件

| 组件 | 说明 |
|------|------|
| **Template** | 可复用的工作流模板（stages + hooks + 配置） |
| **Stage** | 工作流阶段（如 clarify → design → implement → verify） |
| **Hook** | 生命周期钩子（pre-execution, post-execution, on-failure 等） |
| **Gate** | 阶段间的进入条件 |

### 8.3 生命周期钩子

| Trigger | 时机 |
|---------|------|
| `pre-execution` | 执行前（prompt 检查/注入） |
| `post-execution` | 执行完成后 |
| `on-failure` | 执行失败时 |
| `on-pause` | 暂停时 |
| `pre-resume` | 恢复前 |
| `on-cancel` | 取消时 |

- 配置驱动：系统管理员定义模板；项目选择模板
- `order` 字段决定同一触发器下的执行顺序

### 8.4 Stage 执行

- `buildStageArtifactSummary` 检测 `[STAGE_COMPLETE]` 标记
- `buildWorkflowExecutionPromptSnapshot` 返回阶段目标、已完成输出、待定阶段
- BFF 执行路由已删除 workflow prompt 注入 / stage hook 拉取逻辑
- Workflow 路由仍然活跃：`POST /:taskId/workflow/advance`、`POST /:taskId/workflow/initialize`、`POST /:taskId/workflow/retry-stage`、`GET /:taskId/workflow` 均在 Service 层正常运行
- BFF 提供 `GET /:taskId/workflow`（代理到 Service）和 `GET /:taskId/workflow-view`（聚合视图）

### 8.5 Workflow 启动超时

- `ensureTaskWorkflowStarted()` 可能阻塞数十秒（多轮 stage intervention）
- Execute 路由先同步完成主 session 创建与 task patch，workflow startup sync 放后台

---

## 9. Timeline 与 Execution Trace

### 9.1 Timeline View 投影

```typescript
{
  id: string;
  taskId: string;
  phaseId?: string;
  sessionId?: string;
  messageId?: string;
  operationId?: string;
  artifactId?: string;
  itemKind: "task_lifecycle" | "session" | "message" | "operation" | "artifact";
  itemRole?: TaskSessionMessageRole;
  phaseIndex?: number;
  phaseKind?: TaskExecutionPhaseKind;
  phaseRole?: TaskPhaseRole;
  phaseItemIndex?: number;
  title?: string;
  displayText?: string;
  metadataJson: object;
  sortAt: string;
  createdAt: string;
}
```

### 9.2 Execution Trace 读取边界（已锁定 ADR）

**主源**：`task_timeline_views` 投影

**辅助源**：Service timeline — 仅当投影为空/不可用时补位

**不是源**：runtime backend 原始 message 接口（历史上体现为 OpenCode runtime `GET /session/:id/message`）— 底层协议/诊断接口，不是公开 trace fallback

**规则**：
1. 投影返回非空 timeline → 保留即使 `complete=false`，不切到 service timeline 覆盖
2. 投影为空 → service timeline 补位
3. Runtime fallback → 只有当投影和 service timeline 都不可用时
4. 必须保留 incomplete 状态，不允许静默切换源

### 9.3 Projection 读取

- BFF 调用 `/api/tasks/:taskId/timeline-view` 需用 canonical `sessionId`，不是 `runtimeSessionId`
- Service 投影使用 generic `itemKind` (`message` / `operation` / `artifact`) + `itemRole` / `metadataJson.sourceKind`
- BFF trace mapping 不能只假设 legacy `user-input` / `tool-call` item kinds

### 9.4 候选 Execution Trace

- 候选 session 的 `snapshot.latestResult` 不能复用主会话结果
- 仅当 requestedSessionId 为空或等于 task.sessionId 时才允许回退到 snapshot
- 空投影 + session messages 仍存在场景：projection 为空不能 block runtime fallback

---

## 10. 快照与投影系统

### 10.1 Task Snapshot

```typescript
{
  taskId: string;                       // 1:1 与 Task
  projectId: string;
  lifecycleStatus: string;              // 镜像 tasks.lifecycleStatus
  currentExecutionMode?: string;
  currentExecutionStatus?: string;      // ExecutionStatus 枚举，需归一化后暴露
  currentPhaseId?: string;
  latestPhaseId?: string;
  currentSessionId?: string;            // 可能是 runtime id，需 canonicalize
  latestSessionId?: string;
  latestResultSummary?: string;
  latestErrorText?: string;
  activeCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
  lastActivityAt: string;
}
```

### 10.2 Snapshot 状态归一化

Service 读路径通过 `resolvePublicTaskStatus()` 将内部状态归一到公共 `TaskStatus`：

**ExecutionStatus 归一規则 (`normalizePublicTaskStatusValue`)**：
- `complete` / `completed` → `completed`
- `queued` / `pending` → `pending`
- `running` / `paused` / `awaiting_adoption` / `failed` / `cancelled` → 保持原值
- 其他值 → `null`（继续 fallback）

**LifecycleStatus Fallback 规则 (`mapLifecycleStatusToPublicTaskStatus`)**：
- `done` → `completed`
- `active` → `running`
- `archived` → `cancelled`
- `draft` → `pending`

> 如果 `complete` 泄漏到 API，BFF 等待 `snapshot.currentStatus === "completed"` 会超时

### 10.3 公共状态归一化

- 所有状态归一通过 `modules/tasks/public-task-status.ts` 共享 helper
- Project tree, snapshot read, project overview, dashboard, legacy workflow reads 都走同一 helper
- 不允许各自独立 re-mapping

---

## 11. API 边界与路由契约

### 11.1 BFF 公共路由 (Web UI → BFF)

> 所有路由挂载在 `/api/tasks`，共 53 个注册（含 session/branch 双路径别名）。

**Task CRUD 与状态**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/` | 列出任务（带投影快照） |
| `POST` | `/` | 创建任务 |
| `GET` | `/:taskId` | 获取任务详情读模型 |
| `PATCH` | `/:taskId` | 更新任务字段（status/model/branch 等） |
| `POST` | `/:taskId/complete` | 手动标记任务完成 |
| `POST` | `/reconcile-running` | 管理员对账（修复残留 running 状态） |

**Task 执行**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/execute/preflight` | 执行预检（paid guard / 模型校验） |
| `POST` | `/:taskId/execute` | 启动 agent 执行 |
| `POST` | `/:taskId/continue` | 继续对话（发送后续 prompt） |

**Session / Branch 管理**（session 和 branch 为双路径别名）：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/sessions` | 列出 session（legacy alias） |
| `GET` | `/:taskId/branches` | 列出分支 |
| `GET` | `/:taskId/session-lineage` | Session 谱系树（legacy alias） |
| `GET` | `/:taskId/branch-lineage` | 分支谱系树 |
| `POST` | `/:taskId/sessions/:sessionId/fork` | Fork session |
| `POST` | `/:taskId/branches/:sessionId/fork` | Fork branch（别名） |
| `POST` | `/:taskId/sessions/:sessionId/activate` | 激活 session |
| `POST` | `/:taskId/branches/:sessionId/activate` | 激活 branch（别名） |
| `POST` | `/:taskId/sessions/:sessionId/archive` | 归档 session |
| `POST` | `/:taskId/branches/:sessionId/archive` | 归档 branch（别名） |

**Phase 管理**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/phases` | 列出执行阶段 |
| `POST` | `/:taskId/phases` | 创建/Upsert 阶段 |
| `POST` | `/:taskId/phases/:phaseId/candidates/:index/adopt` | 采纳候选 |
| `POST` | `/:taskId/phases/:phaseId/cancel` | 取消阶段 |
| `POST` | `/:taskId/phases/:phaseId/resume` | 恢复阶段 |

**消息**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/query/normalized-conversation` | 规范化对话 |
| `GET` | `/:taskId/messages` | 获取 task 消息（compat） |
| `GET` | `/:taskId/sessions/:sessionId/messages` | Session 消息 |
| `GET` | `/:taskId/query/raw-events` | 原始事件 |
| `POST` | `/:taskId/repair-messages` | 修复消息（admin） |

**时间线、树与 Trace**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/timeline` | 任务时间线 |
| `GET` | `/:taskId/execution-trace` | Execution trace |
| `GET` | `/:taskId/tree` | 任务会话树 |
| `GET` | `/:taskId/graph` | DAG 可视化 |
| `GET` | `/:taskId/pipeline` | 运行时 Pipeline 结果 |

**运行模式与协作**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/operating-state` | 运行时状态（协作/自动驾驶） |
| `GET` | `/:taskId/operating-mode` | 获取运行模式 |
| `PUT` | `/:taskId/operating-mode` | 设置运行模式 |
| `DELETE` | `/:taskId/operating-mode` | 删除运行模式 |
| `GET` | `/:taskId/boss-decisions` | Boss 决策列表 |
| `POST` | `/:taskId/boss-decisions` | 创建 Boss 决策 |
| `GET` | `/:taskId/escalations` | 人工升级请求列表 |
| `POST` | `/:taskId/escalations` | 创建升级请求 |
| `GET` | `/:taskId/role-conclusions` | 角色结论 |
| `GET` | `/:taskId/developer-change-requests` | 开发变更请求 |
| `PATCH` | `/:taskId/developer-change-requests` | 更新变更请求状态 |

**视图与治理**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/workflow` | 工作流（代理到 Service） |
| `GET` | `/:taskId/workflow-view` | 工作流聚合视图 |
| `GET` | `/:taskId/member-view` | 团队成员视图 |
| `GET` | `/:taskId/governance` | 治理概览 |
| `GET` | `/:taskId/changes` | 代码变更列表 |
| `GET` | `/:taskId/changes/:changeId/files` | 变更文件列表 |

**运行时权限**：
| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/:taskId/runtime-permissions` | 运行时权限请求列表 |
| `POST` | `/:taskId/runtime-permissions/:requestId/reply` | 回复权限请求 |

> **注意**：Task 删除（DELETE）在 Service 层 `task-core-routes.ts` 实现，BFF 层不直接暴露 DELETE 路由。

### 11.2 Service 内部路由 (BFF → Service)

Control Plane Service 是内部服务，**不对前端直接暴露**。BFF 作为代理调用。

### 11.3 已退役路由

| 路由 | 状态 |
|------|------|
| `POST /api/tasks/:taskId/candidates/:index/adopt` | 返回 410 |
| `GET/POST /api/tasks/:taskId/domain-runs*` | 已删除 |
| `GET /api/tasks/:taskId/branches/:runtimeSessionId/timeline` | 降级为 legacy |

### 11.4 删除级联顺序

删除 task 时在单个事务内按以下顺序执行（源码：`task-core-routes.ts#deleteTaskTreeBackedTask`）：

```
1. task_message_parts (via subquery on task_messages)
2. task_timeline_views
3. task_usage_ledger_entries
4. task_artifacts
5. task_operations
6. task_messages
7. task_session_runs
8. UPDATE task_sessions SET parent_session_id=NULL, root_session_id=NULL,
   judge_session_id=NULL, winner_session_id=NULL, forked_from_message_id=NULL
   -- ↑ 先 NULL 化自引用 FK 才能删除
9. task_snapshots
10. task_sessions
11. task_stage_runs (via subquery on task_workflow_runs)
12. task_workflow_runs
13. task_operating_modes
14. boss_decisions
15. human_escalations
16. developer_change_requests
17. role_aggregate_conclusions
18. runtime_usage_ledger_steps
19. runtime_usage_ledgers
20. file_changes (via subquery on code_changes)
21. code_changes
22. UPDATE tasks SET spawned_from_task_id=NULL WHERE spawned_from_task_id=:id
23. tasks
-- 如果关联了 project_tree_nodes：
24. UPDATE project_tree_nodes SET parent_id=NULL, superseded_by=NULL
25. project_tree_links
26. project_tree_branches
27. project_tree_nodes
```

---

## 12. 前端展示规则

### 12.1 对话消息展示顺序

1. **后端决定顺序，前端不重排**
2. Session messages: `seq ASC, createdAt ASC`
3. Timeline: `sortAt ASC, createdAt ASC`
4. UI 仅在尾部追加未持久化的 streaming assistant 草稿

### 12.2 角色分类

- 优先取 `info.role` → 回退 `record.role` → 默认 `system`
- `system` 消息在会话展示层过滤
- 工具调用作为 assistant 的 `toolCalls` 附属展示
- tool-only assistant 归类为 assistant

### 12.3 统一对话时间线

```
历史消息 → 并行比较卡片 → 采纳结果 → 后续顺序链步骤
```

- Adopted 并行轮次保留 winner assistant 作为主线回复
- 压掉 loser candidate session 消息
- 压掉同 session 已有真实 prompt 时的 `Execution context:` user 消息

### 12.4 并行候选卡片

- 展示消息以 session fallback 为主源，不是 execution-trace
- 模型展示优先级：`agentRun.modelUsed` → `sessionSummary.selectedModel` → `strategy.parallelCandidates[].model`
- 分组只认 canonical `phaseId`，`coordinationKey` 不参与 explicit parallel group
- `parallelRunId` 保持 `task-session:${phaseId}` 形态做 UI 稳定键
- 同一 tool call 的重复投影折叠为一张工具调用卡

### 12.5 Session 选择

- Direct continue 优先使用 `task.sessionId`，`selectedSessionId` 只当展示/浏览状态
- 不能让陈旧 root selection 主导 `currentParallelRunId`
- 历史已采纳后新并行：`currentParallelRunId` 先比较 `task.sessionId` 关联的最新 run

---

## 13. 实时事件与流式传输

### 13.1 核心实时事件

| 事件 | 说明 | 主要消费者 |
|------|------|-----------|
| `task.message.created` | 新消息 | 对话 UI |
| `task.message.delta` | 增量更新（streaming） | 实时打字效果 |
| `task.message.updated` | 消息完成/更新 | 状态刷新 |
| `task.message.completed` | 消息完成 | session 状态判断 |
| `task.message.failed` | 消息失败 | 错误处理 |
| `task.operation.updated` | 操作状态变更 | 工具进度 |
| `task.snapshot.updated` | 快照更新 | 全局状态 |

### 13.2 BFF SSE → WebSocket Bridge

- BFF 作为 runtime SSE 到前端 WebSocket 的桥梁
- 严格按事件派发到对应 task/session
- `rawType` 只用于非消息自定义原因（如 `task.followup.completed`）

### 13.3 Patch Feed 共享

- `useTaskMessageStore` 和 `useMultiTaskMessageStore` 通过 `useTaskMessagePatchFeed` 共享
- `useTaskMessagePatchConsumer()` 统一 patch feed + live assistant state manager + 共享 patch effects
- TaskDetail 只消费 `latestTaskRefreshRequest` / `liveAssistantState` / `realtimeConnected`

---

## 14. 成本核算与用量追踪

### 14.1 Usage Ledger Entry

**Entry Kind** (`TaskUsageEntryKind`): `model_request` | `judge_request` | `hook_request` | `tool_request` | `system_overhead`

```typescript
{
  id: string;
  taskId: string;
  sessionId?: string;
  messageId?: string;
  operationId?: string;
  entryKind: TaskUsageEntryKind;
  providerId?: string;
  modelId?: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  currencyCode: string;                 // 默认 "USD"
  recordedAt: string;
  metadataJson: object;
}
```

### 14.2 多层聚合

- Operation 级：每次 model/tool 调用
- Session 级：`task_sessions.inputTokens/outputTokens/totalTokens/costUsd`
- Task 级：通过 ledger 聚合
- Project 级：通过 task 聚合

---

## 15. 已锁定的架构决策（ADR）

### ADR-1: Execution Trace Read Boundary

**状态**：已锁定

- 投影（`task_timeline_views`）作为主源
- Service timeline 作为受限二级源
- Runtime raw messages 不属于公开 trace 契约
- 不允许在 partial projection 时静默切源

### ADR-2: Session-First Hard Cut

**状态**：已锁定

- Task page 读面只走 session-first 表 / task-domain 投影
- 不 fallback 到 runtime backend 原始 messages（历史上曾体现为 opencode runtime messages）
- Session-first 数据为空时保留空状态，让 UI 显式处理

### ADR-3: Message Write Boundary

**状态**：已锁定（`docs/task-session-message-write-boundary-adr.md`）

- 单一写入口 `POST /api/tasks/:taskId/sessions/messages`
- 共享 runtime message schema parse
- Canonical-only 写入（不再双写 legacy 表）

### ADR-4: Public ID Shape

**状态**：已锁定

- 公共 API 只暴露 `task-session:` 前缀
- 内部可保留 `task_session:` 但不泄漏
- Branch compat node 使用 `branch-node:` 前缀

### ADR-5: Phase-First Parallel Group

**状态**：已锁定

- UI 并行分组只认 canonical `phaseId`
- `coordinationKey` 不参与 explicit parallel group
- `parallelRunId` = `task-session:${phaseId}`

---

## 16. 历史兼容与退役计划

### 16.1 已完全退役

| 组件 | 状态 |
|------|------|
| `task_session_messages` / `task_session_message_parts` 表 | 已 DROP（迁移 0030） |
| `executionPlan` / `parallelRunHistory` task 字段 | 已从 API 响应消失 |
| `domain-runs` 路由 (BFF + Service) | 已删除，源码引用归零 |
| `legacy-parallel-backfill` | 已物理删除 |
| `conversation_messages` / `conversation_message_parts` 生产 fallback | 已移除 |
| Tree `content_json` 业务字段 | 已清空为 `{}` |
| `ConversationSessionKind` / `ConversationMessageRole` 类型 | 在 schema.pg.ts 中定义但零处引用，属于死代码 |

### 16.2 仍保留的兼容

| 组件 | 原因 |
|------|------|
| `task_session:` 前缀（project-tree compat node） | 内部兼容存储 |
| `task-session-read-compat.ts` | cached-message fan-in + legacy message 归一化 |
| `task-session-parallel-compat.ts` | pending parallel 抑制 |
| `task-session-runtime-workflow-compat.ts` | runtime workflow session 发现 |
| `task-session-workflow-group-compat.ts` | workflow-group 装配 |
| Service `task-core-routes.ts` 删除时清旧表数据 | 顺手清扫历史 |

### 16.3 退役方向

- BFF `task-session-compat.ts` 已收缩为 thin legacy barrel
- 主线模块应从 `task-session-store.ts` 导入
- Compat 读取从 `task-session-read-compat.ts` 显式导入

---

## 17. 关键约束与不变量

### 17.1 数据库约束

| 约束 | 说明 |
|------|------|
| `task_messages_time_order_chk` | `createdAt <= completedAt` |
| `task_messages_completed_time_chk` | terminal status 必须有 completedAt |
| `task_sessions_root_source_pair_chk` | 有 source_message_id 则必须有 parent_session_id |
| `idx_task_messages_session_seq` | Session 内 seq 唯一 |
| `idx_task_sessions_candidate_per_group` | Phase 内 candidateIndex 唯一 |
| `task_message_parts (messageId, partIndex)` | Part 按 (messageId, partIndex) upsert |

### 17.2 业务不变量

1. Task 是稳定锚点；Session 是执行分支 — 不可互换
2. 一个 Message 只属于一个 Session
3. Event log 只做 internal debug/audit，不进入 UI/BFF 主读链
4. `headMessageId` 只推进到 completed assistant message
5. Phase 采纳后必须同时 PATCH task 状态
6. Snapshot `currentExecutionStatus` 必须通过共享 helper 归一化
7. Continue 请求优先使用 `task.sessionId`，不用 UI `selectedSessionId`
8. 并行新批次 `coordinationKey` 必须锚到显式 `parentSessionId`
9. BFF synthetic user-prompt 时间戳必须在 `createSession()` 前捕获
10. Tool continuation（`info.finish = tool-calls`）不代表 session 完成

### 17.3 清理约束

- Session cleanup 不可 null `parent_session_id` / `root_session_id`（会触发 check 约束）
- 先 archive 再清 FK-bearing refs
- 删除顺序严格按 FK 链执行

---

## 附录 A: Session Run 类型枚举

**Run Trigger Type**：`user_prompt` | `assistant_reply` | `parallel_result` | `resume` | `workflow_spawn` | `manual_branch` | `system_retry`

**Run Execution Kind**：`single` | `parallel_candidate` | `judge` | `repair` | `resume` | `workflow_step` | `hook`

**Run Lane Role**：`primary` | `candidate` | `judge` | `repair` | `resume` | `hook`

## 附录 B: 操作种类

| operationKind | 说明 |
|---------------|------|
| `model_request` | LLM 调用 |
| `tool_call` | 工具调用 |
| `judge` | 评判操作 |
| `hook` | 钩子操作 |
| `resume` | 恢复操作 |
| `system` | 系统操作 |

## 附录 C: 产出物种类

| artifactKind | storageKind |
|-------------|-------------|
| `result` | inline / blob_ref |
| `report` | inline |
| `diff` | inline / git_ref |
| `patch` | inline / git_ref |
| `file` | blob_ref |
| `image` | blob_ref / external_url |
| `archive` | blob_ref |
| `link` | external_url |

## 附录 D: 树任务聚合指标

```typescript
{
  runningTasks: number;
  activeSessionCount: number;
  parallelTaskCount: number;
  recentTimelineItemCount: number;
}
```
