# Runtime 目标方案索引

> 文档类型：目标方案
> 状态：2026-04-15 建立
> 用途：只回答“未来准备做什么、目标边界是什么、哪些内容还没进入当前代码”

## 1. 当前纳入文档

1. [raw-audit-trace-plan.md](raw-audit-trace-plan.md)

## 2. 目标方案文档清单

1. [target-plan-index.md](target-plan-index.md)：目标方案总入口，负责标记哪些规划文档仍属于未来状态。
2. [raw-audit-trace-plan.md](raw-audit-trace-plan.md)：原始审计流、证据链页面与审计包导出能力的目标方案。

## 3. 文档分工

1. [raw-audit-trace-plan.md](raw-audit-trace-plan.md)：描述原始审计流、证据链页面、审计包导出与对象模型的目标方案；正文前部已经补了“当前实现校准”，但主体仍然是未来设计，不应视为现状说明。

## 4. 使用规则

1. 只要问题是“未来计划怎么做”或“目标产品面长什么样”，才优先看这里。
2. 这里出现的对象模型、页面形态和导出能力，除非在 [current-implementation-index.md](current-implementation-index.md) 对应文档中有现状证据，否则一律按“未落地”处理。
3. 若目标方案与当前实现发生冲突，以当前实现索引和源码为准，再决定是否回写规划文档。

## 5. 排除项

1. [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md)、[pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md) 和 [copilot-auth-credential-guard.md](copilot-auth-credential-guard.md) 不放在这里，因为它们描述的是当前判断、当前实现和当前排障路径。
2. 旧 OpenCode 历史资料与已归档的 [historical-runtime-pipeline-upgrade-plan.md](../archive/runtime/historical-runtime-pipeline-upgrade-plan.md) 统一在 [../archive/runtime/README.md](../archive/runtime/README.md)，它们既不是现状索引，也不是目标方案索引。
