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

### 事项一：砍掉 runtime DAG，Workflow 阶段 + 管理员 Hook 就是执行骨架

**做什么**：

1. 从 `opencode.json` 移除 `task-graph-plugin.ts`
2. 不再生成独立 DAG，Workflow Stage 就是唯一推进单位
3. 管理员在模板中为阶段配置 Hook（已有 `hooksJson` 字段和 `LifecycleHook` 类型）
4. 用户进入某阶段时，该阶段的 Hook 自动触发

**管理员 Hook 能力**：

管理员可以为 Workflow 的每个阶段配置以下 Hook：

| Hook 触发点 | 说明 | 典型用途 |
|------------|------|----------|
| `pre-execution` | 阶段执行前触发 | 检查前置条件、注入额外上下文、改写 Prompt |
| `post-execution` | 阶段执行后触发 | 自动审查产出、触发通知、记录审计 |
| `on-failure` | 阶段执行失败时触发 | 自动重试策略、降级处理、告警 |
| `pre-resume` | 阶段恢复执行前触发 | 恢复前检查、上下文刷新 |

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
- 执行入口已在 `tasks/routes.ts`（pre-execution）和 `sse-aggregator.ts`（post-execution / on-failure）中接入
- 需补充：将阶段级 `hooksJson` 合并到执行流的 Hook 列表中（当前主要读取策略级 Hook）

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

- `ExecutionMode`（`single` | `parallel`）、`ExecutionCandidate`、`ExecutionPlan` 类型已定义
- `agentRuns.candidateIndex` 已支持多候选追踪
- SSE aggregator 已有 `parallelCandidateResults` 收集和 `runJudgeEvaluation` 逻辑
- 需补充：顺序编排模式（`sequential-chain`）和前端步骤设计 UI

**为什么有收益**：

- **并行比较直接提升生成质量**：用户可以用 Claude + GPT 同时跑，选效果最好的
- **顺序编排让复杂任务可控**：先做分析、再做实现、最后做验证，每一步都基于前一步的真实产出
- 复用已有并行执行基础设施，新增量主要在前端和顺序编排逻辑

### 事项四：阶段完成后自动推进

**做什么**：

1. 模型执行完成后，BFF 检查当前阶段的 `exitCriteria`
2. 若满足，自动将 `currentStage` 推进到下一阶段并回写 `artifactsSummaryJson`
3. 若不满足或失败，阶段保持 `running`，用户可 continue 补充

推进逻辑：

```text
Agent 执行完成
  → BFF 提取模型产出摘要
  → 写入当前 stageRun.artifactsSummaryJson
  → 若 exitCriteria 满足，stageRun → completed，下一 stageRun → running
  → 若不满足，stageRun 保持 running，等待下次 continue
```

**为什么有收益**：

- **直接提升自动化水平**：不再需要人工判断"这个阶段完了没"
- 改动量小：复用现有 `/workflow/advance` 接口逻辑

## 3. 不做什么

| 不做的事 | 原因 |
|----------|------|
| Stage 内部 Node Graph | 用户的并行/顺序编排已覆盖细粒度执行需求 |
| 三层权限模型 | 现有项目角色（admin / developer / viewer）已覆盖 |
| 节点级重试和失败恢复 | 阶段级重试（已有 `retry-stage`）+ Hook `on-failure` 够用 |
| 模板版本发布机制 | 当前模板直接生效即可 |
| 历史 DAG 数据迁移 | 旧数据标记为 legacy，不做结构迁移 |

## 4. 数据层改动

### 不新增表

复用现有 `taskWorkflowRuns` + `taskStageRuns`，只需确保：

1. `taskStageRuns.artifactsSummaryJson` 用于存储每个阶段的产出摘要
2. 每次 continue/execute 时 BFF 能读到所有已完成阶段的 `artifactsSummaryJson`

### 清理 DAG 相关

1. `taskNodes` / `taskEdges` 表保留但不再写入新数据
2. `task-graph-plugin` 从 runtime 移除
3. BFF Prompt 注入逻辑中删除 `task_graph_*` 工具提示

## 5. 接口改动

| 接口 | 改动 | 新增/改动 |
|------|------|----------|
| `POST /api/tasks/:taskId/execute` | 注入阶段 Prompt 上下文；支持 `mode` 参数（`single` / `parallel` / `sequential-chain`）；执行前触发阶段 `pre-execution` Hook | 改动 |
| `POST /api/tasks/:taskId/continue` | 注入阶段 Prompt 上下文 | 改动 |
| `POST /workflow/advance` | 执行完成后自动调用；推进前触发阶段 `post-execution` Hook | 改动 |
| `POST /api/tasks/:taskId/execute` 的 `parallel` 模式 | 接受 `candidates: [{model, label}]` 数组，为每个候选创建独立 session | 改动（扩展请求体） |
| `POST /api/tasks/:taskId/execute` 的 `sequential-chain` 模式 | 接受 `steps: [{instruction, model?}]` 数组，按顺序串行执行 | 改动（扩展请求体） |
| `POST /api/tasks/:taskId/candidates/:index/adopt` | 并行比较完成后，用户采纳某个候选结果 | 新增 |

## 6. Prompt 注入实现要点

BFF 在组装 Prompt 时读取：

1. `taskWorkflowRuns` → 获取当前阶段
2. 全部 `taskStageRuns` → 获取已完成阶段的产出摘要
3. `workflowTemplateStages` → 获取当前阶段的 exitCriteria 和 name

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
  → BFF 读取当前 stageRun + stageTemplate
  → 合并阶段级 + 策略级 Hook
  → 执行 pre-execution Hook
  → 若 Hook 返回 deny → 阻断，stageRun → blocked
  → 若 Hook 返回 rewrite-prompt → 使用改写后的 Prompt
  → 若 Hook 返回 switch-model → 切换模型
  → 若 Hook 返回 allow → 正常执行
  → Agent 执行
  → 执行 post-execution Hook
  → 自动推进判断
```

## 8. 自动推进实现要点

Agent 执行结束时（session complete 回调）：

1. BFF 从模型最后一轮输出中提取产出摘要
2. 写入 `taskStageRuns.artifactsSummaryJson`
3. 判断 exitCriteria 是否满足（首期可用简单规则：模型输出包含"阶段完成"标记即可）
4. 满足 → 调用 `advance` 推进到下一阶段
5. 不满足 → 保持当前阶段，等待下次 continue

首期 exitCriteria 判定规则：

- 模型输出中包含 `[STAGE_COMPLETE]` 标记 → 满足
- Prompt 中明确告诉模型："完成后请在输出末尾标注 `[STAGE_COMPLETE]`"
- 后续可升级为独立 judge 调用

并行比较模式下的推进：

- 所有 candidate 完成后，若有 judge → 自动评分，采纳胜者结果后推进
- 若无 judge → 等待用户手动采纳（`/candidates/:index/adopt`），采纳后推进

顺序编排模式下的推进：

- 最后一个步骤完成后，汇总全部步骤产出，写入 `artifactsSummaryJson`，触发推进

## 9. 验收标准

1. 新任务不再生成 runtime DAG
2. 用户在工作台只看到 Workflow 阶段列表和当前阶段
3. 模型执行时 Prompt 包含阶段上下文（当前阶段 + 已完成阶段摘要）
4. 阶段完成后自动推进到下一阶段，无需用户手动操作
5. clarify → design → implement → verify 链路可自动走完（L2 autopilot 下）
6. 用户可选择并行比较模式，同时用 2+ 模型执行同一阶段并对比结果
7. 用户可选择顺序编排模式，定义多步骤串行执行
8. 管理员配置的阶段 Hook 在用户进入该阶段时自动触发
9. Hook 的 `deny` / `rewrite-prompt` / `switch-model` 决策生效

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

完成标志：

1. 新任务执行链路不再依赖 runtime DAG
2. 旧任务数据仍可读，但不再增量写入

### Phase 2：打通阶段上下文与自动推进

目标：先把单阶段执行跑通，并让模型明确知道自己正在完成哪个阶段。

交付内容：

1. 在 `execute` / `continue` 中注入阶段上下文 Prompt
2. 执行完成后提取阶段摘要，写入 `artifactsSummaryJson`
3. 基于 `[STAGE_COMPLETE]` 规则自动推进到下一阶段
4. 前端显示当前阶段、已完成阶段、待完成阶段

完成标志：

1. 单模型单阶段可以连续推进
2. clarify → design → implement 至少能自动推进两段以上

### Phase 3：接入阶段 Hook

目标：让管理员对阶段执行具备可配置的治理能力。

交付内容：

1. 执行前读取当前阶段 `hooksJson`
2. 阶段级 Hook 与策略级 Hook 合并执行
3. 支持 `deny` / `rewrite-prompt` / `switch-model` 三个核心决策
4. 记录 Hook 执行日志与决策结果

完成标志：

1. 管理员为某阶段配置 Hook 后，用户进入该阶段会自动触发
2. Hook 决策会影响真实执行结果

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

1. 继续复用 `taskWorkflowRuns` / `taskStageRuns`
2. 确保 `workflowTemplateStages.hooksJson` 在模板读写链路中完整透传
3. 若需要，为并行采纳结果补充轻量接口或状态字段

### BFF

需要改动：

1. 在任务执行入口组装阶段 Prompt 上下文
2. 合并执行阶段级 Hook 与策略级 Hook
3. 执行结束后提取阶段摘要并自动推进
4. 扩展 `execute` 接口以支持 `parallel` / `sequential-chain`
5. 增加并行结果采纳接口

### Web UI

需要改动：

1. 在 TaskDetail 中强化 Workflow 阶段展示
2. 增加当前阶段的执行模式选择器
3. 增加并行模型选择 UI
4. 增加顺序步骤编辑 UI
5. 增加并行结果对比与采纳 UI

## 13. 推荐的 MVP 范围

为了尽快拿到可验证收益，建议 MVP 只做以下范围：

1. 仅支持 `single` 和 `parallel`
2. 仅支持 `pre-execution` Hook
3. 自动推进只使用 `[STAGE_COMPLETE]` 标记判断
4. 前端只支持并行比较，不做复杂顺序步骤编辑器
5. 顺序编排先由后端接受简单数组参数，前端先用基础表单输入

MVP 不做：

1. `post-execution` / `on-failure` / `pre-resume` 的完整闭环
2. 复杂拖拽式顺序编排器
3. Hook 市场或 Hook 模板库
4. 多阶段并行

这样可以先验证两个核心结论：

1. 阶段上下文是否明显改善模型输出质量
2. 并行比较是否能显著提高当前阶段的采纳结果质量

## 14. 前后端联调顺序

建议按下面顺序联调，避免同时改太多层：

1. 先移除 runtime DAG，并确保旧任务页面不报错
2. 再打通 BFF 阶段 Prompt 注入与自动推进
3. 然后接入 `pre-execution` Hook
4. 再开放前端阶段展示和单模型执行
5. 最后接入并行比较与结果采纳

原因：

1. 如果先做前端编排 UI，但后端阶段执行语义未稳定，会反复返工
2. 如果先把阶段上下文与自动推进打通，就已经能验证这套方案是否真的提高自动化

## 15. 任务拆解建议

### 后端任务

1. 移除 task graph plugin 依赖与新写入路径
2. 实现阶段上下文 Prompt builder
3. 实现阶段摘要提取与回写
4. 实现自动推进触发器
5. 实现阶段 Hook 合并执行
6. 扩展 execute 请求体支持多模式
7. 实现并行结果采纳接口

### 前端任务

1. 调整 TaskDetail，突出当前阶段和阶段列表
2. 增加执行模式选择器
3. 增加并行模型选择器
4. 增加并行结果对比卡片
5. 增加候选结果采纳入口
6. 增加顺序步骤配置表单

### 测试任务

1. 单阶段执行与自动推进集成测试
2. Hook `deny` / `rewrite-prompt` / `switch-model` 行为测试
3. 并行执行与 judge 选优测试
4. 用户手动采纳候选结果测试
5. 顺序编排上下文传递测试

## 16. 风险与回退策略

### 风险一：移除 DAG 后，旧页面或旧逻辑仍依赖图数据

应对：

1. 先停止新写入，再延后删除旧展示
2. 保留 `taskNodes` / `taskEdges` 只读兼容一段时间

### 风险二：自动推进误判，导致阶段跳过

应对：

1. MVP 先要求显式 `[STAGE_COMPLETE]`
2. 未命中标记时默认不推进

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
