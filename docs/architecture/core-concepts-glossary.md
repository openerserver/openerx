# OpenerX 关键概念统一词表

> 状态：Draft v1  
> 日期：2026-03-29  
> 适用范围：当前仓库内 Markdown 文档的统一术语整理  
> 统计口径：基于根目录、docs/、design/、runbooks/ 等目录下截至当前的 191 份 Markdown 文档抽取
>
> runtime 口径说明：当前默认 runtime backend 已切到 `pi-mono` runtime-provider。旧 OpenCode runtime 在本词表中只保留历史/回退兼容语境，不再作为“当前默认执行主路径”概念使用。

## 1. 文档目的

这份词表用于把当前文档中反复出现、并且承担稳定定义作用的关键概念收敛到一处，降低后续方案文档、接口文档和产品文档中的命名漂移。

纳入标准只有三条：

1. 在多份文档中反复出现
2. 具有明确的产品、架构、协议、治理或数据语义
3. 足以作为后续文档继续复用的稳定名词

本词表默认不收录以下内容：

1. 一次性方案名、阶段名、会议材料名
2. 纯页面名、纯测试名、纯脚本名
3. 已被明确降级为历史实现或兼容命名的旧术语

## 2. 一级核心概念

以下概念是当前文档体系里最核心的一层，后续文档应优先复用这些词作为主概念。

| 名词 | 一句话定义 | 主要来源 |
| --- | --- | --- |
| OpenerX | 面向企业研发组织的 AI Dev/Ops 控制平面。 | [architecture-overview.md](architecture-overview.md)、[product/business-model-analysis.md](../product/business-model-analysis.md)、[product/high-level-decision-summary.md](../product/high-level-decision-summary.md) |
| Control Plane（控制平面） | 承载组织、项目、审批、预算、审计和治理能力的统一控制面。 | [architecture-overview.md](architecture-overview.md)、[product/high-level-decision-summary.md](../product/high-level-decision-summary.md) |
| Task（任务） | 用户可见、可手动处理的业务工作项。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[architecture-overview.md](architecture-overview.md) |
| Session（会话） | 某个 task 下的一次具体执行分支。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md) |
| Workflow（工作流） | 定义模板、阶段规则、触发条件和治理约束的静态规则域。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[dag-node-execution-plan-v2.md](../workflow/dag-node-execution-plan-v2.md) |
| Agent（智能体） | 系统内可被调度、可执行任务、受治理约束的自动化成员。 | [organization-oriented-agent-operating-model.md](../organization/organization-oriented-agent-operating-model.md)、[development-role-agents-plan.md](../organization/development-role-agents-plan.md) |
| Member（成员） | 任务参与主体的统一表达，覆盖人类成员与 Agent 成员。 | [organization-oriented-agent-operating-model.md](../organization/organization-oriented-agent-operating-model.md) |
| BFF（前端聚合层） | 介于 Web UI 与控制平面服务之间的鉴权、适配与实时聚合层。 | [architecture-overview.md](architecture-overview.md)、[task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md) |
| Control Plane Service | 控制平面的主业务服务和主数据落库入口。 | [architecture-overview.md](architecture-overview.md) |
| Runtime Backend（默认 `pi-mono`） | 由 BFF 通过 `runtime-provider` 托管的当前默认执行后端，负责会话执行、消息读取、guidance/resume/terminate 与 runtime 事件桥接。 | [architecture-overview.md](architecture-overview.md)、[runtime/current-implementation-index.md](../runtime/current-implementation-index.md)、[runtime/pi-mono-upstream-development-plan.md](../runtime/pi-mono-upstream-development-plan.md) |
| Execution Trace（执行追踪） | 面向 task 或 project 的公开执行事实链和时间线视图。 | [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)、[architecture-overview.md](architecture-overview.md) |

## 3. 产品与治理概念

| 名词 | 一句话定义 | 主要来源 |
| --- | --- | --- |
| Organization（组织） | 系统中的最高治理单元，承载成员、项目、角色和治理策略。 | [architecture-overview.md](architecture-overview.md)、[product/business-model-analysis.md](../product/business-model-analysis.md) |
| Project（项目） | 工作边界、资源归属和任务承载的上层业务容器。 | [architecture-overview.md](architecture-overview.md)、[task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Role（角色） | 系统内部的职责抽象，用来表达权限、职责位和阶段准入。 | [organization-oriented-agent-operating-model.md](../organization/organization-oriented-agent-operating-model.md) |
| Policy（策略） | 预定义的治理规则集合，用于权限、预算、审批和执行约束。 | [architecture-overview.md](architecture-overview.md) |
| Approval（审批） | 对高风险动作或关键任务进行人工审核和授权的治理机制。 | [architecture-overview.md](architecture-overview.md)、[task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Audit Event（审计事件） | 可被记录、追溯和导出的行为事实。 | [architecture-overview.md](architecture-overview.md)、[product/high-level-decision-summary.md](../product/high-level-decision-summary.md) |
| Governance（治理） | 对 Agent、任务、预算、权限和审批的整体约束与控制能力。 | [product/business-model-analysis.md](../product/business-model-analysis.md)、[product/high-level-decision-summary.md](../product/high-level-decision-summary.md) |
| Skill（技能） | 成员或 Agent 的能力说明，用于协作建模、推荐和统计。 | [organization-oriented-agent-operating-model.md](../organization/organization-oriented-agent-operating-model.md) |

## 4. 系统架构与运行时概念

| 名词 | 一句话定义 | 主要来源 |
| --- | --- | --- |
| Web UI | 面向用户的前端界面层，负责页面渲染、交互和状态承载。 | [architecture-overview.md](architecture-overview.md)、[current/current-implementation-functional-overview.md](../current/current-implementation-functional-overview.md) |
| Realtime Pipeline（实时管道） | 从 Runtime SSE 到 BFF 聚合再到前端展示的实时数据链路。 | [architecture-overview.md](architecture-overview.md)、[task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md) |
| SSE | Runtime 向外推送实时事件的服务器发送事件通道。 | [opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md) |
| MCP | 用于 Agent 调用外部工具和上下文资源的标准协议。 | [architecture-overview.md](architecture-overview.md) |
| OpenCode Runtime（历史 / 回退兼容） | 旧外部运行时执行引擎；当前仅保留历史资料、协议排障和回退兼容语境，不再作为默认执行主路径。 | [archive/runtime/README.md](../archive/runtime/README.md)、[archive/runtime/historical-opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md) |
| Plugin（插件） | Runtime 生态内的能力扩展单元。 | [opencode-focus-boundary.md](../archive/runtime/historical-opencode-focus-boundary.md)、[opencode-internals.md](../archive/runtime/historical-opencode-internals.md) |
| Runtime Permission（运行时权限） | Agent 在具体执行上下文中的动作授权和限制。 | [organization-oriented-agent-technical-checklist.md](../organization/organization-oriented-agent-technical-checklist.md)、[approval-standards-management-plan.md](../workflow/approval-standards-management-plan.md) |
| Contract / DTO | 系统对外公开的接口字段语义与数据传输结构。 | [task-session-message-service-route-dto-draft.md](../task-domain/task-session-message-service-route-dto-draft.md)、[api-boundary.md](api-boundary.md) |

## 5. 任务与执行编排概念

| 名词 | 一句话定义 | 主要来源 |
| --- | --- | --- |
| Workflow Stage（工作流阶段） | 工作流中的离散规则阶段，定义 gate、hook、审批和触发条件。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[dag-node-execution-plan-v2.md](../workflow/dag-node-execution-plan-v2.md) |
| Gate（门控） | 阶段进入或继续执行之前必须满足的条件控制。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Hook（钩子） | 挂载在 task 生命周期事件上的自动触发动作。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[multi-agent-hook-architecture.md](multi-agent-hook-architecture.md) |
| Lifecycle Status（生命周期状态） | task 在业务层的稳定状态表达，如 draft、active、done、archived。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Session Operation（会话操作） | session 内部发生的原子执行动作记录，如 executor、judge、hook、resume 调用。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Candidate（候选） | 并行执行中产生的可选分支之一。 | [task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md)、[research/parallel-judge-selection-plan.md](../research/parallel-judge-selection-plan.md) |
| Judge（评判） | 对多个 candidate 进行比较并选出结果的评判逻辑或评判 Agent。 | [task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md)、[research/parallel-judge-selection-plan.md](../research/parallel-judge-selection-plan.md) |
| Sequential Chain（顺序链） | 将多个执行步骤按固定顺序串联起来的任务执行方式。 | [task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md)、[dag-node-execution-plan-v2.md](../workflow/dag-node-execution-plan-v2.md) |
| Resume（续跑） | 在已有 session 或执行链基础上恢复执行的动作语义。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md) |

## 6. 消息、时间线与 Trace 概念

| 名词 | 一句话定义 | 主要来源 |
| --- | --- | --- |
| Message（消息） | 用户、Agent 或系统之间交换的基础通信单元。 | [task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md)、[opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md) |
| Timeline（时间线） | 按时间顺序聚合的 task 或 session 事实视图。 | [task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md)、[execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) |
| Projection Timeline（投影时间线） | 从持久化事实表推导出来的公开 trace 主读链时间线。 | [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)、[task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Service Timeline（服务时间线） | 在 projection 为空或不可用时才允许补位的受限 secondary source。 | [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) |
| Public Trace Contract（公开 Trace 契约） | 对外暴露的 task / project execution trace 读取边界与字段语义。 | [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)、[execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) |
| Session Message Compatibility Contract（会话消息兼容契约） | 面向 lineage、branch 预览等非公开 consumer 的 session message 兼容读取约定。 | [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)、[task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md) |
| Canonical Session ID | 面向前端、BFF 和 service public route 的统一 session 标识。 | [task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md) |
| Runtime Session ID | 执行器和写链内部用于关联 runtime 会话的内部标识。 | [task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md)、[opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md) |
| Placeholder Message（占位消息） | 模型回复开始前先创建的 assistant 占位记录，用于流式增量回填。 | [task-session-message-minimal-contract.md](../task-domain/task-session-message-minimal-contract.md) |

## 7. 数据、成本与产物概念

| 名词 | 一句话定义 | 主要来源 |
| --- | --- | --- |
| Usage Ledger（使用账本） | append-only 的模型调用与成本核算事实表。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Cost（成本） | 模型调用、运行时权限使用或任务执行带来的费用消耗。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[product/business-model-analysis.md](../product/business-model-analysis.md) |
| Budget（预算） | 对项目或组织成本上限、周期和告警规则的治理约束。 | [architecture-overview.md](architecture-overview.md)、[product/business-model-analysis.md](../product/business-model-analysis.md) |
| Task Artifact（任务产物） | task、session、message 或 operation 产出的正式输出对象。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md) |
| Snapshot（快照） | 用于快速读取和恢复的某一时刻聚合状态副本。 | [task-session-first-schema-plan.md](../task-domain/task-session-first-schema-plan.md)、[task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md) |
| Projection（投影） | 从事实表推导出的读模型结果，不等同于原始事实本身。 | [task-run-data-end-to-end.md](../task-domain/task-run-data-end-to-end.md)、[execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) |

## 8. 当前建议统一使用的表达

以下表达是当前文档体系里已经比较稳定的边界，后续文档建议直接沿用。

1. 产品定位优先使用“AI Dev/Ops 控制平面”或“企业研发控制平面”，避免把 OpenerX 描述成个人 AI IDE、聊天助手或纯编排引擎。
2. 前台协作模型优先使用“Task / Member / Agent / Skill”，避免让 Role 成为用户必须先理解的主概念。
3. 目标执行模型优先使用“Task / Session / Session Operation”，避免继续用 `task_run`、`agent_run` 作为主模型名词。
4. public route 优先使用 canonical `sessionId`，`runtimeSessionId` 只保留给执行器和写链内部。
5. execution trace 的公开 contract 采用 projection-first；service timeline 只在 projection 为空或不可用时补位，runtime raw message 不是公开 trace fallback。
6. 描述系统边界时，优先使用“控制平面治理 + 运行时执行分离”。

## 9. 暂不作为主词表的术语

以下术语在部分实现或历史文档中仍会出现，但当前不建议继续作为统一主概念：

1. `task_runs`、`agent_runs`：更接近当前实现或兼容层命名，不是目标主模型词汇。
2. runtime raw message fallback：已被明确排除在公开 execution trace contract 之外。
3. OpenCode Runtime（作为当前默认主路径的用法）：已降级为历史/回退兼容语境，不应继续当作当前主概念使用。
4. 纯页面名、纯路由名、纯脚本名：可在实现文档中使用，但不适合作为全局概念名词。

## 10. 最近一周核心概念关系图

以下关系图只覆盖 2026-03-22 至 2026-03-29 这一周内，最集中用于澄清产品心智和系统边界的 10 个主概念。

```mermaid
flowchart TD
  subgraph Product[产品主心智]
    Org[Organization]
    Project[Project]
    Task[Task]
    Session[Session]
    Workflow[Workflow]
    Member[Member]
    Agent[Agent]
    Role[Role]

    Org -->|治理范围| Project
    Project -->|承载| Task
    Task -->|包含执行分支| Session
    Member -->|参与| Task
    Agent -->|是一类| Member
    Role -.系统内部职责约束.-> Member
    Workflow -.规则/阶段/审批/触发.-> Task
  end

  subgraph System[系统边界]
    BFF[BFF]
    CPS[Control Plane Service]
    OCR[Runtime Backend\n(default pi-mono)]
    Trace[Execution Trace]

    BFF -->|聚合/适配| CPS
    BFF -->|控制/消息/事件接入| OCR
    CPS -->|投影与持久化读链| Trace
    OCR -.不是公开 Trace 主源.-> Trace
  end

  Task -->|主数据与治理归属| CPS
  Session -->|执行绑定| OCR
  Session -->|事实写入与恢复| CPS
```

这 10 个词，本周主要澄清了四个边界：

1. `Task` 是业务工作项，`Session` 是这个工作项下面的一次执行分支，二者不是同一个对象。
2. `Workflow` 是静态规则域，负责模板、阶段、审批和触发条件，不是项目进度本身，也不是 `Task` 的别名。
3. `Member` 是前台参与主体，`Agent` 是其中一类可自动工作的成员，`Role` 退居系统内部职责抽象。
4. `BFF`、`Control Plane Service`、`Runtime Backend` 的边界是分离的；公开 `Execution Trace` 以持久化投影为主，而不是以 runtime 原始消息为主。

如果只保留一页式说法，可以进一步压缩成下面四句：

1. OpenerX 是企业研发组织的 AI Dev/Ops 控制平面。
2. 前台主心智是 `Project / Task / Member / Agent`，不是 `Role / Run`。
3. 执行主模型是 `Task / Session`，不是把 `Task` 当成第一次 `Run`。
4. 系统边界是“控制平面治理 + 运行时执行分离”，公开 trace 走 projection-first。

## 11. 30 秒口头解释稿

评审会上如果只讲 30 秒，可以直接使用下面这版：

> 这周我们把 OpenerX 的核心概念收紧了。它不是个人 AI IDE，也不是纯 Agent 编排器，而是企业研发组织的 AI Dev/Ops 控制平面。前台主心智是 Project、Task、Member 和 Agent，其中 Task 是业务工作项，Session 是一次执行分支，Workflow 只是规则域，不是任务本身。系统边界上，控制平面负责治理和持久化，Runtime 负责执行，公开 trace 以持久化投影为准。

如果需要更像口语一点，可以按下面的停顿来讲：

> OpenerX 不是个人 AI IDE，/ 它是企业研发组织的 AI Dev/Ops 控制平面。/ 前台围绕 Project、Task、Member、Agent 组织协作。/ Task 是工作项，Session 是执行分支，Workflow 只是规则域。/ 控制平面负责治理，Runtime 负责执行，公开 trace 走 projection-first。
