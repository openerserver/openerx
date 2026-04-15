# TaskDetail 文档导航索引

> 状态：2026-04-13 当前整理版
> 作者：GitHub Copilot
> 适用范围：TaskDetailV3 现网实现、目标架构与迁移执行文档
> 关联文档：[task-detail-display-write-logic.md](task-detail-display-write-logic.md)、[task-detail-unified-implementation-roadmap.md](task-detail-unified-implementation-roadmap.md)、[task-detail-continue-simplified-migration-checklist.md](task-detail-continue-simplified-migration-checklist.md)

## 1. 文档目的

这份索引页只做一件事：把 TaskDetail 文档按同一套阅读顺序组织起来，避免在“现网实现说明”“未来目标设计”“迁移执行清单”之间来回跳。

标准阅读顺序固定为三层：

1. 先看现网：先确认 TaskDetailV3 今天到底怎么显示、怎么写、怎么刷新。
2. 再看目标：再看未来要收口成什么模块边界、什么 realtime contract、什么状态机。
3. 最后看迁移清单：最后才看具体实施顺序、迁移 checklist 和剩余收口项。

## 2. 推荐阅读顺序

### 2.1 第一层：先看现网

按下面顺序读，先建立“今天代码已经是什么样”的共识。

1. [task-detail-display-write-logic.md](task-detail-display-write-logic.md)
   作用：现网总入口。最适合先看 TaskDetailV3 的页面装配、主聊天 persisted/realtime 协调、用户动作写链、runtime 镜像写链，以及前端 action -> BFF route -> service API -> 表/投影矩阵。
2. [taskdetail-v3-page-dataflow.md](taskdetail-v3-page-dataflow.md)
   作用：现网页面装配视角。适合补齐 page model、main pane、sidebar、conversation、parallel、workflow 的数据流分工。
3. [task-detail-continue-sequence-diagrams.md](task-detail-continue-sequence-diagrams.md)
   作用：现网时序视角。适合确认 single continue、parallel continue、sequential-chain 在当前实现里的真实链路，而不是目标链路。
4. [task-detail-realtime-persisted-coordination-plan.md](task-detail-realtime-persisted-coordination-plan.md)
   作用：现网与目标之间的桥接文档。前半部分解释当前主聊天 persisted/realtime authority 如何切换，后半部分解释还要继续收口的 contract 边界。

### 2.2 第二层：再看目标

确认现网后，再按下面顺序看未来目标，不要反过来读。

1. [task-detail-continue-target-module-architecture.md](task-detail-continue-target-module-architecture.md)
   作用：目标模块蓝图。先看未来 Conversation / Compare / Workflow / Shared / Page Shell 的稳态边界。
2. [task-detail-continue-simplified-design.md](task-detail-continue-simplified-design.md)
   作用：目标 continue 设计。说明主聊天为什么要收口成 single-only 的最小闭环，以及 compare / workflow 为什么应该独立出去。
3. [task-detail-message-state-machine-plan.md](task-detail-message-state-machine-plan.md)
   作用：目标前端状态机。把主聊天 reducer、state slice、patch 规则和 silent reconcile 规则写成目标实现口径。
4. [task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)
   作用：目标 public realtime contract。定义 Web UI 应消费的稳定 task-domain DTO。
5. [task-detail-realtime-broadcaster-mapper-draft.md](task-detail-realtime-broadcaster-mapper-draft.md)
   作用：目标服务端出口设计。说明 service / BFF 内部 source event、mapper、publisher 应怎样承接上面的 public contract。

### 2.3 第三层：最后看迁移清单

只有在前两层都看完之后，再进入这层；否则 checklist 很容易失去上下文。

1. [task-detail-unified-implementation-roadmap.md](task-detail-unified-implementation-roadmap.md)
   作用：执行总入口。说明现在已经做到哪里、下一阶段该按什么顺序继续收口。
2. [task-detail-continue-simplified-migration-checklist.md](task-detail-continue-simplified-migration-checklist.md)
   作用：迁移核对清单。适合在真正改代码或验收 cutover 时逐项勾检。

## 3. 按场景跳转

如果不是完整通读，而是带着具体问题来找资料，可以按下面跳转：

1. 想查“某个页面动作最后写到了哪里”：先看 [task-detail-display-write-logic.md](task-detail-display-write-logic.md)。
2. 想查“当前 continue 为什么会这样工作”：先看 [task-detail-continue-sequence-diagrams.md](task-detail-continue-sequence-diagrams.md)。
3. 想查“为什么主聊天要区分 persisted 和 realtime authority”：先看 [task-detail-realtime-persisted-coordination-plan.md](task-detail-realtime-persisted-coordination-plan.md)。
4. 想查“目标模块以后应该怎么拆”：先看 [task-detail-continue-target-module-architecture.md](task-detail-continue-target-module-architecture.md)。
5. 想查“realtime DTO 最终应该长什么样”：先看 [task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)。
6. 想查“下一步还剩哪些收口项”：先看 [task-detail-unified-implementation-roadmap.md](task-detail-unified-implementation-roadmap.md)。

## 4. 扩展专题

下面两份文档不属于当前主链路说明，也不属于当前迁移主路径，而是 role-review 方向的未来专题草案：

1. [task-detail-role-review-ui-plan.md](task-detail-role-review-ui-plan.md)
   作用：未来 role-review 的产品与页面结构方案。
2. [task-detail-role-review-component-state-draft.md](task-detail-role-review-component-state-draft.md)
   作用：未来 role-review 的组件与状态模型草案。

建议把它们放在主链路文档之后阅读，不要把它们当成 TaskDetailV3 现网实现说明。

## 5. 最小阅读集

如果只想用最短路径建立 TaskDetail 当前认知，最少看这 3 份：

1. [task-detail-display-write-logic.md](task-detail-display-write-logic.md)
2. [task-detail-continue-target-module-architecture.md](task-detail-continue-target-module-architecture.md)
3. [task-detail-unified-implementation-roadmap.md](task-detail-unified-implementation-roadmap.md)

它们分别对应：现网主路径、目标边界、执行顺序。

## 6. 一句话结论

TaskDetail 文档以后默认按这一套顺序阅读：先从现网总览和数据流确认事实，再看目标模块与 contract，最后再进入路线图和迁移 checklist。
