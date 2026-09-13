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
