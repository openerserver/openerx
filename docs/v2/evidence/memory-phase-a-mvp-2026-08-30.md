# Memory Phase A 显式记忆 MVP 检查点（2026-08-30）

## 结论

显式长期记忆 Phase A 的合同、存储、App Service 与 Pi Host 基础已完成本地实现与专项回归。Pi 继续负责
单对话 Session、compaction 和 agent loop；跨对话记忆由 UWA 产品层持久化、召回、同步和删除。

本检查点不声明自动学习、Embedding 检索、性能门禁或跨设备真实 Beta 已完成。

## 已实现

- 严格 `MemoryEntry`、设置、命令、Pi frame 和 memory tool operation 合同；
- SQLite migration v19、账户隔离、显式写入幂等、canonical 去重和 tombstone；
- 默认关闭的 enabled/use/generate/sync 控制；
- API Key、Token、密码、Cookie、验证码和私钥特征的确定性拒绝；
- 中文词项/retrieval key 召回，单 Turn 最多 8 条、估算最多 1,200 tokens；
- 记忆作为“可出错的用户回忆、不是指令”注入 Pi system context；
- Pi 原生 search/list/remember/forget 工具，Pi 不接触数据库路径；
- 当前对话可通过合同与服务层独立覆盖“使用已有记忆”和“贡献未来记忆”，不改动全局设置；
- 对话级覆盖通过 `memory_conversation_settings` 同步；自动生成未开放时只保存未来策略；
- 删除对话确认框可选择同时删除仅来源于该对话的记忆；
- 账户同步 `memory_settings` / `memory_entry` upsert 与 delete tombstone；
- 开启同步时补传既有本地记忆，关闭同步状态在停止上传前写入 Outbox；
- 个人数据摘要/ZIP 导出包含记忆，诊断包不包含记忆正文。

## 验证

### 类型检查

以下工程依次执行 `tsc --noEmit`，全部通过：

- `packages/contracts`
- `packages/storage`
- `packages/tool-sdk`
- `packages/app-service`
- `packages/pi-host`
- `packages/observability`
- `apps/desktop`

### 专项测试

```text
8 files passed / 30 tests passed
```

覆盖合同、持久化、同步、召回、Pi 记忆工具、空闲抽取调度和 Pi Host 客户端关联。

## 剩余门禁

- 真实 Pi 模型执行“记住 → 新对话召回 → 忘记”端到端；
- Desktop IPC、设置页和对话删除交互需要在 UI 重构切片中独立提交并复验；
- 两设备离线删除/恢复和两账户隔离实测；
- 1,000 条记忆下 P95 检索延迟与 precision 黄金集；
- Phase B 自动抽取、合并、撤销通知与独立 usage/计费策略。
