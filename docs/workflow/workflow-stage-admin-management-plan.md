# 工作流阶段管理控制台方案

> 适用范围：OpenerX 管理员对工作流模板、阶段顺序、阶段角色参与规则的可视化管理
>
> 目标：让管理员不需要理解底层表结构或 API，即可直观管理 clarify / design / implement / verify / release 等阶段，并让项目管理员清楚知道“当前项目实际采用了哪套阶段模板”。

## 0. 背景与现状

当前系统已经具备工作流模板与阶段的后端数据结构，但管理员侧缺少对应 UI。

现状分成三层：

- 设计层：阶段枚举与状态机定义见 [docs/workflow-template-stage-machine-design.md](workflow-template-stage-machine-design.md)
- 数据层：`workflow_templates` 与 `workflow_template_stages` 表已存在，Service 已提供 CRUD 路由
- 页面层：前端没有专门的“工作流模板 / 阶段管理”页面，管理员无法直观维护

这导致两个问题：

1. 平台管理员无法用页面方式管理阶段模板，只能依赖 seed 数据或直接调接口。
2. 项目管理员在“角色执行”页能看到阶段结果，却看不到“这些阶段由哪套模板定义、是否可切换、谁能改”。

## 1. 核心判断

这个能力不应继续散落在“角色执行”和“系统设置”里，而应被定义为一个独立心智：

**工作流模板管理。**

管理员真正需要回答的是四个问题：

1. 系统里有哪些阶段模板。
2. 每套模板包含哪些阶段，顺序是什么。
3. 每个阶段由哪些角色主导、哪些角色参与、会不会阻断或审批。
4. 当前项目绑定的是哪套模板，是否做了项目级调整。

因此，方案必须拆成两个层次：

- 平台级：管理模板本身
- 项目级：选择与查看项目采用的模板，必要时做受控 override

## 2. 设计目标

### 2.1 管理员目标

- 平台管理员可以创建、复制、启停、排序、编辑工作流模板
- 平台管理员可以可视化编辑阶段，而不是直接编辑 JSON
- 项目管理员可以清楚看到当前项目采用哪套模板，以及该模板下有哪些阶段
- 高风险改动必须有明确影响提示，例如删除阶段、调整顺序、禁用 release

### 2.2 产品目标

- 让“阶段”成为一等配置对象，而不是角色配置的附属字段
- 让“模板”和“角色执行”边界清晰：模板管流程骨架，角色页管角色能力与执行器
- 让普通管理员优先使用标准阶段，不必暴露过多底层字段

### 2.3 工程目标

- 前端统一走 BFF，不直接访问 Service
- 保持与现有 `workflow_templates` / `workflow_template_stages` 数据模型兼容
- 分阶段交付，先实现可读、再实现可编辑、最后补高级字段管理

## 3. 用户与权限边界

建议按三类角色区分权限：

| 角色 | 能力 |
| --- | --- |
| `platform_admin` | 管理系统模板；创建、编辑、复制、禁用模板；维护所有阶段配置 |
| `org_admin` | 与平台管理员一致，若当前产品域内等同最高管理员 |
| `project_admin` | 只能在项目内选择模板、查看阶段定义、查看项目是否存在 override；不允许直接修改平台模板 |

补充规则：

- 项目级如果后续支持 template override，也必须限制在“可受控字段”，不允许任意脱离平台模板体系
- 高风险模板变更只允许平台级管理员操作

## 4. 信息架构

### 4.1 新增一级入口

建议新增两个入口，而不是把所有内容塞进现有页面。

#### A. 平台级入口

位置：系统设置下新增“工作流模板”分区

建议路由：

- `/settings/workflow-templates`
- `/settings/workflow-templates/:templateId`

用途：

- 管理模板列表
- 编辑模板基础信息
- 编辑阶段顺序与阶段细项

#### B. 项目级入口

位置：项目二级导航新增“工作流”

建议路由：

- `/projects/:projectId/workflow`

用途：

- 查看项目当前绑定模板
- 预览阶段路径与角色参与概况
- 切换项目所使用模板
- 查看项目是否存在 override 或特例配置

### 4.2 与现有页面的边界

| 页面 | 负责内容 |
| --- | --- |
| 项目概览 | 项目基础信息 |
| 审批策略 | 审批模板与环境审批绑定 |
| 角色执行 | 角色能力、执行器、角色 override |
| 工作流 | 项目使用的模板、阶段路径、阶段角色参与图 |
| 系统设置 / 工作流模板 | 平台模板定义与阶段编辑 |

这能解决当前“角色页看到阶段但不能管理”的认知断层。

## 5. 页面方案

### 5.1 平台级模板列表页

建议页面名：`WorkflowTemplatesAdmin.vue`

列表页展示列：

- 模板名称
- 适用范围：系统默认 / 指定分类 / 项目专用
- 阶段数
- 默认角色数
- 是否可选
- 状态：启用 / 停用
- 最近更新时间
- 操作：查看、编辑、复制、禁用

顶部摘要卡建议展示：

- 模板总数
- 启用模板数
- 被项目引用中的模板数
- 存在高风险阶段配置的模板数

筛选项建议包括：

- 分类
- 状态
- 是否被项目引用

### 5.2 模板编辑页

建议页面名：`WorkflowTemplateEditor.vue`

页面采用左右结构：

- 左侧：阶段路径与顺序
- 右侧：当前阶段的详细配置

#### 左侧阶段路径区

采用纵向 stage rail，明确显示：

- 阶段顺序
- 阶段 key
- 阶段名称
- 启用状态
- 是否存在 gate / approval / failure policy

支持操作：

- 新增阶段
- 调整顺序
- 启用 / 停用阶段
- 复制阶段
- 删除阶段

删除或停用高风险阶段时必须弹确认：

- 删除 `verify`：提示“可能导致任务在 implement 后直接进入 release 或结束”
- 删除 `release`：提示“会影响发布前审批与部署治理路径”

#### 右侧阶段详情区

按管理员理解顺序组织，而不是按数据库字段组织。

推荐分 5 个卡片：

1. 阶段基础信息
2. 角色参与
3. 进入 / 退出条件
4. Gate 与审批
5. 失败与回退策略

##### 阶段基础信息

字段：

- 阶段 key
- 展示名称
- 是否启用
- 执行模式：single / parallel / pipeline

交互建议：

- 默认只允许从标准阶段库中选择 key：`intake`、`clarify`、`design`、`plan`、`implement`、`verify`、`release`、`post-release`、`retrospective`
- “自定义阶段 key”放进高级模式，默认隐藏

##### 角色参与

字段：

- 主角色
- 参与角色
- 角色执行策略

交互建议：

- 用角色标签和头像式胶囊展示，而不是裸字符串
- 选择主角色时实时校验该角色的 `allowedStages`
- 若模板阶段与角色 `allowedStages` 冲突，直接在页面上提示“角色当前默认不覆盖该阶段，需先调整角色配置”

##### 进入 / 退出条件

字段：

- entry criteria
- exit criteria

交互建议：

- 支持自然语言条目列表编辑
- 提供常见预设，如“需求已确认”“设计评审通过”“测试报告已上传”

##### Gate 与审批

字段：

- gate 列表
- gate 类型
- required
- evaluator role
- approval requirement

交互建议：

- 用“阻断条件”表达 gate，而不是直接暴露 `gatesJson`
- 用“需要审批”开关展开审批细项
- 对 `release` 和 `verify` 阶段提供预设模板

##### 失败与回退策略

字段：

- 失败后状态
- 回退目标阶段
- 是否允许人工接管

交互建议：

- 用流程语言描述，例如“验证失败后回到 implement”
- 页面上同步显示预估流转路径

### 5.3 项目级工作流页

建议页面名：`ProjectWorkflowTemplate.vue`

这个页面不是拿来编辑模板细节，而是让项目管理员理解“当前项目怎么跑”。

页面分三块：

#### A. 当前模板摘要

- 当前绑定模板
- 模板版本 / 更新时间
- 当前项目是否继承平台默认
- 当前项目是否存在局部 override

#### B. 阶段路径可视化

用只读时间轴或 stage rail 展示：

- clarify → design → implement → verify → release
- 每个阶段的主角色与关键参与角色
- 哪些阶段带 gate / approval

#### C. 模板选择与切换

- 可以切换到其他可选模板
- 切换前显示差异摘要
- 如果项目已有任务在跑，提示切换影响范围

建议差异摘要至少显示：

- 阶段增减
- 顺序变化
- 关键 gate 变化
- release 路径变化

## 6. 关键交互原则

### 6.1 标准阶段优先

虽然当前后端允许 `stageKey` 为任意字符串，但 UI 默认应只提供标准阶段集合。

原因：

- 降低认知负担
- 保持统计口径一致
- 避免任务运行页和审计页出现难理解的自定义阶段名

高级模式才允许自定义阶段，并要求填写：

- key
- 展示名称
- 前置阶段
- 失败回退语义

### 6.2 禁止管理员直接编辑原始 JSON

页面必须将以下结构转成业务语言：

- `stageOrderJson`
- `participantRoleAgentIdsJson`
- `gatesJson`
- `approvalsJson`
- `failurePolicyJson`

只有调试模式下才显示原始 JSON 预览。

### 6.3 先看结果，再看配置

管理员进入页面后优先看到：

- 模板将如何运行
- 当前阶段路径是什么
- 哪些阶段高风险

而不是先看到一堆字段。

## 7. BFF 与 API 落地方案

### 7.1 为什么不能让前端直接打 Service

当前前端大多数管理页面都通过 BFF 聚合访问 Service。工作流模板也应保持一致。

原因：

- 统一权限与错误处理
- 可以在 BFF 聚合角色信息、项目引用状态、差异摘要
- 方便后续补充只读模型而不污染 Service 基础 CRUD

### 7.2 建议新增的 BFF 路由

建议在 BFF 增加 `/api/workflow-templates` 代理与聚合接口：

- `GET /api/workflow-templates`
- `POST /api/workflow-templates`
- `PATCH /api/workflow-templates/:templateId`
- `GET /api/workflow-templates/:templateId/stages`
- `POST /api/workflow-templates/:templateId/stages`
- `PATCH /api/workflow-templates/:templateId/stages/:stageId`

在此基础上补 3 个聚合读接口：

- `GET /api/workflow-templates/:templateId/editor-view`
- `GET /api/projects/:projectId/workflow-template-view`
- `POST /api/projects/:projectId/workflow-template-selection`

其中：

#### `editor-view`

返回：

- 模板基础信息
- 阶段列表
- 每个阶段的角色元数据
- 当前标准阶段库
- 预计算风险提示

#### `workflow-template-view`

返回：

- 项目当前绑定模板
- 只读阶段视图
- 关键角色参与摘要
- 是否存在 override
- 切换模板候选列表

#### `workflow-template-selection`

用于项目管理员切换模板，要求：

- 校验当前项目权限
- 返回变更影响摘要
- 可选择立即生效或仅对新任务生效

### 7.3 Service API 的补充建议

当前 Service 已有模板与阶段 CRUD，但还缺两类能力：

1. 查询模板被哪些项目引用
2. 项目绑定模板的读写接口

建议新增：

- `GET /api/workflow-templates/:templateId/references`
- `GET /api/projects/:projectId/workflow-template`
- `PUT /api/projects/:projectId/workflow-template`

如果不想在 `projects` 表直接扩字段，也可增加项目模板绑定表。

## 8. 数据模型建议

### 8.1 保持现有表不变

第一阶段尽量不改 `workflow_templates` / `workflow_template_stages` 结构。

### 8.2 建议新增项目绑定关系

建议新增表：

`project_workflow_templates`

建议字段：

- `id`
- `project_id`
- `template_id`
- `binding_mode`：`inherit-default` / `pin-template`
- `effective_from`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

这样项目级页面就能明确回答“当前项目到底用哪套模板”。

## 9. 分阶段实施计划

### Phase 1：只读可见

目标：先让管理员看见模板和阶段，不允许编辑。

交付项：

- BFF 新增模板列表与详情只读接口
- 前端新增系统级模板列表页
- 前端新增项目级工作流页，只读显示当前模板与阶段路径
- 项目导航新增“工作流”入口

### Phase 2：基础编辑

目标：管理员可用页面编辑模板和阶段顺序。

交付项：

- 模板创建、复制、启停
- 阶段增删改排序
- 标准阶段库选择器
- 高风险变更确认

### Phase 3：高级规则编辑

目标：让 gate、approval、failure policy 可视化管理。

交付项：

- Gate 可视化配置
- Approval 可视化配置
- 回退策略编辑
- 模板差异对比

### Phase 4：项目绑定与生效策略

目标：让项目管理员可以切换模板，并管理生效范围。

交付项：

- 项目绑定模板读写接口
- “立即对新任务生效 / 保持旧任务不变”策略
- 项目切换模板影响分析

## 10. 验收标准

### 10.1 管理端体验

- 管理员能在 3 次点击内找到阶段模板管理入口
- 管理员能直观看到模板包含的阶段顺序
- 管理员无需理解 JSON 字段即可完成常见阶段编辑

### 10.2 项目端体验

- 项目管理员能在项目页看到当前采用的模板
- 项目管理员能看懂每个阶段有哪些主要角色参与
- 项目管理员在切换模板前能看见影响摘要

### 10.3 工程验收

- 前端通过 BFF 访问，不直连 Service
- 所有高风险操作有确认与审计事件
- 新页面覆盖基础单测与关键路由回归

## 11. 推荐落地点

如果按当前代码结构推进，建议按下面的文件落点实施：

- 路由新增：[control-plane/web-ui/src/router/index.ts](../../control-plane/web-ui/src/router/index.ts)
- 项目导航扩展：[control-plane/web-ui/src/components/ProjectSectionNav.vue](../../control-plane/web-ui/src/components/ProjectSectionNav.vue)
- 系统级页面：`control-plane/web-ui/src/pages/WorkflowTemplatesAdmin.vue`
- 项目级页面：`control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue`
- 模板编辑页：`control-plane/web-ui/src/pages/WorkflowTemplateEditor.vue`
- BFF 路由：`control-plane/web-ui-bff/src/modules/workflow-templates/routes.ts`
- Service 路由扩展：[control-plane/service/src/modules/workflow-templates/routes.ts](../../control-plane/service/src/modules/workflow-templates/routes.ts)

## 12. 最终建议

优先级上，不建议直接从“可视化编辑所有高级字段”开始，而应按以下顺序推进：

1. 先让模板与阶段可见
2. 再让模板与阶段可编辑
3. 最后再开放 gate / approval / failure policy 等高级控制

原因很简单：

- 当前最大的可用性问题不是“字段不够”，而是“管理员根本没有页面入口，也不知道项目到底用了哪套阶段模板”
- 先解决可见性和入口问题，收益最大，风险最小

因此，本方案的核心不是单纯新增一个编辑器，而是补齐一条完整的管理员心智链路：

**在哪看模板 -> 怎么看阶段 -> 怎么改模板 -> 项目怎么绑定 -> 改完会影响什么。**