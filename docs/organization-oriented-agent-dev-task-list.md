# 组织架构化 Agent 方案开发任务列表

> 适用范围：OpenerX 组织架构化 Agent 方案的具体研发排期与任务拆解
>
> 目标：将技术清单进一步拆为可执行的开发任务，按 BFF、控制平面、前端、数据结构、测试五类展开

## 1. 文档目标

本文档回答以下问题：

- 组织架构化方案的开发任务具体要做哪些项
- 每一项更适合落在 BFF、控制平面、前端、数据结构还是测试侧
- 哪些是 MVP 必做项，哪些可以在第二阶段补上
- 如何按照最小可落地闭环安排研发顺序

相关文档：

- [docs/organization-oriented-agent-operating-model.md](docs/organization-oriented-agent-operating-model.md)
- [docs/boss-agent-design.md](docs/boss-agent-design.md)
- [docs/organization-oriented-agent-technical-checklist.md](docs/organization-oriented-agent-technical-checklist.md)
- [docs/development-role-agents-plan.md](docs/development-role-agents-plan.md)
- [docs/organization-oriented-agent-frontend-information-architecture.md](docs/organization-oriented-agent-frontend-information-architecture.md)
- [docs/organization-oriented-agent-frontend-phase1-page-draft.md](docs/organization-oriented-agent-frontend-phase1-page-draft.md)

## 2. 实施分层

本任务列表按五类展开：

1. BFF
2. 控制平面
3. 前端
4. 数据结构
5. 测试

每一类任务再按优先级分为：

- P0：MVP 必做
- P1：增强闭环
- P2：高级能力或后续优化

前端实施原则：

- 尽量不直接改造现有主页面
- 优先通过新增页面、新路由、新面板承载组织架构化能力
- 现有页面仅做最小入口挂接，例如增加跳转入口、入口卡片或详情链接

当前状态同步（2026-03-15）：

- 第 1 期前端范围已完成：`OrganizationOperatingSettings`、`ProjectOperatingMode`、`TaskOperatingConsole` 已落地
- 第 1 期前端最小入口已完成：设置页、项目详情页、项目编排页、任务详情页均已接入跳转入口
- 第 1 期前端测试已完成并通过当前全量 `web-ui` 测试集
- 当前剩余重点切换为后端闭环与后续阶段能力：优先补任务老板决策 / 升级请求正式接口，再推进 P1 / P2

## 3. BFF 任务列表

### 3.1 P0：运行档位解析

目标：在任务开始前确定当前任务采用哪种协作模式、自动托管等级和老板参与方式。

任务：

1. 新增 `operating-mode/profile-resolver.ts`
职责：合并平台默认、项目设置、任务覆盖，生成 `OperatingModeSelection`。

2. 新增 `operating-mode/recommendation-engine.ts`
职责：根据任务场景、分类结果和推荐策略对象，输出推荐组合。

3. 在 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts) 接入运行档位解析
职责：任务创建或执行前先确定 `collaborationMode`、`autopilotLevel`、`bossParticipationMode`。

4. 将运行档位写入任务 `strategy`
职责：确保后续页面和收口逻辑可读取当前模式。

### 3.2 P0：老板 Agent 决策引擎 MVP

目标：老板 Agent 可以给出最基础的项目级判断，而不是只停留在文档里。

任务：

1. 新增 `boss-agent/context-builder.ts`
职责：聚合任务、模板、阶段、角色结论和推荐策略，构造老板决策输入。

2. 新增 `boss-agent/decision-engine.ts`
职责：输出基础老板决策，如 `select-template`、`form-team`、`advance-stage`、`escalate-human`。

3. 新增 `boss-agent/escalation-policy.ts`
职责：判断哪些条件必须升级给人类。

4. 在任务启动链路中按模式接入老板 Agent

规则：

- `solo` + `disabled`：跳过老板
- `solo` + `advisory`：仅输出建议
- `hybrid` / `team`：按 `bossParticipationMode` 决定是否接管

### 3.3 P0：任务详情运行态输出

目标：前端能看到当前模式、老板参与方式和最近决策。

任务：

1. 扩展 `GET /api/tasks/:taskId` 返回运行档位字段
2. 增加 `GET /api/tasks/:taskId/boss-decisions`
3. 增加 `GET /api/tasks/:taskId/escalations`

### 3.4 P1：阶段推进器骨架

目标：把阶段推进从零散逻辑中抽出来。

任务：

1. 新增 `workflow-runtime/stage-runner.ts`
2. 新增 `workflow-runtime/stage-status-store.ts`
3. 新增 `workflow-runtime/stage-gate-evaluator.ts`
4. 让老板 Agent 决策与阶段推进器联动

### 3.5 P1：混合模式自动切换

目标：平时单兵，命中条件时自动切换为团队协作。

任务：

1. 在 `profile-resolver` 中接入 `HybridEscalationRule`
2. 在任务执行中途支持从 `solo` 切到 `team`
3. 将模式切换记录写入 `bossDecisions` 或专门的运行事件

### 3.6 P1：角色聚合器正式接入

目标：让安全、QA、运维、架构等角色成为可执行的一等能力。

任务：

1. 接入 `role-aggregation/executor.ts`
2. 接入 `normalizer.ts`
3. 接入 `conflict-resolver.ts`
4. 接入 `task-strategy-store.ts`

### 3.7 P2：老板自动调模板

目标：老板 Agent 可在授权范围内根据任务阶段自动切换模板。

任务：

1. 支持 `allowBossAutoTemplateSwitch`
2. 增加模板切换审计记录
3. 增加模板切换前后 diff 说明

## 4. 控制平面任务列表

### 4.1 P0：项目设置扩展

目标：项目可保存自身默认运行档位。

任务：

1. 为项目设置增加：

- `collaborationMode`
- `autopilotLevel`
- `bossParticipationMode`
- `preferredTemplateId`
- `allowBossAutoTemplateSwitch`
- `allowHybridEscalation`

1. 提供项目级 GET/PUT 接口

### 4.2 P0：平台组织设置接口

目标：平台级制度可被设置和读取。

任务：

1. 增加平台组织设置配置结构
2. 提供 `GET /api/config/organization-settings`
3. 提供 `PUT /api/config/organization-settings`

### 4.3 P1：推荐策略配置接口

目标：文档里的推荐场景配置可在系统中被维护。

任务：

1. 提供 `GET /api/config/recommended-operating-profiles`
2. 提供 `PUT /api/config/recommended-operating-profiles`
3. 提供推荐策略校验逻辑

### 4.4 P1：审批与升级记录接口

目标：人类升级请求和老板决策能被单独查询。

任务：

1. 新增老板决策记录接口
2. 新增升级请求接口
3. 让审批与升级记录可被审计系统消费

### 4.5 P2：模板级组织策略

状态：已启动并完成首批落地

目标：模板可定义默认运行档位和老板策略。

任务：

1. 在模板定义中支持 `defaultCollaborationMode`
2. 支持 `defaultAutopilotLevel`
3. 支持 `defaultBossParticipationMode`
4. 支持模板是否强制老板参与

当前实现：

- `workflow_templates` 已增加模板级组织策略字段并兼容旧库补列
- Workflow Template CRUD / 编辑页已可维护默认协作模式、默认托管等级、默认老板参与方式、强制老板参与
- 项目模板页已可展示当前模板策略，并保存 `preferredTemplateId` 与 `allowBossAutoTemplateSwitch`
- `select-template` 老板决策在项目授权开启时会自动写入任务运行档位

## 5. 前端任务列表

### 5.1 P0：设置页增加组织运行策略

状态：已完成

目标：管理员能看见并配置协作模式、自动托管等级和老板参与方式。

任务：

1. 新增独立页面 `OrganizationOperatingSettings.vue`
2. 在现有设置页仅增加入口卡片或跳转入口
3. 在新页面中提供协作模式、自动托管等级、老板参与方式配置
4. 在新页面中展示推荐使用场景表

### 5.2 P0：项目编排页展示当前档位

状态：已完成

目标：用户在项目编排页中看见当前项目是单兵、团队还是混合，以及托管等级。

任务：

1. 新增独立页面 `ProjectOperatingMode.vue`
2. 在现有项目编排页仅增加“组织运行视图”入口
3. 在新页面展示当前协作模式、自动托管等级、老板参与方式和模板来源

### 5.3 P0：任务详情页展示老板判断

状态：已完成

目标：任务页能直接看到老板的存在和判断。

任务：

1. 新增独立页面 `TaskOperatingConsole.vue`
2. 在现有任务详情页仅增加“组织运行详情”入口
3. 在新页面展示当前运行档位、老板最近决策和升级状态

### 5.4 P1：模式切换交互

目标：支持项目管理员或授权用户切换运行模式。

任务：

1. 在 `ProjectOperatingMode.vue` 中提供项目级默认档位编辑表单
2. 新增 `TaskOperatingOverride.vue` 或抽屉式独立面板承载任务级覆盖表单
3. 增加模式切换确认提示

### 5.5 P1：场景推荐入口

目标：创建任务时可直接按场景套用推荐组合。

任务：

1. 新增 `TaskOperatingModeLauncher.vue` 作为任务创建前置页或独立步骤页
2. 在该新页面增加“推荐场景”选择器
3. 选中场景后自动填充协作模式 / 托管等级 / 老板参与方式
4. 展示推荐原因说明

### 5.6 P2：老板经营视图

状态：已完成当前 MVP

目标：把老板 Agent 从一个字段升级为一个真实的管理视图。

任务：

1. 新增独立页面 `BossOperationsCenter.vue`
2. 在该页面展示老板决策时间线
3. 展示阶段推进历史
4. 展示升级请求与人工覆盖历史

当前实现：

- 已新增独立页面 `BossOperationsCenter.vue`
- 已新增项目级聚合接口 `GET /projects/:projectId/boss-operations-view`
- 当前页面已展示项目级老板决策时间线、人工覆盖历史、开放升级请求和需人工关注任务列表
- 后续可继续补更细粒度的跨任务阶段历史钻取

## 6. 数据结构任务列表

### 6.1 P0：任务 strategy 扩展

目标：不引入新表也能支持 MVP 闭环。

任务：

1. 在 `PersistedTaskStrategy` 中增加：

- `collaborationMode`
- `autopilotLevel`
- `bossParticipationMode`
- `operatingModeSource`
- `bossDecisions`
- `escalationRequests`
- `currentStageKey`
- `currentStageStatus`

1. 增加 JSON 兼容和迁移逻辑

### 6.2 P0：编排策略扩展

目标：把平台组织设置并入现有编排策略结构。

任务：

1. 给 `OrchestrationStrategy` 增加 `organizationSettings`
2. 给 `OrchestrationStrategy` 增加 `categoryTemplateMap`
3. 增加读写归一化逻辑

### 6.3 P1：项目设置结构扩展

目标：项目能保存自己的默认运行档位。

任务：

1. 扩展项目 settings schema
2. 扩展控制平面 DB 映射或 JSON 字段
3. 增加后向兼容逻辑

### 6.4 P1：推荐策略对象持久化

目标：推荐组合不再只存在于静态代码中。

任务：

1. 为推荐策略提供配置存储
2. 支持系统级更新和版本化

### 6.5 P2：独立运行态表

目标：在规模增长后将老板决策和升级请求从 `task.strategy` 拆出去。

任务：

1. `boss_decisions`
2. `human_escalations`
3. `task_operating_modes`

## 7. 测试任务列表

### 7.1 P0：类型与序列化测试

目标：保证新增对象能稳定读写。

任务：

1. `OperatingModeSelection` 解析测试
2. `PlatformOrganizationSettings` 读写测试
3. `PersistedTaskStrategy` 序列化测试

### 7.2 P0：BFF 单元测试

目标：保证模式解析和老板参与逻辑正确。

任务：

1. 单兵模式 + disabled
2. 单兵模式 + advisory
3. 组织化协作模式 + full-manager
4. 混合模式命中条件升级

### 7.3 P0：接口测试

目标：保证新增配置接口和任务接口可用。

任务：

1. organization settings GET/PUT
2. project organization settings GET/PUT
3. task boss decisions GET
4. task escalations GET

### 7.4 P1：集成测试

目标：验证从配置到任务运行再到页面展示的闭环。

任务：

1. 小任务默认走单兵模式 + L1
2. 跨系统任务默认走团队模式 + L1
3. 生产发布命中混合模式升级
4. 安全修复默认需要更严格老板参与

### 7.5 P1：回归测试

目标：确保现有单 Agent 执行链路不被破坏。

任务：

1. 未启用组织运行策略时，旧链路行为保持不变
2. 现有 Hook 与并行候选逻辑继续可用
3. 旧任务数据仍能读取

### 7.6 P2：端到端测试

目标：验证前端设置、任务运行、老板决策、升级展示的完整体验。

任务：

1. 设置页保存组织运行策略
2. 项目页看到当前运行档位
3. 任务页看到老板决策和升级状态

## 8. 迭代计划版

### 8.1 第 1 期：MVP 跑通

目标：先把“运行档位 + 老板判断 + 页面可见”这条最小闭环打通。

范围：

- 数据结构 P0
- BFF P0
- 控制平面 P0
- 前端 P0
- 测试 P0

本期交付：

1. 平台可配置默认 `collaborationMode`、`autopilotLevel`、`bossParticipationMode`
2. 项目可配置自己的默认运行档位
3. 任务启动时可解析运行档位并写入 `task.strategy`
4. 老板 Agent 至少能输出模板选择、阶段推进和升级建议
5. 设置页、项目编排页、任务详情页可以展示当前模式和老板参与方式
6. 有一组稳定的单元测试和接口测试覆盖上述链路

当前完成度同步（2026-03-15）：

- 前端 P0 已完成并通过测试
- 数据结构 P0 已完成当前阶段所需的 `ProjectSettings`、`OrchestrationStrategy`、`PersistedTaskStrategy` 扩展
- 控制平面 P0 已完成项目设置扩展，平台组织设置当前先复用 `orchestration-strategy.organizationSettings`
- BFF P0 已完成配置读写和任务运行态基础结构扩展，但老板决策 / 升级请求正式任务接口仍在补齐中
- 测试 P0 已完成前端页面、路由与相关回归测试；BFF 任务运行态接口测试继续补充

依赖关系：

1. 先做 [control-plane/service/src/db/schema.ts](control-plane/service/src/db/schema.ts) 的 `ProjectSettings` 扩展
2. 再做 [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](control-plane/web-ui-bff/src/lib/orchestration-strategy.ts) 的运行态对象扩展
3. 然后接入 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts) 的执行链路
4. 最后补 [control-plane/web-ui/src/lib/api.ts](control-plane/web-ui/src/lib/api.ts) 与三个页面的展示层

出口标准：

- 一个新任务创建后，详情页可见运行档位与老板决策
- 项目编排页可见项目当前组织运行配置
- 未启用组织方案时，旧执行链路行为不变

当前剩余工作：

- BFF：补 `GET /api/tasks/:taskId/boss-decisions` 与 `GET /api/tasks/:taskId/escalations`
- 前端：任务运行详情页切到正式接口，不再直接解析 `task.strategy`
- 测试：补接口与页面改造后的回归用例

### 8.2 第 2 期：增强闭环

目标：把模式推荐、混合切换、阶段推进器和角色聚合接入现有主链。

范围：

- BFF P1
- 控制平面 P1
- 前端 P1
- 数据结构 P1
- 测试 P1

本期交付：

1. 推荐场景配置可以在系统中维护
2. 混合模式支持按规则从 `solo` 升级到 `team`
3. 阶段推进器和老板决策联动
4. 角色聚合结果可写回任务运行态
5. 创建任务时支持按场景一键套用推荐组合
6. 集成测试覆盖从配置到展示的完整链路

依赖关系：

1. 第 1 期的运行档位对象必须稳定
2. 需要在 [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) 中补运行事件写回点
3. 需要在 [control-plane/web-ui-bff/src/modules/tasks/workflow-sync.ts](control-plane/web-ui-bff/src/modules/tasks/workflow-sync.ts) 和 [control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts](control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts) 中挂上阶段状态

出口标准：

- 推荐场景可以驱动任务默认档位
- 混合模式能在命中规则后记录切换事件
- 项目和任务页面可解释切换原因和阶段变化

### 8.3 第 3 期：高级治理与规模化

目标：把模板级组织策略、老板经营视图和独立运行态存储补齐，形成可长期演进的治理体系。

范围：

- BFF P2
- 控制平面 P2
- 前端 P2
- 数据结构 P2
- 测试 P2

本期交付：

1. 模板可定义默认协作模式和老板参与方式
2. 老板 Agent 可在授权内自动切模板
3. 老板经营视图可展示时间线、阶段历史和人工覆盖记录
4. 老板决策、升级请求、任务运行档位可拆到独立运行态表
5. 端到端测试覆盖设置、任务运行和经营视图

当前完成度同步（2026-03-16）：

- 独立运行态表已落地，并接入真实老板决策 / 升级请求写入点
- 项目级老板经营视图已补上人工覆盖历史，治理链路覆盖决策、升级、人工覆盖三类事件
- 模板级组织策略首批能力已落地，项目可配置自动切模板授权，老板 `select-template` 决策可驱动任务模板切换
- 工作流启动前已补自动模板决策生成：优先使用场景推荐模板，其次回落项目偏好模板，并通过 `select-template` 决策写回运行态
- 阶段阻断 / 升级时已补二次治理模板切换：若推荐模板或项目偏好模板与当前模板不同，会再次写入 `select-template` 决策并把触发原因写入 metadata
- 老板经营视图已开始细化展示 `select-template` 来源，可区分场景推荐命中、项目偏好命中，以及启动前/阻断后/升级后二次治理触发
- 阶段模板已支持定义阻断后 / 待审批后二次治理模板策略，运行时优先级提升为：阶段策略 > 场景推荐 > 项目偏好
- 任务运行详情页已补齐 `select-template` 来源、触发器、目标模板与治理原因展示，和老板经营视图保持一致

依赖关系：

1. 第 2 期的阶段推进器和事件写回已经稳定
2. 需要完成控制平面 migration 和运行态表设计
3. 需要前端补充项目级时间线和治理视图

出口标准：

- 模板级策略可直接影响新任务默认运行档位
- 老板决策与人工覆盖历史可审计、可追溯
- 数据存储不再完全依赖 `task.strategy` 的 JSON 承载

## 9. 文件级实现清单

本节用于把任务拆到具体文件、模块和接口层，作为研发排期与任务指派的直接依据。

### 9.1 BFF 文件级清单

1. [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](control-plane/web-ui-bff/src/lib/orchestration-strategy.ts)
预计改动：

- 扩展 `OrchestrationStrategy`
- 扩展 `PersistedTaskStrategy`
- 新增 `CollaborationMode`、`AutopilotLevel`、`BossParticipationMode`
- 新增 `PlatformOrganizationSettings`、`RecommendedOperatingProfile`、`OperatingModeSelection`
- 新增 `BossDecisionRecord`、`HumanEscalationRequest`
- 补 `normalizeOrchestrationStrategy`、`parseTaskStrategy`、`mergeTaskStrategy` 的兼容逻辑

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts)
预计改动：

- 在任务启动前接入 `profile-resolver`
- 在执行链路中接入老板 Agent 决策
- 在更新任务状态时写入运行档位、老板决策、升级请求
- 扩展任务详情返回，暴露给前端展示层

预计新增文件：

- `src/modules/operating-mode/profile-resolver.ts`
- `src/modules/operating-mode/recommendation-engine.ts`
- `src/modules/boss-agent/context-builder.ts`
- `src/modules/boss-agent/decision-engine.ts`
- `src/modules/boss-agent/escalation-policy.ts`

1. [control-plane/web-ui-bff/src/modules/config/routes.ts](control-plane/web-ui-bff/src/modules/config/routes.ts)
预计改动：

- 扩展 `/config/orchestration-strategy` 的 schema
- 接入 `organizationSettings` 和 `recommendedProfiles`
- 在系统设置保存时校验 `L2`、升级规则和推荐场景配置

涉及接口：

- `GET /config/orchestration-strategy`
- `PUT /config/orchestration-strategy`
- 第 1 期如需独立接口，可加 `GET /config/organization-settings` 与 `PUT /config/organization-settings`

1. [control-plane/web-ui-bff/src/modules/projects/routes.ts](control-plane/web-ui-bff/src/modules/projects/routes.ts)
预计改动：

- 扩展项目编排视图，增加项目默认运行档位、老板参与方式、推荐配置来源
- 在 `ProjectOrchestrationView` 组装时加入老板相关摘要
- 为第 2 期和第 3 期预留阶段推进历史、经营时间线数据拼装能力

涉及接口：

- `GET /projects/:projectId/orchestration-view`

1. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)
预计改动：

- 记录阶段推进结果
- 记录混合模式升级事件
- 记录老板决策后对候选结果的收口动作

1. [control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts](control-plane/web-ui-bff/src/modules/tasks/workflow-view.ts)
预计改动：

- 扩展任务工作流视图模型
- 增加老板决策摘要、当前阶段状态、升级请求数量

1. [control-plane/web-ui-bff/src/modules/tasks/workflow-sync.ts](control-plane/web-ui-bff/src/modules/tasks/workflow-sync.ts)
预计改动：

- 挂阶段推进器
- 同步 `currentStageKey` 与 `currentStageStatus`

预计新增文件：

- `src/modules/workflow-runtime/stage-runner.ts`
- `src/modules/workflow-runtime/stage-status-store.ts`
- `src/modules/workflow-runtime/stage-gate-evaluator.ts`

1. [control-plane/web-ui-bff/src/modules/workflow-templates/routes.ts](control-plane/web-ui-bff/src/modules/workflow-templates/routes.ts)
预计改动：

- 第 3 期为模板增加默认运行档位字段
- 支持模板级 `defaultCollaborationMode`
- 支持模板级 `defaultAutopilotLevel`
- 支持模板级 `defaultBossParticipationMode`

1. [control-plane/web-ui-bff/src/modules/chat-settings/routes.ts](control-plane/web-ui-bff/src/modules/chat-settings/routes.ts)
和 [control-plane/web-ui-bff/src/modules/chat-settings/config-patch-applier.ts](control-plane/web-ui-bff/src/modules/chat-settings/config-patch-applier.ts)
预计改动：

- 让聊天式配置助手认识新增组织运行字段
- 支持对组织运行策略进行 preview、apply、validate

### 9.2 控制平面文件级清单

1. [control-plane/service/src/db/schema.ts](control-plane/service/src/db/schema.ts)
预计改动：

- 扩展 `ProjectSettings`
- 第 1 期加入项目级组织运行字段
- 第 3 期增加独立运行态表定义或挂接点

涉及对象：

- `ProjectSettings`
- `tasks`
- `projects`

1. [control-plane/service/src/modules/projects/routes.ts](control-plane/service/src/modules/projects/routes.ts)
预计改动：

- 扩展 `projectSettingsSchema`
- 扩展项目创建和更新接口
- 让项目设置可保存 `collaborationMode`、`autopilotLevel`、`bossParticipationMode` 等字段

涉及接口：

- `POST /api/projects`
- `PATCH /api/projects/:projectId`
- `GET /api/projects/:projectId`

1. [control-plane/service/src/modules/tasks/routes.ts](control-plane/service/src/modules/tasks/routes.ts)
预计改动：

- 第 1 期允许任务携带运行档位覆盖参数
- 扩展任务详情返回，暴露 `strategy` 和必要运行态摘要
- 第 2 期增加任务创建时的推荐场景参数

涉及接口：

- `POST /api/tasks`
- `GET /api/tasks/:taskId`
- `PATCH /api/tasks/:taskId`

1. [control-plane/service/src/modules/workflow-templates/routes.ts](control-plane/service/src/modules/workflow-templates/routes.ts)
预计改动：

- 第 3 期扩展模板 schema
- 增加模板级默认运行档位字段
- 支持模板是否强制老板参与

1. [control-plane/service/src/modules/task-workflows/routes.ts](control-plane/service/src/modules/task-workflows/routes.ts)
预计改动：

- 第 2 期接入阶段运行态读取接口
- 第 3 期支持老板阶段干预历史查询

1. [control-plane/service/src/modules/approvals/routes.ts](control-plane/service/src/modules/approvals/routes.ts)
和 [control-plane/service/src/modules/audit/routes.ts](control-plane/service/src/modules/audit/routes.ts)
预计改动：

- 让老板升级请求进入审批或审计通道
- 记录人工覆盖、老板接管和模板切换等行为

1. [control-plane/service/src/db/migrate.ts](control-plane/service/src/db/migrate.ts)
和 [control-plane/service/src/db/runtime-schema.ts](control-plane/service/src/db/runtime-schema.ts)
预计改动：

- 第 3 期为 `boss_decisions`、`human_escalations`、`task_operating_modes` 做 migration 准备

### 9.3 前端文件级清单

1. [control-plane/web-ui/src/lib/api.ts](control-plane/web-ui/src/lib/api.ts)
预计改动：

- 扩展 `OrchestrationStrategy`
- 新增 `PlatformOrganizationSettings`、`ProjectOrganizationSettings`、`OperatingModeSelection`
- 扩展 `ProjectOrchestrationView`
- 扩展任务详情视图模型
- 新增组织运行策略与老板决策相关请求方法

1. [control-plane/web-ui/src/router/index.ts](control-plane/web-ui/src/router/index.ts)
预计改动：

- 新增组织运行相关页面路由
- 为平台设置、项目运行视图、任务运行控制台、老板经营视图挂路由入口

1. [control-plane/web-ui/src/pages/Settings.vue](control-plane/web-ui/src/pages/Settings.vue)
预计改动：

- 仅增加组织运行设置页入口
- 不在现有设置页内直接堆叠完整表单

1. [control-plane/web-ui/src/pages/ProjectOrchestration.vue](control-plane/web-ui/src/pages/ProjectOrchestration.vue)
预计改动：

- 仅增加“组织运行视图”入口
- 保持当前项目编排页主体结构不变

1. [control-plane/web-ui/src/pages/TaskDetail.vue](control-plane/web-ui/src/pages/TaskDetail.vue)
预计改动：

- 仅增加“组织运行详情”入口
- 保持现有任务详情页主体结构不变

1. [control-plane/web-ui/src/pages/ProjectDetail.vue](control-plane/web-ui/src/pages/ProjectDetail.vue)
预计改动：

- 增加项目级组织运行页面入口
- 不直接在现有 ProjectDetail 主体内扩展复杂配置表单

1. [control-plane/web-ui/src/pages/WorkflowTemplatesAdmin.vue](control-plane/web-ui/src/pages/WorkflowTemplatesAdmin.vue)
和 [control-plane/web-ui/src/pages/WorkflowTemplateEditor.vue](control-plane/web-ui/src/pages/WorkflowTemplateEditor.vue)
预计改动：

- 第 3 期仅增加进入模板组织策略页的入口或轻量配置区
- 避免一次性重构现有模板编辑主界面

1. [control-plane/web-ui/src/stores/project.ts](control-plane/web-ui/src/stores/project.ts)
与 [control-plane/web-ui/src/stores/task-monitor.ts](control-plane/web-ui/src/stores/task-monitor.ts)
预计改动：

- 缓存项目级组织设置
- 缓存任务运行档位与老板决策摘要

1. 预计新增前端页面
预计新增文件：

- `control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue`
- `control-plane/web-ui/src/pages/ProjectOperatingMode.vue`
- `control-plane/web-ui/src/pages/TaskOperatingConsole.vue`
- `control-plane/web-ui/src/pages/TaskOperatingOverride.vue`
- `control-plane/web-ui/src/pages/TaskOperatingModeLauncher.vue`
- `control-plane/web-ui/src/pages/BossOperationsCenter.vue`

### 9.4 数据结构文件级清单

1. [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](control-plane/web-ui-bff/src/lib/orchestration-strategy.ts)
数据侧职责：

- 承担 BFF 运行态 JSON 结构定义
- 保证老数据兼容读取

1. [control-plane/service/src/db/schema.ts](control-plane/service/src/db/schema.ts)
数据侧职责：

- 承担项目配置持久化结构
- 承担任务主表与后续独立运行态表设计

1. [control-plane/service/src/db/runtime-schema.ts](control-plane/service/src/db/runtime-schema.ts)
数据侧职责：

- 第 3 期承接运行态实体拆分
- 让老板决策、升级请求和运行档位不再只依赖 JSON 字段

1. [control-plane/service/src/db/migrate.ts](control-plane/service/src/db/migrate.ts)
数据侧职责：

- 为新增字段和新表生成迁移步骤
- 处理历史任务与项目数据兼容

### 9.5 测试文件级清单

1. [tests/README.md](tests/README.md)
预计改动：

- 补组织架构化方案的测试说明
- 补第 1 期到第 3 期的验收范围

1. [control-plane/web-ui/src/lib/api.ts](control-plane/web-ui/src/lib/api.ts)
相关测试方向：

- 类型收敛测试
- 接口返回结构兼容测试

1. [control-plane/web-ui/src/pages/ProjectOrchestration.vue](control-plane/web-ui/src/pages/ProjectOrchestration.vue)
和 [control-plane/web-ui/src/pages/TaskDetail.vue](control-plane/web-ui/src/pages/TaskDetail.vue)
相关测试方向：

- 视图展示测试
- 空状态与回退状态测试

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts)
和 [control-plane/web-ui-bff/src/lib/orchestration-strategy.ts](control-plane/web-ui-bff/src/lib/orchestration-strategy.ts)
相关测试方向：

- 运行档位解析测试
- 老板参与逻辑测试
- 任务策略序列化测试

1. [control-plane/service/src/modules/projects/routes.ts](control-plane/service/src/modules/projects/routes.ts)
和 [control-plane/service/src/modules/tasks/routes.ts](control-plane/service/src/modules/tasks/routes.ts)
相关测试方向：

- 项目设置 schema 测试
- 任务创建与更新接口测试

1. [tests/e2e](tests/e2e)
相关测试方向：

- 第 3 期增加设置页、项目编排页、任务详情页的端到端场景

## 10. 推荐实施顺序

建议以“先打通 JSON 与接口，再补页面，再接阶段运行态，最后拆独立表”的顺序推进：

1. 第 1 期先改项目 settings、任务 strategy、BFF 任务链路和页面展示
2. 第 2 期再接推荐策略、混合模式、阶段推进器和角色聚合
3. 第 3 期最后推进模板级组织策略、老板经营视图和独立运行态表

这样做的好处是：

- 第一轮就能看到真实可用的产品闭环
- 第二轮把组织协作能力接进现有执行体系
- 第三轮再做架构性拆分，避免一开始改动过深

## 11. 交付闭环定义

第 1 期完成的标志应是：

1. 管理员可以配置默认协作模式和自动托管等级
2. 项目可以覆盖默认档位
3. 任务运行时能看到当前档位和老板参与方式
4. 老板 Agent 至少能输出模板选择、阶段推进和升级建议
5. 单兵模式、团队模式和混合模式至少有一条可运行的闭环链路

第 2 期完成的标志应是：

1. 推荐场景可以直接驱动任务默认模式
2. 混合模式切换可被解释和追踪
3. 角色聚合与阶段推进已进入运行主链

第 3 期完成的标志应是：

1. 模板级策略、老板经营视图、独立运行态表全部可用
2. 老板决策与人工介入具备完整审计能力
3. 系统已具备长期演进为组织经营中台的基础结构

## 12. 总结

技术清单解决的是“概念如何编码”，开发任务列表解决的是“团队下一步具体做什么”，而本次补充的迭代计划版和文件级实现清单，解决的是“先做哪一轮、每一轮改哪些文件、由谁接手最合适”。

按本清单推进后，组织架构化 Agent 方案就可以从概念设计进入研发排期和模块落地阶段，并逐步形成真实可运行、可治理、可扩展的系统能力。
