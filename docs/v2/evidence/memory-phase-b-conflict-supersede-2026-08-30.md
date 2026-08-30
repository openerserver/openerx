# Memory Phase B conflict slot 检查点（2026-08-30）

## 结论

记忆冲突已有确定性、可撤销的产品语义。MemoryEntry 和自动 candidate 增加可选 `conflictKey`；只有
同账户、同类别、严格相同的 key 才属于互斥值。系统不使用文本相似度静默覆盖记忆。

优先级为：显式用户操作可以替代同槽旧值；新自动值可以替代旧自动/合并值；自动值不能覆盖显式值。
旧值进入 `superseded`，新值通过 `supersedesMemoryId` 指向上一版本。删除新值或删除其唯一来源时，
上一版本恢复为 active。

## 已实现

- Pi Host contract v8，为显式记忆工具和后台抽取 candidate 增加严格的小写 semantic slot；
- SQLite migration v23 增加 `conflict_key` 和每账户/类别/槽唯一 active 索引；
- 显式 upsert 在一个事务中 supersede 旧值并写入新值，避免唯一索引中间态；
- 自动 upsert 可替代自动/合并值，遇到显式冲突时以可识别错误拒绝该 candidate；
- 调度器把显式冲突视为 candidate 级拒绝，不让整项 extraction job 失败；
- 同一抽取批次产生多个同槽值时，只把最终 active 值计入 job 并发送通知；
- 单条删除和“忘记唯一来源”都会恢复 supersede 链中的上一版本；批量清空仍按用户意图删除整条链；
- 同步投影保护本地显式值不被远端自动值覆盖，并在有明确 predecessor 时处理 tombstone 恢复；
- Settings 对替代项显示说明，并把删除动作标为“撤销替代”；
- 个人数据导出包含 `conflictKey`，便于用户理解和迁移数据。

## 验证

六个受影响工程 TypeScript 检查通过。Contracts、Storage、App Service、Pi Host 和 Observability
专项共 `10 files / 50 tests` 通过；Desktop 记忆定向回归 `3 tests` 通过。

覆盖包括：v23 migration、显式替代/撤销、自动替代、显式保护、来源删除恢复、同批次最终值通知、
远端自动值保护、远端显式替代与 tombstone 恢复、Pi contract v8、工具转发、个人数据导出和 UI 提示。

## 保留边界

- `conflictKey` 的质量仍依赖模型或显式工具选择，需要真实模型 Golden 评测；
- 没有严格 key 的相似/矛盾记忆不会自动互相覆盖，后续应先聚类再让用户确认；
- 两台离线设备同时创建不同 ID 的同槽显式值时，云端仍缺少 conflict-slot 级统一仲裁对象；
- 完整多来源图仍只在本地，尚未作为独立同步对象；
- 定期 consolidation 调度、过期清理和 1,000 条延迟基准仍待实现。
