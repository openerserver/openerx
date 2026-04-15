# Workflow 文档目录

> 状态：2026-04-15 首轮整组迁移完成
> 范围：角色工作流、阶段模板、审批治理、聚合模型、BFF 执行器与 workflow schema / API 设计

## 1. 目录用途

这个目录收口的是 OpenerX 的 workflow 文档簇：它们共同定义角色注册、阶段状态机、审批门控、聚合结论、BFF 执行器以及控制面 schema / route 的协作关系。

这组文档之间交叉引用密集，不适合拆散迁移。现在整组进入 `docs/workflow/` 后，workflow 已经成为独立功能域，而不再散落在根 `docs/`。

## 2. 当前收录

1. [approval-standards-management-plan.md](approval-standards-management-plan.md)
2. [bff-dag-takeover-plan.md](bff-dag-takeover-plan.md)
3. [bff-role-aggregation-executor-design.md](bff-role-aggregation-executor-design.md)
4. [control-plane-role-workflow-schema-routes-draft.md](control-plane-role-workflow-schema-routes-draft.md)
5. [dag-node-execution-plan-v2.md](dag-node-execution-plan-v2.md)
6. [role-agent-registry-design.md](role-agent-registry-design.md)
7. [role-aggregation-conclusion-model.md](role-aggregation-conclusion-model.md)
8. [role-workflow-clarity-redesign-plan.md](role-workflow-clarity-redesign-plan.md)
9. [role-workflow-data-api-design.md](role-workflow-data-api-design.md)
10. [role-workflow-migration-plan.md](role-workflow-migration-plan.md)
11. [workflow-stage-admin-management-plan.md](workflow-stage-admin-management-plan.md)
12. [workflow-template-flexibility-plan.md](workflow-template-flexibility-plan.md)
13. [workflow-template-stage-machine-design.md](workflow-template-stage-machine-design.md)

## 3. 阅读边界

1. 如果问题是“工作流阶段怎么定义、角色如何接入、审批和聚合怎么协同”，优先从这个目录开始读。
2. 如果问题是“当前任务域 public contract 和 trace 读链是什么”，仍应回到 `docs/task-domain/` 与 `docs/architecture/` 的现行入口。
3. organization 相关前台心智、成员模型和页面重构方案现已迁入 `docs/organization/`，需要跨域对照时应从该目录继续阅读。
