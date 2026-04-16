# OpenerX 项目介绍（面向目标用户）

> 状态：2026-04-17 首版
> 适用范围：平台工程、研发管理、安全合规、成本与运营、内部产品与交付团队
> 目的：用一份独立文档回答“OpenerX 是什么、给谁用、解决什么组织级问题、如何落地”，便于对外引用、内部介绍与管理层对齐
>
> 相关文档：
> - [architecture/architecture-overview.md](../architecture/architecture-overview.md)
> - [architecture/core-concepts-glossary.md](../architecture/core-concepts-glossary.md)
> - [product/high-level-decision-summary.md](high-level-decision-summary.md)
> - [product/business-model-analysis.md](business-model-analysis.md)

## 1. 一句话介绍

OpenerX 是面向企业研发组织的 AI Dev/Ops 控制平面，用来把 AI Agent 纳入可治理、可审计、可追责的研发流程。

它不是：

- 个人 AI IDE
- 企业版聊天助手
- 低价开发者插件
- 纯多 Agent 编排引擎
- 新的底层 Runtime

它是：

- 连接任务、项目、成员、Agent、审批、预算、审计与运行时执行的统一控制面
- 让 AI 在组织边界内运行、留痕、可回溯、可规模化的系统

## 2. 目标用户

OpenerX 主要服务以下五类用户和团队：

1. **平台工程与 DevOps 团队**
   需要统一管理组织内的 Agent 基础设施、运行入口与扩展能力，不希望每个团队各自拼装 AI 工具链。

2. **研发管理者与技术负责人**
   需要让跨团队的 AI 使用可控、可见、可追踪，能回答“哪些任务正在跑、谁在跑、做了什么、结果是什么”。

3. **安全、合规与治理负责人**
   需要审批流、审计事件、策略约束、阻断能力和证据导出，把 AI 的使用纳入现有的合规体系。

4. **成本与运营相关角色**
   需要预算上限、周期控制、告警规则、用量账本（Usage Ledger）和费用可解释性，避免 AI 使用变成一笔不可控的开支。

5. **内部产品与交付团队**
   需要在企业自有的任务和工作流体系里，接入外部 Runtime 能力，把 Agent 驱动的工作当作正式交付物管理。

次匹配用户是中型技术团队与有多角色复核需求的交付团队；不匹配用户是个人开发者、无流程约束的小团队、以及只想买低价效率工具的用户。

## 3. 组织为什么需要这样一个系统

AI 工具的“能不能生成内容”已经不是企业的核心问题。企业真正卡住的通常是以下几个场景：

1. AI 开始触碰真实研发工作，但没人能清楚说出**谁可以发起高风险动作**。
2. 跨仓库、跨系统的改动做完了，却无法解释**到底改了什么、由谁发起、为什么放行**。
3. 某些操作应当经过审批、阻断或升级，但现有工具里没有地方“前置约束”。
4. 出现争议或事故时，**无法提供原始行为证据**，只能看到一份摘要或结论。
5. 各团队各自使用模型，**成本散落、没有预算、无法规模化**。

OpenerX 的定位就是解决这组“组织如何把 AI 纳入正式研发流程”的问题，而不是再做一个能生成更多内容的聊天入口。

## 4. 核心能力

OpenerX 提供四组核心能力，面向目标用户的关心点组织：

### 4.1 组织化 Agent 协作

- Organization、Project、Member、Agent、Skill 作为统一前台心智
- Task 作为业务工作项，Session 作为其下的一次执行分支
- Role 退居系统内部的职责与权限抽象
- 多角色 Agent 可以在同一条任务上协作，而不是被塞进一个抽象助手里

### 4.2 治理前置化

- Policy、Approval、Gate、Hook 把治理条件前置到执行前
- 审批、阻断、升级、策略命中可以作为可配置能力，而不是事后补救
- 适合安全、合规、治理负责人把现有制度映射到 AI 使用路径

### 4.3 可回放的原始审计流

- 使用 Task-domain projection 作为公开 Execution Trace 的主读链
- Audit Event、Session Operation、消息与变更构成一条可回放事实链
- 面向安全、合规、交付和客户对齐，提供可验证、可导出的证据

### 4.4 成本与预算可控

- Usage Ledger 作为 append-only 的调用与成本事实
- Budget 提供组织或项目维度的上限、周期与告警
- Cost 与 Task / Session 绑定，让费用可以追到具体业务工作项

## 5. 用户视角下的典型使用链路

以下三条链路覆盖目标用户在真实场景中的主要使用方式，帮助快速判断 OpenerX 是否解决你当前关心的问题。

### 5.1 研发管理者：统一掌控跨团队 AI 使用

1. 通过 Organization 和 Project 建立治理边界。
2. 在 Project 下发起 Task，由真实成员或 Agent 组成的团队执行。
3. 在 Task 详情页查看 Session 执行、消息流、变更与决策点。
4. 对异常任务进行人工介入、暂停或升级。

### 5.2 安全与合规负责人：把制度嵌入执行路径

1. 在 Policy 与 Approval 标准中配置高风险动作清单与审批规则。
2. 对满足条件的 Session Operation 触发 Gate 或 Hook。
3. 审批通过后，Runtime 继续执行，审批被作为 Audit Event 留痕。
4. 事后通过 Execution Trace 导出证据链。

### 5.3 平台工程与成本负责人：规模化与预算化

1. 在组织级别配置预算上限、周期与告警规则。
2. 通过 Usage Ledger 回看各项目、各 Task 的调用与费用分布。
3. 在 Runtime Backend 层面统一接入默认 `pi-mono`，减少各团队自己接运行时的复杂度。
4. 通过 BFF 的事件管道获取实时状态，用于内部平台集成。

## 6. 系统边界（给评估方的架构概览）

目标用户在评估 OpenerX 时最关心“系统装进我的组织后会是什么样”。可以用一张分层图回答：

- **Web UI**：用户界面层，负责登录、任务视图、审批处理、Agent 控制。
- **BFF**：前端聚合与 Runtime 适配层，对外提供 `/api` 与 `/ws`，不承载主数据。
- **Control Plane Service**：业务核心与治理数据落库，主数据库为 PostgreSQL。
- **Runtime Backend（默认 `pi-mono`）**：由 BFF 托管的 RPC 子进程，负责 Session 执行、消息读取、guidance/resume/terminate 与事件桥接。

总体原则：

- 控制平面负责治理与持久化
- Runtime 负责执行
- 公开 Execution Trace 以持久化 projection 为主，不以 Runtime 原始消息为主
- Canonical Session ID 面向外部，Runtime Session ID 留给执行器与写链内部

完整架构说明见 [architecture/architecture-overview.md](../architecture/architecture-overview.md)，术语定义见 [architecture/core-concepts-glossary.md](../architecture/core-concepts-glossary.md)。

## 7. 与常见替代方案的差别

面向目标用户，OpenerX 与以下几类方案有明确的定位差别：

1. **和个人 AI IDE / 代码助手相比**
   OpenerX 不是让单个工程师更快完成一段代码，而是让组织把 AI 的使用纳入可治理流程。

2. **和通用多 Agent 编排引擎相比**
   OpenerX 不满足于“把多个 Agent 连起来”，而是把编排放在治理、审批、预算、审计的上下文中。

3. **和新的底层 Runtime / 模型平台相比**
   OpenerX 不是新做一个运行时，而是在已有运行时之上提供组织级的控制面。

4. **和纯 Chat 助手相比**
   OpenerX 的第一公民不是对话，而是 Task、Session、Member、Agent、Approval 这些可治理对象。

## 8. 面向不同目标用户的切入点

如果你是：

- **研发管理者**：先看 Project、Task、Session 的执行视图与 Execution Trace。
- **安全与合规负责人**：先看 Policy、Approval、Audit Event、可导出的证据链。
- **平台工程与 DevOps 团队**：先看 BFF、Runtime Backend 默认 `pi-mono`、事件管道与部署拓扑。
- **成本与运营相关角色**：先看 Usage Ledger、Budget、Cost 与 Task 的关联。
- **内部产品与交付团队**：他们真正关心的不是底层 Trace 契约，而是“这批需求能不能按期交付、AI 参与之后质量会不会失控、对外怎么交代”。OpenerX 在这些问题上提供的能力包括：
  - **需求到执行的映射**：把产品/交付口径的需求、工单、迭代挂到 Project 和 Task 上，让"正在做什么"在产品视角是可见的，而不只是开发者私域的对话记录。
  - **交付状态可见**：通过 Task 生命周期状态（draft / active / done / archived）和 Session 执行视图，随时回答"做到哪一步、卡在哪、是否需要人工介入"。
  - **质量与验收把关**：利用 Gate、Hook 和 Approval 把测试通过、评审通过、风险提示等作为交付前置条件，而不是靠会议口头确认。
  - **跨角色协作**：产品、开发、测试、运维可以作为 Member 或 Agent 同时参与一个 Task，保留完整的讨论与决策轨迹，方便交付回顾和对外同步。
  - **对外可解释**：当业务方、客户或合作方问"AI 改了什么、为什么这么改"时，可以基于 Audit Event 和 Execution Trace 导出一份可解释的证据，而不必临时翻日志。
  - **与现有交付工具集成**：通过控制平面对外的稳定接口，把 OpenerX 中的 Task、审批、变更状态同步到公司既有的需求管理、发布管理或项目管理系统，而不要求团队换一套工具。

## 9. 一段话总结

OpenerX 是一个让企业可以放心使用 AI Agent 的控制面：前台围绕 Project、Task、Member、Agent 组织协作，后台通过“控制平面治理 + 运行时执行分离”的架构，把执行、审批、预算、审计和追踪统一起来。它的目标用户不是个人开发者，而是需要把 AI 纳入正式研发流程的组织和团队。
