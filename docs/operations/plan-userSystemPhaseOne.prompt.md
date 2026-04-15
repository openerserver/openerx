# 用户体系一期实施方案（数据库 / API / 前端）

## 0. 总体定位与范围

**一期目标**：管理员建号、组织→项目两层归属、项目绑定仓库与凭证、任务创建时选择仓库并冻结 Git 身份。

**凭证默认路径**：项目级或共享凭证执行任务；Git 账户唯一，所有成员共用同一 Git 身份，不支持用户级凭证（scope=user 已移除）。

**一期明确排除**：
- 自助注册、邀请制
- 团队/部门层
- SSO / OIDC
- GitHub / GitLab 用户同步、自动建号
- 账户生命周期托管（入职/离职/转岗自动化）
- PAT 自动轮换
- 组织级共享凭证的复杂治理（首期只做简单 project/shared scope，不支持 user scope）
- 真正多租户隔离

## 0.1 当前落地状态（最后更新：2026-03-11）

> **阅读提示**：下方各章节中标注 ✅ 的条目为已交付，标注 🔲 的条目为后续规划。如需查看剩余工作清单，请参考 [user-system-executable-backlog.md](user-system-executable-backlog.md)；如需端到端验收步骤，请参考 [user-system-verification-runbook.md](user-system-verification-runbook.md)。

### 已交付能力清单

**凭证与身份冻结主路径**：
- ✅ repository_credentials 仅保留 project/shared scope
- ✅ tasks 已承接 repoId、workingBranch、credentialId 与 git 身份冻结字段
- ✅ CP 凭证 API 已按 project/shared 模型收敛
- ✅ BFF 已支持凭证透传、任务执行时身份解析与 repo context 注入
- ✅ ProjectDetail 已提供仓库与凭证管理入口
- ✅ Tasks 创建弹窗已支持仓库、工作分支、凭证、Author/Committer 覆盖
- ✅ TaskDetail 已展示冻结后的身份快照

**用户账户体系**：
- ✅ 管理员建号（POST /api/users），支持 mustChangePassword 标记
- ✅ 管理员编辑用户（PATCH /api/users/:userId）
- ✅ 管理员禁用/启用账户（PUT /api/users/:userId/status）
- ✅ 角色变更（PUT /api/users/:userId/role）含审计日志
- ✅ 登录时 accountStatus 检查与 lastLoginAt 更新
- ✅ refresh 时 accountStatus 检查
- ✅ 用户自助查看/编辑资料（GET/PATCH /api/auth/me）
- ✅ 用户自助改密（currentPassword + newPassword 校验）
- ✅ mustChangePassword=true 时登录后强制改密弹窗（不可关闭）
- ✅ Settings 页：账户信息标签（显示名、邮箱）+ 修改密码区
- ✅ Users 管理页：列表、建号、编辑、禁用/启用、角色切换
- ✅ 前端测试覆盖：Settings、MainLayout（强制改密弹窗）、Users 页

**运营增强（P1）**：
- ✅ Users 页搜索（用户名/显示名/邮箱）+ 角色/状态组合筛选
- ✅ 管理员密码重置独立化（PUT /api/users/:userId/password），编辑弹窗不再承担密码重置
- ✅ 用户-项目归属可视化（Users 页"项目归属"列，API 返回 project memberships）
**安全加固（P2）**：
- ✅ 密码策略强化（大小写字母 + 数字 + 特殊字符，前后端共享 validatePasswordPolicy）
- ✅ 会话失效治理（tokenVersion 机制，密码修改/重置/禁用账户即时失效旧 token）
- ✅ 登录安全基线（5 次失败后临时锁定 15 分钟）
**质量门**：
- ✅ `bun run check:all` 通过

### 后续规划项（未实现）

以下内容仍在文档中保留作为后续阶段输入，**当前未实现**：
- 🔲 自助注册、邀请制、SSO/OIDC、GitHub/GitLab 同步等（一期明确排除）

---

## 1. 数据库阶段

### 1.1 users 表 — 新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| email | text, nullable | null | 可选，后续接 SSO 时升级为唯一约束 |
| account_status | text enum: active, disabled | 'active' | 账户状态；disabled 时阻止登录和 refresh |
| must_change_password | integer(boolean) | false | 管理员建号后可标记，首次登录强制改密 |
| last_login_at | text, nullable | null | 每次成功登录时更新 |
| token_version | integer | 0 | 密码修改/重置/禁用时递增，JWT 内 tv 字段需匹配 |
| failed_login_attempts | integer | 0 | 连续登录失败次数，成功后清零 |
| locked_until | text, nullable | null | 锁定到期时间（5 次失败后锁定 15 分钟） |

**迁移回填**：存量用户 account_status='active'，must_change_password=false，email=null，last_login_at=null，token_version=0，failed_login_attempts=0，locked_until=null。

### 1.2 organizations / projects / project_roles — 不改动

保持现有 organizations→projects→project_roles 两层结构，不新增 teams、organization_members。

### 1.3 repositories — 不改动

已有字段完全满足首期需求（id, projectId, name, provider, remoteUrl, defaultBranch, description, status, createdAt, updatedAt）。

### 1.4 repository_credentials — 移除用户级凭证

由于 Git 账户唯一，所有成员共用同一 Git 身份，移除 scope='user' 选项：
- **scope='project'** 为默认推荐：凭证归属于项目，所有项目成员可选用。
- **scope='shared'** 同等可用：跨仓库的项目级共享凭证。
- ~~scope='user'~~ **已移除**：不再支持用户级凭证，`ownerUserId` 列从数据库中删除。
- scope enum 从 `['user', 'project', 'shared']` 改为 `['project', 'shared']`。

### 1.5 tasks — 不改动

已有 repoId、credentialId、gitAuthorName/Email、gitCommitterName/Email、baseRevision、workingBranch、finalCommitSha 等字段，完全承接首期身份冻结需求。

### 1.6 迁移验证

- drizzle migration 执行成功
- 老用户登录不受影响
- 老任务、仓库、凭证记录不破坏
- 新字段默认值正确

---

## 2. API 阶段

### 2.1 账户接口

#### 管理员接口（需 org_admin 以上）

| 方法 | 路径 | 说明 | 改动类型 |
|------|------|------|---------|
| POST | /api/users | 创建用户（可设 mustChangePassword=true） | 扩展现有 |
| PATCH | /api/users/:userId | 更新 displayName、password、email | 扩展现有 |
| PUT | /api/users/:userId/role | 设置全局角色 | 已有 |
| PUT | /api/users/:userId/status | 启用/禁用账户 | **新增** |
| GET | /api/users | 用户列表（补返回 email、accountStatus） | 扩展现有 |

#### 当前用户接口

| 方法 | 路径 | 说明 | 改动类型 |
|------|------|------|---------|
| GET | /api/auth/me | 返回完整资料（补 email、accountStatus、lastLoginAt、mustChangePassword） | 扩展现有 |
| PATCH | /api/auth/me | 更新自己的 displayName、email、password | **新增** |

#### 登录与安全

| 改动点 | 说明 |
|--------|------|
| POST /api/auth/login | 登录时检查 accountStatus，disabled 直接拒绝；成功后更新 lastLoginAt；响应中带 mustChangePassword 标记 |
| POST /api/auth/refresh | refresh 时检查 accountStatus，disabled 直接拒绝 |

### 2.2 组织与项目接口 — 不改动

沿用现有 orgRoutes、projectRoutes，包括项目成员管理（add/update/list members）。

### 2.3 仓库接口 — 不改动

沿用现有 repositoryRoutes，挂在 /api/projects/:projectId/repositories 下。

### 2.4 凭证接口 — 已落地（移除 user scope）

| 改动点 | 说明 |
|--------|------|
| POST /api/projects/:projectId/credentials | 创建凭证时，scope 仅允许 'project' 或 'shared'（默认 'project'），不再接受 'user' |
| GET /api/projects/:projectId/credentials | 所有项目成员均可见所有凭证（不再按 scope 过滤可见性） |
| PATCH /api/projects/:projectId/credentials/:credId | 所有项目管理员可修改 |

### 2.5 任务接口 — 已落地

| 改动点 | 说明 |
|--------|------|
| POST /api/tasks（createTask） | 已支持 repoId、credentialId、gitAuthorName/Email、gitCommitterName/Email，不需额外改动 |
| 身份冻结逻辑 | 任务执行开始时（status→running），如果任务未显式传入 gitAuthorName/Email，则优先从显式 credentialId 回填；未指定 credentialId 时，按 repo 默认凭证 → project 默认凭证 → 首个可用凭证的顺序解析并冻结身份；仍取不到则留空 |

### 2.6 BFF 聚合

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/auth/me | 透传到 CP，补返回用户所属项目列表和组织信息 |
| PATCH | /api/auth/me | 透传到 CP |
| GET/POST/PATCH/DELETE | /api/credentials* | 已透传 project 维度凭证查询、创建、更新、撤销 |
| POST | /api/tasks/:taskId/execute | 已在 BFF 内完成身份解析、意图分类、repo context 注入和运行时启动 |
| 其他 | — | 仓库、凭证、任务透传与聚合链路已具备，不需重复设计 |

### 2.7 API 阶段验证

- 管理员建号→登录→首次改密流程
- 管理员禁用账户→该用户登录/refresh 被拒
- 项目仓库 CRUD 权限正确
- 所有凭证（project/shared scope）对项目成员均可见（user-scope 已移除）
- 任务创建带 repoId + credentialId，执行开始时身份冻结正确
- 禁用用户的关键动作写入 audit_events

---

## 3. 前端阶段

### 3.1 Settings 页 — 新增"账户信息"标签

| UI 元素 | 说明 |
|---------|------|
| 基本信息区 | 显示用户名（只读）、显示名称（可编辑）、邮箱（可编辑）、全局角色（只读）、创建时间 |
| 修改密码区 | 当前密码 + 新密码 + 确认密码 |
| 首次改密拦截 | 如果 mustChangePassword=true，登录后弹窗强制改密，不允许关闭 |

**不在 Settings 放凭证入口**：凭证归属项目，不归属个人；在 ProjectDetail 中管理。

### 3.2 ProjectDetail 页 — 强化"代码仓库"标签

| UI 元素 | 说明 |
|---------|------|
| 仓库列表 | 已有 ProjectRepositoriesPanel，不改动 |
| 凭证管理入口 | 已落地：在 ProjectDetail 中展示项目凭证列表，所有项目成员可见，项目管理员可添加、编辑、撤销 |
| 新建凭证表单 | 已落地：label、provider、credentialType、secretRef、gitAuthorName、gitAuthorEmail、scope（project 或 shared，默认 project）、isDefault |

### 3.3 Tasks 页 — 任务创建弹窗补字段

| UI 元素 | 现状 | 改动 |
|---------|------|------|
| 关联仓库 | 已有 repoId 下拉 | 不改动 |
| 工作分支 | 已有 workingBranch 输入 | 不改动 |
| 关联凭证 | 已落地 | 根据当前项目加载可用 project/shared 凭证，并在选择仓库后重置当前凭证选择 |
| Git Author | 已落地 | 提供 gitAuthorName + gitAuthorEmail 覆盖输入，默认展示凭证预设身份说明 |
| Git Committer | 已落地 | 在折叠区域提供 gitCommitterName + gitCommitterEmail 覆盖输入；留空时继承凭证预设或运行时解析结果 |

### 3.4 TaskDetail 页 — 身份展示

| UI 元素 | 现状 | 改动 |
|---------|------|------|
| 代码上下文卡片 | 已有 repoName、remoteUrl、workingBranch、workspaceRoot、baseRevision | 不改动 |
| 身份快照 | 已落地 | 已在任务详情页展示 credentialLabel、gitAuthorName、gitAuthorEmail、gitCommitterName、gitCommitterEmail 只读快照 |

### 3.5 auth store 扩展

| 字段 | 说明 |
|------|------|
| email | string, nullable |
| accountStatus | 'active' / 'disabled' |
| mustChangePassword | boolean |
| lastLoginAt | string, nullable |

### 3.6 api.ts 扩展

| 函数 | 说明 |
|------|------|
| updateMyProfile(data) | PATCH /api/auth/me |
| changeMyPassword(data) | PATCH /api/auth/me（复用，区分 body） |
| listCredentials(projectId, repoId?) | 已有 |
| createTask — 补字段 | 已落地：createTask 调用已带 credentialId、gitAuthorName、gitAuthorEmail、gitCommitterName、gitCommitterEmail、repoId、workingBranch |

### 3.7 前端阶段验证

- Settings 账户信息标签可查看和编辑个人资料
- mustChangePassword 用户登录后强制弹窗改密
- ProjectDetail 凭证区可创建和编辑 project/shared scope 凭证，所有项目成员可查看
- 任务创建弹窗选仓库→选凭证→回填 Author→创建成功
- TaskDetail 展示冻结的身份快照
- 被禁用账号无法登录和刷新

---

## 4. 关键文件路径

### 数据库阶段
- control-plane/service/src/db/schema.ts — 扩展 users 表
- control-plane/service/drizzle/ — 新增 migration

### API 阶段
- control-plane/service/src/modules/auth/routes.ts — 扩展 /me、login 禁用检查
- control-plane/service/src/modules/users/routes.ts — 扩展建号、禁用
- control-plane/service/src/modules/credentials/routes.ts — 简化凭证 scope 与可见性规则
- control-plane/service/src/modules/tasks/routes.ts — 身份冻结回填逻辑
- control-plane/service/src/middleware/auth.ts — refresh 禁用检查
- control-plane/web-ui-bff/src/modules/auth/routes.ts — BFF 透传

### 前端阶段
- control-plane/web-ui/src/stores/auth.ts — 扩展 User 接口
- control-plane/web-ui/src/pages/Settings.vue — 新增账户信息标签
- control-plane/web-ui/src/pages/ProjectDetail.vue — 凭证管理入口
- control-plane/web-ui/src/components/ProjectCredentialsPanel.vue — 项目凭证管理面板
- control-plane/web-ui/src/components/ProjectRepositoriesPanel.vue — 仓库编辑类型修正
- control-plane/web-ui/src/pages/Tasks.vue — 创建弹窗补凭证、身份说明和 Author/Committer 字段
- control-plane/web-ui/src/pages/TaskDetail.vue — 身份快照展示
- control-plane/web-ui/src/lib/api.ts — createTask、credential API、任务身份字段扩展
- tests/service/identity-binding.test.ts — 身份冻结测试模板
- tests/web-ui-bff/identity-binding.test.ts — BFF 身份解析与凭证回填测试

---

## 5. 端到端验收场景

1. 管理员创建新用户（mustChangePassword=true）→ 新用户登录 → 被强制改密 → 成功进入系统
2. 管理员禁用某用户 → 该用户立即无法登录和 refresh
3. 用户进入 Settings → 编辑显示名称和邮箱 → 保存成功
4. 项目管理员在 ProjectDetail 创建 project-scope 凭证 → 所有项目成员可见
5. 用户在 Tasks 页创建任务 → 选仓库 → 选凭证 → Author 自动回填 → 创建成功 → 执行后 TaskDetail 展示冻结身份
6. 关键操作（建号、禁用、凭证创建/撤销）均写入 audit_events

## 6. 本轮实现备注

- 本轮已完成"项目凭证模型 + 任务身份冻结链路"主路径以及"用户账户体系"（建号、登录、禁用、自助改资料/改密、强制改密、角色变更审计）全部 P0 交付。
- 具体交付明细见 §0.1 已交付能力清单。
- 后续运营增强（P1）及安全强化（P2）工作已整理到 [user-system-executable-backlog.md](user-system-executable-backlog.md)。
- 端到端验收步骤见 [user-system-verification-runbook.md](user-system-verification-runbook.md)。
- 当前仓库验证基线以 `bun run check:all` 为准，已通过。
