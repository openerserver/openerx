# 项目角色执行配置页重设计方案

> 当前状态：已按本方案完成第一阶段实现，页面与接口已拆分，测试已覆盖核心回归。

## 0. 实施状态

截至 2026-03-15，以下内容已经落地，不再只是规划：

- 项目设置中的审批策略已正式拆出为独立页面，路由为 `/projects/:projectId/approval-policies`
- 旧路径 `/projects/:projectId/policies` 已保留为兼容跳转入口，并重定向到新的审批策略页面
- 角色执行已拆成独立页面，使用项目级聚合读接口，减少前端逐角色请求
- 任务详情页已明确拆分“项目角色配置”和“角色实际介入记录”，分别对应规则层与运行事实层
- BFF 已提供 `GET /api/projects/:projectId/role-execution-view` 聚合读模型
- 非管理员读取项目级 override 返回 403 时，页面会回退展示平台默认角色配置，而不是整页失败

### 0.1 已实现文件对应

- 审批策略页：[control-plane/web-ui/src/pages/ProjectPolicies.vue](control-plane/web-ui/src/pages/ProjectPolicies.vue)
- 角色执行页：[control-plane/web-ui/src/pages/ProjectRoleExecution.vue](control-plane/web-ui/src/pages/ProjectRoleExecution.vue)
- 项目基础设置面板：[control-plane/web-ui/src/components/ProjectSettingsPanel.vue](control-plane/web-ui/src/components/ProjectSettingsPanel.vue)
- 任务详情规则面板：[control-plane/web-ui/src/components/TaskProjectRoleConfigPanel.vue](control-plane/web-ui/src/components/TaskProjectRoleConfigPanel.vue)
- 任务详情运行事实面板：[control-plane/web-ui/src/components/TaskRoleWorkflowPanel.vue](control-plane/web-ui/src/components/TaskRoleWorkflowPanel.vue)
- 聚合接口路由：[control-plane/web-ui-bff/src/modules/projects/routes.ts](control-plane/web-ui-bff/src/modules/projects/routes.ts)

### 0.2 已补测试覆盖点

- 前端路由兼容跳转回归：[tests/web-ui/router.test.ts](tests/web-ui/router.test.ts)
- 审批策略页回归：[tests/web-ui/ProjectPolicies.test.ts](tests/web-ui/ProjectPolicies.test.ts)
- 角色执行页回归：[tests/web-ui/ProjectRoleExecution.test.ts](tests/web-ui/ProjectRoleExecution.test.ts)
- 任务详情“规则/事实”拆分回归：[tests/web-ui/TaskDetail.test.ts](tests/web-ui/TaskDetail.test.ts)
- Dashboard 入口联动回归：[tests/web-ui/Dashboard.test.ts](tests/web-ui/Dashboard.test.ts)
- BFF 聚合接口 403 回退 / 404 / 502 分支回归：[tests/web-ui-bff/project-role-execution-route.test.ts](tests/web-ui-bff/project-role-execution-route.test.ts)

### 0.3 当前验证结论

- 前端全量测试已通过：14 个文件，121 个用例
- BFF 聚合接口定向测试已通过，覆盖 403 回退、404 透传、非 403 上游异常转 502

> 适用范围：OpenerX 项目详情 / 项目审批策略页 / 角色执行配置管理
>
> 目标：把当前“项目审批策略 + 角色 override + binding 管理”改造成普通用户也能理解的配置体验，让用户回答三个问题：
>
> - 这个项目会用到哪些角色
> - 每个角色现在由谁执行
> - 我要改的是“继承默认”、“补充执行器”还是“完全接管”

## 1. 问题判断

当前实现从工程角度是可用的，但从用户视角几乎不可理解。

主要问题不是缺少说明，而是信息架构本身不符合用户心智。

### 1.1 当前页面把三件事混在一起

当前页面同时放了：

- 项目审批策略模板
- 环境级审批绑定
- 项目级角色覆盖
- 角色 binding 管理

这四类配置属于两套完全不同的概念：

- 一套是审批策略
- 一套是角色执行配置

用户打开“策略”页时，并不会自然想到“这里还能配置角色执行器”。

### 1.2 页面术语偏实现，不偏业务

当前页面直接暴露了很多内部术语：

- override
- binding
- inherit
- replace
- permissionProfile
- toolProfile
- aggregationStrategy

这些词对研发人员都不一定直观，更不用说项目管理员。

### 1.3 关键动作是两段式保存，但没有被明确表达

当前实际操作是：

1. 先保存 binding
2. 再保存 role override

这在实现上合理，但在产品体验上不成立。用户会自然认为“我在一个抽屉里改的内容，点一次保存就应该整体生效”。

### 1.4 用户最关心的问题没有被直接回答

用户真正关心的是：

- 这个角色现在是不是平台默认
- 这个项目有没有自己专属执行器
- 如果切成 replace，会不会把默认执行器全部断掉
- 当前实际生效的是哪几个执行器

而当前页面主要展示的是字段级覆盖，等于先给用户看实现细节，再让用户自己推导业务结果。

## 2. 重设计目标

新的设计必须满足以下目标：

1. 用户不需要理解 override 和 binding 的底层模型，也能完成配置。
2. 用户先看到“当前生效状态”，再进入编辑。
3. 用户只需要做三种决策：沿用默认、补充项目执行器、项目完全接管。
4. 高风险操作必须有明确后果提示，尤其是 replace。
5. 编辑体验应改成单次提交，而不是“先存 binding 再存 override”的隐式两阶段交互。

## 3. 新的用户心智模型

不要把这一页定义为“策略页里的高级配置区”，而要定义为：

**项目执行配置**。

用户应该能用一句话理解它：

“在这里决定项目里的每个角色由谁来执行，是继续用平台默认，还是给项目单独配执行器。”

因此用户心智应从以下顺序理解：

1. 角色是什么
2. 当前由谁执行
3. 当前项目是否做了定制
4. 如果要改，改的是哪一种模式

而不是：

1. 先理解 override
2. 再理解 binding
3. 再理解 bindingMode
4. 最后自己猜当前真实执行结果

## 4. 新信息架构

建议把当前项目详情下的“策略”拆成两个页签。

### 4.1 一级导航重命名

当前：

- 策略

建议改为：

- 审批策略
- 角色执行

说明：

- “审批策略”只放审批模板和环境审批绑定
- “角色执行”只放角色配置与执行器管理

这样用户不会在同一个页面里同时处理两套完全不同的模型。

### 4.2 新的“角色执行”页结构

页面分为三层。

#### A. 顶部总览卡

展示 4 个摘要指标：

- 平台默认角色数
- 已做项目定制的角色数
- 项目完全接管的角色数
- 存在风险提示的角色数

目标：让用户先知道项目有没有“偏离默认”。

#### B. 角色列表主表（项目页）

每一行代表一个角色，不再先展示底层字段，而是先展示“业务结果”。

推荐列：

- 角色
- 当前模式
- 当前执行器
- 适用阶段
- 风险等级
- 项目定制摘要
- 操作

列解释：

- 当前模式：
  - 平台默认
  - 项目增强
  - 项目接管
- 当前执行器：直接显示当前实际会参与执行的执行器数量和名称摘要
- 项目定制摘要：例如“新增 1 个执行器，未改字段”或“改名 + release 阶段专用”

#### C. 角色配置抽屉

打开某个角色后，抽屉不要再按“字段类型”组织，而要按“任务步骤”组织。

建议分为 4 个区块。

## 5. 新抽屉交互

### 5.1 第一步：选择配置模式

把当前的 `inherit / replace` 改成用户语言。

建议文案：

- 沿用平台默认
- 补充项目执行器
- 项目完全接管

对应关系：

- 沿用平台默认 = 没有 override 且没有项目执行器
- 补充项目执行器 = `bindingsMode = inherit`
- 项目完全接管 = `bindingsMode = replace`

每个选项都要配结果解释：

- 沿用平台默认：使用平台为该角色配置的执行器，项目不单独修改
- 补充项目执行器：保留平台默认执行器，同时增加项目专属执行器
- 项目完全接管：只使用项目专属执行器，平台默认执行器不再参与

### 5.2 第二步：设置当前实际执行器

把 “Binding 配置” 改成 “执行器列表”。

左侧不再叫“系统默认 bindings”，改成：

- 平台默认执行器

右侧不再叫“项目级 bindings”，改成：

- 项目专属执行器

每个执行器卡片展示：

- 显示名称
- runtime agent
- model
- priority
- enabled 状态
- 来源：平台默认 / 项目专属

当用户选择“项目完全接管”且项目专属执行器为空时，给出强提示：

“当前角色已切换为项目完全接管，但你还没有配置项目专属执行器。保存后，这个角色在本项目中将无法执行。”

### 5.3 第三步：可选高级定制

当前抽屉里的字段太多，不应默认全部展开。

建议把这些字段折叠到“高级定制”区：

- 名称
- 描述
- 状态
- owner team
- permission profile
- tool profile
- execution mode
- aggregation strategy
- max active bindings
- require consensus
- risk level
- requires approval for write
- allowed stages
- output schema id
- tags

默认只展示两个最常用字段：

- 显示名称
- 适用阶段

其余放到“展开高级定制”后再编辑。

### 5.4 第四步：统一提交

抽屉底部不再出现“保存 binding”和“保存项目级覆盖”两个概念层次。

新的交互应该是：

- 取消
- 预览变更
- 保存并应用

具体实现可以继续用现有后端接口分两次写入，但前端必须把它包装成一次提交。

用户不应该承担“先保存哪个对象”的负担。

## 6. 用户文案替换表

建议把底层术语换成面向业务的名称。

| 当前术语 | 建议显示名 | 说明 |
| --- | --- | --- |
| override | 项目定制 | 避免技术味太重 |
| binding | 执行器 | 用户更容易理解 |
| system binding | 平台默认执行器 | 明确来源 |
| project binding | 项目专属执行器 | 明确归属 |
| inherit | 补充项目执行器 | 直接表达结果 |
| replace | 项目完全接管 | 直接表达后果 |
| role override | 角色项目定制 | 更贴近业务 |

说明：

内部 API 和数据库仍可保留原字段名，不需要为了文案去改模型层。

## 7. 三条标准用户流程

### 7.1 流程一：只是看当前配置

用户进入“角色执行”页，直接看到：

- 哪些角色沿用平台默认
- 哪些角色做了项目增强
- 哪些角色被项目完全接管
- 每个角色当前实际使用哪些执行器

这条路径不需要打开抽屉就应该成立。

### 7.2 流程二：给角色补一个项目专属执行器

目标：保留平台默认，再多加一个项目执行器。

用户步骤：

1. 打开角色配置
2. 选择“补充项目执行器”
3. 在“项目专属执行器”里点“新增执行器”
4. 填写名称、运行时执行器、模型和优先级
5. 点“保存并应用”

结果预期：

- 角色列表中的“当前模式”变成“项目增强”
- 当前执行器列同时显示平台默认和项目专属执行器

### 7.3 流程三：项目完全接管某个角色

目标：这个角色不再用平台默认执行器，只用项目自己的执行器。

用户步骤：

1. 打开角色配置
2. 选择“项目完全接管”
3. 新增至少一个项目专属执行器
4. 确认风险提示
5. 点“保存并应用”

结果预期：

- 角色列表中的“当前模式”显示“项目接管”
- 当前执行器列只展示项目专属执行器

## 8. 建议的视觉结构

### 8.1 列表层级

建议把角色列表做成卡表混合视图。

每行至少要让用户一眼看到：

- 当前模式标签
- 实际生效执行器数量
- 是否有高风险改动

例如：

- 产品 Agent | 平台默认 | 1 个执行器 | intake / plan | 低风险
- 安全 Agent | 项目增强 | 平台 2 + 项目 1 | verify / release | 高风险
- 发布 Agent | 项目接管 | 项目 1 | release | 高风险

### 8.2 危险操作显式化

对于“项目完全接管”，建议用橙色或红色风格提示，而不是和普通字段放在一起。

### 8.3 把“当前结果”放在“编辑字段”前面

抽屉顶部建议先展示“当前生效结果摘要”，例如：

- 当前模式：项目接管
- 当前执行器：项目产品主执行器
- 平台默认执行器：不参与
- 适用阶段：intake / clarify / plan

用户先确认结果，再决定要不要继续改高级字段。

## 9. 对当前实现的具体改造建议

### 9.1 页面拆分

角色执行配置页已从当前 [control-plane/web-ui/src/pages/ProjectPolicies.vue](control-plane/web-ui/src/pages/ProjectPolicies.vue) 的混合职责中拆出。

建议新建页面：

- 项目审批策略页：继续承载当前审批模板和环境绑定
- 项目角色执行页：只承载角色配置和执行器管理

### 9.2 BFF 提供更贴近页面的聚合读模型

当前前端需要自己拼：

- system role
- project override
- system bindings
- project bindings

建议 BFF 提供一个面向页面的聚合接口，例如：

```ts
GET /api/projects/:projectId/role-execution-view
```

返回结构按页面所需直接给出：

```ts
interface ProjectRoleExecutionRow {
  roleAgentId: string;
  roleLabel: string;
  mode: "platform-default" | "project-extend" | "project-takeover";
  effectiveBindings: Array<{
    id: string;
    label: string;
    runtimeAgent: string;
    model?: string | null;
    source: "system" | "project";
  }>;
  systemBindings: Array<...>;
  projectBindings: Array<...>;
  customizationSummary: string;
  riskLevel: string;
  allowedStages: string[];
}
```

这样页面渲染的是用户结果，不是内部拼装过程。

### 9.3 把提交改成前端单事务体验

虽然底层仍然可以：

- 先写 project bindings
- 再写 role override

但前端应在一次“保存并应用”里统一处理：

- 校验
- 批量提交
- 汇总报错
- 成功后刷新整行视图

### 9.4 默认隐藏高级字段

当前一打开抽屉就是大量专业字段，对大多数用户是噪音。

应改成：

- 默认展示模式和执行器
- 高级字段折叠
- 只有管理员或高级用户才主动展开

## 10. 分阶段落地建议

### 阶段一：不改接口，先改页面信息架构

最小改造：

- 拆出“角色执行”页签
- 文案替换
- 表格字段改成结果导向
- 抽屉分步骤展示

### 阶段二：把保存动作改成一次提交

前端封装：

- 新增执行器
- 更新执行器
- 更新 role override

统一成一个保存动作。

### 阶段三：BFF 聚合读模型

减少前端自己拼装 system/project 数据，避免页面状态复杂度继续上升。

### 阶段四：补齐删除能力和审计视图

补充：

- 删除项目专属执行器
- 重置角色项目定制
- 查看变更历史 / 审计记录

## 11. 角色如何介入当前项目运行

上面的设计主要解决“怎么配置角色”。

但用户真正还会继续问一个更关键的问题：

**这些角色配置好以后，究竟会怎么介入当前项目的实际运行？**

这部分如果不说清楚，用户仍然会觉得“我只是换了几个执行器名字，不知道这些角色会在什么时候出现、会做什么、会不会拦住任务”。

因此新的方案必须把“角色执行配置”与“角色运行介入”明确连接起来。

### 11.1 角色配置页不只是配置执行器，还要说明角色权力

在“角色执行”页中，每个角色不应该只显示：

- 当前模式
- 当前执行器
- 当前阶段

还要额外显示一列：

- 运行介入方式

这一列用用户语言说明该角色在项目运行中能做什么，例如：

- 只提供建议
- 可发起修正请求
- 可阻断阶段推进
- 可请求审批
- 可要求人工接管

这样用户在项目层面就能先看到：

“这个角色不只是一个名字，它会在任务跑到某些阶段时产生什么影响。”

### 11.2 角色介入不是全天候抢控制权，而是按阶段触发

用户不需要看到“所有角色始终在线”。

正确的解释方式应是：

- 不同角色只在自己负责的阶段介入
- 介入方式由角色能力和项目配置共同决定
- 介入结果会沉淀为可见的结论、请求、阻断或审批动作

也就是说，角色不是一直在后台“神秘发挥作用”，而是在命中阶段和条件时产生明确动作。

### 11.3 建议的角色介入矩阵

下面这张表应该体现在产品设计里，至少要能在详情页和帮助文案中解释清楚。

| 角色 | 主要介入阶段 | 默认介入方式 | 是否可阻断 | 是否可请求审批 | 是否可直接改主代码 |
| --- | --- | --- | --- | --- | --- |
| 产品 | intake / clarify | 提需求结论、补充验收标准、指出范围遗漏 | 可阻断进入实现 | 否 | 否 |
| 架构师 | clarify / design / plan | 提方案结论、指出边界问题、要求补设计 | 可阻断进入实现 | 否 | 否 |
| 开发者 | implement / fix | 执行代码修改、响应修正请求、重新提交结果 | 否 | 否 | 是 |
| 美术 | design / review | 提视觉与交互修正意见 | 默认不阻断，可配置为需确认 | 否 | 否 |
| 安全 | design / implement / verify / release | 提安全 findings、要求加固、判定高风险 | 是 | 是 | 否 |
| QA | verify / release | 提测试结论、发起回归请求、判定是否可发布 | 是 | 可选 | 否 |
| 部署 | release | 检查发布条件、环境准备、回滚预案 | 是 | 是 | 否 |
| 运维 | post-release / retrospective | 检查监控、异常、回滚条件、恢复动作 | 是 | 可选 | 否 |

这张表表达一个关键原则：

**除开发者角色外，其他角色的主要介入方式不是直接改代码，而是提出结论、修正请求、阻断或审批建议。**

### 11.4 用户应看到的五种介入结果

对于普通用户，不需要暴露底层 runtime event，而应统一看到五种结果。

#### A. 角色结论

表示某个角色在当前阶段给出的总体判断。

例如：

- 安全：发现高风险凭证暴露
- QA：当前回归未通过
- 架构师：设计缺少 BFF 边界说明

#### B. 修正请求

表示某个角色已经把问题转成了对开发者的明确待办。

例如：

- 安全要求补充密钥隔离
- QA 要求修复失败用例再重新验证
- 架构师要求先补 API 契约再继续实现

#### C. 阶段阻断

表示任务不能继续进入下一阶段。

例如：

- 产品未确认需求边界，不允许进入实现
- 安全给出 blocking 结论，不允许进入发布
- QA 未通过，不允许进入 release

#### D. 审批请求

表示某个角色认为风险已经超出自动放行范围，需要项目管理员或审批人确认。

例如：

- 安全要求高风险写操作审批
- 部署要求生产发布审批
- 运维要求人工确认回滚窗口

#### E. 人工接管 / 人工复核

表示系统不再自动推进，需要人来判断。

例如：

- 同角色多 Agent 结论冲突
- 安全与部署意见相互矛盾
- 运行时出现异常，需要管理员人工接管

### 11.5 用户在项目页应该看到什么

项目级页面不应试图展示单个任务的所有运行细节，而应展示“这个项目的角色运行规则”。

因此在“角色执行”列表中，每个角色建议增加一个“运行介入”摘要块，至少显示：

- 介入阶段
- 介入方式
- 是否可阻断
- 是否可请求审批

示例文案：

- 安全 Agent：在 implement / verify / release 阶段介入，可发起修正请求、阻断高风险推进，并请求审批
- QA Agent：在 verify / release 阶段介入，可要求开发者修复并阻断发布
- 运维 Agent：在 post-release 阶段介入，可要求人工复核并阻断继续放量

这样用户在项目配置层就知道“配完以后会发生什么”。

### 11.6 用户在任务运行页应该看到什么

真正展示“角色已经介入当前任务”的地方，不应是项目配置页，而应是任务详情页 / 工作台。

建议任务运行页明确展示以下内容：

#### A. 当前阶段横幅

显示：

- 当前阶段
- 当前主责角色
- 是否被阻断
- 是否等待审批
- 有几条待处理修正请求

#### B. 当前已介入角色列表

显示：

- 哪些角色已经给出结论
- 哪些角色提出了修正请求
- 哪些角色要求审批
- 哪些角色阻断了继续推进

#### C. 开发者待处理项

给开发者一个聚合视图：

- 来源角色
- 问题标题
- 是否阻断
- 当前状态

#### D. 审批与人工接管状态

如果任务已被角色触发审批或人工复核，则应在任务页顶部高亮，而不是埋在日志里。

### 11.7 新设计里需要新增的用户问题回答框

为了让用户真正看懂，页面中至少要有一块固定回答下面几个问题：

- 这个角色在什么阶段会出现？
- 它出现后能做什么？
- 它只能提建议，还是能拦住任务？
- 它能不能触发审批？
- 它提出的问题最后由谁来改？

建议在角色抽屉顶部增加“运行影响”卡片，直接展示：

- 介入阶段：implement / verify / release
- 默认动作：提出修正请求
- 高风险时：可阻断 + 请求审批
- 最终执行修改者：开发者角色

### 11.8 需要在产品层明确的一条原则

新的方案必须明确写出：

**角色执行配置决定的是“谁来参与”和“谁有介入权”，不是所有角色都会直接改动当前项目代码。**

用户看到的不是“8 个角色一起写代码”，而是：

- 部分角色负责提出结论
- 部分角色负责提出修正要求
- 部分角色负责放行、阻断或审批建议
- 只有开发者角色负责执行主代码修改

这一点如果不显式写出来，用户会自然误解成“所有角色都在直接操作项目”。

## 12. 页面级落地建议补充

基于上面的运行介入模型，页面方案还应补三个落地点。

### 12.1 项目页新增一列：运行影响

每个角色行新增：

- 介入阶段摘要
- 是否可阻断
- 是否可审批

### 12.2 抽屉顶部新增：运行影响卡片

卡片内容：

- 该角色会在什么阶段介入
- 该角色会产出什么
- 该角色能否阻断 / 审批
- 它的问题由谁处理

### 12.3 任务页新增：角色介入轨迹

让用户在单个任务中看到：

- 哪个角色何时介入
- 产出了什么结论
- 是否创建了修正请求
- 是否触发了阻断或审批

## 13. 页面草图建议

为了让这份方案不只停留在原则层，下面给出建议的页面草图结构。

目标不是定义最终视觉稿，而是把页面骨架、信息顺序和用户视线流固定下来。

### 13.1 项目页草图：角色执行

建议页面标题：

- 项目角色执行

建议副标题：

- 配置当前项目中各角色由谁执行，以及它们会如何介入任务推进

推荐结构如下：

```text
┌──────────────────────────────────────────────────────────────┐
│ Default Project / 角色执行                                   │
│ 配置当前项目中各角色由谁执行，以及它们会如何介入任务推进      │
├──────────────────────────────────────────────────────────────┤
│ [平台默认角色 8] [项目已定制 3] [项目接管 1] [高风险 2]       │
├──────────────────────────────────────────────────────────────┤
│ 搜索角色 [________]   模式筛选 [全部▼]   风险筛选 [全部▼]      │
├──────────────────────────────────────────────────────────────┤
│ 角色        当前模式   当前执行器      运行影响        操作     │
│ 产品 Agent  平台默认   平台 1 个       clarify 阶段    查看/编辑│
│                                 只提结论，可阻断入实现         │
│                                                              │
│ 安全 Agent  项目增强   平台 2 + 项目 1  verify/release 查看/编辑│
│                                 可提修正、可阻断、可审批       │
│                                                              │
│ 发布 Agent  项目接管   项目 1 个       release 阶段    查看/编辑│
│                                 可阻断上线、可发起审批         │
└──────────────────────────────────────────────────────────────┘
```

这张表的关键不在于字段多，而在于让用户第一眼就读懂三件事：

- 当前由谁执行
- 这个角色会不会拦住任务
- 现在这个项目是不是偏离了平台默认

### 13.2 项目页抽屉草图：角色执行配置

角色抽屉建议分成 5 个视觉区。

```text
┌──────────────────────── 产品 Agent / 项目配置 ────────────────────────┐
│ 当前生效结果                                                         │
│ 模式：项目增强                                                       │
│ 当前执行器：平台 1 个 + 项目 1 个                                    │
│ 适用阶段：intake / clarify / plan                                    │
│                                                                      │
│ 运行影响                                                             │
│ 在 clarify / plan 阶段介入                                           │
│ 默认输出：需求结论 / 修正建议                                        │
│ 可阻断：是                                                           │
│ 可审批：否                                                           │
│ 最终修改执行者：开发者角色                                           │
├──────────────────────────────────────────────────────────────────────┤
│ 1. 选择配置模式                                                      │
│ ( ) 沿用平台默认                                                     │
│ (●) 补充项目执行器                                                   │
│ ( ) 项目完全接管                                                     │
├──────────────────────────────────────────────────────────────────────┤
│ 2. 当前执行器                                                        │
│ 平台默认执行器                                                       │
│ - 产品 A | prometheus-enterprise | priority 1                        │
│                                                                      │
│ 项目专属执行器                                                       │
│ - 项目产品主执行器 | planner-project | gpt-5.4 | priority 1         │
│ [新增执行器]                                                         │
├──────────────────────────────────────────────────────────────────────┤
│ 3. 常用定制                                                          │
│ 显示名称 [________________]                                          │
│ 适用阶段 [ intake, clarify, plan ]                                   │
├──────────────────────────────────────────────────────────────────────┤
│ 4. 高级定制 [展开]                                                   │
├──────────────────────────────────────────────────────────────────────┤
│ [取消] [预览变更] [保存并应用]                                       │
└──────────────────────────────────────────────────────────────────────┘
```

用户读这个抽屉时，视线顺序应该是：

1. 先看当前结果
2. 再看运行影响
3. 再决定要不要改模式
4. 再改执行器
5. 最后才进入高级字段

### 13.3 任务页草图：角色如何介入当前任务

真正回答“这个角色现在怎么干预当前项目运行”的主战场，应放在任务页。

推荐在任务详情 / 工作台增加如下结构：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 任务：修复发布前权限泄露问题                                         │
│ 当前阶段：verify    主责角色：QA    状态：已阻断                     │
│ 2 条待处理修正请求 · 1 个审批待处理                                  │
├──────────────────────────────────────────────────────────────────────┤
│ 中栏：会话与执行流                                                   │
│                                                                      │
│ 右栏：角色介入                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 已介入角色                                                      │ │
│ │ 安全 Agent   结论：高风险配置暴露   动作：阻断 + 请求审批       │ │
│ │ QA Agent     结论：回归失败             动作：发起修正请求       │ │
│ │ 部署 Agent   结论：发布条件不满足       动作：等待修复后复查     │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ 开发者待处理项                                                  │ │
│ │ [阻断] 修复 secrets 输出到日志                                   │ │
│ │ [阻断] 修复回归用例 test-release-guard                           │ │
│ ├──────────────────────────────────────────────────────────────────┤ │
│ │ 审批与人工接管                                                  │ │
│ │ 安全角色已请求生产前审批，等待项目管理员确认                     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

这里有一个关键设计原则：

任务页展示的是“角色已经做了什么”，不是“角色能做什么”。

项目页回答规则。

任务页回答事实。

### 13.4 项目页与任务页的分工

这两类页面的边界必须非常清楚。

#### 项目页回答：规则

- 这个角色会在哪些阶段介入
- 这个角色能否阻断
- 这个角色能否请求审批
- 当前项目给它配置了哪些执行器

#### 任务页回答：事实

- 这个角色是否已经介入当前任务
- 它给出了什么结论
- 它有没有发起修正请求
- 它是否真的阻断了当前任务
- 它是否真的触发了审批

如果项目页和任务页不这样拆开，用户就会继续混淆“潜在能力”和“已发生事件”。

## 14. 一条完整运行示例

为了让“角色如何干预当前项目运行”更具体，下面给出一个完整例子。

### 14.1 示例前提

项目里有如下角色配置：

- 产品：平台默认
- 架构师：平台默认
- 开发者：平台默认
- 安全：项目增强，额外挂了一个项目专属安全执行器
- QA：平台默认
- 部署：项目接管，只使用项目自己的发布执行器

### 14.2 任务开始

用户创建任务：

- 修复生产环境登录失败并准备热修发布

系统按阶段推进：

1. 产品角色在 clarify 阶段介入，补充验收标准
2. 架构师在 design 阶段介入，要求明确 BFF 和 service 边界
3. 开发者进入 implement 阶段执行代码修改

### 14.3 安全角色介入

任务进入 verify 阶段后，安全角色开始检查：

- 平台默认安全执行器给出一条中风险建议
- 项目专属安全执行器给出一条高风险 finding：日志中暴露 token

聚合后，安全角色形成结论：

- 结论：需要开发者修复
- 动作：阻断进入 release
- 附加动作：对生产热修发布请求审批

此时用户在任务页中看到：

- 安全角色已介入
- 当前任务被阻断
- 已新增一条审批请求

### 14.4 QA 角色介入

同一阶段 QA 发现回归失败，生成开发者修正请求：

- 修复 test-login-retry
- 重新执行 release regression

此时用户看到的不是“QA agent 在后台跑了什么模型”，而是：

- QA 已介入
- 提出了 2 条开发者待处理项
- 当前 release 不能继续推进

### 14.5 开发者处理后重新推进

开发者完成修复后重新提交结果：

- 安全复核通过
- QA 回归通过
- 部署角色检查发布条件

由于部署角色在当前项目中使用的是“项目接管”执行器，所以最终发布检查由项目自己的部署执行器完成。

这时用户能够理解：

- 为什么项目级角色执行配置会影响运行结果
- 为什么某些角色能阻断、有些角色只能提建议
- 为什么最终真正动代码的是开发者角色

## 15. 对用户解释这套系统时的推荐表述

如果要给普通用户一句话解释这套机制，建议不要再说：

- 你可以配置 override 和 binding

而应改成：

- 你可以为项目配置不同角色的执行方式，并决定它们在任务运行中如何介入

如果要再展开一层，可以用下面这段固定说明：

> 每个角色都有自己的职责和介入阶段。你在项目里配置的不是抽象字段，而是：这个角色由谁执行、它会在什么时候出现、它只能提建议还是能阻断任务、以及它是否能发起审批。开发者角色负责真正修改代码，其他角色负责评审、修正、放行和治理。

## 16. 这些角色如何设置与调整

前面已经回答了“角色会如何介入运行”。

但用户还会继续问另一个很实际的问题：

**这些角色到底在哪里配？平时怎么调？谁能调？调完会影响什么？**

这一部分如果不明确，系统仍然会给人一种“角色很多，但不知道从哪里下手”的感觉。

### 16.1 先明确三层配置边界

角色相关设置不应混成一个入口，而应分成三层。

#### A. 平台层：定义角色是什么

平台层负责定义角色的基础规则。

这层由组织管理员 / 平台管理员维护，主要配置：

- 角色是否存在
- 角色默认职责
- 默认介入阶段
- 默认风险等级
- 默认权限边界
- 默认执行模式
- 默认平台执行器

这一层回答的是：

“系统里有哪些标准角色，以及它们默认长什么样。”

#### B. 项目层：决定当前项目怎么用这些角色

项目层负责决定某个项目是否沿用平台默认，还是做项目定制。

这层是项目配置页要重点承载的内容，主要配置：

- 当前项目是否启用这个角色
- 当前项目是沿用默认 / 补充执行器 / 完全接管
- 当前项目要不要增加项目专属执行器
- 当前项目要不要改角色显示名和适用阶段

这一层回答的是：

“在这个项目里，这个角色到底怎么运行。”

#### C. 任务层：记录这次任务中角色实际怎么介入

任务层不负责长期配置，而负责展示实际运行结果。

这层主要展示：

- 哪些角色已经介入
- 给出了什么结论
- 发起了哪些修正请求
- 是否阻断 / 审批 / 人工接管

这一层回答的是：

“这次任务里，角色到底做了什么。”

### 16.2 用户应该在哪个页面做什么调整

为了避免用户在错误的地方做错误的事，页面职责应该明确如下。

#### 平台管理员入口：角色注册表 / 角色治理页

适合做的事：

- 新增一个标准角色
- 停用一个角色
- 修改角色默认风险等级
- 修改默认介入阶段
- 修改默认平台执行器
- 调整权限 / 工具边界

不适合做的事：

- 面向单个项目加一个临时执行器
- 为某个任务临时切换角色行为

#### 项目管理员入口：项目角色执行页

适合做的事：

- 决定项目是否沿用平台默认
- 给当前项目补一个专属执行器
- 把某个角色切成项目完全接管
- 调整当前项目里角色的显示名或适用阶段

不适合做的事：

- 改平台默认角色定义
- 改其他项目的角色行为
- 直接处理某条任务的阻断结果

#### 任务负责人 / 开发者入口：任务详情页

适合做的事：

- 看当前有哪些角色已经介入
- 看哪些问题需要修
- 看当前是不是被阻断或等待审批
- 修完后继续推进任务

不适合做的事：

- 在任务页里修改项目长期配置
- 临时把一个角色永久改成别的执行模式

### 16.3 建议的角色调整动作清单

从用户角度，日常会发生的调整其实只有 6 类。

如果页面围绕这 6 类动作设计，复杂度会降很多。

#### 动作一：启用 / 停用一个角色

含义：

- 这个项目是否需要该角色参与工作流

典型场景：

- 小型项目不需要美术角色
- 内部工具项目不需要部署角色

建议交互：

- 在角色列表中直接提供启用开关
- 停用高风险角色时要求确认原因

#### 动作二：沿用平台默认

含义：

- 项目不做额外定制，完全使用平台定义

典型场景：

- 新项目先用标准模板启动

建议交互：

- 列表中显示“平台默认”标签
- 抽屉中一键“恢复平台默认”

#### 动作三：补充项目执行器

含义：

- 保留平台默认执行器，同时增加项目自己的执行器

典型场景：

- 项目想增加一个专门懂业务上下文的安全执行器
- 项目想给发布角色接一个专门的 runtime agent

建议交互：

- 用户只做两步：新增执行器，保存并应用

#### 动作四：项目完全接管

含义：

- 当前项目不再使用平台默认执行器，只用项目自己的执行器

典型场景：

- 某些项目要走专属发布链路
- 某些项目必须使用隔离的安全执行器

建议交互：

- 切换时明确提示后果
- 若项目专属执行器为空，禁止直接保存或给出强确认

#### 动作五：调整角色的项目展示与阶段范围

含义：

- 不改平台定义，只改当前项目里的名称、说明、阶段边界

典型场景：

- 把“部署 Agent”在当前项目中重命名为“上线守卫”
- 某项目只允许安全角色在 release 阶段介入

建议交互：

- 放在“常用定制”区
- 只暴露最常用字段，不要默认展示全部高级配置

#### 动作六：恢复默认 / 撤销项目定制

含义：

- 删除项目层的特殊配置，回到平台默认行为

典型场景：

- 项目试验结束，不再需要专属执行器
- 临时接管完成后恢复标准流程

建议交互：

- 提供“恢复平台默认”动作
- 展示恢复后会丢失哪些项目专属配置

### 16.4 谁可以调整什么

权限边界必须写得非常明确。

建议按下面的层次控制。

| 操作 | 普通成员 | 项目管理员 | 组织/平台管理员 |
| --- | --- | --- | --- |
| 查看角色运行规则 | 可查看 | 可查看 | 可查看 |
| 查看任务中角色介入事实 | 可查看相关任务 | 可查看项目内任务 | 可查看 |
| 调整项目是否启用角色 | 否 | 可 | 可 |
| 调整项目执行器 | 否 | 可 | 可 |
| 切换项目完全接管 | 否 | 可，需确认 | 可 |
| 修改平台默认角色 | 否 | 否 | 可 |
| 修改角色权限边界 | 否 | 否 | 可 |
| 处理审批 / 人工接管 | 否 | 视审批策略而定 | 可 |

### 16.5 一次调整后，系统应该告诉用户什么

用户做完调整后，系统不应只弹一句“保存成功”。

必须告诉用户这次调整会影响什么。

建议保存成功后返回一段结构化摘要：

- 影响角色：安全 Agent
- 当前模式：项目增强
- 当前执行器：平台 2 个 + 项目 1 个
- 介入阶段：verify / release
- 风险变化：保持 high
- 对新任务的影响：立即生效
- 对运行中任务的影响：下次进入对应阶段时生效 / 或仅新任务生效

这里尤其要说明最后一条。

用户最容易疑惑的是：

“我现在改了角色配置，会不会立刻影响已经在跑的任务？”

因此方案里必须明确一个规则。

### 16.6 建议的生效规则

建议默认规则如下：

- 项目角色配置对新创建任务立即生效
- 对已在运行中的任务，默认在下一阶段进入前重新解析
- 若角色已经在当前阶段完成介入，不回滚既有结论

这样用户能理解：

- 这是一个“阶段边界生效”的系统
- 不是改完后所有运行中的东西都瞬间重算

### 16.7 推荐的项目页操作引导文案

在“角色执行”页顶部，建议直接给一段短文案：

> 在这里配置当前项目中各角色如何参与任务推进。你可以沿用平台默认、补充项目专属执行器，或让项目完全接管某个角色。配置修改主要影响后续任务，以及运行中任务进入下一阶段后的角色解析结果。

在角色抽屉中，建议再给一段短文案：

> 你现在修改的是当前项目的角色运行规则，而不是某一次任务的临时结果。任务中的实际阻断、审批和修正请求，请到任务详情页查看。

## 17. 现有页面如何调整

新的方案出来以后，不能只画新蓝图，还要明确：

- 之前已经开发的页面哪些继续保留
- 哪些页面概念上已经错位
- 哪些内容要迁走
- 哪些入口要重命名或下线

否则结果会变成：

- 新方案写了一套
- 老页面继续存在
- 用户同时面对两套概念

这会比现在更混乱。

### 17.1 现有页面盘点

结合当前前端实现，和本次方案直接相关的存量页面主要有以下几个：

- [control-plane/web-ui/src/pages/ProjectDetail.vue](control-plane/web-ui/src/pages/ProjectDetail.vue)
- [control-plane/web-ui/src/components/ProjectSettingsPanel.vue](control-plane/web-ui/src/components/ProjectSettingsPanel.vue)
- [control-plane/web-ui/src/pages/ProjectPolicies.vue](control-plane/web-ui/src/pages/ProjectPolicies.vue)
- [control-plane/web-ui/src/router/index.ts](control-plane/web-ui/src/router/index.ts)

### 17.2 去留判断

#### A. ProjectDetail：保留，但页签语义要调整

[control-plane/web-ui/src/pages/ProjectDetail.vue](control-plane/web-ui/src/pages/ProjectDetail.vue) 本身不是错误页面。

它负责项目详情框架、项目基础信息和页签导航，这一层应该保留。

但它当前的问题是：

- 没有为“角色执行”提供独立页签
- 还把部分审批策略信息概览埋在 overview / settings 语义里

建议调整：

- 保留项目详情页作为容器
- 在项目维度新增独立“角色执行”入口
- 把“策略”拆成“审批策略”和“角色执行”两类入口，而不是继续混在一个页面下

结论：

- 保留
- 调整导航结构

#### B. ProjectSettingsPanel：保留，但只负责项目设置与审批策略摘要

[control-plane/web-ui/src/components/ProjectSettingsPanel.vue](control-plane/web-ui/src/components/ProjectSettingsPanel.vue) 当前主要承担：

- 默认模型
- 默认环境
- 审批策略
- 月预算
- 环境审批策略
- 跳转到审批策略页 / 角色执行页 / 成本页

这部分总体上是成立的，因为它属于“项目设置”和“审批策略摘要”。

但需要修正的地方是：

- 不能再把“跳转到策略页”当作同时进入审批和角色配置的总入口
- 文案上不能继续把“策略页”暗示成角色配置入口

建议调整：

- 保留该面板
- 快捷入口改成：
  - 跳转到审批策略页
  - 跳转到角色执行页
  - 跳转到成本页
- 当前绑定状态卡只保留审批与预算相关信息
- 不再在这里承载任何角色 override / binding 心智

结论：

- 保留
- 收敛职责

#### C. ProjectPolicies：不建议继续作为混合页存在

[control-plane/web-ui/src/pages/ProjectPolicies.vue](control-plane/web-ui/src/pages/ProjectPolicies.vue) 是当前概念错误最明显的页面。

它现在同时放了：

- 项目默认策略模板
- 环境级审批策略绑定
- 项目级角色覆盖
- 角色 binding 管理

这不是“功能太多”，而是“概念混页”。

从新方案看，这个页面不应该继续作为最终形态保留。

建议处理方式不是简单优化文案，而是拆分。

建议拆成两个页面：

1. 项目审批策略页
2. 项目角色执行页

其中：

- 审批策略页承接当前的策略模板列表、项目默认审批策略、环境审批覆盖
- 角色执行页承接当前的角色列表、项目定制、项目执行器管理

结论：

- 不保留为最终混合页
- 拆分迁移

#### D. 路由 ProjectPolicies：当前兼容重定向入口

[control-plane/web-ui/src/router/index.ts](control-plane/web-ui/src/router/index.ts) 当前仍保留：

- `projects/:projectId/policies`

这个路由当前用于兼容旧链接，会直接重定向到新的审批策略页，不再承担独立页面职责。

当前主入口已经拆分为：

- `projects/:projectId/approval-policies`
- `projects/:projectId/role-execution`

当前兼容策略：

- 保留旧路由做 redirect
- 所有新按钮和导航均指向新入口
- 后续是否彻底删除旧路由，仅取决于是否还需要兼容历史链接

结论：

- 保留兼容 redirect
- 不再作为功能页演进

### 17.3 具体迁移映射

为了避免拆分时丢功能，建议按下面的映射迁移。

#### 从 ProjectPolicies 迁去“审批策略页”的内容

应保留并迁移：

- 当前绑定摘要中的审批相关信息
- 策略模板列表
- 项目默认审批策略说明
- 环境级审批覆盖相关内容

应删除或不再出现在审批策略页中的内容：

- 项目级角色覆盖表格
- 角色执行器配置抽屉
- binding 模式切换

#### 从 ProjectPolicies 迁去“角色执行页”的内容

应保留并迁移：

- 角色列表
- 项目级角色定制
- 项目执行器管理
- replace / inherit 对应的新文案模式

应重构后再迁移：

- 当前抽屉中大量高级字段
- 当前的两段式保存交互
- 当前“系统默认 / 项目覆盖”列展示方式

#### 留在 ProjectSettingsPanel 的内容

继续保留：

- 默认模型
- 默认环境
- 月预算
- 审批策略摘要
- 环境审批覆盖摘要

不应继续出现：

- 角色执行相关解释文案
- “策略页 = 审批 + 角色配置”的总入口心智

### 17.4 对现有页面的调整动作建议（历史迁移记录）

下列动作已经完成，保留在这里用于说明当时的迁移路径。

#### 动作一：先改名称，再改结构

不要先上来大拆文件。

先做：

- 页面文案改名
- 快捷入口改名
- 用户不再看到“策略页”这个总称

这样可以先把错误心智止损。

#### 动作二：处理旧 ProjectPolicies 路由

实现结果不是保留过渡页，而是把旧路由直接重定向到新的审批策略页：

- 旧 `policies` 路由继续可访问
- 实际页面内容由新的审批策略页承接
- 用户不再停留在中间态页面上理解迁移关系

这样能更快收敛入口心智，也避免再维护一个纯过渡页面。

#### 动作三：先抽出“角色执行页”

优先级上，建议先把角色相关内容从 ProjectPolicies 中抽出来。

原因：

- 当前最难懂的就是角色配置这部分
- 它和审批策略的概念冲突最强

也就是说，第一刀应优先切角色，不是先切审批。

#### 动作四：ProjectSettingsPanel 更新快捷入口

在角色执行页抽出后，立刻同步修改 [control-plane/web-ui/src/components/ProjectSettingsPanel.vue](control-plane/web-ui/src/components/ProjectSettingsPanel.vue) 的快捷入口。

否则用户还是会被旧入口误导。

#### 动作五：路由切换到新路径

在新页面稳定后，再把：

- 导航
- 快捷按钮
- 面包屑

全部切到新路由。

旧路由只保留兼容跳转，不再承载真实内容。

### 17.5 哪些内容可以直接废弃

下面这些内容不建议继续保留原形态。

#### A. “策略页”作为总称

这是最应该废弃的旧概念。

原因：

- 它把审批与角色执行混成一类
- 用户会自然误以为“所有治理和执行配置都在这里”

#### B. 当前抽屉里的全字段默认展开

这部分不是“信息完整”，而是“信息污染”。

应该废弃当前默认展示方式，改成：

- 结果摘要优先
- 模式选择其次
- 执行器列表再次
- 高级字段折叠

#### C. 两段式显式保存

从实现上可保留底层两次请求，但从产品层面不应再保留“先保存 binding，再保存 override”这种显式操作。

这属于应该废弃的旧交互。

### 17.6 建议的最终页面结构

最终项目相关页面建议形成如下结构：

- 项目概览
- 环境
- 代码仓库
- 凭证
- 成员
- 设置
- 审批策略
- 角色执行
- 成本

其中：

- 设置：保留默认模型、默认环境、预算等基础设置
- 审批策略：只负责审批模板与环境审批覆盖
- 角色执行：只负责角色运行规则与执行器管理

这样每个页面只回答一类问题，不会再出现“页面能做很多事，但用户不知道自己为什么会来到这里”的问题。

## 18. 接口级 PRD

本节将页面区块与 BFF / control-plane 的读写接口直接对应，作为前端拆分实施时的接口级 PRD。

### 18.1 页面与接口边界总览

建议形成三个前端页面边界：

- 兼容重定向入口：旧策略路由，仅负责兼容历史链接
- 项目角色执行页：负责角色运行规则与项目执行器管理
- 项目审批策略页：负责策略模板列表、项目默认审批策略、环境审批覆盖

其中接口职责如下：

- BFF 负责聚合页面所需读模型，尽量减少前端拼装
- control-plane 负责角色、项目 override、执行器 binding、审批模板与预算配置的主数据读写

### 18.2 兼容重定向入口

页面：

- [control-plane/web-ui/src/router/index.ts](control-plane/web-ui/src/router/index.ts)

页面区块：

#### A. 页面标题与项目上下文

用途：

- 保证旧链接仍然可用
- 把用户直接送到新的审批策略页

前端读取：

- 无额外读取，直接由路由重定向完成

建议 BFF：

- 无新增要求

control-plane：

- 无新增要求

写接口：

- 无

#### B. 迁移入口卡片

用途：

- 该方案未采用
- 旧入口不再停留在中间态页面

前端读取：

- 无额外接口

写接口：

- 无

### 18.3 项目角色执行页

页面：

- [control-plane/web-ui/src/pages/ProjectRoleExecution.vue](control-plane/web-ui/src/pages/ProjectRoleExecution.vue)

#### A. 页面初始化区块

展示内容：

- 项目名称
- 项目角色执行页说明
- 顶部摘要指标

当前前端读取接口：

- `getProject(projectId)`
- `listRoleAgents()`
- `getRoleAgentProjectOverride(roleAgentId, projectId)` 按角色逐个读取

当前 BFF：

- `GET /api/role-agents`
- `GET /api/role-agents/:roleAgentId/projects/:projectId/override`

当前 control-plane：

- `GET /api/role-agents`
- `GET /api/role-agents/:roleAgentId/projects/:projectId/override`

权限语义：

- 普通项目成员至少应可读取系统角色列表，用于理解当前项目的角色运行规则
- 组织管理员 / 平台管理员可读取并编辑项目级 override 与项目执行器
- 如果当前账号无权读取项目级 override，前端应降级为“平台默认视图”，而不是整页空白
- 当前实现约定：override 读取返回 `403` 时，页面保留角色主表并提示“已回退展示平台默认角色配置”

目标 BFF 聚合接口：

```ts
GET /api/projects/:projectId/role-execution-view
```

建议返回：

```ts
interface ProjectRoleExecutionView {
  project: { id: string; name: string; slug: string };
  summary: {
    totalRoles: number;
    customizedRoles: number;
    takeoverRoles: number;
    riskyRoles: number;
  };
  rows: ProjectRoleExecutionRow[];
}
```

对应 control-plane 读接口：

- `GET /api/projects/:projectId`
- `GET /api/role-agents`
- `GET /api/role-agents/:roleAgentId/projects/:projectId/override`
- 未来可增加聚合接口：

```ts
GET /api/projects/:projectId/role-execution-resolved
```

#### B. 角色列表主表

展示内容：

- 角色
- 当前模式
- 运行影响
- 项目定制摘要

当前前端读取来源：

- `listRoleAgents()`
- `getRoleAgentProjectOverride(...)`

目标 BFF 聚合字段：

```ts
interface ProjectRoleExecutionRow {
  roleAgentId: string;
  roleLabel: string;
  mode: "platform-default" | "project-extend" | "project-takeover";
  effectiveStages: string[];
  effectiveRiskLevel: "low" | "medium" | "high" | "critical";
  interventionSummary: string;
  customizationSummary: string;
  override: RoleAgentProjectOverrideRecord | null;
}
```

写接口：

- 无

#### C. 角色配置抽屉：当前生效结果 / 运行影响

展示内容：

- 当前模式
- 适用阶段
- 运行影响
- 最终修改执行者

当前前端读取来源：

- 角色主表已有数据

目标 BFF 聚合字段：

- `mode`
- `effectiveStages`
- `interventionSummary`
- `effectiveBindingsSummary`

写接口：

- 无

#### D. 角色配置抽屉：项目定制字段

编辑内容：

- 名称
- 描述
- 阶段
- 风险等级
- 高级字段

当前前端写接口：

- `upsertRoleAgentProjectOverride(roleAgentId, projectId, payload)`

当前 BFF：

- `PUT /api/role-agents/:roleAgentId/projects/:projectId/override`

control-plane：

- `GET /api/role-agents/:roleAgentId/projects/:projectId/override`
- `PUT /api/role-agents/:roleAgentId/projects/:projectId/override`

目标写接口保持不变，但建议 BFF 返回统一成功摘要：

```ts
interface RoleExecutionSaveResult {
  roleAgentId: string;
  projectId: string;
  mode: "platform-default" | "project-extend" | "project-takeover";
  effectiveStages: string[];
  effectiveRiskLevel: string;
  affectedTaskPolicy: "new-tasks-immediate" | "next-stage-reparse";
}
```

#### E. 角色配置抽屉：项目执行器列表

展示内容：

- 平台默认执行器
- 项目专属执行器

当前前端读取接口：

- `listRoleAgentBindings(roleAgentId)`
- `listRoleAgentBindings(roleAgentId, projectId)`

当前 BFF：

- `GET /api/role-agents/:roleAgentId/bindings`

通过 `projectId` query 区分平台 / 项目级读取。

control-plane：

- `GET /api/role-agents/:roleAgentId/bindings`

建议 BFF 明确支持：

```ts
GET /api/role-agents/:roleAgentId/bindings?projectId=:projectId
```

目标聚合字段：

```ts
interface RoleExecutionBindingsView {
  systemBindings: RoleAgentBindingRecord[];
  projectBindings: RoleAgentBindingRecord[];
}
```

#### F. 新增 / 编辑项目执行器弹窗

编辑内容：

- bindingKey
- label
- runtimeAgent
- priority
- enabled
- model
- tagsJson

当前前端写接口：

- `createRoleAgentBinding(roleAgentId, payload)`
- `updateRoleAgentBinding(roleAgentId, bindingId, payload)`

当前 BFF：

- `POST /api/role-agents/:roleAgentId/bindings`
- `PATCH /api/role-agents/:roleAgentId/bindings/:bindingId`

control-plane：

- `POST /api/role-agents/:roleAgentId/bindings`
- `PATCH /api/role-agents/:roleAgentId/bindings/:bindingId`

后续建议补充：

- `DELETE /api/role-agents/:roleAgentId/bindings/:bindingId`

### 18.4 项目审批策略页

当前页面已经独立为：

- [control-plane/web-ui/src/pages/ProjectPolicies.vue](control-plane/web-ui/src/pages/ProjectPolicies.vue)

对应区块与接口如下。

#### A. 默认模型 / 默认环境 / 并发 / 预算

前端读取：

- `getProject(projectId)`
- `getModelsConfig()`
- `listEnvironments(projectId)`
- `listBudgetConfigs(projectId)`

前端写：

- `updateProject(projectId, { settings })`
- `createBudgetConfig(...)` / `updateBudgetConfig(...)`

control-plane：

- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `GET /api/budget-configs?projectId=:projectId`
- `POST /api/budget-configs`
- `PATCH /api/budget-configs/:budgetConfigId`

#### B. 项目默认审批策略

前端读取：

- `listPolicies(projectId)`

前端写：

- `createPolicy(...)` / `updatePolicy(...)`
- `updateProject(projectId, { settings.approvalPolicyTemplateId })`

control-plane：

- `GET /api/policies?projectId=:projectId`
- `POST /api/policies`
- `PATCH /api/policies/:policyId`
- `PATCH /api/projects/:projectId`

#### C. 环境级审批覆盖

前端读取：

- `listEnvironments(projectId)`
- `listPolicies(projectId)`

前端写：

- `createPolicy(...)` / `updatePolicy(...)`
- `updateProject(projectId, { settings.environmentApprovalPolicies })`

control-plane：

- `GET /api/environments?projectId=:projectId`
- `GET /api/policies?projectId=:projectId`
- `POST /api/policies`
- `PATCH /api/policies/:policyId`
- `PATCH /api/projects/:projectId`

### 18.5 任务页中的角色介入视图

该部分是新方案要求的运行事实页，建议挂载在任务详情 / 工作台右栏。

建议区块：

- 当前阶段横幅
- 已介入角色列表
- 开发者待处理项
- 审批与人工接管状态

建议 BFF 读接口：

```ts
GET /api/tasks/:taskId/workflow-view
GET /api/tasks/:taskId/role-conclusions
GET /api/tasks/:taskId/change-requests
GET /api/tasks/:taskId/governance-summary
```

建议 control-plane 对应接口：

```ts
GET /api/task-workflow-runs/:taskId
GET /api/task-stage-runs/:taskId
GET /api/role-aggregate-conclusions?taskId=:taskId
GET /api/developer-change-requests?taskId=:taskId
GET /api/approvals?taskId=:taskId
```

### 18.6 前端拆分实施顺序

按接口依赖和页面风险，实际落地顺序如下：

1. 新增 `ProjectRoleExecution`，承接角色运行规则与执行器管理
2. 更新 `ProjectSettingsPanel` 快捷入口，阻断旧心智继续扩散
3. BFF 新增 `GET /api/projects/:projectId/role-execution-view` 聚合读模型
4. 审批策略从 `ProjectSettingsPanel` 独立成专页 `ProjectPolicies`
5. 旧 `ProjectPolicies` 路由保留为 redirect，继续兼容历史链接

## 19. 最终结论

当前实现的问题不是“功能缺失”，而是“用户必须先理解实现模型，才能完成业务配置”。

新的方案应把页面从“内部配置对象编辑器”改成“项目角色执行配置台”。

用户只需要理解三件事：

1. 当前角色由谁执行
2. 我是补充项目执行器，还是完全接管
3. 保存后实际生效的结果是什么

但这还不够。

页面还必须额外回答第四件事：

- 这些角色会在项目运行的哪个阶段，以什么方式介入当前任务

只有把“配置能力”和“运行介入能力”一起设计出来，用户才会真正明白：

- 为什么要给某个角色配项目专属执行器
- 配完之后它会在哪些阶段出现
- 它会提出建议、修正请求、阻断还是审批
- 最终是谁来真正修改当前项目

只要页面围绕这四件事组织，当前能力才会从“能用但难懂”变成“可理解、可操作、可预期、可审计”。
