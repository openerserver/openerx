# OpenERX

OpenERX 是 Apache-2.0 许可的个人 AI 桌面客户端，使用 Electron、React 和 TypeScript 构建。桌面端、本地 Agent Host、工具与 Skill、安全边界、同步协议和可选平台服务都在本仓库共同维护。

本仓库是产品的唯一通用核心。移动版、企业品牌素材、企业集成与私有交付配置不在本仓库；企业产品通过 Git submodule 引用本仓库，并在构建时注入品牌清单，不维护桌面代码副本。`v1-backup` 不属于开源内容。

> 当前是源码发布准备版本，不代表已有签名及完整跨平台验收的正式安装包。支持 BYOK、本地对话与项目、文件处理、工具、Skill、记忆和自动化；实际限制见 [开发指南](docs/DEVELOPMENT.md)。

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | Electron Main、Preload 与 React Renderer |
| `packages/app-service` | 本地业务 API、记忆、自动化、对话与同步协调 |
| `packages/branding` | 公共品牌默认值与受控品牌清单加载器 |
| `packages/pi-host` | Pi Agent Session 组合、事件投影与隔离进程入口 |
| `packages/release` | 发布清单、版本、通道与架构验证 |
| `packages` | 合同、工具、Skill、存储和可观测性共享包 |
| `services` | 身份、同步、模型、用量、账本与支付服务 |

## 本地开发

需要 Git、Node.js 24.3+ 与 npm 11+；推荐 [`.node-version`](.node-version) 中的版本。克隆后在仓库根目录运行：

```bash
npm ci
npm run dev:desktop
```

在「设置 → 模型」选择 BYOK 提供商并填写自己的 API Key。默认模式不需要平台登录、服务器或 `.env`；未配置 Key 时不能发送模型请求。第三方模型调用可能产生费用，请自行设置服务商限额。

源码检查及打包：

```bash
npm run check:source
npm run package:v2
npm run check:package
```

## 品牌扩展

默认构建使用 OpenERX 品牌。私有发行版设置 `OPENERX_BRAND_MANIFEST`，指向仓库外或企业仓库内的品牌 JSON；清单可配置产品名、助手名、颜色和相对路径 PNG/SVG 素材。品牌资源会在构建时嵌入，通用桌面源码无需分叉。

`apps/mobile/`、`v1-backup/`、`deliverables/` 和 `docs/presentations/` 已加入根级忽略规则，不能作为开源内容提交。

## 功能边界与资料

- 打包目标为 Windows x64、macOS arm64/x64；Linux 用于源码检查，不承诺 Linux 桌面工具支持。未签名应用输出到 `apps/desktop/out/`，不是正式发行版。
- Shell、Skill 脚本、浏览器和桌面操作受平台能力与授权限制。Windows Shell 依赖额外配置的外部沙箱，本仓库不捆绑该外部程序。
- 自动化依赖桌面后台进程，不是托管云任务；退出、休眠及缺少模型凭据会影响运行。
- `services/` 是可选平台实现/开发参考，不是开箱即用的生产云服务。平台账号、同步、支付、远程控制需独立部署；移动端不在本仓库。
- 本地保存不等于全部数据均已加密。模型请求、搜索和外部工具会访问相应提供商，见 [数据与隐私](docs/PRIVACY.md)。

参见 [开发与故障排查](docs/DEVELOPMENT.md)、[公共架构](docs/ARCHITECTURE.md)、[桌面发布门禁](docs/RELEASE_GATES.md)、[GitHub 发布清单](docs/PUBLISHING.md)、[变更记录](CHANGELOG.md) 和 [支持说明](SUPPORT.md)。`docs/v2/` 保留通用技术参考与公共测试资料；内部产品、移动及交付材料不在公开树中。设计说明不等于功能或发行验收已经完成。

## 参与贡献

提交改动前请阅读 [贡献指南](CONTRIBUTING.md) 和 [行为准则](CODE_OF_CONDUCT.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

本项目原创代码采用 [Apache License 2.0](LICENSE)，保留 [NOTICE](NOTICE) 中的声明。第三方依赖适用各自许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。Apache-2.0 不授予企业商标、品牌素材或第三方服务使用权。
