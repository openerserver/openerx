# OpenerX 2.0

OpenerX 2.0 是面向普通用户的个人 AI 工作客户端。V1 使用 Electron + React + TypeScript，围绕对话、文件、工具、Skill、账户同步、平台模型和个人计费构建 Windows/macOS 桌面体验。

## 当前状态

V2 产品合同已经批准；M0「工程与 ADR 基线」、M1「Chat Alpha」和 Pi Foundation 已完成，
下一检查点是 M2「Account + Model」。旧企业 AI Dev/Ops 控制平面已完整归档到 [`v1-backup/`](v1-backup/README.md)，不再属于新主线构建和依赖边界。

## 活跃目录

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | Electron Main、Preload 和 React Renderer |
| `apps/app-service` | 本地业务 API、Conversation/Message 和缓存协调 |
| `apps/sync-service` | 本地同步队列和云同步适配 |
| `services` | 身份、同步、模型、Token、价格、账本和支付服务 |
| `packages/pi-host` | Pi `AgentSession` 组合、事件投影和隔离进程入口 |
| `packages` | 领域、合同、工具/Skill、UI、存储和可观测性共享包 |
| `docs/v2` | 已批准的产品、架构、迁移、验收和开发合同 |
| `v1-backup` | 只读旧系统快照和本地旧运行状态 |

## 开始阅读

1. [V2 产品合同包](docs/v2/README.md)
2. [实施启动记录](docs/v2/12-implementation-bootstrap.md)
3. [开发执行计划](docs/v2/13-development-plan.md)

## V2 本地命令

```bash
npm ci
npm run dev:v2
npm run check:v2
```

`check:v2` 会依次执行依赖边界、lint、类型检查、单元/夹具测试和 Electron 生产打包。M0 的决策记录位于 [`docs/v2/adr/`](docs/v2/adr/README.md)。
