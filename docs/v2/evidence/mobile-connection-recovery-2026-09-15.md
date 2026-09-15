# iOS 前台连接提示与自动恢复

日期：2026-09-15（Asia/Shanghai）

起点：`7e2e3d2`，干净工作区；分支：`codex/mobile-connection-recovery-20260915`。

用户报告：持续在 iOS App 前台使用时，偶发显示电脑断开。

## 已确认并修复的路径

| 原行为 | 修复后的行为 |
| --- | --- |
| 手机把 `degraded` 与真正的 `offline` 一起显示为离线，并在本地拦截命令；Gateway 实际接受 `degraded` 下的命令 | 显示“连接不稳定，正在自动重试”，以黄色标示；发送规则与 Gateway 一致。离线、关闭 Remote、撤销仍被拦截 |
| 任务页用 `canControl` 判断连接文案，归档任务或历史分支也会显示电脑未连接 | 使用独立的连接状态文案，显示“已连接 · 已归档任务”或“已连接 · 历史分支”；只读约束保留 |
| 手机发现、事件拉取、续期请求以及桌面 HTTP 请求可能一直等待，阻塞后续轮询 | 同时约束响应头和响应体的等待时间，超时中断请求；普通请求 15 秒，附件字节上传 120 秒。后续轮询可以重试 |
| Connector 初次 `start()` 位于重试循环外，临时失败会直接结束运行 | 在循环内启动，恢复网络后继续连接 |
| 状态写入已被服务端应用，但响应丢失：本地 revision 落后，之后恢复 online 不断冲突，或本地仍以为 online 而服务端停在 degraded | 标记未知结果，读取权威主机记录和 revision 后恢复；不通过重新注册来覆盖用户关闭 Remote 的决定 |
| 新命令的会话 revision 读取失败，被循环当成网络错误并把整台电脑标为 degraded | 在尚未应用的命令上返回任务失败回执；已接受但结果未知的命令继续原有去重/恢复语义 |
| 轮询每次添加的 AbortSignal listener 没有在定时器结束后移除 | 定时器或 abort 完成时都清理监听器 |

手机回到前台时也会立即检查主机和补读事件，不必等到下一轮定时器。

## 本机测试环境恢复

旧的 `mobile-content-runtime` 测试进程退出日志实际记录了 `ACCESS_TOKEN_EXPIRED`，其本地端口已停止监听。该 fixture 原先只登录一次，未续期，定时轮询的异常又没有处理。

本次为 fixture 增加桌面测试会话续期、同步更新授权和 Transport token、轮询失败重试，并重新启动服务与 Metro。它仍只使用合成账户、模拟模型和自身进程内的测试数据。

为原生显示验证增加 fixture stdin 命令：`presence degraded`、`presence online`、`presence offline`。这些命令仅存在于测试 fixture。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck:v2` | 全部工作区通过 |
| `npm run test:v2` | 167 个 Vitest 文件、1,084 项通过，2 项既有跳过；另 1 项 Node 测试通过 |
| `npm run build --workspace @openerx/mobile` | iOS / Android Hermes 导出通过 |
| Electron Remote E2E | 通过，包括桌面授权、加密命令、附件、账户历史、token 更新、重放、撤销与关闭 |
| `npm run check:boundaries:v2` | 475 个源文件通过 |
| `npm run check:release-graph:v2` | 328 个生产文件、48 条 workspace 边通过 |
| 本次修改文件 Biome / `git diff --check` | 通过 |

新增 19 项测试覆盖：状态与只读任务文案、Controller 对 online/degraded/offline/revoked 的发送判定、HTTP 头/体卡住后的恢复、登录续期卡住后的重试、初次连接失败、服务端已写入但响应丢失、恢复期间关闭 Remote、会话状态读取失败及监听器清理。既有附件和完整历史测试同时通过。

### iOS 原生观察

iPhone 17 / iOS 26.2 模拟器加载本次代码并连接恢复后的 fixture：

1. 将测试主机设为 `degraded`，任务页显示 **“连接不稳定，正在自动重试”**。
2. 恢复为 `online` 后，任务页自动显示 **“已连接 · 使用电脑上的模型”**；未手动刷新或重新配对。
3. 原生证据覆盖状态显示与轮询恢复。`degraded` 下的命令发送判定由 Controller 参数化测试覆盖，完整执行链路由 Electron E2E 覆盖。

本次未生成安装包，Android 真机及真实移动网络矩阵未运行。当前源码与 iOS 模拟器开发版已更新，已安装的正式客户端需要更新手机与桌面端版本后使用这些修复。
