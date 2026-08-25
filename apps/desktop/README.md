# OpenerX Desktop

V2 的 Electron + React + TypeScript 桌面客户端。

- `src/main/`：窗口、生命周期、系统能力和安全策略
- `src/preload/`：最小化、类型化的 Renderer Bridge
- `src/renderer/`：React + Vite 用户界面

M0 已开始建立桌面运行骨架。常用命令从仓库根目录执行：

```bash
npm run dev:v2
npm run check:v2
npm run package:v2
```

Renderer 只能通过 `window.openerx` 暴露的类型化 Bridge 使用桌面能力。
