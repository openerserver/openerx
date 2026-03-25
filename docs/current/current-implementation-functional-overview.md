# 当前项目实现功能现状

> 适用范围：基于当前代码实现，对 OpenerX Web UI 已落地功能进行盘点
>
> 目标：从“当前真的已经实现了什么”出发，整理一份现状参考文档，作为后续页面保留、重写和迁移的依据

## 1. 文档定位

本文档不是目标方案，也不是未来信息架构草案。

本文档只回答一个问题：

- 按照当前项目已经落地的实现，系统实际具备哪些页面、入口和功能

因此，这里会同时保留两类信息：

- 当前可用、已形成稳定使用路径的功能
- 当前已经实现，但仍带有旧命名或旧心智的功能

## 2. 当前主导航

根据 [control-plane/web-ui/src/layouts/MainLayout.vue](../control-plane/web-ui/src/layouts/MainLayout.vue) 和 [control-plane/web-ui/src/router/index.ts](../control-plane/web-ui/src/router/index.ts)，当前主导航包含：

- Dashboard
- 任务
- 任务工作台
- 多任务监控台
- 项目
- Agent 控制台
- 审批
- 设置

平台管理员 / 组织管理员额外可见：

- 对话配置
- 用户管理

## 3. 当前核心页面与能力

### 3.1 任务列表

页面：

- [control-plane/web-ui/src/pages/Tasks.vue](../control-plane/web-ui/src/pages/Tasks.vue)

当前已实现能力：

- 任务列表展示
- 按状态筛选任务
- 新建任务
- 任务创建时选择：
  - 项目
  - 任务运行档位
  - 凭证
  - 模型
  - 模板
  - 标题与任务描述
- 从任务列表进入推荐场景
- 从任务列表进入任务总图
- 取消任务
- 进入任务视图

现状判断：

- 这是当前已经比较完整的任务入口页
- 它已经接入了“任务运行档位”等组织运行能力
- 同时仍保留对旧推荐场景、旧运行模式对象的依赖

### 3.2 主力任务详情页

页面：

- [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue)

当前已实现特征：

- 已作为独立的 `tasks/:taskId/v3` 路由存在
- 页面内部已接入树形 breadcrumb
- 已包含文件预览打开能力
- 已形成新版任务详情页独立实现，不依赖旧 `TaskDetail.vue` 路由壳

现状判断：

- `TaskDetailV3` 当前应视为主力任务详情页
- 旧 [control-plane/web-ui/src/pages/TaskDetail.vue](../control-plane/web-ui/src/pages/TaskDetail.vue) 仍存在，但不应继续视为主力任务页

### 3.3 任务工作台

页面：

- [control-plane/web-ui/src/pages/TaskWorkbench.vue](../control-plane/web-ui/src/pages/TaskWorkbench.vue)

当前已实现特征：

- 独立入口 `/workbench`
- 已形成任务工作区视图
- 与任务列表存在往返导航

现状判断：

- 当前任务工作台已落地，应继续视为主链页面之一
- 后续主要需要和主力任务详情页协同，而不是单独推倒

### 3.4 多任务监控台

页面：

- [control-plane/web-ui/src/pages/MultiTaskMonitor.vue](../control-plane/web-ui/src/pages/MultiTaskMonitor.vue)

当前已实现特征：

- 独立入口 `/multi-task-monitor`
- 已作为多任务观察视图存在于主导航中

现状判断：

- 当前它已经是实际产品入口
- 后续应按保留页处理，而不是纳入第一轮重写对象

### 3.5 审批页

页面：

- [control-plane/web-ui/src/pages/Approvals.vue](../control-plane/web-ui/src/pages/Approvals.vue)

当前已实现特征：

- 独立入口 `/approvals`
- 当前作为审批相关入口存在于主导航中

现状判断：

- 审批页已经是现有主产品链路的一部分
- 后续页面重写需要与审批跳转链路保持兼容

### 3.6 对话配置

页面：

- [control-plane/web-ui/src/pages/ChatSettings.vue](../control-plane/web-ui/src/pages/ChatSettings.vue)

当前已实现能力：

- 当前编排总览
- 当前分类策略摘要
- AI 编排助手
- 编排变更预览
- 本轮会话历史

现状判断：

- 这页已经不只是“配置项表单”，而是一个带 AI 编排助手的治理页
- 当前实现与后续方向基本一致，可视为保留页

## 4. 当前项目相关页面

### 4.1 项目列表

页面：

- [control-plane/web-ui/src/pages/Projects.vue](../control-plane/web-ui/src/pages/Projects.vue)

当前已实现能力：

- 项目列表与汇总卡片
- 新建项目
- 编辑项目
- 从项目进入成员、仓库、凭证等 tab

现状判断：

- 项目列表页已经具备资源索引功能
- 是否保留、轻改或重写，需要结合后续“项目页”在新产品里的定位再决定

### 4.2 项目详情

页面：

- [control-plane/web-ui/src/pages/ProjectDetail.vue](../control-plane/web-ui/src/pages/ProjectDetail.vue)

当前已实现特征：

- 是项目相关多个二级页面的返回锚点
- 当前承担项目概览与多类二级入口承接

现状判断：

- 它目前更像项目容器页
- 具体是否保留，要看后续项目信息架构是否继续以它为主容器

### 4.3 项目审批策略

页面：

- [control-plane/web-ui/src/pages/ProjectPolicies.vue](../control-plane/web-ui/src/pages/ProjectPolicies.vue)

当前已实现能力：

- 查看当前绑定状态
- 项目默认审批策略配置
- 环境审批覆盖
- 策略模板列表

现状判断：

- 这是当前实现里较清晰的一类治理页
- 它与新的“前后台分层”方向并不冲突

### 4.4 项目工作流页

页面：

- [control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue](../control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue)

当前已实现能力：

- 查看当前模板摘要
- 模板绑定与治理授权
- 模板级组织策略
- 切换前差异摘要
- 流程可视化
- 阶段路径
- 可选模板列表

现状判断：

- 这页已经形成比较完整的治理视图
- 但它明显仍属于旧组织化方案语义，需要根据新模型决定是否整体重写

### 4.5 项目角色执行页

页面：

- [control-plane/web-ui/src/pages/ProjectRoleExecution.vue](../control-plane/web-ui/src/pages/ProjectRoleExecution.vue)

当前已实现能力：

- 项目角色执行总览
- 配置说明
- 各角色由谁执行，以及如何介入任务推进

现状判断：

- 它高度依赖旧 `Role` 前置心智
- 与当前“Role 内收、前台不直接暴露 Role”的方向存在冲突

### 4.6 项目介入编排页

页面：

- [control-plane/web-ui/src/pages/ProjectOrchestration.vue](../control-plane/web-ui/src/pages/ProjectOrchestration.vue)

当前已实现能力：

- 组织运行入口
- 打开项目运行档位
- 打开老板经营视图
- 当前模板与候选模板
- 角色能力
- 切换预演
- 统一编排图
- 阶段角色介入矩阵
- 角色能力基线

现状判断：

- 这是当前项目中最典型的“旧组织化心智”页面之一
- 它已经实现了很多解释性能力，但语义与当前收敛方案偏差很大

### 4.7 项目运行档位页

页面：

- [control-plane/web-ui/src/pages/ProjectOperatingMode.vue](../control-plane/web-ui/src/pages/ProjectOperatingMode.vue)

当前已实现能力：

- 查看当前项目档位
- 查看模板与编排来源
- 编辑项目默认运行档位
- 跳转项目编排页

现状判断：

- 功能已经落地
- 但仍使用 `bossParticipationMode` 等旧命名
- 需要作为后续重写对象处理

### 4.8 项目老板经营视图

页面：

- [control-plane/web-ui/src/pages/BossOperationsCenter.vue](../control-plane/web-ui/src/pages/BossOperationsCenter.vue)

当前已实现能力：

- 老板决策时间线
- 开放升级请求
- 需人工关注的任务
- 人工覆盖历史
- 从项目层跳转到任务运行详情或任务详情

现状判断：

- 这页已形成完整项目级治理总览页
- 但它的心智和命名都属于旧“老板层”方案
- 后续应以“Management Operations”方向替代

## 5. 当前任务运行与组织运行页面

### 5.1 任务运行详情

页面：

- [control-plane/web-ui/src/pages/TaskOperatingConsole.vue](../control-plane/web-ui/src/pages/TaskOperatingConsole.vue)

当前已实现能力：

- 查看当前运行档位
- 查看阶段摘要
- 查看老板最近决策
- 查看升级请求
- 跳转任务级覆盖页
- 跳转项目运行档位页

现状判断：

- 该页功能链路已经成立
- 但文案和数据对象仍偏旧心智

### 5.2 任务级覆盖

页面：

- [control-plane/web-ui/src/pages/TaskOperatingOverride.vue](../control-plane/web-ui/src/pages/TaskOperatingOverride.vue)

当前已实现能力：

- 查看当前生效档位
- 为单个任务填写任务级覆盖表单
- 返回任务运行详情

现状判断：

- 该页已经具备完整表单与回跳链路
- 但属于当前待重构的组织运行体系

### 5.3 推荐场景

页面：

- [control-plane/web-ui/src/pages/RecommendedScenarios.vue](../control-plane/web-ui/src/pages/RecommendedScenarios.vue)
- [control-plane/web-ui/src/pages/TaskOperatingModeLauncher.vue](../control-plane/web-ui/src/pages/TaskOperatingModeLauncher.vue)

当前已实现能力：

- 查看项目当前默认档位
- 查看推荐场景列表
- 将推荐组合带入任务创建链路

现状判断：

- 这部分功能已经接通
- 但仍依赖旧运行模式命名和旧老板参与字段

## 6. 当前设置与治理页面

### 6.1 设置页

页面：

- [control-plane/web-ui/src/pages/Settings.vue](../control-plane/web-ui/src/pages/Settings.vue)

当前已实现能力非常多，主要包括：

- 账户信息与改密
- GitHub Copilot 多账号登录
- Provider 列表与模型管理
- 默认执行模型配置
- Agent / Skill / MCP / 插件相关配置
- 编排映射、规划流水线、生命周期 Hooks、工作流模板、裁判配置
- 失败恢复与续跑策略
- 运行中任务 reconcile
- 最近手动修复记录
- 组织运行策略入口

现状判断：

- 这是当前项目中最重的综合治理页之一
- 它同时承担账户、模型、插件、编排、模板、治理等多种职责
- 功能强，但信息架构已经过重

### 6.2 组织运行策略

页面：

- [control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue](../control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue)

当前已实现能力：

- 配置平台默认协作模式
- 配置默认自动托管等级
- 配置默认老板参与方式
- 查看推荐场景预览

现状判断：

- 它已经是独立二级治理页
- 但命名和字段仍停留在旧方案

### 6.3 工作流模板治理

页面：

- [control-plane/web-ui/src/pages/WorkflowTemplatesAdmin.vue](../control-plane/web-ui/src/pages/WorkflowTemplatesAdmin.vue)
- [control-plane/web-ui/src/pages/WorkflowTemplateEditor.vue](../control-plane/web-ui/src/pages/WorkflowTemplateEditor.vue)

当前已实现能力：

- 模板列表治理
- 单模板编辑
- 阶段路径和可视化预览
- 模板信息与阶段编辑
- Gate / Approval / 二次治理模板策略 / 失败策略等细粒度配置

现状判断：

- 这是一套已经比较成熟的治理工具链
- 未来是保留、整合还是改造，要看模板治理是否仍为核心后台对象

## 7. 当前 Agent 相关页面

### 7.1 Agent 控制台

页面：

- [control-plane/web-ui/src/pages/AgentConsolePage.vue](../control-plane/web-ui/src/pages/AgentConsolePage.vue)

当前已实现能力：

- 按队列查看 Agent Run
- 支持 attention / running / recent 三类队列
- 查看运行状态、阻断标签、结果摘要、token、时长
- 实时连接状态显示
- 详情抽屉
- 暂停 / 恢复 / 终止 / 注入指令
- 管理员分析区
- 多条件筛选：项目、状态、风险、审批阻断、是否需要介入、模型、Agent 类型等

现状判断：

- 这页当前本质上是运行处置中心，而不是 Agent 成员目录页
- 它已经形成完整的运维 / 运营工作台能力
- 但命名仍叫“Agent 控制台”

## 8. 当前用户管理

页面：

- [control-plane/web-ui/src/pages/Users.vue](../control-plane/web-ui/src/pages/Users.vue)

当前已实现特征：

- 作为平台管理员 / 组织管理员导航入口存在

现状判断：

- 这是当前实际存在的后台管理页
- 具体是否保留或改造，需要结合后续用户体系设计再判断

## 9. 当前实现的总体判断

从功能实现角度看，当前项目已经具备四条较完整的产品链路：

1. 任务创建与任务运行链路
2. 任务工作台与多任务观察链路
3. 项目治理与模板 / 编排 / 运行模式链路
4. Agent 运行处置与审批 / 升级 / 介入链路

但从信息架构与命名一致性看，当前项目仍同时并存两套心智：

- 新方向：任务、任务工作台、多任务监控台、TaskDetailV3、对话配置
- 旧方向：老板经营、角色执行、旧组织运行档位、旧编排页、旧 Agent 控制台命名

因此，这份文档的价值不在于说明“应该怎么做”，而在于明确：

- 当前哪些功能是真实存在的
- 哪些页面已经可用
- 哪些页面虽然可用，但属于旧心智实现
- 后续重写时哪些功能链路不能丢

## 10. 与当前有效文档目录的关系

本文档基于当前实现整理，和以下文档形成互补：

- [organization-oriented-agent-operating-model.md](organization-oriented-agent-operating-model.md)：定义目标对象模型
- [organization-oriented-agent-frontend-information-architecture.md](organization-oriented-agent-frontend-information-architecture.md)：定义目标信息架构
- [organization-oriented-agent-technical-checklist.md](organization-oriented-agent-technical-checklist.md)：定义技术落点
- [member-first-frontend-reimplementation-plan.md](member-first-frontend-reimplementation-plan.md)：定义页面保留 / 待定 / 重写边界

如果需要回答“现在项目已经做到了什么”，优先看本文。

如果需要回答“接下来应该按什么模型去重写”，优先看 [member-first-frontend-reimplementation-plan.md](member-first-frontend-reimplementation-plan.md)。
