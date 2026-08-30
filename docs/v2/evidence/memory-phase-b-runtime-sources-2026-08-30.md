# Memory Phase B 运行时与多来源检查点（2026-08-30）

> 后续进展：确定性冲突替代已在
> [Memory Phase B conflict slot 检查点](memory-phase-b-conflict-supersede-2026-08-30.md) 完成。

## 结论

自动记忆已经接入 App Service 运行时和桌面端控制面。抽取请求使用
`memory-extract:<jobId>` 稳定去重键，权威 usage 由平台服务端记录；按当前服务端直接计费架构，
桌面端不维护额度账本，也不依赖 remaining-percent 信号阻断后台任务。

本切片进一步增加本地多来源证据链接：相同 canonical memory 被另一对话再次确认时会保留两个
来源；删除其中一个来源对话不会误删仍有其他来源支撑的记忆。Settings 可按需加载来源标题并跳转。

## 已实现

- SQLite migration v22 新增 `memory_source_links`，并从既有 MemoryEntry 主要来源回填；
- 自动和显式 upsert 都记录来源链接，canonical 重复自动项合并为同一 MemoryEntry；
- 来源链接合并保留更高置信度，并保持 `explicit > consolidated > automatic` 的来源优先级；
- 删除来源对话时先移除对应链接；存在其他来源则重选主要来源，否则 tombstone 记忆；
- 同步收到 MemoryEntry 时重建其主要来源链接，保证其他设备至少具备主要来源；
- Contracts、App Service、Main/Preload IPC 与 Renderer 已贯通 `memory.sources.list`；
- Settings 来源列表按展开动作加载，支持已删除来源标记和仍存在对话的跳转；
- 个人数据导出增加来源链接元数据，不导出原始对话证据正文；
- 另一对话重复确认已有自动记忆时不会再次产生“新记忆”通知。

## 验证范围

- Contracts：严格 command/result schema 和最多 200 条来源列表；
- Storage：v21→v22 回填、重复来源合并、主要来源重选和最后来源删除；
- App Service：来源查询的 owner 隔离及删除语义；
- Desktop：来源列表按需加载、标题显示和对话跳转；
- Observability：个人数据快照包含来源链接元数据；
- TypeScript、Biome 和 `git diff --check`。

本检查点的五个受影响工程 TypeScript 检查全部通过。Contracts、Storage、App Service 和
Observability 专项共 `7 files / 32 tests` 通过；Desktop 记忆定向回归通过。Desktop
`chat-ui.test.tsx` 整文件另有 3 个与本切片无关的既有 fixture 失败（思考强度选项、Skill 选项和
本地 Web Search runtime 状态未返回），因此不把该整文件记为全绿，也未在本切片修改这些无关功能。

## 保留边界与后续工作

额外来源链接目前是设备本地派生索引，不作为独立云同步对象。现有 `memory_entry` 同步合同仍只携带
主要来源，因此跨设备完整来源图需要后续设计稳定的同步对象 ID、tombstone 和冲突合并语义。

仍待完成：

- 模糊语义冲突聚类及 consolidation（严格 conflict slot 的可撤销 supersede 已完成）；
- 定期 consolidation 调度和失败恢复；
- 跨设备完整多来源同步；
- 真实模型 Golden precision、secret canary、跨账户/崩溃恢复端到端；
- 1,000 条记忆的检索与来源查询延迟基准。
