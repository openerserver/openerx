# Runtime 文档目录

> 文档类型：当前实现
> 状态：2026-04-15 首轮整理完成，已拆分现状索引与目标索引，并补齐全目录类型标记
> 范围：当前 `pi-mono` 运行时集成、认证与治理边界，以及旧 OpenCode 运行时历史资料

## 1. 目录用途

这个目录只放“运行时执行内核”相关文档，核心边界是：OpenerX 如何接入当前 runtime、如何做认证与治理、以及运行时相关的审计透明方案。

当前目录默认以 `pi-mono` 为现行口径，不再把 `opencode` 当作当前实现名。

## 2. 阅读入口

1. [current-implementation-index.md](current-implementation-index.md)：先看这里，确认今天代码里已经落地什么、怎么验、当前主路径是什么。
2. [target-plan-index.md](target-plan-index.md)：再看这里，区分哪些仍是目标方案、哪些还没进当前代码。
3. [../archive/runtime/README.md](../archive/runtime/README.md)：最后看这里，追溯旧 OpenCode runtime 的历史边界与内部资料。

## 3. 文档分类总表

| 文档 | 类型 | 说明 |
| --- | --- | --- |
| [README.md](README.md) | 当前实现 | runtime 目录总入口与边界说明 |
| [current-implementation-index.md](current-implementation-index.md) | 当前实现 | 当前代码事实与验证证据索引 |
| [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md) | 当前实现 | 上游能力评估与接入判断 |
| [pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md) | 当前实现 | 当前工作区实现状态、验收进度与剩余收口项 |
| [copilot-auth-credential-guard.md](copilot-auth-credential-guard.md) | 当前实现 | 当前 Copilot 认证主链、legacy 边界与排障入口 |
| [target-plan-index.md](target-plan-index.md) | 目标方案 | 目标方案文档总入口 |
| [raw-audit-trace-plan.md](raw-audit-trace-plan.md) | 目标方案 | 原始审计流与证据链产品面规划 |
| [../archive/runtime/README.md](../archive/runtime/README.md) | 历史资料 | 旧 OpenCode runtime 历史资料总入口 |

## 4. 特殊说明

1. [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md) 负责说明“上游能力评估与接入判断”；[pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md) 负责说明“当前工作区的实现状态与验收进度”。两者都归入当前实现索引，但分工不同。
2. [copilot-auth-credential-guard.md](copilot-auth-credential-guard.md) 当前已经按代码校准：主入口是 settings OAuth + `copilot-token*.json`，旧 `auth.json` 只保留 legacy 兼容与事故排障价值。
3. [raw-audit-trace-plan.md](raw-audit-trace-plan.md) 仍是目标方案文档；当前代码只落地了 `audit_events`、`/api/audit` / `/api/audit/trace/:traceId` 与少量前端消费，还没有完整的 raw audit trace 页面和导出包。
4. [historical-runtime-pipeline-upgrade-plan.md](../archive/runtime/historical-runtime-pipeline-upgrade-plan.md) 已归入历史资料：它依赖旧 runtime pipeline 设想与当时的执行语境，不再作为现行目标方案入口。
5. 旧 `opencode` 文档与已归档的 runtime pipeline 方案统一收口在 [../archive/runtime/README.md](../archive/runtime/README.md)，只保留历史追溯价值，不再作为当前默认 runtime 说明。
6. 本目录中的“runtime”只指执行内核与其接入治理，不包含 task-domain schema、本地页面装配或产品定价方案。

## 5. 历史资料

旧 OpenCode 相关历史文档与已归档 runtime 方案统一收口在 [../archive/runtime/README.md](../archive/runtime/README.md)，其中包括：

1. [../archive/runtime/historical-opencode-focus-boundary.md](../archive/runtime/historical-opencode-focus-boundary.md)
2. [../archive/runtime/historical-opencode-internals.md](../archive/runtime/historical-opencode-internals.md)
3. [../archive/runtime/historical-opencode-runtime-protocol.md](../archive/runtime/historical-opencode-runtime-protocol.md)
4. [../archive/runtime/historical-opencode-snapshot-ops.md](../archive/runtime/historical-opencode-snapshot-ops.md)
5. [../archive/runtime/historical-runtime-pipeline-upgrade-plan.md](../archive/runtime/historical-runtime-pipeline-upgrade-plan.md)

## 6. 一句话边界

如果问题是“当前 runtime 默认怎么接、怎么验、怎么治理”，先看 [current-implementation-index.md](current-implementation-index.md)；如果问题是“未来审计/产品面准备怎么做”，看 [target-plan-index.md](target-plan-index.md)；如果问题是“旧 OpenCode 以前怎么工作”，看 [../archive/runtime/README.md](../archive/runtime/README.md)。
