# Android 前台连接误判修复

日期：2026-09-16（Asia/Shanghai）。用户报告安卓 App 持续在前台时频繁显示电脑断开，电脑保持开机。

## 与既有修复的关系

此前 `9323008` 的通用 Remote 修复记录见 [mobile-connection-recovery-2026-09-15.md](mobile-connection-recovery-2026-09-15.md)，原生验收以 iOS 为主，没有完成 Android 真机网络验收。当前 UWA 手机入口使用独立的中央服务连接实现，不能以通用 Remote 的修复或 iOS 结果代替其 Android 验收。

本机 UWA 仓库实际位于相邻的 `openerx-enterprise`（历史文档称 `openerx-advanced`），修复基于 `07fac86`。此次仅修改 UWA 手机环境监听，不涉及两版共用桌面代码或中央服务协议。

## 已确认的代码路径

- UWA `apps/mobile/App.tsx` 将 `isConnected === true && isInternetReachable !== false` 作为允许网络工作的条件。
- 本地已安装的 `expo-network` Android 实现使用 `NET_CAPABILITY_VALIDATED` 等系统网络能力计算 `isInternetReachable`。这不是对 UWA 服务地址的实际连通性验证。
- 即使网络接口仍然连接、服务仍可达，只要这个标志为 false，`MobileCloudController.setEnvironment()` 就会锁定业务界面、终止当前请求及轮询。UI 随后显示等待电脑连接。系统标志波动会重复触发此路径。
- 原监听只在启动时主动读一次网络状态；前台恢复依赖网络事件。启动时的旧异步读取还可能覆盖更新的网络事件。

这条错误路径通过连接控制器 fixture 复现：初始电脑可用，输入 `isConnected: true, isInternetReachable: false` 后，旧逻辑的 `businessAvailable` 从 true 变为 false。未采集用户真机日志，不能认定这是用户本次所有断线的唯一原因。

## 修改

UWA 中的文件：

- `apps/mobile/App.tsx`：接入可独立验证的环境监听。
- `apps/mobile/src/central/mobile-environment.ts`：Android 仅在接口明确断开时暂停请求；系统互联网验证标志不再直接关闭业务连接。未知或初次读取失败时允许已有认证请求自行验证服务。回到前台重新读取网络状态；序号防止旧读取覆盖新事件；清理后忽略迟到回调。
- `apps/mobile/tests/mobile-environment.test.ts`：8 项回归，覆盖前台标志波动、启动、实际断网、前台补读、异步时序、初次读取失败、iOS 行为与监听清理。

原有服务器主机探测、账号与配对校验继续执行。测试同时验证：即使忽略 Android 系统验证标志，服务端确认电脑离线时仍关闭业务访问。

## 验证和交付边界

| 检查 | 结果 |
| --- | --- |
| 对原 App 环境监听的等价复现 | 前台标志切换回归按预期失败，证明原路径会锁定已连接页面 |
| 新增回归 | 8/8 通过 |
| UWA mobile 完整 Node 测试 | 164 项中 163 通过；1 项既有 Android 构建配置测试在创建文件符号链接时遇到 Windows `EPERM`；沙箱外复跑仍相同 |
| UWA mobile TypeScript | 通过 |
| 新增文件 Biome 检查 | 通过 |
| Git diff 空白检查 | 通过 |
| Android Expo/Hermes 导出 | 通过，1316 模块；不等同 APK 原生构建或真机验收 |

本机证据位于 `.codex-temp/android-connection-recovery/`，含回归复现、完整测试日志和 Android 导出。已有其他任务的 package.json 修改保持原样。本轮未提交、未发布、未修改服务器、未生成 APK、未替换任何已安装手机或桌面应用。本机未找到可用 Android SDK/adb，因此尚未执行用户安卓真机复测。
