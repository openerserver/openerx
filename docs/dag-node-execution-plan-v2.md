# Workflow 执行简化方案

> 目标：用最小改动让 Workflow 阶段真正可执行，同时提升模型生成质量。
>
> 原则：不做架构大重构，只做四件对自动化和生成质量有直接收益的事。

## 1. 当前问题

系统存在两套平行推进结构：

1. Workflow 阶段状态机（`taskWorkflowRuns` + `taskStageRuns`）
2. Runtime task-graph-plugin 生成的 DAG（`taskNodes` + `taskEdges`）

两者语义重复，且 DAG 无法真正执行——用户只能"继续对话"，不能按节点推进。

## 2. 做四件事

先明确一条执行语义：**整个项目以任务为核心，阶段不是独立执行实体，而是附着在任务上的执行环境。**

- 管理员配置 Workflow 时，为每个阶段定义该阶段的初始任务
- 用户真正执行、查看、接管、完结的对象始终是任务
- 所谓“进入下一阶段”，实际语义是“让下一个阶段的初始任务开始执行”

### 事项一：砍掉 runtime DAG，Workflow 阶段 + 管理员 Hook 就是执行骨架

**做什么**：

1. 从 `opencode.json` 移除 `task-graph-plugin.ts`
2. 不再生成独立 DAG；Task 是唯一核心执行实体，Workflow Stage 只负责描述 Task 所处环境与阶段顺序
3. 管理员在模板中为阶段配置 Hook（已有 `hooksJson` 字段和 `LifecycleHook` 类型）
4. 用户进入某阶段时，该阶段的 Hook 自动触发

**管理员 Hook 能力**：

管理员可以为 Workflow 的每个阶段配置以下 Hook：

| Hook 触发点 | 说明 | 典型用途 |
| ---------- | ---- | -------- |
| `pre-execution` | 阶段执行前触发 | 检查前置条件、注入额外上下文、改写 Prompt |
| `post-execution` | 阶段执行后触发 | 自动审查产出、触发通知、记录审计 |
| `on-failure` | 运行时 `session.error` 等硬失败时触发 | 失败归因、降级建议、告警 |
| `pre-resume` | 恢复已暂停的 agent run 前触发 | 恢复前检查、补充指导、上下文刷新 |

每个 Hook 可以返回决策（`HookDecision`）：

- `allow`：放行
- `deny`：阻断执行
- `rewrite-prompt`：改写即将发送给模型的 Prompt
- `request-approval`：暂停，等待人工审批
- `switch-model`：切换到指定模型执行
- `spawn-followup`：触发后续任务

**已有基础设施**：

- `workflowTemplateStages.hooksJson` 存储阶段级 Hook 配置
- `LifecycleHook` / `HookDecision` / `HookExecutionRecord` 类型已定义
- `lifecycle-hooks.ts` 已实现 Hook 顺序执行、Prompt 模板渲染、决策解析
- 执行入口已在 `tasks/routes.ts`（pre-execution）、`sse-aggregator.ts`（post-execution / on-failure）和 `agent-control/routes.ts`（pre-resume，仅 resume 入口）中接入
- 当前 `on-failure` 只覆盖 runtime/session 级硬失败，不覆盖结果质量差、未达成阶段目标等软失败
- 阶段级 `hooksJson` 与策略级 Hook 的合并能力已接入执行流；后续若继续扩展，重点在补齐不同 trigger 下的决策消费语义

**为什么有收益**：

- 消除两套状态机导致的用户困惑
- 管理员通过 Hook 实现阶段级治理（审查、阻断、改写），不需要额外的 DAG 节点
- Hook 基础设施已基本就绪，补充阶段级 Hook 合并逻辑即可

### 事项二：给阶段执行注入结构化 Prompt 上下文

**做什么**：

每次执行（`/api/tasks/:taskId/execute` 或 `/api/tasks/:taskId/continue`）时，BFF 在 Prompt 中注入当前阶段上下文：

```text
## 当前执行上下文

任务：{task.title}
当前阶段：{currentStage.stageKey}（{currentStage.name}）
阶段目标：{stageTemplate.exitCriteria 的自然语言摘要}
已完成阶段及产出：
- clarify：需求已确认，范围为 xxx
- design：接口设计已完成，方案见 xxx
待完成阶段：implement → verify → release

请只完成当前阶段的目标。完成后输出本阶段产出摘要。
```

**为什么有收益**：

- **直接提升模型生成质量**：模型知道自己该做什么、不该做什么，不再一次性尝试完成所有事
- **阶段产出可累积**：前序阶段的摘要作为后续阶段的输入，形成递进式上下文
- 改动量极小：只需修改 BFF 的 Prompt 注入逻辑（`buildWorkflowPromptContext`）

### 事项三：用户可在任务中编排执行步骤（并行或顺序）

**做什么**：

用户在启动任务或 continue 时，可以选择执行方式：

1. **并行比较**：同时用 2+ 个模型执行同一阶段，对比结果后选最优
2. **顺序编排**：先执行步骤 A，等模型回复后，再执行步骤 B
3. **单次执行**：默认模式，一个模型跑完当前阶段

并行比较的流程：

```text
用户选择「并行比较」→ 选择 2+ 模型
  → BFF 为每个模型创建一个 ExecutionCandidate（独立 session）
  → 所有 candidate 并行执行，各自产出结果
  → 全部完成后，若启用 judge → 自动评分选优
  → 若未启用 judge → 用户手动选择采纳哪个结果
  → 采纳结果写入 stageRun.artifactsSummaryJson
```

顺序编排的流程：

```text
用户定义执行序列：[步骤A, 步骤B, 步骤C]
  → BFF 按顺序执行每个步骤
  → 步骤A 完成后，将产出注入步骤B 的 Prompt 上下文
  → 步骤B 完成后，将产出注入步骤C 的 Prompt 上下文
  → 全部完成后，汇聚结果写入 stageRun.artifactsSummaryJson
```

**已有基础设施**：

- `ExecutionMode`（`single` | `parallel`）、`ExecutionCandidate`、`RuntimePlan` 类型已定义
- `agentRuns.candidateIndex` 已支持多候选追踪
- SSE aggregator 已有 `parallelCandidateResults` 收集和 `runJudgeEvaluation` 逻辑
- 需补充：顺序编排模式（`sequential-chain`）和前端步骤设计 UI

**为什么有收益**：

- **并行比较直接提升生成质量**：用户可以用 Claude + GPT 同时跑，选效果最好的
- **顺序编排让复杂任务可控**：先做分析、再做实现、最后做验证，每一步都基于前一步的真实产出
- 复用已有并行执行基础设施，新增量主要在前端和顺序编排逻辑

### 事项四：阶段达成后自动启动下一阶段的初始任务

**做什么**：

1. 为任务提供阶段自动推进开关，例如 `autoAdvanceStages`，默认关闭
2. 当前任务执行完成后，BFF 检查该任务所在阶段的 `exitCriteria`
3. 若开关开启且满足条件，自动将 `currentStage` 推进到下一阶段，并自动开始下一阶段的初始任务
4. 若开关关闭，即使满足条件也只写回阶段摘要和完成标记，由用户手动决定是否启动下一阶段的初始任务
5. 若不满足或失败，当前任务保持在本阶段上下文中，用户可 continue 补充

推进逻辑：

```text
Agent 执行完成
  → BFF 提取模型产出摘要
  → 写入当前 stageRun.artifactsSummaryJson
  → 若 exitCriteria 满足且 autoAdvanceStages = true，stageRun → completed，下一 stageRun → running，并自动开始下一阶段的初始任务
  → 若 exitCriteria 满足但 autoAdvanceStages = false，停留在当前任务，等待用户手动启动下一阶段的初始任务
  → 若不满足，stageRun 保持 running，等待下次 continue
```

**为什么有收益**：

- **把自动化变成可选能力**：愿意放手给系统跑的任务可以开启，不愿意承担误推进风险的任务保持人工确认
- **坚持任务中心语义**：所谓自动推进，本质上是自动拉起下一阶段的初始任务，而不是让阶段本身变成可独立执行对象
- **避免工作流内推进和工作流外派生混淆**：自动推进只处理同一 Workflow 内的下一阶段初始任务，不负责自动派生无关的新独立任务
- 改动量小：复用现有 `/workflow/advance` 接口逻辑

## 3. 不做什么

| 不做的事 | 原因 |
| -------- | ---- |
| Stage 内部 Node Graph | 用户的并行/顺序编排已覆盖细粒度执行需求 |
| 三层权限模型 | 现有项目角色（admin / developer / viewer）已覆盖 |
| 节点级重试和失败恢复 | 首期不做自动恢复编排；阶段级重试（已有 `retry-stage`）+ `on-failure` 的失败归因/告警先够用 |
| 模板版本发布机制 | 当前模板直接生效即可 |
| 历史 DAG 数据迁移 | 旧数据标记为 legacy，不做结构迁移 |

## 4. 数据层改动

### 不新增表

复用现有 `taskWorkflowRuns` + `taskStageRuns`，只需确保：

1. `taskStageRuns.artifactsSummaryJson` 用于存储每个阶段的产出摘要
2. 每次 continue/execute 时 BFF 能读到所有已完成阶段的 `artifactsSummaryJson`

### 阶段初始任务定义放在哪里

不新增独立表，直接挂在模板阶段定义上：

1. 存储位置：`workflow_template_stages.initial_task_definition_json`
2. Drizzle 字段：`workflowTemplateStages.initialTaskDefinitionJson`
3. 模板接口字段：`initialTaskDefinition`
4. 前端编辑位置：Workflow 模板编辑页中，每个阶段卡片的基础配置区域，和 `exitCriteria`、`hooks` 同级展示

原因：

1. 初始任务定义是“阶段模板”的一部分，不是运行态实例数据
2. 它和 `exitCriteriaJson`、`hooksJson` 一样，都属于管理员配置的阶段元数据
3. 运行时只需要读取当前阶段或下一阶段的定义，生成或启动对应任务，无需再引入新表和额外关联

### 阶段初始任务定义的数据结构

建议使用下面的最小结构：

```ts
type StageInitialTaskDefinition = {
  version: 1;
  titleTemplate: string;
  goalTemplate: string;
  instructionTemplate: string;
  doneWhen?: string[];
  defaultExecutionMode?: "single" | "parallel" | "sequential-chain";
  defaultCandidates?: Array<{
    model: string;
    label?: string;
  }>;
  defaultSteps?: Array<{
    id: string;
    title: string;
    instruction: string;
    model?: string;
  }>;
  contextBindings?: {
    includeProjectBrief?: boolean;
    includePreviousStageSummary?: boolean;
    includeCurrentStageExitCriteria?: boolean;
  };
  outputContract?: {
    summaryLabel?: string;
    artifactKeys?: string[];
    requireStageCompleteMarker?: boolean;
  };
};
```

字段语义：

1. `titleTemplate`：该阶段初始任务的标题模板，例如“Clarify：澄清需求范围”
2. `goalTemplate`：任务目标摘要，用于任务详情和系统侧展示
3. `instructionTemplate`：首次启动该任务时发给模型的主指令模板
4. `doneWhen`：该初始任务的完成条件提示，偏任务视角；可补充或细化阶段级 `exitCriteria`
5. `defaultExecutionMode`：该阶段初始任务默认采用的执行模式；若为空则回退到阶段 `mode`
6. `defaultCandidates`：并行模式下的默认候选模型
7. `defaultSteps`：顺序编排模式下的默认步骤草稿
8. `contextBindings`：控制初始任务默认注入哪些上下文
9. `outputContract`：约束该任务完成时要输出哪些摘要、产物键和是否要求 `[STAGE_COMPLETE]`

约束建议：

1. `titleTemplate`、`goalTemplate`、`instructionTemplate` 必填
2. `defaultCandidates` 只在 `defaultExecutionMode = parallel` 时使用
3. `defaultSteps` 只在 `defaultExecutionMode = sequential-chain` 时使用
4. `outputContract.requireStageCompleteMarker` 在 MVP 中默认 `true`
5. `defaultExecutionMode` 为空时，运行时回退到阶段已有的 `mode`

### 模板中的实际放置示例

管理员保存某个阶段时，`workflowTemplateStages` 的一行数据可以是：

```json
{
  "id": "stage-clarify",
  "templateId": "tmpl-product-delivery",
  "stageKey": "clarify",
  "name": "需求澄清",
  "mode": "single",
  "primaryRoleAgentId": "role-pm",
  "exitCriteriaJson": [
    "需求范围已经明确",
    "关键约束已经记录",
    "输出末尾包含 [STAGE_COMPLETE]"
  ],
  "hooksJson": [],
  "initialTaskDefinitionJson": {
    "version": 1,
    "titleTemplate": "Clarify：澄清需求范围",
    "goalTemplate": "产出清晰的问题定义、范围边界和待确认事项",
    "instructionTemplate": "请基于当前项目背景，梳理需求范围、假设、风险和待确认问题，输出结构化澄清结论。",
    "doneWhen": [
      "范围、约束、风险三部分都已覆盖",
      "存在明确的待确认事项列表"
    ],
    "contextBindings": {
      "includeProjectBrief": true,
      "includePreviousStageSummary": false,
      "includeCurrentStageExitCriteria": true
    },
    "outputContract": {
      "summaryLabel": "clarify-summary",
      "artifactKeys": ["scope", "constraints", "open_questions"],
      "requireStageCompleteMarker": true
    }
  }
}
```

### 模板接口怎么传

现有模板阶段接口已经使用 `workflowStageSchema` 传递阶段定义，建议直接扩展：

```ts
const workflowStageSchema = z.object({
  id: z.string().min(1),
  stageKey: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  mode: z.enum(["single", "parallel", "pipeline"]),
  primaryRoleAgentId: z.string().min(1),
  participantRoleAgentIds: z.array(z.string()).default([]),
  entryCriteria: z.array(z.string()).optional(),
  exitCriteria: z.array(z.string()).optional(),
  hooks: z.array(z.any()).optional(),
  initialTaskDefinition: z.object({
    version: z.literal(1),
    titleTemplate: z.string().min(1),
    goalTemplate: z.string().min(1),
    instructionTemplate: z.string().min(1),
    doneWhen: z.array(z.string()).optional(),
    defaultExecutionMode: z
      .enum(["single", "parallel", "sequential-chain"])
      .optional(),
    defaultCandidates: z
      .array(
        z.object({
          model: z.string().min(1),
          label: z.string().optional(),
        }),
      )
      .optional(),
    defaultSteps: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          instruction: z.string().min(1),
          model: z.string().optional(),
        }),
      )
      .optional(),
    contextBindings: z
      .object({
        includeProjectBrief: z.boolean().optional(),
        includePreviousStageSummary: z.boolean().optional(),
        includeCurrentStageExitCriteria: z.boolean().optional(),
      })
      .optional(),
    outputContract: z
      .object({
        summaryLabel: z.string().optional(),
        artifactKeys: z.array(z.string()).optional(),
        requireStageCompleteMarker: z.boolean().optional(),
      })
      .optional(),
  }),
});
```

对应写库规则：

1. `body.initialTaskDefinition` → `workflowTemplateStages.initialTaskDefinitionJson`
2. `PATCH /workflow-templates/:templateId/stages/:stageId` 允许单独更新 `initialTaskDefinition`
3. `GET /workflow-templates/:templateId/stages` 返回该字段，供模板编辑页和任务启动逻辑复用

### 运行时怎么用这份定义

1. 初始化 Workflow 时，不立即为所有阶段造任务，只记录阶段顺序和状态
2. 当前阶段启动时，按当前阶段的 `initialTaskDefinitionJson` 生成当前任务的初始标题、目标和首轮指令
3. 自动推进命中时，读取下一阶段的 `initialTaskDefinitionJson`，自动创建并启动下一阶段的初始任务
4. 若管理员未配置 `initialTaskDefinitionJson`，则回退到通用默认模板：
   - 标题：`{stage.name}`
   - 目标：`完成 {stage.name} 阶段目标`
   - 指令：由阶段 `exitCriteria` 和前序摘要拼装

### 清理 DAG 相关

1. 删除 `taskNodes` / `taskEdges` 的 schema 定义与迁移元数据引用，不再保留为 active schema
2. 删除 `agentRuns.nodeId`、`approvalTickets.nodeId` 这类 DAG 残留字段
3. `task-graph-plugin` 从 runtime 移除
4. BFF Prompt 注入逻辑中删除 `task_graph_*` 工具提示

## 5. 接口改动

| 接口 | 改动 | 新增/改动 |
| ---- | ---- | -------- |
| `POST /api/tasks/:taskId/execute` | 注入阶段 Prompt 上下文；支持 `mode` 参数（`single` / `parallel` / `sequential-chain`）；支持任务级 `autoAdvanceStages` 开关（默认 `false`）；执行前触发阶段 `pre-execution` Hook | 改动 |
| `POST /api/tasks/:taskId/continue` | 注入阶段 Prompt 上下文 | 改动 |
| `POST /workflow/advance` | 仅在 `autoAdvanceStages = true` 时由执行完成后的收口链路自动调用；也可由用户手动触发；当前 `post-execution` Hook 在执行完成收口时触发，而不是在 `advance` 路由内触发；推进后自动开始下一阶段的初始任务 | 改动 |
| `POST /api/tasks/:taskId/execute` 的 `parallel` 模式 | 接受 `candidates: [{model, label}]` 数组，为每个候选创建独立 session | 改动（扩展请求体） |
| `POST /api/tasks/:taskId/execute` 的 `sequential-chain` 模式 | 接受 `steps: [{instruction, model?}]` 数组，按顺序串行执行 | 改动（扩展请求体） |
| `POST /api/tasks/:taskId/phases/:phaseId/candidates/:index/adopt` | 并行比较完成后，用户在指定 phase 内采纳某个候选结果 | 新增 |
| `POST /api/tasks/:taskId/complete` 或等价入口 | 用户确认当前任务或当前任务链已完结；若需要 Workflow 外的新工作，由用户显式发起新独立任务，而不是由阶段推进逻辑隐式派生 | 新增 |

## 6. Prompt 注入实现要点

BFF 在组装 Prompt 时读取：

1. `taskWorkflowRuns` → 获取当前任务所在阶段
2. 全部 `taskStageRuns` → 获取已完成阶段的产出摘要
3. `workflowTemplateStages` → 获取当前阶段的 exitCriteria、name 和下一阶段初始任务定义

组装为结构化上下文段落，拼接到系统 Prompt 中。

关键约束：

- 已完成阶段只注入摘要（不超过 200 字/阶段），避免上下文膨胀
- 当前阶段注入完整 exitCriteria
- 明确告诉模型"只完成当前阶段"

## 7. 阶段 Hook 合并实现要点

当前 Hook 主要从 `OrchestrationStrategy.hooks[]`（策略级）读取。需要补充：

1. 执行前，读取当前阶段的 `workflowTemplateStages.hooksJson`
2. 将阶段级 Hook 与策略级 Hook 合并（阶段级优先级更高）
3. 按 `order` 排序后统一执行

合并规则：

```text
最终 Hook 列表 = 阶段级 hooksJson（按 trigger 过滤）
                 + 策略级 hooks（按 trigger 过滤，去重）
排序 = 按 order 字段升序
```

阶段进入时的完整流程：

```text
用户触发 execute
  → BFF 读取当前 task 对应的 stageRun + stageTemplate
  → 合并阶段级 + 策略级 Hook
  → 执行 pre-execution Hook
  → 若 Hook 返回 deny → 阻断，stageRun → blocked
  → 若 Hook 返回 rewrite-prompt → 使用改写后的 Prompt
  → 若 Hook 返回 switch-model → 切换模型
  → 若 Hook 返回 allow → 正常执行
  → Agent 执行
  → 执行完成后的收口链路触发 post-execution Hook
  → 自动推进判断
```

## 8. 自动推进实现要点

Agent 执行结束时（session complete 回调）：

1. BFF 从当前任务的最后一轮输出中提取产出摘要
2. 写入 `taskStageRuns.artifactsSummaryJson`
3. 判断任务的 `autoAdvanceStages` 是否开启，默认关闭
4. 判断 exitCriteria 是否满足（首期可用简单规则：模型输出包含"阶段完成"标记即可）
5. 满足且 `autoAdvanceStages = true` → 调用 `advance` 推进到下一阶段，并自动开始下一阶段的初始任务
6. 满足但 `autoAdvanceStages = false` → 仅标记当前阶段可推进，等待用户手动启动下一阶段的初始任务
7. 不满足 → 保持当前阶段，等待下次 continue

首期 exitCriteria 判定规则：

- 模型输出中包含 `[STAGE_COMPLETE]` 标记 → 满足
- Prompt 中明确告诉模型："完成后请在输出末尾标注 `[STAGE_COMPLETE]`"
- 后续可升级为独立 judge 调用

任务级行为边界：

- 自动推进只作用于同一 Workflow 内部，语义是自动开始下一阶段的初始任务
- 阶段本身不是独立执行对象，真正运行和被采纳的仍然是任务及其产出
- 当当前任务链整体目标已完成时，用户可通过任务详情页的“完成任务”入口或其他现有入口显式结束任务
- 若需要新的需求、分支工作或下一轮执行，用户应显式创建新的独立任务，避免系统把“阶段推进”误用为“任务派生”

并行比较模式下的推进：

- 所有 candidate 完成后，若有 judge 且 `autoAdvanceStages = true` → 自动评分，采纳胜者结果后推进，并自动开始下一阶段的初始任务
- 若无 judge 或 `autoAdvanceStages = false` → 等待用户手动采纳（`/phases/:phaseId/candidates/:index/adopt`），采纳后再决定是否启动下一阶段的初始任务

顺序编排模式下的推进：

- 最后一个步骤完成后，汇总全部步骤产出，写入 `artifactsSummaryJson`；仅在 `autoAdvanceStages = true` 时触发推进并开始下一阶段的初始任务

## 9. 验收标准

1. 新任务不再生成 runtime DAG
2. 用户在工作台只看到 Workflow 阶段列表和当前阶段
3. 模型执行时 Prompt 包含阶段上下文（当前阶段 + 已完成阶段摘要）
4. 用户可在任务级设置中显式开启或关闭阶段自动推进，默认关闭
5. 当 `autoAdvanceStages = true` 时，clarify → design → implement → verify 链路可通过自动启动各阶段初始任务持续走完（L2 autopilot 下）
6. 用户可选择并行比较模式，同时用 2+ 模型执行同一阶段并对比结果
7. 用户可选择顺序编排模式，定义多步骤串行执行
8. 管理员配置的阶段 Hook 在用户进入该阶段时自动触发
9. Hook 的 `deny` / `rewrite-prompt` / `switch-model` 决策生效
10. Workflow 内自动推进只会启动下一阶段初始任务，不会隐式派生 Workflow 外的无关新任务

## 10. 后续可选扩展

当上述四件事稳定运行后，如果需要更细粒度的控制，可以考虑：

1. **exitCriteria 自动判定**：用独立 judge 调用替代 `[STAGE_COMPLETE]` 标记
2. **阶段间依赖图**：支持非线性的阶段拓扑（当前是严格线性）
3. **并行阶段执行**：多个无依赖阶段同时运行
4. **Hook 市场**：管理员从预置 Hook 模板库中选用，降低配置门槛

这些扩展只在实际遇到瓶颈时再做，不提前设计。

## 11. 实施分期

### Phase 1：收口执行骨架

目标：先让系统只剩一套主执行语义，避免继续在旧 DAG 上投入。

交付内容：

1. 从 `opencode.json` 移除 `task-graph-plugin.ts`
2. BFF 停止向新任务写入 `taskNodes` / `taskEdges`
3. 前端不再展示 DAG 相关入口或摘要
4. 新任务工作台只显示 Workflow 阶段信息
5. Service schema 与 migration metadata 中移除 `taskNodes` / `taskEdges` 与相关外键字段

完成标志：

1. 新任务执行链路不再依赖 runtime DAG
2. 运行时与控制面主路径不再引用 DAG schema

## 17. 当前清理进展

### 已完成的清理范围

1. Runtime 已移除 `task-graph-plugin.ts`，不再加载 DAG 插件
2. BFF 已移除 DAG 自动同步、图相关 Prompt 提示、项目/任务 graph 入口
3. Web UI 已移除 Task Graph / Project Task Graph 页面、导航与摘要展示
4. Service 已移除任务 graph API、历史 graph 修复脚本、基于 `taskNodes` 的 token 回填逻辑
5. 数据 schema 已移除 `taskNodes` / `taskEdges` 定义，以及 `agentRuns.nodeId`、`approvalTickets.nodeId` 残留字段
6. migration metadata 已同步移除 `task_nodes` / `task_edges` 和相关外键校验规则
7. PostgreSQL migration 已生成并在本地库执行完成，`task_nodes` / `task_edges` 表与 `agent_runs.node_id`、`approval_tickets.node_id` 已实际删除
8. 已完成一轮基于真实数据库的 service 冒烟检查：健康检查、登录、任务创建、agent run 创建/读取、审批列表读取均通过

### 数据库层剩余项

1. 本地数据库已完成删除；其他环境仍需执行同一条 migration 才能与代码层保持一致
2. 历史数据若仍包含 `task_nodes` / `task_edges`，本方案不做迁移映射，只做下线与清表
3. 若生产环境仍有依赖旧审批详情里 `nodeId` 的外部消费者，需要在部署 migration 前完成兼容确认

### Phase 2：打通阶段上下文与自动推进

目标：先把单任务执行跑通，并让模型明确知道自己正在完成哪个阶段，以及下一阶段如何以初始任务启动。

交付内容：

1. 在 `execute` / `continue` 中注入阶段上下文 Prompt
2. 执行完成后提取阶段摘要，写入 `artifactsSummaryJson`
3. 增加任务级 `autoAdvanceStages` 开关，默认关闭；开启后基于 `[STAGE_COMPLETE]` 规则自动推进到下一阶段并启动下一阶段初始任务
4. 前端显示当前阶段、已完成阶段、待完成阶段
5. 提供任务完结入口，区分 Workflow 内阶段推进与 Workflow 外显式新建独立任务

完成标志：

1. 在默认配置下，单模型单任务执行完成后不会自动启动下一阶段的初始任务
2. 用户开启 `autoAdvanceStages` 后，clarify → design → implement 至少能自动启动两个后续阶段的初始任务
3. 用户可清晰区分 Workflow 内自动推进与 Workflow 外显式新建独立任务

### Phase 3：接入阶段 Hook

目标：让管理员对阶段执行具备可配置的治理能力。

交付内容：

1. 执行前读取当前阶段 `hooksJson`
2. 阶段级 Hook 与策略级 Hook 合并执行
3. 以 `pre-execution` 为主，确保 `deny` / `rewrite-prompt` / `switch-model` 三个核心决策稳定生效；`pre-resume` 至少支持 `rewrite-prompt` 注入恢复指导
4. 记录 Hook 执行日志与决策结果，并明确 `post-execution` / `on-failure` 当前以治理记录为主

完成标志：

1. 管理员为某阶段配置 Hook 后，用户进入该阶段会自动触发
2. `pre-execution` 的 `deny` / `rewrite-prompt` / `switch-model` 会影响真实执行结果，`pre-resume` 的 `rewrite-prompt` 会影响恢复前指导

### Phase 4：支持用户并行比较与顺序编排

目标：让用户真正控制当前任务在当前阶段内怎么跑。

交付内容：

1. 前端提供三种模式：`single` / `parallel` / `sequential-chain`
2. 并行模式支持 2+ 候选模型同时执行
3. 并行模式支持 judge 自动选优或用户手动采纳
4. 顺序模式支持步骤列表配置与逐步串行执行

完成标志：

1. 用户能在当前任务中发起模型对比
2. 用户能设计至少 2 步以上的顺序执行链路

## 12. 模块改造清单

### Runtime

需要改动：

1. 更新 [opencode.json](opencode.json)，移除 `task-graph-plugin.ts`
2. 保留现有 session 执行能力，不再承担 DAG 状态同步职责

### Service

需要改动：

1. 继续复用 `taskWorkflowRuns` / `taskStageRuns`，用于描述任务所处阶段环境，而不是替代任务本身
2. 确保 `workflowTemplateStages.hooksJson` 在模板读写链路中完整透传
3. 为每个阶段补充初始任务定义或可解析的初始任务配置
4. 若需要，为并行采纳结果补充轻量接口或状态字段

### BFF

需要改动：

1. 在任务执行入口组装阶段 Prompt 上下文
2. 合并执行阶段级 Hook 与策略级 Hook
3. 执行结束后提取阶段摘要，并在 `autoAdvanceStages = true` 时自动推进并启动下一阶段初始任务
4. 扩展 `execute` 接口以支持 `parallel` / `sequential-chain`
5. 增加并行结果采纳接口

### Web UI

需要改动：

1. 在 TaskDetail 中强化 Workflow 阶段展示，并明确当前任务属于哪个阶段环境
2. 增加当前任务的阶段自动推进开关，默认关闭
3. 增加并行模型选择 UI
4. 增加顺序步骤编辑 UI
5. 增加并行结果对比与采纳 UI
6. 增加任务完结与“基于当前结果新建独立任务”的显式入口

## 13. 推荐的 MVP 范围

为了尽快拿到可验证收益，建议 MVP 只做以下范围：

1. 仅支持 `single` 和 `parallel`
2. 仅支持 `pre-execution` Hook
3. 自动推进通过任务级开关控制，默认关闭；开启后只使用 `[STAGE_COMPLETE]` 标记判断
4. 前端只支持并行比较，不做复杂顺序步骤编辑器
5. 顺序编排先由后端接受简单数组参数，前端先用基础表单输入
6. Workflow 外的后续工作先通过显式“新建独立任务”入口处理，不做自动派生任务

MVP 不做：

1. `post-execution` 的完整治理闭环，以及 `on-failure` / `pre-resume` 向软失败、普通 continue 的扩展
2. 复杂拖拽式顺序编排器
3. Hook 市场或 Hook 模板库
4. 多阶段并行

这样可以先验证两个核心结论：

1. 阶段上下文是否明显改善模型输出质量
2. 并行比较是否能显著提高当前阶段的采纳结果质量

## 14. 前后端联调顺序

建议按下面顺序联调，避免同时改太多层：

1. 先移除 runtime DAG，并确保旧任务页面不报错
2. 再打通 BFF 阶段 Prompt 注入与可配置自动推进
3. 然后接入 `pre-execution` Hook
4. 再开放前端阶段展示和单模型执行
5. 最后接入并行比较与结果采纳

原因：

1. 如果先做前端编排 UI，但后端阶段执行语义未稳定，会反复返工
2. 如果先把阶段上下文与自动推进打通，就已经能验证“任务中心 + 阶段环境”这套方案是否真的提高自动化

## 15. 任务拆解建议

### 后端任务

1. 移除 task graph plugin 依赖与新写入路径
2. 实现阶段上下文 Prompt builder
3. 实现阶段摘要提取与回写
4. 实现带开关的自动推进触发器，并在推进后自动启动下一阶段初始任务
5. 实现阶段 Hook 合并执行
6. 扩展 execute 请求体支持多模式
7. 实现并行结果采纳接口
8. 实现任务完结与显式新建独立任务入口

### 前端任务

1. 调整 TaskDetail，突出当前任务、所属阶段和阶段列表
2. 增加阶段自动推进开关
3. 增加并行模型选择器
4. 增加并行结果对比卡片
5. 增加候选结果采纳入口
6. 增加顺序步骤配置表单
7. 增加任务完结和新建独立任务入口

### 测试任务

1. 单任务执行、默认不自动推进、开启后自动启动下一阶段初始任务的集成测试
2. Hook `deny` / `rewrite-prompt` / `switch-model` 行为测试
3. 并行执行与 judge 选优测试
4. 用户手动采纳候选结果测试
5. 顺序编排上下文传递测试
6. 任务完结后显式新建独立任务测试

## 16. 风险与回退策略

### 风险一：移除 DAG 后，旧页面或旧逻辑仍依赖图数据

应对：

1. 先停止新写入，再删除旧展示与 schema 引用
2. 在其他环境执行 migration 前，先完成依赖扫描与接口兼容确认

### 风险二：自动推进误判，导致阶段跳过

应对：

1. 自动推进默认关闭，只有用户显式开启才允许自动启动下一阶段初始任务
2. MVP 先要求显式 `[STAGE_COMPLETE]`
3. 未命中标记时默认不推进

### 风险三：并行比较增加成本

应对：

1. 仅对指定模型组合开放
2. 默认限制并行候选数，例如最多 2 或 3 个
3. 在 UI 中明确展示额外成本

### 风险四：Hook 过强，影响用户执行体验

应对：

1. MVP 只开放少数决策类型
2. 对 `deny` 和 `switch-model` 记录清晰原因
3. 提供管理员关闭 Hook 的快速开关
4. 在产品文案和配置界面中明确：`on-failure` 只处理硬失败，`pre-resume` 只作用于 resume，不作用于普通 continue
