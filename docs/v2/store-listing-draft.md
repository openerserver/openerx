# OpenERX Microsoft Store 文案草稿

日期：2026-09-05。适用包：`openerx.OpenERX 2.0.1.0 / Windows 11 x64`。

本文件是当前首包的商店字段草稿，不代表已经提交认证、获准发布或完整产品合同已全部交付。正文依据当前源码、包 manifest 和验收记录编写。

## 商店字段约束

描述最多 10,000 字符；简短描述最多 1,000 字符，建议不超过 270；产品功能最多 20 条、每条 200 字符。商店会自动为功能加项目符号，输入框内只复制文字。首发提交的“此版本中的新增功能 / What's new”留空；以下发布说明仅供内部留档或后续更新使用。至少需要一张真实应用截图。[微软 MSIX 商店资料说明](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info)

关键词最多 7 项，每项最多 40 字符，全部合计不超过 21 个词；不添加其他产品商标或无关搜索词。[微软 MSIX 附加信息说明](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information)

## 简体中文 zh-CN

### 产品名称

```text
OpenERX
```

### 简短描述

```text
把对话、文件与个人项目放在同一个 AI 工作区，协助写作、整理资料和处理日常任务。使用前需配置自己的模型 API Key；云端模型需要联网，第三方服务可能收费。
```

### 描述

```text
OpenERX 是一个面向个人的桌面 AI 工作助手。用自然语言描述目标，添加需要参考的文件，在持续对话中推进写作、资料整理、内容分析和多步骤任务。

让任务和资料保持在一起
为不同工作创建个人项目，保存项目说明并按需连接本机目录。对话、文件和生成成果集中呈现，便于继续追问、查看历史和找到已有内容。

从讨论走向可查看的成果
让模型协助整理思路、总结资料、改写文本或生成文件。可以在对话中查看工具调用、执行状态和结果，并在需要时停止正在进行的任务。

按需要连接模型和工具
安装包默认采用自带密钥模式（BYOK）。在设置中配置支持的模型服务及 API Key，也可以配置兼容接口。可安装和管理 Skill，以扩展任务处理方式。文件与工具操作受应用权限设置约束，可查看和处理授权请求。

使用要求
此版本面向 Windows 11 x64，主要界面为简体中文。使用 AI 功能前，需要自行取得并配置有效的模型服务 API Key。云端模型需要可用的网络连接；第三方模型及相关服务可能单独收费，其可用性、费用及数据处理规则由对应服务商决定。安装本应用不包含模型调用额度。模型生成内容和工具执行结果需要由你检查确认。
```

### 产品功能（每项一个输入框）

```text
在持续对话中协助写作、总结和分析资料
添加文件与文件夹，结合所选资料开展任务
使用个人项目组织说明、目录和对话
查看与管理对话文件及生成成果
配置自己的模型 API Key 和兼容接口
查看工具执行状态及权限请求
安装和管理 Skill
停止任务并继续追问
```

### 关键词（每项一个输入框）

```text
AI助手
写作助手
文件分析
资料整理
个人项目
工作效率
BYOK
```

### 附加最低系统要求（每项一个输入框）

```text
Windows 11，x64 处理器
使用 AI 功能需自行配置有效的模型服务 API Key
云端模型需要联网，第三方服务可能产生费用
主要界面为简体中文
```

### 发布说明留档（首发商店字段留空）

```text
OpenERX 2.0.1.0 首个 Microsoft Store 提交版本，面向 Windows 11 x64。提供个人 AI 对话、文件与成果管理、个人项目、BYOK 模型配置、Skill 管理和工具权限界面。主要界面为简体中文；使用 AI 功能前需自行配置模型 API Key。
```

## English en-US

The English listing describes the same build. It does not claim that the current application has a fully translated English interface.

### Product name

```text
OpenERX
```

### Short description

```text
Bring conversations, files and personal projects into one AI workspace for writing and everyday tasks. Requires your own model API key. Cloud models need internet access and may incur third-party fees. Primarily a Simplified Chinese interface.
```

### Description

```text
OpenERX is a personal desktop AI work assistant. Describe your goal, add reference files and continue the conversation to work on writing, information organization, analysis and tasks with multiple steps.

Keep your work together
Create personal projects with instructions and optional local folders. Keep conversations, reference files and generated outputs together so you can return to earlier work and continue where you left off.

Turn ideas into reviewable work
Ask a model to help organize ideas, summarize information, revise text or generate files. Review tool activity, execution status and results in the conversation, and stop a task when needed.

Connect the models and tools you need
This build uses bring-your-own-key (BYOK) mode by default. Configure a supported model service and API key in Settings, or configure a compatible endpoint. Install and manage Skills to extend task workflows. File and tool operations are governed by the application's permission settings, with permission requests available for review.

Requirements
This release is for Windows 11 x64 and has a primarily Simplified Chinese interface. To use AI features, you must obtain and configure a valid model service API key. Cloud models require an internet connection. Third-party models and related services may charge separately; availability, pricing and data handling are governed by the respective providers. Installing this application does not include model usage credits. Review model-generated content and tool results before relying on them.
```

### Product features (one field per line)

```text
Conversational assistance for writing, summarizing and analysis
Add files and folders as task context
Organize instructions, folders and conversations in personal projects
Find and manage conversation files and generated outputs
Configure your own model API keys and compatible endpoints
Review tool activity and permission requests
Install and manage Skills
Stop tasks and continue the conversation
```

### Keywords (one field per line)

```text
AI assistant
writing assistant
file analysis
personal projects
productivity
BYOK
task workspace
```

### Additional minimum requirements (one field per line)

```text
Windows 11 with an x64 processor
A valid model service API key that you obtain and configure
Internet access for cloud models; third-party fees may apply
Primarily a Simplified Chinese user interface
```

### Release notes archive (leave the first-submission Store field blank)

```text
OpenERX 2.0.1.0 is the first Microsoft Store submission for Windows 11 x64. It includes personal AI conversations, file and output management, personal projects, BYOK model configuration, Skill management and tool permission controls. The interface is primarily Simplified Chinese. Configure your own model API key before using AI features.
```

## 字段事实依据与边界（不复制到商店正文）

| 内容 | 依据 | 限定 |
| --- | --- | --- |
| 商店名称、版本、架构和 Windows 11 最低版本 | `deliverables/OpenERX-2.0.1.0-store-x64/stage/AppxManifest.xml`：OpenERX、2.0.1.0、x64、MinVersion 10.0.22000.0 | 不将早期产品合同里的 Windows 10 支持矩阵写进当前首包文案。 |
| BYOK 默认模式和用户自备密钥 | `apps/desktop/src/main/model-service-settings.ts` 默认状态；`apps/desktop/src/renderer/App.tsx` 新任务配置提示及模型设置 | 早期 `01-product-contract.md` 的“无需准备 API Key”已与此默认安装包行为不一致；商店文案以实际行为为准。 |
| 可配置多个模型提供商及兼容接口 | `packages/contracts/src/model-service.ts`；`App.tsx` 模型设置 | 不承诺所有第三方模型实时可用，不写免费调用或内含额度。 |
| 个人项目、文件和成果入口 | `App.tsx` 项目上下文、文件选择、个人文件与成果界面；`docs/v2/release/03-personal-projects-update-notes.md` | 只宣传当前本机组织能力，不宣传已完成跨设备同步或移动端验收。 |
| 文本与文件成果 | `packages/pi-host/src/file-tools.ts` 的 artifact.write、artifact.office.write | 文案不承诺所有格式或任意文件内容解析均已验证。 |
| 工具状态、权限、停止 | `App.tsx` 工具结果卡、授权 UI、权限模式、停止操作 | 不写“每次操作都弹窗确认”，因为已有授权范围和权限模式会影响具体流程。 |
| Skill 安装与管理 | `App.tsx` 中安装 Skill、搜索及已安装列表 | 不承诺附带任何收费第三方服务。 |
| 主要中文界面 | `App.tsx` 当前可见字符串 | manifest 的 en-US 资源声明不等于完整英文 UI，本英文 listing 明示现状。 |
| 开源许可证 | 根 `LICENSE` / `README.md` 为 Apache-2.0 | 未核验公开源码 URL；当前 git origin 是 SSH 地址，不把它作为商店网站或支持链接。正文暂不以公开源码链接作卖点。 |
| Windows 桌面控制仍默认关闭 | `packages/contracts/src/desktop-control.ts`；`docs/v2/evidence/wdc-001-windows-desktop-control-2026-09-05.md` | 不在功能、截图文案或关键词中宣传可自动控制记事本、计算器及其他桌面应用。 |

## 仍需主流程处理的实际信息

- 商店价格由用户/现有账号配置决定；本草稿不宣称应用永久免费。模型 API 和相关第三方费用的说明必须保留。
- 需要真实可访问的隐私政策 URL、支持联系方式，以及可选的产品网站 URL；不从私有 git 地址推导公开网址，不编造联系邮箱或法律主体。
- 截图应来自所提交版本的实际界面，不包含 API Key、个人对话或其他敏感内容；如使用演示任务，应明确为演示内容，不用桌面自动操作截图暗示禁用能力可用。
- 首包命名仍存在 UWA / OpenERX 字符串混用。商店包名称已是 OpenERX，截图和审核说明应如实显示实际界面，避免使用仅存在于设计稿的换标界面。
- 英文 listing 可以提交；其界面语言限定必须保留，不能向海外用户承诺完整英文 UI。
- 现有发布记录仍有真实设备及签名验收未完成项。填写草稿不等于这些门禁已通过；最终是否提交认证由主流程根据具体构建和事实决定。
