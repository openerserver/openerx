# 开发指南

## 环境

使用 Node.js >= 24.3.0、npm >= 11.0.0。仓库采用 npm workspaces，`package-lock.json` 是安装基准。桌面开发使用 Windows 或 macOS；原生构建还需要相应平台工具链。

```sh
npm ci
npm run dev:desktop
```

开发服务器复用 `apps/desktop/.vite/`，Renderer 通过 Vite 热更新。修改 Main 或共享启动模块后可能需要重启同一开发命令。macOS 原生辅助程序生成到 `apps/desktop/.native-build/`。

## 检查

所有检查、测试和构建均在本地执行，GitHub Actions 已停用。提交代码前运行 `npm run check:local`；该命令依次检查版本、公开文件范围、生产依赖漏洞、模块边界、内置 Skill、发布配置、代码规范、类型及单元和集成测试，任一步失败即停止。依赖审计需要连接 npm registry，检查程序在本机运行。

| 命令 | 用途 |
| --- | --- |
| `npm run check:local` | 提交前的本地源码检查与测试，不打包应用。 |
| `npm run check:public-surface` | 检查公开文件范围、文档白名单和相对链接。 |
| `npm run lint:v2` | Biome 源码检查。 |
| `npm run typecheck:v2` | 全部 workspace 类型检查。 |
| `npm run test:desktop-common` | 桌面公共回归。 |
| `npm run test:v2` | workspace 与集成测试。 |
| `npm run test:e2e:v2` | 桌面端到端测试，需要构建产物和对应平台环境。 |
| `npm run version:check` | 检查各产品版本一致性。 |

`npm run check:v2` 还涉及构建、产物和签名校验，适合完整验证环境。修改代码时先运行对应测试；完整检查通过后不必重复相同测试。

这些命令需主动执行，`git push` 不会自动运行检查。检查已提交的内置 Skill 变更时，用 `npm run check:builtin-skills:v2 -- --base <推送前的远端提交>` 比较版本。桌面打包、端到端测试和签名验证按需在对应的本地 macOS 或 Windows 环境完成；在 Mac 上通过不能证明 Windows 已通过。

## 模型与本地平台

默认桌面使用自己的模型 API，无需部署平台。设置方式见 [模型接入](models.md)。

只有开发可选平台服务时，才将 `.env.example` 复制为 `.env` 并配置开发参数，然后运行 `npm run dev:v2`。平台默认监听 `127.0.0.1:4099`。`npm run test:deepseek -- "只回答：连接成功"` 会调用真实模型并消耗服务额度。

## MCP、Skill 与浏览器

在 **设置 → 工具 → 添加工具** 中填写服务，或导入 `mcpServers` JSON。支持本机 STDIO 和 Streamable HTTP，以及启动参数、环境变量、工作目录、请求头、Bearer 和 OAuth。Context7 与 GitHub 提供快捷配置；GitHub 默认使用只读接口。

敏感配置保存在本机加密存储中。编辑时留空保留已有敏感值；环境变量或请求头填写 `{}` 可清空。STDIO 服务需要预先安装其运行环境。

Skill 描述任务方法，工具提供执行能力。内置 Skill 位于 `packages/skills/src/builtins.ts`；修改资源后需要递增对应版本，再运行 `npm run update:builtin-skills:v2` 更新快照。

Chrome 扩展位于 `apps/desktop/browser-extension/`。已有标签页需显式配对授权；独立浏览器和系统辅助功能后端有不同的能力与平台权限要求。

## 提交代码

保持模块边界，补充与行为有关的回归，在 PR 中注明平台、命令、结果及未验证项。用户文档只保留本仓库文档白名单中的七个文件；运行报告、截图与临时产物写入忽略的 `artifacts/`。

不要提交 API Key、用户数据、完整配置目录或构建目录。需要清理开发产物时先执行 `npm run clean:desktop` 预览，再按需加 `-- --apply`。
