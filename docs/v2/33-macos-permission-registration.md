# macOS 权限列表自动登记

2026-09-15；openerx 2.0.5、UWA 2.1.2。

用户在工具设置中点击权限按钮后，应用先向 macOS 发起该权限的系统申请，再打开“系统设置 → 隐私与安全性”的对应页面。系统负责登记应用，用户负责开启开关；设置页不再把手动点击“＋”添加应用作为正常流程。返回应用或点击“重新检测权限”后更新状态，需要重启时遵循系统提示。

录屏申请通过主进程加载的 Node-API 模块调用 Apple 的 [CGRequestScreenCaptureAccess](https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess())。该调用只请求授权，不采集屏幕；使用应用进程自身的签名身份，避免把独立命令行程序登记为被授权应用。辅助功能沿用 Electron 的 [isTrustedAccessibilityClient(true)](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesistrustedaccessibilityclientprompt-macos)，先触发系统申请再打开对应设置。

被动检测仍只查询权限，打开工具设置本身不会弹出系统申请。未授权或用户拒绝后继续显示“待系统授权”；原生模块加载失败时显示错误，不把打开设置页当作已申请成功。应用不修改 TCC 数据库、系统开关或其他应用的权限。

原生模块使用 Node-API v8，由当前 Node 发行包的 `include/node` 头文件编译；自定义 Node 安装可设置 `OPENERX_NODE_INCLUDE_DIR`。开发构建使用固定 `.native-build` 目录，打包时编译到 `app.asar.unpacked/native` 并随应用签名，不增加运行时下载或工具进程。

验证包含两边的桌面类型检查、权限请求先于设置跳转、已授权短路、拒绝保持待授权、原生请求失败、非 macOS 分支，以及界面主动申请、返回刷新、手动刷新和版本检查。实际系统登记与安装包签名验证另行记录，不能由单元测试替代。
