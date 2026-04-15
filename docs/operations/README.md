# Operations 文档目录

> 状态：2026-04-15 首轮整理完成
> 范围：运行说明、迁移边界、验收 runbook、验证基线与操作型清单

## 1. 目录用途

这个目录只放偏“怎么运行、怎么验证、怎么验收、怎么回看迁移基线”的文档。

它面向开发、测试、值班、联调和验收，不负责定义系统的长期架构真值。如果问题是“系统边界应该是什么”，仍要回到对应的架构、runtime、task-domain 或 workflow 文档。

## 2. 当前计划收录

1. [dashboard-provider-token-stats-plan.md](dashboard-provider-token-stats-plan.md)
2. [integration-test-10x-report.md](integration-test-10x-report.md)
3. [multi-task-monitor-api-inventory.md](multi-task-monitor-api-inventory.md)
4. [multi-task-monitor-layout-plan.md](multi-task-monitor-layout-plan.md)
5. [phase1-delivery-plan.md](phase1-delivery-plan.md)
6. [plan-userSystemPhaseOne.prompt.md](plan-userSystemPhaseOne.prompt.md)
7. [postgres-single-process-migration-plan.md](postgres-single-process-migration-plan.md)
8. [user-system-executable-backlog.md](user-system-executable-backlog.md)
9. [user-system-verification-runbook.md](user-system-verification-runbook.md)

## 3. 阅读边界

1. 这类文档可以保留阶段性迁移背景、历史运行拓扑和执行清单，但不应被误读成当前全站架构定义。
2. 如果正文涉及当前 runtime、schema 或接口边界，应以它引用的技术文档为准。
3. 迁移完成后，这里更像“操作面与验收面文档簇”，而不是产品方案或架构方案目录。

## 4. 一句话边界

如果问题是“要怎么启动、怎么验、怎么复盘、怎么按步骤推进”，先看这里；如果问题是“系统现在应该长什么样”，回到技术目录。