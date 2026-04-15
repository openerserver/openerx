# 当前有效文档目录

这个目录用于集中当前已经收敛、仍然作为现行参考依据的文档。

此前这里计划使用符号链接来避免内容漂移，但当前工作区里实际保留的是普通 Markdown 文件，而不是符号链接。因此这里的文档需要单独维护，不能假设会自动跟随原位置同步。

## 当前纳入范围

以下文档已被纳入当前有效文档目录：

- [organization-oriented-agent-operating-model.md](organization-oriented-agent-operating-model.md)
- [organization-oriented-agent-frontend-information-architecture.md](organization-oriented-agent-frontend-information-architecture.md)
- [organization-oriented-agent-technical-checklist.md](organization-oriented-agent-technical-checklist.md)
- [agent-member-model-discussion-summary.md](agent-member-model-discussion-summary.md)
- [member-first-frontend-reimplementation-plan.md](member-first-frontend-reimplementation-plan.md)
- [agent-console-redesign-plan.md](agent-console-redesign-plan.md)
- [current-implementation-functional-overview.md](current-implementation-functional-overview.md)
- [member-first-architecture-design.md](member-first-architecture-design.md)

另外，这个目录当前还保留两份“结构盘点 / 冗余审查”补充文档：

- [all-table-structures.md](all-table-structures.md)
- [table-structure-redundancy-review.md](table-structure-redundancy-review.md)

它们更接近 schema / task-domain 审查材料，不是前台页面主链文档，但目前仍作为当前实现补充参考保留在本目录。

## 纳入标准

这些文档满足以下条件：

- 已经过当前这轮讨论和收敛
- 与当前“成员优先、前后台分层、管理介入替代旧老板层”的方向一致
- 对后续产品、前端、技术清单和页面重写仍有直接参考价值

其中 [current-implementation-functional-overview.md](current-implementation-functional-overview.md) 是一份补充文档，用于描述“当前代码已经真实实现了什么”，方便把目标方案和当前落地现状对照起来看。

[member-first-architecture-design.md](member-first-architecture-design.md) 则用于把目标对象模型、当前实现边界和后续页面重写方向收敛成一份统一架构设计。

## 未纳入文档

以下类型的文档当前不放入本目录：

- 明确标记为历史文档的内容
- 仍大量依赖旧 `boss*` / `Boss*` 心智、且未完成收敛说明的文档
- 早期草案、阶段性草图、已过时的页面草案或旧执行计划

例如：

- [../archive/organization/historical-boss-agent-design.md](../archive/organization/historical-boss-agent-design.md)

它仍保留在原位置作为历史追溯材料，但不视为当前主方案目录的一部分。
