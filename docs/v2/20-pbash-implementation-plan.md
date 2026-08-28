# PBASH 实施计划

- 状态：`PBASH-001 LOCAL COMPLETE / REAL SHELL DISABLED`
- 日期：2026-08-28（Asia/Shanghai）
- 架构依据：[19-pi-bash-brokered-execution-plan.md](19-pi-bash-brokered-execution-plan.md)
- 当前目标：完成 `brokered_bash_v1` 合同和 deterministic fake Runner 闭环，不启动真实 Shell

## 1. 实施原则

1. Pi 继续是唯一 Agent Loop；只增加产品自有 `bash` ToolDefinition。
2. `noTools: "builtin"` 持续生效，Pi 原始本地 Bash 不得恢复。
3. 模型只看到 `command + timeout`，WorkspaceGrant、execution profile 和 policy 来自可信控制面。
4. App Service 按 Generation 冻结执行上下文；Pi Host 发送的操作必须精确匹配，不能自行扩权。
5. PBASH-001 只使用 deterministic fake adapter，返回“合同已验证、未执行命令”的标准结果。
6. Feature flag 默认关闭；关闭后继续使用现有 `openerx_shell`，不同时暴露两个默认 Shell 工具。
7. 每一阶段都需要正向、负向、回滚和日期化证据；fake 结果不能冒充本机隔离证据。

## 2. 分阶段交付

| 阶段 | 交付 | 当前状态 | 退出条件 |
| --- | --- | --- | --- |
| PBASH-001 | 严格合同、Pi 工具投影、冻结执行上下文、fake Broker/Runner | LOCAL COMPLETE | 合同、Pi Host、Broker、App Service 测试通过；无进程启动 |
| PBASH-002 | `PlatformSandboxEngine` 与 macOS Seatbelt 后端 | PENDING | 文件/网络/环境/进程树负向门禁通过 |
| PBASH-003 | 流式进度、取消和完整日志 Artifact | PENDING | 顺序、截断、取消、断连测试通过 |
| PBASH-004 | 直接写变更证据与高隔离 working copy | PENDING | diff/conflict 和无人值守 Remote 不降级门禁通过 |
| PBASH-005 | Remote、审批、幂等和 `outcome_unknown` | PENDING | 至少一次投递不重复副作用 |
| PBASH-006 | 环境与 egress policy | PENDING | 默认离线、Secret canary、私网/metadata 阻断通过 |
| PBASH-007 | Golden A/B 与渐进启用 | PENDING | 安全零越界、核心 Coding 任务无未解释回归 |
| PBASH-008 | 签名构建与平台矩阵 | PENDING | 支持平台通过，其他平台 fail-closed |

## 3. PBASH-001 代码工作包

### 3.1 合同与 IPC

- 新增 `brokered_bash_v1`、feature flag、profile、policy ID、错误码和严格操作 schema。
- `PiPromptFrame.workspace` 增加不可由模型控制的 execution context。
- Pi Host 私有 IPC 版本递增；旧版本不能静默接受新字段。
- operation digest 必须覆盖命令、timeout、根、profile 和全部 policy 版本。

### 3.2 Pi 工具投影

- 新建产品 `bash` ToolDefinition，模型参数只有 `command` 和秒级 `timeout`。
- 使用 Pi 原始 `piToolCallId` 生成现有稳定幂等键。
- 从 prompt execution context 填充 grant/profile/policy，模型 schema 不出现这些字段。
- 工具描述在 PBASH-001 明确标注为 contract preview，不宣称命令已执行。

### 3.3 Broker 与 fake Runner

- Capability Broker 识别 `shell_command_execute`，区分只读和工作区写入风险。
- fake adapter 重新查询未撤销、未过期 WorkspaceGrant。
- fake adapter 把操作与该 Generation 冻结的 execution context 精确比较。
- fake adapter 不导入 `child_process`，不读写目标工作区，不使用网络，只返回标准结果。

### 3.4 App Service 接线

- feature flag 默认关闭；测试和开发者可显式打开。
- 单一有效 grant 可自动成为活动根；多根场景必须显式选择活动根，其余根逐个授权。
- feature flag 打开时只暴露 `bash`，关闭时保持现有 `openerx_shell` 回滚路径。
- execution context 在 Run 配置冻结后绑定到 Generation，结束、取消和关闭时清理。

## 4. PBASH-001 验收门槛

- [x] 严格 schema 拒绝未知字段、NUL、超长命令、非法 timeout、重复根和活动根重复挂载。
- [x] prompt execution context 拒绝不存在的 grant 和只读 grant 的 `workspace_write`。
- [x] 模型可见 `bash` schema 不包含 grant、宿主路径、profile、network 或 sandbox 字段。
- [x] Pi ToolCall 保留原始 ID，并生成 `shell_command_execute` 完整版本化操作。
- [x] feature flag 关闭时 `bash` 不可见；打开时 legacy Shell 不与它同时暴露。
- [x] 多工作区未选择活动根时 fail-closed。
- [x] 篡改 grant/profile/policy 的 Pi 请求被 App Service/fake adapter 拒绝。
- [x] fake runner 返回 `executionPerformed=false`，测试 canary 文件不存在。
- [x] contracts、tool-sdk、pi-host、app-service 的测试、类型检查和 lint 通过。
- [x] 日期化证据明确标记 `CONTRACT ONLY / FAKE RUNNER / NO REAL SHELL`。

## 5. 本轮停止点

PBASH-001 完成后停止，不顺带接入 `/bin/bash`、`sandbox-exec`、PTY、流式进度、网络或真实文件写入。
下一轮从 PBASH-002 的 `PlatformSandboxEngine` 最小接口和 macOS capability probe 开始。

本轮实现与负向门禁见 [PBASH-001 日期化证据](evidence/pbash-001-2026-08-28.md)。
