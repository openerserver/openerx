# oh-my-openagent 借鉴方案的 Issue 级工作包清单

## 0. 审核修订说明（2026-03-09）

> **重大修正**：原始 issue 清单基于"运行时编排能力缺失"的错误前提制定。
> 经复审，`opencode-fork/.opencode/` 下已实现大量编排能力（9 个 Agent、orchestrator-plugin、task-graph-plugin、session-tools 等）。
>
> **修正方向**：所有 issue 的焦点从"从零建编排"调整为"运行时 → 控制面穿透"。
> 标注 `[修订]` 的 issue 为本次审核后调整的内容。

> **实现状态（2026-03-09）**：全部 4 个 Epic、19 个 Issue 已实现完毕，通过编译和格式检查。
> 详细实现说明见 [oh-my-openagent 实现说明](./oh-my-openagent-implementation.md)。

## 1. 文档目的

本文档将 [oh-my-openagent 对 OpenerX 的功能对比与可执行方案](./oh-my-openagent-comparison-plan.md) 进一步拆解为可执行的 issue 级工作包，便于直接进入迭代计划、项目管理系统或 issue tracker。

拆解原则：

- 每个 issue 保持单一目标
- 每个 issue 都有明确依赖、交付物和验收标准
- 优先保证任务主模型、编排能力和插件生命周期控制面三条主线可独立推进

## 2. 建议的 Epic 划分

建议分为四个 Epic：

1. 任务编排主模型（运行时 → 控制面穿透）
2. 规划与任务路由（运行时能力 UI 可视化）
3. 插件生命周期控制面
4. 连续执行与恢复机制

---

## Epic 1: 任务编排主模型（运行时 → 控制面穿透）[修订]

> **背景修正**：task-graph-plugin 已在运行时实现了完整的 DAG 模型（TaskNode、TaskEdge、状态机、重试、JSON 持久化至 `.opencode/state/task-graphs/`）。本 Epic 的目标从"从零建 DAG"调整为"让控制面能持久化和查询运行时 DAG"。

### Issue 1.1 ✅ 设计控制面 DAG 镜像数据模型 [修订]

目标：
在控制面数据库中建立 task-graph-plugin DAG 的镜像模型，用于持久化存储、跨会话查询和审计。

建议标题：
`design control plane DAG mirror schema`

范围：

- 设计 `task_nodes` 表（对齐 task-graph-plugin 的 TaskNode 字段：id、subject、status、agentType、sessionId、retryCount、output、error、tokens、timestamps）
- 设计 `task_edges` 表（对齐 TaskEdge：from、to、type=blocks|informs）
- 设计 `agent_runs` 表
- 明确与现有 `tasks`、`sessions`、`audit_events` 的关系
- 参考 `opencode-fork/.opencode/plugins/task-graph-plugin.ts` 中的 NodeStatus 状态集

交付物：

- 数据模型设计说明（与 task-graph-plugin 字段的映射表）
- Drizzle schema 草案

依赖：

- 无

验收标准：

- 能存储 task-graph-plugin 产出的节点和依赖
- 能表达节点与 agent run、session 的关联
- 字段语义与运行时 DAG 一致

### Issue 1.2 ✅ 实现 DAG 镜像表迁移 [修订]

目标：
把任务节点模型落到数据库。

建议标题：
`add task nodes and agent runs migration`

范围：

- 新增 migration
- 更新 Drizzle schema
- 补齐基础索引和外键

交付物：

- migration 文件
- 更新后的 schema

依赖：

- Issue 1.1

验收标准：

- 本地 migration 可成功执行
- 新表可被 service 正常读取和写入

### Issue 1.3 ✅ 定义节点状态机与运行时对齐规则 [修订]

目标：
确保控制面状态集与 task-graph-plugin 的 NodeStatus 一致，避免前后端各自定义。

建议标题：
`align control plane node states with runtime`

范围：

- 对齐 task-graph-plugin 的节点状态集合（pending、in_progress、completed、failed、retry 等）
- 定义允许的状态流转（与运行时一致）
- 明确失败、暂停、审批等待、取消等状态语义

交付物：

- 状态机文档（与 task-graph-plugin 的映射说明）
- TypeScript 类型定义

依赖：

- Issue 1.1

验收标准：

- 后端、前端、实时事件使用同一组状态命名
- 每种状态转移都有明确触发条件

### Issue 1.4 ✅ 实现 graph 接口对接运行时 DAG [修订]

目标：
让 graph 接口返回 task-graph-plugin 产出的真实节点和依赖边，而不是占位响应。

建议标题：
`implement graph api reading runtime DAG`

范围：

- 改造 `/api/tasks/:taskId/graph`
- 从 `.opencode/state/task-graphs/` JSON 文件或 OpenCode 事件流读取 DAG 数据
- 返回节点、边、当前状态、执行摘要

交付物：

- BFF graph route
- 前端可消费的 graph payload

依赖：

- Issue 1.2
- Issue 1.3

验收标准：

- 前端任务图页面可稳定展示真实节点和依赖边
- 页面不再依赖“没有节点就放 placeholder”的临时模式作为主要路径

### Issue 1.5 ✅ 实现运行时 DAG 到控制面 DB 的同步 [修订]

目标：
把运行时 task-graph-plugin 产出的 DAG 状态回写到控制面数据库，支持跨会话查询和审计。

建议标题：
`sync runtime DAG to control plane db`

范围：

- 通过 SSE 事件回写或定期读取 JSON 文件，将 DAG 节点和边同步到 DB
- 处理增量更新（节点状态变更、新增节点/边）
- 保存 agentRunId、sessionId、result、error

交付物：

- 改造后的同步逻辑
- 基础单元或集成测试

依赖：

- Issue 1.2
- Issue 1.3

验收标准：

- 运行时 DAG 状态变更能及时反映到控制面 DB
- 失败节点的状态和错误信息可在 DB 中查询

### Issue 1.6 ✅ 让 TaskGraph 基于真实接口渲染 [修订]

目标：
把 TaskGraph 从"纯实时事件驱动"升级为"graph API 主数据 + 实时事件增量更新"。

建议标题：
`switch task graph to model-backed rendering`

范围：

- 页面加载时先拉 graph API
- 实时事件只做增量刷新
- 缺失字段和状态统一回退规则

交付物：

- 改造后的 TaskDetail 和 TaskGraph

依赖：

- Issue 1.4

验收标准：

- 刷新页面后图仍然完整
- 即使丢失部分实时事件也不会导致任务图不可用

---

## Epic 2: 规划与任务路由（运行时能力 UI 可视化）[修订]

> **背景修正**：orchestrator-plugin 已实现完整的意图分类（5 类 63 模式）、Agent 路由、模型选择。prometheus/metis/momus Agent 已实现完整的规划流水线。start-work 命令已串联完整流程。本 Epic 的目标从"从零建路由"调整为"把运行时编排决策在 UI 中可视化和可配置"。

### Issue 2.1 ✅ 将运行时意图分类结果同步到控制面 [修订]

目标：
把 orchestrator-plugin 的意图分类结果（quick/deep/ops/security/architecture）同步到控制面 tasks 表。

建议标题：
`sync runtime intent classification to control plane`

范围：

- 在 `tasks` 表增加 `category` 和 `strategy` 字段
- 通过事件回写将运行时分类结果写入控制面
- 定义分类到执行策略的映射文档

交付物：

- 策略映射文档（与 orchestrator-plugin 对齐）
- schema 变更 + migration

依赖：

- 无

验收标准：

- 运行时分类结果能同步到 tasks 表
- 分类字段语义与 orchestrator-plugin 一致

### Issue 2.2 ✅ 在 UI 展示规划流水线结果 [修订]

目标：
把 prometheus 规划、metis 审计、momus 验证的结果在 TaskDetail 中可视化展示。

建议标题：
`visualize planning pipeline results in ui`

范围：

- 通过事件流或 session 消息获取规划/审计/验证的结构化输出
- 在 TaskDetail 增加"规划结果"面板
- 展示 metis 审计发现和 momus 评分

交付物：

- BFF 规划结果查询接口
- 前端规划结果面板组件

依赖：

- Issue 2.1

验收标准：

- 管理员可在 UI 看到规划结果和审计评分
- 规划数据可被后续执行决策引用

### Issue 2.3 ✅ 在 tasks 表增加分类与策略字段 [修订]

目标：
让 tasks 主模型承载运行时产出的分类和策略信息。

建议标题：
`add task category and execution strategy fields`

范围：

- 在 `tasks` 增加 category 和 strategy 字段
- 支持保存运行时分类和规划摘要

交付物：

- schema 变更
- API 请求与响应更新

依赖：

- Issue 2.1

验收标准：

- 任务创建或运行时分类后可看到类别和策略信息

### Issue 2.4 ✅ 前端增加编排决策查看面板 [修订]

目标：
让管理员在 TaskDetail 中看到运行时的编排决策（意图分类、Agent 路由、模型选择）。

建议标题：
`add orchestration decisions panel in task detail`

范围：

- TaskDetail 增加编排决策面板
- 显示意图分类结果、选中 Agent、选中模型、复杂度评估
- 显示规划流水线状态（prometheus/metis/momus 各阶段是否通过）

交付物：

- TaskDetail 或 Tasks 页面编排决策面板

依赖：

- Issue 2.2
- Issue 2.3

验收标准：

- 管理员能看到每个任务的编排决策过程
- 规划流水线各阶段状态可见

### Issue 2.5 ✅ 为编排策略增加 UI 配置入口 [修订]

目标：
让 orchestrator-plugin 的意图分类模式、Agent 映射策略可通过 UI 配置，而非只能编辑 .ts 文件。

建议标题：
`add orchestration strategy config ui`

范围：

- 在 Settings 或项目设置中增加编排策略配置
- 支持修改类别→Agent、类别→模型的映射
- 支持配置是否启用规划流水线（prometheus/metis/momus）

交付物：

- 执行策略配置 UI

依赖：

- Issue 2.1

验收标准：

- 管理员可通过 UI 修改编排策略而非编辑代码
- 策略配置变更后能同步到 orchestrator-plugin

---

## Epic 3: 插件生命周期控制面

### Issue 3.1 ✅ 设计插件元数据模型与状态模型

目标：
把插件从“配置文件路径”升级为“有状态的平台对象”。

建议标题：
`design plugin metadata and lifecycle state`

范围：

- 定义插件名称、版本、来源、启用状态、兼容范围、最近校验时间
- 定义启用、禁用、故障、未安装等状态

交付物：

- 插件元数据设计文档

依赖：

- 无

验收标准：

- 插件可被统一管理，而不是只有路径列表

### Issue 3.2 ✅ 增加插件元数据与状态持久化

目标：
落库插件状态与元数据。

建议标题：
`persist plugin metadata and status`

范围：

- 新增数据表或配置存储结构
- 对现有插件清单做初始化同步

交付物：

- schema / migration
- 初始化同步逻辑

依赖：

- Issue 3.1

验收标准：

- 页面可以读取插件状态而非仅仅读 opencode.json

### Issue 3.3 ✅ 增加插件启用 / 禁用接口

目标：
让平台能够控制插件状态。

建议标题：
`add plugin enable disable api`

范围：

- 新增 enable/disable API
- 同步更新配置文件和元数据状态

交付物：

- BFF config routes 扩展

依赖：

- Issue 3.2

验收标准：

- 插件能通过 UI 启用和禁用
- 变更后状态一致

### Issue 3.4 ✅ 增加插件安装 / 卸载能力

目标：
把插件管理从只读清单提升为基础生命周期管理。

建议标题：
`add plugin install and uninstall flow`

范围：

- 定义插件来源输入方式
- 增加安装与卸载接口
- 增加基础安全校验

交付物：

- API 设计
- 前端安装/卸载交互

依赖：

- Issue 3.1

验收标准：

- 至少支持一类受控插件来源的安装和卸载

### Issue 3.5 ✅ 增加插件兼容性检查任务

目标：
在 OpenCode 升级前后，自动验证插件兼容性。

建议标题：
`add plugin compatibility validation`

范围：

- 定义兼容性检查规则
- 对内部插件和主流插件执行验证
- 输出检查报告

交付物：

- 兼容性检查脚本或任务
- 报告格式

依赖：

- Issue 3.2

验收标准：

- 每次升级前能自动输出插件兼容状态

### Issue 3.6 ✅ Settings 页面升级为插件生命周期控制面

目标：
把现有 Settings 中的插件区域从只读改为可操作控制面。

建议标题：
`upgrade settings plugin section to lifecycle console`

范围：

- 显示插件状态、版本、来源、最近检查结果
- 支持启用、禁用、安装、卸载、校验

交付物：

- Settings 页面插件模块改造

依赖：

- Issue 3.3
- Issue 3.4
- Issue 3.5

验收标准：

- 插件模块可完成基本生命周期操作

---

## Epic 4: 连续执行与恢复机制 [修订]

> **背景修正**：session-tools 已实现 session list/read/search/summary/continue。handoff 命令已实现交接文档生成。Ralph Loop 已实现停滞检测和重试。本 Epic 的目标从"从零建恢复"调整为"把运行时恢复能力暴露给控制面 UI"。

### Issue 4.1 ✅ 将 session-tools 暴露为 BFF 接口 [修订]

目标：
把运行时 session-tools 的能力（session list/read/search/summary/continue）通过 BFF 接口暴露给前端。

建议标题：
`expose session tools via bff api`

范围：

- 通过 OpenCode tool call 接口调用 session-tools 的各功能
- BFF 增加 session 搜索、历史、摘要、续跑接口

交付物：

- handoff 数据结构文档（对齐运行时 handoff 命令输出）
- BFF session 接口

依赖：

- 无

验收标准：

- 前端能通过 BFF 接口查询会话历史
- 能调用 session_continue 发起续跑

### Issue 4.2 ✅ 前端增加会话历史与续跑入口 [修订]

目标：
在 TaskDetail 页面展示会话历史，支持搜索和"续跑"操作。

建议标题：
`add session history and resume ui`

范围：

- TaskDetail 增加会话历史 tab
- 支持按关键字搜索历史会话
- 增加"续跑"按钮（调用 session_continue）
- 显示最近错误与恢复记录

交付物：

- BFF 或 control plane 查询接口
- TaskDetail 会话历史面板

依赖：

- Issue 4.1

验收标准：

- 支持按 taskId、sessionId、关键字检索历史
- 用户可从 UI 直接发起续跑

### Issue 4.3 ✅ 定义 fallback 与 continuation policy [修订]

目标：
为长任务和失败场景建立受治理约束的继续执行策略，让运行时已有的 Ralph Loop、retry 机制可被控制面审计。

建议标题：
`define continuation and fallback policy`

范围：

- 明确哪些错误可自动重试（对齐 task-graph-plugin 的 retry 逻辑）
- 明确何时切换模型或策略（对齐 orchestrator-plugin 的 fallback 逻辑）
- 明确何时必须触发审批或人工介入
- 将恢复行为写入 audit_events

交付物：

- 策略文档（与运行时 retry/fallback 对齐）
- 控制面配置项

依赖：

- Issue 4.1

验收标准：

- 中断任务可恢复
- 失败节点可重试
- continuation 不会绕过治理约束
- fallback 行为可解释、可审计

> ~~Issue 4.4~~ 和 ~~Issue 4.5~~ 已分别合并到 Issue 4.3 和 Issue 4.2。

---

## 3. 建议的执行顺序 [修订]

建议按以下顺序推进：

1. **先打通运行时 DAG → 控制面**：Epic 1 的 Issue 1.1 到 1.4。
2. **并行推进 DAG 同步和编排可视化**：Issue 1.5、1.6 和 Epic 2 的 Issue 2.1、2.2。
3. **在控制面能感知运行时后启动插件治理**：Epic 3。
4. **最后暴露恢复能力**：Epic 4（运行时已有，控制面暴露投入较小）。

原因：

- 运行时编排能力已存在，控制面穿透是最高 ROI 投入。
- 控制面能感知运行时后，治理约束才有挂载点。
- 恢复机制在运行时已运转，控制面暴露可后置。

## 4. 建议的首批迭代范围 [修订]

如果只做第一轮迭代，建议先立这 6 个 issue：

1. Issue 1.1 设计控制面 DAG 镜像数据模型
2. Issue 1.2 实现 DAG 镜像表迁移
3. Issue 1.3 定义节点状态机与运行时对齐规则
4. Issue 1.4 实现 graph 接口对接运行时 DAG
5. Issue 2.1 将运行时意图分类结果同步到控制面
6. Issue 3.1 设计插件元数据模型与状态模型

核心思路是"让控制面能看见运行时"，而非"从零建编排"。

## 5. 一页式结论 [修订]

~~原结论称需要按"任务主模型、规划路由、插件生命周期、恢复机制"从零建设。~~

经复审修正：OpenerX 在运行时层（opencode-fork）已实现大部分编排能力（9 Agent、DAG、规划流水线、意图路由、会话续跑）。最合理的方式是按"**运行时 DAG 穿透 → 编排可视化 → 插件治理 → 恢复暴露**"的顺序，让控制面逐步感知和治理运行时已有能力。这样既保持控制面稳定性，又不重复建设运行时已有的编排内核。
