# V1 Codex 文件、工具与 Skill 能力基线合同

> 状态：`APPROVED_PRODUCT_SCOPE / IMPLEMENTATION_IN_PROGRESS`
>
> 基线日期：2026-08-25
>
> 合同类型：V1 文件、工具、Skill 功能范围与发布门禁

## 1. 合同解释

`已确定`：OpenerX V1 的文件、工具和 Skill 能力按照 Codex 桌面产品在基线日期公开提供的能力设计和验收。

“按照 Codex 能力支持”在本合同中表示：

- 用户能够在 OpenerX 中完成同类文件、浏览、搜索、命令执行、MCP 和 Skill 工作。
- 每项能力在 Windows 和 macOS 都有正式实现、权限边界、错误恢复和端到端测试。
- 能力不能只存在于内部 API、实验开关、演示脚本或某一个开发者环境中。
- OpenerX 使用自己的产品语言、领域模型和安全实现，不复制 Codex 私有协议、界面或品牌。
- 本基线冻结 V1 范围；Codex 在 2026-08-25 之后新增的能力不会自动进入 V1。

本合同不把 Codex 的代码审查、Git 工作流、团队管理、语音或定时任务自动纳入 V1；这些不属于本轮明确锁定的“文件、工具和 Skill”范围。远程移动端控制已经由最新产品决定单独纳入 V1，范围和门禁以 [15-remote-control-contract.md](15-remote-control-contract.md) 为准。

实现边界同样冻结：上述能力作为工具和上下文注册给 Pi，由 Pi 完整负责 Agent Loop、Session、上下文压缩、内部重试以及工具调用开始/结果回填/继续运行。V2 Capability and Permission Broker 只负责 Scope、审批、沙箱、实际系统调用、副作用幂等和审计，不实现另一套 agent harness。

## 2. 文件能力基线

| ID | V1 必须能力 | 用户可见结果 | 关键边界 |
| --- | --- | --- | --- |
| FILE-01 | 添加文件 | 选择、拖放、粘贴文件或图片，解析状态可见 | 只读取用户添加的文件 |
| FILE-02 | 添加文件夹/工作区 | 用户可授权一个文件夹，并查看路径、读写范围与有效期 | 阻止路径穿越和符号链接逃逸 |
| FILE-03 | 搜索与引用 | 可在授权文件中搜索，并引用文件名、页码、工作表、单元格范围或文本位置 | 引用必须可回到来源 |
| FILE-04 | 创建与编辑 | 可创建、修改、重命名和保存文本、代码、文档、表格、演示文稿及结构化文件 | 不静默覆盖原文件；修改形成版本或可审阅差异 |
| FILE-05 | 办公文件预览 | DOCX、XLSX、PPTX 和 PDF 可在客户端预览 | 预览失败不影响下载或另存 |
| FILE-06 | 图片与 HTML | 常见图片可查看；HTML 可在隔离环境中查看渲染结果和源码 | HTML 不获得桌面 Bridge 或 Node 权限 |
| FILE-07 | 成果复用 | 生成文件可打开、下载、另存、再次加入对话和生成新版本 | Artifact 使用稳定 ID，不依赖 Pi 临时路径 |
| FILE-08 | 云同步 | 对话附件云副本、个人文件记录和成果版本可随账户同步 | 本地绝对路径和设备授权不跨设备继承 |

首批解析与成果格式至少包括：PDF、DOCX、XLSX、CSV、PPTX、TXT、Markdown、常见代码/JSON/YAML、PNG、JPEG、WebP 和 HTML。加密、损坏、超大或不支持的文件必须给出可操作错误。

## 3. 工具能力基线

| ID | V1 必须能力 | V1 行为合同 |
| --- | --- | --- |
| TOOL-01 | 文件读取、搜索、创建和补丁式修改 | 受当前文件/文件夹 Scope 限制，修改目标和差异可审阅 |
| TOOL-02 | 第一方 Web 搜索 | 支持时效信息、来源列表和可打开引用；搜索活动进入工具记录 |
| TOOL-03 | 内嵌隔离浏览器 | 支持打开网页、本地 Web 应用、导航、点击、输入、截图、上传和下载；与主 Renderer 及用户日常浏览器 Profile 隔离 |
| TOOL-04 | 计算机/桌面应用操作 | 通过明确启用的工具读取屏幕并执行受控交互；登录、发送、购买、删除和提交等高影响动作逐次确认 |
| TOOL-05 | Shell 与代码执行 | 终端绑定当前对话和授权工作目录；输出流式可见；支持输入、停止、超时、长进程和退出状态 |
| TOOL-06 | MCP | 支持本地 STDIO 与远程 Streamable HTTP；支持 Bearer/OAuth；展示服务、工具、认证和连接状态 |
| TOOL-07 | 工具目录与内置生产力工具 | 工具按来源/命名空间分组并可按需发现；至少包含确定性计算、文件转换/渲染、结构化数据处理和平台提供的图片生成能力 |
| TOOL-08 | 工具过程 | Pi 工具调用事件投影到对话中的可折叠活动，包含状态、输入/目标摘要、结果、来源、耗时和错误；原始 Pi/工具协议不作为普通用户主界面 |
| TOOL-09 | 取消、重试与幂等 | Pi 管理调用生命周期和把结果送回 Agent Loop；Broker 可取消实际执行，外部写操作使用幂等键，重试不得重复产生副作用 |
| TOOL-10 | 沙箱与审批 | V2 Broker 默认只写授权工作区且 Shell/脚本无任意网络；网络、浏览器、桌面控制和外部写入按风险分级，越出 Scope 前必须请求授权 |

浏览器会话、系统 Shell 和桌面应用操作均属于设备能力，不能因为账户在另一台设备已经允许而自动继承授权。

## 4. Skill 能力基线

V1 Skill 采用开放目录包，而不是把工作流写死在聊天前端。

标准结构：

```text
skill-name/
  SKILL.md             # 必需：name、description 和完整说明
  scripts/             # 可选：可执行脚本
  references/          # 可选：参考资料
  assets/              # 可选：模板和资源
  agents/openai.yaml   # 可选：外观、依赖和能力声明
```

| ID | V1 必须能力 | V1 行为合同 |
| --- | --- | --- |
| SKILL-01 | 内置 Skill | 平台可随客户端提供经过签名和测试的系统 Skill |
| SKILL-02 | 个人/工作区 Skill | 用户可从本地目录、受支持归档或平台目录安装；可限定为个人全局或当前工作区 |
| SKILL-03 | 显式触发 | 用户可从输入框或 Skill 选择器明确选择某个 Skill |
| SKILL-04 | 自动触发 | 系统可依据 `description` 匹配任务；实际启用的 Skill 在执行前后可见 |
| SKILL-05 | 渐进加载 | 模型先获得名称与描述，选中后再加载完整 `SKILL.md` 和任务需要的资源 |
| SKILL-06 | 脚本和资源 | Skill 可以包含脚本、参考资料和模板；Pi 加载任务需要的内容，脚本只能通过同一 V2 Capability and Permission Broker 执行 |
| SKILL-07 | 来源与依赖 | 安装页显示来源、版本、发布者、校验值、工具/MCP 依赖、文件/网络/执行权限和支持平台 |
| SKILL-08 | 生命周期 | 支持启用、禁用、更新、权限重置、卸载；更新新增权限时重新确认，并保留可恢复版本 |
| SKILL-09 | 账户同步 | 同步安装记录、版本选择和非敏感设置；每台设备重新取得本地文件、Shell、浏览器和桌面控制权限 |
| SKILL-10 | 失败隔离 | 单个 Skill 缺失、损坏或执行失败不阻止普通聊天；错误说明可修复动作 |

V1 不建设组织管理员分发和审批中心；它属于 Future Enterprise。个人安装第三方 Skill 仍必须经过来源提示、权限预览和安全检查。

## 5. 模型与能力兼容

平台模型目录必须为每个模型声明：

- 文本、图片、文件输入能力。
- 工具调用、并行工具、MCP 和长上下文能力。
- 是否支持图片生成等专用输出。
- 上下文限制、可用状态和相对速度。
- 当前价格引用和用户可见计价摘要；收费工具同样必须进入价格目录。

用户明确选择模型后，客户端只启用该模型实际支持的能力。若任务需要当前模型不支持的文件或工具，必须在执行前提示用户切换；不得静默改用另一模型。平台发生紧急降级时，消息中记录“选择模型”和“实际模型”。

## 6. 用户界面入口

- 输入框：附件、模型和 Skill 选择。
- 消息区：工具活动、权限卡、来源和文件成果。
- 右侧面板：文件预览、浏览器、终端和长任务详情。
- 文件页：个人文件、成果、版本和同步状态。
- Skill 页：搜索、安装、启用、更新、权限和卸载。
- 设置：模型目录、账户 Token/费用、额度、积分、充值、账单、MCP、工具权限、浏览器数据、Shell Scope 和同步状态。

普通对话仍以回答为视觉中心。Token/费用、工具详情和终端输出默认折叠或进入详情，不能淹没主要内容；余额不足或超过用户费用上限时必须在执行前清楚提示。

## 7. 发布门禁

- FILE-01 至 FILE-08、TOOL-01 至 TOOL-10、SKILL-01 至 SKILL-10 均有 Windows 和 macOS 端到端证据。
- 正式构建由维护中的 Pi 包完整提供 harness；能力 Broker 不包含平行 Agent Loop、Session、压缩、重试或工具调用状态机。
- 被产品合同锁定的能力在 V1 Release 构建中默认可发现；仅在实验开关后存在不算完成。
- 每个敏感能力至少有允许、拒绝、撤销、Scope 变化和重启后行为测试。
- 浏览器、Shell、桌面控制、MCP 和 Skill 失败不能破坏 Conversation、同步队列或已生成成果。
- [09-golden-task-catalog.md](09-golden-task-catalog.md) 中的对应黄金任务全部达到硬性门槛。

## 8. 官方参考基线

本合同根据基线日期可访问的 OpenAI 官方公开文档整理：

- [ChatGPT desktop app](https://learn.chatgpt.com/docs/app)
- [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer)
- [Integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal)
- [Browser](https://learn.chatgpt.com/docs/browser)
- [Web search](https://learn.chatgpt.com/docs/web-search)
- [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)

这些链接用于定义 V1 的公开能力参照，不表示 OpenerX 依赖 OpenAI 私有客户端实现。
