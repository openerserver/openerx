# Task Runtime Rewrite Phase 0 Checklist

> 状态：Draft v1  
> 日期：2026-04-04  
> 目标：把“任务域完全重写 + runtime 从 opencode 切到 pi-mono”之前，必须保留的产品能力写成开发和验收都能直接使用的清单。

## 1. 文档目的

这份文档不讨论底层表结构，也不讨论 runtime 协议实现细节。

它只回答一个问题：

在任务域和 runtime 全部重写之后，哪些用户能力必须原样保留，哪些表达必须统一，哪些旧操作应当明确下线。

这份清单是 Phase 0 的阻塞输入。

如果后续 schema、BFF 或前端方案与本文冲突，以本文定义的产品能力为准。

## 2. 硬约束

### 2.1 执行模式必须保留三种

系统必须保留以下三种执行模式：

1. `single`：单步执行
2. `parallel`：并行比较
3. `sequential-chain`：串行执行

这三种模式都是一等产品能力，不允许只保留其中一部分。

### 2.2 用户操作只保留三种

任务详情主交互只保留以下三种操作：

1. 执行
2. 终止
3. 继续

这里的“只保留三种操作”指的是任务执行主路径的公共动作集合。

以下动作不再作为与上述三者并列的通用运行操作暴露：

1. 暂停
2. 恢复
3. 手动 fork
4. 手动激活 branch
5. 手动归档 branch

并行模式下的“选择更好的结果”仍然必须保留，但它不是第四个通用动词，而是“继续”之前的模式内决策动作。

### 2.3 模型交互必须可见

无论是哪种执行模式，用户都必须能看到至少以下三层信息：

1. 用户原始输入
2. 系统合成的上下文信息
3. 最后实际发送给模型的内容

如果系统对 prompt 做了模板拼接、阶段注入、候选结果注入或 judge 包装，这些变化不能只存在于内部日志里，必须通过任务详情或执行追踪可见。

### 2.4 模型回复必须流式显示

在模型生成回复期间，任务详情必须显示流式中的 assistant 内容，而不是只能在消息落库完成后一次性出现最终结果。

## 3. 保留能力总表

| 能力 | single | parallel | sequential-chain | 说明 |
| --- | --- | --- | --- | --- |
| 执行前选择模式 | 必须 | 必须 | 必须 | 用户在执行前明确选择模式 |
| 执行 | 必须 | 必须 | 必须 | 统一入口 |
| 终止 | 必须 | 必须 | 必须 | 统一入口，终止当前任务运行态 |
| 继续 | 必须 | 必须 | 必须 | 统一入口，向当前可继续目标发送新输入 |
| 查看用户原始输入 | 必须 | 必须 | 必须 | 包括初始 prompt 和继续输入 |
| 查看系统合成上下文 | 必须 | 必须 | 必须 | 包括执行上下文、阶段上下文、候选结果注入 |
| 查看最终发送文本 | 必须 | 必须 | 必须 | 必须能与原始输入区分 |
| 查看流式回复 | 必须 | 必须 | 必须 | assistant 增量更新 |
| 查看最终回复 | 必须 | 必须 | 必须 | 流式完成后的稳定结果 |
| 结果比较 | 可选 | 必须 | 可选 | parallel 模式核心能力 |
| 选择最佳结果后继续 | 不适用 | 必须 | 不适用 | 选择结果后继续必须成立 |
| 查看阶段间上下文传递 | 不适用 | 可选 | 必须 | sequential-chain 核心能力 |

## 4. 三种执行模式的保留语义

### 4.1 单步执行

单步执行是最基本模式，目标是围绕一个活动 session 完成一次任务处理。

必须保留的用户体验：

1. 用户点击“执行”后，创建一次执行。
2. 用户能看到原始输入、系统追加的执行上下文、最终发送文本。
3. assistant 回复过程中有流式内容。
4. 任务完成后可继续补充新输入。
5. 用户随时可以终止当前运行。

单步执行下，“继续”必须始终指向当前活动 session，而不是隐式创建额外的分支概念。

### 4.2 并行比较

并行模式的目标不是同时跑多个 session 这么简单，而是让用户完成“比较 -> 选择 -> 继续”这一整条决策链。

必须保留的用户体验：

1. 用户点击“执行”后，系统启动多个候选执行。
2. 每个候选都能展示自己的模型、状态、回复内容和流式过程。
3. 用户能并排比较候选结果，而不是只能看一个 winner 摘要。
4. 用户必须能明确选择一个更好的结果作为后续继续的目标。
5. 选择完成后，后续“继续”必须只作用于被选中的候选上下文。
6. 若用户终止任务，所有仍在运行的候选都应停止。

并行模式下的保留重点不是“自动 judge”本身，而是“用户能看到候选差异并做选择”。

judge 可以保留，但只能作为比较辅助，不得替代用户最终选择。

### 4.3 串行执行

串行模式的目标是把多步执行保持为一条连续工作链，同时让用户看到每一步如何承接前一步结果。

必须保留的用户体验：

1. 用户点击“执行”后，系统按步骤推进。
2. 用户能看到当前处于哪一步。
3. 用户能看到系统如何把前一步结果注入后一步上下文。
4. 每一步实际发送给模型的内容都应可见，而不是只显示步骤名称。
5. 当前步骤回复时要有流式显示。
6. 用户点击“继续”时，系统必须明确把新的用户输入附着到当前串行上下文，而不是丢失已完成步骤信息。
7. 用户点击“终止”时，整条串行链停止，而不是只停止当前 step 的表面状态。

## 5. 模型交互可见性要求

### 5.1 最低可见链路

任务详情或执行追踪必须能够稳定表达以下链路：

1. `user-input`：用户原始输入
2. `system-context`：系统合成的上下文信息
3. `final-sent`：最终送给模型的完整文本
4. `assistant-stream`：流式中的模型输出
5. `assistant-final`：最终稳定输出

如果某次执行没有显式的 `system-context`，也必须能明确说明“本次没有额外注入上下文”，而不是让用户无法判断。

### 5.2 可见性规则

以下规则必须在三种模式中统一成立：

1. 原始用户输入不能被最终 prompt 覆盖。
2. 系统上下文不能只以内嵌字符串混在最终 prompt 里而不可区分。
3. 最终发送文本必须以完整文本形式可读，而不是只给摘要。
4. 流式输出必须能区分“进行中”和“已完成”。
5. 若系统补造 synthetic 消息用于回放，也必须在数据模型里标明来源。

### 5.3 并行与串行下的额外可见性

并行模式必须额外可见：

1. 每个候选各自收到的最终发送文本
2. 每个候选的流式输出
3. 候选之间的结果差异

串行模式必须额外可见：

1. 当前步骤的阶段上下文
2. 已完成步骤产出如何注入后续步骤
3. 当前步骤最终发送文本

## 6. 三种操作的产品定义

### 6.1 执行

“执行”是从静止态进入运行态的唯一入口。

它必须支持：

1. 以 single、parallel、sequential-chain 三种模式启动
2. 在启动前确认本次使用的模式和必要参数
3. 执行后立即进入可观测状态，而不是等最终完成后再展示结果

### 6.2 终止

“终止”是停止当前任务运行态的唯一停止动作。

它必须支持：

1. single 下停止当前执行
2. parallel 下停止全部仍在运行的候选
3. sequential-chain 下停止整条链

它不应拆成 pause、abort、stop candidate、archive branch 等多个用户动作。

### 6.3 继续

“继续”是把新的人类输入送回当前任务上下文的唯一入口。

它必须支持：

1. single 下继续当前活动 session
2. parallel 下继续当前被选择的 winner 上下文
3. sequential-chain 下继续当前串行链上下文

如果系统要求先选 winner 才能继续，那么“选择 winner”应被视为继续前的模式内前置条件，而不是新的主操作。

## 7. 明确下线或降级的旧能力

以下能力即使当前仓库中存在，也不属于这次重写后的 Phase 0 保留目标：

1. 暂停 / 恢复作为任务主界面的公共操作
2. 手动 fork 作为任务主界面的公共操作
3. branch 激活 / 归档作为任务主界面的公共操作
4. 以 runtime 内部 run / node / edge 语义直接暴露给用户
5. 只能看到最终结果、看不到输入构造过程的黑盒执行方式

## 8. 当前实现锚点

以下文件是当前仓库里与本清单最直接相关的实现锚点，后续重写时必须逐个对照：

1. [control-plane/web-ui/src/components/ExecutionModeModal.vue](control-plane/web-ui/src/components/ExecutionModeModal.vue) — 三种执行模式入口
2. [control-plane/web-ui/src/pages/TaskDetailV3.vue](control-plane/web-ui/src/pages/TaskDetailV3.vue) — 任务详情主交互，当前仍暴露 fork 等额外动作
3. [control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts](control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts) 与 [control-plane/web-ui/src/composables/useTaskMessageStore.ts](control-plane/web-ui/src/composables/useTaskMessageStore.ts) — 会话消息快照与流式 assistant 归并
4. [control-plane/web-ui/src/composables/useTaskExecutionTrace.ts](control-plane/web-ui/src/composables/useTaskExecutionTrace.ts) — final prompt / latest response 的 synthetic fallback
5. [control-plane/web-ui/src/lib/message-normalize.ts](control-plane/web-ui/src/lib/message-normalize.ts) — userInputText / finalSentText / streaming message 的前端结构承接位
6. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) — realtime delta、prompt decomposition、parallel/sequential 协调核心
7. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](control-plane/web-ui-bff/src/modules/tasks/routes.ts) — execute / continue / adopt / trace / sessions 聚合入口
8. [tests/web-ui-bff/task-execution-trace-route.test.ts](tests/web-ui-bff/task-execution-trace-route.test.ts) — execution trace 契约基线
9. [tests/web-ui-bff/realtime-pipeline-events.test.ts](tests/web-ui-bff/realtime-pipeline-events.test.ts) — 流式消息、parallel、sequential 的实时事件基线
10. [tests/web-ui-bff/task-completion-routes.test.ts](tests/web-ui-bff/task-completion-routes.test.ts) — 并行选择 winner 的行为基线

## 9. Phase 0 验收标准

Phase 0 完成时，至少需要形成以下明确结论：

1. 三种执行模式都在保留范围内，没有被降级成“后续再说”。
2. 任务主交互只剩执行、终止、继续三种公共动作。
3. 并行模式下“比较 -> 选择 -> 继续”的链路被明确定义。
4. 三种模式下的用户输入、系统上下文、最终发送文本都被列为必须可见。
5. 流式输出被列为必须能力，而不是体验增强项。
6. fork、pause、resume、branch 管理等旧动作被明确标为不保留主路径。
7. 后续 schema、BFF、Web UI 方案都必须能映射到这份清单。
