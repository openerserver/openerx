# Task Runtime Rewrite Decision Memo

> 状态：Draft v1  
> 日期：2026-04-04  
> 目标：回答一个决策问题：面对当前任务域、opencode 接入层和大量历史兼容代码，到底应该整仓重写，还是继续在现有实现上删改，还是只重写任务子系统。详细文件动作和数据库建议见 [task-runtime-rewrite-operation-checklist.md](task-runtime-rewrite-operation-checklist.md)。
>
> 运行时口径更新（2026-04-15）：当前默认 runtime 已是 `pi-mono`。本文中继续出现的 `opencode`、旧脚本名和旧 adapter 名，主要用于描述当时的决策背景与待清理兼容层，不代表当前现行 provider 主路径。

## 1. 结论

结论分三层：

1. **不建议整仓完全重写**。
2. **不建议继续在当前任务主链上长期删改**。
3. **建议在现有仓库内，对任务域 + runtime 接入 + BFF 任务聚合层做一次硬切重写**。

这意味着：

1. 仓库、项目容器、权限、审计、外围页面框架继续保留。
2. 任务数据模型、任务读写链、执行追踪、运行时协议适配、实时消息聚合整体重建。
3. opencode 不再作为未来架构的中心约束，pi-mono 通过新的 runtime provider 边界接入。

## 2. 为什么不是继续删改

当前问题不是“代码有点乱”，而是“目标模型已经与现有模型发生结构性冲突”。

### 2.1 核心文件体量已经失控

当前关键文件规模如下：

1. [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) — 7113 行
2. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) — 3474 行
3. control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts — 1399 行
4. [control-plane/service/src/modules/tasks/task-session-read.ts](../../control-plane/service/src/modules/tasks/task-session-read.ts) — 2157 行
5. [control-plane/service/src/modules/tasks/task-domain-projector.ts](../../control-plane/service/src/modules/tasks/task-domain-projector.ts) — 830 行
6. [control-plane/service/src/db/schema.pg.ts](../../control-plane/service/src/db/schema.pg.ts) — 1668 行

仅这些关键文件合计已超过 1.6 万行，而且不是稳定边界，而是高度缠绕的核心链路。

### 2.2 历史兼容层虽在清理，但仍然在拖慢修改

从 [task-domain-legacy-write-retirement-note.md](/memories/repo/task-domain-legacy-write-retirement-note.md) 可以看到，仓库已经连续多轮清理 legacy plan、parallel history、tree content_json fallback、旧消息链和旧 backfill。

这说明两件事：

1. 团队已经在持续做“边删边修”的工作。
2. 即使做了多轮清理，任务主链依然没有收敛到一个足够简单的结构。

换句话说，继续删改不是没有做过，而是已经做了很多次，收益开始明显递减。

### 2.3 目标模型已经不是“修补旧模型”能够自然到达的

当前目标模型在 [docs/task-session-first-schema-plan.md](task-session-first-schema-plan.md) 和 [docs/task-session-first-execution-plan.md](task-session-first-execution-plan.md) 里已经明确：

1. task 是唯一业务聚合根
2. task_sessions 是唯一执行事实
3. messages、operations、artifacts、usage ledger 都应回到 session-first 结构
4. workflow 只保留 bridge metadata
5. branches、domain-runs、compat、run-node、event fallback 应整体下线

而现有生产主链仍然同时承载：

1. service 侧 old run / projection / compat read
2. BFF 侧 task routes 聚合大杂烩
3. realtime 侧 opencode 事件语义、parallel 和 sequential 特殊逻辑
4. web-ui 侧 domain-runs、trace、streaming、winner adoption 的旧约束

这不是“局部优化”能解决的矛盾，而是“模型要换，执行内核也要换”。

### 2.4 opencode 的耦合方式决定了继续删改会反复碰墙

从 [opencode-comprehensive-exploration.md](/memories/repo/opencode-comprehensive-exploration.md) 可以看到，当时接入的 opencode 并不是一个轻量 SDK，而是把以下东西全部压进了任务主链：

1. session lifecycle
2. prompt_async / abort 协议语义
3. SSE 事件流
4. agent run registry
5. prompt 拼接与执行上下文注入
6. 本地文件系统状态与 task graph

这意味着每次改任务域，都要连带触碰 runtime、trace、streaming、parallel、sequential、pipeline、scripts 和测试。

继续删改的结果通常不是“越来越轻”，而是“每删一处就要回补另一处”。

## 3. 为什么也不应该整仓重写

整仓重写的问题不在于做不到，而在于没有必要。

### 3.1 当前真正失控的是任务主链，不是整个平台

当前最明显的复杂度集中在：

1. task schema
2. task read / write / projection
3. BFF task routes
4. realtime ingestion
5. opencode adapter
6. TaskDetailV3 相关读取模型

而不是：

1. 登录和权限
2. 用户与组织管理
3. 审计基础设施
4. 项目级容器与大部分非任务路由
5. 前端整体框架和基础布局

### 3.2 整仓重写会把局部问题放大成平台级迁移

如果整仓重写，你会额外承担以下无效成本：

1. 把认证、项目管理、治理、审计、前端框架一起迁移
2. 失去现有外围稳定面
3. 让“其他功能都保留”变成大范围回归工程
4. 延长真正任务内核重写的交付路径

你现在的问题核心不是“仓库太老”，而是“任务子系统已经不值得继续背历史包袱”。

## 4. 三种方案对比

| 方案 | 优点 | 问题 | 结论 |
| --- | --- | --- | --- |
| 继续在现有任务主链上删改 | 短期表面改动少 | 会持续撞上 compat、fallback、opencode 耦合和超大文件；修改成本继续线性上升 | 不推荐 |
| 整仓完全重写 | 理论上最干净 | 成本最大、回归面最大、与“其他功能保留”目标冲突 | 不推荐 |
| 在现有仓库内硬切重写任务子系统 | 能切掉任务主链历史包袱，同时复用外围稳定面 | 需要明确边界和一次性决心 | 推荐 |

## 5. 推荐的重写边界

### 5.1 应直接重写的范围

以下范围应视为新系统内核，适合直接重写：

1. [control-plane/service/src/db/schema.pg.ts](../../control-plane/service/src/db/schema.pg.ts) 里的任务主表与相关约束
2. [control-plane/service/src/modules/tasks](../../control-plane/service/src/modules/tasks) 整个任务模块
3. [control-plane/web-ui-bff/src/modules/tasks](../../control-plane/web-ui-bff/src/modules/tasks) 整个任务聚合层
4. control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts
5. [control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts](../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts)
6. [control-plane/web-ui-bff/src/modules/realtime/pipeline-events.ts](../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events.ts)
7. [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue) 的任务主交互数据链
8. [control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts](../../control-plane/web-ui/src/composables/useTaskMessageSnapshot.ts) 与 [control-plane/web-ui/src/composables/useTaskMessageStore.ts](../../control-plane/web-ui/src/composables/useTaskMessageStore.ts)
9. [control-plane/web-ui/src/composables/useTaskExecutionTrace.ts](../../control-plane/web-ui/src/composables/useTaskExecutionTrace.ts)
10. 与 opencode 强绑定的脚本与测试，包括 scripts/opencode-capture-global-events.ts、scripts/opencode-cleanup.sh、scripts/opencode-health-check.sh、tests/web-ui-bff/opencode-adapter.test.ts、tests/web-ui-bff/opencode-completion-sync.test.ts

### 5.2 应保留并适配的范围

以下范围更适合保留，并在新任务内核上重新接线：

1. 认证、RBAC、用户与组织管理
2. 项目容器与大部分项目级路由
3. 审计与治理基础设施
4. Web UI 的全局框架、导航、列表壳层
5. project tree 作为导航与信息架构容器的最小能力，主要在 [control-plane/service/src/modules/project-tree/storage.ts](../../control-plane/service/src/modules/project-tree/storage.ts)、[control-plane/service/src/modules/project-tree/task-view.ts](../../control-plane/service/src/modules/project-tree/task-view.ts)、[control-plane/service/src/modules/project-tree/routes.ts](../../control-plane/service/src/modules/project-tree/routes.ts) 里保留桥接，而不是继续承载 task 业务事实
6. workflow 规则域基础入口，例如 [control-plane/service/src/modules/task-workflows/routes.ts](../../control-plane/service/src/modules/task-workflows/routes.ts)，但只保留为 bridge，不再让其绑死任务运行态

### 5.3 应明确删除的范围

以下内容不应再被视为必须兼容的遗产：

1. task run / run node / run edge 语义
2. branches / domain-runs public routes
3. task-session-compat
4. execution trace 中基于旧 event / compat 的 fallback 主链
5. opencode 作为未来稳定协议的前提

## 6. 建议的 3 到 6 周实施路径

### 6.1 三周版本：最小可切换路径

适用于目标非常集中，只要求先跑通任务主链。

#### 六周版 Week 1

1. 冻结 Phase 0 产品能力，基于 [docs/task-runtime-rewrite-phase0-checklist.md](task-runtime-rewrite-phase0-checklist.md)
2. 冻结新的 runtime provider contract
3. 冻结 task/session/message/operation/artifact/usage 的目标 schema
4. 新建 fresh migration 与 fresh bootstrap

#### 六周版 Week 2

1. service 侧切新 schema
2. service 侧切新写链和新读链
3. BFF 侧引入新的 runtime provider 接口与 pi-mono stub
4. 删掉 opencode adapter 主链和 compat 主链

#### 六周版 Week 3

1. 重接 TaskDetailV3 主链
2. 跑通 single / parallel / sequential-chain 三种模式的 execute、terminate、continue
3. 跑通输入可见、上下文可见、final sent 可见、streaming 可见
4. 做一次性切换与清理

### 6.2 六周版本：更稳妥的子系统重写路径

适用于希望把治理、usage、workflow bridge 和测试门禁一起收口。

#### Week 1

1. 冻结产品能力清单
2. 冻结 runtime provider contract
3. 冻结 service public contract

#### Week 2

1. 新 schema 与 migration
2. task write APIs
3. task snapshots / timeline views 设计

#### Week 3

1. task read / projection / execution trace 重写
2. adopt winner contract 落地
3. usage ledger 与 artifacts 接回新模型

#### Week 4

1. BFF task routes 重写
2. realtime ingestion 重写
3. pi-mono provider 落地

#### Week 5

1. TaskDetailV3、消息链、execution trace、parallel compare、sequential chain 前端重接
2. 单测、契约测试、集成测试替换

#### Week 6

1. scripts、systemd、health-check 切到 pi-mono
2. grep 清理旧概念
3. 做最终切换与回归

## 7. 启动条件

要让这条路径成立，必须同时满足以下条件：

1. 接受旧任务数据不迁移或仅离线备份
2. 接受任务子系统中途阶段性不可运行
3. 接受前端和 BFF 契约为新模型服务，不为旧模型兜底
4. 接受 opencode 不再是未来实现边界，而只是被替换掉的旧 runtime

如果以上四条有任何一条不成立，就不应选择硬切重写，而应回到更保守的渐进迁移方案。

## 8. 一句话决策

当前项目最合理的路线不是“继续修旧链路”，也不是“把整个仓库推倒重来”，而是：

**保留现有仓库和外围稳定面，直接重写任务子系统，并用新的 runtime provider 边界接 pi-mono。**
