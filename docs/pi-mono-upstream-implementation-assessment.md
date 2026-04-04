# pi-mono Upstream Implementation Assessment

> 日期：2026-04-04  
> 上游仓库：`badlogic/pi-mono`  
> 本地检出目录：`tmp/pi-mono-upstream`  
> 检出提交：`84d1340`

## 1. 结论

`pi-mono` 不是一个现成的“HTTP runtime service”，而是一个以 TypeScript 实现的可嵌入 coding-agent monorepo。它已经具备以下能力：

1. 通用 agent loop。
2. 模型 tool call 执行。
3. 内置 `bash` / `read` / `write` / `edit` 等工具。
4. 基于 `stdin/stdout` JSONL 的 headless RPC 模式。
5. 通过 `beforeToolCall` / `afterToolCall` 和 extension system 做工具拦截与扩展。

这意味着它**可以作为 OpenerX 的 runtime 内核候选**，但**不能原样直接当成控制面的 runtime service**。如果要接入当前项目，最合理的方式不是把它当作现成 HTTP 服务，而是：

1. 以 `RPC mode` 作为进程级 runtime 接口。
2. 在 BFF 外面包一层 `pi-mono-provider`。
3. 由 BFF 负责 task/session/audit/approval/tool whitelist/prompt visibility。
4. 由 `pi-mono` 负责模型循环、tool loop、命令实际执行。

## 2. 仓库结构

上游 monorepo 的顶层结构见 [tmp/pi-mono-upstream/README.md](tmp/pi-mono-upstream/README.md) 和 [tmp/pi-mono-upstream/package.json](tmp/pi-mono-upstream/package.json)。

关键包：

1. [tmp/pi-mono-upstream/packages/ai](tmp/pi-mono-upstream/packages/ai): 多 provider LLM API。
2. [tmp/pi-mono-upstream/packages/agent](tmp/pi-mono-upstream/packages/agent): 通用 agent runtime。
3. [tmp/pi-mono-upstream/packages/coding-agent](tmp/pi-mono-upstream/packages/coding-agent): coding agent CLI、内置工具、RPC 模式。

对你当前项目最重要的是后两者。

## 3. 实现方式评估

### 3.1 通用 agent loop 在 `packages/agent`

`pi-mono` 的核心循环在 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L150)。

它的行为非常明确：

1. 先流式拿 assistant response。
2. 从 assistant message 里解析 `toolCall`。
3. 有 tool call 时执行工具。
4. 把 tool result 重新压回消息上下文。
5. 再继续下一轮模型调用，直到不再有 tool call。

这部分和你希望的 `pi-mono` 角色是一致的，因为它天然是“模型循环 + 工具循环”的执行面，而不是控制面。

### 3.1.1 “回给模型”与“只落库不回给模型”的工程规则

从上游实现看，边界其实很明确：

1. tool 执行完成后，`emitToolCallOutcome()` 会产出 `ToolResultMessage`，见 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L593)。
2. 这个 `ToolResultMessage` 会被压回 `currentContext.messages`，然后参与下一轮模型调用，见 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L196)。
3. 真正送给模型前，还会经过 `transformContext` 和 `convertToLlm`，因此不是“数据库里有什么就全量回灌什么”，见 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L231)、[tmp/pi-mono-upstream/packages/coding-agent/src/core/sdk.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/sdk.ts#L309)、[tmp/pi-mono-upstream/packages/coding-agent/src/core/messages.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/messages.ts#L147)。
4. `bash` 大输出本身也已经有截断和临时文件落盘语义，因此 OpenerX 不应把完整长日志再无脑塞回模型，见 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L330)。

因此，BFF 接入时建议采用下面这条硬规则：

> 只有“下一步推理必需 + 模型可消费 + 体积可控 + 不含敏感信息”的内容，才回给模型；其余内容只落库，用于审计、前端投影、追踪、账本和重放。

| 内容类别 | 回给模型 | 推荐落库位置 | 工程处理规则 |
| --- | --- | --- | --- |
| 用户显式输入 | 原文回给 | `task_messages(user)`、`session_operations(input_received)` | 用户刚发出的内容本来就是下一轮推理起点，必须进入模型上下文，同时保留原始审计记录。 |
| BFF 组装后的 `system_context_text` / `final_sent_text` | 原文回给 | `session_operations(prompt_build)`、prompt snapshot artifact | 这部分是控制面显式注入给 runtime 的业务上下文，既要给模型，也要保留可审计快照。 |
| assistant 已产生的文字回复与 tool call 决策 | 是 | `task_messages`、`task_message_parts`、`session_operations(tool_call)` | 这些本来就属于 agent loop 的历史上下文，BFF 要镜像持久化，但不需要再人为二次拼装。 |
| 工具最终结果：小文本、小 JSON、关键观察值 | 原文回给或轻度规范化后回 | `session_operations.result`，必要时镜像到 `task_message_parts` | 只要它直接影响下一步决策，就应该作为最终 `toolResult` 回给模型。规范化只允许做裁剪、字段白名单、去噪。 |
| 工具执行过程中的流式 partial output | 不回 | `session_operations` streaming event、realtime event log | partial chunk 主要服务前端实时展示；模型消费的是最终 `toolResult`，不应把每个增量片段重复塞回上下文。 |
| 大 stdout/stderr、长日志、超长列表 | 摘要后回 | `task_artifacts`、`session_operations.details` | 回给模型的只保留摘要、尾部截断或结构化结论；完整原文只作为 artifact/审计记录持久化。 |
| 二进制文件、图片、完整文件内容 | 仅在模型确实需要时，以 image content 或摘要回 | `task_artifacts` | 原始二进制默认只落库；只有当下一步推理确实依赖视觉/文件内容时，才生成模型可消费的派生内容。 |
| exit code、标准化错误原因、关键失败上下文 | 是，但只回规范化结果 | `session_operations.error`、失败 artifact | 应回给模型的是稳定、短小、可行动的失败信息，比如 exit code、stderr 摘要、失败分类；不要回完整堆栈和原始调试日志。 |
| 审批结果、白名单命中、路径保护、策略判定、账本数据、trace id、DB 主键 | 不回 | `session_operations.policy`、`task_usage_ledger_entries`、audit tables | 这些属于治理和审计元数据，应该服务控制面和运营，不应该污染模型推理。 |
| 密钥、token、cookie、环境变量原值、凭证、敏感路径 | 不回 | 默认不存原文；若必须存，则只存脱敏值 | 这是硬红线：既不回给模型，也不应在业务表里保留原文。需要调试时只保留脱敏摘要。 |
| 前端投影视图字段，如 `summary`、`timeline`、`compare`、`readSource` | 不回 | `execution-view` 投影层或读模型 | 这些是给前端读的聚合结果，不是给模型继续推理的原始语义。不要把前端视图模型反向灌回 runtime。 |

可以把这张表再压成 4 条执行规则：

1. 只要内容是“给模型继续想下一步用的事实”，就回给模型，同时落库。
2. 只要内容是“给人看、给审计看、给前端聚合看”的元数据，就只落库，不回给模型。
3. 只要内容“理论上对模型有用，但体积过大”，就回摘要，把原文落到 artifact。
4. 只要内容“可能泄露敏感信息”，就既不原文回给模型，也不原文入业务库。

### 3.2 工具调用支持顺序和并行

在 [tmp/pi-mono-upstream/packages/agent/src/types.ts](tmp/pi-mono-upstream/packages/agent/src/types.ts#L29) 和 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L334) 可以看到：

1. 单条 assistant message 里的多个 tool call 支持 `sequential` 和 `parallel` 两种执行策略。
2. `parallel` 模式下会先顺序完成 prepare/preflight，然后并发执行允许的工具。
3. tool result 最终仍按 assistant 原始顺序回发。

这意味着它对“一个回复里多个工具调用”的处理已经比较成熟。

### 3.3 工具拦截点已经存在

在 [tmp/pi-mono-upstream/packages/agent/src/types.ts](tmp/pi-mono-upstream/packages/agent/src/types.ts#L41) 和 [tmp/pi-mono-upstream/packages/agent/src/types.ts](tmp/pi-mono-upstream/packages/agent/src/types.ts#L52) 定义了：

1. `beforeToolCall`
2. `afterToolCall`

在 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L491) 和 [tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts](tmp/pi-mono-upstream/packages/agent/src/agent-loop.ts#L573) 可以看到它们实际被调用。

这对 OpenerX 很关键，因为你需要：

1. 工具白名单。
2. 审批前置。
3. 命令执行审计。
4. tool result 映射回 `session_operations` / `task_message_parts`。

这些都不需要改 `pi-agent-core` 的主循环，只需要在外层接 hook 或 extension。

### 3.4 `bash` 工具已经是独立实现

内置 `bash` 工具定义在 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L1)。

关键实现特征：

1. 使用 `spawn(shell, [...args, command])`，不是简单 `exec`，见 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L69)。
2. 支持 streaming partial output，边执行边通过 `onUpdate` 回传，见 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L318)。
3. 支持 `AbortSignal` 取消，取消时会 kill 整个进程树，见 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L88)。
4. 大输出会滚动截断，并把完整输出写到临时文件，见 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L301)。
5. 支持通过 `BashOperations` 替换底层执行后端，因此理论上也能改造成远程/容器/bash sandbox 后端，见 [tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/tools/bash.ts#L39)。

这个设计对你是加分项，因为它不是把 shell 写死在 CLI UI 里，而是抽象成了工具实现和可替换 backend。

### 3.5 还有一个独立的 bash executor

除了工具调用路径，`packages/coding-agent` 还提供了单独的 bash 执行器 [tmp/pi-mono-upstream/packages/coding-agent/src/core/bash-executor.ts](tmp/pi-mono-upstream/packages/coding-agent/src/core/bash-executor.ts#L1)。

它主要用于：

1. 交互模式或 RPC 模式下的直接 bash 命令。
2. 和内置 bash 工具共享相同的本地执行 backend。

对 OpenerX 来说，这不是最核心的集成点，因为你更关心的是模型 inside tool loop 的命令执行，而不是额外暴露一个 `bash` RPC 命令给前端。

## 4. 进程集成方式

`pi-mono` 对外推荐的是 `RPC mode`，而不是 HTTP/SSE 服务。

官方说明见：

1. [tmp/pi-mono-upstream/packages/coding-agent/README.md](tmp/pi-mono-upstream/packages/coding-agent/README.md#L412)
2. [tmp/pi-mono-upstream/packages/coding-agent/docs/rpc.md](tmp/pi-mono-upstream/packages/coding-agent/docs/rpc.md#L1)

RPC 模式入口在 [tmp/pi-mono-upstream/packages/coding-agent/src/modes/rpc/rpc-mode.ts](tmp/pi-mono-upstream/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1)，协议类型在 [tmp/pi-mono-upstream/packages/coding-agent/src/modes/rpc/rpc-types.ts](tmp/pi-mono-upstream/packages/coding-agent/src/modes/rpc/rpc-types.ts#L1)。

它的特点：

1. 通过 `stdin` 接收 JSONL 命令。
2. 通过 `stdout` 回传 JSONL response 和 event。
3. 适合被另一个进程托管。
4. 不是天然的多租户 HTTP 服务。

这与 OpenerX 当前 BFF 架构的关系是：

1. 它适合作为 BFF 管理的子进程 runtime。
2. 它不适合作为前端直接对接的服务接口。

## 5. 权限与审批边界

这是它最明显的架构取向。

在 [tmp/pi-mono-upstream/packages/coding-agent/README.md](tmp/pi-mono-upstream/packages/coding-agent/README.md#L424) 明确写着：

1. `No permission popups.`
2. 需要你自己用 extensions 或运行环境去做确认流。

另外在 [tmp/pi-mono-upstream/packages/coding-agent/README.md](tmp/pi-mono-upstream/packages/coding-agent/README.md#L81) 可以看到，默认直接给模型四个工具：`read`、`write`、`edit`、`bash`。

这对你来说意味着：

1. `pi-mono` 的默认哲学是“尽量少内置治理”。
2. 你的审批、命令分级、路径保护、成本策略，不能指望上游开箱即用。
3. 这些控制必须由 BFF 或自定义 extension 明确实现。

## 6. 对 OpenerX 的适配评估

### 6.1 适合的点

1. 已有成熟的 tool loop，不需要你从零实现模型工具循环。
2. 已有 headless RPC mode，适合作为 runtime 子进程接到 BFF 后面。
3. 已有 `beforeToolCall` / `afterToolCall`，便于接入审计、审批、白名单和事件映射。
4. `bash` 工具支持 streaming、取消、超大输出截断和 temp file，这些都是 coding-agent 场景里实用的能力。
5. TypeScript 实现，与当前 Bun/TS monorepo 技术栈距离近。

### 6.2 不适合直接照搬的点

1. 它不是任务域 runtime，而是通用 coding-agent runtime。
2. 它没有你当前项目需要的 task/project/session/parallel-candidate/workflow-stage 一等概念。
3. 它默认没有审批弹窗、命令确认、组织级治理。
4. 它默认是 CLI / RPC 进程模型，不是现成 HTTP + SSE 服务。
5. 它的消息、session、fork、UI 状态有自己的一套内部语义，不能直接映射成你现在的 task domain。

### 6.3 最合理的接法

如果继续采用 Bun + pi-mono，建议这样接：

1. BFF 新建 `runtime-provider.ts` 与 `pi-mono-provider.ts`。
2. `pi-mono-provider.ts` 通过子进程方式启动 `pi --mode rpc`。
3. BFF 负责把 `task/session` 语义翻译成 RPC `prompt` / `steer` / `follow_up` / `abort` 命令。
4. BFF 负责把 RPC event 映射成：
   1. `task_messages`
   2. `task_message_parts`
   3. `session_operations`
   4. `task_artifacts`
5. 命令白名单、审批、路径保护放在：
   1. BFF 入参生成层
   2. `beforeToolCall` hook
   3. 自定义 extension

## 7. 最终判断

如果你的目标是“替换 OpenCode，但保留 agentic coding runtime 的命令执行和 tool loop 能力”，那么 `pi-mono` 是一个可行底座。

如果你的目标是“直接拿一个现成的多用户任务执行服务替换控制面 runtime”，那么它还不够，需要你自己补：

1. BFF provider 封装。
2. task domain 映射。
3. 审批与命令治理。
4. realtime 事件投影。
5. 组织级审计与成本账本。

因此，最终建议不是“直接把 `pi-mono` 当服务接进来”，而是：

1. 把它作为 runtime engine。
2. 让 OpenerX 的 BFF 保持控制面地位。
3. 用 provider + hook + extension 的方式，吸收它已有的 tool loop 和 bash 执行能力。
