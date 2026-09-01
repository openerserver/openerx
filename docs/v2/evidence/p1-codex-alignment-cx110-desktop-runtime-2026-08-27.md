# P1 Codex 对齐 CX-110-D2 桌面运行时能力实现证据（2026-08-27）

> 状态：`PASS / MACOS DESKTOP LOCAL IMPLEMENTATION CHECKPOINT`；完整 CX-110 仍为 `IN PROGRESS`
>
> 时间：2026-08-27 14:51（Asia/Shanghai）
>
> 基线：`HEAD e8983b8a13cc5e9f6df7e065ee375deefbff4ae9` 加当前未提交的 P0、CX-101 至 CX-109、CX-110-D1 与 CX-110-D2 实现
>
> 范围：桌面 Host Capability 的运行时 availability/readiness，以及 macOS Browser、Shell、Desktop 的本机允许、拒绝、撤销和不可用矩阵

## 1. 结论

CX-110-D2 已关闭“静态目录把尚不可执行的工具宣称为可用”的错误。Browser、Desktop 由 Desktop Main 实时探测；Shell 只有在 macOS 且 `/usr/bin/sandbox-exec` 存在时才具备 Host 能力；账户、平台端点、可写工作区、系统权限和 MCP 连接状态由 App Service 汇总为稳定的运行时状态。探测失败采用 fail-closed：工具既不会显示为可用，也不会进入当前 Turn 的 `availableToolNames`。

桌面工具中心现在区分 `available`、`degraded`、`authorization_required` 和 `unavailable`，显示中文可操作原因，并提供显式刷新。Renderer 不自行推断操作系统能力；它只显示 Main/App Service 返回的 strict contract。

本轮在当前 macOS arm64 开发机真实启动 Electron：隔离 Browser 完成打开、输入、截图、上传、下载和关闭；Desktop Main 真实探测为可用，并按窗口源捕获了 UWA 目标窗口；Shell 在未授予可写工作区时显示“需要设置”。这证明当前开发机和当前 unsigned Electron 运行环境，不证明签名应用 TCC 身份、其他 Mac 或 Windows。

## 2. 运行时边界

```text
Renderer 工具中心
  -> 窄 Preload IPC
  -> Desktop Main 注入账户/平台配置状态
  -> App Service Tool Runtime Readiness
       - Main Host availability: Browser / Desktop
       - Tool SDK availability: macOS Shell sandbox
       - Storage: 有效可写 Workspace Grant
       - MCP SDK: 授权、连接和实际工具发现
  -> available / degraded / authorization_required / unavailable

每次生成
  -> App Service 重新探测 Main Host + Shell sandbox
  -> 只把真实可用工具固化到该 Run 的 availableToolNames
  -> Pi 不能通过静态目录取得不可用 Host 工具
```

- Main Host availability 使用独立 strict MessagePort request/response，不经过 Renderer。
- macOS Desktop 每次读取 Screen Recording 和 Accessibility 当前状态，并确认 `/usr/bin/osascript` 存在。
- Desktop 在允许窗口捕获但缺少 Accessibility 时保持截图可用，交互状态为 `degraded`；缺少 Screen Recording 时整个 Desktop 工具不暴露。
- Shell 的文件系统沙箱与网络授权继续独立；非 macOS 或缺少系统沙箱时不再暴露 Shell。
- 平台 Web/图片、Workspace 和 MCP 的设置缺口不会伪装成模型能力不足。

## 3. 用户可见状态

| 状态 | 含义 | 典型原因 |
| --- | --- | --- |
| `available` | 当前 Host 与必要配置可执行 | Browser Host 就绪；Desktop 权限完整；Shell 有系统沙箱和可写工作区 |
| `degraded` | 至少一个安全子能力可用，但部分动作不可用 | Desktop 可截图但缺少 Accessibility；部分 MCP 服务不可用 |
| `authorization_required` | 实现存在，需要用户完成本机设置或授权 | 登录、可写工作区、Screen Recording、MCP 配置/OAuth |
| `unavailable` | 当前平台或 Host 无法安全执行 | Main Host 断开、无 OS Shell 沙箱、无自动化组件、MCP 无法连接 |

UI 只显示映射后的中文原因；未知内部错误不会原样泄漏给普通用户。

## 4. macOS 本机矩阵

| 能力 | 允许 | 拒绝/越界 | 撤销 | 不可用/降级 |
| --- | --- | --- | --- | --- |
| Browser | 真实 Electron E2E 完成独立 partition 的 open/type/screenshot/upload/download/close，并验证只剩主窗口。 | Broker 显式 deny 后 Host adapter 调用次数为 0；高影响 submit 仍逐次审批。 | 撤销持久 capture Scope 后，同资源下一次调用重新进入 `permission_required`。 | Main Host 不可用时从 Turn 工具集移除；纯探测矩阵覆盖 `BROWSER_HOST_UNAVAILABLE`。 |
| Shell | 当前 Mac 在 OS sandbox 内真实执行 argv、返回输出/退出码，并可启动、观察、停止长进程。 | Node/Python 在网络允许和禁止两种状态下读取工作区外文件都由 OS 拒绝；未授权网络被拒绝，授权回环网络成功。 | 撤销 Workspace Grant 同时撤销 Shell Scope；readiness 变为“需要可写工作区”，下一 Turn 不再含 Shell。 | macOS 缺少 `sandbox-exec`、Windows 或其他平台均返回 `SHELL_OS_SANDBOX_UNAVAILABLE`，不降级执行。 |
| Desktop | 当前 Mac 的 Screen Recording、Accessibility 和 automation 探测通过；真实 Electron E2E 只捕获名为 UWA 的目标窗口。 | Broker 显式 deny 后不触达 Host；窗口选择只请求 `window` source，目标不存在不回退到整屏。 | 撤销持久 capture Scope 后下一次截图重新请求授权。 | 无 Screen Recording 时完全不暴露；只有截图权限时标为 degraded；无 Accessibility 或 `osascript` 显示独立原因。 |

当前真实 E2E 输出：

```text
E2E_TOOLS_OK permission-isolated-browser-type-screenshot-upload-download-close-projection
E2E_DESKTOP_READINESS_OK browser=运行时可用 shell=需要设置 desktop=运行时可用 reason=none native_window_capture=pass
```

## 5. 实现与自动化证据

| 边界 | 实现 | 证据 |
| --- | --- | --- |
| 合同 | `ToolRuntimeReadiness`、Main availability frame、Desktop IPC 均为 strict schema。 | Contracts 验证状态、未知字段拒绝、命令结果解析和进程帧。 |
| Main 探测 | `desktopHostToolAvailability` 将平台、Screen Recording、Accessibility 和自动化组件映射为 Browser/Desktop availability。 | Desktop 纯函数矩阵覆盖完整、部分、拒绝、未知、Windows 自动化缺失和不支持平台。 |
| App Service 汇总 | `ToolAppService` 合并 Main、Shell、Workspace、账户/平台和 MCP，并在 `prepareGeneration` 过滤不可用工具。 | 服务测试验证 Host/OS 不可用时 Browser/Desktop/Shell 不进入 Turn；Workspace 撤销立即移除 Shell。 |
| Shell OS 边界 | `shellToolAvailability` 与执行器使用同一个 macOS `sandbox-exec` 前提。 | Tool SDK 在当前 Mac 真实执行允许路径、外部文件逃逸、网络允许/拒绝和进程停止测试。 |
| 审批与撤销 | Browser/Desktop 仍由统一 Capability Broker 和持久 Scope 管理。 | Broker 测试分别覆盖允许、deny 不触达 adapter、撤销后重新审批。 |
| UI | 九类目录项通过 capability key 绑定实时结果，显示状态、原因和刷新入口。 | Desktop UI 测试验证 Browser 可用、Shell 需设置、Desktop degraded 及中文原因。 |
| 真实桌面 | Electron E2E 使用测试 Pi Host 发起真实工具调用，而非直接调用 Main helper。 | Browser 完整链路和 Desktop 目标窗口捕获均通过，工具活动继续投影到 Conversation/Run。 |

## 6. 验证结果

专项验证：

- Contracts：21 个测试。
- Tool SDK：32 个测试；当前 Mac 实际执行 Shell 文件/网络沙箱与长进程用例。
- App Service：20 个测试。
- Desktop：54 个测试。
- 上述四组共 127 个测试，且四个 workspace TypeScript 检查通过。
- 真实 Electron E2E：Browser 完整链路、运行时状态 UI 和 Desktop UWA 目标窗口捕获通过。

2026-08-27 14:51（Asia/Shanghai）执行完整 `npm run check:v2`，结果 `exit 0`：

- V2 boundaries：217 个源文件，PASS。
- Release graph：159 个 production 文件、13 个 Pi imports 仅位于 `packages/pi-host`、45 条 workspace edges，PASS。
- Local release readiness：PASS；仍明确保留 12 组外部证据。
- Biome：313 个文件，PASS。
- TypeScript：全部 workspace，PASS。
- Tests：workspace 254 个测试加根目录 61 个测试，合计 315 个，PASS。
- Build：Contracts、Release、Mobile iOS/Android 和 Desktop production bundle，PASS。
- Package：Darwin arm64/x64 与 Windows x64 Fuse、release artifact，PASS。
- Native signature：三平台本地包仍按预期为 `LOCAL UNSIGNED`，不作为签名发布证据。

## 7. 明确限制与下一任务

- 当前 macOS 证据来自开发机和 unsigned Electron；TCC 权限可能绑定当前 Electron 身份，不能外推到签名、公证后的 UWA.app。
- Desktop 实机正向证据覆盖目标窗口捕获；Accessibility 交互、高影响 submit/send/delete/purchase 仍只有 Broker/Host 自动化边界，未对用户真实应用执行副作用。
- Shell 当前安全实现依赖 macOS `sandbox-exec`；Windows 原生 AppContainer/受限 Token 沙箱尚未实现，因此 Windows 明确 unavailable。
- Browser 使用本机 HTTP 夹具，未证明任意第三方站点、登录、验证码或下载策略兼容性。
- MCP 仍缺任意第三方实网 OAuth；Web/图片仍缺 live Provider；发布仍缺签名安装、升级和回滚证据。
- 完整 CX-110 与 P1 继续保持 `IN PROGRESS`。下一桌面优先任务应先完成签名 macOS 包的 TCC 身份、安装/升级/回滚和 Accessibility 受控交互矩阵，再推进 Windows 原生 Shell/Desktop。
