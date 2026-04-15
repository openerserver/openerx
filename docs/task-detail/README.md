# Task Detail 文档目录

> 状态：2026-04-15 首轮整理完成
> 范围：TaskDetailV3 当前实现、目标设计、迁移执行与历史草案

## 1. 目录用途

这个目录只放任务详情页相关文档，核心边界是：页面如何展示、如何实时更新、如何执行 continue / compare / workflow 的前端与聚合层协作。

不放在这里的内容：

1. task/session/message/schema 的 canonical 后端边界
2. task-domain cleanup、schema 改造、session-first 存储设计
3. runtime provider 替换与 pi-mono 接入细节

这些内容统一在 [../task-domain/README.md](../task-domain/README.md) 或后续 `runtime/` 目录维护。

## 2. 推荐阅读顺序

### 2.1 当前实现

1. [task-detail-navigation-index.md](task-detail-navigation-index.md)
2. [task-detail-display-write-logic.md](task-detail-display-write-logic.md)
3. [taskdetail-v3-page-dataflow.md](taskdetail-v3-page-dataflow.md)
4. [task-detail-continue-sequence-diagrams.md](task-detail-continue-sequence-diagrams.md)
5. [task-page-session-message-display-guide.md](task-page-session-message-display-guide.md)

### 2.2 目标设计

1. [task-detail-continue-target-module-architecture.md](task-detail-continue-target-module-architecture.md)
2. [task-detail-continue-simplified-design.md](task-detail-continue-simplified-design.md)
3. [task-detail-message-state-machine-plan.md](task-detail-message-state-machine-plan.md)
4. [task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)
5. [task-detail-realtime-broadcaster-mapper-draft.md](task-detail-realtime-broadcaster-mapper-draft.md)

### 2.3 迁移执行

1. [task-detail-unified-implementation-roadmap.md](task-detail-unified-implementation-roadmap.md)
2. [task-detail-continue-simplified-migration-checklist.md](task-detail-continue-simplified-migration-checklist.md)

## 3. 特殊状态说明

下面三份文档属于 future target draft，不应被当成现网说明：

1. [task-detail-role-review-ui-plan.md](task-detail-role-review-ui-plan.md)
2. [task-detail-role-review-component-state-draft.md](task-detail-role-review-component-state-draft.md)
3. [task-detail-realtime-broadcaster-mapper-draft.md](task-detail-realtime-broadcaster-mapper-draft.md)

另外，`continue` 相关迁移文档中仍会保留一批已经删除的 coordinator 文件名。这些名字现在只作为历史切口锚点，不再代表当前真实模块布局。

## 4. 历史文档

已确认过时的任务详情页 / 工作台历史方案统一归档到：

1. [../archive/task-detail/README.md](../archive/task-detail/README.md)
2. [../archive/task-detail/historical-new-task-detail-page-plan.md](../archive/task-detail/historical-new-task-detail-page-plan.md)
3. [../archive/task-detail/historical-task-workbench-frontend-simplification-plan.md](../archive/task-detail/historical-task-workbench-frontend-simplification-plan.md)

## 5. 一句话边界

如果问题是“任务详情页今天怎么工作、以后怎么拆”，看这里；如果问题是“task/session/message 这个业务对象在后端怎么建模和落库”，转到 [../task-domain/README.md](../task-domain/README.md)。
