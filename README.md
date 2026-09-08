# OpenERX

OpenERX 是一款开源、本地优先的 AI 桌面助手，将 AI 对话、项目文件、工具、Skill 和自动化任务整合在一个工作空间中。

接入自己的模型 API Key，即可开始对话、处理文件并组织日常工作，无需注册 OpenERX 账号或部署服务器。OpenERX 使用 Electron、React 和 TypeScript 构建，采用 Apache License 2.0 开源。

## 主要功能

- **AI 对话**：配置模型提供商和自己的 API Key（BYOK），在桌面端管理对话与上下文。
- **项目与文件**：按项目组织对话、设置项目说明、连接本地目录，让 AI 围绕具体工作提供帮助。
- **工具与 Skill**：使用文件处理等工具，通过 Skill 扩展任务能力，并管理工具调用权限。
- **记忆管理**：保存和管理可供后续对话参考的长期信息，按需开启或关闭记忆。
- **自动化任务**：设置定时任务，在桌面应用运行时执行，并查看任务状态与结果。
- **本地优先**：对话、项目和应用数据主要保存在本机；模型调用及联网工具按需连接相应服务。

## 快速开始

以下步骤用于从源码启动桌面应用。桌面打包目标为 Windows x64 和 macOS Apple Silicon / Intel。

### 环境要求

- Git
- Node.js 24.3 或更高版本，推荐使用 [`.node-version`](.node-version) 指定的版本
- npm 11 或更高版本
- macOS 需安装 Xcode Command Line Tools
- Windows x64 构建及桌面控制开发需安装 .NET 10 SDK

### 安装与运行

```bash
git clone https://github.com/openerserver/openerx.git
cd openerx
npm ci
npm run dev:desktop
```

### 开始使用

1. 打开「设置 → 模型」，选择模型提供商并填写自己的 API Key。
2. 新建对话，或创建项目并添加项目说明、本地目录。
3. 根据任务需要启用工具、安装 Skill 或创建自动化任务。

默认启动无需配置 `.env`。模型服务可能按使用量收费，费用由对应提供商收取。数据存储和网络访问说明见 [隐私说明](docs/PRIVACY.md)。

Windows 桌面控制目前为默认关闭的开发功能，已完成记事本和计算器自动前台切换验收。启用方法、运行条件及 MSIX 打包见 [Windows 桌面控制](docs/WINDOWS-DESKTOP-CONTROL.md)。

## 构建

在仓库根目录运行：

```bash
npm run package:v2
npm run check:package
```

应用默认输出到 `apps/desktop/out/`。本地构建生成未签名的开发包。

如需生成 Windows 安装程序或 macOS ZIP：

```bash
npm run make --workspace @openerx/desktop
```

## 开发

项目使用 npm workspaces 管理桌面应用与共享模块。修改代码后，可运行完整源码检查：

```bash
npm run check:source
```

该命令包含代码规范、类型检查、测试及依赖审计。更多命令、环境配置与故障排查见 [开发指南](docs/DEVELOPMENT.md)，模块设计见 [架构说明](docs/ARCHITECTURE.md)，版本变化见 [更新日志](CHANGELOG.md)。

## 参与贡献

欢迎提交 Bug、功能建议、文档改进和代码贡献。

- 遇到问题或有改进建议，请提交 [Issue](https://github.com/openerserver/openerx/issues)。
- 提交 Pull Request 前，请阅读 [贡献指南](CONTRIBUTING.md) 和 [行为准则](CODE_OF_CONDUCT.md)。
- 安全漏洞请按 [安全政策](SECURITY.md) 私下报告，不要在公开 Issue 中披露细节。

## 许可证

OpenERX 采用 [Apache License 2.0](LICENSE)。版权声明见 [NOTICE](NOTICE)，第三方依赖的许可信息见 [第三方声明](THIRD_PARTY_NOTICES.md)。
