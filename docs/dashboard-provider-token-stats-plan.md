# Dashboard 首页 Provider Token 统计规划

## 1. 文档目标

本文档用于把当前首页 Dashboard 从“实时事件入口页”升级为“项目级 AI 使用概览页”的第一阶段方案，重点补齐单个 provider 维度的 token 统计信息。

这个页面的核心目标，不只是展示 token 消耗本身，而是帮助管理员做模型重分配决策：

- 找到哪些任务正在使用过重的模型
- 找到哪些 provider 在消耗更多 token 的同时，并没有带来更稳定的完成质量
- 找到哪些 provider 更适合高准确性任务，哪些 provider 更适合低成本批量任务
- 用更少的 token，完成更准确的任务，并把合适的模型分配给合适的任务类型

本文档覆盖三部分内容：

- 首页需要新增的 provider token 统计视图与交互
- Service / BFF / Web UI 的接口与数据结构设计
- 分阶段实施顺序、已知数据约束与验收口径

本文档用于开始执行前的实现对齐，不是最终代码说明。

## 2. 当前现状

当前首页实现位于 [control-plane/web-ui/src/pages/Dashboard.vue](control-plane/web-ui/src/pages/Dashboard.vue)，主要由四块内容组成：

- 活跃任务
- Agent 活动
- 待审批
- 事件流

当前页面的特点：

- 依赖 realtime store 直接拼装实时事件
- 没有持久化聚合层
- 没有 provider 维度统计
- 没有 token 趋势、占比、排行或异常识别

与此同时，Agent 运营中心已经完成了 token 展示与数据回填能力：

- recent 队列显示 token 数
- drawer 运行摘要显示 token 使用量
- 数据来源已落到 `agent_runs.token_used`

相关现状代码：

- [control-plane/web-ui/src/pages/Dashboard.vue](control-plane/web-ui/src/pages/Dashboard.vue)
- [control-plane/web-ui/src/pages/AgentConsolePage.vue](control-plane/web-ui/src/pages/AgentConsolePage.vue)
- [control-plane/web-ui-bff/src/modules/agent-control/routes.ts](control-plane/web-ui-bff/src/modules/agent-control/routes.ts)
- [control-plane/service/src/modules/agent-runs/routes.ts](control-plane/service/src/modules/agent-runs/routes.ts)
- [control-plane/service/src/db/schema.ts](control-plane/service/src/db/schema.ts)

## 3. 改造目标

### 3.1 目标

首页 Dashboard 需要补齐以下能力：

- 一眼看出当前项目最近一段时间的 token 总消耗
- 能按 provider 查看 token 使用量、完成数、失败率与介入率
- 能快速识别哪个 provider 是主要流量来源
- 能识别某个 provider 的异常上升、失败偏高或人工介入偏高
- 能支持管理员按月回看 provider 使用结构，避免只看短期波动做错误调整
- 能辅助判断“高 token 消耗是否换来了更高完成质量”，从而支持模型重分配
- 首页展示保持总览化，不与 Agent 运营中心的 run 级处置视图重复

### 3.2 管理员决策口径

首页 provider token 区不应只是监控板，而应服务于三个管理问题：

1. 哪些模型值得继续承载主流任务

- 如果某个 provider token 占比高、完成率高、介入率低，说明它适合作为主力模型

2. 哪些模型应该降配或限流

- 如果某个 provider token 消耗高，但失败率高、人工介入高、平均 token / 完成 run 偏高，说明它正在低效消耗预算

3. 哪些任务适合迁移到更轻的模型

- 如果轻量 provider 在某类任务上的完成率接近重模型，但 token 显著更低，就应支持管理员做模型重分配

### 3.3 非目标

本次规划不做：

- 不把首页变成完整的成本管理页
- 不在第一阶段强依赖 `cost_records` 的全面准确落库
- 不在第一阶段补齐 provider 级输入/输出 token 细分图
- 不替代现有 Agent 运营中心、任务工作台、成本页的职责

## 4. 数据基础与约束

### 4.1 当前可直接利用的数据

当前仓库内已经具备两类与 token 相关的数据基础：

1. `agent_runs`

- 字段：`model_used`、`token_used`、`status`、`task_id`、`session_id`、`started_at`、`finished_at`
- 优点：已经在 Agent 运行链路里验证可用，且 `token_used` 已能回填历史数据
- 适合：首页第一阶段 provider token 统计

2. `cost_records`

- 字段：`provider_id`、`model_id`、`input_tokens`、`output_tokens`、`cost`
- 优点：模型/Provider 粒度天然更完整，后续适合做成本与 I/O token 拆分
- 风险：当前是否覆盖所有 Agent 执行路径，尚未作为本次首页统计的已验证真值源

### 4.2 当前约束

首页第一阶段不应直接把 `cost_records` 作为唯一真值源，原因如下：

- 当前已验证稳定的是 `agent_runs.token_used`
- `cost_records` 虽有更细粒度字段，但现阶段覆盖度与实时性未完成针对首页的验证
- 如果首页直接混用两套口径，容易出现 provider 汇总与 Agent 页不一致

### 4.3 建议口径

首页 provider token 统计采用分层口径：

- Phase 1：以 `agent_runs` 为准，统计 Agent 执行产生的 provider token 使用情况
- Phase 2：在确认 `cost_records` 链路完整后，升级为 provider 级总 token / input / output / cost 统一视图

## 5. 首页信息架构调整建议

建议在首页 Dashboard 中新增一个独立的“Provider Token 总览区”，位于标题下方、现有三列卡片区域上方。

页面自上而下建议调整为：

1. Dashboard 标题区
2. Provider Token 总览区
3. 现有实时运营区
4. 事件流

### 5.1 Provider Token 总览区

建议拆成两层：

- 第一层：4 个总览卡片
- 第二层：Provider 排行表 + 趋势视图
- 第三层：按月统计区

### 5.2 总览卡片

建议展示以下 4 个指标：

1. 24h Token 总量

- 当前项目最近 24 小时全部 provider 的 token 总数

2. Top Provider

- token 使用量最高的 provider
- 附带占比，例如 `github-copilot 62%`

3. 完成效率

- 最近 24 小时 provider 相关 run 的平均 token / 完成 run

4. 风险 Provider 数

- 失败率过高、介入率过高或 token 突增的 provider 数量

补充建议：

- 卡片默认展示当前选中统计窗口的值
- 当窗口切到月度时，第一张卡片应切换为“本月 Token 总量”
- 第二张卡片应展示“本月 Top Provider”而不是短期瞬时 Top Provider

### 5.3 Provider 排行区

建议首页中间区域增加一个 provider 排行表，默认按最近 24 小时 token 使用量降序展示。

建议列：

1. Provider
2. Tokens
3. 占比
4. 完成数
5. 失败率
6. 介入率
7. 平均 Tokens / Run
8. 趋势
9. 状态

### 5.4 趋势区

第一阶段建议只做轻量趋势，不做复杂分析仪表盘：

- 右侧展示最近 7 天或最近 24 小时分桶 token 折线图
- 支持切换某个 provider 作为高亮对象
- 默认展示全部 provider Top 5

### 5.5 按月统计区

考虑到管理员更关心模型资源如何在更长周期内被分配，首页需要补一个月度视角，避免只看短期波动。

建议新增一个按月统计区，展示最近 6 个月的 provider 使用结构。

建议内容：

1. 月度总 token 趋势

- 最近 6 个月每月 token 总量
- 用于识别整体预算和模型需求是否持续上升

2. 月度 provider 占比堆叠

- 展示每个月各 provider 的 token 占比
- 用于识别主力 provider 是否已经发生迁移

3. 月度效率对比

- 展示每个月各 provider 的 `平均 Tokens / 完成 Run`
- 用于识别某 provider 是否正在变得更昂贵但并未更有效

4. 月度调整建议入口

- 当某 provider 连续两个月低效时，首页直接给出“建议评估降配/迁移”的提示

## 6. 指标定义

### 6.1 统计维度

首页 provider token 统计按以下维度聚合：

- `projectId`
- `providerId`
- 时间窗口：`24h / 7d / 30d / monthly`

其中 `monthly` 不是简单的最近 30 天，而是按自然月聚合最近 6 个月的数据，用于管理员做模型分配决策。

### 6.2 Provider 识别规则

第一阶段从 `agent_runs.model_used` 解析 provider。

解析规则建议：

- `provider:model` 时取 `provider`
- `provider/model` 时优先按已配置 provider 识别
- 空值或无法识别时统一归入 `unknown`

该规则应复用现有模型路由解析逻辑，避免首页与 Agent 页对 provider 的归类不一致。

### 6.3 核心指标

每个 provider 建议返回以下字段：

```ts
interface DashboardProviderTokenItem {
  providerId: string;
  label: string;
  tokenUsed: number;
  tokenShare: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerRun: number;
  avgTokensPerCompletedRun: number;
  latestRunAt: string | null;
  trend: Array<{ bucket: string; tokenUsed: number; completedRuns: number }>;
  monthly: Array<{
    month: string;
    tokenUsed: number;
    completedRuns: number;
    failureRate: number;
    interventionRate: number;
    avgTokensPerCompletedRun: number;
  }>;
  health: "healthy" | "warn" | "risk";
  reasons: string[];
}
```

### 6.4 首页汇总指标

```ts
interface DashboardProviderTokenSummary {
  range: "24h" | "7d" | "30d" | "monthly";
  totalTokens: number;
  totalRuns: number;
  completedRuns: number;
  topProviderId: string | null;
  topProviderShare: number;
  avgTokensPerCompletedRun: number;
  riskProviderCount: number;
  monthlyTotals?: Array<{ month: string; tokenUsed: number; completedRuns: number }>;
}
```

### 6.5 风险判定规则

第一阶段建议使用简单规则，保证可解释：

- `failureRate >= 0.3` 视为失败偏高
- `interventionRate >= 0.5` 视为人工介入偏高
- 当前窗口 token 使用量较上一等长窗口增长 `>= 100%` 且绝对值超过最小阈值时，视为异常增长
- 若某 provider 连续两个月 `avgTokensPerCompletedRun` 高于项目均值且完成率没有同步提升，视为月度低效

最终 `health` 规则：

- 无命中规则：`healthy`
- 命中 1 条：`warn`
- 命中 2 条及以上：`risk`

## 7. 接口设计建议

### 7.1 Service

建议新增项目级 provider token 聚合接口：

- `GET /api/dashboard/provider-tokens?projectId=&range=`

返回结构：

```ts
interface DashboardProviderTokenResponse {
  summary: DashboardProviderTokenSummary;
  providers: DashboardProviderTokenItem[];
}
```

#### Service 计算建议

数据源：

- 第一阶段只读 `agent_runs`
- 关联 `tasks` 获取 `projectId`
- 如需人工介入次数，可复用现有 Agent summary 中已存在的 guidance / intervention 聚合逻辑
- 月度统计按 `finished_at` 或 `started_at` 归入自然月桶，优先使用 `finished_at`

聚合步骤：

1. 过滤当前项目、时间窗口内的 agent runs
2. 解析 `model_used` 得到 `providerId`
3. 聚合 token、完成数、失败数、停止数、介入数
4. 构造趋势分桶
5. 如果窗口为 `monthly`，额外构造最近 6 个月自然月分桶
6. 计算 `share / rate / avg / health`

#### 时间窗口建议

- `24h` 使用按小时分桶
- `7d` 使用按天分桶
- `30d` 使用按天分桶
- `monthly` 使用按自然月分桶，默认返回最近 6 个月

#### 月度统计建议

月度统计不仅看总量，还要支持管理员判断“值不值得继续给这个 provider 分配更多任务”，因此建议月度结果至少包含：

- 月 token 总量
- 月完成数
- 月失败率
- 月介入率
- 月平均 `Tokens / 完成 Run`

### 7.2 BFF

建议新增透传与轻量格式整理接口：

- `GET /api/dashboard/provider-tokens?projectId=&range=`

职责：

- 透传 projectId / range
- 做鉴权与错误包装
- 补齐 provider label 显示名
- 保持首页前端只依赖 BFF，不直接打 service

### 7.3 Web API 类型

建议在 [control-plane/web-ui/src/lib/api.ts](control-plane/web-ui/src/lib/api.ts) 中新增：

- `DashboardProviderTokenSummary`
- `DashboardProviderTokenItem`
- `DashboardProviderTokenResponse`
- `getDashboardProviderTokens(projectId, range)`

## 8. 前端页面改造建议

### 8.1 Dashboard.vue 改造原则

对 [control-plane/web-ui/src/pages/Dashboard.vue](control-plane/web-ui/src/pages/Dashboard.vue) 的改造建议遵守以下原则：

- 不破坏现有活跃任务 / Agent 活动 / 待审批 / 事件流
- provider token 总览作为首页新的第一屏信息
- 首页只做总览，不承接 run 级处置动作
- 具体单 run 诊断继续跳转 Agent 运营中心或任务工作台

### 8.2 建议新增状态

```ts
const providerRange = ref<"24h" | "7d" | "30d" | "monthly">("24h");
const providerTokenLoading = ref(false);
const providerTokenSummary = ref<DashboardProviderTokenSummary | null>(null);
const providerTokenItems = ref<DashboardProviderTokenItem[]>([]);
const selectedProviderId = ref<string | null>(null);
```

### 8.3 建议新增区块

1. Provider Token 卡片区

- 使用 `a-row + a-card`
- 样式与 Agent 运营中心 summary card 保持同一产品语言

2. Provider 排行表

- 使用 `a-table`
- 默认只展示 Top 5，可加“查看全部”

3. Provider 趋势图

- 第一阶段可先用简化折线图组件
- 若暂不引图表依赖，也可以先用表格/小型 sparkline 占位

4. 月度统计面板

- 展示最近 6 个月总量走势
- 展示 provider 月度占比或效率对比
- 为管理员提供更稳定的模型调整依据

### 8.4 首页交互建议

- 点击 provider 行：切换右侧趋势高亮
- 点击风险状态：跳转到 [control-plane/web-ui/src/pages/AgentConsolePage.vue](control-plane/web-ui/src/pages/AgentConsolePage.vue) 并带上 provider/status 查询参数
- 切换时间范围：重新拉取聚合数据
- 切换到 `monthly` 时，表格仍展示 provider 排行，但趋势区切换为月度视图
- 月度视图中应支持查看某 provider 最近 6 个月是否持续高消耗低产出

## 9. 分阶段实施顺序

### Phase 1：首页 Provider Token 总览落地

目标：先把稳定、可解释、与 Agent 页一致的 provider token 汇总放上首页。

范围：

- Service 新增 provider token 聚合接口
- BFF 新增透传接口
- Dashboard 首页增加卡片区 + 排行区
- Dashboard 首页增加月度统计切换与最近 6 个月月度分桶展示
- 使用 `agent_runs.token_used` + `model_used`

不包含：

- input/output token 拆分
- 成本金额展示
- 非 Agent 类会话统一统计

### Phase 2：趋势与风险增强

范围：

- 增加趋势折线
- 增加异常增长识别
- 增加 provider 风险标签与跳转
- 增加按月占比与月度低效识别

### Phase 3：统一成本口径

前提：确认 `cost_records` 已覆盖首页希望展示的路径。

范围：

- 接入 input/output token
- 接入 cost
- 与成本页共享 provider 级聚合逻辑

## 10. 验收口径

### 10.1 数据正确性

- 首页 provider token 总量应与同时间窗口内 agent runs 聚合结果一致
- provider 排行总和应等于 summary totalTokens
- provider 占比求和应接近 100%
- 单 provider token 值应能通过抽样 run 在 Agent 页追溯验证

### 10.2 交互正确性

- 切换项目后自动刷新 provider token 统计
- 切换时间窗口后卡片、排行、趋势同时更新
- 无数据项目展示空态而不是报错
- provider 未识别时统一落入 `unknown`
- 切换到月度视图时，最近 6 个月数据应按自然月稳定展示，不受 30 天滚动窗口干扰

### 10.3 性能要求

- Dashboard 首屏额外聚合请求控制在 1 次
- 默认窗口 `24h` 聚合响应应可在当前 PostgreSQL 数据规模下稳定返回
- 趋势分桶不要把首页变成重计算页，必要时限制 provider 数量与窗口粒度
- 月度统计默认只回传最近 6 个月，避免首页一次性拉取过长历史

## 11. 实施建议

建议按以下顺序开始执行：

1. 先在 Service 实现 `provider-tokens` 聚合接口与单元测试
2. 再在 BFF 增加透传接口与类型定义
3. 最后改造 Dashboard 首页 UI

原因：

- 首页展示是否可信，关键不在组件而在聚合口径
- 先把 Service 聚合固定下来，能避免前端先行造成字段返工
- 当前 Agent 页 token 数据链路已经验证，Service 可以直接复用这条口径

## 12. 结论

首页 provider token 统计适合现在开始做，但第一阶段应坚持“与 Agent 页一致、口径单一、总览优先”的原则。

同时，这个页面的价值不只是告诉管理员“用了多少 token”，而是帮助管理员回答三个更重要的问题：

- 哪些模型最值得继续投入
- 哪些模型正在低效消耗 token
- 哪些任务可以迁移到更轻但同样足够准确的模型

因此建议：

- 首页第一阶段只统计 Agent 执行产生的 provider token
- 以 `agent_runs.token_used + model_used` 作为真值源
- 同时补上最近 6 个月的自然月统计，给管理员更稳的调整依据
- 先做总量、排行、风险识别和月度视图，再做成本与 input/output 拆分

这样可以最快把首页从实时入口页升级为“可运营、可判断、可追踪”的项目级 AI 使用概览页，同时避免在成本链路尚未完全核实前引入新的口径冲突。