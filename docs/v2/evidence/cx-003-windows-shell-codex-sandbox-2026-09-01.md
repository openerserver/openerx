# CX-003 Windows Shell：Codex 受限令牌后端（2026-09-01）

## 结论

Windows 上的 legacy `openerx_shell` 不再因为缺少 macOS `sandbox-exec` 而固定返回
`SHELL_OS_SANDBOX_UNAVAILABLE`。当本机 Codex Windows 沙箱已经初始化时，UWA 通过 Codex
app-server 的 `command/exec` 执行 argv，并继续在后端不可验证时 fail closed。

本实现参考并复用本机 Codex CLI `rust-v0.152.0` 的 Windows 沙箱边界，而不是把命令降级为裸
PowerShell、`cmd.exe`、WSL 或 Docker：

- `CreateRestrictedToken` / 独立的 `CodexSandboxOffline` 与 `CodexSandboxOnline` 账户；
- 工作区写 capability 与 ACL；
- Job Object 进程树生命周期；
- WFP / 防火墙网络身份隔离；
- `codex-command-runner.exe` 与 `codex-windows-sandbox-setup.exe` helper。

## Readiness 与 fail-closed

`shellToolAvailability()` 仅在以下条件同时满足时投影 `openerx_shell` 和
`openerx_shell_process`：

1. 平台为 Windows；
2. 找到 Codex `codex.exe`；
3. 同目录的两个 Windows helper 均存在；
4. `%USERPROFILE%\.codex\.sandbox\setup_marker.json` 版本和离线/在线账户信息有效。

执行前，adapter 还会启动 `codex app-server --stdio`，完成 `initialize`，并要求
`windowsSandbox/readiness` 返回 `ready`。任一步失败均返回
`SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE`，不会改用无沙箱执行。

## 执行合同

- 命令以 argv 数组传递，不经 Shell 字符串拼接。
- `cwd` 必须位于 UWA 已授权的可写工作区。
- Codex `workspaceWrite` 的 writable root 使用授权工作区根，而不是当前子目录。
- `TEMP`、`TMP`、`TMPDIR` 被重定向到当前工作区，Codex policy 不额外授权用户全局临时目录。
- `allowNetwork=false/true` 分别选择 Codex Offline/Online 沙箱身份。
- 输出使用 Codex Windows 当前支持的 buffered `command/exec`；不传入 Windows 后端拒绝的自定义
  `outputBytesCap`。
- 停止后台命令会关闭对应 app-server host，由 Windows Job Object 回收进程树。

Codex v0.152.0 的公开 Windows `command/exec` 不支持流式 stdin/stdout、PTY 或
`command/exec/terminate`。因此本阶段支持前台命令、后台启动/查询/停止，但运行中 stdin 明确返回
`SHELL_WINDOWS_INTERACTIVE_INPUT_UNAVAILABLE`，不伪装成完整交互式 PowerShell。

## 安全语义说明

写权限和网络权限由 Codex Windows sandbox 强制执行。Codex 的 `workspaceWrite` profile 本身是
“全盘读取、工作区写入（敏感目录另行保护）”语义，不等同于 macOS UWA Seatbelt 后端的
“工作区外一般不可读”语义。本实现如实采用 Codex 的 Windows 语义，UI 只声明 restricted-token
隔离，不声明 Windows 已达到 macOS 的读取隔离等价性。

## 本机验证

- Tool SDK TypeScript typecheck：通过。
- `packages/tool-sdk/tests/shell-adapter.test.ts`：10/10 通过。
- 实际命令身份：网络关闭为 `CodexSandboxOffline`，网络开启为 `CodexSandboxOnline`。
- 命令环境的 `TEMP`：等于当前授权工作区。
- argv 输出、非零退出码、cwd 越界拒绝、后台启动/查询/停止：通过。
- 含 npm 依赖的当前真实开发工作区执行：通过。
- App Service Shell readiness 与工作区撤销测试：通过。
