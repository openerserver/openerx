# OpenerX 成员优先的 Agent 协作产品方案

> runtime 状态说明：当前默认 backend 已切到 `pi-mono` runtime-provider。本文中凡提到运行时执行层，默认应理解为 runtime backend；涉及 OpenCode 的部分只保留历史边界与回退兼容语境。
>
> 适用范围：OpenerX 控制平面、BFF、Web UI、运行时治理与任务协作产品演进
>
> 目标：将现有以角色化 Agent、模板、Hook、运行时执行为主的设计，重新收敛为一套前台以 Agent 为主、成员协作为核心、Role 退居系统内部的统一产品模型

## 1. 文档目标

本文档回答以下问题：

- OpenerX 在产品上应该被用户理解成什么
- 任务、成员、Agent、Skill、管理者、普通用户之间的关系是什么
- 为什么前台应以 Agent 为主，而不应让 Role 成为用户必须先理解的主概念
- 在保留治理能力的前提下，如何把人类成员与 Agent 成员统一到同一协作模型中
- Role 在新方案中还是否保留，保留到什么程度
- 这套模型如何与现有模板、审批、运行时、执行记录体系兼容

本文档是产品与对象模型方案，不是底层代码实现细节说明。

相关文档：

- [docs/development-role-agents-plan.md](development-role-agents-plan.md)
- [archive/organization/historical-boss-agent-design.md](../archive/organization/historical-boss-agent-design.md)（历史文档）
- [docs/organization-oriented-agent-technical-checklist.md](organization-oriented-agent-technical-checklist.md)
- [docs/organization-oriented-agent-frontend-information-architecture.md](organization-oriented-agent-frontend-information-architecture.md)
- [docs/multi-agent-hook-architecture.md](../architecture/multi-agent-hook-architecture.md)

本次重写后的文档关系建议如下：

- [docs/organization-oriented-agent-operating-model.md](organization-oriented-agent-operating-model.md)：主产品方案，定义前台心智模型、成员关系和核心对象
- [archive/organization/historical-boss-agent-design.md](../archive/organization/historical-boss-agent-design.md)：历史阶段曾用于细化老板 Agent 方案，当前应视为已被管理员成员模型取代的旧设计
- [docs/development-role-agents-plan.md](development-role-agents-plan.md)：保留为“系统内部职责位与阶段接入”文档，而不再视为前台主心智来源
- [docs/organization-oriented-agent-technical-checklist.md](organization-oriented-agent-technical-checklist.md)：把本方案落到配置项、数据结构、API 和页面承载

## 2. 背景与重写原因

当前 OpenerX 已具备以下基础能力：

- 生命周期 Hook
- 工作流模板与阶段模型
- 多 Agent 执行
- 并行候选与聚合评判
- 审批、阻断、修正请求与任务收口
- 运行时执行接入（当前默认 backend 为 `pi-mono`，兼容旧 OpenCode 路径）

但原方案在产品层存在四个问题：

1. `task`、`agent`、`role`、`run` 在用户心智中边界不够稳定。
2. 前台过早暴露 Role，会让用户误以为自己在操作“组织结构配置系统”，而不是在调度一个可工作的团队。
3. 人类成员与 Agent 成员被拆成两套理解方式，导致任务协作心智不统一。
4. Agent 既被当作岗位，又被当作运行时执行体，还被当作监控对象，语义过载。

因此，本次方案重写的目标不是继续扩展 Role 体系，而是把前台心智收敛为：

- 任务是工作目标
- 成员是任务参与主体
- Agent 是系统中的可调度成员
- Skill 是成员能力说明
- Role 是系统内部的职责抽象，不再作为前台主概念

## 3. 一句话定义

OpenerX 是一个让人类成员与 Agent 成员围绕任务协作完成工作的 Agent 团队系统。

在这个定义下：

- 任务回答“要做什么”
- 成员回答“谁在参与”
- Agent 回答“系统里的哪些成员可以自动工作”
- Skill 回答“这些成员擅长什么”
- 管理者回答“什么可以做、何时需要审批、谁承担最终责任”
- Role 只在系统内部回答“某个成员此刻被允许承担什么职责位、进入什么环节、执行什么范围内的动作”

## 4. 核心设计结论

本方案的核心结论如下：

1. 前台产品必须以 Agent 为主，而不是以 Role 为主。
2. 普通用户成员与 Agent 成员在任务协作模型中应尽量统一。
3. 普通用户成员与 Agent 成员的核心差异只保留两类：意图来源与身份来源。
4. 管理者成员不是另一种 Agent，而是具备授权、审批、监督和责任兜底能力的人类成员。
5. Role 不删除，但退居系统内部，主要服务于治理、编排、权限和统计。
6. 运行实例、运行时绑定、技能装配等都不应再抢占前台主概念。

## 5. 核心原则

### 5.1 任务优先

用户首先看到的是任务，而不是组织结构。

系统的首要目标不是让用户配置一套复杂角色关系，而是帮助用户围绕任务组织成员、推进结果、沉淀产物。

### 5.2 成员统一

前台统一使用“成员”作为任务参与主体的表达。

成员包括：

- 管理者成员
- 普通用户成员
- Agent 成员

除意图来源与身份来源外，普通用户成员与 Agent 成员在任务协作模型中应尽量一致。

### 5.3 Agent 是成员，不是底层工具

前台中的 Agent 应当被理解为团队里的系统成员，而不是：

- 某个模型
- 某段 prompt
- 某个 runtime agent name
- 某次执行记录
- 某个 Hook 节点

用户看到的应该是：

- 这个 Agent 擅长什么
- 这个 Agent 正在做什么
- 这个 Agent 适不适合参与当前任务
- 这个 Agent 最近表现如何

### 5.4 Skill 是能力说明，不是主体

Skill 用于描述成员会什么、擅长什么、能处理什么问题。

Skill 不是任务主体，不是职责位，也不是执行记录。

Skill 在产品上主要承担以下作用：

- 帮助用户理解 Agent 为什么被推荐
- 帮助系统做匹配与推荐
- 帮助管理员做能力装配与治理

### 5.5 Role 内收

Role 保留，但默认不作为前台一等产品概念。

Role 的语义边界需要明确：

- Role 不定义成员是谁
- Role 不直接定义成员拥有什么能力
- Role 主要定义成员在当前组织与任务上下文中的责任边界、准入范围、动作权限与责任归属

Role 主要用于：

- 工作流准入
- 模板分工
- 审批规则
- 权限边界
- 同类成员统计
- 多成员协作中的责任位映射

Role 的建立、命名、可用范围、权限边界与默认责任位，统一由管理员在后台治理页面维护。

这意味着：

- Role 是后台治理对象
- Agent 是前台主要成员对象
- Skill 是能力说明对象
- 前台普通成员默认不直接创建或编辑 Role

前台默认用“分工”“职责说明”“负责内容”来表达，而不是要求用户先理解 Role。

换句话说，Role 限制的不是成员身份，而是成员可行动作、可参与阶段、可调用能力范围与责任边界。

### 5.6 管理权与执行权分离

管理者成员负责：

- 授权
- 审批
- 监督
- 最终责任兜底

Agent 成员负责：

- 分析
- 实施
- 审查
- 产出
- 自动推进

普通用户成员负责：

- 提出原始意图
- 补充上下文
- 反馈与确认
- 参与协作

## 6. 前台统一成员模型

### 6.1 成员分类

前台只保留一个统一主体概念：成员。

成员分为三类：

1. 管理者成员
2. 普通用户成员
3. Agent 成员

其中：

- 管理者成员：具备治理权的人类成员
- 普通用户成员：提供原始意图和业务上下文的人类成员
- Agent 成员：被系统装配、可自动工作的成员

### 6.2 普通用户成员与 Agent 成员的统一性

普通用户成员与 Agent 成员在任务协作模型中应共享同一套产品能力：

- 都可以加入任务
- 都可以承担分工
- 都可以出现在任务成员列表中
- 都可以产生消息、评论、结论和行动记录
- 都可以出现在任务时间线中
- 都可以被观察当前状态

两者只保留两个底层差异：

1. `identitySource`
   - `human`
   - `agent`

2. `intentSource`
   - `original`
   - `derived`

前台默认不强调这两个差异，只在审计、说明或高级视图中体现。

### 6.3 为什么不把用户直接叫 Agent

从系统抽象看，人类成员与 Agent 成员都可以看作成员。

但前台不建议把用户直接叫 Agent，原因如下：

1. 会弱化人类成员的真实业务意图来源。
2. 会模糊授权关系，仿佛用户也只是被系统配置出来的对象。
3. 会让产品文案变得别扭。
4. 会削弱审计中“人做的决定”和“系统自动决定”的边界。

因此，前台统一为成员模型，而不是把所有成员都重新命名为 Agent。

## 7. 前台对象模型

### 7.1 Task

任务仍然是前台第一对象。

任务回答的是：

- 要做什么
- 为什么做
- 做到什么算完成
- 当前推进到哪里

任务不直接承载复杂组织抽象。

### 7.2 Member

成员是任务参与主体。

前台一个成员卡片建议至少表达：

- 名称
- 成员类型
- 擅长内容
- 当前状态
- 当前分工
- 最近活动

### 7.3 Agent

Agent 是成员中的一种特殊成员。

前台对 Agent 的定义是：

- 可持续参与多个任务
- 带有一组稳定 Skills
- 可被系统推荐和调度
- 在授权边界内可自动工作
- 可被评估表现和可靠性

### 7.4 Skill

Skill 是成员能力说明。

前台对 Skill 的表达建议是：

- 标签
- 专长
- 擅长任务类型
- 推荐理由的一部分

不建议把 Skill 做成比 Agent 更重的主导航对象。

### 7.5 Assignment

前台不强调 Role Assignment，而强调成员分工。

系统表达为“任务成员分工”：

- 主实现
- 协助分析
- 审查复核
- 审批确认
- 异常接管

### 7.6 Session / Run

前台表达为工作过程或执行记录，不再抢占 Agent 概念。

用户应该理解为：

- Agent 是成员
- Run 是成员在当前任务中的一次工作过程

## 8. 用户、管理者、Agent 的关系

### 8.1 管理者成员

管理者成员是高权限人类成员。

其核心职责：

- 授权者
- 监督者
- 审批者
- 最终责任承担者之一

管理者成员不是普通 Agent 的替代，而是系统中具备治理权、审批权和责任兜底能力的人类成员。

### 8.2 普通用户成员

普通用户成员是低治理权、强业务意图的人类成员。

其核心职责：

- 提出原始意图
- 补充上下文
- 参与任务协作
- 提供反馈与确认

### 8.3 Agent 成员

Agent 成员是被系统装配和调度的自动化成员。

其核心职责：

- 承接派生意图
- 分析问题
- 生成方案
- 实施与修改
- 审查与复核
- 在规则内自动推进任务

### 8.4 不再单独存在老板层

当前方案不再单独保留“老板 Agent”或“老板层”。

原因如下：

1. 产品上再单独引入老板层，会重新制造一套与管理员重叠的治理心智。
2. 管理、审批、监督、经营兜底本质上都应归入管理员成员体系。
3. 任务经营相关动作可以继续存在，但应被表达为管理员成员的治理动作，而不是一层新的产品角色。

因此，本方案中的任务经营、模板切换、风险升级、阶段推进建议等能力，统一归到管理员成员视角下表达。

必要时系统仍可有自动化的管理辅助能力，但它不再作为前台独立层存在，也不再被建模成单独的“老板”对象。

## 9. Role 在新方案中的位置

### 9.1 保留 Role，但不前置 Role

Role 不删除，因为系统内部仍然需要它来表达稳定职责位。

例如：

- developer
- architect
- qa
- security
- ops

但 Role 不再要求成为用户必须先理解的前台主概念。

### 9.2 Role 的主要用途

Role 在系统内部主要承担以下作用：

1. 决定模板中的默认责任位
2. 决定某类任务需要哪些职责位参与
3. 决定谁有写权限、谁有评审权、谁有审批建议权
4. 决定同类 Agent 的统计维度
5. 支撑多成员协作时的责任替换与兼容

### 9.3 前台如何替代 Role 文案

前台默认不直接写 Role，而写：

- 负责内容
- 成员分工
- 任务职责
- 当前定位

例如：

- “主实现”而不是“developer role”
- “方案把关”而不是“architect role”
- “安全复核”而不是“security role”

## 10. 前台产品信息架构建议

### 10.1 前台一等对象

建议前台主概念保持为五个：

1. Task
2. Member
3. Agent
4. Skill
5. Run

### 10.2 前台默认页面语言

建议统一使用以下表达：

- “任务成员”
- “成员分工”
- “当前执行成员”
- “推荐 Agent”
- “擅长技能”
- “执行记录”

避免直接出现过多内部化术语，例如：

- role binding
- runtime agent
- execution candidate
- hook agent

### 10.3 典型页面心智

任务详情页应回答：

- 任务目标是什么
- 有哪些成员在参与
- 谁当前负责什么
- 当前谁在工作
- 最近发生了什么
- 还需要谁介入

Agent 页面应回答：

- 这个 Agent 是谁
- 它擅长什么
- 它通常怎么工作
- 它最近表现如何
- 它当前参与了哪些任务

## 11. 与现有系统的兼容关系

### 11.1 与模板、Hook、阶段模型兼容

本方案不推翻现有模板、Hook、阶段和运行时设计。

它做的主要是产品概念收敛：

- 前台以成员与 Agent 为主
- 系统内部继续保留 Role、模板、阶段和聚合策略

### 11.2 与 Runtime Backend 的关系

当前默认执行 backend 已切到由 BFF `runtime-provider` 托管的 `pi-mono` RPC 子进程。

OpenCode runtime 只保留历史资料、协议排障和回退兼容语境。

但在本方案中：

- runtime agent name 不是前台主概念
- 运行实例不是 Agent 本体
- 前台展示以成员与任务协作为中心

### 11.3 与现有角色化文档的关系

[docs/development-role-agents-plan.md](development-role-agents-plan.md) 仍然有效，但其定位应调整为：

- 系统内部职责位设计文档
- 阶段接入与治理配置文档

而不再作为前台产品心智的首选来源。

## 12. 最小产品对象定义

建议前台先按以下最小对象定义收敛：

```ts
type MemberKind = "manager" | "user" | "agent";
type IdentitySource = "human" | "agent";
type IntentSource = "original" | "derived";

interface Member {
  id: string;
  kind: MemberKind;
  identitySource: IdentitySource;
  intentSource: IntentSource;
  displayName: string;
  summary?: string;
  skillTags?: string[];
  availability?: "idle" | "busy" | "offline";
}

interface TaskMemberAssignment {
  id: string;
  taskId: string;
  memberId: string;
  responsibilityLabel: string;
  participationType: "lead" | "support" | "review" | "approval" | "observer";
  status: "assigned" | "active" | "paused" | "done";
}

interface WorkSession {
  id: string;
  taskId: string;
  memberId: string;
  mode: "interactive" | "automated";
  status: "running" | "paused" | "completed" | "failed";
  summary?: string;
  startedAt: string;
  finishedAt?: string;
}
```

这套定义已经足以支撑：

- 前台成员列表
- Agent 推荐
- 任务成员分工
- 工作过程展示
- 人类成员与 Agent 成员统一时间线

## 13. 分阶段落地建议

### 第 1 期

目标：先统一前台话语体系。

- 任务详情改用“成员”“分工”“执行记录”语言
- Agent 页面突出 Skills、风格、表现
- 弱化 Role 直出

### 第 2 期

目标：统一成员模型。

- 前台把普通用户成员与 Agent 成员纳入同一成员视图
- 任务分工改为 `TaskMemberAssignment`
- Agent 运行记录与人工参与记录进入统一时间线

### 第 3 期

目标：让内部 Role 与外部成员模型解耦。

- 保留内部 Role 作为治理与模板抽象
- 外部页面默认不暴露 Role 细节
- 管理者决策、审批、阶段推进都通过“成员协作”语言呈现

## 14. 总结

本方案的核心不是继续扩大 Role 体系，而是把产品心智重新收敛到用户真正能理解的层次：

- 任务是工作目标
- 成员是参与主体
- Agent 是系统中的自动化成员
- Skill 是成员能力说明
- 管理者成员负责治理
- 普通用户成员提供原始意图与上下文
- Role 退到系统内部，继续为治理、编排和权限服务

如果按这个方向推进，OpenerX 前台会从“复杂的角色与运行时配置系统”收敛为“一个围绕任务组织成员协作完成工作的 Agent 团队系统”。
