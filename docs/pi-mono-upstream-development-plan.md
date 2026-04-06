# pi-mono Upstream Development Plan

> 日期：2026-04-05
> 目标：在保留 OpenerX 控制面与任务域语义的前提下，用 pi-mono 替换当前 OpenCode runtime 执行内核。
> 相关评估： [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md)

## 1. 文档目的

这份文档不再把“代码已经落地”和“整链路已经验收”混在一起。

从今天开始，进度按两条状态线记录：

- 已实现：代码已经进入当前工作树，且可以在源码或定向测试里找到直接证据。
- 已验收：已经完成当前范围内可重复的验证，可以作为阶段性完成依据。

这里的“已验收”不等于“已经可以默认切流量”。如果验收范围只是 provider 专项测试或 BFF mock 回归，会在备注里明确写出边界。

## 2. 当前结论

截至 2026-04-05，当前状态应表述为：

1. pi-mono 接入已经不只是骨架，BFF 侧主路径能力已经落地。
2. `pauseAgent` / `resumeAgent`、guidance 注入、runtime permission bridge、crash recovery、pause settlement 等第一版语义已经实现，不应再标为“未完成”。
3. 默认 backend 仍然是 `opencode`，pi-mono 仍处于显式环境变量切换的 opt-in 状态。
4. BFF 兼容层和 pi-mono provider 专项测试已经通过，当前 BFF mock batch 22 为全绿；service task-domain current batch 也已在当前工作区复验通过。
5. 当前工作区已经拿到一条真实 pi-mono backend live roundtrip 验收主路径：以 `OPENERX_RUNTIME_BACKEND=pi-mono` 启动 BFF 后，live control-plane + live BFF 下执行 `RUN_EXECUTION_INTEGRATION=1 bun test ../../tests/web-ui-bff/identity-binding.test.ts --timeout 240000`，结果为 15/15 通过，覆盖 execute、assistant roundtrip、tool roundtrip 与 execution trace projection。
6. 默认 `opencode` backend 的回滚演练也已完成：恢复默认 BFF + OpenCode runtime 后，复跑同一条 live suite，结果同样为 15/15 通过。当前剩余未收口项已经收缩到审批/白名单语义缺口、治理桥接、成本与审计链路，而不再是 assistant/tool/trace/rollback 或 pause-resume 基础链路。
7. 在将 upstream checkout 从 `tmp/pi-mono-upstream` 迁移到根目录 `pi-mono/` 并更新 BFF 默认 RPC cwd 之后，已再次复跑 live execute 与 live completion-sync；`identity-binding.test.ts` 结果仍为 15/15 通过，`opencode-completion-sync.test.ts` 结果仍为 4/4 通过，说明目录收编没有打断当前 pi-mono 主链路。

因此，当前更准确的判断不是“pi-mono 改动未做完”，而是：

- 实现层：已经进入可试跑状态。
- 验收层：还不能宣布默认可切换。

## 3. 当前代码事实

已确认事实如下：

1. pi-mono 适合作为进程级 runtime engine，不适合作为现成 HTTP runtime service 直接接入。
2. BFF 侧 runtime-provider 抽象已经落地，OpenCode 仍然是默认 backend。
3. pi-mono provider 当前已实现 `createSession`、`continueSession`、`runDetachedPrompt`、`pauseAgent`、`injectGuidance`、`resumeAgent`、`terminateAgent`、`getSessionMessages`、`getAgentMessages`、`listSessions`、`listRuntimePermissions`、`replyRuntimePermission` 和 `forkSession`。
4. pi-mono 会话已接入现有 agent-run registry，并把 `session.created`、`session.status`、`session.updated`、`session.idle`、`message.updated`、`message.part.updated`、`tool.execute.before/after` 映射回当前 BFF realtime 聚合层。
5. pi-mono provider 已落第一版恢复语义，包括 pause settlement 等待、abort 未 settle 时回滚状态、runtime permission 请求桥接，以及子进程 crash 后基于 session file 的恢复与 resume。
6. BFF `run-persistence` 已重新接回 service 侧 task run 写路由，agent run 的 create/patch 状态事实不再只停留在 BFF 内存。
7. service `task-session-message-write-api` 已补齐 top-level `part` 规范化，tool 事件通过现有消息写链即可落到 `task_messages` / `task_message_parts`，并同步物化到 `taskOperations` / `task_artifacts`。
8. 当前工作区里，BFF mock batch 22 已通过，service task-domain current batch 也已通过，task-domain 基础写链不再停留在“未复验”状态。
9. 本轮 live 验收中，当前本机 GitHub 模型认证上下文可用，`identity-binding.test.ts` 已在 pi-mono-backed BFF 下跑通；后续如果出现 `Please reauthenticate`、403 或无授权头，仍应先按认证故障处理，而不是先归因为 pi-mono runtime 回归。
10. 本轮真实验收的边界是“execute 路由成功启动真实 pi-mono session，并完成 task identity fallback patch”；它还没有覆盖 assistant 最终回复、tool result 回流和 trace 读面断言。

## 4. 分阶段状态

### Phase 0：上游评估与接入边界梳理

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| 完成 pi-mono 上游实现评估 | 是 | 是 | 已形成接入判断 |
| 确认推荐接法为 `BFF provider + pi-mono RPC 子进程` | 是 | 是 | 结论稳定 |
| 梳理当前 BFF runtime 接入点与 OpenCode adapter 消费面 | 是 | 是 | 已进入后续代码重构 |

### Phase 1：BFF runtime-provider 抽象落地

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| runtime provider 类型定义 | 是 | 是 | 代码已落地 |
| OpenCode provider 封装 | 是 | 是 | 当前默认路径 |
| pi-mono provider 文件与主入口接入 | 是 | 是 | 代码已落地 |
| backend 选择逻辑（`OPENERX_RUNTIME_BACKEND` / `OPENERX_RUNTIME_PROVIDER` / `RUNTIME_BACKEND` / `RUNTIME_PROVIDER`） | 是 | 是 | 有定向测试覆盖 |
| 默认 backend 保持为 `opencode` | 是 | 是 | 仍未切默认 |
| BFF 消费方改为依赖 runtime-provider | 是 | 是 | 当前 BFF mock 回归通过 |

### Phase 2：BFF 兼容性修复与基础验证

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| runtime-provider 基础测试覆盖 | 是 | 是 | 已进入当前测试集 |
| adapter mock 形状修复 | 是 | 是 | Bun 混跑稳定 |
| execution-trace 相关 contract 修复 | 是 | 是 | BFF mock batch 22 通过 |
| realtime pipeline snapshot contract 修复 | 是 | 是 | BFF mock batch 22 通过 |
| 批量脚本中的失效测试引用清理 | 是 | 是 | 当前批量脚本可执行 |

### Phase 3：pi-mono provider 能力落地

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| RPC 子进程托管层 | 是 | 是 | provider 专项测试覆盖 fake RPC roundtrip |
| `stdin/stdout JSONL` 命令发送与事件读取 | 是 | 是 | provider 专项测试通过 |
| `createSession` | 是 | 是 | provider 专项测试通过 |
| `continueSession` | 是 | 是 | provider 专项测试通过 |
| `runDetachedPrompt` | 是 | 是 | provider 专项测试通过 |
| `pauseAgent` / `resumeAgent` | 是 | 是 | provider 专项测试通过；此前文档这里已过期 |
| guidance 注入 | 是 | 是 | provider 专项测试通过 |
| runtime permission bridge | 是 | 是 | provider 专项测试通过；当前只桥接上游主动发出的 `extension_ui_request`，不等于已经具备 OpenCode 式 `external_directory` 审批语义 |
| 错误、超时、abort settle、子进程 crash 恢复的第一版语义 | 是 | 是 | 仅说明第一版已落地，真实环境仍需复验 |
| `terminateAgent` | 是 | 是 | provider 专项测试通过 |
| `getSessionMessages` / `getAgentMessages` / `listSessions` / `forkSession` | 是 | 是 | provider 专项测试通过 |
| pi-mono session 与 task session 的最小映射规则 | 是 | 是 | 复用 `agentRunRegistry` |

说明：这里的“已验收”范围是 provider 专项测试与 BFF mock 回归，不代表已经完成当前工作区的真实 pi-mono backend 端到端验收。

### Phase 4：task-domain 基础写链与 realtime bridge

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| BFF realtime 聚合层的 session/message/tool 基础事件映射 | 是 | 是 | BFF mock batch 22 通过 |
| BFF `createAgentRunRecord` / `patchAgentRunRecord` 回写 service task run 写路由 | 是 | 是 | BFF mock 回归与 service current batch 已通过 |
| service task 模块注册 agent-run create/patch 写路由 | 是 | 是 | service current batch 已通过 |
| `task_messages` | 是 | 是 | service current batch 已通过 |
| `task_message_parts` | 是 | 是 | service current batch 已通过 |
| `taskOperations` | 是 | 是 | service current batch 已通过 |
| `task_artifacts` | 是 | 是 | service current batch 已通过 |

说明：这一层现在已经不再卡在“service 全批次未复验”。剩余问题不在 task-domain 基础写链是否存在，而在 live pi-mono execute 结果是否已经被更高层读面和治理链路完整消费。

### Phase 5：治理、读面与存储重写

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| `beforeToolCall` / `afterToolCall` 策略桥接 | 否 | 否 | 尚未接回 |
| 命令白名单与路径保护 | 否 | 否 | 尚未接回 |
| 审批流与人工确认语义 | 否 | 否 | runtime permission bridge 不等于完整审批流 |
| 使用量统计、审计、账本与 trace id | 否 | 否 | 尚未按 pi-mono 路径收口 |
| 明确哪些内容回给模型、哪些只落库 | 否 | 否 | 尚未收口 |
| 新的 task/session/message canonical schema 收口 | 否 | 否 | 尚未收口 |
| runtime 写入路径去除旧 OpenCode 语义假设 | 否 | 否 | 尚未完成 |
| execution trace / session message / timeline 读面按 pi-mono backend 保真 | 否 | 否 | 尚未完成整链路验收 |
| 历史数据迁移与 backfill | 否 | 否 | 尚未开始 |
| 灰度切换、双写或分阶段 cutover 策略 | 否 | 否 | 尚未收口 |

### Phase 6：切换与最终验收

| 项目 | 已实现 | 已验收 | 备注 |
| --- | --- | --- | --- |
| pi-mono backend 的端到端回归用例 | 是 | 是 | live `identity-binding.test.ts` 已覆盖 execute、assistant、tool、trace |
| 当前工作区的真实 pi-mono backend roundtrip 复验 | 是 | 是 | live control-plane + live BFF 下已完成 assistant/tool/trace roundtrip |
| 成本、审计、审批链路验证 | 否 | 否 | 尚未完成 |
| 回滚路径与回退演练 | 是 | 是 | 默认 `opencode` backend 下已复跑同一条 live suite |
| 默认 backend 切到 pi-mono | 否 | 否 | 当前默认仍是 `opencode` |

## 5. 已实现但未验收完成的关键项

下面这些最容易被误判为“已经完成”，需要单独列出来：

1. `pauseAgent` / `resumeAgent` / guidance 已不只是 provider 专项测试：当前工作区已在 pi-mono-backed BFF 下复用 live completion-sync 用例完成真实 pause/guidance/resume 串联验证。当前未闭合的不是 pause/resume，而是审批型 runtime permission 语义是否与默认 backend 对齐。
2. task-domain 基础写链现在已经在当前工作区复验通过，live pi-mono execute 的 assistant 最终回复、tool result 和 trace 读面也已经一起验到位；剩余未验收项主要转移到 permission / pause-resume 与治理桥接。
3. pi-mono runtime permission bridge 已实现，但它不能替代完整审批流、路径保护、白名单和审计桥接；当前 live `/tmp/...` 外部文件读取还验证到一个更具体的差距：上游 `packages/coding-agent/src/core/tools/read.ts` 会直接 resolve 并读取绝对路径，不会自动发出 `external_directory` 审批请求，因此 BFF 这层不会出现对应 runtime permission 记录。
4. 默认切换与成本治理仍然没有完成收口；回滚路径本身已经完成一次默认 `opencode` backend 演练，但这仍不等于“默认可切”。

## 6. 本轮真实验收结果

本轮已经完成的真实验收如下：

1. 启动 live control-plane service。
2. 以 `OPENERX_RUNTIME_BACKEND=pi-mono`、`TEST_EXECUTION_MODEL=github-copilot:gpt-5-mini`、`PI_MONO_RPC_CWD=pi-mono/packages/coding-agent` 启动 live BFF。
3. 执行 `cd control-plane/web-ui-bff && RUN_EXECUTION_INTEGRATION=1 bun test ../../tests/web-ui-bff/identity-binding.test.ts --timeout 240000`。
4. 在 pi-mono-backed BFF 下结果为 15/15 通过，确认了登录、凭据创建、任务创建、`POST /api/tasks/:taskId/execute` 启动真实 pi-mono session，以及 live assistant roundtrip、tool roundtrip、execution trace projection 读面。
5. 执行 `bash scripts/run-service-task-domain-current-batch.sh`，结果为 total=20 failed=0，当前工作区的 service task-domain 基础读写回归已复验通过。
6. 关闭 pi-mono BFF，恢复默认 `opencode` BFF + OpenCode runtime 后，复跑同一条 live suite，结果同样为 15/15 通过，完成一次可重复的回滚演练。
7. 复用 live completion-sync 套件在当前 pi-mono-backed BFF 下验证 pause/guidance/resume，结果为 4/4 通过，说明 pause-resume 主路径已经拿到真实环境证据。
8. 手工创建任务并强制 `read` `/tmp/...` 外部文件时，任务会直接完成并返回文件首行，`/api/tasks/:taskId/runtime-permissions` 始终为空；结合 task trace 与上游源码可确认，当前缺口不是 BFF task/session 过滤，而是 pi-mono upstream 现状并不会为这类 read 自动发起审批事件。
9. 在 checkout 迁移到根目录 `pi-mono/` 后，以上两条 live 验收已重新执行：`identity-binding.test.ts` 仍为 15/15 通过，`opencode-completion-sync.test.ts` 仍为 4/4 通过，说明 execute、assistant、tool、trace、pause、guidance、resume 与 terminate 在新目录布局下保持稳定。

这轮验收带来的状态变化是：

- “只能靠 mock / fake RPC 证明”的阶段已经过去。
- “task-domain 基础写链未复验”这条阻塞项已经清掉。
- 剩余差距已经收缩为审批型 runtime permission 语义、治理桥接、审批白名单和成本审计链路。

## 7. 剩余差距可执行清单

下面这些是从“已实现”走到“已验收完成”还剩下的最小可执行清单，按顺序做即可：

1. 明确并收口审批型 runtime permission 的实现归属：当前 pause-resume 已 live 通过，但 pi-mono upstream 现状不会为 `read` 外部绝对路径自动发出 `external_directory` 审批事件；如果默认切换要求与 OpenCode 保持同等审批 UX，需要在 upstream、tool wrapper 或 OpenerX 自身治理层补齐这一层语义，而不是继续把问题归因为 BFF 路由过滤。
2. 接回 `beforeToolCall` / `afterToolCall` 策略桥接、命令白名单与路径保护，确认 pi-mono 路径下的治理边界与默认 backend 一致。
3. 补 usage、审计、账本、trace id 等治理链路验证，确认 pi-mono 路径下不会丢失成本与审计事实。
4. 收口 canonical schema / 历史 backfill / 旧 OpenCode 语义假设清理，避免默认切换后仍被兼容层拖住。
5. 在以上 1-4 完成后，再讨论是否把默认 backend 从 `opencode` 切到 `pi-mono`。

## 8. 第一阶段完成标准

### 第一阶段“实现完成”标准

当下面条件全部满足时，可以认为“pi-mono 接入第一阶段实现完成”：

- [x] BFF runtime-provider 抽象已落地。
- [x] pi-mono provider 主路径能力已落地。
- [x] `pauseAgent` / `resumeAgent` / guidance / runtime permission / crash recovery 第一版语义已落地。
- [x] pi-mono session 已能复用现有 realtime 聚合链，把 session/message/tool 基础事件映射回 BFF。
- [x] task-domain 基础写链已经打通到当前代码路径。
- [x] OpenCode 仍保留为默认与回退 backend。

### 第一阶段“验收完成”标准

当下面条件全部满足时，才能认为“pi-mono 接入第一阶段验收完成”：

- [x] 通过环境变量切到 `pi-mono` backend 后，BFF 能在当前工作区成功创建一次真实会话。
- [x] 当前 `pi-mono` provider 路径下 GitHub 模型调用链路可用；若后续失效，再补一次重新认证并复验。
- [x] 能完成一次最小 prompt roundtrip，并拿到 assistant 文本回复。
- [x] tool call 与 tool result 能稳定回流到 BFF。
- [x] execution trace 与 session message 读面不因 backend 切换而失真。
- [x] service task-domain current batch 与相关读写回归在当前工作区通过。
- [x] 至少有一组可重复执行的 pi-mono backend 集成验证脚本覆盖该链路。
- [x] 回滚路径已经明确并完成至少一次演练。

## 9. 备注

1. 当前文档的重点不是“所有事项是否做完”，而是避免再把“代码已实现”和“整链路已验收”写成同一个状态。
2. 后续如果要继续推进默认切换，建议再补一份更细的实施文档，至少拆出 provider 内部模块拆分、RPC 协议映射表、事件到 task-domain 写模型的映射规则，以及灰度切换与回滚方案。
