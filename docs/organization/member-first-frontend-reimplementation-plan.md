# 基于成员优先模型的前端页面重写方案

> 适用范围：OpenerX Web UI 的页面分层重写、保留范围界定与新信息架构落地
>
> 目标：基于已经收敛的成员优先文档，在需求明确后重新界定哪些页面保留、哪些页面待定、哪些页面应彻底推倒重写，并形成新的前端实现边界

## 1. 审核范围

本次审核重点覆盖以下现有实现：

- [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue)
- [control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue](../../control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue)
- [control-plane/web-ui/src/pages/ProjectOperatingMode.vue](../../control-plane/web-ui/src/pages/ProjectOperatingMode.vue)
- [control-plane/web-ui/src/pages/TaskOperatingConsole.vue](../../control-plane/web-ui/src/pages/TaskOperatingConsole.vue)
- [control-plane/web-ui/src/pages/ManagementOperationsCenter.vue](../../control-plane/web-ui/src/pages/ManagementOperationsCenter.vue)
- [control-plane/web-ui/src/pages/AgentConsolePage.vue](../../control-plane/web-ui/src/pages/AgentConsolePage.vue)
- [control-plane/web-ui/src/router/index.ts](../../control-plane/web-ui/src/router/index.ts)
- [control-plane/web-ui/src/components/ProjectSectionNav.vue](../../control-plane/web-ui/src/components/ProjectSectionNav.vue)

对照依据如下：

- [docs/organization-oriented-agent-operating-model.md](organization-oriented-agent-operating-model.md)
- [docs/organization-oriented-agent-frontend-information-architecture.md](organization-oriented-agent-frontend-information-architecture.md)
- [docs/organization-oriented-agent-technical-checklist.md](organization-oriented-agent-technical-checklist.md)
- [docs/agent-console-redesign-plan.md](agent-console-redesign-plan.md)
- [docs/agent-member-model-discussion-summary.md](agent-member-model-discussion-summary.md)

## 2. 审核结论

### 2.1 命名层仍然停留在旧语义

当前页面已经接入了“组织运行”“任务运行详情”等新入口，但具体实现仍大量使用 `boss*` / `Boss*` 语义：

- [control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue](../../control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue)
- [control-plane/web-ui/src/pages/ProjectOperatingMode.vue](../../control-plane/web-ui/src/pages/ProjectOperatingMode.vue)
- [control-plane/web-ui/src/pages/TaskOperatingConsole.vue](../../control-plane/web-ui/src/pages/TaskOperatingConsole.vue)
- [control-plane/web-ui/src/pages/ManagementOperationsCenter.vue](../../control-plane/web-ui/src/pages/ManagementOperationsCenter.vue)
- [control-plane/web-ui/src/router/index.ts](../../control-plane/web-ui/src/router/index.ts)
- [control-plane/web-ui/src/components/ProjectSectionNav.vue](../../control-plane/web-ui/src/components/ProjectSectionNav.vue)

这会造成一个直接问题：产品文档已经收敛为“管理介入”和“管理员治理”，而前端仍在显式教育用户理解“老板层”。

### 2.2 IA 文档已更新，但页面落地没有跟上

前端信息架构文档已经明确要求：

- 前台只看“谁负责什么、现在能做什么、已经做了什么”
- Role 不直接暴露给前台
- `ManagementOperationsCenter` 取代 `BossOperationsCenter`
- 设置页应包含 `RoleGovernanceSettings`

但当前实现当前还存在两处明确缺口，以及一处兼容面尚未完全收口：

1. 主入口已经切到 `projects/:projectId/management-operations`，但旧 `projects/:projectId/boss-operations` 仍保留 redirect 和兼容语义。
2. 项目级导航已经改成“管理介入”，但页面内部实现和部分文件命名仍残留旧“老板层”语义。
3. 设置入口仍只有 `OrganizationOperatingSettings`，没有 `RoleGovernanceSettings`。

### 2.3 Agent 控制台的页面定位与当前产品心智不一致

[control-plane/web-ui/src/pages/AgentConsolePage.vue](../../control-plane/web-ui/src/pages/AgentConsolePage.vue) 当前本质上是“Agent Run 运行监控与处置台”，而不是“前台成员视角下的 Agent 页面”。

现有页面的中心对象是：

- `agentRunId`
- `agentType`
- 实时事件流
- 队列状态
- 暂停 / 恢复 / 终止 / 注入指令

这和当前收敛后的产品对象不一致。当前文档要求前台优先心智是：

- Task
- Member
- Agent
- Skill
- Run

因此，当前 `/agents` 入口名和页面心智不匹配。它不是“Agent 名册 / Agent 成员页”，而是“跨任务运行处置中心”。

### 2.4 当前实现更适合“重命名 + 重分层”，不适合整体推倒重写

这是本轮审核后被推翻的旧判断。

在需求尚未明确时，渐进重构是较稳妥的工程策略；但在当前需求已经明确后，应改为：

- `任务`
- `任务工作台`
- `多任务监控台`
- `对话配置`

这几类页面视为“已基本符合目标心智”，原则上保留。

而除此之外的多数页面，不再建议在旧页面上持续打补丁，而应按照新的成员优先与前后台分层模型重新设计和重写。

因此，这份文档后续不再采用“最小修补”思路，而改为“保留少数稳定页，其他页面按新模型重写”的方案。

## 3. 重写原则

### 3.1 页面文案先完成语义切换

从这一步开始，所有新 UI 文案统一采用：

- 管理介入
- 管理决策
- 管理视图
- 成员分工
- 可执行动作
- 执行记录

不再在页面标题、字段标签、按钮文案里使用：

- 老板参与
- 老板决策
- 老板经营
- Boss Operations

### 3.2 兼容字段只留在 API / Store / Adapter 层

如果后端暂时仍返回：

- `bossParticipationMode`
- `BossDecisionRecord`
- `bossDecisions`

则前端页面层不应直接展示这些命名，而应通过映射层转成：

- `managementParticipationMode`
- `ManagementDecisionRecord`
- `managementDecisions`

也就是说：

- 兼容旧实现可以存在
- 但兼容不应泄漏到用户可见层

页面重写时应默认遵循：

- 可以复用接口
- 可以复用部分 store
- 可以复用通用组件
- 但不以复用旧页面结构为目标

### 3.3 前台页面只展示协作对象，不展示原始治理结构

前台页面默认只展示：

- 成员分工
- 职责说明
- 当前动作
- 执行状态
- 执行记录
- 管理介入结果

前台页面不直接展示：

- 原始 Role 标识
- Role 绑定结构
- Role 到 Agent 的内部映射规则
- 工作流阶段策略明细中的后台规则对象

### 3.4 Agent 运行处置与 Agent 成员理解必须拆开

后续前端里，“Agent”至少要拆成两类页面：

1. Agent 运行处置页
2. Agent 成员 / 能力理解页

当前 [control-plane/web-ui/src/pages/AgentConsolePage.vue](../../control-plane/web-ui/src/pages/AgentConsolePage.vue) 只能承担第 1 类，不适合作为第 2 类。

因此，不应继续把当前 `/agents` 页面当成“Agent 概念总入口”。

## 4. 页面处置边界

根据当前已明确的需求，页面分为三类：

### 4.1 直接保留

以下页面目前视为符合目标需求，原则上不进入本轮推倒重写范围：

- [control-plane/web-ui/src/pages/Tasks.vue](../../control-plane/web-ui/src/pages/Tasks.vue)
- [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue)
- [control-plane/web-ui/src/pages/TaskWorkbench.vue](../../control-plane/web-ui/src/pages/TaskWorkbench.vue)
- [control-plane/web-ui/src/pages/MultiTaskMonitor.vue](../../control-plane/web-ui/src/pages/MultiTaskMonitor.vue)
- [control-plane/web-ui/src/pages/ChatSettings.vue](../../control-plane/web-ui/src/pages/ChatSettings.vue)

这些页面后续只做必要联动，不作为本轮页面体系重写重点。

补充约束：

- [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue) 作为主力任务页面保留
- [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue) 不再作为主力任务页心智来源，可在迁移期保留兼容入口，后续再决定是否退出

### 4.2 待定处理

以下页面不直接判定为保留或重写，需要结合后续产品边界再决定：

- [control-plane/web-ui/src/pages/Projects.vue](../../control-plane/web-ui/src/pages/Projects.vue)
- [control-plane/web-ui/src/pages/ProjectDetail.vue](../../control-plane/web-ui/src/pages/ProjectDetail.vue)
- [control-plane/web-ui/src/pages/Users.vue](../../control-plane/web-ui/src/pages/Users.vue)

判断标准：

- 如果只是容器页或资源索引页，可以按情况保留并做轻度适配
- 如果其内部已经承载了旧组织心智、旧治理心智或旧“老板层”入口，则应纳入重写范围

### 4.3 全量重写

除保留页与待定页外，本轮默认按“推倒重写”处理，重点包括：

- [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue)
- [control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue](../../control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue)
- [control-plane/web-ui/src/pages/ProjectOperatingMode.vue](../../control-plane/web-ui/src/pages/ProjectOperatingMode.vue)
- [control-plane/web-ui/src/pages/TaskOperatingConsole.vue](../../control-plane/web-ui/src/pages/TaskOperatingConsole.vue)
- [control-plane/web-ui/src/pages/TaskOperatingOverride.vue](../../control-plane/web-ui/src/pages/TaskOperatingOverride.vue)
- [control-plane/web-ui/src/pages/RecommendedScenarios.vue](../../control-plane/web-ui/src/pages/RecommendedScenarios.vue)
- [control-plane/web-ui/src/pages/ManagementOperationsCenter.vue](../../control-plane/web-ui/src/pages/ManagementOperationsCenter.vue)
- [control-plane/web-ui/src/pages/AgentConsolePage.vue](../../control-plane/web-ui/src/pages/AgentConsolePage.vue)
- [control-plane/web-ui/src/pages/ProjectOrchestration.vue](../../control-plane/web-ui/src/pages/ProjectOrchestration.vue)
- [control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue](../../control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue)
- [control-plane/web-ui/src/pages/ProjectRoleExecution.vue](../../control-plane/web-ui/src/pages/ProjectRoleExecution.vue)

这些页面的问题不是“字段叫错了”，而是其对象边界、导航语义、页面职责和用户心智来源都已经与当前方案不一致。

## 5. 页面重写方案

## 5.1 设置页重写

目标：把 [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue) 按治理首页重新设计，不继承旧 tab 结构作为主骨架。

建议结构：

1. 账户信息
2. 模型与 Provider
3. 组织运行策略入口
4. Role 治理入口
5. 工作流模板入口
6. 对话配置入口

建议处理方式：

- 重新设计设置首页信息架构
- 不以现有 tab 作为页面结构基础
- 把账户、模型、组织运行、Role 治理、模板治理拆成入口块或二级导航
- `Settings.vue` 只承担治理分发与入口组织，不承担复杂策略编辑主体

必要新增：

- 新增 `RoleGovernanceSettings.vue`
- 在 [control-plane/web-ui/src/router/index.ts](../../control-plane/web-ui/src/router/index.ts) 中新增 `/settings/role-governance`
- 在 [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue) 中增加第二张入口卡片

### 5.2 OrganizationOperatingSettings 重写

目标：按新治理语义重写平台运行策略页，不继承现有旧表单字段布局。

建议重新设计的核心模块：

- 平台默认运行档位
- 管理介入策略
- 推荐场景与推荐规则
- 平台级限制条件

建议修改：

- `默认老板参与方式` -> `默认管理介入方式`
- 场景表格列 `老板` -> `管理介入`
- `defaultBossParticipationMode` 在页面层映射为 `defaultManagementParticipationMode`
- 页面副标题去掉“老板参与方式”表述

实现策略：

- 组件重写
- view model 重写
- API 可暂时复用旧字段
- 旧字段映射集中在 adapter，不进入页面组件

### 5.3 ProjectOperatingMode 重写

目标：按项目级治理视角重写，重新定义“项目运行视图”和“项目默认配置”的关系。

建议重新设计：

- 项目当前有效运行档位
- 项目默认策略
- 项目模板与治理来源
- 当前配置影响范围说明

建议修改：

- 页面所有 `老板参与` 改为 `管理介入`
- `allowBossAutoTemplateSwitch` 在页面层映射为 `allowManagementAutoTemplateSwitch`
- “查看介入编排”保留，但补充“查看管理介入视图”入口
- 项目页中的“运行档位”应更清晰地区分：
  - 当前有效档位
  - 项目默认档位
  - 触发来源

补充建议：

- 页面上增加“当前配置会影响哪些任务”的解释卡片
- 在卡片中强调这是治理配置，不是成员分工配置

### 5.4 TaskOperatingConsole 重写

目标：按任务协作视角重写，明确它是“任务运行与管理介入详情页”，不是旧经营模型附属页。

建议修改：

- `老板参与` -> `管理介入`
- `老板最近决策` -> `管理最近决策`
- 页面副标题从“老板决策和当前阶段摘要”改成“查看任务运行档位、管理介入记录和阶段摘要”
- 决策时间线默认聚焦：
  - 为什么介入
  - 介入后发生了什么
  - 当前还需要谁处理

建议重新设计：

- 运行档位
- 当前阶段
- 管理介入记录
- 升级请求
- 返回任务协作主链的入口

补充建议：

- 增加“返回任务协作页”显式入口
- 页面中如果出现分工信息，统一使用“分工文案”而不是 Role 名称

### 5.5 ManagementOperationsCenter 重写

目标：继续收敛 [control-plane/web-ui/src/pages/ManagementOperationsCenter.vue](../../control-plane/web-ui/src/pages/ManagementOperationsCenter.vue)，完成对 legacy `BossOperationsCenter` 兼容语义的替代，稳定为项目级管理介入总览页。

建议做法：

- 以 `ManagementOperationsCenter.vue` 作为当前主入口继续演进
- 不继承“老板经营视图”信息架构
- 按“管理决策时间线 / 升级请求 / 人工覆盖 / 项目级关注项”重新组织区块
- 保留 `/boss-operations` 兼容 redirect 仅用于迁移期，并规划最终移除
- 清理残留 `BossOperationsCenter` 文件名和旧老板层文案

同步修改位置：

- [control-plane/web-ui/src/router/index.ts](../../control-plane/web-ui/src/router/index.ts)
- [control-plane/web-ui/src/components/ProjectSectionNav.vue](../../control-plane/web-ui/src/components/ProjectSectionNav.vue)
- [control-plane/web-ui/src/pages/ProjectDetail.vue](../../control-plane/web-ui/src/pages/ProjectDetail.vue)
- [control-plane/web-ui/src/pages/ProjectOrchestration.vue](../../control-plane/web-ui/src/pages/ProjectOrchestration.vue)

### 5.6 Agent 运营中心重写

目标：彻底替换当前 [control-plane/web-ui/src/pages/AgentConsolePage.vue](../../control-plane/web-ui/src/pages/AgentConsolePage.vue) 的旧页面心智，重建为“Agent 运营中心”。

建议结论：

- 不延续“Agent 控制台”命名
- 不延续“实时运行监视器”心智
- 可以参考现有组件拆分，但页面本身按新定位重写

建议新定位：

- 页面名：`AgentOperationsCenter`
- 导航名：`Agent 运营中心`
- 页面副标题：统一查看 Agent 执行健康度、阻塞情况、结果与人工介入入口

可参考的现有组件拆分：

- [control-plane/web-ui/src/components/agent-ops/AgentOpsHeader.vue](../../control-plane/web-ui/src/components/agent-ops/AgentOpsHeader.vue)
- [control-plane/web-ui/src/components/agent-ops/AgentOpsFilterBar.vue](../../control-plane/web-ui/src/components/agent-ops/AgentOpsFilterBar.vue)
- [control-plane/web-ui/src/components/agent-ops/AgentOpsQueueBoard.vue](../../control-plane/web-ui/src/components/agent-ops/AgentOpsQueueBoard.vue)
- [control-plane/web-ui/src/components/agent-ops/AgentOpsAnalyticsPanel.vue](../../control-plane/web-ui/src/components/agent-ops/AgentOpsAnalyticsPanel.vue)
- [control-plane/web-ui/src/components/agent-ops/AgentOpsDetailDrawer.vue](../../control-plane/web-ui/src/components/agent-ops/AgentOpsDetailDrawer.vue)

建议重点重建：

1. `/agents` 导航和页面重新命名。
2. 页面第一屏以“待处理 / 运行中 / 最近结束”三类队列为中心。
3. 底层术语退到抽屉或次级信息层。
4. 普通用户默认聚焦我的任务处置。
5. 管理员默认聚焦全局或项目级治理判断。
6. 详情抽屉按“阻塞原因 / 结果 / 可执行动作 / 跳转入口”重构。

额外建议：

- 后续如果需要真正面向前台解释“有哪些 Agent 成员、擅长什么、最近表现如何”，应新开独立页面，例如 `AgentDirectory` 或 `AgentCatalog`，不要把这部分继续塞进当前运行处置页。

## 6. 路由与命名迁移方案

建议按“新命名生效，旧路由短期兼容，最终移除旧路由”的方式迁移。

### 5.1 路由迁移

- `/projects/:projectId/boss-operations` -> redirect 到 `/projects/:projectId/management-operations`（已完成）
- `BossOperationsCenter` -> `ManagementOperationsCenter`（主入口切换已完成，兼容清理待收尾）
- `/agents` 可短期保留路径，但页面和导航名统一改为 `Agent 运营中心`

### 5.2 组件命名迁移

优先级建议：

1. 页面标题与按钮文案
2. 路由名与导航 key
3. 页面文件名
4. API 类型名

也就是说，切换阶段允许内部实现存在兼容层，但页面名称、路由名称和导航语义必须先完成切换。

## 7. 推荐实施顺序

### Phase A：重建页面骨架与路由边界

目标：先完成新的页面边界，不继续在旧页面上堆补丁。

建议完成：

- 新的设置首页骨架
- 新的 `OrganizationOperatingSettings`
- 新的 `ProjectOperatingMode`
- 新的 `TaskOperatingConsole`
- 新的 `ManagementOperationsCenter`
- 新的 `AgentOperationsCenter`

### Phase B：补齐 IA 缺口与治理页

目标：让实现和文档一致。

建议完成：

- 新增 `RoleGovernanceSettings.vue`
- 新增 `/settings/role-governance`
- 评估何时移除 `/projects/:projectId/boss-operations` 兼容 redirect
- 继续清理 `ProjectSectionNav` 之外残留的旧“老板经营”文案

### Phase C：清理旧页面与旧命名入口

目标：停止旧页面继续对外输出旧心智。

建议完成：

- 移除 `BossOperationsCenter` 对外入口
- 停止“老板经营”“老板参与”“老板决策”等用户可见文案
- 清理项目页、设置页、编排页中的旧跳转入口
- 将旧页面保留为临时兼容或直接删除

### Phase D：收缩兼容层

目标：把 `boss*` 字段逐步收缩到 adapter 或 API alias。

建议完成：

- 前端页面不再直接访问 `bossParticipationMode`
- UI view model 全部切为 `managementParticipationMode`
- 类型层建立 alias，直到后端完成真正字段重命名

## 8. 最终建议

当前已明确的实现边界应当是：

1. 保留 [control-plane/web-ui/src/pages/Tasks.vue](../../control-plane/web-ui/src/pages/Tasks.vue)、[control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue)、[control-plane/web-ui/src/pages/TaskWorkbench.vue](../../control-plane/web-ui/src/pages/TaskWorkbench.vue)、[control-plane/web-ui/src/pages/MultiTaskMonitor.vue](../../control-plane/web-ui/src/pages/MultiTaskMonitor.vue)、[control-plane/web-ui/src/pages/ChatSettings.vue](../../control-plane/web-ui/src/pages/ChatSettings.vue)，其中 [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue) 作为主力任务页
2. [control-plane/web-ui/src/pages/Projects.vue](../../control-plane/web-ui/src/pages/Projects.vue)、[control-plane/web-ui/src/pages/ProjectDetail.vue](../../control-plane/web-ui/src/pages/ProjectDetail.vue)、[control-plane/web-ui/src/pages/Users.vue](../../control-plane/web-ui/src/pages/Users.vue) 视情况决定保留还是重写
3. 其他页面默认不再修补，而按新模型重写
4. 新实现以成员优先、前后台分层、管理介入替代旧老板层、Agent 运营中心替代旧 Agent 控制台为基本原则

因此，当前前端工作的重点不再是“怎么把旧页面修到还能用”，而是“如何围绕新对象模型建立一套新的页面体系”。
