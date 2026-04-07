# Task Session Message 收口边界 ADR

> 状态：Accepted  
> 日期：2026-04-07  
> 作者：GitHub Copilot  
> 关联文档：[execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)、[task-session-message-current-write-path.md](task-session-message-current-write-path.md)、[task-session-message-minimal-contract.md](task-session-message-minimal-contract.md)、[api-boundary.md](api-boundary.md)

## 1. 决策摘要

本 ADR 固化这轮 task session message 收口后的正式边界。后续评审、实现、排障和文档同步，均以本文为单一结论来源，不再从历史方案、兼容逻辑和对话记录拼接结论。

最终决策有六条：

1. task-domain 的消息主事实写链只认 canonical session-first 持久化链路：`task_sessions`、`task_session_runs`、`task_messages`、`task_message_parts`、`task_timeline_views`。
2. OpenCode runtime 仍是消息正文的 source of truth；BFF 负责把 runtime 完整 message snapshot 镜像进 control-plane service，而不是让 UI 或 service 自行推断增量正文。
3. `task_message_events` 已从 service 运行代码、公开调试读口、schema export 与数据库表中移除；`task_messages.rawPayload`、`task_message_parts.jsonPayload` 仍然保留，但它们不属于 canonical message fact contract，也不得重新承担 canonical 列回填或公开读链 fallback 的职责。
4. `task_session:` alias 已从 service 与 BFF 的 task-domain 公共读写输入退役；对外只接受 canonical `task-session:` 形态，或在少数 helper 中接受 bare `runtimeSessionId` 做归一。
5. assistant placeholder 预写已经退役；缺少稳定 runtime message id 的消息不得入库，不能再回退到随机 id 或空壳 assistant。
6. 这轮收口已经直接删除 event log；仍明确保留的是 raw payload 保真层与 project-tree 内部 compat node id，它们不属于遗漏，也不得重新演变成公开消息事实层。

## 2. 背景

这轮收口不是单纯的 UI 去重，而是沿着真实根因把消息写链、读链和 session id 边界一起锁死。

触发这轮收口的根因有三类：

1. PiMono runtime 的 assistant 消息在早期事件和完成事件之间出现 id 漂移，同一条逻辑回复会先按 timestamp、后按 responseId 被镜像两次，最终造成重复入库和重复展示。
2. 历史兼容路径同时存在 assistant placeholder 预写、`task_session:` alias 读取归一、raw payload 回填 canonical 列，导致评审时无法分清哪一层是主事实，哪一层只是兼容补位。
3. 旧 task aggregate 写入口在写 `task_snapshots.current_session_id` 这类 FK 字段时，可能只凭 runtime session id 拼出 canonical id，却没有先确保真实 `task_sessions` 行存在，最终触发 FK 错误。

本 ADR 的目的，是把“当前主写链是什么”“哪些层是刻意保留”“哪些兼容已经退役”“哪些 internal alias 仍可存在”一次性说清。

## 3. 最终边界

### 3.1 Canonical Message Fact Write Path

task-domain 当前唯一正式的消息主写链如下：

1. runtime 产出完整 message snapshot。
2. BFF 将 snapshot 发送到 `POST /api/tasks/:taskId/sessions/messages`。
3. service 用共享 runtime message schema 做严格解析与 typed normalization。
4. service 将规范化结果 upsert 到 canonical 表。

当前正式主事实表为：

1. `task_sessions`
2. `task_session_runs`
3. `task_messages`
4. `task_message_parts`
5. `task_timeline_views`

这条主链由以下实现共同定义：

1. [control-plane/service/src/modules/tasks/task-session-message-write-api.ts](../control-plane/service/src/modules/tasks/task-session-message-write-api.ts)
2. [control-plane/service/src/modules/tasks/task-branch-write.ts](../control-plane/service/src/modules/tasks/task-branch-write.ts)
3. [control-plane/web-ui-bff/src/modules/tasks/reconcile.ts](../control-plane/web-ui-bff/src/modules/tasks/reconcile.ts)

含义是：

1. live write 和 runtime-backed repair 最终都复用同一条 canonical upsert 路径。
2. task-domain 不再允许存在另一套“同等级消息事实表”与 canonical 表并行承担主写职责。
3. 评审“消息是否已经写到数据库”时，默认就是检查这套 canonical session-first 表，而不是检查保留层是否仍有附带写入。

### 3.2 Session Identity Boundary

当前 task-domain / BFF 公共 session identity 边界如下：

1. canonical session id 形态为 `task-session:${taskId}:${runtimeSessionId}`。
2. 对外 contract 不再接受 `task_session:${taskId}:${runtimeSessionId}`。
3. 少数 helper 或读写入口仍可接受 bare `runtimeSessionId`，但只能立即 canonicalize，不能把它继续扩散成公开 contract。

当前实现锚点：

1. [control-plane/service/src/modules/tasks/task-session-write-api.ts](../control-plane/service/src/modules/tasks/task-session-write-api.ts)
2. [control-plane/service/src/modules/tasks/task-session-read.ts](../control-plane/service/src/modules/tasks/task-session-read.ts)
3. [control-plane/web-ui-bff/src/modules/tasks/task-session-store.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-store.ts)

唯一仍允许出现 `task_session:` 的地方，是 [control-plane/service/src/modules/project-tree/storage.ts](../control-plane/service/src/modules/project-tree/storage.ts) 中的 internal compat node id。它的角色只限于 project-tree 历史节点别名，不得重新当成 task-domain public session id、route 输入或公共读链 fallback。

### 3.3 Removed Event Log And Retained Payload Layers

当前边界分成两类：

1. 已删除层：`task_message_events`
2. 保留层：`task_messages.rawPayload`
3. 保留层：`task_message_parts.jsonPayload`

它们的职责边界是：

1. `task_message_events` 已不再存在于 service 同步写链、raw-events debug route、schema export 或 projector 中；数据库物理表也应通过 migration 或显式 DDL 删除。
2. `rawPayload` / `jsonPayload` 只承担结构保真，例如 parts、tool payload、prompt decomposition、agent/model 元信息。
3. 这些保留 payload 层不得再回填 canonical 已拆列字段，例如 `runtimeMessageId`、`textContent`、`errorText`、`client/providerMessageId`。
4. 这些保留 payload 层也不得被重新包装成 task-domain 公开 session/message/execution-trace 的 fallback source。

因此，“消息数据库写入是否已经完全修改”这句话的正式解释是：

1. 主事实写链已经完全切到 canonical session-first 表。
2. event log 已经拆除；当前仍保留的只有原始 payload 保真层，这不属于未收口完成的证据。

### 3.4 Explicitly Retired Compatibility

这轮已经明确退役的兼容行为如下：

1. assistant placeholder 预写
2. 缺少稳定 runtime message id 时回退到随机 id 的写法
3. service / BFF task-domain 公共读链中的 `task_session:` alias 归一
4. canonical message 行对 `rawPayload` 的列值回填
5. 仅凭 runtime session id 合成 canonical session FK、但不先建真实 `task_sessions` 行的写法

这些能力都不应再被描述为“仍可暂时保留的兼容层”。如果未来有人想重新引回，必须视为新的架构决策，而不是小修补。

### 3.5 Legacy Task Aggregate Write Boundary

旧 task aggregate 写入口仍然存在，但它们必须服从 canonical session FK 顺序。

正式约束如下：

1. 任何会写 `task_snapshots.current_session_id`、`latest_session_id` 或其他 canonical session FK 的入口，必须先保证真实 `task_sessions` 行存在。
2. `PATCH /api/tasks/:taskId` 这类旧入口如果带 `sessionId`，必须先 upsert conversation session record，再同步 aggregate / snapshot。
3. aggregate sync 可以接受 canonical session id 或 bare runtime session id，但最终必须解析到数据库里真实存在的 `task_sessions.id`。

当前实现锚点：

1. [control-plane/service/src/modules/tasks/task-core-routes.ts](../control-plane/service/src/modules/tasks/task-core-routes.ts)
2. [control-plane/service/src/modules/tasks/task-aggregate-sync.ts](../control-plane/service/src/modules/tasks/task-aggregate-sync.ts)

### 3.6 与 Execution Trace 边界的关系

这份 ADR 不重新定义 execution trace 的公开读链，相关最终结论仍以 [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md) 为准。

这里只补一条衔接规则：

1. task-domain message 收口后，execution trace 若需要 message 事实，仍应优先消费 canonical projection 与持久化聚合结果。
2. 已删除的 event log、runtime raw message、project-tree compat alias 都不能被重新拉回公开 trace contract。

## 4. 直接后果

这份边界落地后，后续实现与评审应遵守以下后果：

1. message persistence 的主链评审，优先看 canonical session-first 表是否正确，而不是先看 event log 或 raw payload 是否为空。
2. 若未来变更重新把 `task_session:` 引入 BFF / service task-domain 公共输入，必须先修改本文并说明理由。
3. 若未来变更希望把 `rawPayload/jsonPayload` 进一步下线，属于新的“继续简化”范围，不属于本轮收口的未完成项。
4. 新测试应优先验证稳定 message id、canonical upsert、session FK 顺序，以及不再从 raw payload 回填 canonical 列。

## 5. 验收信号

本轮收口完成时，至少满足以下验收信号：

1. service 消息主写链已统一到 [control-plane/service/src/modules/tasks/task-session-message-write-api.ts](../control-plane/service/src/modules/tasks/task-session-message-write-api.ts) 的 canonical upsert 路径。
2. BFF `toCanonicalTaskSessionId(...)` 已不再接受 `task_session:` alias，见 [control-plane/web-ui-bff/src/modules/tasks/task-session-store.ts](../control-plane/web-ui-bff/src/modules/tasks/task-session-store.ts)。
3. 生产代码里剩余 `task_session:` 仅存在于 [control-plane/service/src/modules/project-tree/storage.ts](../control-plane/service/src/modules/project-tree/storage.ts) 的 internal compat node id。
4. `task_message_events` 相关的同步 append、raw-events route、schema export 与 projector 已从运行代码移除，数据库删表 migration 已落到 [control-plane/service/drizzle-pg/0036_drop_task_message_events.sql](../control-plane/service/drizzle-pg/0036_drop_task_message_events.sql)。

## 6. 可直接引用的评审结论

可直接引用以下结论：

> OpenerX 当前 task session message 的正式主事实写链，已经锁定为 canonical session-first 持久化模型：runtime 仍是消息 source of truth，BFF 只负责镜像完整 runtime snapshot，service 统一写入 `task_sessions`、`task_session_runs`、`task_messages`、`task_message_parts` 与 `task_timeline_views`。`task_message_events` 已从运行代码与数据库表中移除；仍保留的 `rawPayload/jsonPayload` 只承担结构保真，不再承担 canonical 列回填、公开读链 fallback 或兼容双写职责。`task_session:` alias 已退出 service/BFF 的 task-domain 公共输入，唯一剩余位置仅是 project-tree 内部 compat node id。

## 7. 相关文档

1. [task-session-message-current-write-path.md](task-session-message-current-write-path.md)
2. [task-session-message-minimal-contract.md](task-session-message-minimal-contract.md)
3. [task-page-session-message-display-guide.md](task-page-session-message-display-guide.md)
4. [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)
5. [api-boundary.md](api-boundary.md)