# OpenerX 架构评审 PPT 大纲版（2026-03 历史材料）

> 状态说明：这是 2026 年 3 月形成的阶段性评审提纲，保留了当时以外部 OpenCode runtime 为中心的讨论背景，不再代表今天的默认 runtime 路径。
>
> 当前默认 backend 已切到 `pi-mono` runtime-provider；现状请优先参考 [runtime/current-implementation-index.md](../runtime/current-implementation-index.md) 和 [architecture-overview.md](../architecture/architecture-overview.md)。

## 1. 封面页

标题建议：

- OpenerX 控制平面当前架构评审
- 副标题：现状、问题与目标演进路径

页内要点：

- 评审对象：当前控制平面系统
- 评审目标：统一认知、识别结构性问题、确定阶段一落地范围
- 时间：2026 年 3 月

## 2. 一页结论

标题建议：当前系统已经形成控制平面骨架，但尚未形成稳定闭环

核心结论：

- 当前系统已经具备 Web UI、BFF、控制平面服务、外部 Runtime 四层结构
- 治理能力已经具备雏形，审批、审计、成本、预算模型已存在
- 前端访问入口和后端职责边界基本形成，但仍未完全闭环
- 当前最大问题不在页面功能，而在认证入口、任务模型、状态源和治理闭环

建议输出：

- 本次评审不讨论页面细节
- 聚焦架构边界与阶段一改造范围

## 3. 系统定位

标题建议：OpenerX 是 AI Agent 控制平面，而不是单纯运行时

页面要点：

- 负责登录、权限、项目/环境/策略管理
- 负责审批、审计、成本、预算等治理能力
- 负责向前端提供任务视图和 Agent 控制入口
- 成稿时的实际 Agent 执行依赖外部 OpenCode Runtime

一句话表述：

> 这份历史提纲成稿时，系统的本质被概括为“运行时外置、治理内置”的 AI 控制平面原型。

## 4. OpenCode 能力边界

标题建议：我们关注 OpenCode 的运行时与插件生态，而不是桌面产品形态

页面要点：

- OpenerX 将 OpenCode 视为外部 Runtime 与插件生态底座
- 持续关注运行时协议稳定性、插件市场能力和广泛插件兼容性
- 不以桌面版开发、Windows 适配、桌面端分发和客户端体验建设为目标
- 版本升级时优先验证 Runtime 协议与插件兼容，不追逐桌面产品功能演进

一句话表述：

> 我们要复用的是 OpenCode 的运行时与插件生态能力，而不是承接它的桌面产品路线。

建议引用：

- 详见 [archive/runtime/historical-opencode-focus-boundary.md](../archive/runtime/historical-opencode-focus-boundary.md)

## 5. 当前架构总览

标题建议：当前运行架构

建议插图：

- 使用 [architecture-overview.md](../architecture/architecture-overview.md) 中的当前组件图

讲解要点：

- Web UI 通过 `/api` 和 `/ws` 接入 BFF
- BFF 聚合前端查询、运行时控制与实时推送
- 控制平面服务负责主数据和治理能力
- 当时的 OpenCode Runtime 负责 agent/session 执行与事件输出

## 6. 当前分层职责

标题建议：四层职责分工

页面要点：

- Web UI：展示、交互、轻状态管理
- BFF：前端聚合、鉴权校验、运行时适配、实时出口
- Control Plane Service：认证、主数据、审批、审计、成本、预算
- 当时的 OpenCode Runtime：会话、消息、执行和 SSE 事件

评审重点：

- 分层方向总体正确
- 但边界还没有完全收紧

## 7. 当前实现的优点

标题建议：已有基础能力

页面要点：

- 已形成前后端分层，不是单体页面直连数据库
- 已有治理相关数据模型，后续可以向平台能力演进
- 已有实时链路，前端能够展示任务和 Agent 活动
- 已有 VM 部署方式，说明系统已考虑基本上线形态

## 8. 当前主要问题

标题建议：结构性问题比功能性问题更紧急

页面要点：

- 认证入口不闭合
- BFF 和控制平面职责边界仍模糊
- 任务视图依赖审计事件反推
- 运行时状态与控制平面状态未统一
- WebSocket 用户上下文与隔离不够严格
- SQLite 作为原型存储的风险已明确，当前正式路线已切到 PostgreSQL

讲解建议：

- 这几项问题相互耦合
- 不先收敛边界，继续堆功能会放大技术债

## 9. 最大风险点展开

标题建议：为什么认证入口是优先级最高的问题

页面要点：

- 前端代理配置指向 BFF
- Nginx `/api` 统一转发 BFF
- 登录逻辑实际在控制平面服务
- BFF 当前没有提供 `/api/auth/*`

结论：

- 认证链路在架构上没有闭环
- 这是阶段一必须修复的问题

## 10. 目标架构

标题建议：目标态不是加更多服务，而是边界收敛

建议插图：

- 使用 [architecture-target-evolution.md](../architecture/architecture-target-evolution.md) 中的目标架构图

讲解要点：

- 前端只访问 BFF
- BFF 只负责聚合、协议适配、实时出口和 Runtime 控制
- Control Plane Core 统一承载主数据、任务域和治理能力
- Runtime Adapter 负责隔离具体运行时实现
- 事件流用于状态同步与实时推送

## 11. 演进路线图

标题建议：从原型控制平面走向稳定平台

建议插图：

- 使用 [architecture-target-evolution.md](../architecture/architecture-target-evolution.md) 中的演进路线图

阶段要点：

- 阶段一：边界收敛
- 阶段二：任务域独立
- 阶段三：治理前置化
- 阶段四：运行时解耦与事件化

## 12. 阶段一范围

标题建议：本次建议优先落地的内容

页面要点：

- 补齐 BFF `/api/auth/*`
- 统一前端只走 BFF
- 明确控制平面与 BFF 接口边界
- 建立前后端接口命名规范
- 对 WebSocket 连接和订阅增加基本鉴权约束

边界说明：

- 阶段一不引入新任务表
- 阶段一不做数据库迁移到 PostgreSQL
- 阶段一不更换运行时

## 13. 阶段一预期收益

标题建议：为什么先做这一轮

页面要点：

- 登录和接口入口变得一致
- 服务分层对团队变得清楚
- 后续任务域重构的变更面缩小
- 实时链路的安全边界更清晰
- 为阶段二和阶段三扫清结构障碍

## 14. 决策项

标题建议：本次评审需要确认的事项

建议列出以下决策：

- 是否确认“前端只能访问 BFF”作为架构原则
- 是否确认 BFF 增加统一 auth 代理
- 是否确认控制平面服务是唯一业务事实记录源
- 是否确认阶段一不处理数据库升级和任务域重构
- 是否确认阶段二再引入独立任务模型

## 15. 会后行动项

标题建议：评审通过后的执行动作

页面要点：

- 输出阶段一任务拆解和负责人
- 创建接口调整 issue 清单
- 创建 BFF auth 聚合改造任务
- 增加基本的接口回归验证项
- 更新架构文档和接口说明

## 16. 备页

建议作为附录保留：

- 当前架构说明文档：[architecture-overview.md](../architecture/architecture-overview.md)
- 目标架构演进文档：[architecture-target-evolution.md](../architecture/architecture-target-evolution.md)
- OpenCode 历史关注边界说明：[archive/runtime/historical-opencode-focus-boundary.md](../archive/runtime/historical-opencode-focus-boundary.md)
- 当前组件关系图
- 目标架构演进图
