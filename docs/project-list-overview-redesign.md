# 项目列表页总览化改造设计

## 1. 文档目标

本文档用于把当前“项目列表页仅承担入口、详情页承担全部管理”的实现，升级为“列表页可快速判断项目可用性、配置完整度和治理风险”的总览页设计。

本文档覆盖三部分内容：

- Web UI 中 `Projects.vue` 的具体改造草案
- BFF 和 Control Plane Service 的接口设计草案
- 一版更接近 PRD 的字段定义、状态规则和交互规则说明

本文档面向产品、前端、BFF、Service 共同评审，不是最终代码实现说明。

## 2. 当前现状

当前实现中：

- 项目列表页仅展示 `项目名称 / Slug / 描述 / 创建时间 / 操作`
- 列表页仅支持 `新建 / 编辑 / 详情`
- 环境、仓库、凭证、成员、设置全部下沉到项目详情页

相关实现位置：

- `control-plane/web-ui/src/pages/Projects.vue`
- `control-plane/web-ui/src/pages/ProjectDetail.vue`
- `control-plane/web-ui-bff/src/modules/projects/routes.ts`
- `control-plane/service/src/modules/projects/routes.ts`

当前结构的优点是简单，但在项目数量增多后会出现三个问题：

- 不能在列表页判断项目是否可直接投入使用
- 不能快速筛出待配置项目或风险项目
- 不能从列表页直接进入最需要补齐的配置位置

## 3. 改造目标

### 3.1 目标

项目列表页需要具备以下能力：

- 一眼判断项目状态
- 一眼判断配置完成度
- 一眼识别治理风险
- 能按组织、状态、配置情况快速筛选
- 能从风险提示直接跳到详情页对应配置位置
- 保留现有新建、编辑、进入详情能力，不影响现有详情页结构

### 3.2 非目标

本次改造不做：

- 不把详情页所有配置项搬回列表页
- 不在第一阶段引入卡片式大改版布局
- 不在第一阶段引入真实删除，仍采用归档优先
- 不强依赖独立任务域重构完成后才落地

## 4. 页面信息架构

建议页面自上而下分为四个区块：

1. 标题操作区
2. 筛选工具区
3. 摘要提示区
4. 项目总览表格区

### 4.1 标题操作区

左侧：

- 页面标题：项目管理
- 副文案：统一查看项目状态、配置完整度与治理风险

右侧：

- 导出
- 批量操作
- 新建项目

### 4.2 筛选工具区

建议提供以下筛选项：

- 搜索框：搜索项目名称 / Slug
- 组织筛选：全部组织
- 项目状态筛选：全部 / 正常 / 待配置 / 已归档 / 异常
- 配置状态筛选：全部 / 已配置 / 待配置 / 存在风险
- 排序：最近活跃 / 最近创建 / 名称 A-Z
- 开关：仅看我管理的项目
- 按钮：重置

### 4.3 摘要提示区

建议显示一条轻量摘要：

- 共 28 个项目，其中 6 个待配置，2 个存在治理风险

并提供快捷筛选入口：

- 查看待配置项目
- 查看风险项目

### 4.4 表格区

建议主表列顺序如下：

1. 项目名称
2. 所属组织
3. 状态
4. 配置完成度
5. 风险提示
6. 任务 / 审批摘要
7. 最近活跃时间
8. 操作

## 5. Projects.vue 改造草案

### 5.1 改造原则

对 `control-plane/web-ui/src/pages/Projects.vue` 的改造建议遵守以下原则：

- 保留现有新建项目弹窗
- 保留现有编辑项目弹窗
- 列表数据从当前 `projectStore.projects` 升级为项目总览数据源
- 不把复杂筛选、分页、摘要状态塞进现有项目切换 store
- 页面筛选状态建议使用页面内 `ref`，或新增专用 overview store

### 5.2 建议新增状态

建议在 `Projects.vue` 内新增以下状态：

- `queryText`
- `selectedOrgId`
- `selectedProjectStatus`
- `selectedConfigStatus`
- `selectedSortBy`
- `onlyManaged`
- `overviewLoading`
- `overviewRows`
- `summary`
- `pagination`

其中：

- `overviewRows` 用于表格显示的项目总览行
- `summary` 用于顶部摘要提示区
- `pagination` 应支持 `page / pageSize / total`

### 5.3 建议新增类型

前端建议新增 `ProjectOverviewItem` 类型，而不是继续沿用轻量 `Project`：

```ts
interface ProjectOverviewItem {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  slug: string;
  description?: string | null;
  projectStatus: "healthy" | "pending_config" | "archived" | "error";
  completedCount: number;
  totalRequiredCount: number;
  completionPercent: number;
  risks: string[];
  runningTasks: number;
  pendingApprovals: number;
  failedTasksToday: number;
  lastActivityAt?: string | null;
  memberCount: number;
  repositoryCount: number;
  environmentCount: number;
  currentUserRole?: "project_admin" | "developer" | "viewer" | null;
  isCurrentUserManager: boolean;
  createdAt?: string;
}
```

### 5.4 建议页面结构

建议 `Projects.vue` 按以下结构组织：

- 标题与操作按钮
- 筛选栏 `a-card`
- 摘要提示 `a-alert`
- 总览表格 `a-table`
- 保留现有“新建项目”弹窗
- 保留现有“编辑项目”弹窗

### 5.5 建议表格列定义

建议将当前 `columns` 替换为：

- `name`
- `orgName`
- `projectStatus`
- `completion`
- `risks`
- `activity`
- `lastActivityAt`
- `actions`

建议列含义：

#### 列表字段：项目名称

显示两行：

- 第一行：项目名称，可点击进入详情页
- 第二行：Slug，使用弱文案

如当前用户是项目管理员，增加一个轻量标签：

- 我管理

#### 列表字段：所属组织

显示组织名称，不再要求用户先记住项目属于哪个组织。

#### 列表字段：状态

使用单个标签展示：

- 正常
- 待配置
- 已归档
- 异常

#### 列表字段：配置完成度

显示：

- 进度条
- 文字 `4/6 已配置`

#### 列表字段：风险提示

显示最多 2 个风险标签，超过部分显示 `+N`：

- 无仓库
- 无默认环境
- 凭证已过期

#### 列表字段：任务 / 审批摘要

建议两行：

- 运行中 2
- 待审批 1

可选第三项弱文案：

- 今日失败 0

#### 列表字段：最近活跃时间

默认显示相对时间，悬浮显示完整时间。

#### 操作

建议保留三类操作：

- 详情
- 快速配置
- 更多

`更多` 下拉菜单建议包含：

- 编辑项目
- 跳转审批策略页
- 跳转角色执行页
- 跳转成本页
- 查看成员
- 查看仓库
- 查看凭证
- 归档项目

### 5.6 建议方法清单

建议在 `Projects.vue` 中新增以下方法：

- `loadOverview()`：读取项目总览列表
- `resetFilters()`：重置筛选
- `openQuickConfig(record)`：按风险跳转到详情页对应 tab
- `archiveProject(record)`：执行项目归档
- `statusLabel(status)`：映射状态文案
- `statusColor(status)`：映射状态颜色
- `formatRelativeTime(ts)`：格式化最近活跃时间

### 5.7 快速配置跳转规则

`快速配置` 不应只是跳详情页首页，建议按风险决定目标 tab：

- 包含 `无仓库`：跳 `repositories`
- 包含 `无凭证` 或 `凭证已过期`：跳 `credentials`
- 包含 `无环境`：跳 `environments`
- 包含 `无默认环境` 或 `审批未绑定` 或 `预算未配置`：跳 `settings`
- 无明显风险：跳 `overview`

建议路由形式：

- `/projects/:projectId?tab=repositories`
- `/projects/:projectId?tab=credentials`

### 5.8 与现有文件的关系

建议保持以下职责边界：

- `Projects.vue`：列表筛选、摘要、表格展示、基础新建编辑
- `ProjectDetail.vue`：项目详情和各配置面板
- `ProjectRepositoriesPanel.vue`：仓库管理
- `ProjectCredentialsPanel.vue`：凭证管理
- `ProjectMembersPanel.vue`：成员管理
- `ProjectSettingsPanel.vue`：模型、审批、预算、默认环境等设置

## 6. 前端配套改造建议

### 6.1 API 层

建议在 `control-plane/web-ui/src/lib/api.ts` 新增：

- `ProjectOverviewItem`
- `ProjectOverviewResponse`
- `listProjectOverview(params)`
- `archiveProject(projectId)`

当前 `listProjects(orgId?)` 保留给轻量场景使用，例如项目切换器。

### 6.2 Store 层

建议不要把复杂筛选直接塞进当前 `control-plane/web-ui/src/stores/project.ts`。

建议方案二选一：

- 方案 A：在 `Projects.vue` 内维护 overview 查询状态
- 方案 B：新增 `project-overview` store，只服务于项目列表页

不建议：

- 在现有 `project` store 中同时管理项目切换、列表筛选、分页、摘要统计

## 7. BFF 接口设计草案

### 7.1 设计原则

当前 BFF 已经代理：

- 项目基础 CRUD
- 项目成员管理
- 仓库管理
- 凭证管理
- 预算管理
- 审批查询与处理
- 任务列表与详情

本次建议延续现有模式，在 BFF 增加一个“项目总览聚合接口”，而不是让前端自己拼接多路请求。

### 7.2 新增接口

建议新增：

- `GET /api/projects/overview`

### 7.3 查询参数

建议支持以下查询参数：

- `q`：项目名称或 Slug 搜索
- `orgId`：组织筛选
- `status`：项目状态筛选
- `configStatus`：配置状态筛选
- `onlyManaged`：是否仅看当前用户管理的项目
- `sortBy`：排序规则
- `page`：页码
- `pageSize`：每页大小

其中：

- `status` 取值：`healthy | pending_config | archived | error`
- `configStatus` 取值：`configured | pending | risk`
- `sortBy` 取值：`last_activity_desc | created_at_desc | name_asc`

### 7.4 返回结构

建议返回结构：

```json
{
  "data": [
    {
      "id": "proj-default",
      "orgId": "org-default",
      "orgName": "OpenerX",
      "name": "Default Project",
      "slug": "default",
      "description": "Default OpenerX project",
      "projectStatus": "pending_config",
      "completedCount": 4,
      "totalRequiredCount": 6,
      "completionPercent": 67,
      "risks": ["无默认环境", "审批未绑定"],
      "runningTasks": 2,
      "pendingApprovals": 1,
      "failedTasksToday": 0,
      "lastActivityAt": "2026-03-10T09:10:00Z",
      "memberCount": 3,
      "repositoryCount": 1,
      "environmentCount": 0,
      "currentUserRole": "project_admin",
      "isCurrentUserManager": true,
      "createdAt": "2026-03-09T09:55:08Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 28,
  "summary": {
    "totalProjects": 28,
    "pendingConfigCount": 6,
    "riskCount": 2
  }
}
```

### 7.5 BFF 路由职责

建议 `control-plane/web-ui-bff/src/modules/projects/routes.ts` 新增：

- 解析 query 参数
- 调用 service 侧的 `/api/projects/overview`
- 原样透传分页结构
- 统一错误响应

不建议 BFF 自己拼接仓库、凭证、预算、审批、任务多个接口进行聚合。原因：

- 这会让 BFF 聚合逻辑和控制面主数据逻辑混在一起
- Service 更接近数据库与治理事实来源
- 项目总览属于项目主数据视图，不只是前端视图拼装

### 7.6 BFF 其他扩展接口

为支持列表操作，建议在 BFF 增加或明确以下接口：

- `PATCH /api/projects/:projectId/archive`
- `GET /api/projects/:projectId/navigation-targets`

其中 `navigation-targets` 可选。如果前端自己根据 `risks` 推导跳转 tab，则可以不新增。

## 8. Service 接口设计草案

### 8.1 设计原则

项目总览是“项目主数据 + 配置完整度 + 治理事实”的聚合视图，应由 Control Plane Service 输出。

原因：

- 它依赖项目、组织、成员、环境、仓库、凭证、预算、审批、任务等多源数据
- 它属于治理视图，不只是前端样式问题
- 后续导出、归档、批量操作也会依赖同一口径

### 8.2 新增接口

建议在 `control-plane/service/src/modules/projects/routes.ts` 新增：

- `GET /api/projects/overview`
- `PATCH /api/projects/:projectId/archive`

### 8.3 GET /api/projects/overview

#### 输入

查询参数：

- `q`
- `orgId`
- `status`
- `configStatus`
- `onlyManaged`
- `sortBy`
- `page`
- `pageSize`

#### 输出

输出结构与 BFF 对外结构一致。

#### 处理步骤

建议 service 处理流程如下：

1. 根据 JWT 和项目角色，确定可见项目集合
2. 查询项目基础信息和组织名称
3. 聚合成员数、环境数、仓库数、凭证状态、预算状态
4. 聚合任务运行数、今日失败数、待审批数、最近活跃时间
5. 计算配置完成度
6. 生成风险标签数组
7. 计算项目状态
8. 按筛选条件过滤
9. 按排序规则排序
10. 返回分页结果和 summary

### 8.4 PATCH /api/projects/:projectId/archive

#### 目标

为列表页提供“归档项目”操作。

#### 行为建议

- 首期采用软归档
- 不物理删除项目
- 被归档项目默认不在普通列表中展示，除非显式筛选
- 归档后不允许新建任务
- 归档后保留详情查看、审计和成本记录

#### 权限建议

- `platform_admin`
- `org_admin`
- `project_admin`

#### 审计建议

写入审计事件：

- `eventType`: `project.archived`
- `action`: `archive_project`
- `target`: projectId

### 8.5 数据模型建议

当前 `projects` 表没有状态字段。为支持项目归档和总览状态筛选，建议扩展：

- `status`: `active | archived`
- `updatedAt`

说明：

- 列表页展示的 `projectStatus` 是派生状态，不应直接落库为单一状态字段
- 数据库基础状态只需表达主数据生命周期，如 `active / archived`
- `healthy / pending_config / error` 应由 service 聚合计算得出

## 9. 字段定义与 PRD 规则说明

### 9.1 列表页字段定义

#### 项目名称

定义：项目主名称。

展示规则：

- 必显
- 点击进入详情页
- 下方显示 Slug 弱文案

#### 所属组织

定义：项目所属组织名称。

展示规则：

- 必显
- 用于跨组织管理场景筛选和识别

#### 状态

定义：面向列表页展示的项目综合状态。

枚举：

- `healthy`
- `pending_config`
- `archived`
- `error`

中文文案：

- 正常
- 待配置
- 已归档
- 异常

#### 配置完成度

定义：项目是否具备执行基本条件的完成比例。

当前建议固定 6 个检查项：

- 环境
- 仓库
- 凭证
- 成员
- 默认环境
- 审批策略

字段：

- `completedCount`
- `totalRequiredCount`
- `completionPercent`

#### 风险提示

定义：阻碍执行或影响治理的显式问题标签。

字段：

- `risks: string[]`

建议文案枚举：

- 无环境
- 无仓库
- 无凭证
- 无成员
- 无默认环境
- 审批未绑定
- 预算未配置
- 预算预警
- 预算限流
- 凭证已过期

#### 任务 / 审批摘要

字段：

- `runningTasks`
- `pendingApprovals`
- `failedTasksToday`

#### 最近活跃时间

字段：

- `lastActivityAt`

口径建议：

- 优先取最近任务或审批相关活动时间
- 无活动时回退到项目更新时间
- 再无更新时间时回退到创建时间

### 9.2 项目状态判定规则

建议按如下顺序判定：

1. 若项目基础状态为 `archived`，则 `projectStatus = archived`
2. 若存在阻断性异常，则 `projectStatus = error`
3. 若关键配置不全，则 `projectStatus = pending_config`
4. 其余为 `projectStatus = healthy`

#### 阻断性异常建议包括

- 预算状态为 `throttle` 或 `blocked`
- 项目默认凭证已过期且没有其他可用默认凭证
- 项目设置存在非法引用，如默认环境不存在

#### 关键配置不全建议包括

- 无环境
- 无仓库
- 无有效凭证
- 无项目成员
- 无默认环境
- 无审批策略

### 9.3 配置状态筛选规则

`configStatus` 建议规则：

- `configured`：无缺项，且无风险标签
- `pending`：存在关键配置缺项
- `risk`：存在治理风险或阻断性异常

注意：

- `pending` 和 `risk` 可同时存在，但筛选时建议以后端定义优先级输出一个主分类

### 9.4 风险标签显示规则

列表显示规则：

- 最多展示 2 个标签
- 其余显示 `+N`
- 高优先级风险优先展示

建议优先级从高到低：

1. 预算限流
2. 凭证已过期
3. 无凭证
4. 无仓库
5. 无默认环境
6. 审批未绑定
7. 无环境
8. 无成员
9. 预算未配置

### 9.5 快速配置规则

快速配置按钮的目标不是浏览，而是补齐最关键缺口。

优先跳转规则：

1. 有 `凭证已过期` 或 `无凭证`，跳 `credentials`
2. 有 `无仓库`，跳 `repositories`
3. 有 `无环境`，跳 `environments`
4. 有 `无默认环境` 或 `审批未绑定` 或 `预算未配置`，跳 `settings`
5. 无明显缺口，跳 `overview`

### 9.6 权限规则

列表级权限：

- 可见项目范围沿用现有项目可见性规则
- 搜索与筛选仅在用户可见项目集合内生效

操作权限：

- 新建项目：`platform_admin / org_admin`
- 编辑项目：`platform_admin / org_admin / project_admin`
- 归档项目：`platform_admin / org_admin / project_admin`
- 查看详情：可见即允许
- 快速配置：可见即允许，但仅有管理权限的用户可落到可编辑界面

## 10. 落地步骤建议

### 10.1 第一阶段

- Service 新增 `/api/projects/overview`
- BFF 透传 `/api/projects/overview`
- Web UI 的 `Projects.vue` 增加筛选、摘要、总览表格
- 新增快速配置跳转逻辑

### 10.2 第二阶段

- Service 增加项目归档基础字段与归档接口
- Web UI 增加“归档项目”操作
- 列表支持归档状态筛选

### 10.3 第三阶段

- 增加导出
- 增加批量操作
- 增加更多治理摘要字段，如预算、失败任务趋势等

## 11. 验收标准

完成后应满足以下标准：

1. 用户在不进入详情页的情况下，能判断项目是否可投入使用。
2. 用户能在 10 秒内筛出待配置项目和风险项目。
3. 用户能从风险提示直接跳到对应配置位置。
4. 现有新建项目、编辑项目、进入详情页能力不回退。
5. 列表视图的状态、风险、完成度口径在前后端保持一致。
6. 项目总览接口不要求前端发起多路聚合请求。

## 12. 建议的后续实现拆分

建议拆为以下任务：

- Task 1：扩展项目数据模型，支持项目归档基础状态
- Task 2：Service 实现项目总览聚合查询接口
- Task 3：BFF 透传项目总览接口
- Task 4：Web UI 改造 `Projects.vue`
- Task 5：补充项目列表页测试与筛选行为验证
