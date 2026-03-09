# oh-my-openagent 对 OpenerX 的功能对比与可执行方案

## 0. 审核修订说明（2026-03-09）

> **重大修正**：原始文档仅审核了控制面层（BFF + Service + Web UI），遗漏了 `opencode-fork/` 下已实现的运行时层能力。
> 经复审，以下能力已在 OpenCode 插件/Agent/Command 层落地，不应再标记为"缺失"：
>
> | 原文标记"缺失"的能力 | 实际状态 | 实现位置 |
> |---|---|---|
> | 多 Agent 编排 | ✅ 已实现 | 9 个企业级 Agent + sisyphus 调度器 |
> | 任务分类路由 | ✅ 已实现 | orchestrator-plugin（5 类：quick/deep/ops/security/architecture）|
> | 规划模式（先规划后执行）| ✅ 已实现 | prometheus→metis→momus 三阶段流水线 |
> | 任务 DAG 编排 | ✅ 已实现 | task-graph-plugin（节点、依赖边、状态机、重试、JSON 持久化）|
> | 会话搜索与历史 | ✅ 已实现 | session-tools（list/read/search/summary/continue）|
> | Hashline 安全编辑 | ✅ 已实现 | hashline-edit-plugin |
> | 技能系统（含权限）| ✅ 已实现 | skills-plugin + 2 个内置 Skill |
> | 上下文注入 | ✅ 已实现 | context-injection-plugin（AGENTS.md 层级发现）|
> | 模型 fallback | ✅ 已实现 | orchestrator-plugin（Claude Sonnet → GPT-4.1）|
> | Handoff 与续跑 | ✅ 已实现 | handoff 命令 + session_continue 工具 |
>
> **真正的差距**不是"缺功能"，而是：
> 1. 运行时层能力未被控制面持久化（DAG 只存 JSON 文件，不在数据库）
> 2. 运行时层能力未被 BFF/UI 可视化和治理（graph 接口仍为占位）
> 3. 插件生命周期只有只读清单，缺少启停、安装/卸载、兼容性验证
> 4. MCP 服务目录均为空壳
> 5. 通知模块为空目录
>
> 以下正文中，已标注 `[修订]` 的段落为本次审核修正内容。

## 1. 文档目的

本文档用于基于当前代码实现，对比 oh-my-openagent 与 OpenerX 的实际功能差异，并形成一份可执行的借鉴方案。

目标不是复制 oh-my-openagent 的完整产品形态，而是识别哪些能力适合被 OpenerX 吸收，并以符合当前架构边界的方式落地。

相关边界文档：

- [OpenCode 关注边界说明](./opencode-focus-boundary.md)
- [OpenerX 当前系统架构说明](./architecture-overview.md)
- [OpenerX 目标架构演进图](./architecture-target-evolution.md)

## 2. 对比前提

本次对比遵循两个前提：

1. 以当前仓库代码中已落地能力为准，而不是只看规划文档。
2. 以 oh-my-openagent 的公开功能说明为准，重点关注其 Agent 编排、技能系统、任务系统和运行辅助能力。

## 3. 当前 OpenerX 已落地的实际能力

### 3.1 控制面与治理能力

当前 OpenerX 已经具备较完整的治理侧控制面能力：

- 登录认证与 JWT 鉴权
- 组织、项目、环境、成员管理
- 策略模板与审批策略绑定
- 审批单、审计事件、成本记录、预算配置
- 任务创建、执行、状态更新与结果回写

这些能力在当前代码中已有明确落点：

- 控制面数据模型见 [control-plane/service/src/db/schema.ts](../control-plane/service/src/db/schema.ts)
- BFF 聚合入口见 [control-plane/web-ui-bff/src/index.ts](../control-plane/web-ui-bff/src/index.ts)
- 项目、环境、策略、预算与成员页面见 [control-plane/web-ui/src/router/index.ts](../control-plane/web-ui/src/router/index.ts)

### 3.2 运行时接入与实时控制能力

当前 OpenerX 已具备基础的 Runtime 控制链路：

- 通过 BFF 代理任务执行
- 创建 OpenCode session 并回写 task 状态
- 提供 pause、resume、guidance、terminate、messages、status 等 Agent 控制接口
- 通过 WebSocket 和 SSE 聚合向前端广播实时事件

对应实现位置：

- 任务执行入口见 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../control-plane/web-ui-bff/src/modules/tasks/routes.ts)
- Agent 控制接口见 [control-plane/web-ui-bff/src/modules/agent-control/routes.ts](../control-plane/web-ui-bff/src/modules/agent-control/routes.ts)
- 实时路由见 [control-plane/web-ui-bff/src/modules/realtime/routes.ts](../control-plane/web-ui-bff/src/modules/realtime/routes.ts)
- 前端任务详情与 Agent 控制见 [control-plane/web-ui/src/pages/TaskDetail.vue](../control-plane/web-ui/src/pages/TaskDetail.vue) 和 [control-plane/web-ui/src/components/AgentConsole.vue](../control-plane/web-ui/src/components/AgentConsole.vue)

### 3.3 OpenCode 配置控制面能力

相比仅做 Runtime 控制的系统，OpenerX 还额外具备一层对 OpenCode 配置资产的控制面：

- Agent 配置查看与编辑
- Skill 配置查看与编辑
- Command 配置查看与编辑
- MCP 服务配置查看与编辑
- 模型配置管理
- Security baseline 编辑
- 插件清单查看
- GitHub Copilot device flow 认证与模型读取

对应实现位置：

- 前端设置页见 [control-plane/web-ui/src/pages/Settings.vue](../control-plane/web-ui/src/pages/Settings.vue)
- BFF 配置接口见 [control-plane/web-ui-bff/src/modules/config/routes.ts](../control-plane/web-ui-bff/src/modules/config/routes.ts)
- 前端配置 API 见 [control-plane/web-ui/src/lib/api.ts](../control-plane/web-ui/src/lib/api.ts)

这说明 OpenerX 当前并不是完全没有插件/技能方向能力，而是已经具备“配置控制面”，尚未形成“生命周期控制面”。
### 3.4 OpenCode 运行时层已落地的编排能力 [修订新增]

原始审核遗漏了 `opencode-fork/` 目录下已实现的大量运行时能力。以下能力已经在 OpenCode 插件和 Agent 层落地：

#### 插件层（`.opencode/plugins/`）：

- **orchestrator-plugin.ts** — 完整的意图分类 + Agent 路由 + 模型选择 + Ralph Loop 迭代控制。63 条正则模式将用户意图分为 quick/deep/ops/security/architecture 五类，根据类别 + 复杂度自动选择 Agent 和模型。
- **task-graph-plugin.ts** — 完整的 DAG 任务图管理。包括 TaskNode（状态机：pending→in_progress→completed/failed，支持 retry）、TaskEdge（blocks/informs）、依赖传播、图完成检测、JSON 文件持久化（`.opencode/state/task-graphs/`）。
- **hashline-edit-plugin.ts** — 基于 SHA256 哈希的安全文件编辑，文件锁、批量验证、防止过时写入。
- **context-injection-plugin.ts** — 递归发现项目目录中的 AGENTS.md 文件，解析 YAML frontmatter，按 applyTo glob + agent 名选择性注入上下文。
- **skills-plugin.ts** — Skill 发现、加载、激活/停用、权限管理（allowedTools/deniedTools/filePatterns/maxConcurrency）、内嵌 MCP 服务配置。
- **tmux-plugin.ts** — 持久化终端会话管理（创建、发送命令、读取输出、列举），含危险命令拦截。
- **session-tools.ts** — 会话历史管理：list、read、search、summary、continue，支持跨会话续跑。

#### Agent 层（`.opencode/agents/`）— 9 个企业级 Agent：

| Agent | 模型 | 角色 |
|-------|------|------|
| sisyphus-enterprise | Claude Sonnet | 主编排器：任务拆分、Agent 分派、进度监控、Handoff |
| prometheus-enterprise | Claude Sonnet | 规划专家：访谈→上下文收集→结构化计划 |
| metis-enterprise | Claude Sonnet | 计划审计：隐含假设检测、歧义识别（最多 2 轮修订）|
| momus-enterprise | Claude Sonnet | 计划验证：清晰度/完整性/可验证性/可行性评分（1-5，≥3 通过）|
| hephaestus-enterprise | Claude Sonnet | 深度执行器：代码实现、安全编辑（LSP+Hashline）、测试 |
| oracle-enterprise | Claude Sonnet | 架构分析师：架构评审、故障诊断、风险评估 |
| librarian-enterprise | GPT-4.1-mini | 知识检索：代码搜索、文档搜索（MCP）、上下文摘要 |
| explore-enterprise | GPT-4.1-mini | 快速侦查：简单查询、快速查找、升级检测 |
| multimodal-enterprise | Claude Sonnet | 多模态分析：图片 OCR、图表解析、设计稿到代码 |

#### Command 层（`.opencode/commands/`）— 5 个编排工作流：

- **start-work** — 7 阶段全流程编排：意图分类→规划→审计→验证→TaskGraph 创建→分派执行→完成。
- **handoff** — 生成结构化任务交接文档。
- **refactor** — LSP 安全的多文件重构，含回滚策略。
- **init-deep** — 深度代码分析与架构评审。
- **ultrawork** — Ralph Loop 极限工作模式（最多 20 轮，含停滞检测）。

#### Skill 层（`.opencode/skills/`）：

- **git-master** — 结构化 Git 规范（Conventional Commits、分支策略、rebase 手术）。
- **playwright** — 浏览器自动化最佳实践（POM 模式、Locator 选择、视觉回归）。

**结论**：OpenerX 在运行时层已经具备 oh-my-openagent 的大部分核心编排能力。真正的差距在于这些能力未被控制面层感知、持久化和治理。
## 4. 与 oh-my-openagent 的核心差异

### 4.1 OpenerX 更强的部分

相较于 oh-my-openagent，OpenerX 当前更强的是平台治理与企业控制面：

- 更完整的组织、项目、环境、角色、审批、审计、预算模型
- 更明确的 BFF 与控制平面分层
- 更贴近企业运行约束的控制平面定位
- 已有项目级治理页面与管理入口

一句话说，OpenerX 更像“企业 AI 控制平面”，oh-my-openagent 更像“高阶 Agent Harness”。

### 4.2 oh-my-openagent 更强的部分 [修订]

~~原文列出 8 项 oh-my-openagent 更强的能力——经复审，其中大部分已在 opencode-fork 运行时层实现。~~

经修正后，oh-my-openagent 相对于 OpenerX 仍然更强的点收窄为：

- **后台子任务真正并行执行与结果回收**：OpenerX 的 task-graph-plugin 有 DAG 模型但缺少真正的并行调度器（当前是串行 dispatch）。
- **运行时能力的平台可观测性**：oh-my-openagent 在 harness 层内建了运行状态面板；OpenerX 的运行时能力还未被控制面 UI 可视化。
- **社区生态与开箱即用体验**：oh-my-openagent 有 38k stars 和活跃社区，插件/Agent 模板更丰富。

以下能力此前被标记为 oh-my-openagent 更强，但经审核在 OpenerX 已有实现：

| 能力 | OpenerX 实现位置 |
|------|------------------|
| 多 Agent 分工与委派 | 9 个 Agent + sisyphus 调度器 |
| 任务类型到 Agent/模型路由 | orchestrator-plugin（5 类 63 模式）|
| 先规划后执行 | prometheus→metis→momus 流水线 |
| 带依赖关系的任务系统 | task-graph-plugin（JSON 持久化）|
| 会话搜索、续跑、handoff | session-tools + handoff 命令 |
| 上下文注入 | context-injection-plugin |
| 插件+技能+MCP 组合使用 | skills-plugin + opencode.json MCP 配置 |

OpenerX 当前的核心架构差异是：编排能力存在于运行时层但未被控制面感知和治理。

## 5. 逐项对比 [修订]

| 能力域 | OpenerX 当前状态 | oh-my-openagent 状态 | 判断 |
|------|------|------|------|
| 组织/项目/环境治理 | 已落地 | 不是重点 | OpenerX 明显更强 |
| 审批/审计/预算 | 已落地 | 不是重点 | OpenerX 明显更强 |
| Runtime 接入 | 已落地 | 已落地 | 两者都有，但定位不同 |
| Agent 控制台 | 已落地基础版 | 更偏 harness 控制 | OpenerX 可继续增强 |
| 实时事件展示 | 已落地 | 有运行反馈机制 | OpenerX 已具备基础 |
| 任务图展示 | 前端已落地，**运行时有 DAG 插件但 BFF 接口仍为占位** | 有真实任务依赖模型 | 差距在控制面集成 |
| 多 Agent 编排 | **运行时已实现（9 Agent + sisyphus）** | 核心能力 | 能力对齐，差距在可观测性 |
| 规划模式 | **运行时已实现（prometheus→metis→momus）** | 核心能力 | 能力对齐，差距在 UI 可视化 |
| 任务依赖与并行执行 | **DAG 模型已有（task-graph-plugin），缺并行调度** | 核心能力 | 差距在并行调度 + DB 持久化 |
| 会话搜索与历史分析 | **运行时已实现（session-tools）** | 已成体系 | 能力对齐，差距在 UI 呈现 |
| 失败恢复与 fallback | **部分实现（Ralph Loop + retry）** | 已成体系 | OpenerX 有基础，可深化 |
| Skill/MCP 配置管理 | **配置面 + 运行时 skills-plugin** | 已成体系 | OpenerX 有基础，可深化 |
| 插件生命周期管理 | 仅只读插件清单 + 运行时 skills-plugin 激活/停用 | 体系更完整 | 差距在控制面治理 |
| 意图分类与路由 | **运行时已实现（orchestrator-plugin，5 类 63 模式）** | 已落地 | 能力对齐 |
| Hashline 安全编辑 | **运行时已实现（hashline-edit-plugin）** | 很强 | 能力对齐 |
| 上下文注入 | **运行时已实现（context-injection-plugin）** | 已落地 | 能力对齐 |
| Claude Code 兼容层 | 不是重点 | 很强 | 可选择性借思想，不必完整复刻 |
| Tmux/交互式终端 | **运行时已实现（tmux-plugin）** | 很强 | 能力对齐 |
| 桌面壳与本地体验 | 非目标 | 存在生态依赖 | 不纳入借鉴重点 |

## 6. 基于当前代码得到的关键判断 [修订]

### 6.1 当前项目已具备完整的"运行时编排层"，但控制面尚未感知

经复审，OpenerX 在 `opencode-fork/.opencode/` 下已具备：

- 完整意图分类与 Agent 路由（orchestrator-plugin，5 类 63 模式）
- 先规划后执行的多 Agent 流水线（prometheus→metis→momus→sisyphus）
- DAG 任务图管理与 JSON 持久化（task-graph-plugin）
- 会话搜索与续跑（session-tools）
- 安全文件编辑（hashline-edit-plugin）
- 技能管理与权限控制（skills-plugin）
- 上下文注入（context-injection-plugin）

但控制面层（BFF + Service + Web UI）几乎不知道这些能力的存在：

- graph 接口仍只返回占位信息
- 数据库没有 task_nodes/task_edges 表
- UI 无法展示意图分类结果、Agent 路由决策、规划流水线状态
- DAG 状态仅存于 `.opencode/state/task-graphs/` 的 JSON 文件

### 6.2 真正的差距是"运行时 ↔ 控制面"的集成断层

~~原文判断"缺编排"~~ 经修正，更准确的判断是：

- 编排能力**存在**但**不可见**——管理员在 Web UI 上看不到 Agent 路由决策、规划过程、任务图结构。
- 编排状态**存在**但**不可治理**——DAG 存在 JSON 文件而非数据库，无法跨会话查询、审批检查、预算约束。
- 编排配置**存在**但**不可管控**——orchestrator 的意图分类模式、Agent 映射策略只能通过编辑 .ts 文件修改，没有 UI 配置入口。

### 6.3 当前项目最需要的是"控制面穿透"，而非"从零建编排"

~~原文建议从零建立编排内核。~~ 实际上更合理的方向是：

1. **控制面与运行时 DAG 打通**：让 BFF 能读取 task-graph-plugin 的 JSON 状态，让 graph 接口返回真实数据。
2. **可视化运行时编排决策**：在 UI 中展示意图分类结果、Agent 路由决策、规划流水线状态。
3. **将运行时 DAG 回写数据库**：通过事件回写或定期同步，把节点和边持久化到控制面数据库。
4. **渐进式治理挂载**：在控制面层对运行时产生的编排行为施加审批、预算、策略约束。

### 6.4 其他未落地模块

以下控制面模块虽然已有目录，但实际为空：

- `control-plane/service/src/modules/notification/` — 通知模块，无任何实现
- `control-plane/service/src/opencode/` — 控制面 OpenCode 模块，无任何实现
- `mcp-servers/` — 6 个 MCP 服务目录（browser-automation、cmdb、code-search、docs-search、knowledge-base、ticket），全部为空

## 7. 建议借鉴方向

### 7.1 第一优先级：运行时 → 控制面穿透 [修订]

~~原文建议"补齐编排内核"。~~ 经审核，编排内核已存在于运行时层。建议优先做的是让控制面能感知和治理这些已有能力：

1. **BFF graph 接口对接运行时 DAG**。
   让 `/api/tasks/:taskId/graph` 从 task-graph-plugin 的 JSON 文件或 OpenCode 事件流中获取真实节点和依赖边，而非返回占位。

2. **运行时编排事件持久化**。
   将意图分类结果、Agent 路由决策、规划流水线状态、DAG 节点状态变更回写到控制面数据库，支持跨会话查询和审计。

3. **控制面 DAG 数据模型**。
   在数据库中建立 task_nodes/task_edges/agent_runs 表，用于持久化存储运行时 DAG 的镜像。

### 7.2 第二优先级：把配置控制面升级为生命周期控制面

建议在现有 Settings 基础上继续做：

1. 插件安装、卸载、启用、禁用。
2. 插件版本记录与兼容性检查。
3. Skill/MCP 插件与项目、环境、策略之间的绑定关系。
4. 配置变更后的验证与回滚能力。

### 7.3 第三优先级：增强连续执行与运行恢复能力 [修订]

运行时层已有基础（session-tools 会话搜索/续跑、handoff 命令、Ralph Loop 重试），但控制面尚未暴露。建议补齐：

1. **会话历史 UI**。将 session-tools 的 list/search/summary 能力在 TaskDetail 页面上展示。
2. **任务恢复入口**。把 session_continue 暴露为 BFF 接口，前端增加"续跑"按钮。
3. **失败重试与 fallback 治理**。定义哪些失败场景可自动重试、何时切换模型、何时必须人工介入，使恢复行为可审计。

## 8. 可执行方案 [修订]

### 阶段 A：运行时 DAG -> 控制面穿透

目标：让运行时已有的 DAG 编排能力在控制面可见、可查询、可持久化。

工作包：

1. BFF graph 接口对接运行时 DAG。
2. 建立控制面 DAG 镜像表（`task_nodes`、`task_edges`、`agent_runs`）。
3. 将运行时意图分类、路由、规划状态回写 `audit_events`。
4. 前端 TaskGraph 改为 API 全量加载 + 实时增量更新。

验收标准：

1. `/api/tasks/:taskId/graph` 返回真实节点与依赖边。
2. TaskGraph 刷新后仍可完整还原 DAG。
3. 管理员可在控制面查看 intent/route/plan 关键信息。

### 阶段 B：编排可视化与治理挂载

目标：让控制面不仅可见，还能对运行时编排行为施加治理策略。

工作包：

1. 在任务详情页展示意图分类、Agent 路由、规划流水线状态。
2. 对关键编排节点接入审批、预算、策略检查。
3. 形成任务级审计视图（编排决策时间线 + 成本信息）。

验收标准：

1. 关键编排决策可在 UI 可视化查看。
2. 治理策略可挂载到编排节点，不绕过审批边界。
3. 审计链条完整，可追溯到 session 和 task。

### 阶段 C：插件生命周期控制面

目标：把当前“配置控制面”升级为“生命周期控制面”。

工作包：

1. 插件启停、安装/卸载、版本管理。
2. 兼容性检查与变更前验证。
3. Skill/MCP 与项目、环境、策略的绑定关系管理。
4. 失败回滚与版本回退。

验收标准：

1. 插件生命周期操作全流程可在控制面完成。
2. 变更失败可自动回滚并记录审计。
3. 插件状态与运行时实际状态一致。

### 阶段 D：恢复能力控制面暴露

目标：把运行时已有恢复能力（session-tools/handoff/Ralph Loop）暴露到控制面。

工作包：

1. Session 历史检索与摘要 UI。
2. 任务“续跑/重试/中断恢复”入口。
3. fallback 与自动重试策略的治理化配置。

验收标准：

1. 任务失败后可从控制面一键续跑。
2. 恢复行为可解释、可审计。
3. 自动重试不突破现有治理边界。

## 9. 优先级建议 [修订]

1. P0：阶段 A（先打通运行时 -> 控制面）
2. P1：阶段 B（先可视化，再治理挂载）
3. P2：阶段 C（插件生命周期）
4. P3：阶段 D（恢复能力暴露）

排序依据：

- 阶段 A/B 直接解决当前“能力存在但不可见、不可查、不可管”的主矛盾。
- 阶段 C/D 在 A/B 完成后可快速复用已有数据模型和审计链路。

## 10. 风险与缓解 [修订]

1. 风险：运行时 JSON 与控制面数据库状态不一致。
缓解：引入版本号与时间戳对齐策略，允许幂等重放。

2. 风险：graph 接口改造影响现有前端占位逻辑。
缓解：灰度开关 + 双路径兼容期（stub/real graph）。

3. 风险：治理规则过早耦合导致运行时性能下降。
缓解：先只读可视化，逐步挂载审批和预算检查。

## 11. 结论 [修订]

OpenerX 的核心短板不是“缺少编排能力”，而是“控制面无法感知并治理运行时已存在的编排能力”。

因此，建议采用“运行时 DAG 穿透 -> 编排可视化 -> 插件生命周期 -> 恢复能力暴露”的渐进路线。该路线能最大化复用 `opencode-fork` 的既有能力，避免重复建设，并在不破坏现有治理边界的前提下实现能力升级。
