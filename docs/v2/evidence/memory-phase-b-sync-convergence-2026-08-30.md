# Memory Phase B 跨设备槽位收敛检查点（2026-08-30）

## 结论

不同设备离线创建不同 ID、但具有相同 `conflictKey` 的记忆后，所有副本现在会从完整本地对象集
确定性派生同一个 active 值和同一条 supersede 链。结果不依赖云端提交顺序或拉取数组顺序；删除
胜者后，各副本和清空后重建的新副本都会恢复同一个前值。

云同步继续以 MemoryEntry ID 为对象边界。active/superseded 和链指针属于客户端可重建投影，不再把
旧值的派生状态更新当成独立用户写入上传，因此两个设备从同一前序写入时不会争抢前序对象 revision。

## 收敛规则

同类别内，有非空 `conflictKey` 时以严格相同的 slot 为组；没有 slot 时，以严格相同的
`canonicalKey` 为组。每组按以下顺序选主：

1. 已过期项不能成为 active；
2. 显式记忆优先于自动/合并记忆；
3. 有效 `supersedesMemoryId` 关系优先保留用户已经表达的替代顺序；
4. 并发根节点依次按 `updatedAt`、`createdAt` 和 UUID 降序稳定决胜。

剩余项按同一规则形成单链。循环或缺失前序不会阻止收敛，后续 consolidation 仍负责清除无效链接。

## 已实现

- Sync pull 对 strict conflict slot 或 exact canonical 组执行确定性重算，而不是信任远端 payload 的 active 状态；
- 插入前暂时降级同槽新对象，避免触发本地 partial unique index，再在事务内选出最终胜者；
- tombstone 后重算剩余分量，支持跨设备胜者删除和全新缓存重建；
- 精确 canonical 重复同样收敛，且旧显式值不会被更新的自动重复项覆盖；
- 本地新替代值只上传自身；删除只上传 tombstone，不上传派生的前值恢复；
- 用户稍后开启同步时上传所有未删除项，包括 superseded 前序，保证另一设备可完整重建；
- 同一 MemoryEntry ID 的正文并发编辑仍沿用现有可见 revision conflict 与人工 local/cloud 选择。

## 验证范围

- 两种相反 pull 顺序得到相同 active ID 和 supersede 链；
- 两个离线设备从共同前序分别写入新值，云端先收到较新值也不影响最终选主；
- 派生 predecessor 更新不进入 Outbox，因此并发槽位写入没有伪 revision conflict；
- 第三台全新副本以及 clear-cache 后完整重放得到相同结果；
- 删除并发胜者后恢复同一前值；
- explicit canonical 重复优先于时间更新的 automatic 重复；
- 后开启同步会上传 active 与 superseded 的完整非删除链。

相关包回归：Storage `8 files / 52 tests`、App Service `11 files / 55 tests`、Observability
`1 file / 3 tests`、GT-ACCOUNT `1 file / 5 tests` 全部通过；本切片定向回归
`3 files / 22 tests` 通过。

## 保留边界与后续工作

- `updatedAt` 仍受设备时钟影响，但 UUID 终极决胜保证所有副本一致；后续可增加服务端混合逻辑时钟，
  不应改变显式优先和 tombstone 语义；
- 多来源链接仍只有主要来源随 MemoryEntry 同步，完整来源图需要独立稳定 ID 和 tombstone；
- 模糊语义相似但没有严格 key 的记忆不自动合并，仍需真实模型 Golden 和人工确认；
- 仍需 1,000 条记忆性能基准、跨账户/断网/进程崩溃产品 E2E 和发布门禁。
