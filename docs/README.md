# docs 文档导航

> 状态：2026-04-15 目录入口首版
> 范围：OpenerX 工作区主 `docs/` 目录的统一阅读入口与功能域导航

## 1. 这个入口解决什么问题

`docs/` 已经不再适合作为“平铺式文件仓库”直接浏览。

当前更合理的阅读方式是先按功能域进入对应目录，再在目录内区分当前实现、目标方案、历史资料或调研材料。这个入口只负责回答两个问题：

1. 你现在应该先看哪个目录。
2. 哪些目录可以当作当前实现依据，哪些目录只是产品、调研或历史背景。

## 2. 推荐阅读顺序

如果你的问题是“系统现在怎么做”，建议优先按下面顺序阅读：

1. [runtime/README.md](runtime/README.md)：当前 runtime backend、认证与治理边界
2. [task-domain/README.md](task-domain/README.md)：task/session/message 的 canonical 后端边界
3. [task-detail/README.md](task-detail/README.md)：任务详情页展示、realtime 与继续执行协作
4. [current/README.md](current/README.md)：已收敛并作为当前有效依据的部分文档入口

如果你的问题是“系统边界、架构演进、运行拓扑或 ADR 怎么定义”，先看：

1. [architecture/README.md](architecture/README.md)

如果你的问题是“角色工作流、阶段模板、审批门控、聚合执行器怎么协同”，先看：

1. [workflow/README.md](workflow/README.md)

如果你的问题是“组织化协作的对象模型、成员关系、agent console 或 member-first 页面怎么定义”，先看：

1. [organization/README.md](organization/README.md)

如果你的问题是“产品怎么讲、怎么卖、怎么定位”，先看：

1. [product/README.md](product/README.md)

如果你的问题是“OpenerX 2.0 的个人 AI 客户端应该重构成什么”，先看：

1. [v2/README.md](v2/README.md)：已批准并已进入实施准备的 Electron + React 跨平台桌面个人客户端产品合同；目录描述目标与实施边界，不自动取代 `current/`。当前启动记录见 [v2/12-implementation-bootstrap.md](v2/12-implementation-bootstrap.md)。

如果你的问题是“以前怎么讨论过、和外部方案怎么比、为什么没走某条路”，先看：

1. [research/README.md](research/README.md)

如果你的问题是“怎么运行、怎么验收、怎么回看迁移或验证基线”，先看：

1. [operations/README.md](operations/README.md)

## 3. 当前目录地图

### 3.1 当前已完成首轮拆分的目录

1. [task-detail/README.md](task-detail/README.md)：TaskDetailV3 页面、展示逻辑、continue / compare / realtime 协作
2. [task-domain/README.md](task-domain/README.md)：task/session/message/schema/API/写链与 cleanup 边界
3. [runtime/README.md](runtime/README.md)：当前 `pi-mono` runtime 集成、认证与审计治理边界
4. [architecture/README.md](architecture/README.md)：系统总览、接口边界、核心概念、ADR、运行拓扑与架构支撑文档目录
5. [workflow/README.md](workflow/README.md)：角色工作流、阶段状态机、审批治理、聚合模型与 workflow schema / API 设计
6. [organization/README.md](organization/README.md)：organization-oriented-agent、member-first、agent console、成员模型与角色协作设计
7. [product/README.md](product/README.md)：产品定位、商业化、包装与对外表达
8. [research/README.md](research/README.md)：调研、历史对比、路线评估与探索性材料
9. [operations/README.md](operations/README.md)：运行说明、验收基线、执行清单与 runbook

### 3.2 特殊入口

1. [current/README.md](current/README.md)：当前有效文档入口，偏“已核验后仍保留为现行依据”的文档集合
2. [archive/README.md](archive/README.md)：历史文档总入口，包含 runtime、task-detail、paid-model 与本轮整理记录
3. [v2/README.md](v2/README.md)：面向企业普通用户的 Electron + React 个人 AI 桌面客户端合同包；当前处于实施准备阶段

## 4. 根目录保留项

根 `docs/` 现在原则上只保留总导航页：

1. [README.md](README.md)：`docs/` 总导航页。

此前留在根目录的 `documentation-reorganization-and-cleanup-plan.md` 已按历史资料归档到 [archive/historical-documentation-reorganization-and-cleanup-plan.md](archive/historical-documentation-reorganization-and-cleanup-plan.md)。

此前留在根目录的 `task-workbench-frontend-simplification-plan.md` 已按历史资料归档到 [archive/task-detail/historical-task-workbench-frontend-simplification-plan.md](archive/task-detail/historical-task-workbench-frontend-simplification-plan.md)。

organization 功能域已经完成独立拆分；根目录不再保留这一组文档。

## 5. 使用约定

1. 优先从目录 `README` 进入，而不是靠文件名猜状态。
2. 只要文档涉及“当前实现事实”，都应再对照对应功能目录中的现行入口或代码锚点。
3. 产品、调研、历史材料可以作为背景，但默认不作为当前代码真值源。

## 6. 一句话边界

把这个文件当成 `docs/` 的总导航页：先选目录，再进具体文档；不要再从根目录平铺扫文件名。
