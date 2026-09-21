<p align="center">
  <img src="apps/desktop/public/assets/openerx-mark.svg" alt="openerx" width="88" height="88" />
</p>

<h1 align="center">openerx</h1>

<p align="center">开源、本地优先的个人 AI 工作空间。</p>

openerx 是运行在 Windows 和 macOS 上的 AI 桌面客户端。它把对话、项目、文件、工具、Skill 和记忆组织在同一工作空间，让模型在授权范围内处理资料、执行本机任务并交付成果。

默认使用你自己的模型 API，不要求注册平台账号。使用远程模型或第三方工具时，相关上下文会发送给你配置的服务；本地优先不等于完全离线。

## 下载与使用

本仓库提供源码。已发布的客户端安装包会列在 [GitHub Releases](https://github.com/openerserver/openerx/releases)；没有可用 Release 时，请按下方步骤从源码运行。支持的平台、签名状态和更新方式以对应发布说明为准。

1. 打开 **设置 → 模型**，选择厂商并填写 API Key，测试连接后保存。
2. 新建对话，按需添加附件、选择工作目录或创建项目。
3. 在 **设置 → 工具** 中配置浏览器、MCP 等能力，并检查授权范围。

API 的可用性、额度与费用由所选服务商决定。内置模型及自定义接口配置见 [模型接入](docs/models.md)。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 对话与项目 | 对话历史、分支、项目说明及多个授权目录。 |
| 文件与成果 | 附件、本机文件操作，以及文档和其他成果的预览与保存。 |
| 模型接入 | 厂商预设和自定义 OpenAI-compatible Chat Completions 接口。 |
| 工具与浏览器 | 权限管理下的 Shell、联网搜索、独立浏览器及授权 Chrome 标签页。 |
| MCP 与 Skill | 接入本机或远程 MCP，安装和管理可复用的任务方法。 |
| 记忆 | 管理可跨对话使用的偏好与信息。 |
| 本地自动化 | 一次性、每日或每周任务；执行时电脑和应用需要保持运行。 |

浏览器扩展需要配对和逐标签页授权。系统辅助功能、自动化和签名发布存在平台差异；仓库中的可选平台与移动伴随端需要单独配置。

## 从源码运行

需要 Node.js **24.3.0 或以上**、npm **11 或以上**，以及当前平台的原生构建工具。

```sh
git clone https://github.com/openerserver/openerx.git
cd openerx
npm ci
npm run dev:desktop
```

日常调试使用 `dev:desktop`，无需生成安装包。详细环境、测试、MCP 与浏览器开发步骤见 [开发指南](docs/development.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [开发指南](docs/development.md) | 环境、常用命令、扩展配置和贡献方式。 |
| [架构说明](docs/architecture.md) | 模块职责、数据流与权限边界。 |
| [模型接入](docs/models.md) | 厂商、接口、模型能力与凭据配置。 |
| [构建与发布](docs/releasing.md) | 打包、签名、发布检查与测试产物。 |
| [安全说明](SECURITY.md) | 数据流、权限限制及漏洞报告。 |

## 参与贡献

欢迎通过 [Issues](https://github.com/openerserver/openerx/issues) 报告问题，或提交 Pull Request。请提供版本、平台、复现步骤和脱敏日志；代码变更应附相关验证结果。安全问题请按 [安全说明](SECURITY.md) 处理。

## 许可证

采用 [Apache License 2.0](LICENSE)。第三方依赖和随附组件遵循各自许可证。
