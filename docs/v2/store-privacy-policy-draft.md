# OpenERX 商店隐私政策草稿

核查日期：2026-09-05。适用候选包：OpenERX 2.0.2.0，Windows 11 x64，Microsoft Store。开发者显示名称：openerx。数据流正文同样适用于此前 2.0.1.0；2.0.2.0 已修正界面中的第三方模型隐私提示。

以下中英文正文可分别复制进商店隐私政策文本字段。正文以商店页面的开发人员支持联系方式为联系入口；该支持联系方式必须先填写真实、由用户授权公开的值。不要把本文件的准备说明和证据附录一起复制。

## 中文正文

OpenERX 隐私政策

更新日期：2026 年 9 月 5 日

OpenERX 由 openerx 提供，是在您的 Windows 电脑上运行的 AI 工作客户端。本政策说明当前 Microsoft Store 版本如何处理使用应用时涉及的数据。

1. 本机数据与用途

应用在本机保存会话、消息、任务记录、设置、您添加的记忆、文件资料及生成结果，以便继续任务、检索资料和查看历史。导入文件时，应用可以建立受控副本并提取内容。授权工作区后，应用可以在授权范围内读取或修改文件。文件名、路径、内容和工具结果可能包含个人信息。

应用也会建立本机设备标识，并保存运行版本、平台及脱敏诊断事件。普通本机会话资料没有统一的按时间自动清除期限。

2. 模型服务及联网处理

使用 AI 功能需要配置可用的模型服务和相应凭证。使用自带 API 密钥（BYOK）时，应用向您配置或选择的模型服务发送请求。请求可能包含您输入的文字、相关会话历史、选用的记忆、用于任务的文件内容或图片，以及工具返回的相关结果，以生成回答、处理资料或执行您设置的任务。连接测试也会向所配置的服务发送测试请求。

您启用的记忆处理、定时任务或其他自动任务也可能在运行时调用所配置的模型服务。您可以停止任务、调整相关设置或移除模型凭证，以停止后续使用。

模型服务提供者会接收请求所需的凭证及通常的网络信息，例如 IP 地址。其数据存储地点、保存期限、训练用途和收费由该服务提供者的政策及您的账户设置决定。OpenERX 不代表第三方承诺其不保存数据或不将数据用于训练。请仅向所选服务提交您有权分享的信息。

当前商店版本默认使用本机资料与 BYOK 配置，没有预配置 OpenERX 账户或云同步服务；浏览本机资料不要求注册 OpenERX 账户。

3. 搜索、浏览器与扩展工具

在您使用或授权联网搜索、网站访问或扩展工具时，应用可能向相关搜索服务、网站及您连接的 MCP 服务发送搜索词、目标地址、工具参数及完成任务所需的数据。这些服务可能接收 IP 地址及与请求有关的网络信息。浏览器登录状态、网站 Cookie 及第三方服务接收的数据还受相应浏览器和服务的政策控制。连接第三方工具前，请检查其权限、功能及隐私政策。

4. 凭证与本机保护

应用使用 Windows 可用的系统保护机制加密保存模型 API 密钥及连接凭证。普通会话与文件保存在本机；其保护也依赖您的 Windows 账户权限和磁盘安全设置。远程模型端点使用 HTTPS；您自行配置的本机回环模型端点可以使用 HTTP。

5. 诊断与支持

应用在本机记录经过脱敏的生命周期事件和启动、内存等运行指标，用于排查故障。诊断导出设计为排除会话正文、文件内容、终端内容、截图、本地路径和凭证。您可以先查看诊断预览，再选择将诊断包保存到本机；如您主动向支持人员提供该文件或其他资料，相关内容将由您选择的联系渠道传递。请在发送前检查其中的信息。

6. 您的选择与数据管理

您可以在应用中导出个人数据、删除会话或记忆、撤销文件及目录授权、移除模型 API 密钥，以及关闭或移除扩展工具。停止授权会影响后续访问，但不会收回已经发送给第三方的数据。

删除会话会将其标记为已删除；本地数据库记录、附件或此前导出的副本可能仍然保留。若需完整清理本机数据，请先备份所需资料，再清理应用用户数据及自行导出的文件，或通过下述支持渠道获取帮助。第三方服务中已经保存的数据需根据该服务的规则处理或向该服务提供者申请删除。

7. 联系与更新

如需隐私相关帮助、查询或处理您主动提供给开发者的支持资料，请通过 OpenERX 的 Microsoft Store 页面所列的开发人员支持联系方式与 openerx 联系。请勿在支持请求中发送 API 密钥或不必要的敏感资料。

我们会根据应用功能和实际数据处理方式更新本政策，并在商店页面提供更新后的内容。Microsoft Store 和 Windows 自身的数据处理适用 Microsoft 的相应隐私政策。

## English text

OpenERX Privacy Policy

Last updated: September 5, 2026

OpenERX is an AI work client for your Windows computer, provided by openerx. This policy describes data handling in the current Microsoft Store version.

1. Local data and purposes

The app stores conversations, messages, task records, settings, memories you add, file materials, and generated results on your computer so you can continue tasks, find materials, and review history. When you import a file, the app may create a managed copy and extract its content. After you authorize a workspace, the app can read or modify files within that authorization. File names, paths, content, and tool results may contain personal information.

The app also creates a local device identifier and stores version, platform, and redacted diagnostic events. Ordinary local conversation data does not have a single automatic deletion period based on age.

2. Model services and network processing

AI features require an available model service and the necessary credentials. With bring-your-own-key (BYOK), the app sends requests to the model service you configure or select. Requests may include your input, relevant conversation history, selected memories, file content or images used for a task, and relevant tool results to generate responses, process materials, or perform tasks you configure. Connection tests also send a test request to the configured service.

Memory processing, scheduled tasks, or other automatic tasks you enable may call the configured model service when they run. You can stop tasks, adjust the relevant settings, or remove model credentials to stop future use.

Model providers receive the credentials required for requests and ordinary network information such as your IP address. Their storage locations, retention, training practices, and charges depend on their policies and your account settings. OpenERX does not promise on a third party's behalf that it will not retain data or use it for training. Only submit information you are entitled to share with the selected service.

The current Store version defaults to local data and BYOK settings and does not come with a preconfigured OpenERX account or cloud synchronization service. Browsing local materials does not require an OpenERX account.

3. Search, browsers, and extension tools

When you use or authorize web searches, website access, or extension tools, the app may send queries, target addresses, tool parameters, and task-related data to the relevant search services, websites, and MCP services you connect. These services may receive IP addresses and other request-related network information. Browser sign-in state, website cookies, and data received by third-party services are also subject to the relevant browser and service policies. Review a third-party tool's permissions, behavior, and privacy policy before connecting it.

4. Credentials and local protection

The app encrypts saved model API keys and connection credentials using system protection available on Windows. Ordinary conversations and files are stored locally; their protection also depends on your Windows account permissions and disk security settings. Remote model endpoints use HTTPS. A local loopback model endpoint that you configure may use HTTP.

5. Diagnostics and support

The app records redacted lifecycle events and startup and memory metrics locally for troubleshooting. Diagnostic exports are designed to exclude conversation text, file content, terminal content, screenshots, local paths, and credentials. You can review a diagnostic preview before choosing to save a package locally. If you choose to send that file or other materials to support, those materials are transmitted through the contact channel you choose. Review their contents before sharing them.

6. Your choices and data management

You can export personal data, delete conversations or memories, revoke file and directory access, remove model API keys, and disable or remove extension tools in the app. Withdrawing access affects future access and does not recall data already sent to third parties.

Deleting a conversation marks it as deleted; local database records, attachments, or previously exported copies may remain. To completely clear local data, first back up materials you wish to keep, then clear the app's user data and files you exported, or contact support for assistance. Data already held by a third-party service must be handled under that service's rules or deleted by contacting its provider.

7. Contact and updates

For privacy assistance, questions, or requests concerning support materials you voluntarily provided to the developer, contact openerx through the developer support contact listed on the OpenERX Microsoft Store page. Do not send API keys or unnecessary sensitive information in support requests.

We will update this policy as app features and actual data practices change and make the updated text available on the Store page. Microsoft Store and Windows process data under Microsoft's applicable privacy policies.

## 提交前核查与证据（不复制到门户）

- 需要用户提供愿意公开的支持邮箱或支持 URL。仓库未找到已存在的公开联系方式，不能从开发账号、私有 Git SSH 地址或测试邮箱推导。
- 主体仅使用门户已核实的开发者显示名称 openerx；本文件不替用户声明公司法律名称、注册地、未成年人定位、数据交易安排或第三方训练承诺。
- BYOK 默认模式及模型设置：`apps/desktop/src/main/model-service-settings.ts:137`、`:216`、`:245`；真实执行：`packages/pi-host/src/host.ts:629` 及 `:939`。
- 系统保护凭证：`apps/desktop/src/main/credential-vault.ts:37`、`:112`；本机资料与平台服务条件：`apps/desktop/src/main/index.ts:1383`、`:1409`、`:1467`。
- 本机日志、大小上限与最近 1,000 条导出：`packages/observability/src/service.ts:109`；本机导出选择：`apps/desktop/src/main/index.ts:366`、`:391`。
- 会话删除是逻辑删除：`packages/storage/src/chat-repository.ts:535`。不能宣称立即销毁数据库记录及所有附件。
- 搜索外联：`packages/tool-sdk/src/bing-html-search-provider.ts:261`、`packages/tool-sdk/src/baidu-json-search-provider.ts:113`；用户连接 MCP 服务：`packages/tool-sdk/src/mcp-adapter.ts`。
- 已检索 desktop、app-service、sync-service 和 packages 源码，没有发现 Sentry、CrashReporter、PostHog、Mixpanel 等应用级遥测上传实现；这不足以承诺 Windows、Microsoft Store、第三方网站或依赖永不处理诊断数据，因此正文只描述已核实的本机诊断路径。
- UI `apps/desktop/src/renderer/App.tsx:2036` 原“内容不会用于模型训练”已改为“模型数据处理以服务商政策为准”，并在 `:2048` 补充模型内容发送与第三方保存/训练说明；修正已进入 2.0.2.0 候选包。商店政策正文没有作第三方不训练的绝对承诺。
- 微软现行 [MSIX Support info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info) 明确允许直接提供隐私政策文本；[Store Policies 10.5](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#105-personal-information) 要求说明数据类型、用途、存储/保护、第三方和用户控制。本草稿依据源码事实组织，不构成对所有法域合规结果的认证。
