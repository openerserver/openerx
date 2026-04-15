# Runtime 当前实现索引

> 文档类型：当前实现
> 状态：2026-04-15 建立
> 用途：只回答“今天代码里已经有什么、当前主路径是什么、证据在哪里”

## 1. 建议阅读顺序

1. [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md)
2. [pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md)
3. [copilot-auth-credential-guard.md](copilot-auth-credential-guard.md)

## 2. 当前实现文档清单

1. [README.md](README.md)：runtime 目录总入口，负责给出目录边界和全量类型总表。
2. [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md)：上游能力评估与接入判断。
3. [pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md)：当前工作区实现状态、验收进度与剩余收口项。
4. [copilot-auth-credential-guard.md](copilot-auth-credential-guard.md)：当前 Copilot 认证主链、legacy 边界与排障入口。

## 3. 文档分工

1. [pi-mono-upstream-implementation-assessment.md](pi-mono-upstream-implementation-assessment.md)：回答上游 `pi-mono` 到底提供什么、为什么当前最佳接法是 BFF provider + RPC 子进程、哪些职责仍由 OpenerX 持有。
2. [pi-mono-upstream-development-plan.md](pi-mono-upstream-development-plan.md)：回答当前工作区已经实现什么、已经验到什么、还剩哪些兼容层与文档收口项。
3. [copilot-auth-credential-guard.md](copilot-auth-credential-guard.md)：回答当前 GitHub Copilot 认证主链、legacy `auth.json` 的真实边界，以及当前排障入口。

## 4. 使用规则

1. 只要问题是“当前代码里是否已经落地”，优先以这里收录的文档和源码证据为准。
2. 文档里如果同时出现历史事故、回退路径和当前实现，必须按“当前实现优先、历史只作追溯”的顺序阅读。
3. 如果某项能力只有目标方案文档而没有进入这里，默认视为尚未落地，不应当成现状传播。

## 5. 排除项

1. [raw-audit-trace-plan.md](raw-audit-trace-plan.md) 不属于当前实现索引。它描述的是目标产品面和目标对象模型，不是当前代码事实。
2. 旧 OpenCode 历史资料与已归档的 [historical-runtime-pipeline-upgrade-plan.md](../archive/runtime/historical-runtime-pipeline-upgrade-plan.md) 统一在 [../archive/runtime/README.md](../archive/runtime/README.md)，不放入当前实现索引。
