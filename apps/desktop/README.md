# OpenerX Desktop

V2 的 Electron + React + TypeScript 桌面客户端。

- `src/main/`：窗口、生命周期、系统能力和安全策略
- `src/preload/`：最小化、类型化的 Renderer Bridge
- `src/renderer/`：React + Vite 用户界面

本轮仅建立边界，不引入桌面运行时代码或依赖。
