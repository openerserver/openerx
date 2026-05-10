# AI 驱动众包开发平台开发计划

> 状态：2026-05-10 首版开发计划
>
> 输入方案：[ai_crowdsourced_development_platform.md](../../ai_crowdsourced_development_platform.md)
>
> 适用范围：OpenerX Control Plane、BFF、Web UI、runtime backend、preview/runtime fleet、治理与贡献者系统

## 1. 计划目标

本文把“AI 驱动的众包软件开发平台”方案拆成可执行研发计划。

目标不是一次性开发完整的 x.com、亚马逊或 eBay，而是先在 OpenerX 现有控制平面上跑通一个可验证闭环：

```text
任务发布
  -> 贡献者领取
  -> 系统创建隔离 workspace / branch
  -> AI 分步修改
  -> 每步生成 commit
  -> 每个 commit 有可审查记录和可运行 preview
  -> 提交 Change Request
  -> 自动测试 / 风险评分 / owner 审核
  -> 合并 main 或要求修改
  -> 奖励结算 / 信誉更新
```

核心验收口径：

1. 陌生贡献者不能绕过任务边界、权限、审核和 runtime 隔离。
2. AI 的每一步修改都能追踪到任务、用户、session、commit、diff、测试、preview 和审计日志。
3. 管理员和模块负责人能基于风险、owner、预览和测试结果做审核决定。
4. 合并前后都能追责、回滚、复盘和计算奖励。

## 2. 当前仓库基础

当前 OpenerX 已具备一部分平台底座，不需要推倒重建：

| 能力 | 当前锚点 | 计划用法 |
| --- | --- | --- |
| 任务系统 | `control-plane/service/src/modules/project-tree/routes.ts`、`control-plane/web-ui/src/pages/Tasks.vue`、`TaskDetailV3.vue` | 扩展成任务市场、领取、边界、验收标准入口 |
| 运行态 / session | `docs/task-domain/README.md`、`control-plane/service/src/modules/tasks/*` | 作为 AI session、commit 链和执行痕迹的 canonical 基础 |
| 代码变更记录 | `control-plane/service/src/modules/code-changes/routes.ts` | 从“变更记录”升级为每步 commit 的事实表 |
| Change Request | `control-plane/service/src/modules/developer-change-requests/routes.ts` | 从 developer request 扩展为对外贡献审核主对象 |
| 审批 | `control-plane/service/src/modules/approvals/routes.ts`、`control-plane/web-ui/src/pages/Approvals.vue` | 作为管理员 / owner 审核入口 |
| 治理与风险 | `control-plane/service/src/modules/governance/risk-engine.ts` | 扩展为 code ownership、策略引擎、敏感路径保护 |
| runtime backend | `docs/runtime/README.md` | 先接入 commit preview，再演进为 runtime fleet |
| BFF / Web UI | `control-plane/web-ui-bff`、`control-plane/web-ui` | 聚合任务、runtime、preview、审核、贡献者视图 |
| Go Control Plane | `control-plane/service-go` | 作为规模化替换路径，按既有 parity gate 继续保持兼容 |

技术策略：

1. 保留当前 Vue + BFF + Control Plane 架构，不因为方案里出现 Next.js / NestJS 就重写前端或服务端。
2. 新能力优先落在现有任务、变更、审批、治理、runtime 边界上。
3. 面向规模化的 Go Control Plane 继续作为平行实现，所有关键 API 都需要保持 TS/Bun service 与 Go service 的兼容。
4. runtime fleet 先做 Docker / 本机 provider 验证闭环，再引入 CubeSandbox / microVM / warm pool。

## 3. 产品边界

平台必须拆成两个系统，不混用生产环境：

1. 众包开发平台
   - Task Marketplace
   - Git Workspace
   - AI Commit Agent
   - Commit Runtime Fleet
   - Preview Gateway
   - Change Request Review
   - Code Ownership
   - Policy Engine
   - Reputation / Reward System

2. 被开发的目标网站
   - 第一阶段只做 marketplace skeleton。
   - 包含注册登录、商品列表、商品详情、搜索、收藏、购物车、模拟订单、管理员后台。
   - 不接真实支付、真实物流、真实用户数据、生产 secret。

第一阶段的目标网站应作为样板项目接入 OpenerX，而不是直接把它和 OpenerX 控制平面耦合在一起。

## 4. 阶段路线

### Phase 0：方案固化与差距盘点

目标：把方案变成工程边界和表结构差距清单。

交付物：

1. 统一术语表：Task、Assignment、Workspace、AI Session、Commit Step、Commit Runtime、Preview、Change Request、Review、Reward。
2. 当前 API / schema gap 清单。
3. MVP 用户旅程图：管理员、贡献者、模块负责人、核心管理员。
4. 样板 marketplace skeleton 的仓库与模块边界定义。

关键任务：

| 编号 | 任务 | 产出 |
| --- | --- | --- |
| P0-01 | 梳理现有 task/session/message/code-change/approval 表与 API | `docs/architecture` 下补 gap 文档 |
| P0-02 | 定义任务边界 schema | allowedPaths、blockedPaths、acceptanceChecks、runtimeLevel、reward |
| P0-03 | 定义 code owner 配置格式 | repo/path pattern -> owner role/team |
| P0-04 | 定义 runtime level 映射规则 | level 1-5 与任务风险、路径、测试类型绑定 |

验收：

1. 新增文档能回答“现有代码哪些可复用、哪些缺失”。
2. 后续所有阶段的表结构和 API 都能追溯到该差距清单。

### Phase 1：内部闭环 MVP

目标：内部用户可以完成“任务 -> AI 分步 commit -> CR -> 审核”的最小闭环。

范围：

1. 只面向内部用户或可信贡献者。
2. runtime preview 可以先是 level 1 / level 2。
3. 合并 main 可以先走人工 git 操作或受控服务端命令，但必须有审计记录。

后端任务：

| 编号 | 模块 | 任务 |
| --- | --- | --- |
| P1-01 | Control Plane | 扩展任务创建：保存允许路径、禁止路径、验收测试、目标 runtime level、奖励配置 |
| P1-02 | Control Plane | 增加任务领取 / 释放 / 过期接口，限制一个任务的活跃贡献者 |
| P1-03 | BFF / runtime | 创建任务 workspace：生成 branch、绑定用户、任务、AI session |
| P1-04 | BFF / runtime | AI 每完成一步后调用 `create_commit`，生成 commit step 记录 |
| P1-05 | Control Plane | 扩展 `codeChanges`：commitSha、parentCommitSha、stepIndex、testStatus、previewStatus、riskLevel |
| P1-06 | Control Plane | 将 `developerChangeRequests` 升级为 CR 主流程：提交、撤回、要求修改、批准、拒绝 |
| P1-07 | Governance | 每个 commit 自动调用风险评分，命中高风险时自动创建 approval ticket |
| P1-08 | Audit | 记录 workspace 创建、AI tool call、commit、test、preview、CR、审核动作 |

前端任务：

| 编号 | 页面 | 任务 |
| --- | --- | --- |
| P1-UI-01 | Tasks | 增加任务市场字段：边界、奖励、领取状态、风险等级 |
| P1-UI-02 | TaskDetailV3 | 展示 commit step 时间线、diff summary、测试结果、preview 入口 |
| P1-UI-03 | TaskDetailV3 | 增加“提交审核 / 回退到上一步 / 放弃任务”操作 |
| P1-UI-04 | Approvals | 展示 CR 详情、commit 链、风险项、owner 要求、审核操作 |

验收命令：

```bash
bun run test:service
bun run test:bff
bun run test:ui
```

若涉及 Go Control Plane 兼容：

```bash
bun run test:service-go
TEST_CP_URL=http://127.0.0.1:4097 bun run test:service-go:contract
```

验收标准：

1. 管理员能创建带路径边界和验收标准的任务。
2. 贡献者领取任务后系统自动创建隔离 branch / workspace。
3. AI 至少完成 2 个 commit step，每个 step 有 diff、测试状态、风险评分和审计记录。
4. 贡献者能提交 CR。
5. 管理员能批准或要求修改，所有动作可在 audit 中追踪。

### Phase 2：Commit Preview 与 Preview Gateway

目标：每个 commit 都能生成可访问 preview，但按 runtime level 控制成本。

后端 / runtime 任务：

| 编号 | 模块 | 任务 |
| --- | --- | --- |
| P2-01 | Control Plane | 新增 `commit_runtimes` 记录：commit、level、provider、status、url、ttl、logs |
| P2-02 | BFF | 增加 preview request API，按用户权限返回 preview URL |
| P2-03 | Runtime | 支持 level 1 组件预览和 level 2 页面预览 |
| P2-04 | Runtime | 增加测试结果、启动日志、运行日志采集 |
| P2-05 | Preview Gateway | 最小代理：鉴权、路由、未启动时触发启动、访问日志、安全 header |
| P2-06 | Scheduler | 最新 commit 自动保持 warm，历史 commit 按需启动并定时回收 |

前端任务：

| 编号 | 页面 | 任务 |
| --- | --- | --- |
| P2-UI-01 | TaskDetailV3 | commit step 上展示 preview 状态、启动中、失败、打开 |
| P2-UI-02 | Approvals | 审核页支持逐 commit 打开 preview |
| P2-UI-03 | MultiTaskMonitor | 展示 runtime 队列、warm 数量、失败原因、成本估算 |

验收标准：

1. 每个 commit step 都有 runtime 记录。
2. level 1 / level 2 preview 可打开，且只能被任务参与者、管理员、审核人访问。
3. preview 访问、启动、失败、回收都有审计或日志。
4. 历史 commit 不常驻运行，打开时可按需启动。

### Phase 3：外部贡献者与任务市场

目标：外部用户可以领取低风险任务，但不能越权修改核心模块。

后端任务：

| 编号 | 模块 | 任务 |
| --- | --- | --- |
| P3-01 | Auth / Users | 在现有注册登录基础上增加贡献者资料、实名/绑定状态、封禁状态 |
| P3-02 | Contributor | 新增贡献者等级 L0-L5、可领取任务等级、每日配额 |
| P3-03 | Marketplace | 任务发布、领取、竞标、锁定、超时释放 |
| P3-04 | Policy | 任务领取前校验等级、路径、模块风险、历史信誉 |
| P3-05 | Code Ownership | path pattern -> owner/team，CR 自动分配审核人 |
| P3-06 | Quota | 限制 workspace 数、runtime 时长、preview 访问频率 |

前端任务：

| 编号 | 页面 | 任务 |
| --- | --- | --- |
| P3-UI-01 | Tasks | 增加公开任务市场视图和“可领取 / 已锁定 / 审核中”状态 |
| P3-UI-02 | Users | 增加贡献者等级、风险记录、封禁入口 |
| P3-UI-03 | Approvals | 按 owner、风险等级、模块筛选 CR |
| P3-UI-04 | Dashboard | 增加待审 CR、活跃贡献者、runtime 成本、风险趋势 |

验收标准：

1. L1 新贡献者只能领取低风险任务。
2. 任务允许路径之外的修改会被阻断或强制标记为高风险。
3. 修改 owner 路径后，CR 自动要求对应模块负责人审核。
4. 外部用户无法访问其他贡献者 workspace、preview、日志和 secret。

### Phase 4：安全治理与策略引擎

目标：平台具备面向陌生人和 AI 的最小安全底线。

任务：

| 编号 | 模块 | 任务 |
| --- | --- | --- |
| P4-01 | Policy Engine | 将内置风险规则扩展为可配置策略：路径、权限、依赖、测试、runtime level |
| P4-02 | ABAC | 在 RBAC 外增加项目、任务、路径、等级、owner、风险上下文 |
| P4-03 | Secrets | runtime 默认无生产 secret；测试 secret 短期签发、按任务隔离 |
| P4-04 | Security Scan | 接入 dependency scan、secret scan、高风险 diff scan |
| P4-05 | Audit | 建立 append-only audit log 导出包，支持按 CR / commit / user 追踪 |
| P4-06 | Abuse | 注册、登录、领取、runtime 启动、preview 访问增加共享限流或网关限流 |

验收标准：

1. AI 不能修改权限、支付、认证、infra，除非任务显式授权且用户等级足够。
2. 任何高风险路径修改都会进入强制审批。
3. preview runtime 无法访问生产网络、生产数据库、云 metadata 和部署密钥。
4. 审计链能重建某个 CR 的完整操作时间线。

### Phase 5：高密度 Runtime Fleet

目标：大量 commit 能快速预览，成本可控。

任务：

| 编号 | 模块 | 任务 |
| --- | --- | --- |
| P5-01 | Runtime Scheduler | 根据 runtime level、队列、配额、热度选择 host 和 provider |
| P5-02 | Snapshot | dependency snapshot、source snapshot、Git object database 复用 |
| P5-03 | Warm Pool | 按项目模板维护 warm runtime 池 |
| P5-04 | Provider | Docker provider -> CubeSandbox / microVM provider 分阶段接入 |
| P5-05 | Cost | 记录 runtime 启动耗时、运行时长、资源、用户/任务成本 |
| P5-06 | Reliability | runtime 健康检查、自动回收、失败重试、日志保留策略 |

验收标准：

1. 新 commit preview 不需要重新 npm install / bun install。
2. 同项目同模板能复用依赖快照。
3. 最新 commit 热启动，历史 commit 冷启动但可恢复。
4. 管理员能看到 runtime 成本和异常来源。

### Phase 6：信誉、奖励与规模化运营

目标：平台能长期组织外部贡献者。

任务：

| 编号 | 模块 | 任务 |
| --- | --- | --- |
| P6-01 | Reputation | 通过率、拒绝率、风险次数、返工次数、完成速度、管理员评分 |
| P6-02 | Reward | 任务奖励、延迟结算、争议处理、违规扣减 |
| P6-03 | Bidding | 多人竞标任务、方案评审、只奖励被接受者 |
| P6-04 | Maintainer | 模块维护者工作台、owner 审核 SLA、长期模块承包 |
| P6-05 | Release | staging、发布审批、回滚流程、生产变更窗口 |

验收标准：

1. 奖励只在合并 main、审核通过、延迟观察期无严重问题后释放。
2. 信誉会影响任务可见性、可领取等级、runtime 配额和审核强度。
3. 模块维护者能管理自己模块的任务、CR、贡献者和 roadmap。

## 5. 数据模型增量

建议分批新增或扩展以下对象：

| 对象 | 用途 | 优先级 |
| --- | --- | --- |
| `task_boundaries` 或 task strategy 扩展 | 允许路径、禁止路径、验收、runtime level、奖励 | P1 |
| `task_assignments` | 领取、锁定、贡献者、过期、放弃 | P1 |
| `workspace_branches` | task/user/session/branch 绑定 | P1 |
| `commit_steps` | 每步 commit、顺序、summary、parent、状态 | P1 |
| `commit_runtimes` | commit preview 状态、URL、provider、TTL、日志 | P2 |
| `code_owners` | path pattern、owner team、审核要求 | P3 |
| `contributor_profiles` | 等级、信誉、配额、封禁 | P3 |
| `policy_rules` | 可配置治理规则 | P4 |
| `reward_ledger` | 奖励、冻结、释放、争议 | P6 |

短期可以复用现有 `tasks.strategy`、`codeChanges`、`approvalTickets`、`auditEvents` 做过渡，但 Phase 2 之后应把 commit/runtime/assignment 拆成独立表，避免继续把关键事实塞进 JSON。

## 6. API 增量

MVP 需要的 API：

```text
POST   /api/tasks
POST   /api/tasks/:taskId/assignments
DELETE /api/tasks/:taskId/assignments/current

POST   /api/tasks/:taskId/workspaces
GET    /api/tasks/:taskId/workspaces/current

POST   /api/tasks/:taskId/commit-steps
GET    /api/tasks/:taskId/commit-steps
GET    /api/tasks/:taskId/commit-steps/:stepId/files

POST   /api/tasks/:taskId/change-requests
GET    /api/tasks/:taskId/change-requests
PATCH  /api/change-requests/:requestId

POST   /api/commit-runtimes/:commitSha/start
GET    /api/commit-runtimes/:commitSha
GET    /api/commit-runtimes/:commitSha/preview-url

POST   /api/governance/evaluate-change/:changeId
GET    /api/governance/tasks/:taskId/summary
```

命名可以继续兼容现有 `developer-change-requests`，但对外产品心智应逐步收敛为 `Change Request`。

## 7. 权限与策略默认值

贡献者默认等级：

| 等级 | 默认权限 |
| --- | --- |
| L0 | 查看公开任务、提交想法 |
| L1 | 领取低风险任务，修改允许路径内文件 |
| L2 | 修改普通业务模块，提交 CR |
| L3 | 领取高价值任务，修改复杂模块 |
| L4 | 模块维护者，审核 owner 路径 |
| L5 | 核心管理员，合并 main、修改架构、处理安全模块 |

默认拦截：

1. 外部贡献者不能修改 `.env`、`infra/**`、部署脚本、CI/CD、权限系统、支付、认证核心逻辑。
2. AI agent 权限永远小于或等于当前用户，并额外禁止合并 main、读取生产 secret、部署生产。
3. 修改 `package.json`、migration、核心 schema、Dockerfile、nginx、service 文件默认至少 medium/high 风险。
4. 涉及 secret、private key、证书、credential 的文件默认 critical 风险。

## 8. 第一个样板项目

建议创建一个独立 marketplace skeleton，用于验证众包闭环：

```text
apps/web
  features/auth
  features/listing
  features/search
  features/favorites
  features/cart
  features/orders
  admin

packages/ui
packages/contracts
packages/test-utils
```

第一批任务应选择低风险、可预览、可回滚项：

1. 商品卡片组件。
2. 商品收藏按钮。
3. 搜索筛选 UI。
4. 商品详情页静态布局。
5. 管理后台低风险列表页。
6. Playwright / Vitest 测试补充。

明确不做：

1. 真实支付。
2. 真实物流。
3. 真实用户数据导入。
4. 生产部署自动化开放给贡献者。
5. 外部贡献者可修改认证 / 支付 / infra。

## 9. 近期执行顺序

建议按下面顺序推进，避免先做复杂 runtime fleet 却没有审核闭环：

1. Phase 0：补 gap 文档、schema 草案、API 草案。
2. Phase 1：完成内部闭环 MVP。
3. Phase 2：完成 level 1 / level 2 commit preview。
4. Phase 3：开放低风险外部任务市场。
5. Phase 4：把策略、owner、审计、安全扫描做成硬门槛。
6. Phase 5：再投入高密度 runtime fleet。
7. Phase 6：奖励和信誉系统规模化。

第一轮最小里程碑：

```text
M1：管理员创建带边界任务
M2：贡献者领取任务并创建 workspace branch
M3：AI 生成 2 个 commit step
M4：每个 commit step 有 diff、测试、风险、审计
M5：贡献者提交 CR
M6：管理员在 Approvals 审核并批准 / 要求修改
M7：低风险 commit preview 可打开
```

## 10. 总体验收门槛

每个阶段完成时至少满足：

1. 新能力有 service / BFF / UI 针对性测试。
2. 风险和权限相关行为有负向测试。
3. 文档说明当前实现、限制和下一阶段边界。
4. 不破坏现有 task-domain、runtime、TaskDetailV3、Approvals 主链路。
5. 如果 Go Control Plane 覆盖相关 API，必须补齐 parity 测试。

常用验证命令：

```bash
bun run test:service
bun run test:bff
bun run test:ui
bun run test:service-go
TEST_CP_URL=http://127.0.0.1:4097 bun run test:service-go:contract
CONTROL_PLANE_URL=http://127.0.0.1:4097 TEST_BFF_URL=http://127.0.0.1:4098 TEST_CP_URL=http://127.0.0.1:4097 bun run test:bff:go-smoke
```

如果全量 typecheck 受无关历史问题影响，应先跑与本阶段相关的 targeted tests，并在阶段记录里写明未通过项是否与本次变更相关。
