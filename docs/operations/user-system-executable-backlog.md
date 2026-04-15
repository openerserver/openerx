# 用户系统剩余工作 Backlog

本文档只整理“用户系统”在当前仓库状态下的剩余工作，不重复列出已经完成的项目级凭证与任务身份冻结链路。

> **相关文档**：
> - 一期完整方案及已交付清单 → [plan-userSystemPhaseOne.prompt.md](plan-userSystemPhaseOne.prompt.md)
> - 端到端验收步骤 → [user-system-verification-runbook.md](user-system-verification-runbook.md)

当前基线：
- 账户登录、`/api/auth/me`、自助改资料、自助改密已落地
- 管理员建号、编辑、禁用/启用、角色调整已落地
- `mustChangePassword`、`accountStatus`、`lastLoginAt` 已贯通到前后端
- `bun run check:all` 当前已通过

## 1. P0 收口项 — ✅ 已全部完成

这些工作不引入新产品能力，目标是把现有用户系统从“已实现”收口到“可稳定交付”。

### US-P0-01 角色变更审计补齐 ✅

优先级：P0 — **已完成**

目标：让用户系统所有高风险管理动作都有审计闭环。

任务：
- 在角色变更接口中补 `recordAuditEvent`
- 审计 detail 中记录 actor、目标用户、旧角色、新角色
- 明确 role change 的 risk level

涉及文件：
- [control-plane/service/src/modules/users/routes.ts](../../control-plane/service/src/modules/users/routes.ts)

验收标准：
- 调用 `PUT /api/users/:userId/role` 后写入 audit 事件
- 审计记录可区分“谁把谁改成了什么角色”
- 不影响现有 user-management 测试

### US-P0-02 Settings 页前端测试补齐 ✅

优先级：P0 — **已完成**

目标：给当前用户侧核心流程建立稳定回归保护。

任务：
- 为 Settings 资料保存补 Vitest 用例
- 为 Settings 改密码补 Vitest 用例
- 为 `mustChangePassword` 强制改密弹窗补 UI 行为用例

涉及文件：
- [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue)
- [control-plane/web-ui/src/layouts/MainLayout.vue](../../control-plane/web-ui/src/layouts/MainLayout.vue)
- [tests/web-ui](../../tests/web-ui)

验收标准：
- 成功修改 displayName/email 的交互有测试覆盖
- 改密时错误输入、成功提交都有测试覆盖
- `mustChangePassword=true` 时用户无法跳过改密弹窗

### US-P0-03 Users 页前端测试补齐 ✅

优先级：P0 — **已完成**（已有 9 个测试覆盖全部验收标准）

目标：确保管理侧用户操作有前端回归保障。

任务：
- 为用户列表加载补测试
- 为新建用户补测试
- 为禁用/启用补测试
- 为角色变更补测试

涉及文件：
- [control-plane/web-ui/src/pages/Users.vue](../../control-plane/web-ui/src/pages/Users.vue)
- [tests/web-ui](../../tests/web-ui)

验收标准：
- 管理员进入 Users 页可看到基础信息与状态
- 新建用户时 `mustChangePassword` 提交正确
- 禁用/启用、角色切换的 UI 反馈与 API 调用都有测试覆盖

### US-P0-04 用户系统验收 Runbook 沉淀 ✅

优先级：P0 — **已完成**（见 [user-system-verification-runbook.md](user-system-verification-runbook.md)）

目标：把现有实现从“代码可跑”变成“团队可验收”。

任务：
- 形成用户系统验收步骤文档
- 覆盖建号、首次改密、禁用、恢复、资料更新
- 标明需要的角色和前置环境

涉及文件：
- [docs/plan-userSystemPhaseOne.prompt.md](plan-userSystemPhaseOne.prompt.md)
- [docs/user-system-executable-backlog.md](user-system-executable-backlog.md)

验收标准：
- 新人可按文档完成一次端到端验证
- 每个场景都有明确的期望结果

### US-P0-05 文档拆分“现状”与“规划” ✅

优先级：P0 — **已完成**（plan-userSystemPhaseOne.prompt.md 已按 ✅/🔲 标注区分）

目标：避免团队把规划文档误当成实际交付状态。

任务：
- 从现有一期方案中拆出“已交付能力清单”
- 保留“后续规划项”但明确标注未实现
- 在相关文档互相引用

涉及文件：
- [docs/plan-userSystemPhaseOne.prompt.md](plan-userSystemPhaseOne.prompt.md)
- [docs/user-system-executable-backlog.md](user-system-executable-backlog.md)

验收标准：
- 读文档时能一眼区分“现在已有”和“后面再做”
- 不再出现把已规划项误判为已完成的情况

## 2. P1 运营增强项 — ✅ 已全部完成

这些工作会增强管理员日常使用效率，但不改变底层用户模型。

### US-P1-01 Users 页搜索与筛选 ✅

优先级：P1 — **已完成**

目标：让用户数量增多后仍可高效管理。

任务：
- 增加按用户名/显示名/邮箱搜索
- 增加按角色、状态筛选
- 视情况增加分页参数透传

涉及文件：
- [control-plane/web-ui/src/pages/Users.vue](../../control-plane/web-ui/src/pages/Users.vue)
- [control-plane/web-ui/src/lib/api.ts](../../control-plane/web-ui/src/lib/api.ts)
- [control-plane/service/src/modules/users/routes.ts](../../control-plane/service/src/modules/users/routes.ts)

验收标准：
- 角色和状态可组合筛选
- 搜索不会破坏现有列表加载与权限逻辑

### US-P1-02 管理员密码重置与强制改密动作独立化 ✅

优先级：P1 — **已完成**

目标：把“编辑用户”和“安全操作”分开，减少误操作。

任务：
- 增加单独的“重置密码”管理动作
- 支持管理员重置后自动设置 `mustChangePassword=true`
- 让编辑资料表单不再承担密码重置职责

涉及文件：
- [control-plane/service/src/modules/users/routes.ts](../../control-plane/service/src/modules/users/routes.ts)
- [control-plane/web-ui/src/pages/Users.vue](../../control-plane/web-ui/src/pages/Users.vue)

验收标准：
- 管理员可单独执行密码重置
- 被重置用户下次登录必须改密
- 操作写入 audit 事件

### US-P1-03 用户-项目归属可视化 ✅

优先级：P1 — **已完成**

目标：让管理员能快速看出某个用户属于哪些项目、拥有哪些项目角色。

任务：
- 在 Users 页补项目归属摘要
- 或新增用户详情弹窗/抽屉展示项目角色列表
- 视复杂度决定是否补项目维度跳转入口

涉及文件：
- [control-plane/web-ui/src/pages/Users.vue](../../control-plane/web-ui/src/pages/Users.vue)
- [control-plane/service/src/modules/auth/routes.ts](../../control-plane/service/src/modules/auth/routes.ts)
- [control-plane/service/src/modules/users/routes.ts](../../control-plane/service/src/modules/users/routes.ts)

验收标准：
- 管理员无需查数据库即可看到用户项目归属
- 不暴露超出当前权限边界的信息

## 3. P2 安全与企业化项 — ✅ 已全部完成

这些工作价值明确，但在当前阶段不应抢占 P0/P1。

### US-P2-01 密码策略强化 ✅

优先级：P2 — **已完成**

目标：提高账号安全基线。

任务：
- 增加密码复杂度规则（大小写字母、数字、特殊字符）
- 前后端共享 `validatePasswordPolicy` 工具函数
- 错误提示做成可理解的前端文案，包含密码策略 hint

涉及文件：
- [control-plane/service/src/modules/auth/routes.ts](../../control-plane/service/src/modules/auth/routes.ts)
- [control-plane/service/src/modules/users/routes.ts](../../control-plane/service/src/modules/users/routes.ts)
- [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue)

验收标准：
- 不符合策略的密码在前后端都被拒绝
- 错误提示能说明具体原因

### US-P2-02 会话失效治理 ✅

优先级：P2 — **已完成**

目标：让高风险账户变更能更快传导到在线会话。

任务：
- users 表增加 `tokenVersion` 字段
- JWT payload 内含 `tv`，登录时写入当前版本
- authMiddleware 校验 `tv` 与数据库一致性
- 密码修改、管理员重置密码、禁用账户时自动 bump tokenVersion

涉及文件：
- [control-plane/service/src/middleware/auth.ts](../../control-plane/service/src/middleware/auth.ts)
- [control-plane/service/src/modules/auth/routes.ts](../../control-plane/service/src/modules/auth/routes.ts)
- [control-plane/service/src/db/schema.ts](../../control-plane/service/src/db/schema.ts)

验收标准：
- 密码重置、用户禁用后的会话行为有明确且可验证的规则
- 不会和当前 JWT 机制互相打架

### US-P2-03 登录安全基线 ✅

优先级：P2 — **已完成**

目标：补齐最基本的暴力破解与异常登录防护。

任务：
- 登录失败 5 次后账户临时锁定 15 分钟
- 成功登录后自动清零失败计数
- users 表增加 `failedLoginAttempts`、`lockedUntil` 字段

涉及文件：
- [control-plane/service/src/modules/auth/routes.ts](../../control-plane/service/src/modules/auth/routes.ts)
- [control-plane/service/src/middleware/auth.ts](../../control-plane/service/src/middleware/auth.ts)

验收标准：
- 高频失败登录会被限制
- 对正常用户影响可控

## 4. 建议执行顺序

建议顺序：

1. US-P0-01 角色变更审计补齐
2. US-P0-02 Settings 页前端测试补齐
3. US-P0-03 Users 页前端测试补齐
4. US-P0-04 用户系统验收 Runbook 沉淀
5. US-P0-05 文档拆分“现状”与“规划”
6. US-P1-01 Users 页搜索与筛选
7. US-P1-02 管理员密码重置与强制改密动作独立化
8. US-P1-03 用户-项目归属可视化
9. 再评估是否进入 P2 安全增强

原因：
- P0 都是当前已实现能力的收口，投入小、收益高
- P1 才是面向运营使用体验的增强
- P2 涉及安全模型和会话策略，应该在现有链路稳定后再动

## 5. Definition of Done

一项 backlog 只有同时满足以下条件才算完成：

- 代码改动已合入对应模块
- 至少补充了与变更范围匹配的测试或手工验收说明
- `bun run check:all` 通过
- 文档中相关条目已更新