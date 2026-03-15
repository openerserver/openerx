# 角色执行与工作流的关系澄清及重设计方案

> 目标：回答三个问题
>
> 1. 当前“角色执行”和“工作流”是否已经实现了最初设计目的
> 2. 两者之间的职责边界和依赖关系是什么
> 3. 为什么当前页面仍然让人看不清“各角色 Agent 在什么时候、用什么方法介入”，以及应该如何重设计

## 1. 结论

当前系统已经实现了两块能力的基础数据模型和管理入口，但**还没有真正实现最初设计中“可解释、可编排、可审计的多角色阶段协作体验”**。

更准确地说：

- “工作流”已经能管理阶段模板、阶段顺序、Gate / Approval / Failure Policy 等流程骨架。
- “角色执行”已经能管理角色默认配置、项目 override、执行器 binding 和项目接管方式。
- 但系统仍然缺少一个真正把两者连接起来的“编排解释层”，导致管理员和项目成员看不清：
  - 某个阶段到底由谁主导
  - 哪些角色会介入
  - 介入的触发条件是什么
  - 介入时使用哪个执行器、什么执行模式
  - 介入后会产生什么结果，是提示、修正请求、审批还是阻断

所以当前状态应判断为：

- 数据结构：基本到位
- 管理页面：部分到位
- 运行时接线：部分到位
- 用户可理解性：明显不足
- 原始设计目标达成度：约 50% 到 60%

## 2. 当前设计本来想解决什么

从现有设计文档看，原始目标并不是简单做两个配置页，而是构建一套完整的研发协作状态机：

- 工作流定义“任务按什么阶段推进”
- 角色体系定义“每种职责由谁承担”
- 阶段中的角色策略定义“哪些角色在何时、以何种方式介入”
- Gate / Approval / Failure Policy 定义“角色介入后如何影响推进结果”

对应文档意图很清楚：

- [docs/workflow-template-stage-machine-design.md](docs/workflow-template-stage-machine-design.md) 定义的是阶段状态机和阶段控制规则
- [docs/development-role-agents-plan.md](docs/development-role-agents-plan.md) 定义的是研发过程中的职责角色体系
- [docs/bff-role-aggregation-executor-design.md](docs/bff-role-aggregation-executor-design.md) 定义的是这些角色如何在 BFF 中被调度、聚合、冲突解析并转成治理结果

也就是说，原始目标其实是三层：

1. 流程骨架
2. 角色能力
3. 编排与执行解释

当前系统主要完成了前两层，第三层还没有形成稳定产品体验。

## 3. 当前两块页面各自实现了什么

### 3.1 工作流页当前实际承担的职责

当前 [control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue](control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue) 更像“项目绑定哪套模板”的页面，而不是“项目流程如何运行”的页面。

它已经能做：

- 展示项目当前绑定模板
- 展示可选模板
- 切换模板
- 展示候选模板和当前模板的阶段差异
- 展示阶段路径

它还不能直接回答：

- 某个阶段的主责角色是谁
- 某个阶段哪些辅助角色会参与
- 这些角色是 always 介入，还是命中 Gate / Hook 才介入
- 介入时是 single、parallel-review 还是 round-robin
- 介入后会生成什么结果

因此它目前更像“模板绑定页”，不是“流程编排页”。

### 3.2 角色执行页当前实际承担的职责

当前 [control-plane/web-ui/src/pages/ProjectRoleExecution.vue](control-plane/web-ui/src/pages/ProjectRoleExecution.vue) 更像“项目角色能力与执行器管理页”，而不是“角色在流程中如何介入”的页面。

它已经能做：

- 展示平台默认角色
- 展示项目 override
- 允许项目对角色做 extend / replace
- 配置 allowedStages、riskLevel、executionMode、aggregationStrategy
- 管理项目专属 binding

它还不能直接回答：

- 当前项目采用的流程模板里，这个角色究竟会在哪些真实阶段生效
- 如果模板和角色 allowedStages 有冲突，最终谁生效
- 当前阶段触发时，会选择哪个 binding 执行
- binding 是串行、并行还是聚合
- 该角色的输出会映射成什么动作

因此它目前更像“角色注册与接管页”，不是“角色介入解释页”。

## 4. 两者的正确关系是什么

应该把两者理解为“骨架”和“血肉”的关系，而不是两个并列页面。

### 4.1 工作流回答的是“何时、为什么推进”

工作流定义：

- 阶段顺序
- 阶段进入条件
- 阶段退出条件
- Gate
- Approval
- Failure Policy

也就是：**任务在什么时候进入某阶段，以及在什么条件下才能离开该阶段。**

### 4.2 角色执行回答的是“谁来做、怎么做”

角色执行定义：

- 某类职责由哪个 role agent 承担
- 这个角色有哪些 bindings
- 项目是否增强或接管这个角色
- 这个角色默认用哪种执行模式
- 这个角色在哪些 stage 允许参与

也就是：**某个阶段里，如果要让某类职责介入，具体由谁执行、用什么执行方式执行。**

### 4.3 真正缺失的是“连接层”

真正缺失的是一层显式模型：

**阶段角色介入矩阵。**

这层应明确描述：

- stage -> primary role
- stage -> participant roles
- role -> effective execution mode
- role -> effective bindings
- role -> trigger policy
- role -> output action

没有这一层，用户就只能在脑子里把“模板页”和“角色页”手工拼起来，自然会看不懂。

## 5. 为什么当前页面会让人看不懂

根因不是信息少，而是信息分布方式错误。

### 5.1 页面按存储对象拆了，不是按用户问题拆的

当前页面是按后端对象拆分的：

- 模板
- 阶段
- 角色
- binding
- override

但用户真正的问题是：

- 这个任务接下来会进入什么阶段
- 到了这个阶段谁会介入
- 为什么是这些角色介入
- 它们介入后会不会阻断我
- 如果被阻断，我该看谁的意见

当前信息架构没有围绕这些问题组织，所以读页面需要自己做很多脑内关联。

### 5.2 当前是“配置视图”和“结果视图”，缺少“计划视图”

目前已有两种视图：

- 配置视图：角色执行页、工作流模板页
- 结果视图：任务详情里的角色工作流面板

但缺了一种最关键的视图：

- 计划视图：任务开始前或项目配置时，明确说明“将会怎样介入”

这就是为什么现在你只能看到：

- 模板长什么样
- 角色配置了什么
- 任务运行后谁真正出过结论

却看不到：

- 在运行前，系统本来打算让谁以什么方式介入

### 5.3 运行时接线仍然是部分实现

从当前实现看，运行时并没有完整按阶段驱动角色执行。

明确证据：

- [control-plane/web-ui-bff/src/modules/tasks/workflow-sync.ts](control-plane/web-ui-bff/src/modules/tasks/workflow-sync.ts) 只是在任务启动时把 workflow 初始化到 implement，并在完成时粗粒度同步到 verify / completed
- [control-plane/service/src/modules/task-workflows/routes.ts](control-plane/service/src/modules/task-workflows/routes.ts) 提供了 initialize / advance / retry-stage，但页面和运行时并没有形成完整阶段推进器
- [control-plane/web-ui-bff/src/modules/role-aggregation](control-plane/web-ui-bff/src/modules/role-aggregation) 这组文档建议的执行器模块目前并不存在源码目录
- [control-plane/service/src/modules/task-workflows/legacy-role-workflow-storage.ts](control-plane/service/src/modules/task-workflows/legacy-role-workflow-storage.ts) 里仍然存在把历史 strategy 推断迁移成 workflow 的逻辑，说明当前不少 workflow 状态并不是“原生运行”出来的，而是兼容层推断出来的

这意味着当前“角色执行”和“工作流”更多还是治理和展示模型，而不是完整的运行时编排模型。

## 6. 重设计原则

如果要重新设计，不建议简单把两个页面继续堆字段，而应该按下面三个问题来重构。

### 6.1 先让用户看懂“计划如何介入”

第一优先级不是继续增加配置能力，而是增加解释能力。

系统必须能直接回答：

- 在 clarify / design / implement / verify / release 各阶段，谁会介入
- 介入的依据是什么
- 介入时调用哪些执行器
- 这些执行器是并行还是串行
- 输出会形成建议、修正请求、审批还是阻断

### 6.2 配置页和解释页分离

不要试图让一个页面同时承担：

- 元数据维护
- 项目接管
- 编排解释
- 任务运行观察

这四类任务应该拆开。

### 6.3 真实运行链路和管理模型要逐步对齐

UI 重新设计不能只改页面文案，还要明确后续接线目标：

- 用阶段推进器替代当前的粗粒度 workflow-sync
- 用 stage-role matrix 驱动角色聚合执行
- 让任务详情展示“计划介入”和“实际介入”的偏差

## 7. 推荐的信息架构重做

建议把当前体验重构为 3 个层次，而不是 2 个。

### 7.1 平台级：流程模板中心

保留当前工作流模板管理页，但定位改成“模板编辑器”。

名称建议：

- 工作流模板

它负责：

- 阶段顺序
- Gate / Approval / Failure Policy
- 阶段主角色与参与角色
- 预设模板管理

### 7.2 项目级：角色能力中心

保留当前角色执行页，但名称应该更准确。

名称建议：

- 角色能力与执行器

它负责：

- 项目是否接管角色
- 项目是否补充 binding
- 角色执行模式
- 风险等级和 allowedStages

### 7.3 项目级：新增“介入编排”页

这是当前最缺的一页。

名称建议：

- 角色介入编排
- 或：流程执行设计

建议路由：

- /projects/:projectId/orchestration

这一页专门回答：

- 当前项目绑定了哪套模板
- 按当前模板 + 当前角色配置，阶段会如何被执行
- 每个角色会在什么时候、因为什么、以什么方式介入

## 8. 新页面应该长什么样

### 8.1 页面主结构

建议分三栏：

- 左栏：阶段轨道
- 中栏：当前阶段的介入说明
- 右栏：实际执行能力与风险提示

### 8.2 左栏：阶段轨道

按 stage rail 展示：

- clarify
- design
- implement
- verify
- release

每个阶段卡片上直接显示：

- 主责角色
- 参与角色数
- Gate 数
- Approval 数
- 是否存在 failure fallback

并用 icon 或 tag 标出：

- 自动介入
- 条件介入
- 人工审批
- 高风险阶段

### 8.3 中栏：阶段介入说明

点击某个阶段后，中栏直接展示“介入矩阵”。

每个角色一张卡，字段建议固定为：

- 角色名
- 介入类型：主责 / 参与 / gate evaluator / approval owner
- 触发时机：before-stage / after-stage / before-gate / after-gate / on-failure
- 触发条件：always / conditional / policy-driven
- 执行方法：single / parallel-review / round-robin
- 实际 bindings：会命中的 binding 列表
- 产出动作：allow / notify-developer / needs-approval / block / human-review
- 配置来源：模板默认 / 项目增强 / 项目接管

这样用户第一次就能看到：

- 谁
- 何时
- 为什么
- 怎么执行
- 执行后会怎样

### 8.4 右栏：可执行性和风险

右栏不再放杂项，而是只做风险和可执行性校验。

例如：

- 该阶段主角色 allowedStages 与模板不一致
- 该角色设为 replace，但项目没有 binding
- 该阶段有 Gate，但 evaluator role 当前没有可用 binding
- 该阶段配置了 approval，但 approver policy 没有对应组织角色
- 该阶段 failurePolicy 指向了不存在或已禁用阶段

这一栏的价值在于：让“配了但跑不起来”的问题提前暴露。

## 9. 任务详情页也要同步重做

单改项目配置页不够，任务详情也要对应升级。

当前 [control-plane/web-ui/src/components/TaskRoleWorkflowPanel.vue](control-plane/web-ui/src/components/TaskRoleWorkflowPanel.vue) 更偏结果视图，应该补一组“计划 vs 实际”内容。

建议新增两块：

### 9.1 本阶段计划介入角色

在任务运行前就展示：

- 当前阶段计划介入哪些角色
- 每个角色的 planned execution mode
- 预计输出动作

### 9.2 本阶段实际介入偏差

如果运行时只触发了部分角色，或者某些角色因 binding 缺失没有执行，应清楚显示：

- 计划介入但未执行
- 未计划但实际介入
- 因何跳过
- 因何升级为人工接管

这样才能把“配置模型”变成“可审计运行模型”。

## 10. 后端需要补的最小连接模型

为了支撑上面的可解释界面，建议在 BFF 侧先补一个只读聚合视图，而不是一上来大改所有执行链路。

建议新增只读接口：

- GET /api/projects/:projectId/orchestration-view

返回结构建议包含：

- currentTemplate
- effectiveStages
- stageRoleMatrix
- effectiveRoleBindings
- warnings

其中 `stageRoleMatrix` 每项至少包含：

- stageKey
- primaryRole
- participants
- gateEvaluators
- approvalOwners
- triggerPolicy
- executionMode
- bindingResolution
- outputActions
- configSource

这一层可以先由 BFF 聚合：

- workflow template
- workflow template stages
- role execution view
- role bindings

先解决“看得懂”，再推进“跑得真”。

## 11. 执行链路的后续演进顺序

建议分三步走。

### 第一步：先补解释层

目标：让页面能够回答“谁在什么时候怎么介入”。

本阶段只需要：

- orchestration-view 聚合接口
- 新的项目“介入编排”页
- 任务详情中的 planned vs actual 对照

### 第二步：再补真实阶段推进器

目标：让 workflow 不再主要依赖初始化和终态同步。

需要补：

- 真正的 stage advancement service
- gate evaluation hook
- approval transition
- failure fallback transition

### 第三步：最后补角色聚合执行器

目标：让角色介入从“数据模型”变成“真实编排能力”。

对应落地就是实现文档里已有但还未落源码的模块：

- role-aggregation executor
- conflict resolver
- normalizer
- policy resolver
- task strategy store

## 12. 最终判断

如果问题是：

“当前 角色执行 与 工作流 两个功能，是否已经实现当初设计的目的？”

答案是：

**还没有完全实现。现在已经实现了配置管理和部分运行结果展示，但还没有实现最关键的‘可解释编排’和‘真实阶段驱动角色介入’。**

如果问题是：

“两者之间的关系是什么？”

答案是：

**工作流定义流程骨架，角色执行定义角色能力与执行器，真正缺的是两者之间的阶段角色介入矩阵。**

如果问题是：

“能否重新设计？”

答案是：

**可以，而且应该重设计；但重点不是把两个页面再塞更多字段，而是补一层新的‘介入编排视图’，把配置、计划、实际执行这三件事分开表达。**