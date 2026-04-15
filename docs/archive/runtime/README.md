# Runtime 历史资料索引

> 文档类型：历史资料
> 状态：2026-04-15 建立
> 用途：回答“旧 OpenCode runtime 过去怎么工作”以及“哪些 runtime 方案已经归档、不再作为现行目标方案”

## 1. 阅读入口

1. [historical-opencode-focus-boundary.md](historical-opencode-focus-boundary.md)
2. [historical-opencode-internals.md](historical-opencode-internals.md)
3. [historical-opencode-runtime-protocol.md](historical-opencode-runtime-protocol.md)
4. [historical-opencode-snapshot-ops.md](historical-opencode-snapshot-ops.md)
5. [historical-runtime-pipeline-upgrade-plan.md](historical-runtime-pipeline-upgrade-plan.md)

## 2. 历史资料清单

1. [historical-opencode-focus-boundary.md](historical-opencode-focus-boundary.md)：旧 OpenCode 时代的运行时关注边界与职责划分。
2. [historical-opencode-internals.md](historical-opencode-internals.md)：旧 OpenCode runtime 的内部实现结构与组件关系。
3. [historical-opencode-runtime-protocol.md](historical-opencode-runtime-protocol.md)：旧 OpenCode runtime 协议、消息与执行约定。
4. [historical-opencode-snapshot-ops.md](historical-opencode-snapshot-ops.md)：旧 OpenCode snapshot 与运维操作记录。
5. [historical-runtime-pipeline-upgrade-plan.md](historical-runtime-pipeline-upgrade-plan.md)：旧 runtime pipeline 升级设想与分支感知/事件驱动视图方案，现仅保留历史追溯价值。

## 3. 使用规则

1. 这里只保留历史追溯价值，不作为当前实现说明，也不作为未来目标方案。
2. 如果历史文档与当前代码或当前 runtime 文档冲突，以 [../../runtime/current-implementation-index.md](../../runtime/current-implementation-index.md) 和源码为准。
3. 如果问题是“未来准备怎么做”，应回到 [../../runtime/target-plan-index.md](../../runtime/target-plan-index.md)，不要从历史文档外推目标方案。

## 4. 对称入口

1. 当前实现入口： [../../runtime/current-implementation-index.md](../../runtime/current-implementation-index.md)
2. 目标方案入口： [../../runtime/target-plan-index.md](../../runtime/target-plan-index.md)
3. 目录总入口： [../../runtime/README.md](../../runtime/README.md)

## 5. 一句话边界

如果问题是“旧 OpenCode 以前怎么工作”或“哪些 runtime 方案已经归档退出现行规划”，看这里；如果问题是“当前 runtime 默认怎么接、怎么验、怎么治理”，回到 [../../runtime/current-implementation-index.md](../../runtime/current-implementation-index.md)；如果问题是“未来审计/产品面准备怎么做”，看 [../../runtime/target-plan-index.md](../../runtime/target-plan-index.md)。
