# 并行执行 + 裁判自动评选方案

> 状态：草案 · 2026-03-20
> 注：本文中把裁判结果写回 `executionPlan` 的描述已过时。当前并行裁判结果以 task domain run / judge 节点和 winner 结果为准，不应再把 `executionPlan` 当成现行落点。

---

## 1. 背景与目标

当前并行执行已具备基础能力：用户在工作台选择「并行比较」模式后，可配置 2–5 个候选模型同时执行任务，执行完成后用户手动「采纳」某个候选结果作为主线回复。

后端虽然已实现 `JudgeConfig` / `JudgeResult` 数据模型以及 `runJudgeEvaluation` 流程，但**前端 UI 尚未暴露裁判配置入口**——用户无法在工作台中开启/配置裁判，也无法选择裁判模型和评选策略。

**本次目标**：

| # | 目标 | 说明 |
| --- | --- | --- |
| G1 | 裁判配置前端化 | 在执行模式弹窗中加入裁判开关、模型选择、评选策略 |
| G2 | 自动评分选优 | 裁判启用后，所有候选完成时自动评分并选出最优方案 |
| G3 | 无裁判手动选择 | 裁判未启用时保持现有行为：用户手动采纳 |
| G4 | 结果可视化增强 | 在候选结果卡片展示评分详情、裁判推理过程 |

---

## 2. 现有架构快照

```text
┌────────────────────┐       ┌─────────────────────┐       ┌──────────────────┐
│  ExecutionModeModal │──────►│  BFF /tasks/:id      │──────►│  opencode runtime │
│  (配置并行候选)      │       │  /execute            │       │  (各候选 session)  │
└────────────────────┘       │  /candidates/:i/adopt│       └──────────────────┘
                             └─────────────────────┘
                                      │
                              SSE Aggregator
                              finalizeParallelTask()
                                      │
                             ┌────────▼────────┐
                             │ runJudgeEval()   │  ← judge.enabled 时触发
                             │ (后端已实现)      │
                             └─────────────────┘
```

### 关键文件

| 文件 | 职责 |
| --- | --- |
| [control-plane/web-ui/src/components/ExecutionModeModal.vue](control-plane/web-ui/src/components/ExecutionModeModal.vue) | 执行模式选择弹窗（**需改造**） |
| [control-plane/web-ui/src/components/task-detail/TaskParallelCandidatesCard.vue](control-plane/web-ui/src/components/task-detail/TaskParallelCandidatesCard.vue) | 并行候选结果卡片（**需增强**） |
| [control-plane/web-ui/src/pages/TaskDetail.vue](control-plane/web-ui/src/pages/TaskDetail.vue) | 工作台主页面 |
| [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](control-plane/web-ui-bff/src/lib/orchestration-strategy.ts) | 编排策略 & Judge 类型定义 |
| [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) | 并行完成检测 + Judge 评估执行 |
| [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts) | 任务 API（execute / adopt） |

### 现有数据模型

```typescript
// 已存在于 orchestration-strategy.ts
interface JudgeConfig {
  enabled: boolean;
  agent: string;
  model: string;
  promptTemplate: string;
  timeoutMs: number;
  selectionStrategy: "judge-pick" | "highest-score";
}

interface JudgeResult {
  status: "completed" | "failed" | "skipped";
  sessionId?: string;
  winnerIndex?: number;
  scores?: number[];
  model?: string;
  tokenUsed?: number;
  reasoning: string;
  completedAt: string;
}
```

---

## 3. 整体流程设计

```text
用户打开 ExecutionModeModal
  │
  ├─ 选择「并行比较」模式
  │   ├─ 配置 2–5 个候选模型
  │   └─ [ 新增 ] 裁判配置面板
  │       ├─ 开关：启用裁判评选
  │       ├─ 裁判模型：从可用模型列表选择
  │       ├─ 评选策略：judge-pick / highest-score
  │       └─ (高级) 自定义评审提示语
  │
  ▼
保存到 task.strategy（含 judge 配置）
  │
  ▼
用户发送消息 → 触发并行执行
  │
  ├─ 候选 1 执行中 ──┐
  ├─ 候选 2 执行中 ──┤  并行
  └─ 候选 N 执行中 ──┘
  │
  ▼ 所有候选 settled
  │
  ├── [裁判启用] ──────────────────────────────────────┐
  │   SSE Aggregator 检测到全部完成                      │
  │   → runJudgeEvaluation()                            │
  │   → 裁判模型收到所有候选结果 + 评审提示               │
  │   → 返回 JSON: {winnerIndex, scores[], reasoning}   │
  │   → 自动写入 task domain run judge 节点结果          │
  │   → winnerCandidateIndex 设为胜出候选                │
  │   → 胜出候选的 result 成为任务主线回复                │
  │   → 前端展示评分详情 + 裁判推理                      │
  │                                                     │
  ├── [未启用裁判] ──────────────────────────────────────┐
  │   所有候选完成后                                     │
  │   → 不自动选出胜者（winnerCandidateIndex = -1）      │
  │   → 前端展示「采纳」按钮                             │
  │   → 用户手动点击某候选的「采纳」                     │
  │   → POST /candidates/:index/adopt                   │
  │   → 该候选 result 成为任务主线回复                   │
  │                                                     │
  └── [裁判评估失败] ──────────────────────────────────┐
      judgeResult.status = "failed"                    │
      → 降级为手动选择模式                              │
      → 前端提示「裁判评估失败，请手动采纳」             │
```

---

## 4. 前端改造详细设计

### 4.1 ExecutionModeModal — 新增裁判配置区

在「并行比较」模式下，候选模型列表下方新增可折叠的裁判配置面板：

```text
┌─────────────────────────────────────────────────────┐
│ 选择执行模式                                         │
│                                                     │
│ ○ 单次执行   ● 并行比较   ○ 顺序编排                 │
│                                                     │
│ 候选模型                                             │
│ ┌─────────────────────────────┬────────────┬──────┐ │
│ │ openai/gpt-4o             ▼│ GPT-4o     │ 删除 │ │
│ ├─────────────────────────────┼────────────┼──────┤ │
│ │ anthropic/claude-sonnet   ▼│ Claude     │ 删除 │ │
│ └─────────────────────────────┴────────────┴──────┘ │
│ + 添加候选                                           │
│                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                     │
│ 🏛 裁判评选                              [开关 ○ ]  │
│                                                     │
│ ┌ (开关打开后展开) ──────────────────────────────┐   │
│ │ 裁判模型   [ openai/gpt-4o              ▼ ]   │   │
│ │ 评选策略   ○ 裁判直接指定   ● 最高评分优先     │   │
│ │                                                │   │
│ │ ▸ 高级设置                                     │   │
│ │   评审提示语  [───────────────────────────]    │   │
│ │   超时时间    [ 30 ] 秒                        │   │
│ └────────────────────────────────────────────────┘   │
│                                                     │
│                            [ 取消 ]  [ 保存配置 ]    │
└─────────────────────────────────────────────────────┘
```

#### 交互规则

| 字段 | 规则 |
| --- | --- |
| 裁判开关 | 默认关闭；打开后展开配置区 |
| 裁判模型 | 复用现有 `modelOptions` 列表；默认选第一个可用模型；**不能与候选模型完全重复**（提示但不阻拦） |
| 评选策略 | `judge-pick`（裁判直接指定胜者）或 `highest-score`（按评分数值取最高）；默认 `judge-pick` |
| 评审提示语 | 默认使用 `DEFAULT_JUDGE_PROMPT`；支持用户自定义；模板变量 `{{taskTitle}}` `{{taskPrompt}}` `{{candidateResults}}` |
| 超时时间 | 默认 30s，范围 10–120s |

#### Emit 数据结构变更

```typescript
// ExecutionModeModal @confirm 事件 payload
interface ExecutionOverrides {
  mode: "parallel";
  candidates: Array<{ model: string; label?: string }>;
  // ---- 新增 ----
  judge?: {
    enabled: boolean;
    model: string;
    selectionStrategy: "judge-pick" | "highest-score";
    promptTemplate?: string;     // 为空则使用默认
    timeoutMs?: number;          // 为空则使用默认 30000
  };
}
```

### 4.2 TaskDetail.vue — 主线回复逻辑增强

#### 场景矩阵

| 裁判启用 | 裁判结果 | UI 行为 |
| --- | --- | --- |
| ✅ 是 | `completed` + winnerIndex 有效 | 自动高亮胜出候选，显示评分卡片，胜出候选的回复作为主线 |
| ✅ 是 | `failed` | 显示警告「裁判评估失败」，降级为手动采纳模式 |
| ✅ 是 | 正在运行 | 候选结果区域显示「裁判评估中…」loading 状态 |
| ❌ 否 | N/A | 现有行为：展示「采纳」按钮，用户手动选择 |

#### 主线回复确定规则

```typescript
// 伪代码
if (winnerCandidateIndex >= 0) {
  // 已有胜者（裁判选出 或 用户手动采纳）
  mainReply = candidates[winnerCandidateIndex].result;
} else if (judgeResult?.status === 'failed') {
  // 裁判失败 → 展示手动采纳按钮
  showManualAdoptButtons = true;
} else if (allCandidatesSettled && !judgeConfig.enabled) {
  // 无裁判 → 展示手动采纳按钮
  showManualAdoptButtons = true;
} else {
  // 候选仍在执行 或 裁判仍在评估
  showRunningState = true;
}
```

### 4.3 TaskParallelCandidatesCard — 评分结果可视化

在现有候选卡片基础上增强：

```text
┌─────────────────────────────────────────────────────────┐
│ 并行候选结果                                             │
│                                                         │
│ ┌─ 候选 1 ─ GPT-4o ─ [已完成] ─ ★ 胜出 ──────────────┐ │
│ │ 评分: 87.5                                          │ │
│ │ 这个问题可以通过以下步骤解决...                       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─ 候选 2 ─ Claude ─ [已完成] ──────────────── [采纳] ┐ │
│ │ 评分: 72.0                                          │ │
│ │ 分析该问题需要考虑以下因素...                        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─ 裁判评审 ─────────────────────────────────────────┐  │
│ │ ℹ 裁判(gpt-4o)已选出 候选 1，得分 87.5 / 72.0      │  │
│ │                                                     │  │
│ │ 推理：候选 1 的回复更加结构化，覆盖了所有关键步骤，   │  │
│ │ 且代码示例更为规范。候选 2 虽然对问题背景分析较为      │  │
│ │ 深入，但缺少可操作的实施步骤。                        │  │
│ └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**新增 props：**

```typescript
interface Props {
  candidates: ExecutionCandidate[];
  winnerIndex: number;
  allSettled: boolean;
  adoptingIndex: number | null;
  judgeSummary?: string;
  judgeReasoning?: string;
  // ---- 新增 ----
  judgeStatus?: "running" | "completed" | "failed" | "skipped";
  judgeScores?: number[];           // 每个候选的评分
  judgeEnabled: boolean;            // 是否配置了裁判
}
```

**新增显示元素：**

| 元素 | 条件 | 说明 |
| --- | --- | --- |
| 候选评分标签 | `judgeScores[i]` 存在 | 在候选模型标签旁显示评分 |
| 裁判运行中 spinner | `judgeStatus === 'running'` | 候选全部完成后、裁判结果出之前 |
| 裁判失败警告 | `judgeStatus === 'failed'` | 提示裁判评估失败，请手动采纳 |
| 手动采纳按钮 | `!judgeEnabled` 或 `judgeStatus === 'failed'` | 保持现有采纳逻辑 |

---

## 5. 后端改造详细设计

### 5.1 策略序列化 — 透传 judge 配置

**文件**：`orchestration-strategy.ts`

当前 `serializeTaskStrategy()` 已支持将 `judge` 字段写入 `task.strategy` JSON。需要确保：

1. `ExecutionOverrides.judge` 从前端传入后正确合并到 `OrchestrationStrategy.judge`
2. `buildRuntimePlan()` 使用**任务级** judge 配置（来自 overrides），而非全局 `readOrchestrationStrategy()`

```typescript
// 改造 buildRuntimePlan 签名，接收 task-level judgeConfig
export function buildRuntimePlan(
  template: WorkflowTemplate,
  strategy: OrchestrationStrategy,
  category: string,
  overrides?: {
    mode?: ExecutionMode;
    candidates?: Array<{ model: string; label?: string }>;
    judge?: Partial<JudgeConfig>;  // ← 新增
    steps?: ChainStepInput[];
  },
): RuntimePlan {
  // ...
  // Judge step 判定优先使用 overrides.judge.enabled
  const effectiveJudge = overrides?.judge
    ? normalizeJudge(overrides.judge, strategy.judge)
    : strategy.judge;

  if (effectiveJudge.enabled && candidates.length > 1) {
    steps.push({ id: "judge-0", type: "judge", status: "pending", dependsOn: ["exec-parallel"] });
  }
  // ...
}
```

### 5.2 SSE Aggregator — 读取任务级 judge 配置

**文件**：`sse-aggregator.ts` → `finalizeParallelTask()`

当前实现从全局 `readOrchestrationStrategy()` 读取 judge 配置。改造为：

```typescript
// 优先从 task.strategy 中读取 judge 配置
const taskStrategy = parseTaskStrategy(task.strategy);
const taskJudge = taskStrategy.judge as Partial<JudgeConfig> | undefined;
const globalStrategy = readOrchestrationStrategy();
const effectiveJudge = taskJudge?.enabled !== undefined
  ? normalizeJudge(taskJudge, globalStrategy.judge)
  : globalStrategy.judge;
```

**好处**：每个任务可以独立决定是否启用裁判以及使用哪个裁判模型，不受全局配置影响。

### 5.3 任务 API — execute 接口扩展

**文件**：`routes.ts` → `POST /api/tasks/:taskId/execute`

在请求体 schema 中增加 judge 字段验证：

```typescript
// 请求体扩展
{
  mode: "parallel",
  candidates: [...],
  judge: {                        // optional
    enabled: true,
    model: "openai/gpt-4o",
    selectionStrategy: "judge-pick",
    promptTemplate: "...",        // optional
    timeoutMs: 30000,             // optional
  }
}
```

### 5.4 adopt — 裁判失败时允许手动覆盖

**文件**：`routes.ts` → `POST /api/tasks/:taskId/candidates/:index/adopt`

当前逻辑：如果已有 `winnerCandidateIndex`，拒绝 adopt。需增加判断：

```typescript
// 裁判失败时允许手动 adopt
if (plan.winnerCandidateIndex >= 0 && plan.judgeResult?.status !== 'failed') {
  return ctx.json({ error: "已有胜出候选" }, 409);
}
```

---

## 6. 数据流总览

```text
┌──────────────┐     confirm({mode,candidates,judge})    ┌──────────────┐
│ Execution    │ ──────────────────────────────────────► │ TaskDetail   │
│ ModeModal    │                                         │ .vue         │
└──────────────┘                                         └──────┬───────┘
                                                                │
                              PATCH /tasks/:id                  │
                              { strategy: { ..., judge: {...} } }│
                                                                ▼
                       ┌───────────────────────────────────────────────┐
                       │ BFF  POST /tasks/:id/execute                  │
                       │ → buildRuntimePlan(overrides w/ judge)        │
                       │ → 启动 N 个候选 session                       │
                       └────────────────────┬──────────────────────────┘
                                            │
                                  SSE 事件流 │
                                            ▼
                       ┌─────────────────────────────────────────────────┐
                       │ SSE Aggregator                                  │
                       │                                                 │
                       │ 候选 1 completed ──┐                            │
                       │ 候选 2 completed ──┤ allSettled?                │
                       │ 候选 N completed ──┘                            │
                       │        │                                        │
                       │        ▼                                        │
                       │  effectiveJudge.enabled?                        │
                       │    ├─ YES → runJudgeEvaluation()                │
                       │    │        → parse JSON → judgeResult          │
                       │    │        → winnerCandidateIndex = N          │
                       │    │        → PATCH task completed              │
                       │    │        → emit task.completed               │
                       │    └─ NO  → winnerCandidateIndex = -1           │
                       │             → 等待用户手动 adopt                 │
                       └─────────────────────────────────────────────────┘
                                            │
                              SSE task.completed 或 task.updated
                                            │
                                            ▼
                       ┌─────────────────────────────────────────────────┐
                       │ TaskDetail.vue                                  │
                       │ ┌─────────────────────────────────────────────┐ │
                       │ │ TaskParallelCandidatesCard                  │ │
                       │ │ • 显示各候选评分                            │ │
                       │ │ • 高亮胜出候选                              │ │
                       │ │ • 裁判推理详情                              │ │
                       │ │ • (无裁判/失败时) 采纳按钮                   │ │
                       │ └─────────────────────────────────────────────┘ │
                       │                                                 │
                       │ 主线回复 = candidates[winnerIndex].result       │
                       └─────────────────────────────────────────────────┘
```

---

## 7. 实施步骤

### Phase 1：前端裁判配置入口（约 1 天）

| 步骤 | 说明 |
| --- | --- |
| 1.1 | `ExecutionModeModal.vue` 并行模式下新增裁判配置折叠面板 |
| 1.2 | 新增 `judge` 字段到 `ExecutionOverrides` 类型 |
| 1.3 | `handleExecutionModeConfirm()` → `serializeTaskStrategy()` 正确透传 judge 配置 |
| 1.4 | 单元测试：弹窗裁判配置交互 |

### Phase 2：后端任务级裁判配置（约 0.5 天）

| 步骤 | 说明 |
| --- | --- |
| 2.1 | `buildRuntimePlan()` 支持 `overrides.judge` |
| 2.2 | `finalizeParallelTask()` 从 `task.strategy` 读取任务级 judge 配置 |
| 2.3 | `POST /execute` 请求体增加 judge 字段校验 |
| 2.4 | `POST /candidates/:index/adopt` 支持裁判失败时手动覆盖 |

### Phase 3：前端结果展示增强（约 0.5 天）

| 步骤 | 说明 |
| --- | --- |
| 3.1 | `TaskParallelCandidatesCard` 展示评分、裁判运行状态、失败降级提示 |
| 3.2 | `TaskDetail.vue` 主线回复根据 judgeResult 自动切换 |
| 3.3 | 裁判正在运行时显示 loading 状态 |

### Phase 4：测试与验证（约 0.5 天）

| 步骤 | 说明 |
| --- | --- |
| 4.1 | 集成测试：启用裁判的并行执行全流程 |
| 4.2 | 集成测试：裁判评估失败降级为手动 |
| 4.3 | 集成测试：无裁判手动采纳（回归） |
| 4.4 | UI 测试：评分展示、状态切换 |

---

## 8. 边界与约束

| 项 | 说明 |
| --- | --- |
| 付费模型保护 | 裁判模型的 token 消耗纳入 `paidExecutionGuard` 预算控制；如果预算已熔断，跳过裁判评估（降级为手动） |
| 裁判超时 | 超时后 `judgeResult.status = 'failed'`，降级为手动采纳 |
| 候选全部失败 | 无可评审结果，跳过裁判，任务标记为失败 |
| 模板变量安全 | `renderPromptTemplate()` 已对模板变量做转义，无注入风险 |
| 并发安全 | `finalizeParallelTask()` 已用 `judgingTasks` Set 做幂等保护 |
| 后续扩展 | 未来可支持「多轮评审」（裁判对候选提出修改建议后再打分）；本方案不涉及 |

---

## 9. 改动范围清单

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `control-plane/web-ui/src/components/ExecutionModeModal.vue` | **改造** | 新增裁判配置面板 |
| `control-plane/web-ui/src/components/task-detail/TaskParallelCandidatesCard.vue` | **增强** | 评分展示、裁判状态、降级提示 |
| `control-plane/web-ui/src/pages/TaskDetail.vue` | **增强** | judgeResult 驱动主线回复、透传 judge 到 overrides |
| `control-plane/web-ui-bff/src/lib/orchestration-strategy.ts` | **增强** | `buildRuntimePlan` 支持 task-level judge override |
| `control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts` | **增强** | `finalizeParallelTask` 从 task.strategy 读 judge |
| `control-plane/web-ui-bff/src/modules/tasks/routes.ts` | **增强** | execute 接口 judge 校验、adopt 支持裁判失败覆盖 |
