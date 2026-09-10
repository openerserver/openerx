# 桌面客户端可移植性与分发修复

日期：2026-09-10。基线 `0fba434`，工作分支 `codex/desktop-connection-20260910`。

本次修改通用客户端能力，不包含私有服务器、短信实现、企业账号或生产凭据。

- 个人 ZIP 导出在同一 SQLite 读取事务中保存项目说明、会话项目归属、附件关联及消息全部文本分段，供其他客户端通过显式预览迁移。备份仍保留记忆、技能和其他已有数据类别。
- 先选择 profile，再申请 Electron 单实例锁，确保隔离 profile 的身份一致。
- 更新器在校验签名后核对产品，拒绝其他产品的 manifest；网络读取禁止重定向、限制 10 秒请求时间，并在流式内容超过 1 MiB 时中止读取。
- Windows Store 打包和安装产物验证使用实际产品名、可执行文件及 bundle ID。自定义产品必须明确提供自己的 Store 配置，不自动继承默认 Store 身份。
- 修复设置分区的延迟焦点切换：用户已开始输入后不抢走焦点，切换分区或关闭时取消未完成的焦点任务。
- 修复 macOS 临时目录 `/var` 与 `/private/var` 路径别名导致的测试误报，保持实际工作区规范化行为。

公共 Store 配置继续位于 `apps/desktop/resources/windows-store.json`。构建时可通过 `OPENERX_WINDOWS_STORE_CONFIG` 指定配置、`OPENERX_WINDOWS_STORE_ICON` 指定 PNG；配置中的 executable 和 version 必须与实际应用一致。

本轮验证覆盖桌面、协议、应用服务、模型工具、数据导出、更新及打包。模拟 Windows 测试不能替代 Windows 原生运行、真实证书签名和商店认证。未执行商店提交或远端推送。

定向 JS/TS 测试共 530 项通过：desktop 219、contracts 64、app-service 76、pi-host 47、tool-sdk 119、observability 3、release 2；tool-sdk 另有 2 项平台条件跳过。涉及的类型检查通过。macOS arm64 本地包位于 `apps/desktop/out/UWA-darwin-arm64/UWA.app`，ASAR 产物与 fuses 验证通过，更新关闭，未进行发行签名。
