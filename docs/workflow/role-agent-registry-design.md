# 角色 Agent 注册表设计文档

> 适用范围：OpenerX 开发过程多角色 Agent 体系
>
> 目标：定义角色 Agent 的系统 ID、职责边界、权限模型、工具边界、输入输出契约和运行时映射方式，作为后续模板编排与治理控制的基础注册表

## 1. 文档目标

本文档回答以下问题：

- 角色 Agent 在系统里如何被唯一标识
- 每个角色 Agent 拥有什么权限，不拥有什么权限
- 每个角色 Agent 允许调用哪些类型的工具
- 角色 Agent 的产物格式和阶段职责如何固化
- 如何将逻辑角色映射到实际运行时 Agent 实现

相关文档：

- [docs/development-role-agents-plan.md](../organization/development-role-agents-plan.md)
- [docs/multi-agent-hook-architecture.md](../architecture/multi-agent-hook-architecture.md)
- [docs/approval-standards-management-plan.md](approval-standards-management-plan.md)

## 2. 设计目标

角色 Agent 注册表要解决的不是“显示几个名字”，而是以下系统问题：

1. 让工作流模板可以引用稳定的角色 ID，而不是直接写底层运行时 Agent 名称。
2. 让权限控制、审批控制、工具放行和审计记录有稳定绑定点。
3. 让同一个角色在不同运行时实现之间可以平滑替换，或同时挂接多个运行时 Agent，而不影响工作流模板。
4. 让高风险角色天然带有更严格的工具和审批边界。

## 3. 设计原则

### 3.1 角色 ID 稳定，运行时实现可变且可多实例化

工作流模板只引用角色 Agent 的系统 ID，例如 `role.architect`。

底层具体由哪个运行时 Agent 执行，可以由管理员配置。一个角色既可以绑定单个主 Agent，也可以绑定多个同角色 Agent，例如：

- `role.architect` → `oracle-enterprise` + `prometheus-enterprise`
- `role.security` → `oracle-enterprise` + `prometheus-enterprise`
- `role.developer` → `hephaestus-enterprise`
- `role.product` → `prometheus-enterprise`

这样可以避免模板和底层运行时实现强耦合。

补充原则：

- 角色 ID 仍然唯一，例如 `role.security`
- 角色下可存在多个 Agent 实例，例如 `security-a`、`security-b`
- 模板默认引用角色，不直接引用某个具体实例
- 是否启用单实例、并行评审、多实例轮询，由角色注册表或模板策略决定

### 3.2 权限按职责最小化

不是所有角色都应该有代码写权限、配置写权限或命令执行权限。

例如：

- 产品 Agent 不应直接改代码
- 只有开发者 Agent 可以修改项目主代码
- 美术 Agent 不应执行部署命令
- 安全 Agent 默认可以阻断和请求审批，但不应自动发布
- 运维 Agent 可以查看日志与监控，但不应任意修改业务代码

### 3.3 工具能力按档位收敛

工具边界不应逐个命令临时放行，而应以“工具档位”归类，再将档位绑定到角色。

### 3.4 产物必须结构化

角色 Agent 的输出至少要包含：

- `summary`
- `artifacts`
- `decision`
- `risks`
- `nextActions`

这样阶段状态机才能基于角色输出继续流转，而不是仅依赖自然语言。

## 4. 系统 ID 规范

### 4.1 命名规则

建议统一采用如下格式：

```text
role.<domain>
```

首批建议系统 ID：

- `role.product`
- `role.architect`
- `role.developer`
- `role.visual`
- `role.security`
- `role.release`
- `role.operations`
- `role.qa`

说明：

- `role.release` 对应部署 / 发布 Agent
- `role.operations` 对应运维 Agent
- `role.visual` 对应美术 / 视觉 Agent

### 4.2 注册表建议字段

```ts
type RoleAgentScope = "system" | "project";

type RoleAgentStatus = "active" | "disabled" | "deprecated";

type RoleAgentRiskLevel = "low" | "medium" | "high" | "critical";

interface RoleAgentRegistration {
  id: string;
  name: string;
  description: string;
  scope: RoleAgentScope;
  status: RoleAgentStatus;
  ownerTeam: string;
  runtimeBindings: RoleRuntimeBinding[];
  defaultExecutionMode: RoleExecutionMode;
  aggregationPolicy?: RoleAggregationPolicy;
  allowedStages: WorkflowStage[];
  permissionProfile: PermissionProfileId;
  toolProfile: ToolProfileId;
  riskLevel: RoleAgentRiskLevel;
  requiresApprovalForWrite: boolean;
  outputSchemaId: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

type RoleExecutionMode = "single" | "parallel-review" | "round-robin";

interface RoleRuntimeBinding {
  bindingId: string;
  runtimeAgent: string;
  label: string;
  enabled: boolean;
  priority: number;
  tags?: string[];
}

interface RoleAggregationPolicy {
  strategy: "first-pass" | "majority" | "merge-summary" | "human-review";
  maxActiveBindings?: number;
  requireConsensus?: boolean;
}
```

### 4.3 角色与实例的区分

建议明确区分两层对象：

- 角色：稳定职责单元，例如 `role.security`
- 实例：角色下的具体 Agent 绑定，例如 `security-a`、`security-b`

示例：

```yaml
roleId: role.security
runtimeBindings:
  - bindingId: security-a
    runtimeAgent: oracle-enterprise
    label: 安全 A
  - bindingId: security-b
    runtimeAgent: prometheus-enterprise
    label: 安全 B
aggregationPolicy:
  strategy: merge-summary
```

## 5. 权限模型

### 5.1 权限项定义

建议权限项采用显式布尔或枚举组合，而不是让角色自行推断。

```ts
interface RoleAgentPermissions {
  canReadTask: boolean;
  canReadDocs: boolean;
  canReadCode: boolean;
  canWriteDocs: boolean;
  canWriteCode: boolean;
  canRunTests: boolean;
  canReadConfig: boolean;
  canWriteConfig: boolean;
  canReadSecretsMeta: boolean;
  canUseExternalSearch: boolean;
  canViewLogs: boolean;
  canRunDiagnostics: boolean;
  canPrepareDeployment: boolean;
  canExecuteDeployment: boolean;
  canRequestApproval: boolean;
  canBlockStage: boolean;
  canApproveRelease: boolean;
  canTriggerRollback: boolean;
}
```

### 5.2 建议权限档位

建议先定义 6 种权限档位，角色只引用档位 ID。

#### `perm.readonly-analysis`

适用：产品、美术、部分架构分析

能力：

- 可读任务、文档、代码
- 可写文档
- 不可写代码
- 不可执行部署
- 不可直接阻断发布

#### `perm.design-governance`

适用：架构师

能力：

- 可读任务、文档、代码、配置
- 可写文档
- 可提出阻断建议
- 可请求审批
- 默认不可直接写代码和执行部署

#### `perm.code-implementation`

适用：开发者

能力：

- 可读写代码与文档
- 可运行测试
- 可读配置
- 默认不可执行部署
- 默认不可绕过安全审批

#### `perm.security-review`

适用：安全

能力：

- 可读任务、文档、代码、配置、密钥元信息
- 可运行诊断与安全检查
- 可请求审批
- 可阻断阶段推进
- 不可直接发布
- 允许多个安全 Agent 并行评审，但结论仍归并到同一安全角色

#### `perm.release-management`

适用：部署

能力：

- 可读配置与部署脚本
- 可准备部署计划
- 在特定环境下可执行部署
- 可请求发布审批
- 不可任意写业务代码

#### `perm.operations-control`

适用：运维、部分 QA 联调

能力：

- 可查看日志、指标、诊断信息
- 可触发回滚或止血建议
- 可阻断上线继续推进
- 默认不可修改核心业务代码

## 6. 工具边界模型

### 6.1 工具档位定义

建议定义以下工具档位：

```ts
type ToolProfileId =
  | "tools.discovery"
  | "tools.design"
  | "tools.code-read"
  | "tools.code-write"
  | "tools.test-verify"
  | "tools.release-plan"
  | "tools.ops-observe"
  | "tools.security-audit";
```

### 6.2 工具档位说明

#### `tools.discovery`

允许范围：

- 搜索代码、搜索文档、读取文件、列目录
- 允许只读浏览器查看
- 不允许写文件、不允许运行部署命令

#### `tools.design`

允许范围：

- 在 `docs/` 下产出方案文档
- 读取架构、配置与接口文档
- 允许 Mermaid 图、结构化设计产物
- 默认不允许改业务代码

#### `tools.code-read`

允许范围：

- 只读读取代码
- 查询符号引用
- 查看错误信息
- 不允许编辑文件

#### `tools.code-write`

允许范围：

- 可修改项目主代码、测试代码与文档
- 可运行本地测试与静态检查
- 默认不允许直接做发布和运维操作
- 该档位默认只授予开发者 Agent

#### `tools.test-verify`

允许范围：

- 运行测试、查看测试输出、读取浏览器页面状态
- 可补充测试文档
- 默认不允许写核心业务代码

#### `tools.release-plan`

允许范围：

- 读取部署文件、环境文件、IaC、CI/CD 文档
- 生成发布计划
- 在管理员明确放行时执行发布任务

#### `tools.ops-observe`

允许范围：

- 读取日志、任务输出、运行态信息
- 执行健康检查与诊断脚本
- 默认不允许改动业务代码和结构性配置

#### `tools.security-audit`

允许范围：

- 扫描配置、依赖、权限路径、敏感文件引用
- 读取审计与审批上下文
- 可调用安全审计类检查
- 默认不允许自动放行高风险变更

### 6.3 工具边界与角色绑定建议

| 角色 ID | 工具档位 | 说明 |
| ---- | ---- | ---- |
| `role.product` | `tools.discovery` + `tools.design` | 允许读代码和写方案，不允许改业务代码 |
| `role.architect` | `tools.discovery` + `tools.design` + `tools.code-read` | 可读代码和配置，可配置多个架构 Agent 并行评审，默认不直接改实现 |
| `role.developer` | `tools.code-read` + `tools.code-write` + `tools.test-verify` | 唯一允许修改项目主代码的角色，负责实现与修复 |
| `role.visual` | `tools.discovery` + `tools.design` | 允许产出视觉说明和页面建议 |
| `role.security` | `tools.code-read` + `tools.security-audit` + `tools.test-verify` | 允许多个安全 Agent 并行审计和复核，只能通知开发者修改 |
| `role.release` | `tools.discovery` + `tools.release-plan` + `tools.test-verify` | 负责发布准备与执行前核查 |
| `role.operations` | `tools.discovery` + `tools.ops-observe` + `tools.test-verify` | 负责运行观察和故障诊断，可配置多 Agent 交叉诊断 |
| `role.qa` | `tools.code-read` + `tools.test-verify` | 负责验证与报错，可配置多 Agent 交叉验收，不默认改业务代码 |

## 7. 首批角色注册表定义

### 7.1 产品 Agent

```yaml
id: role.product
name: 产品 Agent
runtimeBindings:
  - bindingId: product-a
    runtimeAgent: prometheus-enterprise
    label: 产品 A
    enabled: true
    priority: 1
defaultExecutionMode: single
permissionProfile: perm.readonly-analysis
toolProfile: tools.discovery+design
allowedStages:
  - intake
  - clarify
  - plan
  - review
outputSchemaId: artifact.product-brief.v1
```

边界：

- 不改代码
- 不执行部署
- 可以要求补充上下文
- 可以拒绝模糊需求进入设计阶段

### 7.2 架构师 Agent

```yaml
id: role.architect
name: 架构师 Agent
runtimeBindings:
  - bindingId: architect-a
    runtimeAgent: oracle-enterprise
    label: 架构 A
    enabled: true
    priority: 1
  - bindingId: architect-b
    runtimeAgent: prometheus-enterprise
    label: 架构 B
    enabled: true
    priority: 2
defaultExecutionMode: parallel-review
aggregationPolicy:
  strategy: merge-summary
permissionProfile: perm.design-governance
toolProfile: tools.discovery+design+code-read
allowedStages:
  - clarify
  - design
  - plan
  - review
outputSchemaId: artifact.architecture-decision.v1
```

边界：

- 可以阻断直接进入实现
- 可以要求增加兼容性、数据模型或接口说明
- 默认不直接写业务代码

### 7.3 开发者 Agent

```yaml
id: role.developer
name: 开发者 Agent
runtimeBindings:
  - bindingId: developer-main
    runtimeAgent: hephaestus-enterprise
    label: 开发者主执行
    enabled: true
    priority: 1
defaultExecutionMode: single
permissionProfile: perm.code-implementation
toolProfile: tools.code-read+write+test
allowedStages:
  - implement
  - verify
  - fix
outputSchemaId: artifact.developer-change.v1
```

边界：

- 是唯一允许修改项目主代码的角色
- 可以改控制平面、BFF、Web UI、脚本和测试
- 不可绕过安全 Gate 自动合入高风险改动

### 7.4 美术 Agent

```yaml
id: role.visual
name: 美术 Agent
runtimeBindings:
  - bindingId: visual-a
    runtimeAgent: multimodal-enterprise
    label: 美术 A
    enabled: true
    priority: 1
defaultExecutionMode: single
permissionProfile: perm.readonly-analysis
toolProfile: tools.discovery+design
allowedStages:
  - design
  - review
outputSchemaId: artifact.visual-spec.v1
```

边界：

- 只产出视觉规范和表达建议
- 不直接修改核心页面实现

### 7.5 安全 Agent

```yaml
id: role.security
name: 安全 Agent
runtimeBindings:
  - bindingId: security-a
    runtimeAgent: oracle-enterprise
    label: 安全 A
    enabled: true
    priority: 1
  - bindingId: security-b
    runtimeAgent: prometheus-enterprise
    label: 安全 B
    enabled: true
    priority: 2
defaultExecutionMode: parallel-review
aggregationPolicy:
  strategy: merge-summary
  maxActiveBindings: 2
permissionProfile: perm.security-review
toolProfile: tools.code-read+security-audit+test
allowedStages:
  - clarify
  - design
  - implement
  - verify
  - release
outputSchemaId: artifact.security-review.v1
```

边界：

- 可以请求审批
- 可以阻断高风险阶段推进
- 不可自动批准自己的审查结果
- 发现问题后只能通知开发者 Agent 修正

### 7.6 部署 Agent

```yaml
id: role.release
name: 部署 Agent
runtimeBindings:
  - bindingId: release-a
    runtimeAgent: oracle-enterprise
    label: 部署 A
    enabled: true
    priority: 1
defaultExecutionMode: single
permissionProfile: perm.release-management
toolProfile: tools.discovery+release-plan+test
allowedStages:
  - release
  - post-release
outputSchemaId: artifact.release-plan.v1
```

边界：

- 可以生成发布计划和回滚计划
- 执行真实部署前需要环境与权限校验

### 7.7 运维 Agent

```yaml
id: role.operations
name: 运维 Agent
runtimeBindings:
  - bindingId: operations-a
    runtimeAgent: oracle-enterprise
    label: 运维 A
    enabled: true
    priority: 1
  - bindingId: operations-b
    runtimeAgent: prometheus-enterprise
    label: 运维 B
    enabled: true
    priority: 2
defaultExecutionMode: parallel-review
aggregationPolicy:
  strategy: merge-summary
permissionProfile: perm.operations-control
toolProfile: tools.discovery+ops-observe+test
allowedStages:
  - verify
  - release
  - post-release
  - retrospective
outputSchemaId: artifact.ops-runbook.v1
```

边界：

- 可以触发观测和诊断
- 可以建议回滚
- 不直接改核心业务实现
- 发现问题后由开发者 Agent 负责修复主代码

### 7.8 QA Agent

```yaml
id: role.qa
name: QA Agent
runtimeBindings:
  - bindingId: qa-a
    runtimeAgent: momus-enterprise
    label: QA A
    enabled: true
    priority: 1
  - bindingId: qa-b
    runtimeAgent: prometheus-enterprise
    label: QA B
    enabled: true
    priority: 2
defaultExecutionMode: parallel-review
aggregationPolicy:
  strategy: merge-summary
permissionProfile: perm.readonly-analysis
toolProfile: tools.code-read+test-verify
allowedStages:
  - verify
  - release
  - retrospective
outputSchemaId: artifact.qa-report.v1
```

边界：

- 可以生成回归结论和阻塞项
- 默认不修改业务代码
- 缺陷修复必须回交开发者 Agent

## 8. 角色产物契约

建议所有角色 Agent 的输出最终归一为统一外层结构。

```ts
interface RoleAgentArtifactEnvelope {
  roleAgentId: string;
  stage: WorkflowStage;
  summary: string;
  artifacts: Array<{
    type: string;
    title: string;
    content: string;
    mimeType?: string;
  }>;
  risks: Array<{
    level: "low" | "medium" | "high" | "critical";
    title: string;
    detail: string;
  }>;
  decision?: {
    action:
      | "allow"
      | "block"
      | "needs-approval"
      | "notify-developer"
      | "revise"
      | "handoff"
      | "observe";
    reason: string;
  };
  nextActions: string[];
  generatedAt: string;
}
```

## 9. 注册表与运行时映射方式

### 9.1 不直接把角色写死到运行时

建议工作流模板引用 `roleAgentId`，在执行时再解析到实际运行时 Agent。

```ts
interface ResolvedRoleAgent {
  roleAgentId: string;
  bindings: Array<{
    bindingId: string;
    runtimeAgent: string;
    model?: string;
  }>;
  executionMode: RoleExecutionMode;
  aggregationPolicy?: RoleAggregationPolicy;
  permissionProfile: PermissionProfileId;
  toolProfile: ToolProfileId;
}
```

### 9.2 好处

- 运行时 Agent 升级时，不需要改模板
- 同一个角色可以按项目配置不同实现
- 同一个角色可以同时启用多个 Agent，从多个视角做评审与辅助分析
- 系统可基于角色做审计、审批和统计

## 10. 治理与审计要求

每次角色 Agent 执行，至少应记录：

- `taskId`
- `stage`
- `roleAgentId`
- `runtimeAgent`
- `permissionProfile`
- `toolProfile`
- `decision.action`
- `approvalRequested`
- `blocked`
- `artifacts[]`

安全 Agent、部署 Agent、运维 Agent 的执行记录应默认进入审计事件流。

## 11. 注册表读取模型与项目覆盖规则

仅定义写模型还不够，后续 BFF 和工作流阶段推进器真正依赖的是“解析后的可执行角色视图”。

因此建议把角色注册表分为两层：

- 控制平面写模型：管理员维护的 `role_agents` 与 `role_agent_bindings`
- BFF / 执行侧读模型：按任务、项目、阶段解析后的 `ResolvedRoleAgent`

### 11.1 读取模型建议

建议控制平面在管理接口之外，再提供一个面向执行器的解析结果模型：

```ts
interface ResolvedRoleAgentView {
  id: string;
  name: string;
  scope: "system" | "project";
  status: "active" | "disabled" | "deprecated";
  riskLevel: "low" | "medium" | "high" | "critical";
  allowedStages: WorkflowStage[];
  permissionProfile: PermissionProfileId;
  toolProfile: ToolProfileId;
  defaultExecutionMode: RoleExecutionMode;
  aggregationPolicy?: RoleAggregationPolicy;
  requiresApprovalForWrite: boolean;
  outputSchemaId: string;
  bindings: Array<{
    bindingId: string;
    runtimeAgent: string;
    label: string;
    enabled: boolean;
    priority: number;
    model?: string;
    tags?: string[];
  }>;
}
```

说明：

- 管理页仍可读取原始注册表对象
- 执行器、阶段推进器、审批引擎优先读取解析后的只读视图
- 这样可以避免 BFF 自己在多个模块里重复拼接 `bindings + aggregationPolicy + profiles`

### 11.2 项目覆盖优先级

角色注册表需要明确系统级和项目级配置如何共存。

建议优先级如下：

1. 项目级角色定义优先于系统级同 ID 定义
2. 如果项目级只覆盖部分字段，则未覆盖字段回退到系统级默认定义
3. 如果项目级角色被显式 `disabled`，则视为该项目禁用该角色
4. 如果项目级未定义该角色，则直接使用系统级角色

建议覆盖策略采用“字段级继承”，而不是要求项目侧复制整份角色定义。

```ts
interface EffectiveRoleResolution {
  baseRole: RoleAgentRegistration;
  projectOverride?: Partial<RoleAgentRegistration>;
  effectiveRole: RoleAgentRegistration;
}
```

### 11.3 binding 解析规则

对于 bindings，建议采用以下解析规则：

1. 先取项目级启用 bindings
2. 若项目级未配置 bindings，则回退到系统级 bindings
3. 若项目级显式配置为空数组，表示该项目暂不允许该角色落到任何运行时 Agent
4. disabled bindings 不进入执行器候选集合
5. 解析后候选 bindings 按 `priority ASC` 排序

这样可以保证：

- 模板始终只引用稳定的 `role.<domain>`
- 不同项目可以替换底层运行时实现或模型选择
- 管理员可以通过项目覆盖控制高风险项目的角色执行策略

## 12. 默认种子与 Profile 注册策略

如果角色注册表没有默认种子，工作流模板会引用到一组并不存在的角色 ID，导致系统在首轮初始化后不可执行。

因此建议把“首批角色定义”视为平台种子主数据，而不是仅保留在文档示例里。

### 12.1 建议默认种子内容

系统初始化时建议自动写入以下角色：

- `role.product`
- `role.architect`
- `role.developer`
- `role.visual`
- `role.security`
- `role.release`
- `role.operations`
- `role.qa`

并同步写入首批默认 bindings，用于建立最小可执行闭环。

### 12.2 种子幂等要求

默认种子必须满足以下要求：

1. 基于 `id` 幂等 upsert，而不是每次重复插入
2. 已存在记录时，仅补齐缺失字段或在管理员未修改时执行安全更新
3. 不得覆盖项目级角色自定义配置
4. 允许后续版本追加新角色或新 binding，但不能破坏旧模板引用

### 12.3 permission / tool / output schema 的注册方式

虽然第一阶段可以先把 `permissionProfile`、`toolProfile`、`outputSchemaId` 存成字符串，但文档层应先定义这些字符串不是自由输入，而是受控注册表 ID。

建议后续统一维护以下静态注册：

```ts
type PermissionProfileId =
  | "perm.readonly-analysis"
  | "perm.design-governance"
  | "perm.code-implementation"
  | "perm.security-review"
  | "perm.release-management"
  | "perm.operations-control";

type OutputSchemaId =
  | "artifact.product-brief.v1"
  | "artifact.architecture-decision.v1"
  | "artifact.developer-change.v1"
  | "artifact.visual-spec.v1"
  | "artifact.security-review.v1"
  | "artifact.release-plan.v1"
  | "artifact.ops-runbook.v1"
  | "artifact.qa-report.v1";
```

建议原则：

- 控制平面写入时校验 ID 是否在受支持集合内
- BFF 不自行发明新的 profile ID
- 管理页只从受支持列表中选择，避免拼写漂移

## 13. 运行时解析与执行前校验

角色注册表真正生效的关键，不是 CRUD 成功，而是任务执行前能否稳定解析出“本阶段可运行、且安全可放行”的角色执行计划。

### 13.1 建议解析流程

建议 BFF 或工作流阶段推进器在执行角色前固定执行以下步骤：

1. 根据 `roleAgentId` 读取系统级角色定义
2. 若存在 `projectId`，尝试加载项目级覆盖
3. 合并得到 `effectiveRole`
4. 校验当前 `stage` 是否包含在 `allowedStages`
5. 解析并过滤可用 bindings
6. 根据模板 `roleExecutionPolicies` 覆盖默认执行模式
7. 根据 `riskLevel`、审批状态、写权限边界做执行前放行判断
8. 生成 `ResolvedRoleAgent` 交给执行器

### 13.2 执行前硬性校验

建议至少包含以下校验：

- `status` 必须为 `active`
- `allowedStages` 必须包含当前阶段
- 至少有一个 enabled binding，除非该角色本阶段只作为静态占位角色
- 非 `role.developer` 角色不得获得项目主代码写权限
- 高风险角色若配置 `requiresApprovalForWrite=true`，则没有审批票据时不得进入写操作
- `toolProfile` 必须和 `permissionProfile` 相容，不能出现“只读权限 + 代码写工具”的非法组合

### 13.3 round-robin 与 parallel-review 的最小规则

为避免不同实现对执行模式各自理解，建议先固定三种模式的最小语义：

- `single`：只运行优先级最高的一个 enabled binding
- `parallel-review`：并行运行多个 enabled binding，受 `maxActiveBindings` 限制
- `round-robin`：按优先级顺序轮换一个 binding 执行；适合成本控制或运行时负载均衡

若模板配置与角色默认配置冲突，则以模板阶段策略为准。

## 14. 控制平面接口读模型建议

为了避免管理接口和执行接口混用，建议在现有 CRUD 基础上再约定两类读取能力。

### 14.1 管理视图接口

用途：后台维护角色主数据。

建议返回：

- 角色基础信息
- bindings 列表
- profile ID
- 状态和范围

示例：

- `GET /api/role-agents`
- `GET /api/role-agents/:roleAgentId`
- `GET /api/role-agents/:roleAgentId/bindings`

### 14.2 执行解析接口

用途：供 BFF、阶段推进器、审批引擎直接消费。

建议新增只读解析接口：

- `GET /api/role-agents/:roleAgentId/resolve?projectId=...&stage=...`

返回建议：

```ts
{
  data: {
    role: ResolvedRoleAgentView;
    source: {
      baseScope: "system" | "project";
      overrideApplied: boolean;
      policySource: "role-default" | "template-stage";
    };
    validation: {
      executable: boolean;
      reasons: string[];
    };
  };
}
```

好处：

- BFF 不需要重复实现项目覆盖和字段继承逻辑
- 前端管理页也可以复用解析结果做“执行预检”展示
- 审批系统可以直接看到当前角色是否具备放行条件

## 15. 分阶段落地建议

建议按四个阶段推进，而不是一次把所有治理能力都压到第一版里。

### 15.1 Phase 1：角色注册表最小闭环

目标：

- 落库 `role_agents` 与 `role_agent_bindings`
- 提供 CRUD
- 写入首批默认种子
- 工作流模板开始只引用角色 ID

### 15.2 Phase 2：执行解析与模板联动

目标：

- 提供 `resolve` 读模型
- 支持项目覆盖
- 阶段推进器根据 `allowedStages` 和 `roleExecutionPolicies` 解析执行计划

### 15.3 Phase 3：工具白名单与审批联动

目标：

- `permissionProfile` 与 `toolProfile` 正式接入工具放行器
- 高风险角色执行前接审批票据检查
- 关键角色自动进入审计事件流

### 15.4 Phase 4：统计、审计与运维治理

目标：

- 基于 `roleAgentId` 统计阶段阻断率、审批率、命中率
- 支持查看角色级执行历史、binding 命中分布和冲突分布
- 为后续角色优化和模型替换提供可观测基础

## 16. 首批验收标准

1. 系统中存在独立角色 Agent 注册表，而不是把角色写散在模板配置里。
2. 每个角色具备稳定的系统 ID、权限档位和工具档位。
3. 工作流模板可直接引用角色 ID，并由系统在执行时解析到具体运行时 Agent。
4. 高风险角色至少具备审批请求与阶段阻断能力。
5. 每次角色执行都能产出结构化 artifact envelope。
6. 除开发者 Agent 外，其他角色均不具备项目主代码写权限。
7. 同一角色支持多个 Agent 实例并行或轮询执行，尤其适用于安全、架构、QA、运维等辅助角色。

## 17. 建议的下一步

在本设计确认后，建议继续补两项实现设计：

1. 控制平面侧 `role_agents` 与 `role_agent_bindings` 数据模型设计。
2. BFF 侧角色解析器与工具白名单执行器设计。
