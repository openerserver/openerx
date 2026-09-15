# openerx Desktop — personal AI workspace

V2 的 Electron + React + TypeScript 桌面客户端。

- `src/main/`：窗口、生命周期、系统能力和安全策略
- `src/preload/`：最小化、类型化的 Renderer Bridge
- `src/renderer/`：React + Vite 用户界面

常用命令从仓库根目录执行：

```bash
npm run dev:desktop
npm run check:v2
npm run package:v2
```

日常调试使用 `dev:desktop`，复用已安装的 Electron 和固定的 `apps/desktop/.vite/` 目录。
界面修改由 Vite 热更新；需要重启时仍使用同一条命令。macOS 原生辅助程序随开发服务器启动生成到固定的
`apps/desktop/.native-build/`，不受 Forge 清理 `.vite/` 缓存影响。
`dev:v2` / `dev:deepseek` 还会启动本地平台服务，适合需要平台模型的联调。

只有验证安装包、签名或打包后行为时才运行 `package:v2` / `check:v2`。打包前退出正在使用旧包的应用，
然后复用 `apps/desktop/out/openerx-<platform>-<arch>/`，不要按任务名或日期另建应用副本。
源码检查点只保存 Git 状态和必要的源码差异，不复制构建产物、依赖或整个用户配置目录。

清理命令默认只预览，检查列表后加 `--apply` 执行：

```bash
npm run clean:desktop
npm run clean:desktop -- --apply
npm run clean:desktop -- --legacy-checkpoints
npm run clean:desktop -- --legacy-checkpoints --apply
```

清理范围是未在运行的 `.vite/` 缓存、`out/` 中额外命名的调试包、仅剩许可证或缺失 Windows 可执行文件的打包残留，以及 `out-codex/` 内的 openerx 包。
`--legacy-checkpoints` 额外检查仓库旁 `openerx-checkpoints/`、`.openerx-checkpoints/` 下各任务的 `build/` 目录，
仅移除有 Electron 产物标记的包目录。固定名称的有效应用包、发布安装包、源码备份、数据库、截图及正在运行的产物会保留。

Renderer 只能通过 `window.openerx` 暴露的类型化 Bridge 使用桌面能力。

## MCP 添加与管理

在 **设置 → 工具 → 添加工具** 中手动填写，或选择 **JSON 导入** 粘贴 `mcpServers` 配置。
快捷配置提供 Context7 与 GitHub；点击后补齐所需认证即可添加。GitHub 默认使用只读接口。
支持本机 STDIO 和 Streamable HTTP；启动参数、环境变量、工作目录、自定义请求头、Bearer 和 OAuth 都可配置。
在服务的 **设置** 中可以编辑配置、测试连接、查看工具清单或移除服务；列表开关控制启停。

环境变量、请求头和认证凭证通过本机加密存储保存。编辑时留空保留已有值，环境变量与请求头填写 `{}` 可清空。
具体配置示例、验证步骤和范围见 [MCP 管理说明](../../docs/v2/2026-09-15-mcp-management.md)。
