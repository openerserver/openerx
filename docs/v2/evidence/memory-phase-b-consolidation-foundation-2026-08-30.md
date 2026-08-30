# Memory Phase B 确定性 consolidation 检查点（2026-08-30）

## 结论

记忆库已经具备不依赖模型判断的定期维护闭环。App Service 启动独立调度器；SQLite 持久化每次
运行的触发原因、状态、开始时活跃数、过期删除数、修复数和错误码。应用退出前停止调度，异常退出后
超过 10 分钟的 running 记录会标记失败并重新 claim，避免永久卡住。

此检查点不做相似文本的语义合并。没有严格 `conflictKey` 的记忆不会被后台静默覆盖；这类合并仍需
真实模型 Golden 和人工确认门禁。

## 已实现

- SQLite migration v24 新增 `memory_consolidation_runs`，每账户最多一个 running 任务；
- 默认每小时检查，每 24 小时运行一次；活跃记忆首次跨过 200 条时可提前触发；
- 过期 active/superseded 记忆统一写入 deleted tombstone，并沿现有 Outbox 同步删除；
- 临时替代值过期或撤销时，沿 supersede 链跳过已删除/已过期节点，恢复最近仍有效的前值；
- 清理后修复指向删除项、错误类别/槽位或循环的 supersede 链，并同步修复后的 active 数据；
- 整个清理和运行完成状态处于同一事务；失败不会留下半提交的记忆变更；
- stale run 自动失败恢复，审计历史按账户保留最近 100 次；
- 清除本地缓存会删除运行记录，个人数据 ZIP 导出包含 consolidation 审计元数据。

## 验证范围

- Migration：v23→v24 表、唯一 running 索引；
- Storage：多层过期链、有效前值恢复、断链修复、stale claim 恢复和 24 小时节流；
- App Service：active-limit 与 daily 触发、持久化完成记录和重复 tick 抑制；
- Observability：个人数据快照路径保持兼容；
- 四个受影响工程 TypeScript、Biome 和 `git diff --check`。

相关包回归：Storage `8 files / 49 tests`、App Service `11 files / 55 tests`、Observability
`1 file / 3 tests` 全部通过；consolidation 定向回归 `5 files / 23 tests` 通过。

## 保留边界与后续工作

- consolidation 当前只执行确定性过期和链一致性维护，不做模糊语义聚类或摘要重写；
- active-limit 只在最近完成记录显示上次未超过阈值时提前触发，避免无法缩减的库每小时空跑；
- `memory_consolidation_runs` 是本地运行审计，不作为跨设备同步对象；
- 仍需跨设备并发 conflict slot 收敛、完整来源图同步、真实模型 Golden precision/secret canary、
  以及 1,000 条记忆检索延迟基准。
