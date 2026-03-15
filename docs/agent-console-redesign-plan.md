# Agent 控制台重规划方案

## 1. 文档目标

本文档用于把当前偏实时监看的 Agent 控制台，升级为面向运营、治理和处置的跨任务工作台。

本文档覆盖两部分：

- 一版更具体的页面线框和模块清单
- 第二阶段需要新增的后端聚合 API 设计

本文档面向产品、前端、BFF、Service 共同评审，不是最终代码实现说明。

## 2. 当前现状

当前 Agent 控制台的主能力是：

- 查看当前注册中的 Agent 实例
- 基于实时事件流观察状态变化
- 对运行中或暂停中的 Agent 执行暂停、恢复、终止、注入指令

相关实现位置：

- `control-plane/web-ui/src/pages/AgentConsolePage.vue`
- `control-plane/web-ui/src/stores/realtime.ts`
- `control-plane/web-ui-bff/src/modules/agent-control/routes.ts`
- `control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts`

当前结构存在四个明显问题：

1. 页面以“当前运行实例”和“事件流”为中心，难以支撑跨任务判断。
2. 前端实时事件只保留最近 500 条，天然不适合做历史分析。
3. BFF 当前 `/api/agents` 读取的是运行时注册表，不是稳定的历史聚合视图。
4. 已有审批、审计、成本、代码变更等治理数据没有被 Agent 页消费。

## 3. 页面定位调整

建议把当前“Agent 控制台”的产品定位从：

- 实时运行监视器

调整为：

- Agent 运营中心

新页面应优先回答四个问题：

1. 现在有哪些 Agent 需要我介入处理。
2. 哪些任务被 Agent 卡住了。
3. 最近这批 Agent 跑得怎么样。
4. 具体某个 Agent 的上下文、风险、结果和处置入口在哪里。

### 3.1 使用角色补充

为了避免页面既不像操作台、也不像治理台，方案需要明确区分两类核心使用者：

- 普通用户：任务发起人、研发成员、日常跟进任务的人
- 管理员：项目管理员、组织管理员、平台管理员

两类角色都可以进入 Agent 运营中心，但进入页面时要解决的问题不同：

- 普通用户关心“我的任务为什么卡住了，我下一步该怎么处理”
- 管理员关心“哪些任务和 Agent 在系统层面异常，哪里需要治理介入，最近运行质量是否在变差”

因此，Agent 运营中心不能只是一套通用列表，而应在同一信息架构下提供不同默认落点、不同默认筛选和不同深度的信息展示。

### 3.2 普通用户如何使用

普通用户进入 Agent 运营中心的主要场景有四类：

1. 从任务页或任务工作台跳入，查看当前任务关联 Agent 是否卡住
2. 在收到失败、暂停、审批阻塞提醒后，进入页面做一次人工介入
3. 查看最近结束的执行结果，判断是否需要续跑、重试或进入任务详情
4. 在多任务并行时，把页面作为“我的 Agent 工作队列”使用

对普通用户，页面默认应强调“与我相关”和“可立即处理”：

- 默认筛选优先建议为 `ownerScope=mine`
- 默认落点优先建议为 `attention`
- 默认只展示与当前项目或当前任务上下文相关的队列
- 顶部摘要卡点击后，应优先把用户带到可执行动作的队列，而不是纯分析页

普通用户在页面中的核心动作应收敛为：

- 看哪些实例失败、暂停、审批阻塞、长时间无进展
- 打开详情抽屉理解上下文
- 执行暂停、恢复、终止、注入指令
- 跳转任务详情、审批详情、任务工作台继续处理

普通用户默认看到的信息应尽量面向处置，不应让页面退化成治理报表页：

- 默认看摘要、队列、结果、关键事件、处置动作
- 可以看到风险等级和审批状态，但不必默认展开复杂治理解释
- 可以看到结果摘要和代码变更摘要，但不需要默认看到系统级趋势拆解

### 3.3 管理员如何使用

管理员进入 Agent 运营中心的主要场景有五类：

1. 早晚巡检，判断当前项目或全局是否存在异常积压
2. 查看审批阻塞、长时间无进展、高风险失败是否集中在某类 Agent 或模型
3. 从待审批、审计或告警入口回跳，定位单个 Agent Run 的上下文
4. 观察最近一段时间的失败率、介入率、模型表现，决定是否调整模板、Hook、审批标准或模型路由
5. 复盘某次事故，查看关键事件、审批记录、代码变更和人工介入轨迹

对管理员，页面默认应强调“跨任务判断”和“治理联动”：

- 默认可切换 `ownerScope=all | mine`
- 默认可切换项目维度，必要时支持跨项目巡检
- 顶部摘要卡不仅用于跳队列，也要支持判断问题集中区域
- 第二屏分析区应成为管理员高频使用区，而不是可有可无的装饰区块

管理员在页面中的核心动作应包括：

- 按项目、时间范围、风险、审批阻塞、Agent 类型、模型做筛选
- 识别是否存在系统性失败模式或治理瓶颈
- 从详情抽屉进入审批、审计、代码变更、任务详情做进一步处理
- 根据趋势结果决定是否调整治理策略、模板、模型分配或告警阈值

但管理员的“配置动作”不应直接塞进 Agent 运营中心：

- Agent 运营中心负责发现问题、定位问题、进入处置入口
- 审批标准、工作流模板、Hook、模型路由等配置仍应回到专门治理页或设置页
- 否则页面会同时承载运行处置和策略设计，心智会失焦

### 3.4 用户与管理员的页面差异化要求

建议在同一页面框架内做角色化差异，而不是拆成两套页面。

普通用户默认体验建议：

- 默认 `仅看我的任务`
- 默认展开 `需要处理`
- 默认展示精简版分析区，优先结果和事件
- 详情抽屉中治理信息默认折叠，避免信息过载

管理员默认体验建议：

- 默认展示项目级或全局视角
- 默认展示完整摘要卡和分析区
- 详情抽屉中显示更完整的审批、审计、代码变更和风险上下文
- 支持从页面快速跳转到审批、审计、治理配置相关入口

两类角色的关键差异不在“能不能看到 Agent”，而在“默认关注什么”和“默认展示到多深”。

### 3.5 权限与可见性边界

建议明确以下边界，避免后续 UI 和 API 各自演化：

1. `viewer` 可查看聚合结果和详情，但不能执行暂停、恢复、终止、注入指令。
2. `developer` 可查看与自己有权限范围内的项目数据，可对被授权任务执行人工介入。
3. `project_admin` 可查看本项目所有 Agent 运行与治理信息，可处理审批阻塞、查看审计和做项目级巡检。
4. `org_admin` 与 `platform_admin` 可做跨项目汇总、异常排查和趋势判断。
5. 治理配置入口与策略编辑能力不应因为能看到运营中心而自动开放，仍需单独权限控制。

页面层面也应遵循相同原则：

- 无权限的动作按钮直接不展示或置灰并给出原因
- 无权限的治理字段不要返回“空操作入口”，应明确只读
- 如果用户只能看当前项目，就不应展示误导性的全局统计口径

### 3.6 入口与用户旅程补充

为让这页真正成为工作台，而不是孤立页面，建议补充明确入口：

- 从任务工作台跳转时，默认带上 `taskId`、`projectId`、`ownerScope=mine`
- 从审批页跳转时，默认带上 `approvalBlocked=true` 或指定 `agentRunId`
- 从告警或通知跳转时，默认直接打开对应详情抽屉
- 从首页或项目总览进入时，管理员默认落在项目级总览视角

建议补充两个标准旅程：

普通用户旅程：

1. 在任务页发现执行异常
2. 进入 Agent 运营中心的 `需要处理`
3. 打开详情抽屉查看阻塞原因和最近关键事件
4. 选择恢复、注入指令、终止，或跳回任务工作台续跑

管理员旅程：

1. 在首页、审批页或运营巡检中发现异常堆积
2. 进入 Agent 运营中心查看摘要卡和趋势区
3. 用项目、风险、审批阻塞、模型等条件筛出问题集群
4. 针对单条运行查看详情抽屉
5. 跳转审批、审计、代码变更或治理配置页继续处置

### 3.7 对页面结构的新增约束

补充“用户与管理员如何使用”后，页面结构需要增加以下约束：

1. 第一屏始终优先服务处置，不让趋势图挤占操作入口。
2. 第二屏主要服务管理员判断，但普通用户也能读懂，不应充满仅治理人员才能理解的术语。
3. 详情抽屉必须同时支持“快速处理”和“深度复盘”两种模式。
4. 跳转关系要清晰，运营中心负责聚合和分诊，不承担完整任务编辑、审批处理或治理配置职责。
5. 文案要减少“实例、会话、事件流”这类底层运行时术语，优先用任务、阻塞、结果、处置、审批、风险等用户可理解语义。

## 4. 页面信息架构

建议页面自上而下拆成五个区块：

1. 标题与全局操作区
2. 健康概览区
3. 工作队列区
4. 最近结果与趋势区
5. 详情抽屉区

### 4.1 标题与全局操作区

左侧：

- 页面标题：Agent 运营中心
- 副文案：统一查看 Agent 执行健康度、阻塞情况与人工介入入口

右侧：

- 时间范围切换：最近 1 小时 / 24 小时 / 7 天
- 项目筛选
- 仅看我的任务
- 刷新

### 4.2 健康概览区

建议顶部显示 6 张摘要卡片：

1. 待处理事项
2. 运行中 Agent
3. 24 小时完成数
4. 24 小时失败率
5. 平均执行时长
6. 人工介入率

卡片点击后进入对应队列筛选。

### 4.3 工作队列区

建议拆成三列，不再把“实例列表”作为左侧永久主列表：

- 需要处理
- 正在推进
- 最近结束

这三列对应用户的三个核心工作流：

- 去处置
- 去跟进
- 去复盘

### 4.4 最近结果与趋势区

建议放在页面第二屏，包含：

- 失败原因分布
- 状态趋势
- Agent 类型表现排行
- 模型表现排行

### 4.5 详情抽屉区

点击任意 Agent 行后，从右侧打开详情抽屉，不再整页切换到“单实例详情模式”。

抽屉内分四块：

- 运行摘要
- 任务与风险上下文
- 最近关键事件
- 处置动作

## 5. 页面线框

### 5.1 桌面端线框

```text
+--------------------------------------------------------------------------------------+
| Agent 运营中心                              [时间范围] [项目] [仅看我的] [刷新]      |
| 统一查看 Agent 执行健康度、阻塞情况与人工介入入口                                     |
+--------------------------------------------------------------------------------------+
| [待处理 12] [运行中 18] [24h 完成 146] [失败率 8.9%] [平均时长 12m] [介入率 17%]     |
+--------------------------------------------------------------------------------------+
| 需要处理                              | 正在推进                         | 最近结束   |
|--------------------------------------|----------------------------------|-----------|
| 高优先失败 4                         | 运行中 18                        | 已完成 20 |
| 审批阻塞 3                           | 长时间运行 5                     | 失败 6    |
| 暂停待恢复 2                         | 最近有输出 8                     | 已停止 1  |
| 长时间无进展 3                       | 最近 10 分钟无输出 4             |           |
|                                      |                                  |           |
| [Agent 行卡片/表格]                  | [Agent 行卡片/表格]              | [结果表]  |
+--------------------------------------------------------------------------------------+
| 失败原因分布                 | 状态趋势                 | Agent / 模型表现排行         |
| [柱状图]                     | [折线图]                 | [排行表]                     |
+--------------------------------------------------------------------------------------+
| 底部辅助区：精简事件流 / 导出 / 跳转审批 / 跳转任务工作台                            |
+--------------------------------------------------------------------------------------+
| 右侧详情抽屉（点击某条 Agent 打开）                                                  |
| 运行摘要 | 任务上下文 | 审批/审计/代码变更 | 最近关键事件 | 暂停/恢复/终止/注入指令   |
+--------------------------------------------------------------------------------------+
```

### 5.2 移动端线框

```text
+----------------------------------+
| Agent 运营中心                    |
| [时间范围] [项目] [筛选]          |
+----------------------------------+
| 摘要卡横向滑动                    |
| 待处理 | 运行中 | 完成 | 失败率   |
+----------------------------------+
| Tab: 需要处理 | 推进中 | 最近结束 |
+----------------------------------+
| 队列列表                          |
| Agent A                           |
| Agent B                           |
| Agent C                           |
+----------------------------------+
| 趋势与分布折叠区                  |
+----------------------------------+
| 底部抽屉：详情与处置              |
+----------------------------------+
```

### 5.3 普通用户视图线框

普通用户视图应强调“我的任务”和“立即处理”，避免一上来就进入全局运营报表。

```text
+--------------------------------------------------------------------------------------+
| Agent 运营中心                        [我的任务] [当前项目] [刷新]                   |
| 统一查看与我相关的 Agent 阻塞、结果与人工介入入口                                   |
+--------------------------------------------------------------------------------------+
| [待处理 4] [运行中 3] [24h 完成 9] [失败率 11%] [平均时长 8m] [介入率 22%]          |
+--------------------------------------------------------------------------------------+
| 需要处理（默认展开）                   | 正在推进                     | 最近结果      |
|---------------------------------------|------------------------------|--------------|
| 审批阻塞 1                            | 运行中 3                     | 已完成 7     |
| 暂停待恢复 1                          | 最近有输出 2                 | 失败 2       |
| 长时间无进展 2                        | 最近 10 分钟无输出 1         |              |
| [我的 Agent 行卡片]                   | [我的运行实例]               | [我的结果表] |
+--------------------------------------------------------------------------------------+
| 精简关键事件流                        | 快速注入 / 恢复 / 进入任务工作台                         |
+--------------------------------------------------------------------------------------+
| 右侧详情抽屉：运行摘要 | 阻塞原因 | 结果摘要 | 关键事件 | 处置动作                         |
+--------------------------------------------------------------------------------------+
```

普通用户视图设计要点：

- 第一屏默认服务处置，而不是分析
- 默认弱化全局趋势和模型排行
- 详情抽屉优先展示“为什么卡住”“我能做什么”
- 治理信息可以查看，但默认折叠在次级区块

### 5.4 管理员视图线框

管理员视图应强调“项目级或全局判断”“治理联动”“异常聚集定位”。

```text
+------------------------------------------------------------------------------------------------+
| Agent 运营中心                  [时间范围] [项目] [全部/我的] [风险] [审批阻塞] [刷新]        |
| 统一查看 Agent 执行健康度、阻塞情况、治理信号与人工介入入口                                   |
+------------------------------------------------------------------------------------------------+
| [待处理 12] [运行中 18] [24h 完成 146] [失败率 8.9%] [平均时长 12m] [介入率 17%]               |
+------------------------------------------------------------------------------------------------+
| 需要处理                              | 正在推进                         | 最近结束         |
|--------------------------------------|----------------------------------|-----------------|
| 高风险失败 4                         | 长时间运行 5                     | 已完成 20       |
| 审批阻塞 3                           | 最近有输出 8                     | 失败 6          |
| 暂停待恢复 2                         | 最近 10 分钟无输出 4             | 已停止 1        |
| 长时间无进展 3                       |                                  |                 |
| [跨任务队列表]                       | [运行队列表]                     | [结果复盘表]    |
+------------------------------------------------------------------------------------------------+
| 失败原因分布                 | 状态趋势                 | Agent 表现排行 | 模型表现排行     |
| [柱状图]                     | [折线图]                 | [排行表]        | [排行表]         |
+------------------------------------------------------------------------------------------------+
| 辅助区：关键事件 / 导出 / 跳转审批 / 跳转审计 / 跳转任务工作台 / 跳转治理配置                 |
+------------------------------------------------------------------------------------------------+
| 右侧详情抽屉：运行摘要 | 任务上下文 | 审批/审计 | 代码变更 | 关键事件 | 处置动作           |
+------------------------------------------------------------------------------------------------+
```

管理员视图设计要点：

- 第一屏既能处置，也能快速判断异常规模
- 第二屏分析区是主功能区，不是装饰区
- 详情抽屉需要支持从运营定位跳到治理处理
- 页面只承担发现与分诊，不直接承担治理策略编辑

## 6. 模块清单

### 6.1 前端页面模块

建议 `AgentConsolePage.vue` 拆成以下模块：

1. `AgentOpsHeader`
2. `AgentOpsSummaryCards`
3. `AgentOpsFilterBar`
4. `AgentOpsQueueBoard`
5. `AgentOpsRecentResults`
6. `AgentOpsAnalyticsPanel`
7. `AgentOpsDetailDrawer`
8. `AgentOpsEventFeed`

### 6.2 模块职责

#### AgentOpsHeader

职责：

- 显示标题、副文案
- 管理时间范围、项目、归属筛选
- 提供刷新入口

输入：

- 当前时间范围
- 当前项目
- 当前筛选状态

输出：

- 触发全页数据刷新
- 变更查询参数

#### AgentOpsSummaryCards

职责：

- 展示 6 张摘要卡片
- 点击卡片切换到对应队列或筛选

数据来源：

- 聚合接口 `overview`

#### AgentOpsFilterBar

职责：

- 提供状态、优先级、Agent 类型、模型、是否需要人工介入等筛选

建议筛选项：

- 搜索：任务标题 / Agent ID / Agent 类型
- 队列类型：attention / running / recent
- 状态：running / paused / failed / completed / stopped / blocked
- 风险：critical / high / medium / low
- 是否需要人工介入
- 是否审批阻塞
- Agent 类型
- 模型

#### AgentOpsQueueBoard

职责：

- 展示三个主队列
- 支持分页和局部刷新
- 支持点击行打开详情抽屉

建议行字段：

- Agent 类型
- 当前状态
- 所属任务标题
- 最近活动时间
- 当前阻塞原因
- 审批状态
- 风险等级
- 快捷动作入口

#### AgentOpsRecentResults

职责：

- 展示最近结束的 Agent 结果
- 支持“查看结果摘要”“进入任务详情”“查看代码变更”

建议字段：

- 结果状态
- 任务标题
- Agent 类型
- 执行时长
- 结果摘要
- 代码变更摘要

#### AgentOpsAnalyticsPanel

职责：

- 展示失败原因分布
- 展示状态趋势
- 展示 Agent 类型与模型表现排行

#### AgentOpsDetailDrawer

职责：

- 提供单个 Agent 的完整运营视图和处置入口

抽屉结构建议：

1. 基本信息
2. 运行摘要
3. 阻塞与风险
4. 审批与审计
5. 代码变更与输出摘要
6. 最近关键事件
7. 处置动作

#### AgentOpsEventFeed

职责：

- 保留实时感知能力，但仅作为辅助区块
- 默认只显示关键事件，不再展示完整原始时间线

### 6.3 页面模块与交互规则修改清单

为了落实“普通用户 / 管理员差异化要求”，建议把页面模块改造拆成如下清单。

#### 1. AgentOpsHeader 修改点

- 支持根据角色输出不同默认文案
- 支持时间范围、项目、归属范围的统一查询态管理
- 普通用户默认 `ownerScope=mine`
- 管理员默认保留 `all | mine` 切换
- 支持从外部入口带入 `taskId`、`projectId`、`agentRunId` 并回填到页面状态

#### 2. AgentOpsSummaryCards 修改点

- 保留统一 6 张卡片，但根据角色调整默认强调顺序
- 普通用户优先强调 `待处理`、`运行中`、`最近结果`
- 管理员优先强调 `待处理`、`失败率`、`介入率`、`平均时长`
- 卡片点击不仅切换队列，还应写入筛选条件和 URL query

#### 3. AgentOpsFilterBar 修改点

- 分成“基础筛选”和“高级筛选”两层
- 普通用户默认只展示搜索、状态、我的任务、当前项目
- 管理员额外展示时间范围、风险等级、审批阻塞、Agent 类型、模型、是否人工介入
- 高级筛选默认折叠，避免普通用户第一眼被复杂治理条件压住

#### 4. AgentOpsQueueBoard 修改点

- 三列保留，但默认焦点因角色而异
- 普通用户默认展开 `attention`
- 管理员默认展开三列全视图
- 队列行增加“与我相关”的上下文字段，例如任务标题、项目、审批状态
- 队列行快捷动作按权限动态展示，避免无权限按钮造成误导

#### 5. AgentOpsRecentResults 修改点

- 普通用户视图强调结果摘要、续跑入口、进入任务详情
- 管理员视图额外强调失败原因、代码变更摘要、复盘入口
- 支持从最近结果直接切到同类失败筛选，方便管理员批量判断

#### 6. AgentOpsAnalyticsPanel 修改点

- 普通用户默认折叠或弱化该区块
- 管理员默认展开该区块
- 图表点击后应能反向写入页面筛选，例如点击失败原因后切入 attention 队列
- 排行表要能跳到相应 Agent 类型或模型的筛选结果

#### 7. AgentOpsDetailDrawer 修改点

- 抽屉顶部增加“视图模式”概念：快速处理 / 深度复盘
- 普通用户默认打开“快速处理”模式
- 管理员默认打开“深度复盘”模式，或至少能看到更多治理信息
- 抽屉区块建议重排为：运行摘要、阻塞原因、结果摘要、治理上下文、关键事件、处置动作
- 审批、审计、代码变更需要提供跳转入口，而不是只停留在文本说明

#### 8. AgentOpsEventFeed 修改点

- 保持辅助定位，不再作为主视图
- 普通用户默认只看与当前筛选结果相关的关键事件
- 管理员支持切换为“全局关键事件”或“当前筛选下关键事件”
- 事件点击可反查对应 Agent Run 并打开抽屉

#### 9. 页面级交互规则补充

1. 路由参数应完整承载角色化默认筛选，保证从其他页面跳转时上下文不丢。
2. 页面刷新应区分“局部刷新队列”和“全页刷新含分析区”，避免所有操作都触发重载。
3. 用户手工切换成全局视角后，不应因为自动刷新又被强制切回“我的任务”。
4. 高优先异常项点击后，应直接打开抽屉或跳到 attention 过滤结果，而不是只做视觉高亮。
5. 分析区筛选、卡片筛选、顶部筛选必须共用一套 query state，避免出现三个互不一致的筛选系统。

### 6.4 详情抽屉字段清单

建议抽屉字段分组如下。

#### 基本信息

- Agent Run ID
- Agent 类型
- 所属任务 ID / 标题
- 所属项目
- 当前状态
- 当前阶段
- 当前模型

#### 运行摘要

- 启动时间
- 最近活动时间
- 结束时间
- 总时长
- Token 消耗
- 是否人工介入过
- 介入次数

#### 阻塞与风险

- 当前阻塞类型
- 阻塞原因摘要
- 风险等级
- 是否有待审批单
- 是否触发恢复前 Hook

#### 审批与审计

- 审批单数量与最新状态
- 最近审计事件
- 最近高风险动作

#### 代码变更与输出摘要

- 代码变更文件数
- 新增 / 删除行数
- 最新结果摘要
- 错误摘要

#### 最近关键事件

- started
- paused / resumed
- failed / stopped
- approval.created / approval.resolved
- audit.high_risk
- code_change.recorded

#### 处置动作

- 暂停
- 恢复
- 终止
- 注入指令
- 进入任务详情
- 查看审批
- 查看审计
- 查看代码变更

## 7. 页面交互规则

### 7.1 默认落点

页面默认落在“需要处理”队列，而不是“全部实例”。

原因：

- 用户进入控制台通常是来处理问题，不是来看列表。

### 7.2 队列优先级规则

`需要处理` 队列按以下优先级排序：

1. 失败且风险等级为 critical / high
2. 审批阻塞
3. 暂停待恢复
4. 长时间无进展
5. 已停止待确认

`正在推进` 队列按最近活动时间倒序。

`最近结束` 队列按结束时间倒序。

### 7.3 长时间无进展规则

建议默认规则：

- 运行中但 10 分钟内无新事件，标记为“无进展”
- 运行中但超过 30 分钟未完成，标记为“长时间运行”

该规则需由聚合接口统一计算，不放到前端硬编码。

### 7.4 人工介入规则

满足以下任一条件视为人工介入：

- 执行过注入指令
- 发生过手工恢复
- 发生过审批决策
- 发生过手工终止

### 7.5 结果摘要规则

最近结束队列中的结果摘要建议优先取：

1. `agent_runs.result`
2. 最近一次完成事件中的结构化结果
3. 任务变更摘要
4. 空值时显示“无结构化结果摘要”

### 7.6 用户与管理员差异化交互规则

#### 默认进入规则

- 普通用户从导航进入时，默认 `ownerScope=mine`
- 管理员从导航进入时，默认 `ownerScope=all`
- 从任务详情、任务工作台进入时，优先保留任务上下文，而不是覆盖成全局视角

#### 抽屉打开规则

- 普通用户点击队列项后，抽屉默认落在“阻塞与处置”区块
- 管理员点击队列项后，抽屉默认落在“运行摘要”或“治理上下文”区块
- 从审批页跳转打开抽屉时，应直接高亮审批相关信息

#### 行动反馈规则

- 普通用户执行恢复、终止、注入指令后，页面优先反馈“当前任务状态是否已改变”
- 管理员执行或查看后，页面还应反馈“该异常是否仍在队列中、是否影响统计口径”

#### 空态规则

- 普通用户空态文案强调“当前没有需要你处理的 Agent”
- 管理员空态文案强调“当前筛选条件下没有异常或结果数据”

#### 升级路径规则

- 普通用户无法直接完成的问题，页面应提供明确升级入口，例如“查看审批”“联系管理员”“跳转任务工作台”
- 管理员无法在本页完成的策略性动作，应提供“跳转治理配置页”而不是在本页堆更多配置控件

## 8. 第二阶段后端改造目标

第二阶段的目标不是继续扩展实时事件流，而是引入稳定的聚合视图能力。

### 8.1 设计原则

1. Service 负责持久化查询和聚合计算。
2. BFF 负责补充实时态修正和前端字段整形。
3. 页面关键区块必须依赖稳定聚合接口，不能直接读取前端事件缓存推导。
4. 当前 `/api/agents` 继续保留，作为实时控制接口，不承担总览职责。

### 8.2 可直接复用的数据源

现有 Service 数据模型已具备聚合基础：

- `agent_runs`
- `approval_tickets`
- `audit_events`
- `cost_records`
- `code_changes`
- `tasks`

其中 `agent_runs` 已存在，是第二阶段的核心主表。

## 9. 第二阶段 API 设计

建议按“Service 聚合 + BFF 对外”两层设计。

### 9.1 Service 层新增接口

#### 1. GET /api/agent-runs/overview

用途：

- 返回页面顶部摘要卡片和各主队列计数。

查询参数：

- `projectId` 可选
- `from` 可选
- `to` 可选
- `ownerScope` 可选，`all | mine`
- `includeRealtime` 可选，默认 `false`

响应结构：

```ts
interface AgentRunsOverviewResponse {
  summary: {
    attentionCount: number;
    runningCount: number;
    completedCount: number;
    failureRate: number;
    avgDurationMs: number | null;
    humanInterventionRate: number;
  };
  queueCounts: {
    attention: number;
    running: number;
    recent: number;
  };
  blockerBreakdown: {
    failedHighRisk: number;
    approvalBlocked: number;
    pausedAwaitingResume: number;
    stalled: number;
    stoppedPendingReview: number;
  };
}
```

数据来源：

- `agent_runs`
- `approval_tickets`
- `audit_events`

#### 2. GET /api/agent-runs/queues

用途：

- 返回页面三个主队列的数据源。

查询参数：

- `queue` 必填，`attention | running | recent`
- `projectId` 可选
- `from` 可选
- `to` 可选
- `page` 可选
- `pageSize` 可选
- `status` 可选
- `riskLevel` 可选
- `agentType` 可选
- `model` 可选
- `requiresIntervention` 可选
- `approvalBlocked` 可选
- `search` 可选

响应结构：

```ts
interface AgentRunQueueItem {
  agentRunId: string;
  taskId: string;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  agentType: string;
  status: "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
  currentStage: string | null;
  blockerType: "approval" | "stalled" | "manual_resume" | "failed" | "stopped" | null;
  blockerReason: string | null;
  riskLevel: "low" | "medium" | "high" | "critical" | null;
  approvalStatus: "pending" | "approved" | "rejected" | "expired" | null;
  requiresIntervention: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  durationMs: number | null;
  modelUsed: string | null;
  resultSummary: string | null;
  codeChangesSummary: {
    files: number;
    insertions: number;
    deletions: number;
  } | null;
}

interface AgentRunQueueResponse {
  data: AgentRunQueueItem[];
  page: number;
  pageSize: number;
  total: number;
}
```

#### 3. GET /api/agent-runs/:agentRunId/summary

用途：

- 作为右侧详情抽屉的主数据源。

响应结构：

```ts
interface AgentRunDetailSummary {
  agentRunId: string;
  task: {
    id: string;
    title: string | null;
    projectId: string | null;
    projectName: string | null;
  };
  runtime: {
    agentType: string;
    status: string;
    currentStage: string | null;
    modelUsed: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    lastActivityAt: string | null;
    durationMs: number | null;
    tokenUsed: number | null;
    result: string | null;
    error: string | null;
  };
  intervention: {
    required: boolean;
    count: number;
    injectedGuidanceCount: number;
    manualResumeCount: number;
    manualTerminateCount: number;
    approvalDecisionCount: number;
  };
  governance: {
    riskLevel: "low" | "medium" | "high" | "critical" | null;
    approvalTickets: number;
    pendingApprovals: number;
    latestApprovalStatus: string | null;
    recentAuditEvents: number;
  };
  codeChanges: {
    changeCount: number;
    files: number;
    insertions: number;
    deletions: number;
    latestSummary: string | null;
  };
  latestEvents: Array<{
    ts: string;
    type: string;
    summary: string;
  }>;
}
```

#### 4. GET /api/agent-runs/analytics/health

用途：

- 返回摘要图表和排行所需的统计数据。

查询参数：

- `projectId` 可选
- `from` 必填
- `to` 必填
- `groupBy` 可选，`agentType | model | day | hour`

响应结构：

```ts
interface AgentRunsHealthAnalyticsResponse {
  totals: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    stoppedRuns: number;
    humanInterventionRuns: number;
  };
  ranking: Array<{
    key: string;
    totalRuns: number;
    successRate: number;
    avgDurationMs: number | null;
    avgTokenUsed: number | null;
  }>;
}
```

#### 5. GET /api/agent-runs/analytics/failures

用途：

- 返回失败原因分布和阻塞类型分布。

响应结构：

```ts
interface AgentRunsFailureAnalyticsResponse {
  reasons: Array<{
    key: string;
    label: string;
    count: number;
  }>;
  blockers: Array<{
    key: string;
    label: string;
    count: number;
  }>;
}
```

#### 6. GET /api/agent-runs/analytics/timeline

用途：

- 返回状态趋势图数据。

查询参数：

- `projectId` 可选
- `from` 必填
- `to` 必填
- `bucket` 可选，`hour | day`

响应结构：

```ts
interface AgentRunsTimelineResponse {
  buckets: Array<{
    bucketStart: string;
    runningCount: number;
    completedCount: number;
    failedCount: number;
    interventionCount: number;
  }>;
}
```

### 9.2 BFF 层对外接口

建议 BFF 对前端保持 `/api/agents/*` 风格，隐藏 Service 聚合细节。

建议新增：

- `GET /api/agents/overview`
- `GET /api/agents/queues`
- `GET /api/agents/:agentRunId/summary`
- `GET /api/agents/analytics/health`
- `GET /api/agents/analytics/failures`
- `GET /api/agents/analytics/timeline`

### 9.3 BFF 侧职责

#### 实时态修正

BFF 需要把 Service 聚合结果与当前运行时注册表做一次轻量合并：

- 如果 Agent 当前仍在内存注册表里且状态更新更近，则以运行时状态覆盖聚合快照。
- 如果 Agent 已结束，则直接使用 Service 聚合结果。

#### 字段整形

BFF 负责：

- 补充 `taskTitle`
- 统一 `status` 枚举
- 统一 `blockerType`、`riskLevel`、`approvalStatus`
- 生成前端可直接展示的 `resultSummary`

### 9.4 前端 / BFF / Service 改造点下沉清单

为了支持用户与管理员的差异化视图，建议把改造点进一步拆到三层。

#### 前端改造点

1. 增加统一的页面查询模型，至少包含：`ownerScope`、`projectId`、`from`、`to`、`status`、`riskLevel`、`approvalBlocked`、`requiresIntervention`、`agentType`、`model`、`taskId`、`agentRunId`。
2. 增加角色感知的页面初始化逻辑，根据当前用户角色决定默认 query。
3. 增加“基础筛选 / 高级筛选”两层 UI，而不是把所有筛选平铺在同一层。
4. 为摘要卡、分析图、队列列表、详情抽屉建立同一份共享 query state。
5. 为详情抽屉增加“快速处理 / 深度复盘”视图模式。
6. 增加从审批页、任务页、工作台、告警通知进入时的路由参数适配。
7. 动作按钮按权限控制显示与置灰状态，并提供明确原因。
8. 为普通用户和管理员定义不同空态、不同默认展开区块、不同默认排序。

#### BFF 改造点

1. 在 `/api/agents/overview`、`/api/agents/queues`、`/api/agents/analytics/*` 中统一转发 `ownerScope`、`projectId`、`from`、`to`、`riskLevel`、`approvalBlocked`、`agentType`、`model` 等查询条件。
2. 增加对 `taskId`、`agentRunId` 场景的快捷查询支持，便于从任务或审批直接跳入具体对象。
3. 在 BFF 层补齐前端直接可用的字段，例如：
  `canPause`、`canResume`、`canTerminate`、`canInjectGuidance`、`canViewAudit`、`canViewApproval`。
4. 将角色相关能力下沉为可消费字段，而不是让前端重复推断 RBAC 规则。
5. 对普通用户默认返回其权限范围内可见项目数据，避免前端误拼出不可访问的全局口径。
6. 对管理员模式增加更完整的聚合补充字段，例如 blocker breakdown、governance summary、code changes summary。
7. 对从运行时回填的数据和聚合数据建立一致的字段语义，避免普通用户看到“运行时态”，管理员看到“聚合态”但字段名相同、含义不同。

#### Service 改造点

1. `overview` 接口补齐 `blockerBreakdown`，用于管理员判断异常构成。
2. `queues` 接口补齐 `riskLevel`、`approvalBlocked`、`agentType`、`model`、`projectId`、`ownerScope`、时间范围等过滤能力。
3. `summary` 接口补齐审批、审计、代码变更、介入拆分统计、当前阶段等字段，支撑“深度复盘”抽屉。
4. 增加 analytics 系列接口，支撑失败原因、趋势、Agent/模型表现排行。
5. 增加按 `taskId` 查关联 Agent Runs 的能力，支持从任务工作台进入时快速定位。
6. 增加按 `agentRunId` 读取完整治理上下文的能力，避免 BFF 自己拼复杂关联。
7. 在聚合层统一实现“10 分钟无进展”“30 分钟长时间运行”等规则，前端只消费结论。

#### 权限改造点

建议新增一组面向运营中心的动作权限，而不是只复用页面级读写权限：

- `agentRuns.read`
- `agentRuns.intervene`
- `agentRuns.viewGovernance`
- `agentRuns.viewCrossProject`
- `agentRuns.export`

建议角色映射：

- `viewer`：`agentRuns.read`
- `developer`：`agentRuns.read` + 在授权范围内的 `agentRuns.intervene`
- `project_admin`：`agentRuns.read` + `agentRuns.intervene` + `agentRuns.viewGovernance`
- `org_admin` / `platform_admin`：再增加 `agentRuns.viewCrossProject` 与导出能力

这样前端、BFF、Service 可以围绕统一动作权限收敛，而不是在多个层面重复判断“管理员到底多看到什么”。

#### API 契约补充建议

为减少前端重复拼装，建议在聚合响应中加入视图层友好字段：

- `viewScope`: `mine | project | global`
- `actionPermissions`
- `entryContext`: `nav | task | workbench | approval | alert`
- `primaryAttentionReason`
- `quickActions`

这些字段不是替代底层事实，而是把“运营中心如何展示和引导用户行动”的语义前移到接口层，降低页面逻辑复杂度。

## 10. 聚合口径说明

### 10.1 attention 队列判定

当满足以下任一条件时进入 `attention`：

- `agent_runs.status = failed`
- `agent_runs.status = paused` 且存在待人工恢复判定
- 关联 `approval_tickets.status = pending`
- 运行中但超过“无进展阈值”
- `stopped / terminated` 且未被标记为已处理

### 10.2 recent 队列判定

满足以下条件之一：

- 最近时间窗口内 `completed`
- 最近时间窗口内 `failed`
- 最近时间窗口内 `stopped / terminated`

### 10.3 人工介入率

分子：有人工介入记录的 Agent Run 数。

分母：时间范围内结束或进行中的 Agent Run 总数。

人工介入事件来源：

- guidance 注入
- resume
- terminate
- approval resolve

### 10.4 失败率

建议口径：

- 失败率 = failed runs / ended runs

其中 `ended runs = completed + failed + stopped + terminated`

## 11. 建议落地顺序

### 阶段 A：页面重组，不改 Service 聚合

目标：

- 用现有接口和实时数据把页面改成“概览 + 队列 + 抽屉”

可先上线模块：

- Header
- SummaryCards 的简化版
- QueueBoard 的简化版
- DetailDrawer 的简化版

### 阶段 B：新增聚合接口

目标：

- 用稳定聚合接口替换前端自行推导

必须新增：

1. `/api/agent-runs/overview`
2. `/api/agent-runs/queues`
3. `/api/agent-runs/:agentRunId/summary`

### 阶段 C：分析面板上线

目标：

- 上线失败分布、趋势、排行

必须新增：

1. `/api/agent-runs/analytics/health`
2. `/api/agent-runs/analytics/failures`
3. `/api/agent-runs/analytics/timeline`

## 12. 实施建议

如果按照最小可用路径推进，建议优先顺序如下：

1. 先改前端页面结构，把“实时事件流主视图”降级为辅助模块。
2. 再补 `overview / queues / summary` 三个聚合接口，支撑首页与抽屉主数据。
3. 最后补 analytics 三个接口，上线趋势与复盘能力。

这样可以确保第一阶段就改善“页面价值感”，第二阶段再补齐“治理和分析能力”。

## 13. 可执行研发任务清单

本节把方案进一步下沉成可执行研发任务，按前端 / BFF / Service 三条线拆分，并按批次排期。

### 13.1 批次划分原则

分批原则如下：

1. 先让页面的用户心智正确，再补稳定聚合能力。
2. 先保证普通用户可以顺畅处理问题，再补管理员的趋势与治理视角。
3. 每一批都要求形成可验收闭环，而不是只交付半套接口或半套页面。

建议分为四批：

- 批次 1：页面骨架与角色化入口
- 批次 2：聚合接口增强与抽屉主数据
- 批次 3：分析区与管理员治理视图
- 批次 4：联动优化、导出与回跳收尾

### 13.2 批次 1：页面骨架与角色化入口

目标：

- 让 Agent 页从“实时实例页”切换成“运营工作台”
- 落地普通用户 / 管理员的默认进入差异
- 不依赖新的 Service 聚合 schema 也能先跑通主视图

#### 批次 1 前端任务

1. 把 `AgentConsolePage.vue` 重构为页面容器 + 子模块骨架。
2. 新增统一 query state，至少承载 `ownerScope`、`projectId`、`taskId`、`agentRunId`、`status`、`search`、`queue`。
3. 实现角色化默认进入逻辑：
   普通用户默认 `ownerScope=mine` + `queue=attention`；管理员默认 `ownerScope=all` + 三列全开。
4. 落地普通用户和管理员两套首屏呈现差异：
   普通用户优先处置区；管理员优先概览 + 队列。
5. 把关键事件流降级为辅助区，不再作为首屏主视图。
6. 支持从任务页、工作台、审批页传入 query 并还原筛选状态。

#### 批次 1 BFF 任务

1. 为现有 `/api/agents/overview`、`/api/agents/queues` 增加 `ownerScope`、`projectId`、`taskId`、`agentRunId` 查询透传约定。
2. 在响应中补一层轻量 `actionPermissions` 草案字段，即便初期先返回保守值。
3. 对从任务页或审批页跳入的场景补快捷聚合支持，避免前端多次发散请求。

#### 批次 1 Service 任务

1. 增加 `ownerScope`、`projectId` 基础过滤一致性检查。
2. 增加按 `taskId` 查关联 runs 的基础能力。
3. 保证 attention / running / recent 的聚合口径不因前端角色差异而变化，只让 query 改变可见范围。

#### 批次 1 验收标准

1. 普通用户进入页面后默认看到“我的待处理 Agent”。
2. 管理员进入页面后默认看到项目级或全局视角。
3. 从任务页和审批页进入时，页面能保留入口上下文。
4. 页面首屏不再依赖完整实时事件流才能成立。

### 13.3 批次 2：聚合接口增强与抽屉主数据

目标：

- 让首页、队列、抽屉的数据都依赖稳定聚合接口
- 让普通用户和管理员在同一抽屉里看到不同深度的信息

#### 批次 2 前端任务

1. 补 `AgentOpsFilterBar` 的基础筛选与高级筛选分层。
2. 补 `AgentOpsDetailDrawer` 的双模式：`quickAction` / `deepReview`。
3. 接入抽屉中的审批、审计、代码变更、任务跳转入口。
4. 补队列行上的审批状态、风险等级、主阻塞原因和快捷动作。
5. 统一摘要卡、队列、抽屉与 URL query 的共享状态。

#### 批次 2 BFF 任务

1. 扩展 `/api/agents/queues` 支持 `riskLevel`、`approvalBlocked`、`agentType`、`model`、`requiresIntervention`。
2. 扩展 `/api/agents/:agentRunId/summary`，增加 `actionPermissions`、`entryContext`、`viewScope`。
3. 将运行时回填与聚合字段对齐，避免前端分支过多。
4. 在 summary 响应中增加前端可直接消费的治理摘要字段。

#### 批次 2 Service 任务

1. 扩展 `overview` 响应，补 `blockerBreakdown`。
2. 扩展 `queues` 过滤条件，补 `riskLevel`、`approvalBlocked`、`agentType`、`model`、时间范围过滤。
3. 扩展 `summary`，补齐：
   当前阶段、审批统计、审计统计、代码变更统计、介入拆分统计、待审批状态。
4. 在聚合层统一实现 `stalled` 与 `longRunning` 判断。

#### 批次 2 验收标准

1. 队列筛选不再局限于搜索和状态。
2. 抽屉可以支撑“快速处理”和“深度复盘”两种使用模式。
3. 普通用户能完成恢复、终止、注入指令等操作。
4. 管理员能看到审批、审计、代码变更与风险摘要。

### 13.4 批次 3：分析区与管理员治理视图

目标：

- 让管理员真正能用这页做趋势判断和异常聚类定位
- 保持普通用户不会被分析区干扰

#### 批次 3 前端任务

1. 实现 `AgentOpsAnalyticsPanel`，包含失败原因分布、状态趋势、Agent 表现排行、模型表现排行。
2. 支持图表点击回写筛选条件。
3. 对普通用户默认折叠分析区，对管理员默认展开。
4. 为管理视图补充导出入口、审计跳转入口和治理配置跳转入口。

#### 批次 3 BFF 任务

1. 新增 `/api/agents/analytics/health`。
2. 新增 `/api/agents/analytics/failures`。
3. 新增 `/api/agents/analytics/timeline`。
4. 在 analytics 响应中补齐前端直接可消费的 label 与排序字段。

#### 批次 3 Service 任务

1. 实现 health 聚合。
2. 实现 failures / blockers 聚合。
3. 实现 timeline 聚合。
4. 按项目、时间范围、模型、Agent 类型验证统计口径一致性。

#### 批次 3 验收标准

1. 管理员可通过分析区定位失败集中模式。
2. 图表与队列筛选互相联动。
3. 普通用户默认不被趋势图打断主流程。

### 13.5 批次 4：联动优化、导出与回跳收尾

目标：

- 把运营中心接入任务、审批、审计、工作台的真实工作流
- 收敛为一个可运营、可分诊、可回跳的工作台

#### 批次 4 前端任务

1. 完成从任务页、审批页、首页告警、任务工作台进入的路由适配。
2. 增加导出、复制诊断信息、固定分享链接等能力。
3. 优化空态、错误态、无权限态文案。

#### 批次 4 BFF 任务

1. 为导出和分享视图定义稳定的 query 契约。
2. 增加带上下文的深链接支持。
3. 增加必要的只读导出接口或复用现有聚合接口导出模式。

#### 批次 4 Service 任务

1. 对跨页回跳场景补充必要索引与查询优化。
2. 评估导出与大时间范围查询的性能边界。

#### 批次 4 验收标准

1. 用户能从任务、审批、工作台无缝回跳到运营中心。
2. 管理员能导出当前筛选结果做线下复盘。
3. 链接分享后能恢复主要筛选与视图状态。

### 13.6 研发任务卡片模板

为了让后续直接拆 Jira / GitHub Issues，建议每个任务卡片统一包含：

- 任务标题
- 所属批次
- 所属层：前端 / BFF / Service
- 依赖任务
- 输入接口或上游字段
- 输出物
- 验收标准
- 是否影响普通用户视图
- 是否影响管理员视图
- 是否涉及权限或统计口径变更

## 14. 接口定义与页面实现草案

本节作为直接开工的草案，优先约束前端 query model、BFF 对外契约和页面状态结构。

### 14.1 前端页面查询模型草案

```ts
type AgentOpsViewMode = "user" | "admin";
type AgentOpsOwnerScope = "mine" | "all";
type AgentOpsQueue = "attention" | "running" | "recent";
type AgentOpsEntryContext = "nav" | "task" | "workbench" | "approval" | "alert";

interface AgentOpsPageQuery {
  ownerScope: AgentOpsOwnerScope;
  queue?: AgentOpsQueue;
  projectId?: string;
  taskId?: string;
  agentRunId?: string;
  search?: string;
  status?: "running" | "paused" | "failed" | "completed" | "stopped" | "terminated";
  riskLevel?: "low" | "medium" | "high" | "critical";
  approvalBlocked?: boolean;
  requiresIntervention?: boolean;
  agentType?: string;
  model?: string;
  from?: string;
  to?: string;
  entryContext?: AgentOpsEntryContext;
}
```

约束建议：

1. query state 由页面容器统一管理，子组件只收 props 和发 events。
2. `viewMode` 不直接写入 URL，可由当前角色和 query 推导。
3. `entryContext` 写入 URL，用于页面首屏决定默认展开和抽屉高亮。

### 14.2 前端页面容器状态草案

```ts
interface AgentOpsPageState {
  query: AgentOpsPageQuery;
  viewMode: AgentOpsViewMode;
  overview: AgentOpsOverviewView | null;
  queues: {
    attention: AgentOpsQueueView;
    running: AgentOpsQueueView;
    recent: AgentOpsQueueView;
  };
  analytics: AgentOpsAnalyticsView | null;
  drawer: {
    open: boolean;
    agentRunId: string | null;
    mode: "quickAction" | "deepReview";
    data: AgentOpsSummaryView | null;
  };
}
```

页面初始化顺序建议：

1. 解析当前用户角色，推导 `viewMode`。
2. 解析 URL query 与入口上下文。
3. 合并默认 query。
4. 并发请求 overview + queues。
5. 若存在 `agentRunId`，直接打开抽屉并加载 summary。
6. 管理员模式再加载 analytics；普通用户模式可延迟加载或不主动加载。

### 14.3 页面组件拆分草案

建议最终拆分如下：

- `AgentOpsPageContainer`
- `AgentOpsHeader`
- `AgentOpsSummaryCards`
- `AgentOpsFilterBar`
- `AgentOpsQueueBoard`
- `AgentOpsQueueColumn`
- `AgentOpsRecentResults`
- `AgentOpsAnalyticsPanel`
- `AgentOpsDetailDrawer`
- `AgentOpsGovernancePanel`
- `AgentOpsEventFeed`

推荐数据流：

- 页面容器负责 query、加载、权限、路由同步
- Header / FilterBar 只负责修改 query
- QueueBoard / AnalyticsPanel 负责发出“聚焦某类数据”的事件
- DetailDrawer 独立请求 summary，避免整个页面因为抽屉而全量刷新

### 14.4 前端 API 类型草案

```ts
interface AgentOpsActionPermissions {
  canPause: boolean;
  canResume: boolean;
  canTerminate: boolean;
  canInjectGuidance: boolean;
  canViewApproval: boolean;
  canViewAudit: boolean;
  canViewCodeChanges: boolean;
  canExport: boolean;
}

interface AgentOpsOverviewView {
  viewScope: "mine" | "project" | "global";
  summary: {
    attentionCount: number;
    runningCount: number;
    completedCount: number;
    failureRate: number;
    avgDurationMs: number | null;
    humanInterventionRate: number;
  };
  queueCounts: {
    attention: number;
    running: number;
    recent: number;
  };
  blockerBreakdown: {
    failedHighRisk: number;
    approvalBlocked: number;
    pausedAwaitingResume: number;
    stalled: number;
    stoppedPendingReview: number;
  };
  generatedAt: string;
}

interface AgentOpsQueueItemView {
  agentRunId: string;
  taskId: string;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  agentType: string;
  modelUsed: string | null;
  status: string;
  currentStage: string | null;
  blockerType: string | null;
  blockerLabel: string;
  blockerReason: string | null;
  primaryAttentionReason: string | null;
  riskLevel: string | null;
  approvalStatus: string | null;
  requiresIntervention: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  durationMs: number | null;
  tokenUsed: number;
  resultSummary: string | null;
  quickActions: string[];
  actionPermissions: AgentOpsActionPermissions;
}

interface AgentOpsSummaryView {
  agentRunId: string;
  entryContext: AgentOpsEntryContext;
  viewScope: "mine" | "project" | "global";
  task: {
    id: string;
    title: string | null;
    projectId: string | null;
    projectName: string | null;
  };
  runtime: {
    agentType: string;
    status: string;
    currentStage: string | null;
    modelUsed: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    lastActivityAt: string | null;
    durationMs: number | null;
    tokenUsed: number | null;
    result: string | null;
    error: string | null;
  };
  intervention: {
    required: boolean;
    count: number;
    injectedGuidanceCount: number;
    manualResumeCount: number;
    manualTerminateCount: number;
    approvalDecisionCount: number;
  };
  governance: {
    riskLevel: "low" | "medium" | "high" | "critical" | null;
    approvalTickets: number;
    pendingApprovals: number;
    latestApprovalStatus: string | null;
    recentAuditEvents: number;
    latestHighRiskAction: string | null;
  };
  codeChanges: {
    changeCount: number;
    files: number;
    insertions: number;
    deletions: number;
    latestSummary: string | null;
  };
  latestEvents: Array<{ ts: string; type: string; summary: string }>;
  actionPermissions: AgentOpsActionPermissions;
}
```

### 14.5 BFF 对外接口草案

#### GET /api/agents/overview

查询参数：

- `ownerScope`
- `projectId`
- `from`
- `to`
- `entryContext`

返回：`AgentOpsOverviewView`

#### GET /api/agents/queues

查询参数：

- `queue`
- `ownerScope`
- `projectId`
- `taskId`
- `from`
- `to`
- `search`
- `status`
- `riskLevel`
- `approvalBlocked`
- `requiresIntervention`
- `agentType`
- `model`
- `page`
- `pageSize`

返回：

```ts
interface AgentOpsQueueResponseView {
  data: AgentOpsQueueItemView[];
  page: number;
  pageSize: number;
  total: number;
}
```

#### GET /api/agents/:agentRunId/summary

查询参数：

- `entryContext`

返回：`AgentOpsSummaryView`

#### GET /api/agents/analytics/health

查询参数：

- `ownerScope`
- `projectId`
- `from`
- `to`
- `groupBy=agentType|model`

#### GET /api/agents/analytics/failures

查询参数：

- `ownerScope`
- `projectId`
- `from`
- `to`

#### GET /api/agents/analytics/timeline

查询参数：

- `ownerScope`
- `projectId`
- `from`
- `to`
- `bucket=hour|day`

### 14.6 Service 聚合实现草案

Service 层建议拆成三个聚合服务，而不是全部塞在路由文件：

- `agent-runs-overview-service`
- `agent-runs-queue-service`
- `agent-runs-summary-service`

分析区再单独拆：

- `agent-runs-analytics-service`

每个 service 统一输入：

```ts
interface AgentRunsAggregateQuery {
  userId: string;
  role: string;
  ownerScope?: "mine" | "all";
  projectId?: string;
  taskId?: string;
  from?: string;
  to?: string;
}
```

统一输出原则：

1. 先产出稳定事实字段。
2. 再产出运营语义字段，例如 blocker、primaryAttentionReason。
3. 前端展示友好字段尽量在 BFF 补齐，不让 Service 绑定 UI 细节。

### 14.7 页面实现顺序草案

如果直接开始实现，建议顺序如下：

1. 在前端先抽出 query state 和页面骨架组件。
2. 同时在 BFF 扩 overview / queues / summary 的 query 透传和响应字段。
3. Service 先补 `overview + queues + summary` 的缺口，先不做 analytics。
4. 前端完成普通用户视图与管理员视图的首屏差异。
5. 再补 analytics 三接口与分析区。
6. 最后补导出、深链接、审批/审计/治理回跳。

### 14.8 可直接创建的研发任务建议

建议下一步直接创建以下任务：

1. 前端：抽离 AgentOps 页面容器与统一 query state。
2. 前端：实现普通用户 / 管理员默认视图差异。
3. BFF：扩展 agents overview / queues / summary 查询参数与权限字段。
4. Service：补 overview blockerBreakdown 与 queues 高级筛选。
5. Service：补 summary 治理与代码变更统计。
6. 前端：实现 DetailDrawer 双模式。
7. BFF + Service：新增 analytics 三接口。
8. 前端：实现 AnalyticsPanel 与图表筛选联动。
