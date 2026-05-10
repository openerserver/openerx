# Architecture 文档目录

> 状态：2026-04-15 首轮整理完成（含核心入口批次）
> 范围：系统边界、架构演进、运行拓扑、ADR 与跨功能域基础设施说明

## 1. 目录用途

这个目录收口的是跨功能域的架构文档：它们不属于某个单一 feature，也不只是运行手册或历史调研，而是用于回答“系统边界是什么、应该怎样演进、哪些约束是全站共享的”。

目前这里已经包含 `Batch R3` 的支撑文档和 `Batch R4` 的三份高入度核心入口，架构相关主文档已不再留在根 `docs/`。

## 2. 当前收录

1. [architecture-overview.md](architecture-overview.md)
2. [api-boundary.md](api-boundary.md)
3. [core-concepts-glossary.md](core-concepts-glossary.md)
4. [architecture-target-evolution.md](architecture-target-evolution.md)
5. [bff-prompt-control-uplift-plan.md](bff-prompt-control-uplift-plan.md)
6. [execution-trace-read-boundary-adr.md](execution-trace-read-boundary-adr.md)
7. [multi-agent-hook-architecture.md](multi-agent-hook-architecture.md)
8. [paid-model-request-guardrail-plan.md](paid-model-request-guardrail-plan.md)
9. [repository-feature-blueprint.md](repository-feature-blueprint.md)
10. [runtime-process-architecture.md](runtime-process-architecture.md)
11. [ai-crowdsourced-development-platform-development-plan.md](ai-crowdsourced-development-platform-development-plan.md)

## 3. 阅读边界

1. 这组文档可以作为架构评审、边界讨论和跨域设计的支撑材料，但不替代当前 runtime、task-domain、task-detail 目录中的实现级现行说明。
2. 如果问题是“今天代码已经怎样落地”，应优先回到对应功能目录 README，再用这里的架构文档补充全局约束。
3. 如果问题是“全站的概念主索引是什么”，现在可以直接从这个目录进入，再按需要跳到 runtime、task-domain、workflow 或 organization 相关目录继续阅读。
