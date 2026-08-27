# P0 Codex 对齐实现证据（2026-08-26）

> 状态：`PASS / LOCAL IMPLEMENTATION CHECKPOINT`
>
> 时间：2026-08-26 23:51（Asia/Shanghai）
>
> 基线：`HEAD 8561cdab1132e11e56dbf5fee2957d4fcfaafdba` 加当前未提交的 P0 实现
>
> 范围：`docs/v2/16-codex-aligned-implementation-assessment.md` 中的 CX-001 至 CX-010
>
> 后续状态：2026-08-27 已继续完成 CX-101 至 CX-107；见 [P1 Codex 对齐 CX-101 至 CX-107 实现证据](p1-codex-alignment-cx101-107-2026-08-27.md)。本文其余内容保留为 P0 当日证据快照。

## 1. 结论

CX-001 至 CX-010 已在当前工作树实现，完整 `npm run check:v2` 返回 `exit 0`。这证明本地 P0 合同、实现、测试、构建和打包边界闭合；不把尚未取得的 live provider、OAuth、签名发布、Windows 原生沙箱或真实桌面像素矩阵声明为已完成。

## 2. 实现与证据映射

| ID | 关键实现 | 自动化证据 |
| --- | --- | --- |
| CX-001 | `packages/pi-host/src/session-registry.ts`、`packages/pi-host/src/host.ts`、`packages/app-service/src/chat-app-service.ts`：一个 Branch 对应一个持久 Pi Session，工具帧携带并校验 Branch。 | `packages/pi-host/tests/session-and-file-tools.test.ts`、`packages/app-service/tests/chat-app-service.test.ts` 验证分支 Session/工具作用域隔离。 |
| CX-002 | `packages/storage/src/chat-repository.ts`、`packages/storage/src/file-repository.ts`、`packages/file-service/src/file-service.ts`：按分支可见 Message 选择附件，图片归属消息并仅在正确轮次注入。 | `packages/file-service/tests/file-service.test.ts` 和 `packages/app-service/tests/chat-app-service.test.ts` 验证分支图片隔离及后续纯文本 Prompt 不重复携图。 |
| CX-003 | `packages/tool-sdk/src/shell-adapter.ts`：Darwin 每次执行都构造 OS sandbox profile；网络允许与文件根独立；无原生实现的平台拒绝执行。 | `packages/tool-sdk/tests/shell-adapter.test.ts` 用 Node/Python 在网络允许与禁止两种组合下读取工作区外文件，均由 sandbox 拒绝；本地 HTTP 仅在批准网络后成功。 |
| CX-004 | `apps/desktop/src/main/desktop-window-target.ts`、`apps/desktop/src/main/tool-capability-host.ts`：只请求 window source，选择指定目标，缺失时失败。 | `apps/desktop/tests/desktop-window-target.test.ts` 验证不会请求 screen source、不会选择旁路敏感窗口且不存在目标时返回失败。 |
| CX-005 | `packages/contracts/src/tool.ts` 定义 typed content；Broker、Builtin/MCP/Host/Skill adapter、Pi mapper、ToolCall 存储和 Renderer 全链路保留类型。 | `packages/pi-host/tests/tool-result.test.ts`、`packages/tool-sdk/tests/host-adapter.test.ts`、`packages/tool-sdk/tests/image-generation-adapter.test.ts` 和 Desktop 测试验证 image/file/source 不被压成 JSON/Base64 文本。 |
| CX-006 | `packages/app-service/src/tool-app-service.ts` 和 `packages/app-service/src/chat-app-service.ts` 在 Prompt 前创建 WorkItem/ExecutionRun，并固化 Branch、模型与 thinking。 | `packages/app-service/tests/chat-app-service.test.ts` 验证没有工具调用的纯聊天仍有持久 Run。 |
| CX-007 | Message、ExecutionRun 和 WorkItem 均投影 `cancelling → interrupted/failed/completed`；Pi Host 收集全部模型 round Usage；Tool Repository 持久化列表，Renderer 聚合展示。 | `packages/app-service/tests/chat-app-service.test.ts`、`packages/app-service/tests/tool-app-service.test.ts`、`packages/pi-host/tests/platform-provider.test.ts`、`packages/storage/tests/tool-repository.test.ts` 验证事件顺序、晚到终态和多轮 Usage。 |
| CX-008 | `image.generate` 成为独立 Capability；v11 migration 按目标资源迁移旧 Scope 和 PermissionRequest。 | `packages/tool-sdk/tests/broker.test.ts`、`tests/v2/golden/tools-m5.test.ts` 和 `packages/storage/tests/migrations.test.ts` 验证新策略及 v10→v11 数据迁移。 |
| CX-009 | `tool_side_effect_attempts` 在不安全外部动作前记录 `executing`；错误/重启恢复为 `outcome_unknown`，Broker 拒绝同 key 重放。 | `packages/storage/tests/tool-repository.test.ts` 和 `packages/tool-sdk/tests/broker.test.ts` 覆盖外部动作后、本地 commit 前失败与重启恢复。 |
| CX-010 | Renderer 运行时模型辅助函数通过 `@openerx/contracts/model` 子路径加载，不再把 release-only Schema 拉入 Bundle。 | 完整 `npm run check:v2` 的 `verify:release-artifacts` 通过，不再出现 `RELEASE_RENDERER_UPDATE_SECRET_BOUNDARY`。 |

## 3. 门禁结果

执行命令：

```text
npm run check:v2
```

结果：`exit 0`。

- V2 boundaries：200 个源文件，PASS。
- Release graph：149 个 production 文件、9 个 Pi imports 仅位于 `packages/pi-host`，PASS。
- Local release readiness：PASS；仍明确列出 12 组外部证据。
- Biome：294 个文件，PASS。
- TypeScript：全部 workspace，PASS。
- Tests：workspace 202 个测试加根目录 61 个测试，合计 263 个，PASS；其中 Storage 的 16 个测试包含 v10→v11 旧权限迁移回归，Pi Host 的 21 个测试包含 Session 未就绪时的排队中止和类型化图片工具续轮。
- Build：Contracts、Release、Mobile iOS/Android、Desktop production bundle，PASS。
- Package：Darwin arm64/x64 与 Windows x64 Fuse 检查，PASS。
- Release artifact：`app.asar` 版本和 update boundary，PASS。
- Native signature：本地包按预期报告 `LOCAL UNSIGNED`，不作为签名发布证据。

## 4. 明确限制

- macOS Shell 已有本机 OS 沙箱逃逸测试；Windows Shell 当前选择显式 unavailable，没有降级执行，也不宣称 Windows 原生沙箱已实现。
- Desktop 截图已经从 API 层消除主屏回退，并有目标选择负向测试；真实多窗口像素级 E2E 仍应在 CX-110 原生矩阵补证。
- 本证据不覆盖 live Web/图片 Provider、第三方 MCP OAuth、签名/公证发布和生产更新源。
- 本轮没有实现 P1/P2：工作区 Patch/Diff、项目指令、独立 MCP 工具发现、Office 端到端生产、多 Agent、Automation 和云端执行仍保持原评估结论。
