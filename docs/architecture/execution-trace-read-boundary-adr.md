# Execution Trace 读取边界 ADR

> 状态：Accepted  
> 日期：2026-03-24  
> 作者：GitHub Copilot

## 1. 决策摘要

本 ADR 固化当前 execution trace 的最终公开边界，后续评审、实现和文档同步均以本文为准，不再从多份方案文档拼接结论。

最终决策只有四条：

1. task 和 project 两条 execution trace 公开读链以 `task_timeline_views` 为 primary source。
2. service timeline 保留为正式但受限的 secondary source，只允许在 projection timeline 为空或不可用时补位。
3. runtime 原始 message 接口不是公开 execution trace fallback，不得重新进入 task-domain trace contract。
4. 只要 projection 已返回非空 timeline，即使 `cacheState=partial` 或 `complete=false`，也必须保留显式 incomplete，而不是切到 secondary source 覆盖。

## 2. 背景

此前仓库内对 execution trace 的表述长期混杂了三类语义：

1. projection-first 读链
2. service timeline 的持久化聚合读链
3. runtime raw message 的协议级诊断读链

这种混用带来了两个问题：

1. 评审时难以判断哪条链路是公开 contract，哪条只是兼容或诊断能力。
2. 实现上容易把 partial projection 静默替换成另一条来源，导致前端看不到明确的不完整状态。

本 ADR 的目标就是把这三条链路的边界锁死。

## 3. 最终决策

### 3.1 Public Trace Primary Source

以下接口对外暴露的 execution trace，以 projection-first 为正式主链：

1. `GET /api/tasks/:taskId/execution-trace`
2. `GET /api/projects/:projectId/task-execution-trace/:taskId`

这里的 primary source 是：

1. `task_timeline_views`
2. 对应的 `conversation_messages` / `conversation_message_parts` 持久化事实

含义是：公开 trace 的结构化 timeline 以 task-domain 投影为准，而不是以 runtime 会话消息流为准。

### 3.2 Service Timeline Secondary Source

service timeline 继续保留，但其角色被限制为正式 secondary source，而不是可任意覆盖主链的 fallback。

允许启用 secondary source 的条件只有两种：

1. projection timeline 为空
2. projection timeline 不可用

以下情况明确禁止切换到 secondary source：

1. projection 已返回非空 timeline，但状态是 partial
2. projection 已返回非空 timeline，但仍缺部分 rich trace 元信息
3. 前端只是为了避免显示 incomplete，而尝试静默改读另一条来源

### 3.3 Runtime Raw Message Boundary

runtime 原始 message 相关接口仍可保留在 runtime 协议和诊断语境中，但它们不是 task-domain execution trace 的公开读取来源。

因此以下能力不得重新引入公开 trace contract：

1. runtime message fallback
2. 基于 runtime raw message 的 prompt backfill
3. 用 runtime snapshot 或 latestResult 合成公开 trace message

换句话说，runtime 提供的是协议事实、控制面交互和诊断能力，不是 task-domain trace read model。

当前实现补充说明：BFF `GET /api/tasks/:taskId/execution-trace` 与 `GET /api/projects/:projectId/task-execution-trace/:taskId` 都已移除基于 `task.prompt` 的用户输入补写；当 projection timeline 与 service timeline 都不可用时，返回值会保留显式 incomplete 元信息，而不是再合成 prompt segment。

补充边界说明：branch/session compat 读取 cached messages 时仍可保留 runtime fallback，但这只属于 session message compatibility contract，用于 lineage message 拼接、branch 预览或其他非公开 session consumer；它不属于公开 execution trace contract，也不得被重新包装成 task/project trace 的数据源。

为避免测试说明与设计文档再次漂移，仓库内测试命名与 helper 术语也应遵守同一边界：`execution-trace-contract` 只指 task/project 两条公开 trace route 的 contract；`session-message-compatibility` 只指 branch lineage、session preview、runtime pipeline、reconcile、adapter finalization 等非公开 session consumer 的兼容读面 contract；具体命名约定以 [tests/README.md](../../tests/README.md) 为测试层同步来源。

### 3.4 Incomplete 必须显式可见

当 projection 返回非空但不完整的 timeline 时，系统必须保留显式 incomplete 语义。

这条约束适用于：

1. BFF trace route 的 `timelineMeta`
2. TaskDetailV3 主聊天区的 warning
3. 并行候选区的 `incomplete` / `stale` 标记
4. 右侧 trace panel 的不完整提示

目标不是“尽量隐藏缺口”，而是“保证公开 trace contract 可解释且可验证”。

## 4. 直接后果

这份决策落地后，后续实现和评审应遵守以下后果：

1. BFF outward contract 不再包含 `runtime-fallback` 一类 readSource。
2. service timeline 不得覆盖非空 partial projection。
3. 前端需要把 incomplete 或 stale 状态明确暴露出来，而不是继续静默复用旧 trace 数据。
4. 文档若讨论 runtime raw message，只能放在 runtime 协议、诊断或控制面语境，不能描述成公开 trace 主读源。
5. 新增测试应优先验证 projection-first、partial 保留、secondary source 启动边界，而不是再补旧 fallback 行为。

## 5. 可直接引用的评审结论

可直接引用以下结论：

> OpenerX 当前 execution trace 的公开 contract 已锁定为 projection-first：`task_timeline_views` 是 primary source，service timeline 仅在 projection timeline 为空或不可用时作为受限 secondary source 补位；runtime raw message API 不属于公开 trace fallback。只要 projection 已返回非空 timeline，即使状态为 partial，也必须保留显式 incomplete，而不能用 secondary source 静默覆盖。

## 6. 影响范围

本 ADR 直接约束以下范围：

1. service timeline secondary source 聚合语义
2. web-ui-bff task/project execution trace routes
3. TaskDetailV3 主聊天区、并行候选区、trace panel 的状态表达
4. 与 execution trace 相关的测试命名、断言和文档表述

## 7. 相关文档

1. [task-domain-radical-storage-redesign-plan.md](../task-domain/task-domain-radical-storage-redesign-plan.md)
2. [task-domain-cleanup-closure-plan.md](../task-domain/task-domain-cleanup-closure-plan.md)
3. [api-boundary.md](api-boundary.md)
4. [opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md)
5. [runtime-process-architecture.md](runtime-process-architecture.md)
