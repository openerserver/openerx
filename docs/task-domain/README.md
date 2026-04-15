# Task Domain 文档目录

> 状态：2026-04-15 首轮整理完成
> 范围：task/session/message/schema/API、session-first 模型、cleanup 与历史兼容边界

## 1. 目录用途

这个目录只放任务域本身的文档，核心边界是：任务这个业务对象在系统里如何建模、如何读写、如何落库、如何通过 service/BFF 暴露出去。

这里重点处理的是：

1. `task` / `session` / `message` / `operation` / `timeline` 的 canonical 边界
2. session-first 模型、schema、DTO 和写链
3. task-domain cleanup、历史兼容层退役与发布验收口径

不放在这里的内容：

1. TaskDetailV3 页面装配与 UI 交互
2. 角色评审 UI、TaskDetail 页面专题
3. 当前 runtime provider 的单独集成说明

## 2. 当前应优先参考的文档

1. [task-domain-cleanup-closure-plan.md](task-domain-cleanup-closure-plan.md)
2. [task-session-message-write-boundary-adr.md](task-session-message-write-boundary-adr.md)
3. [task-session-message-minimal-contract.md](task-session-message-minimal-contract.md)
4. [task-session-message-current-write-path.md](task-session-message-current-write-path.md)
5. [task-session-first-schema-plan.md](task-session-first-schema-plan.md)

## 3. 深入设计与执行文档

1. [task-session-first-execution-plan.md](task-session-first-execution-plan.md)
2. [task-session-five-table-examples.md](task-session-five-table-examples.md)
3. [task-phase-first-schema-api-draft.md](task-phase-first-schema-api-draft.md)
4. [task-tree-data-model-replan.v2-final.md](task-tree-data-model-replan.v2-final.md)
5. [project-tree-storage-design.md](project-tree-storage-design.md)

## 4. Cleanup 与历史兼容材料

1. [task-domain-cleanup-executable-backlog.md](task-domain-cleanup-executable-backlog.md)
2. [task-domain-radical-storage-redesign-plan.md](task-domain-radical-storage-redesign-plan.md)
3. [task-domain-radical-schema-migration-plan.md](task-domain-radical-schema-migration-plan.md)
4. [task-domain-radical-drizzle-schema-draft.md](task-domain-radical-drizzle-schema-draft.md)
5. [task-run-data-end-to-end.md](task-run-data-end-to-end.md)
6. [task-runtime-rewrite-decision-memo.md](task-runtime-rewrite-decision-memo.md)
7. [task-runtime-rewrite-operation-checklist.md](task-runtime-rewrite-operation-checklist.md)
8. [task-runtime-rewrite-phase0-checklist.md](task-runtime-rewrite-phase0-checklist.md)
9. [task-thread-session-workbench-plan.md](task-thread-session-workbench-plan.md)

## 5. 特殊状态说明

当前默认 runtime backend 已切到 `pi-mono`。因此本目录中凡是继续提到 `opencode`、`domain-runs`、旧 `task-branch-*` 读链或已删除 compat 文件的段落，都应优先按“历史兼容语境”理解，而不是当作当前主线代码结构。

本轮已经把一批指向已删除代码文件的错误 markdown 链接降级为历史文本锚点，避免继续误导为“当前可点击实现”。后续如果这些历史说明仍有价值，应继续补成显式的历史注记，而不是重新链接到不存在的文件。

## 6. 一句话边界

如果问题是“task/session/message 在后端现在到底怎么存、怎么写、怎么投影”，看这里；如果问题是“任务详情页现在怎么展示和刷新”，转到 [../task-detail/README.md](../task-detail/README.md)。