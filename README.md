# openerx — personal AI workspace

openerx（personal AI workspace）是面向普通用户的个人 AI 工作客户端。V1 使用 Electron + React + TypeScript 构建 Windows/macOS 执行主机，并提供 iOS/Android Remote Companion；对话、文件、工具、Skill、账户同步、平台模型和个人计费统一由桌面执行面与手机控制面呈现。

## 当前状态

V2 产品合同已经批准；M0、M1、Pi Foundation 与 M2 至 M9 本地实现检查点已经完成，当前处于
M8/M9 外部 Beta 与发布门禁阶段。DeepSeek V4 真实 API、Provider usage 和服务端最终计费链路已
完成首个真实烟测，签名更新、商店构建和回滚的本地基础也已就绪；目标用户、真实流式/停止、
支付环境、Remote 真机、原生签名/公证/商店和明确发布批准证据仍待补齐。旧企业 AI Dev/Ops
控制平面已完整归档到 [`v1-backup/`](v1-backup/README.md)，
不再属于新主线构建和依赖边界。

## 活跃目录

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | Electron Main、Preload 和 React Renderer |
| `apps/app-service` | 本地业务 API、Conversation/Message 和缓存协调 |
| `apps/sync-service` | 本地同步队列和云同步适配 |
| `services` | 身份、同步、模型、Token、价格、账本和支付服务 |
| `packages/pi-host` | Pi `AgentSession` 组合、事件投影和隔离进程入口 |
| `packages/release` | 签名发布清单、版本/通道/架构与灰度验证 |
| `packages` | 领域、合同、工具/Skill、UI、存储和可观测性共享包 |
| `docs/v2` | 已批准的产品、架构、迁移、验收和开发合同 |
| `v1-backup` | 只读旧系统快照和本地旧运行状态 |

## 开始阅读

1. [V2 产品合同包](docs/v2/README.md)
2. [实施启动记录](docs/v2/12-implementation-bootstrap.md)
3. [开发执行计划](docs/v2/13-development-plan.md)
4. [Remote Control 合同](docs/v2/15-remote-control-contract.md)

## V2 本地命令

```bash
npm ci
npm run dev:desktop
npm run dev:v2
npm run dev:deepseek
npm run test:deepseek -- "只回答：连接成功"
npm run check:v2
```

日常桌面调试使用 `dev:desktop`，复用固定构建目录；需要本地平台服务时使用 `dev:v2`。
`check:v2` 会依次执行依赖边界、lint、类型检查、单元/夹具测试和 Electron 生产打包。
旧调试产物可用 `npm run clean:desktop` 预览清理范围，具体规则见 [Desktop 开发说明](apps/desktop/README.md)。
M0 的决策记录位于 [`docs/v2/adr/`](docs/v2/adr/README.md)。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。
