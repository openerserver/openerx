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

- [docs/development-role-agents-plan.md](docs/development-role-agents-plan.md)
- [docs/multi-agent-hook-architecture.md](docs/multi-agent-hook-architecture.md)
- [docs/approval-standards-management-plan.md](docs/approval-standards-management-plan.md)

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

## 11. 首批验收标准

1. 系统中存在独立角色 Agent 注册表，而不是把角色写散在模板配置里。
2. 每个角色具备稳定的系统 ID、权限档位和工具档位。
3. 工作流模板可直接引用角色 ID，并由系统在执行时解析到具体运行时 Agent。
4. 高风险角色至少具备审批请求与阶段阻断能力。
5. 每次角色执行都能产出结构化 artifact envelope。
6. 除开发者 Agent 外，其他角色均不具备项目主代码写权限。
7. 同一角色支持多个 Agent 实例并行或轮询执行，尤其适用于安全、架构、QA、运维等辅助角色。

## 12. 建议的下一步

在本设计确认后，建议继续补两项实现设计：

1. 控制平面侧 `role_agents` 与 `role_agent_bindings` 数据模型设计。
2. BFF 侧角色解析器与工具白名单执行器设计。
