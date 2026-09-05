# OpenERX Desktop

Electron + React + TypeScript 桌面客户端。

- `src/main/`：窗口、生命周期、系统能力和安全策略
- `src/preload/`：最小化、类型化的 Renderer Bridge
- `src/renderer/`：React + Vite 用户界面

常用命令从仓库根目录执行：

```bash
npm run dev:desktop
npm run check:v2
npm run package:v2
```

Renderer 只能通过 `window.openerx` 暴露的类型化 Bridge 使用桌面能力。产品名称、助手名称、颜色和可选图片由 `@openerx/branding` 在构建时提供。
