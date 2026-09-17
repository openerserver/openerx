# UWA 电脑在线探测超时调整

日期：2026-09-16（Asia/Shanghai）。用户反馈安卓在任务回复期间频繁提示断开，并明确要求放宽电脑探测超时。

## 修改范围与行为

核对两版后，1 秒的 `mobileProbeReady()` 只存在于 UWA 中央连接扩展；openerx 没有这个探测入口。本机 UWA 仓库为相邻的 `openerx-enterprise`，共用桌面基础在其 `core/` 中。本次没有给 openerx 增加无调用方的 UWA 接口。

| 层级 | 原值 | 修改后 |
| --- | --- | --- |
| UWA AppService 的只读 IPC 就绪探测 | 1 秒 | 10 秒 |
| UWA 中央连接对就绪探测的外层等待 | 1.5 秒 | 最长 12 秒 |
| 服务端挑战期限 | 30 秒 | 保持原值 |

任务执行导致 AppService 响应延迟时，有更充分的响应窗口。外层等待仍受当前挑战剩余期限限制；过期挑战直接丢弃，继续使用原通道拉取新挑战。停止连接会取消外层等待，迟到响应不能重新授权或恢复已关闭的连接。内部探测依旧检查真实 `project.list` 返回结构及当前进程、资料目录和生命周期。

这不同于前一轮的 [Android 系统网络状态误判修复](android-connection-recovery-2026-09-16.md)。两条路径都做了源码修正，但未采集用户真机断线日志，不能以代码回归证明本次现场断线只由这两个原因造成。

## 修改文件

UWA：

- `core/apps/desktop/src/main/app-service-supervisor.ts`：内部期限 10 秒。
- `packages/central-desktop/src/mobile-presence.ts`：外层期限 12 秒、取消清理、挑战剩余时间与过期响应处理。
- `core/apps/desktop/tests/mobile-probe-readiness.test.ts`：新增 4 项真实 Supervisor 方法回归，使用受控 Electron IPC 和模拟时钟。
- `packages/central-desktop/tests/mobile-presence-timeout.test.ts`：新增 4 项外层连接回归。
- `core/scripts/test-desktop-common.mjs`：原共享回归集合不变，追加 UWA 专有探测测试。
- `config/desktop-overlays.json`、`config/desktop-parity.json`：记录已审阅的 UWA 专有差异；openerx 受检源码内容及既有基线提交保持不变。

## 验证

- 9 秒才回复仍返回就绪；10 秒不回复则内部探测失败；迟到响应不复活旧探测，下一次新探测可成功。
- 外层 9 秒就绪可正常答复，12 秒一直无结果则返回未就绪；不因此重新注册通道。
- 服务端只剩 4 秒的挑战不会等待到 12 秒，迟到的就绪结果不会用于业务授权。
- 停止立即使待处理探测失效；格式错误的 IPC 回复仍被拒绝。
- Supervisor 新增 4/4 通过；中央连接的超时、续期、控制器 3 个测试文件共 32/32 通过。
- openerx 共同回归集合：桌面 274 项、其余 145 项；UWA：桌面 280 项、其余 145 项。首次运行两版各有 6 项 Pi 测试因沙箱无法建立认证锁文件而失败；使用独立 `PI_CODING_AGENT_DIR`、沙箱外补跑该文件后，当前两版各 8/8 通过。合并验证覆盖当前集合的全部用例，不把额外被文件名过滤器匹配到的历史副本计入回归数量。
- 两版共同检查中的 5 个工作区 TypeScript 检查通过；UWA central-desktop TypeScript 检查通过。
- UWA 对当前 openerx 的桌面一致性检查通过：446 个共享文件、117 个已审阅版本差异。
- 两仓库差异空白检查通过。

证据位于本机 `.codex-temp/desktop-probe-timeout/`。

## 交付状态

源码和回归已完成；保留已有 Android 修复和其他任务未提交的 package.json 修改。未提交 Git，未改变 UWA 外层记录的 core 提交指针，未修改服务端配置或部署。

本轮没有打包、更新已安装桌面或手机应用，也没有运行安卓真机加真实电脑的回复压力验收。此超时修复需更新 UWA 电脑端后才能进入实际使用。
