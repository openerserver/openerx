# P1 Codex 对齐 CX-110-D3 签名 macOS 桌面生命周期证据（2026-08-27）

> 状态：`PASS / SIGNED MACOS ARM64 LOCAL CHECKPOINT`；完整 CX-110 与发布 Gate 仍为 `IN PROGRESS`
>
> 时间：2026-08-27 16:25（Asia/Shanghai）
>
> 基线：`HEAD 732c21aa8cd4e69187150f3ea888ed751eb50129` 加当前 CX-110-D3 实现
>
> 范围：Developer ID 签名身份、TCC/Accessibility 有效执行、隔离安装/升级/回滚、用户 Profile 保留和桌面操作 fail-closed

## 1. 结论

CX-110-D3 已完成当前 Mac 的签名桌面本地检查点。`UWA.app` 使用 Developer ID Application
签名，固定 bundle ID `com.openerx.desktop`，启用 hardened runtime，并携带 Apple Events 用途说明及
自动化 entitlement。签名校验、指定需求、Screen Recording、Accessibility、真实 System Events
调用和同身份版本切换均已通过。

签名包从 Pi 工具请求开始，经 Capability Broker 的逐次审批进入 Desktop Main；真实捕获受 bundle ID、
PID、CGWindow ID、窗口标题、截图尺寸和 60 秒有效期约束。受控 TextEdit 正向用例完成截图、点击和文本
插入，随后由 TextEdit 自身 API 外部读取精确内容；错误 bundle ID 在执行前返回
`DESKTOP_CAPTURE_IDENTITY_MISMATCH`，目标文档未出现负向标记。

安装生命周期在隔离的临时 Applications 根中完成 `2.0.0-alpha.0 → 2.0.0-alpha.1 →
2.0.0-alpha.0` 真回滚。三次均启动签名应用并复用同一用户 Profile；账户 ID、Conversation、SQLite、
设备身份、系统 Keychain-backed 加密凭据均保持。测试只删除其唯一测试 Keychain 项和临时目录，不触碰
用户现有 UWA Profile。

这仍不是发布完成：当前包没有 Apple 公证票据，没有验证 DMG/Finder 到 `/Applications` 的 Gatekeeper
安装，也没有 Windows 原生实现或签名矩阵。

## 2. 签名与运行身份

| 项目 | 已验证结果 |
| --- | --- |
| 应用身份 | `CFBundleIdentifier=com.openerx.desktop`，所有候选包具有同一 designated requirement |
| 发布者 | `Developer ID Application: lei wang (3CGJAP2V67)`；Team ID `3CGJAP2V67` |
| 运行时 | Developer ID authority、时间戳、hardened runtime、deep/strict signature 均通过 |
| Entitlements | 根应用包含 `com.apple.security.automation.apple-events` 与 Electron JIT；子进程使用继承 entitlement |
| 用途说明 | `NSAppleEventsUsageDescription` 随包写入 Info.plist |
| TCC | 签名应用读取到 Screen Recording 与 Accessibility 为 `granted`；实际 System Events 点击和 AX 文本写入成功 |
| 公证 | 未执行；本机没有本任务所需的 Apple API Key 凭据，验证器明确输出 `notarization=not-required` |

`apps/desktop/forge.config.ts` 在本地只有显式设置 `OPENERX_MAC_SIGN_IDENTITY` 时签名；release mode
继续 fail-closed，除签名身份外还强制要求公证和更新配置凭据。本地 D3 不降低正式发布条件。

## 3. 包内运行时依赖

真实签名生命周期首次运行暴露出 App Service 包内缺少 `@resvg/resvg-js` 的问题。Forge Vite 插件只复制
`.vite` 产物，无法依赖工作区根的 node_modules。D3 将 `@resvg/resvg-js` 和目标架构 native package
作为 Desktop 直接依赖，在 `packageAfterCopy` 中复制到包内，并将 `.node` 文件放入
`app.asar.unpacked`。签名包随后实际启动 App Service，而不是只通过静态 ASAR 检查。

App Service Supervisor 同时把 Utility Process 的 stdout/stderr 持久化到受控 Profile 日志，并在退出错误中
保留 exit code，使包内依赖缺失不再只表现为模糊的 readiness timeout。

## 4. 安装、升级与回滚

`apps/desktop/scripts/e2e-macos-lifecycle.mjs` 执行以下过程：

1. 从刚构建的签名包生成 baseline 与 upgrade 候选，修改 bundle 版本后重新 Developer ID 签名。
2. 对两个候选执行 deep/strict 校验，并确认 designated requirement 完全相同。
3. 使用 staged bundle + rename 安装 baseline；启动真实签名可执行文件并通过 CDP 驱动 Renderer。
4. 登录本地 Platform Alpha、建立计费余额和 Conversation，并确认 SQLite 与加密设备会话已落盘。
5. 安装 upgrade，使用同一 Profile 重启并核对账户、Conversation、数据库、设备摘要和凭据。
6. 重新安装原 baseline 完成版本回退，再次启动并执行同一组数据保持断言。
7. 清理测试专用 Keychain 项、TextEdit 文档和临时 Applications/Profile 根。

成功终态为：

```text
CX110_D3_MACOS_LIFECYCLE_OK install=2.0.0-alpha.0 upgrade=2.0.0-alpha.1 rollback=2.0.0-alpha.0 identity=stable profile=preserved
```

这里验证的是同一签名身份下的本地 bundle 替换和数据兼容性。两个候选来自同一次代码构建，仅 bundle
版本和生命周期标记不同；它不是两个正式发布制品、原生自动更新 feed 或数据库跨版本迁移的替代证据。

## 5. TCC 与受控桌面交互

### 5.1 用户授权

- Desktop 工具中心显示 Screen Recording 和 Accessibility 的真实状态。
- 用户可分别请求权限；Main 使用 Electron 系统 API 触发请求或打开相应系统设置页。
- 每个截图、点击和输入仍分别经过 Capability Broker 审批，系统权限不替代产品审批。
- 权限缺失、状态未知或自动化组件缺失时，工具保持 unavailable/degraded，不静默降级。

### 5.2 截图到操作的身份绑定

macOS 截图先通过 CoreGraphics 由 bundle ID 解析 PID、CGWindow ID 和窗口标题，再从 Electron
`desktopCapturer` 中选择相同 window ID。短时 capture record 保存应用、bundle、原生进程/窗口身份和
截图尺寸；交互前再次确认原生窗口仍存在，随后校验 PID、bundle、前台窗口标题与相对坐标边界。

显示名称不参与安全身份判断：CoreGraphics 在当前中文系统返回“文本编辑”，System Events 返回
“TextEdit”。D3 已移除这种跨 API、本地化相关的错误比较，改用不可本地化的 PID + bundle ID +
窗口身份。

### 5.3 输入准确性

原实现使用 `System Events keystroke`，在当前中文输入法下会把 ASCII 标记转换为候选词，即使脚本返回
成功也没有写入请求文本。D3 改为对目标进程当前 `AXFocusedUIElement` 设置 `AXSelectedText`，因此不依赖
键盘布局，也不需要临时覆盖系统剪贴板。E2E 同时断言工具结果和 TextEdit 外部可读内容，禁止假阳性。

正向与负向证据：

```text
[cx110-d3] bundle-bound TextEdit capture and approved type succeeded
[cx110-d3] mismatched bundle identity failed closed without typing
```

## 6. Fail-closed 边界

| 情况 | 行为 |
| --- | --- |
| 无 Screen Recording | Desktop 不进入 Turn 工具集 |
| 有截图、无 Accessibility | 只允许截图，交互显示 degraded |
| 截图无 bundle ID | 后续交互返回 `DESKTOP_CAPTURE_IDENTITY_MISSING` |
| bundle 与截图不一致 | 返回 `DESKTOP_CAPTURE_IDENTITY_MISMATCH`，不触达系统操作 |
| capture 过期或坐标越界 | 分别返回 `DESKTOP_CAPTURE_EXPIRED` / `DESKTOP_COORDINATES_OUTSIDE_CAPTURE` |
| 原生窗口被替换 | CGWindow ID 复核失败，返回 `DESKTOP_TARGET_WINDOW_CHANGED` |
| 目标不可编辑 | AX 写入失败并返回 `DESKTOP_TARGET_NOT_EDITABLE` |
| Windows | 明确返回 `DESKTOP_WINDOWS_NATIVE_CONTROL_UNAVAILABLE`；已移除未达到安全身份约束的 PowerShell 模拟控制 |

## 7. 自动化命令

签名包构建与 D3 门禁：

```bash
OPENERX_MAC_SIGN_IDENTITY='Developer ID Application: lei wang (3CGJAP2V67)' npm run package:cx110:d3:macos
OPENERX_MAC_SIGN_IDENTITY='Developer ID Application: lei wang (3CGJAP2V67)' npm run check:cx110:d3:macos
```

`check:cx110:d3:macos` 先执行签名、bundle ID、hardened runtime、entitlement 和 designated
requirement 校验，再运行签名应用生命周期。Desktop 单元测试覆盖权限矩阵、窗口选择、capture registry、
AppleScript/JXA 生成与错误归一化、Renderer 权限入口。

2026-08-27 16:25（Asia/Shanghai）的完整 `npm run check:v2` 为 `exit 0`：222 个边界源文件、
162 个 production 文件、318 个 Biome 文件、全部 workspace TypeScript、workspace 265 + 根目录 61
（合计 326）个测试，以及 iOS/Android 导出、Electron production bundle、Fuse 和 release artifact
检查均通过。通用门禁生成的 unsigned 包与 D3 Developer ID 专项包分开验证；两套门禁均为绿。

## 8. 剩余限制

- Apple notarization/stapling、DMG、Gatekeeper 首次下载隔离和真实 `/Applications` 安装仍是 M9 发布门禁。
- 当前 TCC 证据来自这一台 Mac 的既有授权与同 designated requirement 版本切换；没有重置用户 TCC 数据来模拟首次授权。
- 高影响 `submit/send/delete/purchase` 继续由逐次审批和副作用不确定性合同约束；D3 不对用户真实账户执行这些动作。
- Windows Desktop/Shell 原生沙箱、签名安装/升级/回滚尚未完成，运行时继续 fail-closed。
- live Web/图片 Provider、任意第三方 MCP OAuth 和任意第三方 Office 预览仍缺独立实网证据。

因此只能把 `CX-110-D3` 标为签名 macOS arm64 本地检查点通过；完整 CX-110、P1 和 V1 Release 均不能
标记为完成。
