# Memory Phase B 空闲抽取基础检查点（2026-08-30）

## 结论

Phase B 的最小安全抽取基础已经完成本地实现：调度器可以从完成事件创建持久化任务，并在空闲门槛后
重新检查全局/对话开关、活跃生成、文本长度、外部上下文和额度阈值，再通过 Pi Host 的无工具内存
Session 生成结构化候选。候选仍需通过产品层 schema、来源、置信度、敏感信息和幂等校验才会落库。
本切片尚未在 App Service 进程启动调度器，因此不会在产品运行时静默触发自动抽取。

此检查点不开放 Settings 中的“自动生成记忆”开关。原因是平台尚未提供后台 usage 独立类型和真实
remaining-percent 信号；在这两个门禁完成前，不允许产品静默消耗用户的平台模型额度。

## 已实现

- Pi Host contract v7：`pi.memory.extract` / `pi.memory.extract-result`；
- `memory_extraction_jobs`：pending/running/completed/skipped/failed、空闲时间、重领和原因；
- `memory_conversation_context`：外部工具上下文布尔标志；
- 默认空闲 30 分钟、至少 2 条完成用户消息、总有效文本不少于 80 字符；
- active generation 延后 5 分钟，10 分钟 stale running 任务可恢复；
- 只发送完成用户消息，不发送 assistant 文本、工具输入、工具结果或原始外部证据；
- Web、MCP、文件、Browser、Desktop、Shell、Skill、Tool Search 等外部工具使用后默认跳过；
- Pi 抽取 Session 不挂载工具、不持久化为产品对话，最多返回 8 条严格 candidate；
- 自动 candidate 最低置信度 0.72，必须引用同一会话内完成的用户 message ID；
- secret、验证码、私钥、银行卡/证件号和绝对路径仍由确定性扫描拒绝；
- 自动记忆使用稳定 job/canonical 幂等键，重复任务不会产生重复 active entry；
- `ongoing_context` 自动项默认 90 天过期；
- 合同与持久化层可预配置外部上下文排除、空闲分钟和最低剩余额度；
- 删除对话会立即清除对应 extraction job/context flag；个人数据导出包含任务和策略元数据。

## 验证

### 类型检查

以下 7 个工程执行 `tsc --noEmit`，全部通过：

- `packages/contracts`
- `packages/storage`
- `packages/tool-sdk`
- `packages/app-service`
- `packages/pi-host`
- `packages/observability`
- `apps/desktop`

### 专项测试

Contracts、Storage、App Service、Pi Host 和 Observability 合并专项：

```text
8 files passed / 30 tests passed
```

覆盖：协议上下界、任务空闲执行、敏感候选拒绝、外部上下文跳过、低余额跳过、自动项撤销、
Pi 无工具抽取、客户端关联、显式记忆回归、同步回归和个人数据导出。

`git diff --check` 无错误，仅有仓库既有的 LF→CRLF 提示。新增独立文件通过 Biome check；重叠的
既有 CRLF 文件仍会触发整文件换行格式建议，没有执行会覆盖用户工作区改动的全文件格式化。

## 未完成门禁

- 平台后台 `memory_extraction` usage 类型、免费/计费策略和独立限流；
- 实际 Codex/平台 remaining-percent 信号接入；
- Settings 自动生成开关解锁与明确成本说明；
- App Service 进程调度器启动、后台执行上下文和 Desktop 设置交互接线；
- 自动新增系统通知和通知内一键撤销；
- 语义冲突合并、多来源证据链接与每日 consolidation；
- 真实模型 Golden precision、secret canary、跨账户与崩溃恢复端到端。
