# pi-mono Upstream Implementation Assessment

> 文档类型：当前实现
> 日期：2026-04-15
> 状态：已重建
> 结论：`pi-mono` 适合作为 OpenerX 的进程级 runtime engine；不适合作为现成的多租户 HTTP runtime service 直接替换控制面。
> 重建说明：该文件此前误保存为上游源码抓取结果，正文已按当前代码与验证证据重建。

## 1. 评估目标

这份文档回答的不是“当前 rollout 是否全部完成”，而是下面三个更基础的问题：

1. `pi-mono` 上游到底提供了什么能力。
2. 它在 OpenerX 里最合适的接入形态是什么。
3. 哪些能力可以直接复用上游，哪些必须继续由 OpenerX 自己负责。

对应的进度与验收状态，请结合 [pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md) 阅读。该文档负责记录当前工作区的实现状态、live 验收结果和剩余收口项；本文件负责给出接入判断与职责边界。

## 2. 执行摘要

当前结论可以压缩成 6 句话：

1. `pi-mono` 上游的核心价值，是通用 agent loop、tool call 执行能力、基于 `stdin/stdout JSONL` 的 RPC 模式，以及 extension hook 机制。
2. 这些能力足够支撑 OpenerX 的执行内核，但并没有直接提供 OpenerX 需要的 task/session canonical model、多租户边界、审批记录、审计账本和 realtime 投影。
3. 因此，最佳接法不是“把 upstream 当成独立 HTTP runtime service 直接挂进来”，而是“BFF 自己托管 `pi-mono` 子进程，通过 provider 包一层 RPC 适配”。
4. 当前工作区已经按这个方向落地，主实现位于 [../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono.ts](../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono.ts) 和 [../../control-plane/web-ui-bff/src/modules/agent-control/pimono-rpc-client.ts](../../control-plane/web-ui-bff/src/modules/agent-control/pimono-rpc-client.ts)。
5. 上游默认缺少的 `external_directory` 审批、危险命令审批和受保护路径写入阻断，已经由 [../../control-plane/web-ui-bff/src/modules/agent-control/pimono-governance-extension.ts](../../control-plane/web-ui-bff/src/modules/agent-control/pimono-governance-extension.ts) 在本地补齐。
6. 所以今天的判断不应再写成“pi-mono 还只是候选方案”，而应写成“pi-mono 已经是默认 runtime 路径，上游评估结论稳定，当前剩余工作主要是兼容层与文档口径收口”。

## 3. 上游能力盘点

### 3.1 通用 agent loop 能力

根据当前工作区记录的上游评估结论，`pi-mono` 的 `packages/agent` 提供的是通用 agent loop：

1. 支持 message 驱动的 agent 执行循环。
2. 支持 tool call 执行与顺序/并行调度。
3. 支持 tool call 前后 hook，用来做拦截、治理或结果加工。

这说明上游的定位更接近“可嵌入的执行引擎”，而不是“已经带好业务边界的应用服务”。

### 3.2 coding-agent 运行时能力

当前仓库记忆和 provider 接入代码都表明，`packages/coding-agent` 是 OpenerX 实际复用的上游部分。它提供了：

1. coding-agent 场景下的内置工具能力，例如 `bash` 和文件类工具。
2. 基于 `stdin/stdout JSONL` 的 RPC 模式，便于由外部进程托管。
3. extension 机制，允许在 `tool_call` 等阶段插入本地治理逻辑。
4. 会话文件和会话切换能力，能为 crash recovery 和恢复式接管提供基础。

当前工作区对这个入口的接入，最终收敛为 `pi-mono/packages/coding-agent/src/cli.ts` 这条 CLI 路径，并由 provider 在运行时解析 cwd、CLI 路径和附加 extension。

### 3.3 RPC 边界能力

从 [../../control-plane/web-ui-bff/src/modules/agent-control/pimono-rpc-client.ts](../../control-plane/web-ui-bff/src/modules/agent-control/pimono-rpc-client.ts) 可以直接看出，当前 OpenerX 依赖的上游 RPC 能力包括：

1. prompt / steer / follow-up / abort 这类会话控制命令。
2. `new_session`、`switch_session`、`fork` 这类会话生命周期命令。
3. `get_state`、`get_messages`、`get_last_assistant_text` 这类读取命令。
4. `extension_ui_request` / `extension_ui_response` 这类审批与交互桥接协议。

这套接口足以支撑 OpenerX 在 BFF 内实现 provider，但它本身并不承担 task-domain 语义。

## 4. 为什么最佳接法是 BFF provider + RPC 子进程

OpenerX 当前需要的不只是“能跑出一个 assistant 回复”，还需要：

1. 把 runtime session 映射到 task、task session、agent run 和前端读面。
2. 把 tool 事件、assistant 消息和 trace 投影回现有 realtime 聚合层。
3. 把审批、审计、成本和 ledger 接回既有写链。
4. 在多条任务并发、失败恢复、用户审批和页面刷新之后，仍维持稳定的一致性语义。

上游 `pi-mono` 没有直接提供这些业务边界，因此把它当成“现成 HTTP 服务”直接塞进控制面，会把下面这些问题全都留在外层悬空：

1. task/session 身份映射由谁维护。
2. runtime permission 记录由谁生成和持久化。
3. `.env*`、`.git`、`node_modules` 这类路径保护由谁强制执行。
4. execution trace、usage ledger、audit 事件由谁落库和回放。

而使用 “BFF provider + RPC 子进程” 模式时，这些责任边界就很清楚：

1. `pi-mono` 负责执行引擎、会话状态和 RPC 事件。
2. OpenerX BFF 负责会话托管、业务映射、审批治理、审计账本和 realtime 投影。

这也是当前代码已经实际采用的形态。

## 5. 当前工作区里的已落地接入

### 5.1 Provider 主入口

[../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono.ts](../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider-pimono.ts) 已经不是占位骨架，而是完整的 `pi-mono` provider。当前可以直接确认的能力包括：

1. 启动和托管 RPC 子进程。
2. 自动解析默认 CLI 位置，并允许通过 `PI_MONO_RPC_COMMAND`、`PI_MONO_RPC_ARGS`、`PI_MONO_RPC_CWD` 覆盖启动方式。
3. 自动注入 governance extension，并把允许访问的 root 目录下发给 runtime 子进程。
4. 支持 `createSession`、`continueSession`、`runDetachedPrompt`、`pauseAgent`、`resumeAgent`、`terminateAgent`、`forkSession` 和消息读取。
5. 把 `session.created`、`session.status`、`session.updated`、`session.idle`、`message.updated`、`message.part.updated`、`tool.execute.before/after` 这类事件重新映射回当前 BFF realtime 聚合层。
6. 支持基于 session file 的 crash recovery，以及 pause settlement、abort settle 等恢复语义。

### 5.2 RPC 客户端层

[../../control-plane/web-ui-bff/src/modules/agent-control/pimono-rpc-client.ts](../../control-plane/web-ui-bff/src/modules/agent-control/pimono-rpc-client.ts) 明确了当前 provider 对上游的使用方式：

1. 通过子进程 `spawn` 托管 runtime。
2. 通过 JSONL 协议发送 request、接收 response 和 event。
3. 通过 `extension_ui_request` / `extension_ui_response` 把审批需求桥接回 OpenerX。
4. 在进程退出时把错误透传给上层，由 provider 触发恢复和状态修正。

这也进一步说明，上游更像“进程内/进程级 runtime engine”，而不是“OpenerX 外部的服务平台”。

### 5.3 本地治理补丁层

[../../control-plane/web-ui-bff/src/modules/agent-control/pimono-governance-extension.ts](../../control-plane/web-ui-bff/src/modules/agent-control/pimono-governance-extension.ts) 是当前接入判断里最关键的一层，因为它补上了 upstream 默认没有提供的安全治理语义：

1. 文件类工具访问工作区外路径时，会主动发出结构化 `external_directory` 审批。
2. 危险 bash 命令或访问外部绝对路径的命令，会主动发出 `command_execution` 审批。
3. 对 `.env*`、`.git`、`node_modules` 的写入，会直接阻断而不是交给模型继续尝试。
4. 与 provider 配合后，可以支持目录级和命令级 `always` 记忆，避免重复审批。

这层补丁不是“可有可无的小优化”，而是当前把 `pi-mono` 放进 OpenerX 主路径所需的必要治理闭环。

## 6. 已验证事实

### 6.1 Provider 与治理层定向测试

当前工作区已经存在直接覆盖这些能力的定向测试：

1. [../../tests/web-ui-bff/runtime-provider-pimono.test.ts](../../tests/web-ui-bff/runtime-provider-pimono.test.ts) 覆盖 fake RPC roundtrip、session 生命周期、pause/resume、guidance 注入、structured permission 映射、`always` 缓存、会话恢复和 assistant message id 稳定性。
2. [../../tests/web-ui-bff/pimono-governance-extension.test.ts](../../tests/web-ui-bff/pimono-governance-extension.test.ts) 覆盖 `external_directory` 审批、拒绝后阻断、允许根目录内免审，以及危险命令 `command_execution` 审批。
3. [../../tests/web-ui-bff/task-runtime-permissions-route.test.ts](../../tests/web-ui-bff/task-runtime-permissions-route.test.ts) 和 [../../tests/web-ui/TaskDetailV3.test.ts](../../tests/web-ui/TaskDetailV3.test.ts) 证明结构化审批记录可以被当前 BFF 路由和前端页面稳定消费。

### 6.2 Live 主路径验收

当前记录在 [pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md) 中的 live 验收结果表明：

1. `tests/web-ui-bff/identity-binding.test.ts` 已在 `pi-mono` backend 下跑通 15/15，覆盖 execute、assistant roundtrip、tool roundtrip 和 execution trace projection。
2. `tests/web-ui-bff/opencode-completion-sync.test.ts` 已在 `pi-mono` backend 下跑通 4/4，覆盖 pause、guidance、resume 主路径。
3. service task-domain current batch 已复验通过，说明 runtime 事件进入既有 task-domain 写链不再只是推测。
4. 切回旧 `opencode` runtime 后，同一条 live suite 也能复跑通过，说明回退演练已经做过一次，而不是停留在理论层面。

### 6.3 审计、账本与 trace 证据

当前工作区还存在另外一组重要的验证证据：

1. [../../tests/web-ui-bff/runtime-usage-ledger-sync.test.ts](../../tests/web-ui-bff/runtime-usage-ledger-sync.test.ts)、[../../tests/web-ui-bff/judge-usage-accounting.test.ts](../../tests/web-ui-bff/judge-usage-accounting.test.ts) 和 [../../tests/web-ui-bff/realtime-pipeline-events.test.ts](../../tests/web-ui-bff/realtime-pipeline-events.test.ts) 证明 `pi-mono` 路径没有绕开现有 usage、audit 和 ledger 同步链路。
2. [../../tests/web-ui-bff/runtime-message-utils.test.ts](../../tests/web-ui-bff/runtime-message-utils.test.ts) 和 [../../tests/web-ui-bff/task-execution-trace-route.test.ts](../../tests/web-ui-bff/task-execution-trace-route.test.ts) 证明当前已经把 assistant message `info.id` 提升为稳定 traceId，并接回 execution trace 读面。

这意味着今天的真实状态已经不是“provider 跑起来了，但成本/审计/trace 还是空白”，而是“这些链路已经有当前工作区证据”。

## 7. 上游与 OpenerX 的职责切分

| 领域 | 更适合由上游 `pi-mono` 提供 | 必须继续由 OpenerX 负责 |
| --- | --- | --- |
| 执行内核 | agent loop、tool 执行、会话状态、RPC 事件 | task/domain 语义解释与业务生命周期 |
| 会话管理 | session file、session 切换、fork | task、task session、agent run 的身份映射 |
| 审批交互 | `extension_ui_request` 协议承载 | 审批语义定义、路由、持久化、UI 展示和 `always` 策略 |
| 安全治理 | extension hook 扩展点 | 外部目录审批、危险命令审批、受保护路径阻断 |
| 可观测性 | 原始 message / tool / state 事件 | realtime 投影、execution trace、audit、usage ledger |
| 回退恢复 | session file 基础恢复能力 | 失败状态收敛、agent run 状态修正、业务侧补偿 |

这张表本质上解释了为什么 OpenerX 不能把自己退化成“pi-mono 的薄壳代理”。当前真正稳定的架构，是由 OpenerX 明确持有业务语义，再复用 `pi-mono` 作为执行引擎。

## 8. 已知缺口与风险边界

当前还需要明确记录 3 类风险，避免后续文档再次失真：

1. upstream 默认并不会天然给出 OpenerX 想要的 `external_directory` 审批语义。当前闭环依赖本地 governance extension，因此后续升级 upstream 时，必须把 extension hook 和审批映射当成回归重点。
2. RPC 启动方式、CLI 入口位置和 workspace 依赖解析都受 upstream 目录布局影响。后续升级 `pi-mono` checkout 时，必须重新验证 CLI 路径、cwd 解析和启动参数，而不能假定它们永久稳定。
3. 当前剩余问题的重心已经不是“provider 是否成立”，而是旧 OpenCode 兼容假设、canonical schema 和文档口径是否已彻底收口。评估文档与实施文档不能再把这两类问题混为一谈。

## 9. 最终建议

基于当前代码与验证证据，建议保持下面这组判断不变：

1. 继续把 `pi-mono` 视为 OpenerX 当前默认的 runtime backend。
2. 继续坚持 “BFF provider + RPC 子进程” 的接入形态，不要倒退成“把 upstream 当成独立 HTTP 服务直接并入控制面”。
3. 后续任何 upstream 升级，都至少要复验 4 件事：CLI 入口、RPC 事件形状、governance extension 挂接、trace/usage/audit 投影。
4. 文档层面要持续区分两类文件：本文件负责“上游能力评估与接入判断”，[pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md) 负责“当前工作区的落地状态与验收进度”。

只要这个边界不再混淆，runtime 文档就不会再次退化成“结论、原始材料、实现进度全写在一处”的失真状态。
