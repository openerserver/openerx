# 移动端审批修复 · 2026-09-16（Asia/Shanghai）

## 结果与范围

- openerx 与 UWA（`openerx-advanced/core`）共同修复工具授权 Broker：已明确选择的同会话、同资源、同动作 L0–L3 session Scope 可覆盖后续 per-call 操作；已有 WorkspaceGrant 本身不能跳过第一次远程 Bash 审批。Scope 仍按原有撤销、会话隔离及有效期规则生效。
- 手机增加“完全允许”，通过 `permission.decide` 的 `full_access` 决定接入现有 `ToolAppService.setPermissionMode`。仅开启当前会话完全访问，并释放该会话等待中的操作；其他会话不受影响，工作区、网络和操作系统权限不扩大。
- 手机 UI 对 L4/L5 隐藏原本会被拒绝的“本会话允许”，保留本次允许、完全允许和拒绝。UWA 控制器和两版桌面仍拒绝不合法的 session 决定。
- openerx、UWA v3 与可选 legacy 页面移除审批中的生物识别调用。前台确认直接发送 `biometricVerified: false`，时间沿用兼容字段 `reauthenticatedAt`；桌面取消 L5 生物识别门槛，仍检查原控制器、会话、时效、pending 状态及 payload digest。拒绝操作不再受设备解锁字段阻塞。
- UWA Go 数据服务接受新的 `full_access` 枚举并保留严格会话绑定及载荷验证。

初始工作树干净，可恢复起点：openerx `163ff44`、UWA `4d8450f`、UWA core `ccb73bbf`。未复制应用输出或用户资料。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| openerx `npm run test:desktop-common` | 通过；5 个项目类型检查，17 个桌面测试文件／129 项，11 个公共服务测试文件／112 项 |
| UWA `npm run test:desktop-common` | 通过；5 个项目类型检查，17 个桌面测试文件／130 项，11 个公共服务测试文件／112 项 |
| UWA 移动端 `npm test --workspace @openerx/mobile` | 149 项通过 |
| UWA 移动端 `npm run test:ui --workspace @openerx/mobile` | 90 项通过；按钮确认、可用性、范围和高风险显示 |
| UWA core `tests/central-remote-service.test.ts` | 23 项通过；本次／session／full_access 经 v3 适配器恢复任务 |
| UWA Go `go test ./internal/protocol` | 通过；新枚举、无生物识别载荷、非法决定及缺失会话校验 |
| 两版移动端类型检查 | 通过 |
| 两版移动端 iOS 与 Android Expo/Hermes 导出 | 全部通过，固定 `apps/mobile/dist/ios` 与 `dist/android` 输出 |

回归实际调用 App Service、SQLite、Broker 和手机控制器；远程 Bash 集成使用 fake sandbox runner，不代表真机或生产模型执行。覆盖原控制器限制、跨会话拒绝、错误 digest、新鲜度、L5 无生物识别允许／拒绝、后续 Bash 复用 session Scope、Scope 撤销及其他资源继续询问。公共检查已加入 `packages/tool-sdk/tests/broker.test.ts`。

两版差异按现有品牌／中心账号扩展记录核对，运行检查后更新 UWA `config/desktop-parity.json`，并再次对当前 openerx checkout 验证。

## 交付状态

源码与本地检查已完成，iOS／Android JavaScript 构建产物已验证。没有生成或替换桌面安装包，没有安装手机真机应用，没有部署中心服务；未声称真机 Face ID 实测。实际生效需要更新手机与电脑端；UWA 还需更新中心数据服务以接收 `full_access`。旧桌面如果返回生物识别要求，手机会提示更新电脑端。
