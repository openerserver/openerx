# WDC-001 Windows 桌面控制实现记录

最新结果：自动前台切换、真实记事本/计算器与最小化恢复已在开发环境通过，见 [WDC-004](wdc-004-automatic-foreground-passed-2026-09-08.md)。下文是早期实现记录。

日期：2026-09-05。状态：`FOUNDATION IMPLEMENTED / RELEASE BLOCKED`。

后续更新（2026-09-08）：同一个辅助程序已在 SAC 保持开启的情况下正常运行；人工辅助前台模式下，真实记事本输入保存和计算器运算已分别通过。自动前台切换仍未通过，完整发布验收仍待完成。见 [WDC-002 重试记录](wdc-002-windows-desktop-retry-2026-09-08.md)。下文保留 9 月 5 日的历史事实。

## 已实现

- 在现有 Pi → Capability Broker → Electron Main 链路增加版本化 `desktop_control_v2`，保留 macOS 原有接口。
- Windows x64 独立 .NET 10 原生助手：应用发现、受限启动、窗口绑定、UIA 观察和语义操作、窗口截图、键鼠输入。仅在当前用户的交互桌面运行。
- 主进程绑定对话和执行代次；模型不能提供可信执行身份。窗口身份包含进程启动时间，观察有有效期且动作后失效。
- 桌面与浏览器共用控制租约；真实输入会暂停桌面会话，仅用户界面可以恢复。提供暂停、恢复、停止及全局停止快捷键注册，任务终止、锁屏、休眠时停止。
- 复用应用权限 Scope 和高影响动作审批；密码控件不返回值，截图遮挡敏感区域。动作已执行但后续观察失败时返回结果不确定，避免自动重试副作用。
- 增加会话控制条、能力诊断、取消和超时处理、原生进程退出清理、助手 SHA-256 清单和 ASAR 打包检查。
- `OPENERX_WINDOWS_DESKTOP_CONTROL=1` 为开发启用开关；默认保持关闭。首版仅 x64。

## 验证事实

- 早期原生版本通过自建 WinForms 可见测试窗口：中文和 emoji 输入、UIA 保存到测试文件、截图检查、密码遮挡、过期观察拒绝、发送动作约束以及暂停/恢复/停止。该结果不能代表最终原生源码已完成运行验收。
- 真实记事本/计算器脚本尚未完成闭环：记事本前台激活返回 `DESKTOP_TARGET_NOT_FRONTMOST`。此前进度中的“记事本输入和保存已跑通”已更正，不能作为验收证据。
- 后续增加 UIA 焦点尝试并重新编译成功；本机 Windows 应用程序控制策略阻止了新生成的未签名助手。PowerShell 直接启动的系统错误为“应用程序控制策略已阻止此文件”。未关闭策略、安装信任证书或通过其他运行方式绕过。
- 已验证独立输出目录中的 Windows x64 未签名打包及助手清单完整性。完整性校验不是 Authenticode 信任验证，也不证明系统允许执行。
- 自动化回归：34 个测试文件、185 项测试通过，覆盖合同、Pi 工具、Broker、App Service、桌面会话、控制条及既有 macOS/Windows 浏览器相关逻辑。桌面 TypeScript 检查和 V2 边界检查通过（350 个源文件），`git diff --check` 无差异错误。原生最终版本仍需要在允许该构建运行的验收环境中重跑。

## 发布前仍需完成

1. 使用受信任身份实际签名并验证发布包。已增加先签助手、再生成哈希清单、打包时只验证助手不重复签名的流程及顺序测试；本机缺少签名身份，尚未完成真正的签名构建验收。
2. 真实记事本、计算器和目标办公软件的前台激活、观察、操作、结果验证；不得绕过 Windows 前台限制。
3. 多显示器、混合 DPI、窗口移动/缩放、锁屏、管理员窗口、用户接管和长时间运行的真实设备矩阵。
4. 当前截图使用 PrintWindow；Windows Graphics Capture、ARM64、文本模型无视觉能力时的专门降级、完整应用选择界面仍未实现。
5. 在受信任构建上完成上述验收前，不将此功能默认开启，也不将本记录称为完整发布验收。

## 开发与测试入口

安装 .NET 10 SDK 后执行 `node apps/desktop/scripts/build-windows-desktop-helper.mjs`。可使用 `OPENERX_DOTNET` 指定 SDK 的 dotnet 路径。开发助手位于 `apps/desktop/native/windows-desktop-helper/bin/publish/x64`。

从桌面包目录运行 `test:e2e:windows-desktop` 可构建并执行专用测试窗口脚本。系统应用脚本为 `scripts/e2e-windows-desktop-apps.mts`，由 `vite.windows-desktop-control.config.mts` 构建为 `apps.mjs`。这些脚本会操作可见窗口，应在允许助手执行的测试会话中运行；系统应用脚本拒绝已有可见记事本/计算器窗口，以免混入个人工作。

打包检查支持 `OPENERX_RELEASE_OUT_DIR`，可验证隔离输出目录，避免使用正在运行的应用目录。运行证据默认存入仓库 `.codex-temp/wdc-evidence`，不纳入提交。

## 前台恢复与签名修复（同日后续）

- 从 CodeIntegrity/Operational 读取到此助手的事件 3033、3077，策略 ID 为 `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`。注册表 `VerifiedAndReputablePolicyState=1`，本机智能应用控制开启。列举完整策略需要管理员权限，本次未提升权限。当前用户和计算机个人证书库未发现可用代码签名证书，签名环境变量也未配置。
- 原生前台激活增加已在前台的快速路径，并将异步激活等待从 300ms 调整为最多 1500ms；等待期间检测新输入并退出，最终仍核对精确窗口和进程身份。撤回了未验收的 UIA 根节点 SetFocus 尝试。延长等待用于处理异步激活，不赋予后台进程强制抢焦点的权利。
- 首次 attach 被拒绝时，保留原工具调用和可信执行代次，释放控制租约，展示暂停状态，最多等待用户在控制条点击恢复 30 秒。模型不能自行恢复。超时、取消、停止均清理会话。恢复与停止并发时，不再允许已停止会话恢复为 ready。
- 原生助手构建支持受信任 PFX（`WINDOWS_CERTIFICATE_FILE`、`WINDOWS_CERTIFICATE_PASSWORD`）或当前用户证书库的明确证书（`OPENERX_WINDOWS_SIGN_THUMBPRINT`）。使用 Electron 打包器附带的微软 SignTool；可用 `OPENERX_SIGNTOOL_PATH` 指定 Windows SDK 中的工具。PFX 密码从环境读取，按 SignTool 接口传入原生进程，不写日志；优先使用证书库身份可避免传递 PFX 密码。不安装证书。签名后验证 Authenticode 和时间戳，再生成哈希。打包阶段验证已签助手，避免二次签名破坏 ASAR 内清单；本地配置签名身份时也签 UWA 主程序。发布模式或 `OPENERX_REQUIRE_SIGNED_WINDOWS=1` 缺少身份时立即失败。
- 系统应用验收脚本刷新启动后的窗口身份，在失败时写入 `result.json` 的具体阶段；不再仅依赖终端日志或把发现窗口视为通过验收。
- 签名校验不再依赖 PowerShell 脚本。早期脚本调用被本机执行策略拒绝，该退出码不构成签名校验结果；已移除该实现，未使用 ExecutionPolicy Bypass。已用真正的 SignTool 验证微软工具自身签名有效，并确认未签名助手被明确报为 `WINDOWS_AUTHENTICODE_INVALID`。构建缺少签名身份时的拒绝检查通过。
- 最终回归：36 个测试文件、197 项测试通过；桌面 TypeScript、原生编译、V2 边界检查（356 个源文件）、14 个相关文件的 Biome 检查、`git diff --check` 通过。最新 Windows x64 未签名包的 ASAR 和助手哈希校验通过。其中签名顺序和失败处理测试使用测试字节和模拟进程，不等同于真实签名构建通过。
- **真实记事本/计算器验收仍未通过，也未重启受策略拦截的助手尝试其他运行方式。** 需要现有受信任签名身份或允许开发构建运行的验收环境后，执行真实应用脚本并检查文件和截图；不能以单元测试替代。

依据：[微软 SetForegroundWindow 说明](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)明确规定前台激活条件并允许操作失败；[智能应用控制签名说明](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)要求受信任提供方签发的 RSA 代码签名证书。不能把自签证书的哈希完整性当成系统信任。
