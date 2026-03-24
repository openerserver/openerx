# OpenCode 关注边界说明

## 1. 文档目的

本文档用于明确 OpenerX 对 OpenCode 的关注边界，回答两个问题：

- 我们会持续关注 OpenCode 的哪些能力
- 我们明确不把哪些 OpenCode 能力纳入后续建设重点

这份文档适用于架构评审、版本升级评估、路线图规划和团队边界对齐。

## 2. 边界原则

OpenerX 将 OpenCode 视为运行时与插件生态底座，而不是桌面产品能力底座。

因此，我们会持续关注 OpenCode 的运行时协议、插件市场能力和广泛插件兼容性；不以桌面版产品建设、跨平台客户端建设和终端用户客户端体验建设为目标。

## 3. 判断依据

当前仓库中，OpenCode 的角色已经比较明确：

- BFF 只通过 Agent 控制和消息读取接口接入 OpenCode Runtime，见 [api-boundary.md](./api-boundary.md)
- 当前系统定位为“控制平面治理 + 运行时执行”分离，见 [architecture-overview.md](./architecture-overview.md)
- 目标架构中，OpenCode 仍位于 Runtime 一侧，而不是前端产品侧，见 [architecture-target-evolution.md](./architecture-target-evolution.md)
- 当前部署方式为 Linux 服务模式，重点是运行时服务接入，而不是桌面端交付

## 4. 关注项 / 不关注项

| 类别 | 事项 | 结论 | 说明 |
|------|------|------|------|
| 关注项 | 社区插件市场能力 | 持续关注 | 关注插件发现、分发、安装入口和生态可用性，评估其对 OpenerX 的复用价值。 |
| 关注项 | 广泛插件兼容承诺 | 持续关注 | 关注主流插件在目标版本上的可运行性、兼容边界和回归风险。 |
| 关注项 | 插件生命周期能力 | 持续关注 | 包括插件安装、启停、升级、卸载、配置加载与故障恢复。 |
| 关注项 | 插件 API 与运行机制稳定性 | 持续关注 | 重点关注插件接口、事件机制、权限模型和运行时约束是否稳定。 |
| 关注项 | 升级过程中的插件兼容验证 | 持续关注 | 每次升级 OpenCode 时，需要把插件兼容性作为核心验收项，而不只是验证基础 API。 |
| 关注项 | 运行时协议兼容性 | 持续关注 | 持续关注 REST API、SSE 事件、SDK 行为是否稳定，确保控制平面对接不被破坏。 |
| 关注项 | execution trace 与 runtime 协议的边界稳定性 | 持续关注 | 需要持续保持“runtime 原始消息接口”与“task-domain execution trace 公开 contract”两层语义分离，避免在设计讨论中重新把 runtime message fallback 带回主链。 |
| 不关注项 | 桌面版开发 | 不关注 | 不以 OpenCode 桌面客户端产品形态作为建设目标。 |
| 不关注项 | Windows 系统适配与更新 | 不关注 | 不投入 Windows 平台兼容、安装、更新与问题修复。 |
| 不关注项 | 桌面端打包与分发体系 | 不关注 | 包括安装包生成、签名、公证、自动升级、渠道分发等。 |
| 不关注项 | 面向个人开发者的本地客户端体验优化 | 不关注 | 包括桌面交互细节、启动引导、主题外观、快捷键和终端 UI 美化。 |
| 不关注项 | 跨平台客户端一致性建设 | 不关注 | 不追求 macOS、Windows、Linux 客户端侧体验和行为完全对齐。 |
| 不关注项 | 单机离线使用闭环 | 不关注 | 不以 local-first 或个人工作站单机闭环为目标。 |
| 不关注项 | 客户端账户体系与本地偏好同步 | 不关注 | 不关注桌面侧账号态、个人设置漫游、本地偏好管理。 |
| 不关注项 | 非运行时协议类 UI 功能追新 | 不关注 | 不跟进上游桌面产品层面的 UI 新特性，只关注运行时和插件生态相关能力。 |

## 5. 使用建议

在版本升级、路线图评审或能力取舍时，建议按以下优先级判断是否需要跟进某项 OpenCode 能力：

1. 是否直接影响 OpenerX 与 OpenCode Runtime 的协议兼容性。
2. 是否影响社区插件市场接入和主流插件兼容性。
3. 是否会误导 execution trace 的实现边界，例如把 `GET /session/:id/message` 重新当作 trace 主读链或公开 fallback。
4. 是否影响内部选定插件的安装、运行、升级和治理。
5. 如果仅影响桌面客户端形态、跨平台分发或终端用户体验，则默认不纳入当前阶段重点。

### 5.1 Execution Trace 边界补充

对于实现者，当前需要记住的不是“runtime 有没有消息读取接口”，而是“哪些来源允许进入 task-domain trace contract”。

当前边界如下：

1. execution trace 主读链以 task-domain projection 为首选。
2. service timeline 作为正式但受限的 secondary source，只在 projection timeline 为空或不可用时补位。
3. service timeline 的本质是 `conversation_messages` 与 conversation domain events 的持久化聚合，不是 runtime fallback 的别名。
4. 只要 projection 已经返回非空 timeline，即使不完整，也必须显式暴露 incomplete，而不是用 runtime messages 或 service timeline 覆盖掉 partial projection。
5. 因此，OpenCode runtime 的消息接口应被视为底层协议与诊断能力，而不是未来设计讨论里可以随时重新接回来的 trace fallback 层。

## 6. 一页式结论

OpenerX 后续对 OpenCode 的关注重点，应收敛为“运行时兼容 + 插件生态兼容”两条主线，而不是扩展到桌面产品建设。

也就是说，我们关注的是 OpenCode 作为外部 Agent Runtime 和插件生态承载平台的能力是否稳定、可接入、可升级；不关注其作为桌面客户端产品在 Windows、桌面分发、跨平台体验和本地用户体验上的持续演进。