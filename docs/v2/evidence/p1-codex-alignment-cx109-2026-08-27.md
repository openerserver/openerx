# P1 Codex 对齐 CX-109 丰富 Run Item 实现证据（2026-08-27）

> 状态：`PASS / LOCAL IMPLEMENTATION CHECKPOINT`
>
> 时间：2026-08-27 12:17（Asia/Shanghai）
>
> 基线：`HEAD e8983b8a13cc5e9f6df7e065ee375deefbff4ae9` 加当前未提交的 P0、CX-101 至 CX-109 实现
>
> 范围：`docs/v2/16-codex-aligned-implementation-assessment.md` 中的 CX-109

## 1. 结论

CX-109 已在当前工作树形成可运行的本地实现检查点。OpenerX 现在以持久化 `run_items` 作为每个 ExecutionRun 的可回放时间线，覆盖 Model、ReasoningSummary、Plan、Tool、Command、Source、Diff、Approval、Compaction 和 Retry。ToolCall 同时保存经过合同验证的完整类型化输入与有类型的结果 Content Part；Office/附件专用 File 通道也进入同一 ToolCall/Run Item 投影，不再成为审计盲区。

桌面端按 Run 读取和排序 Item，可切换同一 WorkItem 的历史 Run；工具输入、命令输出和退出码、来源、文件差异、审批终态、计划进度、压缩 Token 前后值及重试状态均可回放。进程中断会把未完成 Item 恢复为明确失败，既有 v12 数据会由 v13 migration 回填为 Tool、Model、Compaction、Retry 和 Approval Item。

Reasoning 只把开始/完成、可用 Token 数和固定安全摘要写入产品 Run 投影。Pi 的 `thinking_delta` 与原始 thinking 内容不会经过 Pi Activity、`run_items`、ChatEvent 或 Renderer；Pi 自身 Session 生命周期仍由 Pi 管理，不在本文中宣称改变其内部 Session 文件格式或保留策略。

完整 `npm run check:v2` 通过。这仍不是完整 P1 或发布级声明：live Provider、真实 OAuth、任意第三方 Office 预览、签名包和 Windows/macOS 原生矩阵仍属于 CX-110 与既有 12 组外部证据。

## 2. 实现与证据映射

| 边界 | 关键实现 | 自动化证据 |
| --- | --- | --- |
| Item 合同 | `RunItemContent` 是严格 discriminated union，覆盖 model、reasoning、plan、tool、command、source、diff、approval、compaction、retry；Item 有稳定 `piItemRef`、Run 内 sequence、状态和终态时间。 | Contracts 测试接受有类型 Item、Plan Activity，拒绝向 Reasoning Item 添加 `rawThinking`。 |
| 类型化工具输入/输出 | ToolCall 的 `input` 接受 Capability `ToolOperation` 或 `PiFileToolOperation`；结果继续使用 text/image/file/artifact/source/diff Content Part。 | Storage 测试从 DB 重新读取完整 Shell 输入、命令输出、Source 和 Diff；Office E2E 验证 8 个自然语言 Turn 均产生类型化 `artifact.office.write` ToolCall 和 Artifact 引用。 |
| 持久化与迁移 | v13 新增 `run_items` 和 `tool_calls.input_json`；迁移将 v12 Tool/Model/Compaction/Retry/Approval 历史记录回填，保留稳定 UUID 与顺序。 | Migration 测试从 v10 真实升级到最新版本，验证 image Scope 迁移后仍生成 Tool/Approval Item，旧 Tool 输入明确为 `null` 而不是伪造。 |
| Pi 生命周期 | Pi Host contract v3 投影 `turn_start/end`、安全 Reasoning、Compaction reason/Token、Retry attempt；内置 `openerx_update_plan` 产生类型化 Plan Item。 | Pi Host 真实 AgentSession + faux provider 测试验证 Model、Reasoning 和 Plan Activity；原始 thinking canary 不出现在任何发送给产品进程的 frame。 |
| File/Office 通道 | `PiFileToolRequestFrame` 带 assistant message、Pi call ID 和 tool name；App Service 在执行文件操作前创建 ToolCall，完成后保存去除大图 data URL 的结果与 Artifact 引用。 | Chat App Service 的 DOCX/XLSX/PPTX/PDF 创建与修改 E2E 同时验证 8 个 Run 的 Tool Item、类型化 Office 输入和 Artifact 结果。 |
| 命令失败 | Shell 非零退出通过 `ToolAdapterError` 携带完整有界输出、process ID、exit code 和截断标记；Broker 将失败结果写入 ToolCall 与 Command Item。 | Tool SDK 测试验证 exit 3 的 stderr 仍作为 typed failure result 保留；Storage 测试验证成功命令的输出、退出码和进程引用。 |
| 审批与恢复 | PermissionRequest 创建时产生 Approval Item，批准/拒绝更新同一 Item；启动恢复把 running Item 与 ToolCall/Run 一起标为 `TOOL_HOST_INTERRUPTED`。 | Repository 测试验证 once approval 终态和中断恢复；UI 同时显示 pending 操作按钮与已解决审批状态。 |
| UI Run 回放 | `workItemDetail(workItemId, runId?)` 返回 Runs、所选 Run、Items、ToolCalls 和 Permissions；Renderer 使用统一时间线渲染，并在多个 Run 时提供选择器。 | Desktop UI 测试验证 Plan、Reasoning、Diff、Compaction，切换历史 Run 后展示历史 Model Item，且不存在 raw-thinking canary。 |

## 3. 数据模型与顺序

`run_items` 不复制 ToolCall 或 PermissionRequest 的全部可变事实：

- Tool Item 保存稳定 ToolCall 引用、类型化输入和输入/目标摘要；执行状态、结果和错误仍以 ToolCall 为事实源。
- Approval Item 保存 PermissionRequest 引用和请求时的风险/资源快照；按钮与终态读取 PermissionRequest。
- Source、Diff 和 Command 是需要独立回放的结果 Item，分别保存来源合同、WorkspaceChange 引用/patch、命令/输出/进程/退出码。
- Model、Reasoning、Plan、Compaction、Retry 没有外部实体时直接保存最小类型化内容。

同一 `(run_id, pi_item_ref)` 唯一，重复 Pi frame 只更新同一 Item；新 Item 使用 Run 内单调 sequence。历史 v12 Approval 为避免与旧 RunStep 冲突使用迁移专用高位 sequence，但仍保持确定排序，新 Run 不使用该兼容区间。

## 4. 隐私与安全边界

- `thinking_delta` 被 Pi Host 明确忽略；Reasoning Activity 不包含 provider 原文，只包含固定摘要和可选 Token 数。
- Reasoning schema 为 strict object，不能加入 `rawThinking` 等任意字段。
- Office 预览的 `imageDataUrl`、`modelImageDataUrl` 和 `bytesBase64` 不写入 ToolCall 的结构化 data；图片仍只通过既有有类型 image content 传递给模型。
- Tool input 保存在本机产品数据库用于审计和回放，不进入普通日志；UI 默认折叠完整类型化输入。
- Command 输出上限为 2,000,000 字符，并显式记录 `outputTruncated`；非零退出不会因为异常路径丢失输出。
- 进程恢复不把 running Item 猜成成功；它与 ToolCall/Run 一起进入明确失败状态。

## 5. 完整门禁结果

2026-08-27 12:17（Asia/Shanghai）执行 `npm run check:v2`，结果 `exit 0`：

- V2 boundaries：210 个源文件，PASS。
- Release graph：156 个 production 文件、13 个 Pi imports 仅位于 `packages/pi-host`、44 条 workspace edges，PASS。
- Local release readiness：PASS；仍明确保留 12 组外部证据。
- Biome：306 个文件，PASS。
- TypeScript：全部 workspace，PASS。
- Tests：workspace 228 个测试加根目录 61 个测试，合计 289 个，PASS。
- Build：Contracts、Release、Mobile iOS/Android 和 Desktop production bundle，PASS。
- Package：Darwin arm64/x64 与 Windows x64 Fuse 检查，PASS。
- Release artifact：`app.asar` 版本 `2.0.0-alpha.0`、update boundary，PASS。
- Native signature：三平台本地包仍按预期为 `LOCAL UNSIGNED`，不作为签名发布证据。

专项新增覆盖包括：v13 历史回填、类型化输入/结果、Plan 工具、Model/Reasoning Activity、raw-thinking canary、Compaction/Retry、Office File 通道、失败命令输出、Approval 终态、恢复和历史 Run UI 切换。

## 6. 明确限制与下一任务

- 当前 WorkItem 通常仍对应单个 ExecutionRun；合同与 UI 已支持多个 Run，后续若引入同 WorkItem 重试/恢复 Run，不需要再改变读取协议。
- Reasoning Token 只有 Provider/Usage 可提供时才显示，未知时保持 `null`，不从文本长度估算。
- Plan 是模型可调用的产品内工具；它提供透明进度，不改变 Pi 对 Agent loop、tool continuation、compaction 和 retry 的所有权。
- 本地 fixture、faux provider 和 unsigned package 不能代替 live Provider、真实 OAuth、签名安装或 Windows/macOS 原生应用控制。
- 下一任务是 CX-110：补 live Provider/OAuth、任意第三方 Office 预览、签名包和 macOS/Windows 原生矩阵；外部证据齐备前不宣称完整 P1。
