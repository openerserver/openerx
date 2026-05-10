# AI 驱动的众包软件开发平台方案

版本：2026-05-10

## 1. 核心定位

本项目不是一个普通的在线 IDE，也不是一个简单的 AI 编程工具。

它的真实定位是：

> **AI 驱动的众包软件开发平台。**

平台目标是在网上集合一群互相不认识的人，在 AI 辅助下共同开发大型网站程序，例如类似 x.com、亚马逊、eBay 这样的复杂互联网平台。

因此，平台的核心问题不是“如何让大家写代码”，而是：

- 如何让陌生人安全地参与大型项目开发；
- 如何让 AI 修改代码后每一步都可查看、可运行、可审核；
- 如何避免互相覆盖、恶意提交和不可控变更；
- 如何让管理员和模块负责人高效审核；
- 如何保证所有修改可以回滚、追踪和追责；
- 如何让大量 commit runtime 快速启动并支持高并发预览。

最终方案应该围绕以下核心能力建设：

```text
Task Marketplace
+ Git Workspace
+ AI Commit Agent
+ Commit Runtime Fleet
+ Preview Gateway
+ Change Request Review
+ Code Ownership
+ Policy Engine
+ Reputation / Reward System
```

---

## 2. 最终结论

平台应该采用以下总体模式：

```text
1. 任务市场控制陌生人的工作范围
2. Git 分支隔离每个贡献者和 AI session
3. AI 每一步修改都生成 commit
4. 每个 commit 都绑定一个可运行 preview
5. runtime 采用分级运行，不是每个 commit 都运行完整系统
6. 使用高密度 runtime fleet 支持大量快速预览
7. 管理员和模块负责人审核 Change Request
8. 代码所有权和权限系统控制谁能改哪里
9. 所有操作进入审计日志
10. 合并 main 后仍然可以回滚
```

一句话总结：

> **陌生人只通过任务、分支、commit runtime 和审核流程参与；大型网站的架构、核心权限、生产部署必须由核心团队和模块维护者控制。**

---

## 3. 系统要解决的问题

对于类似 x.com、亚马逊、eBay 这种大型网站程序，真正难点包括：

```text
1. 陌生人之间如何分工
2. 谁能改哪些模块
3. AI 改完以后如何验证
4. 每一步提交如何运行和预览
5. 管理员如何审核
6. 恶意贡献如何拦截
7. 大量 runtime 如何快速启动
8. 最终如何安全合并到主项目
9. 生产系统如何不被污染
10. 所有修改如何追踪和回滚
```

所以平台不能让陌生人直接自由修改大项目，而必须采用任务驱动、权限控制、分支隔离、审核合并的治理模式。

---

## 4. 平台应分成两个产品

### 4.1 被开发的目标网站

例如：

```text
类似 x.com 的社交平台
类似亚马逊的电商平台
类似 eBay 的交易市场
```

目标网站包含具体业务模块：

```text
用户系统
认证系统
商品 / 内容系统
订单系统
支付系统
搜索系统
推荐系统
消息系统
通知系统
评论系统
风控系统
管理员后台
数据分析
```

### 4.2 用来开发目标网站的协作平台

也就是当前要建设的平台：

```text
任务市场
AI 开发 workspace
Git 分支管理
每步 commit runtime
预览系统
管理员审核系统
权限系统
贡献者信誉系统
审计系统
奖励 / 结算系统
```

这两个系统必须分开。

目标网站的生产环境不能和陌生人运行代码的开发环境混在一起。

---

## 5. 陌生人协作的正确模式

错误模式：

```text
所有人都可以打开项目，自由让 AI 修改代码
```

正确模式：

```text
管理员 / 产品负责人发布任务
        ↓
贡献者领取任务
        ↓
系统创建独立分支和 AI workspace
        ↓
AI 帮贡献者分步骤修改
        ↓
每一步生成 Git commit
        ↓
每个 commit 都可运行、可预览、可审查
        ↓
用户提交 Change Request
        ↓
管理员 / 模块负责人审核
        ↓
通过后合并 main
        ↓
可回滚、可审计、可追责
```

陌生人不能直接“开发整个平台”，只能在被分配的模块、任务、权限和测试边界内提交可审核的变更。

---

## 6. 任务模型

每一个任务都应该有明确边界。

示例：

```text
任务标题：实现商品收藏按钮

所属模块：
marketplace/listing

允许修改路径：
- apps/web/features/listing/**
- packages/ui/**

禁止修改路径：
- services/payment/**
- services/auth/**
- infra/**
- database/migrations/**

验收标准：
- 用户可以收藏商品
- 收藏状态刷新后保持
- 单元测试通过
- 视觉回归通过
- 不新增外部依赖
- 不修改认证逻辑

奖励：
$50 或 500 积分

审核人：
marketplace 模块负责人
```

任务应该尽量具备以下特点：

```text
边界清晰
验收标准明确
可独立预览
可自动测试
低风险
可回滚
```

---

## 7. 大型网站的模块边界

类似 x.com、亚马逊、eBay 的大型平台，必须先做模块边界设计。

推荐初始架构：

```text
apps/
  web/                     # 主 Web 应用
  admin/                   # 管理后台
  api/                     # API Gateway / BFF

packages/
  ui/                      # 设计系统
  contracts/               # API contract / schema
  shared/                  # 共享工具
  test-utils/              # 测试工具

services/
  identity/                # 认证，内部团队维护
  users/                   # 用户资料
  social-graph/            # 关注关系
  feed/                    # 信息流
  marketplace/             # 商品 / listing
  orders/                  # 订单
  payments/                # 支付，内部团队维护
  search/                  # 搜索
  messaging/               # 私信
  notifications/           # 通知
  moderation/              # 内容审核
  analytics/               # 数据分析
```

### 模块风险分级

| 模块 | 是否允许普通陌生人修改 |
|---|---:|
| UI 组件 | 可以 |
| 商品展示页 | 可以 |
| 搜索筛选 UI | 可以 |
| 管理后台低风险页面 | 可以 |
| 测试用例 | 可以 |
| 文档 | 可以 |
| 用户认证 | 不建议 |
| 支付 | 不建议 |
| 权限系统 | 不建议 |
| 数据库核心 schema | 不建议 |
| CI/CD / infra | 不建议 |
| 风控 / 安全策略 | 不建议 |

---

## 8. 权限模型

陌生人不能一开始就拥有完整开发权限。

推荐贡献者信任等级：

| 等级 | 身份 | 可以做什么 |
|---|---|---|
| L0 | 访客 | 查看公开任务、提交想法 |
| L1 | 新贡献者 | 领取低风险任务，AI 辅助修改指定路径 |
| L2 | 合格贡献者 | 修改普通业务模块，提交 Change Request |
| L3 | 可信贡献者 | 可修改复杂模块，可领取高价值任务 |
| L4 | 模块维护者 | 审核自己负责模块的变更 |
| L5 | 核心管理员 | 合并 main、修改架构、处理安全模块 |

AI agent 的权限应该永远小于或等于当前用户，并且必须额外限制：

```text
AI 不能直接合并 main
AI 不能改权限
AI 不能读取生产 secret
AI 不能部署生产
AI 不能修改支付 / 认证 / infra，除非任务显式授权
AI 的每次工具调用都要记录
```

---

## 9. Code Ownership

大型项目必须有代码所有权机制。

示例：

```text
/services/payments/**         @core-payments-team
/services/identity/**         @security-team
/services/feed/**             @feed-maintainers
/apps/web/features/listing/** @marketplace-maintainers
/packages/ui/**               @design-system-team
/infra/**                     @platform-team
```

当贡献者或 AI 修改某个路径时，系统自动判断：

```text
谁是 owner
谁必须审核
是否属于高风险模块
是否允许当前贡献者修改
是否需要安全团队额外审批
```

代码所有权是防止大型项目失控的关键机制。

---

## 10. 每个任务的开发流程

推荐流程：

```text
1. 管理员创建任务
   ↓
2. 平台生成任务边界
   - 允许修改路径
   - 禁止修改路径
   - 验收测试
   - 预览方式
   - 奖励
   ↓
3. 贡献者领取任务
   ↓
4. 系统创建独立 branch
   ↓
5. AI 根据任务拆分步骤
   ↓
6. 每完成一步生成一个 commit
   ↓
7. 每个 commit 创建 runtime
   ↓
8. 用户查看每一步效果
   ↓
9. 用户提交 Change Request
   ↓
10. 系统自动运行测试、安全检查、风险评分
   ↓
11. 管理员查看每个 commit 的 diff 和 preview
   ↓
12. 管理员批准 / 拒绝 / 要求修改
   ↓
13. 通过后合并 main
```

---

## 11. AI 修改流程

AI 不应该一次性改完大量文件，而应该分步骤提交。

示例任务：

```text
帮我增加登录页
```

AI 应拆分为：

```text
Step 1: 创建 LoginPage 和 LoginForm
Step 2: 接入 auth API
Step 3: 添加表单校验
Step 4: 添加测试
Step 5: 运行测试并修复问题
```

每一步生成一个 commit：

```text
D - create login page and form
E - connect login API
F - add validation
G - add login tests
H - fix failing tests
```

每一步之后系统自动执行：

```text
1. git commit
2. 创建或更新 commit runtime
3. 运行测试
4. 生成 diff summary
5. 记录 AI tool calls
6. 写入审计日志
```

管理员审核时看到的是完整的 AI 行为链，而不是一个黑盒结果。

---

## 12. 每一步 Git Commit 都可运行

每个 commit 都应该绑定一个可运行的 Commit Runtime。

```text
commit D -> preview-D
commit E -> preview-E
commit F -> preview-F
commit G -> preview-G
commit H -> preview-H
```

用户和管理员都可以查看：

```text
每一步 AI 做了什么
每一步代码 diff
每一步运行效果
每一步测试结果
最终版本效果
```

但是，对于大型网站，不能让每个 commit 都运行完整系统。

正确做法是 runtime 分级。

---

## 13. Runtime 分级

### Level 1：组件级预览

适合：

```text
按钮
表单
商品卡片
评论组件
导航栏
弹窗
```

运行方式：

```text
Storybook / component preview / isolated UI runtime
```

特点：

```text
最快
成本最低
适合大量 commit 同时运行
```

### Level 2：页面级预览

适合：

```text
登录页
商品详情页
搜索结果页
个人主页
订单列表页
```

运行方式：

```text
只启动前端页面 + mock API
```

特点：

```text
速度快
适合普通贡献者任务
```

### Level 3：模块级预览

适合：

```text
商品模块
评论模块
消息模块
通知模块
```

运行方式：

```text
启动相关 service + mock 依赖服务
```

特点：

```text
比完整系统轻很多
但可以验证真实业务逻辑
```

### Level 4：流程级预览

适合：

```text
注册登录流程
下单流程
发帖流程
商品发布流程
```

运行方式：

```text
启动多个相关服务 + 测试数据库 + mock 支付 / mock 邮件 / mock 通知
```

特点：

```text
用于高价值任务审核
```

### Level 5：完整集成环境

适合：

```text
准备合并 main
准备发布
高风险变更
跨多个核心模块的变更
```

运行方式：

```text
完整 staging-like 环境
```

特点：

```text
最慢
最贵
不要给每个 commit 都跑
```

核心原则：

> **每个 commit 都可运行，但不是每个 commit 都运行完整系统。**

---

## 14. 高并发 Runtime 架构

由于业务要求 runtime 启动必须非常快，并且可以同时运行很多个，平台需要专门的 Commit Runtime Fleet。

推荐架构：

```text
Git commit
   ↓
Runtime Scheduler
   ↓
选择 runtime level
   ↓
复用 template
   ↓
复用 dependency snapshot
   ↓
挂载 commit source layer
   ↓
从 warm pool 分配 runtime
   ↓
Preview Gateway 生成 URL
```

关键机制：

```text
1. 不在用户点击预览时 npm install
2. 不为每个 commit 完整 clone
3. 不为每个 commit 构建镜像
4. 复用语言模板
5. 复用依赖快照
6. 复用 Git object database
7. 使用 COW source layer
8. 使用 warm runtime pool
9. 最新 commit 自动 hot
10. 历史 commit 按需启动
```

---

## 15. Runtime 技术选择

### 控制平面

```text
前端：Next.js
后端：NestJS / Fastify
数据库：PostgreSQL
Git：bare Git repo 或 Gitea
任务系统：自研
审核系统：自研
权限系统：RBAC + ABAC
策略引擎：OPA / 自研 policy engine
对象存储：S3 / MinIO
审计：append-only audit log
```

### Runtime 平面

```text
Runtime Scheduler
Runtime Host Fleet
CubeSandbox / Firecracker / Docker Provider
Dependency Snapshot Store
Source Snapshot Store
Preview Gateway
Log Collector
```

### AI 工具层

```text
AI Agent Runtime
boxsh / MCP shell
read_file
edit_file
run_test
run_command
create_commit
generate_summary
```

### K8s 的位置

Kubernetes 不是业务核心。

更准确的定位是：

```text
K8s 可以用来跑平台控制面：
- API Server
- Web
- Review Service
- Runtime Scheduler
- Preview Gateway

但 commit runtime 不一定直接做成 K8s Pod。
```

如果目标是“很多 runtime + 快速启动”，更推荐：

```text
K8s 管理 Runtime Host
Runtime Host 内部用 CubeSandbox / microVM / warm pool 跑 commit runtime
```

---

## 16. Preview Gateway

无论底层 runtime 使用 Docker、CubeSandbox、Firecracker 还是其他实现，都需要 Preview Gateway。

Preview Gateway 负责：

```text
1. 生成 preview URL
2. 校验用户或管理员访问权限
3. 路由到对应 commit runtime
4. runtime 未启动时自动唤醒
5. 记录访问日志
6. 注入安全 header
7. 限制未授权访问
```

访问流程：

```text
用户 / 管理员打开 preview URL
        ↓
Preview Gateway 校验权限
        ↓
查询 CommitRuntime
        ↓
如果 running，直接代理
        ↓
如果 prepared / warm，触发启动
        ↓
runtime ready 后返回页面
```

---

## 17. 管理员审核界面

管理员打开一个 Change Request 时，应该看到：

```text
Change Request #482
任务：实现商品收藏按钮
贡献者：user_1827
AI Session：ai_session_991
目标模块：marketplace/listing
目标分支：main
当前状态：等待审核
风险等级：中
```

提交链：

```text
Commit 1: 创建收藏按钮组件
  修改文件：
  - apps/web/features/listing/FavoriteButton.tsx
  - packages/ui/IconButton.tsx
  测试：通过
  预览：[打开]
  风险：低

Commit 2: 接入收藏 API
  修改文件：
  - apps/web/features/listing/useFavorite.ts
  - packages/contracts/favorite.ts
  测试：通过
  预览：[打开]
  风险：中，因为新增 API contract

Commit 3: 修复移动端样式
  修改文件：
  - apps/web/features/listing/FavoriteButton.css
  测试：通过
  预览：[打开]
  风险：低
```

管理员可操作：

```text
[批准合并]
[拒绝]
[要求修改]
[只接受部分 commit]
[回退到 Commit 1]
[标记为高风险]
[转交模块负责人]
[冻结贡献者]
```

---

## 18. 贡献者界面

贡献者看到：

```text
任务：实现商品收藏按钮
状态：AI 修改中

AI 已完成：
1. 创建收藏按钮组件        [查看代码] [打开预览]
2. 接入收藏 API            [查看代码] [打开预览]
3. 修复移动端样式          [查看代码] [打开预览]

当前最终效果：
[打开最新预览]

你可以：
[继续让 AI 修改]
[回退到上一步]
[提交审核]
[放弃任务]
```

贡献者控制 AI，管理员监督贡献者和 AI。

---

## 19. 安全原则

对于陌生人 + AI 的开发平台，必须默认所有外部贡献者都是不可信的。

最低安全原则：

```text
1. 不给生产 secret
2. 不给生产数据
3. 不允许直接部署
4. 不允许直接合并 main
5. 不允许修改权限系统
6. 不允许修改支付 / 认证 / infra，除非是可信等级
7. 不允许访问平台内网
8. 不允许访问其他贡献者 runtime
9. 不允许绕过测试和审核
10. 所有 AI 和用户操作都记录审计
```

预览环境只能使用：

```text
mock 数据
测试数据库
脱敏数据
短期 token
fake payment provider
fake email provider
fake notification provider
```

绝不能让陌生人 runtime 接触：

```text
生产数据库
真实用户数据
真实支付密钥
内部管理后台 token
云厂商 metadata
CI/CD deploy key
```

---

## 20. 贡献者经济与信誉系统

如果平台要长期集合陌生人协作，就需要奖励和信誉机制。

任务模式可以分为三种。

### 模式一：单人领取

```text
一个任务同时只允许一个人做
完成后审核
通过后奖励
```

适合普通任务。

### 模式二：多人竞标

```text
多个贡献者可以提交方案
管理员选择一个合并
只有被接受者获得奖励
```

适合 UI、算法、方案型任务。

### 模式三：可信团队承包

```text
一个模块由一个小团队长期维护
他们有更高权限和长期收益
```

适合复杂模块。

奖励发放条件：

```text
代码合并 main
测试通过
审核通过
没有后续严重问题
```

可以设置延迟结算：

```text
合并后 7 天无严重 bug 再释放奖励
```

贡献者信誉指标：

```text
通过率
被拒率
平均代码质量
安全风险次数
任务完成速度
管理员评分
是否按要求修改
```

---

## 21. 大型网站的组织方式

平台需要建立模块维护者制度。

建议角色：

```text
Core Architecture Team
  - 决定系统架构
  - 决定技术栈
  - 管理核心模块

Product Team
  - 写任务需求
  - 定义验收标准

Module Maintainers
  - 审核具体模块变更
  - 管理模块 roadmap

Security Team
  - 审核高风险修改
  - 处理漏洞和恶意行为

External Contributors
  - 完成任务
  - 提交可审核变更

AI Agents
  - 辅助贡献者开发
  - 生成代码、测试、文档
```

陌生人群体不能直接替代架构团队。大型系统必须有清晰技术方向，否则会变成无法整合的代码集合。

---

## 22. 最小可行版本

MVP 不应该一开始就开发完整的“亚马逊”或“x.com”。

MVP 应先验证以下闭环：

```text
任务发布
        ↓
贡献者领取
        ↓
AI 修改
        ↓
每步 commit
        ↓
每步 preview
        ↓
管理员审核
        ↓
合并 main
        ↓
奖励结算
```

第一个目标网站建议选一个中等复杂度的 marketplace skeleton：

```text
用户注册 / 登录
商品列表
商品详情
搜索
收藏
购物车
订单模拟
管理员后台
```

第一阶段不要接真实支付，不要接真实物流，不要接真实用户数据。

---

## 23. 分阶段路线图

### Phase 1：平台基础闭环

交付：

```text
用户系统
项目系统
Git workspace
AI session
每步 commit
commit preview
Change Request
管理员审核
合并 main
```

目标：

```text
少量内部用户可以用 AI 完成任务并提交审核
```

---

### Phase 2：任务市场

交付：

```text
任务发布
任务领取
任务边界
奖励配置
贡献者等级
任务状态流转
```

目标：

```text
外部用户可以领取低风险任务
```

---

### Phase 3：高密度 runtime

交付：

```text
Runtime Scheduler
warm pool
dependency snapshot
source snapshot
Preview Gateway
CubeSandbox / microVM provider
```

目标：

```text
大量 commit 可以快速预览
```

---

### Phase 4：安全治理

交付：

```text
代码所有权
敏感文件保护
AI 权限限制
安全扫描
依赖扫描
审计日志
风险评分
```

目标：

```text
陌生人贡献不会威胁主项目
```

---

### Phase 5：贡献者经济系统

交付：

```text
信誉分
奖励结算
争议处理
违规处理
任务竞标
贡献者排行榜
```

目标：

```text
平台可以长期吸引外部开发者
```

---

### Phase 6：大型产品扩展

交付：

```text
多模块维护者制度
跨模块任务
发布管理
staging 环境
生产发布流程
回滚流程
性能监控
```

目标：

```text
真正开始承载大型网站持续开发
```

---

## 24. 主要风险与应对

### 风险一：陌生人开发没有架构一致性

应对：

```text
核心团队先定义架构
模块边界
代码规范
API contract
设计系统
测试标准
```

### 风险二：AI 生成代码质量不稳定

应对：

```text
每步 commit
每步测试
每步 preview
管理员审核
自动风险评分
```

### 风险三：恶意贡献

应对：

```text
隔离 runtime
无生产 secret
无生产数据
权限限制
敏感文件保护
审计日志
信誉系统
```

### 风险四：runtime 成本失控

应对：

```text
runtime level 分级
最新 commit hot
历史 commit 按需启动
dependency snapshot
warm pool
自动回收
贡献者配额
```

### 风险五：管理员审核压力过大

应对：

```text
模块维护者
自动测试
AI 生成 review summary
风险分级
低风险自动初审
高风险强制人工审查
```

---

## 25. 推荐技术栈

### 控制平面

```text
前端：Next.js + React + TypeScript
后端：NestJS / Fastify
数据库：PostgreSQL
版本系统：Git bare repo 或 Gitea
对象存储：S3 / MinIO
权限：RBAC + ABAC
策略：OPA / 自研 Policy Engine
审计：append-only audit log
```

### AI 与工具层

```text
AI Agent Runtime
LLM Provider Adapter
boxsh / MCP shell
read_file
edit_file
run_test
run_command
create_commit
generate_summary
```

### Runtime 平面

```text
Runtime Scheduler
Runtime Host Fleet
CubeSandbox / Firecracker / Docker Provider
Dependency Snapshot Store
Source Snapshot Store
Preview Gateway
Log Collector
```

### 目标网站开发栈

初期建议：

```text
Monorepo
TypeScript
Next.js / React
Node.js API
PostgreSQL
Redis
OpenAPI / Zod / tRPC / GraphQL 任选一种 contract 体系
Playwright E2E
Vitest / Jest
Storybook
```

大型网站初期不建议直接拆成几十个微服务。

更推荐：

```text
模块化 monorepo
清晰 domain boundary
contract-first API
关键模块逐步拆服务
```

---

## 26. 最终架构摘要

最终平台应该长这样：

```text
                 ┌────────────────────────┐
                 │      Task Marketplace   │
                 │  任务 / 奖励 / 边界      │
                 └───────────┬────────────┘
                             │
                 ┌───────────▼────────────┐
                 │      AI Workspace       │
                 │  分支 / AI 修改 / commit │
                 └───────────┬────────────┘
                             │
                 ┌───────────▼────────────┐
                 │        Git Layer        │
                 │ branch / commit / diff  │
                 └───────────┬────────────┘
                             │
                 ┌───────────▼────────────┐
                 │  Commit Runtime Fleet   │
                 │ 每个 commit 可运行预览   │
                 └───────────┬────────────┘
                             │
                 ┌───────────▼────────────┐
                 │     Preview Gateway     │
                 │ 鉴权 / 路由 / 自动唤醒   │
                 └───────────┬────────────┘
                             │
                 ┌───────────▼────────────┐
                 │   Change Request Review │
                 │ 管理员 / 模块负责人审核 │
                 └───────────┬────────────┘
                             │
                 ┌───────────▼────────────┐
                 │      Merge / Rollback   │
                 │ 合并 main / 任意回滚     │
                 └────────────────────────┘
```

安全与治理层横跨所有模块：

```text
Code Ownership
Policy Engine
RBAC / ABAC
Audit Log
Reputation System
Reward System
Security Scanning
```

---

## 27. 最终一句话

> **这是一个 AI 驱动的众包软件开发平台。陌生人不能自由改主项目，只能通过任务、分支、AI 分步 commit、可运行预览和管理员审核参与；大型网站的架构、核心权限、生产部署由核心团队和模块维护者控制；每个 commit 都可运行、可审查、可合并、可回滚。**
