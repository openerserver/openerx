# Historical: docs 目录功能化整理与失真内容清理方案

> 状态：historical
> 日期：2026-04-15
> 历史注记：本文保留的是 `docs/` 首轮功能化整理的执行计划与进度记录。该轮根目录清理已完成，`docs/` 根目录当前仅保留 [../README.md](../README.md) 作为总导航页；本文现仅用于追溯整理过程，不再作为当前控制文件。
>
> 进度更新（2026-04-15）：`task-detail/` 与 `task-domain/` 已完成首轮物理拆分，相关文档已从根 `docs/` 迁入对应功能目录；根目录重复历史稿 `new-task-detail-page-plan.md` 已删除，仅保留 [task-detail/historical-new-task-detail-page-plan.md](task-detail/historical-new-task-detail-page-plan.md)。本轮也已同步收口这两个功能域内部的本地 markdown 链接，并把一批已删除代码文件的错误链接降级为历史文本锚点。
>
> 进度更新（2026-04-15）：`runtime/` 与 `archive/runtime/` 已完成首轮拆分。当前 `pi-mono` 主路径文档已迁入 [../runtime/README.md](../runtime/README.md) 所在目录；旧 `opencode-*` 文档已迁入 `archive/runtime/` 并按历史资料处理。
>
> 进度更新（2026-04-15）：`product/` 与 `research/` 已完成 `Batch R1` 首轮物理拆分。根 `docs/` 下的低耦合商业/对外表达文档与调研/历史对比文档已迁入对应目录，并同步收口了到 root、runtime、archive 与源码路径的相对链接。
>
> 进度更新（2026-04-15）：`operations/` 已完成 `Batch R2` 首轮物理拆分。运行说明、验收 runbook、用户系统执行清单和迁移边界文档已迁入 `docs/operations/`，并同步收口了对 root、runtime、archive、tests 与源码路径的相对链接。
>
> 进度更新（2026-04-15）：`architecture/` 已完成 `Batch R3` 支撑文档首轮拆分。架构演进、运行拓扑、execution trace ADR、Hook 架构、repository 蓝图和付费治理方案等支撑文档已迁入 `docs/architecture/`，并同步收口了目录内外对 root、runtime、operations、tests 与源码路径的相对链接。
>
> 进度更新（2026-04-15）：`architecture/` 已完成 `Batch R4` 核心入口批次。`architecture-overview.md`、`api-boundary.md`、`core-concepts-glossary.md` 已迁入 `docs/architecture/`，并同步收口了根目录、各功能子目录以及 architecture 目录内部对这三份入口文档的相对链接。至此，architecture 功能域已完成首轮整体拆分。
>
> 进度更新（2026-04-15）：`workflow/` 已完成 `Batch R5` 整组迁移。角色工作流、阶段模板、审批治理、聚合模型、BFF 执行器和控制面 workflow schema / API 草案等 13 篇高耦合文档已整体迁入 `docs/workflow/`，并同步收口了根目录、各功能子目录以及 workflow 目录内部的相对链接。
>
> 进度更新（2026-04-15）：`organization/` 已完成首轮整组迁移。organization-oriented-agent、member-first、agent console、成员模型与 project role execution 相关文档已整体迁入 `docs/organization/`，并同步收口了根目录、各功能子目录、`current/` 与 `archive/organization/` 对这批文档的相对链接。
>
> 进度更新（2026-04-15）：`runtime-pipeline-upgrade-plan.md` 已进一步从 `docs/runtime/` 迁入 [runtime/historical-runtime-pipeline-upgrade-plan.md](runtime/historical-runtime-pipeline-upgrade-plan.md)。该文档继续保留 runtime / task-domain 主路径的现状校准，但因主体依赖旧 runtime pipeline 设想与历史执行语境，现改按历史资料处理，不再作为 runtime 目标方案入口。
>
> 进度更新（2026-04-15）：`task-workbench-frontend-simplification-plan.md` 已迁入 [task-detail/historical-task-workbench-frontend-simplification-plan.md](task-detail/historical-task-workbench-frontend-simplification-plan.md)。根因是这份方案建立在旧 `TaskDetail.vue` / `TaskDetail.test.ts` 主锚点之上，而当前任务详情主路径已经切到 `TaskDetailV3`；因此现改按 task-detail 历史资料处理，不再作为当前 workbench / task-detail 改造依据。

## 1. 现状问题

当前 docs 目录的主要问题不是“文档数量多”，而是“文档的组织方式和代码演进方式不一致”。

现状可以归纳为四点：

1. 根目录同时混放了架构文档、功能方案、产品文案、汇报材料、运行手册和阶段性草案，阅读入口依赖文件名记忆，而不是功能边界。
2. `docs/current/` 已经被定义成“当前有效文档目录”，但目前只对 organization/member-first 相关内容收口，`task-detail`、`task-domain`、`workflow`、`runtime` 等高变更域此前仍散落在根目录。
3. `docs/archive/` 已经存在多组历史分区，但同主题文档仍经常同时存在于根目录、`current/` 和 `archive/` 三处，状态边界不清晰。
4. 很多文档通过文件名表达状态，例如 `plan`、`draft`、`roadmap`、`checklist`、`replan`，但正文缺少统一的“当前是否有效、最后一次按代码核验时间、对应代码锚点”说明，因此在代码继续重构后容易失真。

当前盘点到的自然文档簇，已经能看出哪些功能域最需要先收口：

1. `task-detail*`
2. `task-session*`
3. `organization-oriented-agent*`
4. `task-domain*`
5. `opencode*` / `pi-mono*`
6. `role-workflow*`

这说明目前最严重的问题不在单篇文档，而在同一功能域下有多份平行方案同时存在。

## 2. 根因

文档与代码脱节的根因有四个：

1. 文档按讨论轮次、作者命名习惯和阶段性产物累积，而不是按功能域和责任边界组织。
2. 缺少统一的文档状态口径，导致“当前事实”“未来目标”“历史方案”混排在一起。
3. 文档缺少固定的代码锚点和核验时间，代码改了，文档不会自动暴露为过期。
4. `current/` 和 `archive/` 的机制已经建立，但只在局部主题上使用，未推广到整个 docs。

## 3. 整理目标

整理后的 docs 目录应满足以下目标：

1. 顶层目录只表达功能域，不表达作者习惯或阶段名称。
2. 当时建议 `docs/current/` 继续作为“当前有效文档入口”，只收纳已经核验过的现行文档，并优先考虑采用符号链接方式避免副本漂移；后续实际落地改为保留普通 Markdown 文件。
3. `docs/archive/` 只保存历史文档，按功能域归档，不再把历史文档和现行文档混放在根目录。
4. 每篇保留为现行依据的文档都要补齐统一头信息，至少包含：`状态`、`范围`、`最后核验日期`、`代码锚点`、`替代/被替代关系`。
5. 根目录最终只保留目录说明、整理计划、以及极少数全局索引文档；绝大多数主题文档都进入功能分区。

## 4. 目标目录结构

建议整理为下面这套结构：

```text
docs/
  README.md
  current/
  archive/
  architecture/
  task-detail/
  task-domain/
  workflow/
  organization/
  runtime/
  product/
  operations/
  research/
```

各目录职责如下：

1. `architecture/`：系统分层、边界、ADR、总体架构、核心概念。
2. `task-detail/`：任务详情页、会话展示、realtime、页面装配与交互边界。
3. `task-domain/`：任务域本身的后端语义与数据边界，包括 task/session/message/round/schema/API/task tree/task runtime 写路径；它解决的是“任务这个业务对象在系统里如何建模、如何读写、如何落库”，而不是某个页面如何展示。
4. `workflow/`：workflow、role workflow、stage machine、DAG 执行相关设计。
5. `organization/`：organization-oriented-agent、member-first、agent console、组织与成员模型。
6. `runtime/`：当前 `pi-mono` 运行时集成、runtime 协议、治理扩展、上游评估，以及旧 OpenCode 相关历史资料的归档入口。这里用 `runtime` 而不是 `opencode`，因为当前执行内核已经切到 `pi-mono`，目录名不应继续绑定被替代的旧实现。
7. `product/`：产品定位与对外表达材料，主要给产品、运营、销售、管理沟通使用，而不是给研发确定代码真相。典型内容包括商业模式、收费、官网文案、版本包装、销售与融资材料。
8. `operations/`：偏“怎么运行、怎么验证、怎么排障”的操作型文档，给开发、测试、值班和验收使用。典型内容包括运行手册、验收报告、验证 runbook、监控和运维方案。
9. `research/`：调研和探索型文档，主要保存对外比较、路线评估、阶段性分析和未纳入主方案的探索结论。它的作用不是充当当前实现依据，而是保留决策背景和备选方案。

## 5. 首轮迁移映射

第一轮不追求一次性把所有文件摆到完美位置，而是先把最明显的功能边界固定下来。

| 功能域 | 目标目录 | 首批纳入文档示例 | 备注 |
| --- | --- | --- | --- |
| 架构与边界 | `docs/architecture/` | `architecture-overview.md`、`architecture-target-evolution.md`、`api-boundary.md`、`core-concepts-glossary.md`、`execution-trace-read-boundary-adr.md`、`runtime-process-architecture.md`、`repository-feature-blueprint.md` | 这组文档是跨功能域基础设施，不应和 feature 方案混放 |
| Task Detail | `docs/task-detail/` | `task-detail-*.md`、`taskdetail-v3-page-dataflow.md`、`task-page-session-message-display-guide.md` | 当前已完成首轮迁移和链接收口 |
| Task Domain | `docs/task-domain/` | `task-domain-*.md`、`task-session-*.md`、`task-phase-first-schema-api-draft.md`、`task-tree-data-model-replan.v2-final.md`、`task-run-data-end-to-end.md`、`project-tree-storage-design.md` | 当前已完成首轮迁移和链接收口 |
| Workflow | `docs/workflow/` | `workflow-template-*.md`、`workflow-stage-admin-management-plan.md`、`role-workflow-*.md`、`dag-node-execution-plan-v2.md`、`bff-dag-takeover-plan.md` | 需要和当前 workflow display policy、steps/actions 口径对齐 |
| Organization | `docs/organization/` | `organization-oriented-agent-*.md`、`member-first-*.md`、`agent-console-*.md`、`agent-member-model-discussion-summary.md`、`development-role-agents-plan.md`、`project-role-execution-redesign-plan.md` | 现有 `docs/current/` 已在这个域里先行实践 |
| Runtime 集成 | `docs/runtime/` | `pi-mono-*.md`、`copilot-auth-credential-guard.md`、`raw-audit-trace-plan.md`、`archive/runtime/historical-opencode-*.md` | 当前已完成首轮迁移；现行口径以 `pi-mono` 为主，旧 `opencode-*` 文档已转为历史资料 |
| 产品与商业 | `docs/product/` | `business-model-analysis.md`、`product-tiering-and-pricing-plan.md`、`website-*.md`、`version-page-copy-and-comparison-draft.md`、`sales-messaging-and-packaging-plan.md`、`fundraising-and-exec-ppt-outline.md` | 应从工程主路径中分离 |
| 运行与验证 | `docs/operations/` | `integration-test-10x-report.md`、`user-system-verification-runbook.md`、`dashboard-provider-token-stats-plan.md` | 这类文档强调操作性和验收结果 |
| 调研与评估 | `docs/research/` | `oh-my-openagent-*.md`、`parallel-judge-selection-plan.md`、`architecture-review-ppt-outline.md` | 暂时不作为当前功能实现依据 |

## 6. 文档状态口径

为避免再次出现“看标题猜状态”，建议所有保留在现行路径中的文档统一使用以下口径：

1. `current`：已按当前代码核验，可作为现行依据。
2. `draft`：仍是目标设计，尚未完全落地，正文必须明确哪些部分尚未实现。
3. `candidate`：主题仍有价值，但尚未完成核验，不应直接作为现行依据。
4. `historical`：已被替代，只保留追溯价值，应放入 `archive/`。

建议补充统一头部模板：

```md
> 状态：current | draft | candidate | historical
> 范围：task-detail / task-domain / workflow / runtime / ...
> 最后核验：2026-04-15
> 代码锚点：...
> 替代关系：...
```

## 7. 错误内容清理策略

“与当前代码不符”的内容，不能只靠人工通读判断，必须按固定核验维度执行。每篇文档至少检查以下四类事实：

1. 文档中提到的模块、composable、组件、route、service API 是否仍然存在。
2. 文档中的事件名、DTO 名、表名、字段名、状态机阶段名是否仍与当前代码一致。
3. 文档对“当前阶段状态”的描述，是否仍和当前页面结构、目录布局、测试基线一致。
4. 文档是否把“未来目标”写成了“现状事实”，或者把“历史兼容逻辑”写成了“当前主路径”。

不一致内容按下面规则处理：

1. 如果功能已落地但表述过期，直接改写正文并补上代码锚点。
2. 如果文档仍有参考价值但多数结论尚未落地，降级为 `draft` 或 `candidate`。
3. 如果文档已被更晚的文档替代，迁入 `archive/`，并在现行文档里给出替代链接。

## 8. 首批高优先级清理批次

### 8.1 Batch A: Task Detail 文档簇

这是第一优先级，原因有三个：

1. 文档数量最多，且围绕同一页面有大量平行方案。
2. 当前代码仍在快速演进，漂移风险最高。
3. 现有代码已经形成较清晰的 feature 边界，适合先按代码回收文档。

### 8.2 Batch B: Task Domain / Session / Schema 文档簇

这一批要解决的是“接口、schema、写路径说明”与 service/BFF 实际实现的偏差。

### 8.3 Batch C: Runtime 文档簇

这一批要解决的是“当前 `pi-mono` 主路径”和“旧 OpenCode 历史语境”之间的混写问题。当前已经完成目录拆分，但仍需继续清理 runtime 文档中的旧实现假设、异常原始资料和跨文档术语漂移。

### 8.4 Batch D: Workflow 文档簇

这一批重点核验 workflow 与 role-workflow 是否仍沿用旧展示心智，尤其是状态展示、阶段名和页面职责边界。

### 8.5 Batch E: Organization / Member-First 文档簇

这个域此前只在 `docs/current/` 有初步收口；本轮已经完成 `docs/organization/` 的物理迁移。后续主要任务从“是否迁移”转为统一头信息、补代码锚点和校正文档正文失真。

### 8.6 Batch F: Product / Operations / Research 文档簇

这些文档对工程主链路的重要性低于前三批，先完成目录分离，再决定是否细修正文。

## 9. 实施顺序

建议按下面顺序执行，避免一边搬运一边继续制造新漂移：

1. 先创建目标功能目录和 docs 根 README，明确目录职责。
2. 再移动文件，但第一轮只做“非破坏性重排”，不同时大改正文。
3. 移动后立即做相对链接收口，尤其检查 `current/`、`archive/` 与源码相对路径。
4. 再按批次执行内容核验和正文修订。
5. 每完成一个功能域，就把经过核验的文档接入 `docs/current/`。

### 9.1 根 `docs/` 剩余文件拟迁移批次

下面这组批次只针对“当前仍留在根 `docs/` 的一级 Markdown 文件”。原则不是先搬“最重要”的，而是先搬“最不容易断链、最不容易把当前实现依据搬散”的文件。

#### Batch R1: Product / Research 低耦合批次（最安全，优先先搬）

这批文件的共同特点是：

1. 主要承担对外表达、商业判断、阶段性对比或调研结论，不是工程主链的当前真值源。
2. 即使文件移动，影响通常也局限在文档内部链接，不会立刻干扰“当前实现怎么做”的阅读入口。
3. 很多内容本身已经带有 draft / historical / discussion 性质，最适合先做物理归档，再决定是否细修正文。

建议先搬到 `docs/product/`：

1. `business-model-analysis.md`
2. `fundraising-and-exec-ppt-outline.md`
3. `high-level-decision-summary.md`
4. `model-paid-settings-replan.md`
5. `product-tiering-and-pricing-plan.md`
6. `project-list-overview-redesign.md`
7. `sales-messaging-and-packaging-plan.md`
8. `version-page-copy-and-comparison-draft.md`
9. `website-copy-and-version-page-plan.md`
10. `website-homepage-copy-draft.md`

建议同批或紧接着搬到 `docs/research/`：

1. `architecture-review-ppt-outline.md`
2. `oh-my-openagent-comparison-plan.md`
3. `oh-my-openagent-implementation.md`
4. `oh-my-openagent-issue-breakdown.md`
5. `parallel-judge-selection-plan.md`
6. `skill-auto-optimization-plan.md`

#### Batch R2: Operations 操作与验收批次（较安全，第二批）

这批文件的共同特点是：

1. 文档目标偏“怎么运行、怎么验证、怎么验收”，适合集中迁到 `docs/operations/`。
2. 与代码真实实现有关，但多数不是跨全站的基础边界文档。
3. 需要更新的主要是相对链接和少量历史口径，不必在搬运时同时重构整套概念模型。

建议搬到 `docs/operations/`：

1. `dashboard-provider-token-stats-plan.md`
2. `integration-test-10x-report.md`
3. `multi-task-monitor-api-inventory.md`
4. `multi-task-monitor-layout-plan.md`
5. `phase1-delivery-plan.md`
6. `plan-userSystemPhaseOne.prompt.md`
7. `postgres-single-process-migration-plan.md`
8. `user-system-executable-backlog.md`
9. `user-system-verification-runbook.md`

说明：`phase1-delivery-plan.md` 与 `postgres-single-process-migration-plan.md` 虽然涉及系统边界，但正文职责更接近迁移/运行说明，而不是 today architecture single source of truth，因此仍建议放在 `operations/`。

#### Batch R3: Architecture 支撑文档批次（中等风险，第三批）

这批文件已经开始接近“当前实现依据”，但还不是根目录里最核心的总入口。适合在 Product / Research / Operations 稳定后，作为独立一批迁入 `docs/architecture/`。

建议先搬：

1. `architecture-target-evolution.md`
2. `bff-prompt-control-uplift-plan.md`
3. `execution-trace-read-boundary-adr.md`
4. `multi-agent-hook-architecture.md`
5. `paid-model-request-guardrail-plan.md`
6. `repository-feature-blueprint.md`
7. `runtime-process-architecture.md`

说明：这批文档经常被实现文档引用，但它们彼此之间的聚合度仍低于 `architecture-overview.md` / `api-boundary.md` / `core-concepts-glossary.md` 这三份根级总入口，因此应先搬“支撑文档”，再搬“总入口”。

#### Batch R4: Architecture 核心入口批次（高风险，第四批）

这批文件是全站阅读入口和概念主索引，链接入度最高，也最容易在搬运时影响其他目录的相对引用。因此不建议一开始就动。

建议作为一整批搬到 `docs/architecture/`：

1. `api-boundary.md`
2. `architecture-overview.md`
3. `core-concepts-glossary.md`

说明：这三份文档最好在 `docs/architecture/README.md` 或根 `docs/README.md` 已就位后再统一搬迁，并同步回收跨目录入口链接。

#### Batch R5: Workflow 文档簇整组迁移（风险最高，最后搬）

这批文件最不适合拆散单搬，原因有三个：

1. 文档之间互相引用密集，角色注册、阶段模板、聚合模型、BFF 执行器、审批治理本来就是一个设计簇。
2. 一部分文件与 `docs/current/` 下的 organization 文档、以及根目录中的管理页/角色执行方案交叉很深。
3. 如果只搬其中几篇，最容易制造“目录已经分了，但事实源更分散”的新问题。

建议整组搬到 `docs/workflow/`：

1. `approval-standards-management-plan.md`
2. `bff-dag-takeover-plan.md`
3. `bff-role-aggregation-executor-design.md`
4. `control-plane-role-workflow-schema-routes-draft.md`
5. `dag-node-execution-plan-v2.md`
6. `role-agent-registry-design.md`
7. `role-aggregation-conclusion-model.md`
8. `role-workflow-clarity-redesign-plan.md`
9. `role-workflow-data-api-design.md`
10. `role-workflow-migration-plan.md`
11. `workflow-stage-admin-management-plan.md`
12. `workflow-template-flexibility-plan.md`
13. `workflow-template-stage-machine-design.md`

#### 9.2 暂不纳入这五个批次的根目录文件

以下文件不建议硬塞进 `architecture / workflow / product / operations / research`，应保持现状或另入其他功能目录：

1. `documentation-reorganization-and-cleanup-plan.md`：后续已归档为 [historical-documentation-reorganization-and-cleanup-plan.md](historical-documentation-reorganization-and-cleanup-plan.md)，不再保留在根 `docs/`。
2. `organization-oriented-agent-*.md`、`agent-console-redesign-plan.md`、`agent-member-model-discussion-summary.md`、`development-role-agents-plan.md`、`member-first-frontend-reimplementation-plan.md`、`project-role-execution-redesign-plan.md`：已迁入 `docs/organization/`，不再保留在根 `docs/`。
3. `runtime-pipeline-upgrade-plan.md`：已迁入 `docs/archive/runtime/`，并按历史资料处理，不再保留在根 `docs/` 或 runtime 目标方案索引中。
4. `task-workbench-frontend-simplification-plan.md`：已迁入 [task-detail/historical-task-workbench-frontend-simplification-plan.md](task-detail/historical-task-workbench-frontend-simplification-plan.md)，并按历史资料处理，不再保留在根 `docs/`。

#### 9.3 推荐搬迁顺序

如果目标是“先把最安全的文件搬走，再处理高耦合目录”，建议执行顺序固定为：

1. `Batch R1`：Product + Research
2. `Batch R2`：Operations
3. `Batch R3`：Architecture 支撑文档
4. `Batch R4`：Architecture 核心入口
5. `Batch R5`：Workflow 整组迁移

这样做的好处是：

1. 先清掉低耦合文档，根目录会立刻变薄，但不会破坏当前工程真值入口。
2. 给后续 `architecture/` 和 `workflow/` 迁移留出稳定窗口，避免同时改太多跨文档相对链接。
3. 最后再动高引用、高耦合的核心入口文档，回归成本最低。

## 10. 验收标准

整理完成后，应满足下面的结果：

1. 根 `docs/` 不再是平铺式文档仓库，而是以功能域为主的入口目录。
2. 每篇现行文档都能明确回答“它是不是当前有效文档”。
3. 同一功能域不再存在多篇互相覆盖但状态未说明的平行方案。
4. 文档中不再把已删除的模块、旧 route、旧状态机、旧 DTO 当作当前事实。
5. `docs/current/` 能作为“当前有效文档入口”稳定使用。
6. 相对链接在 root、`current/`、`archive/` 三层都能正确跳转。

## 11. 下一步建议

当前已经完成 `task-detail/`、`task-domain/`、`runtime/`、`product/`、`research/`、`operations/`、完整 `architecture/`、`workflow` 与 `organization/` 的首轮收口，并补做了 `runtime-pipeline-upgrade-plan.md`、`task-workbench-frontend-simplification-plan.md` 与本文档本身的历史归档。后续如果继续清理，应转入各功能域内部做正文核验，而不是再回到根 `docs/` 执行物理收口。
