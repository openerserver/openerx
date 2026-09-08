# WDC-004 自动前台切换验收通过

日期：2026-09-08。状态：`AUTOMATIC FOREGROUND PASSED / FULL RELEASE ACCEPTANCE PENDING`。

真实记事本与计算器的自动来回切换、最小化恢复、输入和结果核对已通过。最终原生助手 SHA-256：`b3d227e102c5d447018a5f6d155e2032d799777473aa6d9bfe9024c262a93b1e`，与发布清单一致。测试环境 Windows 11 x64，用户自行关闭 SAC（读取值为 0），Authenticode 仍为 `NotSigned`。

## 修复与原因

用户确认没有操作键鼠后，复现了旧激活路径的接管误报。独立低层输入监视器在切回计算器时记录：`source=keyboard, message=256, flags=16, extra=0, injected=true`。此元数据来自本轮工具输出；没有记录键值、输入内容或坐标。这个事件属于未标记的合成输入，不能据此认定用户手动按键。

移除窗口根元素的 UIA `SetFocus()` 回退后，相同流程不再出现上述输入事件，但每次请求新建助手的方案仍在输入后的跨应用激活上失败。将 `focus` 与 `act` 放到同一个持续会话进程后，完整流程通过。该结论来自本机对照复现，不代表所有 UIA 提供程序都有相同行为，也不声称使用了 Codex 内部实现。

- 窗口激活使用 `SetForegroundWindow`，必要时调用 `ShowWindowAsync(SW_SHOW)`；最小化目标先 `SW_RESTORE`。成功必须经过真实前台身份核对。
- 仅切前台和输入共用 `--session` 进程；观察和输入监视器仍独立，避免 UIA 挂起阻塞接管与取消。
- 持续进程串行处理请求，验证协议与请求 ID，限制请求/响应体积。超时、取消、异常响应和进程退出均丢弃该进程；后续请求创建新进程。
- 正常 detach 可保留进程供同一任务下一次获准的应用交互使用。用户接管、暂停、停止、监视器丢失和任务终止清理进程；父进程退出有原生看门狗保护。
- 未放宽监视器：除本助手标记的输入外，未标记输入仍触发停止，包括其他来源的合成输入。

复跑期间机器锁屏，独立 WTS 查询为 `level=1, session=1, connection=0, flags=0`，前台 HWND 为空；旧的 `OpenInputDesktop` 检查仍返回 Default。增加 WTS 会话状态检查，锁定或非活动会话返回 `DESKTOP_SESSION_LOCKED`，未知状态拒绝操作。用户解锁后，包含该检查的最终二进制通过以下正向验收。没有主动锁定用户机器补跑最终负向验收。

WTS 字段依据：[WTSINFOEXW](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfoexw)、[WTSINFOEX_LEVEL1_W](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfoex_level1_w)。

## 最终真实应用验收

原始证据：[result.json](assets/wdc-004/foreground-result.json)。模式为 `automatic-background-switch`，`status=passed`，`stage=complete`，`userTakeover=false`，`monitorLost=false`。

| 步骤 | 自动切换 | 激活耗时 | 结果 |
| --- | --- | ---: | --- |
| 1 | 计算器 → 记事本 | 235 ms | 中文与 emoji 输入、保存、磁盘内容一致 |
| 2 | 记事本 → 计算器 | 84 ms | `1+2=3`，UIA 和截图一致 |
| 3 | 计算器 → 记事本 | 77 ms | 内容保持，前台身份一致 |
| 4 | 记事本 → 计算器 | 108 ms | 结果保持，前台身份一致 |
| 5 | 计算器 → 已最小化记事本 | 83 ms | 恢复可见，内容和前台身份一致 |

每一步都由独立只读夹具检查切换前后的 HWND、PID 与进程启动时间；切换前目标确实在后台。本次五步的前台身份均非空。读取器也能如实记录 Windows 没有前台窗口的初始状态，但切换后仍必须匹配完整目标身份，第二步起还必须来自上一目标窗口。

生产 Driver 与原生助手负责激活及输入；夹具只创建测试目标、读取身份和设置最小化前置条件。全程持续监视输入，不需要人工逐窗口点击。测试结束按准确窗口身份正常关闭测试窗口。

已查看截图：[计算器](assets/wdc-004/calculator.png)、[恢复后的记事本](assets/wdc-004/notepad.png)。本次记事本文本为 `Windows 自动前台切换验证 😀`。

## 回归验证

- 4 个测试文件、30 项通过：主机会话边界、控制条、原生清单、持续交互进程。覆盖取消、超时、进程退出、启动与停止竞态、并发拒绝、异常和超大响应，以及正常 detach 与用户接管的生命周期区别。
- 桌面项目 TypeScript 检查通过；7 个相关 TypeScript 文件 Biome 检查通过；.NET 原生助手和测试夹具编译通过；Vite 验收构建通过。
- 正式 Host + Driver + 原生助手的专用 WinForms 实机验收通过，覆盖 UIA、密码遮挡、中文和 emoji、保存结果、过期观察、提交保护、暂停/恢复/停止。证据：[result.json](assets/wdc-004/host-result.json)。

## 历史证据与范围

早先 SAC 阻止新助手的事实保留在 [WDC-003](wdc-003-automatic-foreground-2026-09-08.md)。本轮其他原始记录均保留在 `.codex-temp/wdc-evidence/`：

- `foreground-82e97a8b-05f2-4bcc-85dd-2bb172be0ed2`：旧 UIA 激活路径收到未标记合成输入。
- `foreground-93f11f1c-f2e4-4fb5-8bf0-f827d1b52b19`：移除 UIA 回退后，短生命周期助手跨应用激活失败，没有输入事件。
- `foreground-004c6751-0375-470a-8db5-98c664ef6168`：持续交互进程首次完整通过，随后优化调用顺序及清理逻辑。
- `foreground-ca25a8a6-581e-41a1-be52-4676b11d3558`、`foreground-6464d416-fc4f-42c0-b253-32f38940641b`、`foreground-6504163f-55ff-4a89-b97f-cf5d18027914`：锁屏期间前台读取失败，尚未执行切换。
- `foreground-0bdc4fee-05d7-46c9-bba4-d478dad83d70`：记录为空前台后尝试激活，仍因锁屏失败；随后增加 WTS 检查。

本次证明本机开发构建的真实自动控制可用。功能仍默认关闭；商店已提交包未更新。商店签名安装包、完整 Electron/Broker/Pi 对话链路、多显示器及其他应用兼容性仍需独立验收。
