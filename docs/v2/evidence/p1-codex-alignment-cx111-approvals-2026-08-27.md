# CX-111 Codex 式审批收敛证据

> 日期：2026-08-27（Asia/Shanghai）
>
> 状态：`LOCAL IMPLEMENTATION VERIFIED`
>
> 边界：证明当前工作树中的审批策略、作用域和自动/逐次行为；不等于 Windows 原生沙箱、第三方实网、Apple 公证或生产发布验收。

## 1. 问题与采用的基线

旧实现把风险等级直接当成审批频率：即使用户已经明确授予可写工作区，Patch 和沙箱 Shell 仍会产生新的 PermissionRequest；隔离浏览器的导航、点击、输入和截图也会反复请求；Desktop 的 click/type/key 一律作为 L5 逐次确认。桌面 UI 的“本次会话允许”又没有传入 Conversation Scope，实际可能生成账户级 8 小时 Scope。

CX-111 采用 OpenAI 官方 [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security) 的核心边界：OS 沙箱决定技术能力，审批策略决定何时停下；默认 Auto 在授权工作区内可读、写和运行命令，越出工作区或需要网络时再确认。实现没有关闭 Broker，也没有引入全局无限授权。

## 2. 当前行为矩阵

| 能力 | 审批策略 | 仍保留的硬边界 |
| --- | --- | --- |
| 已授权工作区读取、Patch、Undo | automatic | Active WorkspaceGrant、Conversation、读写模式、路径穿越、符号链接、内容 Hash 与项目指令摘要 |
| 已授权工作区 Shell | automatic | 每次进入 OS 沙箱；只能读写授权根；网络必须已在 WorkspaceGrant 单独启用；无 WorkspaceGrant 的旧路径仍 per-call |
| 第一方 Web 搜索、图片生成 | automatic | 独立平台工具、Usage/计费、类型化结果、幂等/不确定副作用记录 |
| 隔离浏览器导航、普通点击/输入、截图、受控下载 | automatic | 独立 Profile；普通 click 不能命中 submit/发送/购买/删除目标；下载只进入受控目录再导入内容库 |
| 浏览器上传、提交 | per_call | 精确 payload digest；L4 不允许 Session/Persistent 决定 |
| Desktop 截图、普通 click/type/key | scope | 目标应用、bundle/window/capture identity；Scope 绑定当前 Conversation；发送/提交/删除/购买仍 per_call |
| MCP 发现与只读调用 | automatic | Server/tool 启用状态、Schema、descriptor digest 与 read-only annotation 每次复核 |
| MCP 连接、写入/破坏性调用、清除凭据 | per_call | 精确 payload；L4/L5 不允许扩大为 Session/Persistent |
| Skill 资源读取 / 脚本 | automatic / per_call | 安装包与权限摘要；脚本保持 L5 逐次确认 |

## 3. 关键实现证据

- `packages/tool-sdk/src/types.ts`：`CapabilityRequirement` 使用 `approval: automatic | scope | per_call`，风险不再隐式决定弹窗。
- `packages/tool-sdk/src/policy.ts`：为工作区、Shell、Web、图片、Browser、Desktop、MCP 和 Skill 明确映射审批策略，同时保留原风险和资源/action 摘要。
- `packages/tool-sdk/src/broker.ts`：仅 `scope` 缺少匹配 Scope 或 `per_call` 时创建 PermissionRequest；Session 决定的 Conversation ID 从待审批 WorkItem 反推，调用方提供不一致 ID 时 fail closed。
- `packages/tool-sdk/src/workspace-adapter.ts` 与 `shell-adapter.ts`：自动执行不绕过 Active WorkspaceGrant、读写权限、网络开关、路径与 OS 沙箱校验。
- `apps/desktop/src/renderer/App.tsx`：工作区授权说明明确“范围内自动、外部高影响逐次确认”，按钮改为“在此对话中允许”。

## 4. 测试证据

- `npm test --workspace @openerx/tool-sdk`：8 个文件、33 个测试通过。新增/更新覆盖真实 WorkspaceGrant Patch 无二次 PermissionRequest、第一方 Web 自动、Browser 观察自动/submit 逐次、Desktop Scope 不跨 Conversation、伪造 Conversation Scope 被拒绝、MCP 只读/写入分离。
- `npm test --workspace @openerx/app-service`：6 个文件、20 个测试通过；仍验证真正需要 Scope 的 Desktop 请求会投影 `permission.required`、批准后恢复同一个 Pi call。
- `npm test --workspace @openerx/storage`：5 个文件、18 个测试通过；L4/L5 仍拒绝 Session/Persistent。
- `npm test --workspace @openerx/desktop`：10 个文件、64 个测试通过。
- `npm run typecheck:v2`：全部 workspace TypeScript 检查通过。
- `npm run check:v2`：2026-08-27 17:12（Asia/Shanghai）完整门禁 `exit 0`；222 个源文件边界、162 个 production 文件 Release Graph、318 个文件 Lint、全部 workspace 266 个测试加根目录 61 个测试（合计 327）、iOS/Android export、Electron production bundle、Darwin arm64/x64 与 Windows x64 Fuse、release artifact 校验全部通过。输出仍正确标记本地包为 unsigned，12 组外部发布证据未被本检查冒充完成。
- `node apps/desktop/scripts/e2e-tools.mjs` 已到达 `E2E_BROWSER_APPROVALS_OK` 检查点：open/type/screenshot/download/close 自动执行，upload 仅出现 1 张权限卡。随后现有 Desktop 截图步骤因 `DESKTOP_TARGET_WINDOW_NOT_FOUND` 失败，因此不把整条 Tools E2E 记为通过。
- `npm run test:e2e:v2` 在更早的 `e2e-chat.mjs` 停止态等待处超时，尚未进入 Tools 场景；这是本轮完整 E2E 的明确未决项，不以单元测试或 Browser 检查点代替。

## 5. 未放宽的边界

CX-111 不提供 `--yolo` 类全权限模式，不让 Renderer、Pi、Remote 或模型自行授权，不允许 Scope 跨 Conversation，不把 L4/L5 变成持久授权，也不取消系统 TCC/Accessibility、WorkspaceGrant、网络开关、MCP annotation、payload digest、过期/撤销和审计检查。
