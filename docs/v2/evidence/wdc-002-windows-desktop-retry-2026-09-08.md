# WDC-002 Windows 辅助程序重试与真实应用验收

最新结果：无需人工切前台的真实自动验收现已通过，见 [WDC-004](wdc-004-automatic-foreground-passed-2026-09-08.md)。下文保留人工辅助模式的历史结果。

日期：2026-09-08。状态：`HELPER RUNNABLE / REAL APP OPERATIONS PASSED WITH FOREGROUND ASSISTANCE / FULL RELEASE ACCEPTANCE PENDING`。本记录补充 [WDC-001](wdc-001-windows-desktop-control-2026-09-05.md)，保留此前失败事实。

## 辅助程序启动

- 使用已有发布目录内的 `openerx-desktop-helper.exe`，未重新编译或改变运行载体。SHA-256 为 `c80e227f06760e4f7dd5fe7939077a1e9466750e5c8a35ba5b15dad21980d94b`，与清单一致，Authenticode 状态仍为 `NotSigned`。
- 2026-09-08 08:59:49 本地正常启动 `--request <parent pid>` 并发送 `probe`，返回 `desktop_control_v2`、`interactive: true`、`architecture: x64`，退出码为 0。
- 本机 Windows 11 25H2，构建 `26200.9168`；`VerifiedAndReputablePolicyState=1`。本轮没有修改系统应用控制策略、关闭安全功能、安装证书或使用替代运行载体。
- 当前辅助程序可执行。此前被阻止、本次成功的具体原因尚未证明；不能把变化归因于商店认证，也不能保证新构建或其他机器同样放行。
- 探测证据：`.codex-temp/wdc-evidence/retry-20260908-085949/helper-probe.json`。

## 真实记事本

- 自动前台模式重试仍在 `notepad_foreground` 返回 `DESKTOP_TARGET_NOT_FRONTMOST`。证据目录：`.codex-temp/wdc-evidence/system-46d4713e-535d-4d26-a1c5-c6d0b9e5413e`。
- 增加可选人工辅助模式后，原辅助程序完成 `Ctrl+A`、中文和 emoji 输入、`Ctrl+S`。实际文件内容为 `Windows 桌面控制验证 😀`，磁盘断言和截图断言通过，截图已人工查看。
- 该轮随后因计算器窗口识别失败而整体标为失败；记事本的独立结果由终端、实际文件和截图支持，不能把整体 `result.json` 改称全量成功。
- 证据目录：`.codex-temp/wdc-evidence/system-330e7acd-7ea8-4040-9356-3504e36d78bd`；文件 `WDC-Notepad.txt`、截图 `notepad.png`。

## 真实计算器

- 首次人工辅助补跑在前台等待后检测到真实输入，原生监视器发出 `user_input`，测试在初始观察阶段以 `TOOL_CANCELLED` 停止。该轮没有计算成功证据，且未自动恢复。证据目录：`.codex-temp/wdc-evidence/system-56debf0e-0ee1-444c-a42e-7b1555ffb9f0`。
- 用户明确回复“继续测试计算器”后，补跑依次通过 UIA 调用 `一`、`加`、`二`、`等于`，读取到 `显示为 3`，保存截图并人工确认显示 `1 + 2 =` 和 `3`。
- 此轮 `result.json` 为 `status: passed`、`testApp: calculator`、`foregroundMode: manual-assist`，检查项为 `real Calculator 1+2=3 through UIA`。证据目录：`.codex-temp/wdc-evidence/system-1ee06ed8-65ca-43ed-8251-eb4011c17e8c`，截图为 `calculator.png`。
- 测试结束后复核 SAC 状态仍为 1、生产助手 SHA-256 不变。没有残留运行中的 `openerx-desktop-helper` 进程。

## 验收脚本调整

- `OPENERX_WDC_MANUAL_FOREGROUND=1`：启动测试目标后，等待用户把精确测试窗口切到前台。等待器只读取前台 HWND、PID、进程启动时间和最后输入时间，最长 120 秒；目标前台且输入静止后才启动操作监视器。未模拟键鼠取得前台权限。
- `OPENERX_WDC_TEST_APP=notepad|calculator`：可仅补跑未完成项目，默认仍测试两项。结果记录 `foregroundMode: manual-assist` 和实际通过的检查，失败也保留已完成项。
- 本机计算器的顶层窗口属于 `ApplicationFrameHost`。测试识别兼容精确的系统程序路径、进程名和中英文计算器标题，并继续拒绝已有目标窗口。本轮未修改生产助手的应用身份模型；这不构成所有 UWP 承载窗口均正确映射到具体应用权限的证明。
- 已重新编译独立测试夹具（0 警告、0 错误）和 Vite 验收脚本；脚本 Biome 检查通过；生产助手保持原二进制。

## 适用边界

人工辅助模式通过只能证明目标处于前台时的操作；不能据此宣布后台自动切换前台已通过。商店安装包、完整 Electron / Broker / Pi 调用链、用户接管与紧急停止、多屏 DPI 和更广的软件矩阵仍需各自验收。本轮没有修改功能默认关闭状态，也没有修改已提交的商店包。
