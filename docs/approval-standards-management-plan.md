# 审核标准管理页重设计方案

## 1. 背景

当前系统已经具备以下能力：

- 审批单查询与处理
- 基于代码变更的风控评估
- 项目级策略模板存储与绑定
- 审计事件记录

但现状仍有明显缺口：

- 审批页偏“处理结果”，不偏“设计规则”
- Project Policies 页只能看模板绑定，不能定义审核触发标准
- 审核触发条件固化在代码里，管理员无法自主调整
- 命中审核时，页面缺少“为何命中”的可解释性

因此需要把“审批管理”升级为“审核治理管理”，让管理员可以设计、启停、绑定、验证审核标准，并让运行中的任务在命中标准时触发审核。

## 2. 目标

本次方案目标不是重做审批处理流程，而是在现有治理链路之上增加“审核标准管理”能力。

核心目标：

1. 管理员可通过管理页面配置审核标准。
2. 审核标准可按项目、环境、角色 Agent、任务类型、阶段 Gate 分层生效。
3. 审核标准可表达多种触发条件，而不是只支持固定几条硬编码规则。
4. 每个审批单都能回溯到命中的标准、命中条件和触发上下文。
5. 审核标准需要与多角色 Agent 工作流对齐，能够消费角色评审结论与阶段准入决策。
6. 保持与现有 `policy_templates`、`approval_tickets`、`audit_events` 兼容，避免推翻重建。

## 3. 设计原则

### 3.1 管理与处置分离

审批页负责处理待审批单。

审核标准页负责配置“什么情况下要进审批”。

两者要联动，但不能混在一个页面里，否则管理员和审批人的操作心智会相互干扰。

### 3.2 模板优先，规则可组合

管理员不直接写代码规则，而是通过模板化条件组合生成审核标准。

优先支持结构化条件：

- 文件路径命中
- 文件类型命中
- 变更文件数量阈值
- 新增/删除行数阈值
- 删除文件数量阈值
- 命令等级
- 环境风险等级
- 是否访问外部 API
- 是否触及敏感凭证/密钥文件
- 是否超过预算阈值

### 3.3 标准显式可解释

每个审批单必须能说明：

- 命中了哪条标准
- 标准版本是什么
- 命中了哪些条件
- 触发时的上下文数据是什么

### 3.4 分层覆盖而非互相覆盖混乱

规则生效顺序应固定：

1. 平台默认标准
2. 项目默认标准
3. 环境覆盖标准
4. 工作流模板 / 阶段 Gate 覆盖标准
5. 角色 Agent / 任务类型覆盖标准

采用“先合并标准，再执行评估”的方式，避免管理员无法理解最终效果。

### 3.5 角色优先于具体 Agent 实例

结合多角色 Agent 方案，审核标准的作用对象不应直接绑定某个底层 Agent 实例名。

更稳定的建模应是：

- 先绑定角色，例如 `security`、`architect`、`developer`、`deploy`、`ops`、`qa`
- 再由角色下的一个或多个 Agent 实例产出评审结果
- 治理引擎消费“角色结论”而不是直接消费某个实例的临时名字

这样可以避免后续更换模型、增加同角色多 Agent 池或切换供应商时，审核标准全部失效。

### 3.6 首期必须形成真实闭环

首期上线不能只提供“标准管理 UI”，却没有真实触发效果。

第一阶段至少要打通以下最小闭环：

1. 管理员创建并发布代码变更类审核标准。
2. 任务完成后进入治理评估。
3. 评估器读取已发布标准并执行匹配。
4. 命中 `require_approval` 标准时自动创建审批单。
5. 审批单详情可回溯命中标准与标准版本。

如果做不到这一点，页面价值会停留在“静态配置中心”，无法证明方案有效。

## 4. 页面重设计建议

### 4.1 顶层导航调整

现有“审批”入口保留，用于处理审批单。

新增“审核标准”或“治理策略”入口，推荐放在 Settings / Governance 分组下，而不是继续挂在审批列表下面。

当前导航已有：

- Dashboard
- 任务
- 任务工作台
- 多任务监控台
- 项目
- Agent 控制台
- 审批
- 对话配置
- 用户管理
- 设置

建议在现有导航中新增“治理策略”入口，放在“审批”与“设置”之间，进入新的审核标准管理页。

### 4.2 新页面信息架构

推荐将管理页拆成四个区块：

#### A. 标准总览

展示：

- 生效中的标准数量
- 已停用标准数量
- 最近 7 天命中次数
- 最近 7 天触发审批次数
- 命中率最高的标准
- 误报率待人工确认的标准

这个区块的目的不是配置，而是帮助管理员识别标准是否过松或过严。

#### B. 标准列表

表格列建议：

- 标准名称
- 作用域
- 优先级
- 状态
- 触发动作类型
- 命中次数
- 最近更新时间
- 当前版本
- 操作

支持筛选：

- 作用域
- 状态
- 风险等级
- 审核动作类型
- 是否默认标准

#### C. 标准编辑器

采用右侧 Drawer 或独立详情页。

编辑器包含：

- 基础信息
- 生效范围
- 触发条件
- 命中后动作
- 审批人策略
- 有效期与启停
- 测试预览

#### D. 命中解释与模拟区

管理员在保存标准前，应该能输入一段模拟上下文进行验证，例如：

- 变更文件列表
- 文件增删行
- 目标环境
- 操作类型
- 是否涉及密钥文件

页面直接显示：

- 是否触发审核
- 命中哪几条条件
- 最终风险等级
- 将生成什么类型的审批单

这部分是减少误配的关键。

## 5. 审核标准的数据模型

当前 `policy_templates` 更像泛化策略模板，不足以完整描述审核标准生命周期。

建议新增一类明确的审核标准模型，而不是继续把所有语义塞进 `rules` 的自由 JSON。

推荐新增逻辑实体：

### 5.1 approval_standards

- id
- projectId
- name
- description
- enabled
- scopeType
- scopeRef
- roleScope
- stageScope
- priority
- actionType
- riskLevel
- decisionMode
- approverPolicy
- version
- createdBy
- updatedBy
- createdAt
- updatedAt

字段说明：

- `scopeType`: `platform | project | environment | workflow_template | workflow_stage | role | task_type`
- `scopeRef`: 对应环境 ID、模板 ID、阶段 ID、角色名或任务类型
- `roleScope`: 用于记录 `security | architect | developer | deploy | ops | qa | product | design` 等角色维度
- `stageScope`: 用于记录 `requirements | design | planning | implementation | validation | release_prep | release_observe | retrospective` 等阶段维度
- `actionType`: `production_write | level3_command | budget_exceed | batch_edit | external_api | custom`
- `decisionMode`: `require_approval | block_only | audit_only`

### 5.2 approval_standard_conditions

- id
- standardId
- field
- operator
- value
- valueType
- order

示例字段：

- `changed_file_path`
- `changed_file_count`
- `total_insertions`
- `total_deletions`
- `deleted_file_count`
- `environment_risk_level`
- `command_level`
- `uses_external_api`
- `contains_sensitive_file`
- `budget_usage_ratio`
- `workflow_stage`
- `workflow_template`
- `role_decision`
- `role_consensus`
- `requested_by_role`
- `reviewer_pool_size`

示例操作符：

- `contains`
- `matches_regex`
- `gt`
- `gte`
- `lt`
- `lte`
- `eq`
- `in`
- `is_true`

### 5.3 approval_standard_versions

用于保留规则版本快照：

- id
- standardId
- version
- snapshot
- createdBy
- createdAt

审批单落库时应记录命中的标准版本，避免后续规则变更导致历史不可解释。

### 5.4 approval_evaluations

建议新增评估结果实体，而不是把一次评估过程全部塞入审批单。

- id
- projectId
- taskId
- agentRunId
- triggerType
- triggerRef
- workflowTemplateId
- workflowStage
- roleDecisionInputs
- reviewerPoolSummary
- finalRiskLevel
- finalDecisionMode
- matchedStandardIds
- matchedConditionSnapshots
- inputSnapshot
- createdAt

作用：

- 支撑审批单追溯
- 支撑调试与模拟结果对比
- 支撑统计“某条标准命中多少次”
- 支撑后续误报分析与规则优化
- 支撑同角色多 Agent 评审池结果聚合与回溯

### 5.5 approval_tickets 结构补强

当前审批单已具备 `requestDetail`，但若要满足强可追溯，建议新增显式字段，避免核心信息埋在自由 JSON 里。

建议补充：

- evaluationId
- standardId
- standardVersion
- triggerType
- workflowStage
- primaryRole

其中：

- `evaluationId` 关联一次完整评估结果
- `standardId` 标识主触发标准
- `standardVersion` 确保历史可复盘
- `triggerType` 标识是代码变更、命令执行前、预算超限还是恢复前审核
- `workflowStage` 标识审批发生在哪个阶段 Gate
- `primaryRole` 标识主要提出审批建议的角色，例如 `security` 或 `deploy`

如短期不想直接改表，也至少应在文档中约定 `requestDetail` 的标准结构。

## 6. 推荐的标准表达方式

页面上不暴露底层 SQL/代码表达式，而是使用“条件组”模型。

推荐语义：

- 组内是 AND
- 组间是 OR

示例：

标准名称：生产环境高风险变更审核

条件组 1：

- 环境 = production
- 变更文件路径 命中 `infra/`

条件组 2：

- 环境 = production
- 变更文件数 >= 20

命中任意一个条件组，即触发审核。

这样既足够表达多数场景，也易于前端做可视化编辑。

### 6.1 评估决策算法

仅有“条件命中”还不够，文档必须明确多标准同时命中时如何决策。

建议规则如下：

#### 风险等级合并

- 多条标准同时命中时，`finalRiskLevel` 取最高值。
- 等级顺序：`critical > high > medium > low`。

#### 决策模式合并

- 若任一标准为 `require_approval`，最终结果为 `require_approval`。
- 否则若任一标准为 `block_only`，最终结果为 `block_only`。
- 否则为 `audit_only`。

顺序为：`require_approval > block_only > audit_only`。

#### 审批人策略合并

- 默认取最高优先级命中标准的 `approverPolicy`。
- 若存在同优先级多条标准同时命中，则采用并集策略，并去重。
- 首期不支持复杂布尔审批流，例如“先环境负责人再项目管理员”。

结合多角色 Agent 工作流，`approverPolicy` 建议优先支持角色化审批人，而不是直接绑定某一个人。

建议优先支持：

- `project_admin`
- `environment_owner`
- `security_reviewer`
- `release_manager`

其中 `security_reviewer` 与 `release_manager` 对应的是流程角色，不等于底层某个 Agent 实例。

#### 主标准确定

审批单需要一个“主标准”用于列表展示和回溯。

建议按以下顺序选择：

1. 决策模式优先级最高
2. 风险等级最高
3. 标准优先级最高
4. 作用域最具体
5. 最近发布时间最新

#### 作用域优先级

当规则同等命中时，作用域具体性优先级为：

`workflow_stage/role/task_type > workflow_template > environment > project > platform`

#### 最终评估输出

治理引擎每次评估应返回：

- `matched`: 是否命中至少一条标准
- `matchedStandards`: 所有命中标准
- `primaryStandard`: 主标准
- `finalRiskLevel`
- `finalDecisionMode`
- `approverCandidates`
- `conditionExplanations`
- `workflowGateDecision`
- `roleReviewSummary`
- `evaluationId`

## 7. 触发链路设计

### 7.1 运行时触发入口

建议把审核标准评估统一放到治理引擎，而不是散落在多个模块中。

统一入口：

1. 运行时完成任务后采集变更事实
2. 控制平面生成 `code_changes` / 运行时上下文事实
3. 若处于工作流阶段切换点，同时生成阶段 Gate 事实与角色评审结论
4. 治理引擎加载当前生效标准
5. 按作用域合并标准
6. 执行条件匹配
7. 生成评估结果
8. 若 `decisionMode = require_approval`，创建审批单
9. 写入审计事件

### 7.2 可扩展的触发源

除了代码变更，后续还应支持：

- 命令执行前审核
- 任务恢复前审核
- 预算超限审核
- 外部 API 调用审核
- 生产环境写入审核
- 阶段准入审核
- 角色评审结果驱动的人工确认

这意味着治理引擎的输入不应只接受 `changeId`，还应接受统一事实载荷，例如：

- `triggerType`
- `taskContext`
- `environmentContext`
- `changeFacts`
- `operationFacts`
- `workflowStageFacts`
- `roleReviewFacts`

其中：

- `workflowStageFacts` 表示当前任务位于哪个阶段、是否满足准入条件、谁提出阻断
- `roleReviewFacts` 表示某个角色或同角色多 Agent 池聚合后的结论，例如“安全角色要求审批”

### 7.3 首期触发范围约束

虽然长期要支持多触发源，但首期必须限制范围，避免数据模型先膨胀、链路却没有闭环。

首期建议只支持：

- `triggerType = code_change`
- 输入事实仅来源于 `code_changes` 与 `file_changes`
- 动作为 `require_approval`
- 审批单类型固定映射为 `batch_edit`
- 可选接入单一角色结论字段，但只作为解释信息，不参与首期决策

暂不纳入首期：

- 命令执行前审核
- 恢复前 Hook 审核
- 预算超限审核
- 外部 API 实时审核
- 多级审批流
- 基于阶段 Gate 的强制审批
- 同角色多 Agent 评审池自动裁决

这样可以直接替换当前硬编码 risk-engine，而不是再并行维护两套决策逻辑。

## 8. 页面交互方案

### 8.1 标准创建流程

1. 点击“新建审核标准”
2. 选择标准类型
3. 配置作用域
4. 配置触发条件
5. 配置命中后动作
6. 运行模拟测试
7. 保存并发布

草稿和发布应分开，避免未验证的标准直接生效。

### 8.2 标准编辑页模块

#### 基础信息

- 名称
- 描述
- 标准标签
- 风险等级

#### 生效范围

- 平台默认 / 项目默认 / 环境 / 工作流模板 / 阶段 / 角色 / 任务类型
- 优先级
- 是否允许被下层覆盖

#### 触发条件

- 条件组列表
- 条件字段选择器
- 操作符选择器
- 值输入器
- 命中示例预览

#### 命中动作

- 创建审批单
- 仅记录审计
- 阻断并要求管理员审批
- 附加建议审批人组

#### 审批人策略

- 项目管理员
- 环境负责人
- 安全复核角色
- 发布经理角色
- 指定角色组
- 自定义用户列表

首期建议收敛为：

- 项目管理员
- 环境负责人

二期可新增：

- 安全复核角色
- 发布经理角色

不在首期支持任意用户选择，否则权限、离职用户清理、项目访问校验会同时变复杂。

#### 发布控制

- 草稿
- 已发布
- 已停用
- 定时生效

### 8.3 审批单详情页联动

审批单详情应新增：

- 命中标准名称
- 标准版本
- 命中条件列表
- 触发事实快照
- 规则解释文本
- 关联工作流阶段
- 发起审批建议的角色结论摘要

示例解释：

“命中标准《生产环境基础设施变更审核》v3。因目标环境为 production，且变更文件包含 infra/docker/Dockerfile，因此触发 high 风险审批。”

若后续接入多角色 Agent，还应补充类似解释：

“当前处于发布准备阶段，部署角色判定需要人工确认，安全角色给出高风险建议，因此触发发布前审批。”

## 9. 接口建议

建议新增一组显式 API，而不是继续复用通用 `policies` 接口。

### 9.1 标准管理

```http
GET    /api/approval-standards?projectId=...
POST   /api/approval-standards
GET    /api/approval-standards/:standardId
PATCH  /api/approval-standards/:standardId
POST   /api/approval-standards/:standardId/publish
POST   /api/approval-standards/:standardId/disable
POST   /api/approval-standards/:standardId/rollback
GET    /api/approval-standards/:standardId/versions
```

请求模型中应预留：

- `scopeType`
- `scopeRef`
- `roleScope`
- `stageScope`
- `approverPolicy`

### 9.2 模拟验证

```http
POST   /api/approval-standards/simulate
```

请求体输入模拟上下文，返回：

- matched: boolean
- matchedStandards: []
- triggeredConditions: []
- finalRiskLevel
- decisionMode

### 9.3 评估引擎

```http
POST   /api/governance/evaluate-runtime
POST   /api/governance/evaluate-change/:changeId
POST   /api/governance/evaluate-stage-gate
```

其中 `evaluate-change/:changeId` 可继续保留作为兼容入口。

`evaluate-stage-gate` 用于后续接入多角色 Agent 工作流，在阶段切换前消费角色结论与 Gate 事实。

### 9.4 权限与审计矩阵

需要把谁能做什么写清楚，否则实现时容易与当前项目权限模型冲突。

建议矩阵：

- `viewer`：只读标准列表、版本、命中解释
- `developer`：只读，不可创建/编辑/发布
- `project_admin`：可创建、编辑、发布、停用项目级与环境级标准
- `org_admin`：可查看所有项目标准，可代管发布
- `platform_admin`：仅在引入平台级标准后可创建/发布平台级标准

同时要求以下操作必须写审计事件：

- 创建标准
- 编辑草稿
- 发布版本
- 停用标准
- 回滚版本
- 修改优先级
- 修改审批人策略
- 修改角色作用域
- 修改阶段 Gate 绑定

审计事件建议记录：

- 操作者
- 标准 ID
- 版本号
- 修改摘要
- 发布前后差异

如后续希望更严格，可引入“发布标准也需要审批”的双人治理，但不纳入首期。

## 10. 与现有模型的兼容策略

### 10.1 短期兼容

短期内不移除 `policy_templates`。

可采用：

- `policy_templates` 继续保留旧用途
- 新增 `approval_standards` 负责审核触发标准
- Project Settings 中新增默认标准绑定字段

这样迁移成本最低，也避免旧页面立刻失效。

若后续上线工作流模板与角色 Agent 管理页，应避免把审核标准再次混入 `workflow_templates` 本体；更合理的方式是让审核标准通过 `workflow_template`、`workflow_stage`、`role` 三类作用域引用工作流体系。

#### 10.1.1 与当前权限模型对齐

当前系统的策略与项目访问主要围绕项目边界展开，因此平台级标准不建议在首期就上线。

首期建议仅支持：

- 项目级标准
- 环境级标准

虽然多角色 Agent 方案已定义角色与阶段模型，但首期审核方案仍不直接开放角色级和阶段级标准编辑，只在数据模型中预留扩展位。

`platform` 作用域保留在数据模型设计中，但不在首期 UI 和 API 中开放。

这样可以避免出现“模型支持 platform，权限系统却无法稳定承载”的不一致。

#### 10.1.2 与当前审批单结构对齐

若首期不改 `approval_tickets` 表结构，则必须约定 `requestDetail` 的最小标准字段：

- `trigger`
- `evaluationId`
- `standardId`
- `standardVersion`
- `matchedStandardIds`
- `conditionExplanations`
- `inputSnapshot`
- `workflowStage`
- `roleReviewSummary`

后续再将其中高频查询字段提升为独立列。

### 10.2 中期整合

中期可将 `policy_templates` 收敛为更通用的“治理模板”，其中审核标准是一种专门类型，但前提是当前数据结构先稳定。

### 10.3 旧规则迁移方案

当前系统已有硬编码 risk-engine 规则，不能简单删除。

建议迁移步骤：

1. 先把现有硬编码规则逐条映射成默认审核标准草稿。
2. 由系统初始化写入数据库，标记为 `system_default`。
3. 首期评估器优先读取数据库中的已发布标准。
4. 若数据库中尚无已发布标准，再回退到旧 risk-engine 默认规则。
5. 待默认标准稳定运行后，再移除硬编码分支。

这样能保证上线初期不会因为管理员尚未配置规则而导致审批能力失效。

## 11. 页面落点建议

有两个可选方案。

### 方案 A：在现有 Project Policies 页升级

优点：

- 复用现有路径和项目上下文
- 认知成本低

问题：

- 页面语义仍偏“绑定策略”，不够像“标准设计器”
- 后续加入模拟器、版本、命中统计会导致页面过重

### 方案 B：新增独立治理页

建议路径：

- `/governance/approval-standards`
- `/projects/:projectId/governance/approval-standards`

优点：

- 语义更清晰
- 更适合承载标准编辑器、版本、模拟器、命中统计
- 能与审批页形成“设计规则”与“处理结果”的清晰分工

结论：

推荐采用方案 B，并在项目详情中保留“策略绑定摘要”入口跳转到该页。

## 12. 分阶段实施建议

### Phase 1：标准管理最小可用

- 新增审核标准表
- 新增评估结果表或等价评估结果存储
- 提供列表、创建、编辑、启停 API
- 新增管理页面基础版
- 支持代码变更类标准
- 接管代码变更评估入口
- 命中后真实创建审批单
- 审批单可回溯标准与版本
- 数据模型预留 `role` 与 `workflow_stage` 相关字段，但 UI 不开放编辑

### Phase 2：评估器替换硬编码规则

- 将现有 risk-engine 的剩余硬编码规则全部迁移为默认审核标准
- 支持标准优先级与作用域合并
- 引入版本回滚与变更差异视图
- 接入工作流模板与阶段事实，但先只做只读展示与解释增强

### Phase 3：模拟器与命中分析

- 新增规则模拟接口
- 新增命中统计、审批通过率、拒绝率、过期率、最近命中明细
- 支持从审批单回溯标准效果
- 支持展示角色评审结论与阶段 Gate 对审批的影响

误报率不建议在该阶段默认展示，除非系统已提供人工标注或复盘反馈入口。

### Phase 4：扩展到更多触发源

- 命令执行前
- 预算超限
- 外部 API
- 生产写入
- 恢复前 Hook
- 阶段 Gate 审核
- 同角色多 Agent 聚合评审触发审批

## 13. 验收标准

完成后应满足：

1. 管理员可在页面创建并发布审核标准。
2. 管理员能通过模拟器验证标准命中结果。
3. 任务完成后若命中已发布标准，系统自动创建审批单。
4. 审批单详情可看到命中的标准、版本和条件解释。
5. 项目级、环境级标准能按预期覆盖生效。
6. 停用标准后不再触发新的审批单。
7. 多条标准同时命中时，最终决策结果符合既定合并算法。
8. 在未配置自定义标准时，系统默认标准仍可稳定触发审核。
9. 接入工作流阶段事实后，审批解释中可展示阶段与角色结论，但不会影响首期既有代码变更闭环。

## 14. 推荐的首轮范围

为了避免一次做太大，首轮建议只做以下范围：

- 仅支持项目级和环境级审核标准
- 仅支持代码变更相关条件
- 仅支持“创建审批单”这一命中动作
- 仅支持项目管理员维护
- 审批人先复用现有项目管理员角色
- 仅把多角色 Agent 相关字段作为预留能力，不开放完整角色/阶段治理配置

补充约束：

- 首期不开放平台级标准
- 首期不开放角色级与阶段级标准编辑
- 首期不开放任意自定义审批流
- 首期不开放误报率等需要人工反馈的数据指标
- 首期必须接入真实治理评估入口，而不是只提供配置页面

这样能最快把“管理员设计审核标准从而触发审核”落地，同时不破坏现有审批处理链路。

## 15. 总结

这次重设计的关键不是把审批列表做得更复杂，而是补齐系统真正缺失的治理入口：

让管理员定义标准，而不是让开发人员改代码阈值。

页面层面要把“审核标准设计”与“审批单处理”彻底分开；数据层面要把“标准定义”“标准版本”“审批结果”三类对象拆开；执行层面要把治理评估统一收口到治理引擎。

结合多角色 Agent 方案后，审核体系还需要把“角色结论”和“阶段 Gate”纳入统一事实输入，但不应在首期把工作流治理与审批配置混成一个大而全页面。

这样系统才会从“有审批页面”升级为“有可配置审核治理能力”。