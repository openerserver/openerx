# OpenerX 代码库功能实施蓝图

> runtime 状态说明：当前默认 backend 已切到 `pi-mono` runtime-provider。本文中“执行层 / runtime”默认指 runtime backend；涉及 OpenCode 的地方应理解为 legacy 适配、事件兼容或回退链路，而不是当前默认主链。
>
> 适用范围：OpenerX 控制平面新增“代码库感知与治理”能力
>
> 本文档是统一重排后的实施蓝图，目标是让系统在不打破“控制平面治理 + 运行时执行”边界的前提下，逐步具备仓库登记、任务绑定、代码变更感知和治理接入能力。

## 1. 文档目标

本文档回答以下问题：

- 代码库功能的边界到底是什么
- 为什么原方案需要重排
- 应该按什么阶段建设
- 每一阶段需要哪些表、API、页面和运行时适配
- 每一阶段的验收标准是什么

本文档是开发实施蓝图，不是产品宣讲稿，也不是远期愿景文档。

## 2. 设计边界

### 2.1 目标边界

本次建设新增的是以下四类能力：

- 仓库登记：项目下有哪些代码仓库
- 任务绑定：某个任务针对哪个仓库、哪个工作区、哪个基线版本执行
- 变更感知：任务执行后改了哪些文件，是否形成 commit、分支等补充信息
- 治理接入：高风险代码变更进入审批、审计和策略控制链路

### 2.2 非目标边界

本次建设明确不包括：

- 不做完整代码浏览器
- 不做 Git 客户端替代品
- 不把控制平面做成直接执行 git 的地方
- 不在第一阶段就做 PR 平台集成
- 不把运行机上的本地目录绝对路径当作仓库主数据

### 2.3 与现有架构的关系

仍遵守当前系统边界：

- 控制平面负责主数据、治理事实、审批、审计、预算
- BFF 负责前端聚合、运行时适配、事件汇总
- runtime backend（当前默认 `pi-mono` runtime-provider）仍是实际执行代码修改和命令调用的执行层

换句话说，控制平面负责“知道发生了什么”和“治理是否允许”，而不是“自己去执行 git / 编辑代码”。

## 3. 现状问题

当前系统中已经有：

- 项目、环境、用户、策略、预算等控制面主数据
- 任务、DAG 节点、Agent Run 等执行追踪
- runtime backend 事件聚合，以及 legacy OpenCode SSE 的兼容映射能力
- 高风险操作审批与审计能力

当前系统中缺少：

- 项目与代码仓库的显式关联
- 任务与仓库/工作区/基线版本的显式绑定
- 代码文件级变更事实模型
- 分支、commit、PR 的业务可见性
- 针对代码变更的治理闭环

这意味着系统目前只能“知道任务执行了”，却不能稳定回答：

- 这次任务针对哪个仓库
- 它在什么基线上修改
- 它具体改了哪些文件
- 哪些变更应该被审批或阻断

## 4. 统一重排后的建设顺序

统一后的阶段顺序如下：

1. 仓库登记
2. 任务绑定
3. 代码变更感知
4. 治理接入
5. 分支与 PR 协作增强
6. 凭证与外部 Provider 深度集成

其中前四阶段是本轮实施蓝图的主体，后两阶段是后续扩展。

## 5. Phase A：仓库登记

### 5.1 目标

先解决“项目下有哪些仓库”这个基础事实问题。

阶段目标：

- 项目可以登记一个或多个仓库
- 控制平面可以管理仓库基础元数据
- 仓库成为任务绑定的可选目标

### 5.2 数据模型

新增表：`repositories`

建议字段：

```ts
repositories = {
  id: string,
  projectId: string,
  name: string,
  provider: "github" | "gitlab" | "gitea" | "local",
  remoteUrl: string,
  defaultBranch: string,
  description: string | null,
  status: "active" | "archived" | "error",
  createdAt: string,
  updatedAt: string,
}
```

设计约束：

- `remoteUrl` 是仓库逻辑地址，不是本地工作目录
- 不在这一阶段把 `localPath` 作为仓库主字段
- 不在这一阶段引入凭证内容字段

### 5.3 服务端改造

控制平面服务新增 `repositories` 模块：

- `GET /api/projects/:projectId/repositories`
- `POST /api/projects/:projectId/repositories`
- `PATCH /api/projects/:projectId/repositories/:repoId`
- `DELETE /api/projects/:projectId/repositories/:repoId`

BFF 增加透传与聚合路由：

- `GET /api/repositories?projectId=...`
- `POST /api/repositories`
- `PATCH /api/repositories/:repoId`
- `DELETE /api/repositories/:repoId`

### 5.4 前端改造

项目详情页新增“代码仓库”标签：

- 仓库列表
- 添加仓库弹窗
- 编辑仓库弹窗
- 归档/删除动作

列表字段建议：

- 名称
- Provider
- Remote URL
- 默认分支
- 状态
- 最近更新时间

### 5.5 验收标准

- 项目下可创建、编辑、删除仓库记录
- 非本项目成员无法访问仓库接口
- 任务创建时可以拿到该项目的仓库列表
- 仓库数据在 DB 中成为稳定主数据

### 5.6 开发任务清单

#### A1. 数据库迁移

目标：新增仓库主数据表，并完成最小索引与约束。

任务清单：

- 在 [control-plane/service/src/db/schema.ts](../../control-plane/service/src/db/schema.ts) 中新增 `repositories` 表定义
- 为 `repositories.projectId` 建立外键，关联 `projects.id`
- 为 `repositories` 增加唯一性约束建议：`projectId + name`、`projectId + remoteUrl`
- 为 `status` 设定枚举值：`active`、`archived`、`error`
- 生成 Drizzle migration 文件
- 在本地数据库执行迁移并验证表结构

交付物：

- schema 代码更新
- 新 migration 文件
- 本地迁移验证记录

#### A2. 控制平面服务接口

目标：提供仓库主数据 CRUD 接口。

任务清单：

- 新增模块目录 `control-plane/service/src/modules/repositories/`
- 新增 `routes.ts`，实现：
  - `GET /api/projects/:projectId/repositories`
  - `POST /api/projects/:projectId/repositories`
  - `PATCH /api/projects/:projectId/repositories/:repoId`
  - `DELETE /api/projects/:projectId/repositories/:repoId`
- 为创建接口增加输入校验：
  - `name` 非空
  - `provider` 在允许枚举内
  - `remoteUrl` 为合法仓库地址格式
  - `defaultBranch` 默认 `main`
- 删除动作采用“软删除/归档优先”，先改 `status=archived`，不直接物理删除
- 在服务端根据 JWT / project role 增加项目级访问控制
- 将 `repositories` 模块挂载到服务主路由

交付物：

- 仓库 CRUD API
- 基本权限校验
- 输入校验错误响应

#### A3. BFF 聚合接口

目标：前端继续只访问 BFF，不直接访问控制平面服务。

任务清单：

- 在 `control-plane/web-ui-bff/src/modules/` 下新增 `repositories` 模块
- 实现 BFF 路由：
  - `GET /api/repositories?projectId=...`
  - `POST /api/repositories`
  - `PATCH /api/repositories/:repoId`
  - `DELETE /api/repositories/:repoId`
- 统一把前端请求映射到控制平面服务的项目级 API
- 复用现有鉴权与 `cpFetch` 风格，保持错误格式一致
- 确保 BFF 对无权限项目返回统一 403 响应

交付物：

- 前端可调用的仓库 API
- 与现有 BFF 错误模型一致的响应格式

#### A4. Web UI 页面改造

目标：在项目详情页提供仓库管理入口。

任务清单：

- 在项目详情页组件中新增“代码仓库”标签页
- 新增仓库列表展示区块
- 新增“添加仓库”弹窗表单，字段包括：
  - 名称
  - Provider
  - Remote URL
  - 默认分支
  - 描述
- 新增“编辑仓库”弹窗
- 新增“归档仓库”操作
- 在项目切换时自动刷新仓库列表
- 对空状态、错误状态、加载状态补齐页面反馈

交付物：

- 项目详情页仓库管理能力
- 可用的表单交互与错误提示

#### A5. 联调与验收

目标：确认仓库主数据链路端到端可用。

任务清单：

- 使用项目管理员账号创建仓库
- 用开发者账号验证只读或受限行为是否符合预期
- 校验仓库列表能在项目维度正确隔离
- 校验归档仓库后默认不出现在“可选任务仓库”列表中
- 补充至少一条 API 测试或模块测试

交付物：

- 端到端手工验证结果
- 最低限度自动化测试

## 6. Phase B：任务绑定

### 6.1 目标

解决“这个任务到底在改哪个仓库、哪个工作区、基于哪个版本”的问题。

阶段目标：

- 任务启动前明确选择目标仓库
- 任务启动时固化运行上下文
- 后续所有变更、审计、审批都基于这个绑定关系

### 6.2 数据模型

优先采用“直接扩展 tasks 表”的方式，避免过早引入过多中间表。

为 `tasks` 新增字段：

```ts
tasks = {
  ...existing,
  repoId: string | null,
  workspaceRoot: string | null,
  baseRevision: string | null,
  workingBranch: string | null,
}
```

字段说明：

- `repoId`：任务针对哪个仓库
- `workspaceRoot`：本次运行实际绑定到哪个工作区根目录
- `baseRevision`：任务开始时的基线 revision，可为 commit SHA 或逻辑标识
- `workingBranch`：任务运行时的工作分支，可为空

### 6.3 运行时适配

BFF 在创建会话和发送 prompt 时，需要把仓库绑定信息注入上下文：

- Project ID
- Repository ID
- Remote URL
- Workspace Root
- Base Revision
- Working Branch

同时需要记录运行时返回的 `directory` 与任务绑定关系，用于后续 diff 和 graph 文件发现。

### 6.4 服务端改造

任务创建接口调整：

- `POST /api/tasks`
- 请求体新增 `repoId`

任务详情接口返回新增字段：

- `repoId`
- `workspaceRoot`
- `baseRevision`
- `workingBranch`

### 6.5 前端改造

任务创建表单新增：

- 目标仓库选择器
- 可选的目标分支输入框

任务详情页新增“代码上下文”区块：

- 目标仓库
- 运行工作区
- 基线版本
- 工作分支

### 6.6 验收标准

- 任务创建时必须能选择仓库
- 新任务保存后可查询到仓库绑定信息
- BFF 能在运行时上下文中注入该绑定
- 任务详情页可以稳定展示代码上下文

### 6.7 开发任务清单

#### B1. 数据库迁移

目标：让任务具备稳定的代码上下文字段。

任务清单：

- 在 [control-plane/service/src/db/schema.ts](../../control-plane/service/src/db/schema.ts) 的 `tasks` 表新增字段：
  - `repoId`
  - `workspaceRoot`
  - `baseRevision`
  - `workingBranch`
- `repoId` 建立到 `repositories.id` 的外键引用
- 为 `tasks.repoId` 建索引，便于按仓库查询任务
- 生成 Drizzle migration 文件
- 执行迁移并验证老数据兼容性，确保历史任务允许 `repoId` 为空

交付物：

- 更新后的 `tasks` schema
- migration 文件
- 历史数据兼容验证记录

#### B2. 控制平面服务接口改造

目标：任务 API 正式接受并返回仓库绑定信息。

任务清单：

- 修改任务创建接口输入模型，支持 `repoId` 与可选 `workingBranch`
- 在创建任务时校验：
  - `repoId` 属于当前 `projectId`
  - 仓库状态为 `active`
- 修改任务详情接口，返回：
  - `repoId`
  - `workspaceRoot`
  - `baseRevision`
  - `workingBranch`
- 修改任务列表接口，至少返回 `repoId` 和仓库名称摘要，便于前端列表展示
- 若当前项目没有仓库而前端仍提交任务，返回明确的 400/422 错误

交付物：

- 支持仓库绑定的任务 API
- 任务读取接口的代码上下文扩展字段

#### B3. BFF 任务创建与运行时适配

目标：BFF 在任务进入 runtime backend（当前默认 `pi-mono`；兼容旧 OpenCode 路径）前注入仓库上下文，并在任务启动后回填运行时字段。

任务清单：

- 修改 BFF 任务创建/执行链路，向控制平面读取任务绑定的仓库信息
- 在发送给 runtime 的 prompt 中附加执行上下文：
  - Project ID
  - Repository ID
  - Remote URL
  - Working Branch
- 结合 runtime 返回的 `directory` 回填 `workspaceRoot`
- 在任务开始阶段记录 `baseRevision`，策略如下：
  - 优先从运行时或 git 查询得到当前 HEAD
  - 取不到时先留空，不阻断任务创建
- 对无 `repoId` 的历史任务，保持兼容，不影响旧链路

交付物：

- BFF 对 runtime 的代码上下文注入
- 任务运行后 `workspaceRoot/baseRevision` 的回填逻辑

#### B4. Web UI 任务创建页面改造

目标：用户在创建任务时明确选择仓库。

任务清单：

- 在任务创建入口新增仓库选择器
- 根据当前项目动态加载可用仓库列表
- 若项目无可用仓库，显示空状态引导，跳转到项目详情页仓库配置
- 新增可选 `workingBranch` 输入框
- 创建任务提交时把 `repoId` 和 `workingBranch` 一起提交
- 对仓库选择、权限失败、仓库被归档等场景补齐错误提示

交付物：

- 带仓库绑定的任务创建交互
- 完整的空状态和错误反馈

#### B5. Web UI 任务详情页改造

目标：任务详情页可稳定展示代码上下文。

任务清单：

- 在任务详情页新增“代码上下文”信息区块
- 展示字段包括：
  - 仓库名称
  - Remote URL 摘要
  - Working Branch
  - Workspace Root
  - Base Revision
- 对历史任务或未绑定仓库的任务显示兼容文案
- 对运行中尚未回填 `workspaceRoot/baseRevision` 的任务显示“待采集”状态

交付物：

- 可展示仓库绑定结果的任务详情页
- 对旧任务和运行中任务的兼容显示

#### B6. 联调与验收

目标：验证任务绑定在创建、执行、展示三个阶段都正确。

任务清单：

- 以带仓库项目创建新任务，确认 DB 正确落 `repoId`
- 启动任务后检查 `workspaceRoot` 是否被运行时回填
- 验证任务详情页展示与 DB 内容一致
- 验证历史无仓库任务仍可正常访问详情页
- 补充至少一条任务 API 测试和一条 BFF 适配测试

交付物：

- 端到端联调结果
- 自动化测试补充

### 6.8 建议排期与依赖

建议按以下依赖顺序推进：

1. 先完成 Phase A 的 `repositories` 表与仓库 CRUD
2. 再做 `tasks` 表迁移，新增仓库绑定字段
3. 然后改控制平面任务 API
4. 再改 BFF 的任务创建与 runtime 注入逻辑
5. 最后改任务创建页与任务详情页

原因：

- 没有仓库主数据，就无法正确绑定任务
- 没有任务绑定字段，BFF 无法稳定注入运行时上下文
- 没有后端返回字段，前端页面只能做临时拼装，后续会返工

## 7. Phase C：代码变更感知

### 7.1 目标

解决“本次任务到底改了什么”这个核心问题。

这里的关键原则是：

**代码变更的主事实源应优先是文件级变更，而不是 git commit。**

原因：

- Agent 可能修改文件但未提交
- Agent 可能只通过 `hashline_edit` 或 `edit_file` 改文件
- Agent 可能中途失败但留下未提交工作区变更

### 7.2 数据模型

新增表：`code_changes`

```ts
codeChanges = {
  id: string,
  taskId: string,
  repoId: string,
  agentRunId: string | null,
  changeSource: "runtime_diff" | "task_snapshot" | "git_commit",
  summary: string | null,
  createdAt: string,
}
```

新增表：`file_changes`

```ts
fileChanges = {
  id: string,
  changeId: string,
  filePath: string,
  changeType: "added" | "modified" | "deleted" | "renamed",
  oldPath: string | null,
  insertions: number,
  deletions: number,
}
```

可选补充字段：

- `language`
- `riskTag`
- `isCriticalPath`

### 7.3 数据来源策略

采用“主事实源 + 辅助事实源”的策略。

主事实源：

- Runtime diff / session diff
- Task snapshot
- Agent 执行结果中的文件变更信息

辅助事实源：

- shell 中识别到的 git commit / branch 命令
- 任务完成后的 `git diff` / `git log` 补采

不要把“解析 shell 里的 git commit”作为唯一方案。

### 7.4 BFF 改造

在 BFF 中新增变更采集流程：

1. 监听 `tool.execute.after`
2. 对文件编辑类工具结果做结构化采集
3. 在任务完成时触发一次变更归档
4. 若存在 git 信息则作为补充元数据挂入同一条 change 记录

新增接口：

- `GET /api/tasks/:taskId/changes`
- `GET /api/tasks/:taskId/changes/:changeId/files`

### 7.5 前端改造

任务详情页新增“代码变更”标签：

- 变更摘要卡片
- 文件级变更列表
- 新增/删除行统计
- 关联的 Agent Run

第一阶段不要求：

- 内置完整 diff viewer
- 行级 review 功能

### 7.6 验收标准

- 完成一个会修改代码的任务后，任务详情页能看到文件级变更
- 即便没有 `git commit`，仍能看到变更摘要
- 若任务产生 commit，commit 信息能作为补充展示
- 变更数据能和任务、Agent Run、仓库正确关联

## 8. Phase D：治理接入

### 8.1 目标

把代码变更纳入现有审批、审计和策略体系，而不是停留在“看见变更”。

### 8.2 接入原则

优先治理高风险代码变更，不优先做 PR 平台能力。

优先场景：

- 修改关键目录
- 一次任务变更过多文件
- 涉及生产配置或部署脚本
- 触发高等级 git 操作，如 push / force push

### 8.3 风险判定规则

可先基于已有 `policy_templates` 建立简单规则：

- 关键目录白名单/黑名单
- 单次变更文件数阈值
- 单次新增/删除行阈值
- 是否涉及环境级敏感文件

当触发规则时：

- 创建 `approval_tickets`
- 写入 `audit_events`
- 必要时阻断后续执行或推送动作

### 8.4 服务端改造

新增治理评估流程：

1. 任务结束后读取 `file_changes`
2. 根据规则判定风险等级
3. 生成审计事件
4. 对命中的高风险情况创建审批单

### 8.5 前端改造

任务详情页新增治理摘要：

- 本次变更风险等级
- 是否触发审批
- 关联审批单入口
- 命中的策略规则

审批页无需重构，只需支持从代码变更场景跳转进来。

### 8.6 验收标准

- 修改高风险目录能触发审批单
- 风险评估结果能在任务详情页可见
- 审计日志能追溯到任务、仓库和文件变更

## 9. 后续扩展阶段

以下能力不纳入本轮核心实施，但需要为后续预留扩展位：

### 9.1 分支与 PR 协作增强

后续再考虑：

- `branches` 表
- `pull_requests` 表
- GitHub/GitLab webhook 同步
- 自动创建 PR 建议

前提是前四阶段已经稳定运行。

### 9.2 凭证与 Provider 集成

后续再考虑：

- 仓库访问凭证托管
- 用户级或项目级凭证模型
- 外部代码托管平台 token 生命周期管理

这部分复杂度高，不应前置。

## 10. 模块改造清单

### 10.1 控制平面服务

新增模块：

- `repositories`
- `code-changes`

调整模块：

- `tasks`
- `approvals`
- `audit`
- `policies`

### 10.2 BFF

新增能力：

- 仓库 API 聚合
- 任务变更查询 API
- 任务完成后的代码变更归档逻辑
- 风险评估触发逻辑

调整模块：

- `tasks`
- `agent-control`
- `realtime`

### 10.3 Web UI

新增页面能力：

- 项目详情页“代码仓库”标签
- 任务详情页“代码上下文”区块
- 任务详情页“代码变更”标签
- 任务详情页“治理摘要”区块

## 11. API 草案

### 11.1 仓库接口

```http
GET    /api/repositories?projectId=:projectId
POST   /api/repositories
PATCH  /api/repositories/:repoId
DELETE /api/repositories/:repoId
```

### 11.2 任务接口扩展

```http
POST /api/tasks
{
  title,
  prompt,
  projectId,
  repoId,
  workingBranch?
}
```

```http
GET /api/tasks/:taskId
=> {
  ...task,
  repoId,
  workspaceRoot,
  baseRevision,
  workingBranch
}
```

### 11.3 代码变更接口

```http
GET /api/tasks/:taskId/changes
GET /api/tasks/:taskId/changes/:changeId/files
```

### 11.4 审批与审计联动

无需新增单独入口，复用已有：

```http
GET  /api/approvals
POST /api/approvals/:ticketId/resolve
GET  /api/audit-events
```

## 12. 里程碑建议

### M1：仓库主数据可用

- `repositories` 表和 CRUD API 完成
- 项目详情页仓库管理可用
- 任务创建可选择仓库

### M2：任务代码上下文可追踪

- 任务表补充代码上下文字段
- 任务详情页能展示仓库、工作区、基线版本

### M3：文件级变更可见

- `code_changes` / `file_changes` 落库
- 任务详情页展示变更摘要和文件列表

### M4：高风险变更进入治理闭环

- 风险规则生效
- 审批和审计链路打通

## 13. 实施顺序建议

推荐按以下顺序开发：

1. DB schema 与 migration
2. 控制平面服务模块与 API
3. BFF 聚合与运行时适配
4. Web UI 页面与状态改造
5. 变更采集与风险评估逻辑
6. 联调与验收

原因：

- 没有主数据和任务绑定，前端页面无法稳定建立语义
- 没有 BFF 的任务-运行时桥接，变更采集无法落地
- 没有文件级变更事实源，治理规则无法准确命中

## 14. 风险与对策

### 风险 1：运行时 diff 信息不稳定

对策：

- 采用“主事实源 + 辅助事实源”双层采集
- 允许任务完成后做一次补采归档

### 风险 2：本地工作目录语义漂移

对策：

- 不把 `localPath` 作为仓库主字段
- 仅把 `workspaceRoot` 记录为任务运行时上下文

### 风险 3：变更感知过晚，前端看不到实时结果

对策：

- 先支持任务完成后的稳定展示
- 实时流式代码变更展示留到后续增强

### 风险 4：方案过早扩展为 PR 平台

对策：

- 本轮只做仓库、任务绑定、文件变更、治理接入
- 分支和 PR 作为后续阶段

## 15. 验收清单

### 功能验收

- 项目可管理仓库
- 任务可绑定仓库
- 任务详情页可查看代码上下文
- 完成任务后可查看代码变更摘要
- 高风险代码变更可触发审批

### 数据一致性验收

- 代码变更能准确关联到任务和仓库
- 任务上下文和运行时工作目录一致
- 审批单能追溯到代码变更事实

### 边界验收

- 控制平面不直接承担 git 执行职责
- BFF 仍是前端唯一入口
- runtime backend（默认 `pi-mono`）仍是执行层

## 16. 一页式结论

本蓝图的核心不是“给系统加一个 Git 功能”，而是让 OpenerX 在保持现有架构边界的前提下，逐步获得对代码仓库和代码变更的可见性与治理能力。

正确顺序不是先做 PR 或分支管理，而是：

- 先登记仓库
- 再绑定任务
- 再感知变更
- 最后接入治理

这样可以以最小风险补齐控制平面对“代码”这一核心执行对象的感知能力，并为后续分支、PR、凭证、外部 Provider 集成打下稳定基础。
