# 自带浏览器与 Chrome 扩展能力统一（2026-09-20）

## 用户可见结果

自带的独立浏览器不再锁定首次打开的网站。它与已连接的 Chrome 共用网站权限规则和同一套有限页面操作协议，无需为独立浏览器安装 Chrome 扩展。

- 统一入口：设置 → 工具 → 浏览器操作 → 设置中的“网站访问权限”，同时作用于两种浏览器。
- 统一网站规则：本次任务允许、始终允许此网站、允许所有网站、阻止此网站；阻止优先。域名规则不包含协议和端口，子域名分别管理。
- 统一导航：授权后允许跨网站链接、表单和重定向；支持 navigate、back、forward、reload。可识别的链接/表单新窗口目标归一为当前受控页面。
- 统一任务授权：同一执行轮次、同一网站的临时授权可在 Chrome 和独立浏览器之间复用，不随页面或窗口切换重新申请。不同任务不共享临时授权，长期规则在各自应用内共享。
- 统一发现入口：contexts 继续返回 Chrome 标签页，并返回当前任务的 managedSessions（sessionId、URL、标题）；不显示其他任务、已解除控制或已撤销网站权限的独立浏览器。对已有 sessionId 调用 observe 获得新观察后再操作。
- 统一撤销与生命周期：阻止网站后不能继续观察或操作；等待授权和页面加载期间均可取消。任务结束释放临时权限并清理自建窗口；用户接管的窗口保留，解除自动控制后不再替任务弹出权限询问。

## 仍然保留的边界

“统一功能”不是合并登录资料或把扩展装入 Electron。Chrome 扩展复用所连接 Chrome 配置的登录态；独立浏览器继续使用每窗口隔离的临时资料，关闭后清理，不复制 Chrome 的 Cookie 或历史。

独立浏览器通过 Electron 私有调试通道控制页面；Chrome 通过扩展桥接。模型不获得任意脚本、原始 CDP 或公网/本机调试端口。两个后端复用 page-agent.js 的语义动作及旧观察校验，但连接方式和资料生命周期保留差异。

独立浏览器在网络文档请求发出前检查主文档和子框架网站规则，覆盖链接、表单、导航及重定向；非 HTTP/HTTPS 导航和带 URL 凭据的导航仍被拒绝。网站策略不是资源防火墙，不逐一拦截图片、脚本等子资源。子框架经过导航权限检查并不代表开放 iframe/Shadow DOM 内部语义操作。

任意 JavaScript 弹窗、浏览器系统权限、上传下载、密码等敏感输入限制不变。独立浏览器未新增坐标控制。系统浏览器“辅助功能”模式不属于此次网站策略统一范围。已解除控制且保留给用户的窗口不再受任务网站询问控制，但网页安全限制仍保留。

openerx 和 UWA 分别保存自己的设置；两版之间不共享账户、浏览器登录或权限文件。UWA 品牌、OpenerX-Enterprise 数据目录和中央账号扩展保持不变。

## 实现与回归

- ToolCapabilityHost 将同一个 BrowserSitePermissions 实例注入 ChromeExtensionServer 和 ManagedChromiumDriver。
- ManagedChromiumDriver 移除首次站点 origin 锁，增加文档请求门禁、导航动作、撤销检查、取消加载、任务内会话发现和解除控制。
- SystemDefaultBrowserAdapter 传递任务范围，在 detach、任务结束和关闭适配器时通知驱动释放自动控制。
- 新增 browser-managed-permissions.test.ts 并纳入两版 scripts/test-desktop-common.mjs；补充适配器关闭/任务回收、设置说明和真实 Electron 回归。

```sh
npm run test:desktop-common
npm run test:e2e:browser:managed --workspace @openerx/desktop
npm run test:e2e:browser:extension --workspace @openerx/desktop
npm run dev:desktop
node apps/desktop/scripts/e2e-browser-settings.mjs
```

UWA 从外层根目录启动 dev:desktop；其他工作区脚本位于 core。成对检查从 UWA 根目录运行 `npm run check:desktop-parity -- --source-root ../openerx`。真实测试使用临时资料和本地页面，不操作日常 Chrome 配置；开发输出复用 .vite，不创建应用包或完整资料备份。

2026-09-20 本机 macOS 验证：openerx 486 项共同回归、UWA 493 项共同回归通过；两版真实独立浏览器、Chrome 扩展、设置页 E2E 通过。独立浏览器真实回归验证跨站链接、导航/历史/刷新、允许及阻止的重定向、旧观察、密码脱敏、资料隔离、用户接管、解除控制、等待授权取消和挂起导航取消；被阻止的重定向没有到达目标服务器。设置截图已检查，并移除临时配对凭据。

共同代码差异审查覆盖 456 个一致文件和 120 个既有版本差异；本次没有把共同能力缺失登记为版本差异。

交付范围是源代码及本地开发运行验证：未打包、未替换已安装应用、未推送，也不代表 Windows 实机或正式发布验证。
