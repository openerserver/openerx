# WDC-003 自动前台切换实现与验收状态

后续更新：用户关闭 SAC 后已完成误报排查，移除本记录中的 UIA 根焦点回退，改为持续交互进程；最终真实自动切换及最小化恢复通过。当前实现与证据见 [WDC-004](wdc-004-automatic-foreground-passed-2026-09-08.md)。下文保留本轮早期受阻时的历史状态。

日期：2026-09-08。状态：`IMPLEMENTED / FINAL NATIVE RUNTIME VALIDATION BLOCKED`。

## 已实现

- 原生助手先验证 HWND、PID、进程启动时间、路径、交互会话和完整性等级，再进行窗口激活。
- 应用枚举包含最小化窗口。切前台仅对最小化目标调用 `ShowWindowAsync(SW_RESTORE)`，正常或最大化窗口保持现有布局；观察和输入仍要求窗口已恢复。
- 已在前台时快速完成；否则先尝试普通 `SetForegroundWindow`，未达到目标前台时再尝试 UI Automation 根元素的 `SetFocus()`。每一步都以实际 `GetForegroundWindow` 根窗口匹配为成功条件，API 调用返回不等同于成功。
- 激活过程中持续检查窗口身份、交互桌面、最后输入时间及按住的修饰键/鼠标键。单段轮询上限为 1.5 秒；UIA 挂起和总请求超时仍由父进程的 12 秒请求期限与取消终止子进程。
- `DesktopControlHost` 在 attach 和用户明确恢复时先启动接管监视器，再切前台。切换期间的真人输入、监视器丢失和停止可取消操作；迟到的原生成功不得恢复已取消的会话。
- 激活失败仍保留既有 UI 恢复路径。本轮没有模拟 Alt/Tab、连接输入队列、修改系统前台锁定策略或放宽系统应用控制。

## 参考边界

Codex 官方公开的是 Windows 活动桌面、前台操作和应用权限等行为，没有公开其内部窗口激活算法。本实现参考该体验，使用本项目自己的 Win32/UIA 方案。[Codex 计算机使用](https://learn.chatgpt.com/zh-Hans/docs/computer-use)、[Windows 使用方式](https://learn.chatgpt.com/zh-Hans/use-cases/use-your-computer-with-codex)。

微软明确限制后台进程的 `SetForegroundWindow` 权限，也明确 UIA `SetFocus()` 不保证将元素置于前台。因此保留真实前台核对与失败处理，不能承诺所有应用均可自动激活。[SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)、[UIA SetFocus](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.setfocus?view=windowsdesktop-10.0)、[ShowWindowAsync](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindowasync)。

## 实际验证

- 原生最终代码编译及发布成功。
- 中间构建曾通过记事本自动模式的输入、保存和文件校验：`.codex-temp/wdc-evidence/system-a8edb287-92c0-48be-b954-78aebf6b6814`。此启动流程没有独立证明目标原先在后台，而且随后又加入了按键未松开保护，因此不能代替最终自动切换验收。
- 主机、控制条和助手清单相关回归：3 个测试文件、21 项通过。包含切前台等待期间的输入接管、监视器丢失、监视器启动失败、停止/恢复竞态。桌面项目 TypeScript 检查通过，4 个 TypeScript 文件 Biome 检查通过；最终 Vite 验收构建通过（36 个模块）。
- 最终原生助手 SHA-256：`1f74cc010437ce0852d5d2a630dc4cf4ee0ab02741eef8771d894f14cfccb82c`；Authenticode 为 `NotSigned`。
- 最终自动验收在 `native_preflight` 被 Windows 应用控制阻止，未开始任何窗口切换。系统错误码 `4551`；CodeIntegrity 事件 `3033`、`3077`；策略 ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`；SAC 状态为 1。本轮没有改变系统安全设置或改用替代运行载体。
- 拦截证据：`.codex-temp/wdc-evidence/foreground-fa3312ad-4127-4792-9e98-f40eb42dc069/result.json` 与 `launch-diagnostic.json`。

## 准备好的真实自动验收

新增 `apps/desktop/scripts/e2e-windows-foreground.mts`，由 `vite.windows-desktop-control.config.mts` 构建为 `.vite/windows-desktop-live/foreground.mjs`。独立测试夹具和脚本已经编译。

验收先打开并保留两个专用窗口，拒绝已有记事本/计算器。随后进行四次交替切换，并追加一次最小化恢复。每次独立检查切换前目标确实不在前台、切换后 HWND/PID/启动时间均匹配目标；核对记事本中文和 emoji 文件、计算器 `1+2=3`、截图和操作后的前台状态。全程保持一个输入监视器；不接受人工逐窗口切换模式。失败保留部分步骤证据。

该验收使用正式 `WindowsDesktopDriver` 和正式原生二进制，测试夹具仅负责创建隔离目标、读取状态和安排最小化前置条件，不代替生产激活实现。

## 尚未完成

需要在获准执行上述最终构建的测试环境完成自动来回切换和最小化恢复。尚不能宣布完整自动前台验收通过。功能默认关闭、已提交商店包保持不变；商店包安装和完整 Electron/Broker/Pi 调用链仍需独立验证。
