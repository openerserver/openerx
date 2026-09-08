# Microsoft Store 认证说明草稿

日期：2026-09-05。产品：OpenERX；包身份：`openerx.OpenERX`；本次提交版本：`2.0.2.0`；目标：Windows 11 x64。界面内仍有 UWA 名称，指同一应用。

本文件是供 Partner Center 录入的审核说明草稿。它不含账号、密码、API Key 或签名材料，也不代表应用已通过商店认证。下面“需准备的审核条件”尚未满足时，不应将说明标为完整。

## runFullTrust 用途说明（英文录入稿）

```text
OpenERX is an Electron desktop AI workspace packaged as a classic Windows application. The package uses packagedClassicApp with mediumIL. runFullTrust is required to run the main Electron application and its bundled utility processes, access user-selected local project folders and files, create user-requested output files, store local application data and OS-protected model credentials, and run tools that the user enables for their tasks. Tool execution is governed by the application's permission controls and can be stopped by the user.

The application runs with the current user's standard desktop permissions. It does not request administrator elevation, install a Windows service or driver, or require changes to Windows security policies. The experimental Windows native desktop-control feature is disabled by default in this submission and is not advertised as a released feature. The Microsoft Store build disables the application's separate update feed and ordinary Run-key login-startup setting; package updates are delivered by Microsoft Store.
```

## runFullTrust 用途说明（中文核对稿）

OpenERX 是采用 Electron 实现的 Windows 桌面 AI 工作区，MSIX 以 `packagedClassicApp`、`mediumIL` 运行。`runFullTrust` 用于启动主程序及包内工具进程、访问用户选择的本机项目目录和文件、生成用户要求的成果文件、保存本地应用数据和操作系统保护的模型凭据，以及执行用户为任务启用的工具。工具操作受应用权限控制，用户可以停止任务。

应用使用当前用户的普通桌面权限；未申请管理员提权，不安装 Windows 服务或驱动，也不要求修改系统安全策略。实验性 Windows 原生桌面控制在首包中默认关闭，未作为正式功能宣传。商店版本关闭独立更新源及普通 Run 键开机启动设置，包更新交由 Microsoft Store 处理。

`runFullTrust` 是普通桌面进程所需的包能力，不等于管理员权限。微软要求对受限能力说明用途，具体是否批准由认证团队决定。[能力声明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)、[认证备注及受限能力说明](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)

## Notes for certification（英文录入稿）

```text
Date: 2026-09-05
App: OpenERX, package openerx.OpenERX, version 2.0.2.0, Windows 11 x64.
The current interface is primarily Simplified Chinese. UWA labels inside the interface refer to this same application.

First launch and account requirements
The default installation uses bring-your-own-key (BYOK) mode. No OpenERX/UWA account login is required for this mode. Installation does not include third-party model usage credits. Without a configured model API key, the home screen and local settings remain accessible; AI message sending is intentionally disabled and the home screen provides a link to model settings.

Basic review without a model credential
1. Launch OpenERX from the Start menu. The new-conversation home screen should load.
2. Select “前往设置 → 模型” (Go to Settings > Models), or open Settings and select “模型” (Models).
3. Confirm that “运行模式” (Run mode) is BYOK. No API key is pre-installed. Provider and compatible-endpoint settings are visible.
4. Return to “新对话” (New conversation). Without a saved valid credential, sending an AI message is unavailable. This is the expected initial state, not an account-login failure.

Review requiring a model credential
Use an authorized evaluation model credential provided separately for certification, or a credential the reviewer is authorized to use. In Settings > Models, choose the matching provider or compatible endpoint, enter its API key, base URL and model ID as applicable, test the connection, and save the configuration. Then start a new conversation and ask the model to summarize a short sample text. Test file-related actions only with a temporary folder and sample files created for review. Review permission requests before allowing an operation; the Stop control cancels a running task.

Cloud-model calls need network access to the configured provider. Provider availability, supported models, data handling and charges are controlled by that provider. This app does not supply third-party account subscriptions or credits. The optional managed-service mode is for separately configured deployments and is not the default path for this Store submission.

The experimental native Windows desktop-control feature is disabled by default. It is not necessary for the above review. Do not change Windows security policies to enable it. Microsoft Store manages package updates. Login startup is unavailable in this MSIX version.
```

## 需准备的审核条件（内部，不复制成凭据）

- 当前没有给认证团队配置专用模型服务或专用测试密钥。若认证人员无法使用已有授权凭据，核心 AI 生成功能就无法被完整验证。开发者应在最终提交前准备可用的评测接入方式，并通过 Partner Center 的非公开认证备注提供必要信息；不使用个人生产密钥，不把凭据写入本文件、源码、截图或商店公开文案。
- 评测接入方式应明确服务地址、模型 ID、有效期、合理额度和所支持功能；提供前需确认该服务及凭据允许用于第三方审核。不得编造可用账号或填写示例密钥冒充真实审核条件。
- 配置页字段名称和连接/保存顺序，应以最终上传包的真实截图与操作验证结果为准。凭据配置和模型生成尚未作为本次无密钥截图验收的一部分。
- 微软说明：认证团队无法完整测试应用，或所需外部服务不可用，可能导致认证失败。仅说明“BYOK 自备密钥”不保证满足审核条件。[微软认证备注要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)

## 无凭据真实截图检查范围

截图只签认以下事实：真实提交 payload 能在当前普通系统策略下启动；全新配置中没有预装密钥；主页提供模型设置入口；模型设置页可见。图片不证明 Store 安装成功、Store 签名成功、模型调用成功或 Windows 桌面控制通过验收。

检查清单：

1. 使用提交包的原始 `UWA.exe`、ASAR 和 renderer，记录 payload 哈希；不修改发布 fuse，不替换被策略阻止的可执行文件。
2. 新建独立 `userData` 和浏览器缓存目录，不读取已有个人对话、账号或 API Key。禁用实验性桌面控制，不提供模型凭据。
3. 先检查原始启动尺寸，再检查截图尺寸、整屏布局和关键控件边界；截图不得含密钥、个人目录内容或真实对话。
4. 通过实际控件从主页进入模型设置并返回。验证缺少密钥时发送不可用，以及空/不完整配置的可见处理；不发起收费模型请求。
5. 截图必须来自最终修正版 payload；早期截图或设计稿不得当作新包运行证据。

首次启动诊断（旧 payload，供排障）：2026-09-05 13:36 UTC，原始 `stage/app/UWA.exe` 在隔离的 `.codex-temp/store-screenshots-BAYlqj/profile` 中记录了 `desktop.started`、`renderer.interactive` 和 `service.ready`。标准 Playwright Electron launcher 随后等待主进程 inspector 超时，符合发布包禁用 `EnableNodeCliInspectArguments` 的设置；其测试进程已被清理。这不是 Windows SAC 拒绝的证据，也不是最终修正版截图验收。后续可保持相同原始 EXE 与 fuse，用受控的 renderer 调试连接采集页面；若 Windows 明确阻止原始 EXE，则停止该执行路径。

最终修正版 `2.0.2.0` 已使用原始 `stage/app/UWA.exe` 启动成功。采集时使用独立空白用户数据、真实 Pi Host、不提供模型密钥，实验性桌面控制保持关闭；未安装 MSIX、修改 Windows 策略、替换 runtime 或更改发布 fuse。主页与模型设置截图为原生 150% DPI 的 `1839 × 1137` PNG，未拉伸或添加营销图层。已实视截图并确认无个人对话或凭据；模型设置的 7 个密码字段为空。

实际控件检查通过：主页进入模型设置、返回主页、输入消息但无密钥时发送仍禁用、空密钥“测试连接”显示本地提示且没有发起网络请求、选择另一测试模型后还原。原生默认内容区为 `1226 × 758` CSS 像素，主页关键区域完整可见。`920 × 640` 响应式模拟存在纵向滚动、底部说明需滚动查看；该图片仅是 QA 记录，不是商店截图，也不作为原生最小窗口验收。测试进程已关闭，并通过精确可执行文件路径查询确认没有遗留进程。

发布截图：`deliverables/OpenERX-store-listing-assets/01-home-byok.png`、`02-model-settings-byok.png`。版本、MSIX/EXE/ASAR 哈希、图片尺寸、检查范围与中英文图注见同目录 `capture-report.json`。这组截图证明提交 payload 的界面运行，不证明 Store 安装/签名或原生桌面控制通过。
