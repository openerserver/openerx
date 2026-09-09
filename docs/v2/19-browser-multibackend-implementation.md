# 浏览器控制接入说明（2026-09-09）

本次实现对齐 Codex 的会话分工：已有 Chrome 登录态由用户授权标签页复用；独立任务使用应用自己的 Chromium；系统辅助功能仍可单独选择。这里实现的是 OpenERX 自有代码和协议，不依赖 Codex 的扩展或服务。

## 使用

设置 → 工具 → 浏览器操作 → 设置。

- **自动（默认）**：有且仅有一个地址完全匹配的待用授权标签页时使用 Chrome；无匹配时创建独立浏览器。多个匹配会要求指定上下文。
- **已连接的 Chrome**：必须存在匹配授权，失败后不会转到其他登录环境。
- **OpenERX 独立浏览器**：Electron Chromium 临时分区，Cookie 独立；关闭窗口销毁分区数据。该模式拒绝模型降级到系统浏览器或外部标签页。
- **系统浏览器 · 辅助功能**：保留现有 macOS / Windows 驱动及系统权限检查。

点击「准备 Chrome 扩展」生成当前进程的配对码，并把扩展导出到用户数据目录。Chrome 的 chrome://extensions 中加载该目录后，在扩展弹窗内配对并授权目标标签页。配对码不会进入工具结果；模型通过 `openerx_browser` 的 `contexts` 动作取得真实的 `browserContextRef` 和完整 URL，不能编造引用。

首次授权五分钟内有效，领取后仅限绑定标签页/网站。应用重启后重新配对。用户输入会暂停自动操作；在设置中可恢复。切换标签页、离开网站、关闭页面或断连会撤销授权。解除控制保留用户自己的标签页和 Cookie。

## 实现和边界

- 主进程：`ElectronToolCapabilityHost` 负责路由；原有 `SystemDefaultBrowserAdapter`、`BrowserActionDispatcher` 和 `UIObservationRegistry` 统一做会话、观察、元素和权限校验。
- 独立浏览器：`ManagedChromiumDriver` 使用 Electron 私有 debugger 通道和页面隔离世界，按已观察元素执行有限动作。没有 TCP 调试端口，也没有给模型提供任意脚本、Cookie 或原始 CDP 方法。
- Chrome：`browser-extension/` 是 MV3 扩展，用户在弹窗内主动 attach 指定标签页；`ChromeExtensionServer` 仅监听 127.0.0.1 的随机端口。通道要求固定扩展 Origin、32 字节随机配对密钥和本次连接 ID；既有授权内核继续验证消息序号、请求 ID、标签页和文档身份。
- 扩展轮询使用 POST。Chrome 扩展对 GET 可能省略 Origin，因此没有放宽 Origin 检查来兼容 GET。
- 截图在本地遮挡密码、支付、验证码输入框和 iframe；对应语义值为 null。用户接管、跨站限制、过期观察和关闭清理均保留。
- 完整 CDP 不向模型开放。默认建立内部 CDP 通道不等于授权模型任意 CDP 命令。
- 文件上传、下载、敏感输入和不支持的键盘动作仍要求用户操作。当前语义树覆盖顶层文档，尚未支持 iframe / Shadow DOM 内部操作和坐标回退。Chrome 扩展通过 Fetch 拦截阻止跨站 Document 请求。
- 打包时复制扩展文件；macOS 辅助功能 helper 的开发构建目录使用 `.native-build`，不会再被 Forge 清除 `.vite` 时删掉。

## 验证

```sh
npm run typecheck --workspace @openerx/desktop
npm run typecheck --workspace @openerx/tool-sdk
npm run typecheck --workspace @openerx/pi-host
npm run check:boundaries:v2
npm run test:e2e:browser:managed --workspace @openerx/desktop
npm run test:e2e:browser:extension --workspace @openerx/desktop
```

扩展 E2E 使用临时 Chrome for Testing 配置和本地测试网页，不读取用户 Chrome 资料。需要已安装 Playwright Chromium，也可以用 `OPENERX_TEST_CHROMIUM` 指定测试浏览器可执行文件。

2026-09-09 本机 macOS 运行证据：

- `MANAGED_BROWSER_E2E_OK`：打开、填写、点击、导航、拒绝旧观察、拒绝跨站、截图遮挡、Cookie 隔离、用户接管、恢复、关闭。
- `EXTENSION_BROWSER_E2E_OK`：真实未打包扩展配对和授权、观察、脱敏、填写、点击、过期观察重试、跨站阻止、用户接管与恢复、解除控制保留标签页。
- 浏览器内核、桥接、协议、路由、设置、工具策略相关 50 项测试通过；桌面、工具 SDK、Pi Host 类型检查和 V2 边界检查通过。

完整聊天 UI 回归为 65 项通过、1 项失败；失败项为记忆表单输入时序用例。修改前 HEAD 的独立工作树也出现同样失败（63 项通过、同一项失败），该用例单独执行通过。这不是本轮浏览器新增的回归。

运行中的开发版已检查设置界面，扩展成功导出至 `~/Library/Application Support/OpenerX/browser-extension`。

以上是本地开发验证；未验证 Windows 原生运行、商店扩展发布或安装包发布。用户日常 Chrome 尚需自行加载并授权扩展。已有模型服务和 Remote 修改保留在同一工作副本中，本轮没有上传 GitHub。
