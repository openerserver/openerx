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

### 6.3 详情抽屉字段清单

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