# P1 Codex 对齐 CX-101 至 CX-107 实现证据（2026-08-27）

> 状态：`PASS / LOCAL IMPLEMENTATION CHECKPOINT`
>
> 时间：2026-08-27 07:48（Asia/Shanghai）
>
> 基线：`HEAD 8561cdab1132e11e56dbf5fee2957d4fcfaafdba` 加当前未提交的 P0 与 CX-101 至 CX-107 实现
>
> 范围：`docs/v2/16-codex-aligned-implementation-assessment.md` 中的 CX-101 至 CX-107

> 后续状态：2026-08-27 已继续完成 CX-108 本地检查点；见 [CX-108 Office Agent 实现证据](p1-codex-alignment-cx108-2026-08-27.md)。本文其余内容保留为 CX-101 至 CX-107 当时的证据快照。

## 1. 结论

CX-101 至 CX-107 已在当前工作树实现，并通过完整 `npm run check:v2`。这证明用户授权工作区、补丁与差异、分层项目指令、独立 MCP 工具、按需工具发现、模型/宿主能力拆分和每 Turn 配置快照在本地合同、实现、测试、构建与打包边界内闭合。

这不是整个 P1 完成声明。CX-108 至 CX-110 的 Office Agent 生产链、丰富 Item 回放和真实服务/签名双平台矩阵仍未完成；现有 12 组外部发布证据也仍保留。

## 2. 实现与证据映射

| ID | 关键实现 | 自动化证据 |
| --- | --- | --- |
| CX-101 | `packages/contracts/src/workspace.ts`、Desktop Main/Preload/Renderer 和 `ToolRepository`：目录只能由可信 Main 选择；授权记录包含会话、只读/读写、网络、有效期与撤销状态；模型仅收到 grant ID 和相对路径。Shell 按 grant 解析真实根目录，并始终使用 P0 的 macOS OS 沙箱。不可用授权不会阻断其他工作区。 | Desktop UI 测试验证授权选项与可见状态；App Service 测试验证失效根隔离；Workspace/Shell 测试验证路径穿越、符号链接、子进程读越界和网络授权边界。 |
| CX-102 | `WorkspaceToolAdapter` 和 Pi workspace tools：提供 bounded list/search/read、SHA-256 乐观并发、唯一上下文 replacement patch、同目录原子 rename、typed diff、变更列表、hash-guarded undo。写入前持久化 before/after/diff；中断恢复为 `outcome_unknown`，下一 Turn 可列出并对账/撤销。 | `workspace-adapter.test.ts` 覆盖读取→Patch→模型可见 diff→UI typed diff→Undo，以及写入成功但数据库提交中断后的找回与撤销。 |
| CX-103 | OpenerX 自己加载 Profile `AGENTS.md`、仓库根和目标目录链上的 `AGENTS.md`；保持 Pi `noContextFiles: true`。每个来源记录 kind、grant、相对路径、作用域、digest 和内容；Patch 必须提交当前全部适用 digest。 | Workspace 测试验证 global→project→nested 顺序、Run 来源记录和未确认/变更后指令的写入阻断。 |
| CX-104 | `McpToolAdapter.discoverEnabledTools()` 将每个启用 MCP tool 投影为稳定命名空间工具，保留 JSON Schema 和保守化 annotations，并绑定 descriptor digest。调用前重新检查 server/tool 启用状态、Schema 和注解；通用 `openerx_mcp`/字符串参数入口已从模型工具面移除。 | STDIO fixture 暴露独立 read/write 工具；测试验证 typed discovery、禁用后消失、描述符漂移阻断。Broker 测试证明只读 L0 直接执行，写入 L4 在 adapter 前停住并逐次审批。 |
| CX-105 | 每 Turn 固化完整可用工具目录，但 Pi 初始只激活任务相关工具和 `openerx_tool_search`；搜索命中后通过 AgentSession 动态激活 Schema。Skill 继续只初始披露元数据，资源通过受控 read 按需加载。 | `tool-search.test.ts` 验证初始不可见工具在同一 Turn 搜索后激活；Chat/App Service 测试验证纯聊天只初始暴露 tool-search，历史 Run 保存 initial/available 两套清单。 |
| CX-106 | `modelCapabilitiesSchema` 只保留输入模态、function calling 和 structured output；Web、Shell、Browser、Desktop、MCP、图片生成及工作区均由 Turn 的 Host Tool Availability 表达。模型不再被强制声明 `off` 推理级别。 | Contracts 和 Model Gateway 测试验证宿主工具不进入 Model Catalog、`[medium, high]` 是合法强制推理集合，能力筛选仍由真实模型能力执行。 |
| CX-107 | 每次 send/edit/regenerate 在 Prompt 前创建 Run；冻结 requested model、thinking、initial/available tools、Skill installation IDs 和初始指令来源。完成时从权威 Usage 保存 effective model 与 fallback reason；后续 Conversation 默认值变更不改写历史。 | Storage 测试验证同一 Conversation 连续两 Turn 使用不同模型/思考级别，第一轮快照不变且不能二次冻结；App Service 测试验证纯聊天也有完整 Run/工具快照和多 round Usage。 |

## 3. 完整门禁结果

执行命令：

```text
npm run check:v2
```

结果：`exit 0`。

- V2 boundaries：207 个源文件，PASS。
- Release graph：154 个 production 文件、12 个 Pi imports 仅位于 `packages/pi-host`、44 条 workspace edges，PASS。
- Local release readiness：PASS；仍明确列出 12 组外部证据。
- Biome：301 个文件，PASS。
- TypeScript：全部 workspace，PASS。
- Tests：workspace 213 个测试加根目录 61 个测试，合计 274 个，PASS。
- Build：Contracts、Release、Mobile iOS/Android 和 Desktop production bundle，PASS。
- Package：Darwin arm64/x64 与 Windows x64 Fuse 检查，PASS。
- Release artifact：`app.asar` 版本和 update boundary，PASS。
- Native signature：本地包按预期报告 `LOCAL UNSIGNED`，不作为签名发布证据。

## 4. 明确限制

- 工作区安全和 Shell 越界在本机 macOS 上有 OS 沙箱负向测试；Windows 仍显式 unavailable，不宣称已具备 Windows 原生 Shell 沙箱。
- MCP 证据使用本地 STDIO fixture、HTTP fixture 和 OAuth provider 合同，不等于任意第三方服务的真实 OAuth 授权码流程。
- 按需工具发现已验证 Schema 激活和冻结清单，尚未形成真实长任务的上下文 Token/延迟基准。
- 本证据不覆盖从自然语言开始创建/修改 DOCX、XLSX、PPTX、PDF 并逐页视觉验收，也不覆盖完整 typed Item 回放。
- 本证据不覆盖 live Web/图片 Provider、签名/公证包、真实多窗口像素矩阵或 Windows 原生控制；这些仍属于 CX-108 至 CX-110 和发布外部证据。
