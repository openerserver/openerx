# openerx 桌面共用基线（2026-09-15）

桌面通用能力以 openerx 为上游：对话、项目、文件、工具、浏览器、桌面权限、模型与手机连接协议使用同一组回归。UWA 是联通版本，保留中央账号、数据服务和安装身份适配。

本轮先以 `bdfa144` 保存当前工作，再合入 master `b56a9ab`，形成 `b14ced7`。同时将 UWA 已有的 Chrome 扩展授权提示、自定义 BYOK 模型选择、停止任务时清空队列、Windows 工作区 Git 检测回补到 openerx。

手机申请的渲染与确认操作位于 `packages/desktop-ui`。它只处理展示、过期状态和用户点击；账号、网络请求与最终授权仍由各版本适配器负责。二维码保留为用户主动展开的入口。

`npm run test:desktop-common` 是两边相同的类型检查和行为回归入口。`npm run test:desktop-parity` 验证差异检查本身能发现新增、删除、通用文件改变及适配文件改变。

UWA 的 `config/desktop-parity.json` 固定上游提交与逐文件摘要，`config/desktop-overlays.json` 列出具体适配理由。UWA 运行 `npm run check:desktop-parity -- --source-root ../openerx` 可同时检查当前两个工作区。普通构建只检查其锁定的 core；它无法发现一个未提供给检查器的更新上游。因此每次同步都要带上 `--source-root`，不要将摘要检查等同于所有运行行为已经相同。

当前保留独立 Git 仓库及 core 子模块，已有中央数据适配仍有部分位于 core 内。逐文件基线用于约束这些差异；这不是所有源文件已完全合并成一个物理仓库的声明。后续新增版本能力优先通过 `packages/desktop-extension` 与外层包接入。
