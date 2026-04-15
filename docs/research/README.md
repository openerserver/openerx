# Research 文档目录

> 状态：2026-04-15 首轮整理完成
> 范围：调研、历史对比、路线评估、探索性方案与阶段性分析材料

## 1. 目录用途

这个目录只放调研和探索性质的文档。

这里的材料主要用于保留决策背景、外部对比、历史工作包和阶段性分析，不默认作为当前实现依据。凡是涉及现行架构、现行任务域或现行 runtime 主路径的内容，都应回到对应技术目录再核对一次。

## 2. 当前收录

1. [architecture-review-ppt-outline.md](architecture-review-ppt-outline.md)
2. [oh-my-openagent-comparison-plan.md](oh-my-openagent-comparison-plan.md)
3. [oh-my-openagent-implementation.md](oh-my-openagent-implementation.md)
4. [oh-my-openagent-issue-breakdown.md](oh-my-openagent-issue-breakdown.md)
5. [parallel-judge-selection-plan.md](parallel-judge-selection-plan.md)
6. [skill-auto-optimization-plan.md](skill-auto-optimization-plan.md)

## 3. 阅读边界

1. 这类文档允许保留历史假设、阶段性实现快照或探索结论，但不应再被误读成当前主方案。
2. 如果正文提到当前实现状态，应以它引用的现行架构/任务域文档为准，而不是只信本页历史结论。
3. 后续若某篇文档仍需要长期保留且具有明确归档价值，可继续降级到 `archive/`；若反而被证明已成为现行依据，则应迁回对应功能目录并补状态头。

## 4. 一句话边界

如果问题是“以前怎么想过、和外部方案怎么比、为什么没走某条路”，先看这里；如果问题是“今天系统怎么做”，不要把这里当成最终真值源。