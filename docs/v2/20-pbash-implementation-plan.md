# PBASH 实施计划

- 状态：`PBASH-001..PBASH-007 LOCAL COMPLETE / PBASH-008 LOCAL FAIL-CLOSED COMPLETE / EXTERNAL RELEASE BLOCKED`
- 日期：2026-08-28（Asia/Shanghai）
- 架构依据：[19-pi-bash-brokered-execution-plan.md](19-pi-bash-brokered-execution-plan.md)
- 当前目标：PBASH-001 至 PBASH-008 的本机实现与文档切片已收口；Developer ID/公证包、跨 OS
  backend 和真机矩阵保留为外部发布门禁

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
| PBASH-002 | `PlatformSandboxEngine` 与 macOS Seatbelt 后端 | LOCAL COMPLETE | 文件/网络/环境/进程树负向门禁通过；发布矩阵仍待 PBASH-008 |
| PBASH-003 | 流式进度、取消和完整日志 Artifact | LOCAL COMPLETE | 顺序、截断、取消、断连测试通过 |
| PBASH-004 | 直接写变更证据与高隔离 working copy | LOCAL COMPLETE | diff/conflict、CoW change set、审阅/应用/丢弃/撤销和不降级门禁通过 |
| PBASH-005 | Remote、审批、幂等和 `outcome_unknown` | LOCAL COMPLETE | 至少一次投递不重复副作用；Remote 不扩大权限 |
| PBASH-006 | 环境与 egress policy | LOCAL COMPLETE | 默认离线、Secret canary、私网/metadata/DNS rebinding 阻断通过 |
| PBASH-007 | Golden A/B 与渐进启用 | LOCAL COMPLETE | 9 类 Runner A/B；真实模型 3 次配对完成，Brokered 严格 26/27、功能 27/27 |
| PBASH-008 | 签名构建与平台矩阵 | LOCAL FAIL-CLOSED COMPLETE / EXTERNAL BLOCKED | 当前 macOS 仅 Local Alpha；其他平台 unavailable；签名/跨 OS 待外部证据 |

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

## 5. PBASH-001 历史停止点

PBASH-001 当时按边界停止，没有顺带接入 `/bin/bash`、`sandbox-exec`、PTY、流式进度、网络或真实
文件写入；随后 PBASH-002 作为独立切片接入平台引擎和真实 macOS 后端。

本轮实现与负向门禁见 [公共测试说明](../TESTING.md)。

## 6. PBASH-002 实施切片

### 6.1 平台引擎合同

- 定义稳定的 capability、执行请求、根映射、资源限制、执行结果、后端证明和销毁状态。
- backend 必须先 probe；平台、可执行文件、策略编译或强制拒绝自检任一失败都返回 unavailable。
- App Service 只接受显式 `fake` 或 `macos` runner mode；未知配置 fail-closed。
- `macos` mode 的 Generation 冻结 `macos-seatbelt-v1`，不能复用 fake policy。

### 6.2 macOS Seatbelt 后端

- 固定 `/bin/bash --noprofile --norc`，不读取用户 Shell 配置。
- 受信根经 `realpath` 解析；重叠/重复根、控制字符和不存在的根拒绝。
- `read_only` 只允许 Runner 临时 HOME/TMP 写入；`workspace_write` 只允许相应 read-write grant。
- `.git`、工作区外路径、网络和未声明的设备/IPC 默认拒绝。
- writable/read-only 根在启动前扫描 hard-link inode；存在授权集合外别名或跨权限别名时 fail-closed，
  运行时禁止新建 hard link/file clone。
- 环境从空集合构造，只保留受控 PATH/locale/Runner 临时目录与显式安全配置。
- 每次调用一个进程组；timeout、Abort、自然退出和 App Service close 后都清理残余后代。
- 输出不返回真实 Workspace/Runner 临时路径；PBASH-002 在 PBASH-003 完成前仅返回有界最终输出。

### 6.3 PBASH-002 验收门槛

- [x] 非 macOS、缺少 `sandbox-exec`/Bash 或强制拒绝自检失败时不投影 `bash`。
- [x] `read_only` 可以读授权根，但不能写授权根或读取/写入工作区外 canary。
- [x] `workspace_write` 可以写授权根，但不能写任意层级 `.git` 或只读额外根。
- [x] 符号链接、hard link 和嵌套/重复根不能绕过最终文件边界。
- [x] Runner 环境不含宿主 HOME、SSH Agent、云、Git、npm、Codex、Pi 或模型凭证。
- [x] 默认 network deny 阻止回环 TCP；命令文本不能自行打开网络。
- [x] timeout、Abort、命令自然退出和 close 会终止进程组内残余后代。
- [x] 返回结果包含 backend/policy/OS build/销毁状态，但不含真实根或临时目录。
- [x] Pi builtin 工具仍不可达；legacy Shell 不与真实 `bash` 同时暴露。
- [x] macOS live tests、定向测试、全仓 `check:v2` 和日期化证据通过。

PBASH-002 不实现 PTY、长期后台 Session、受控网络放行、SecretRef、完整日志 Artifact 或变更
manifest；其中进度、取消与日志已由 PBASH-003 补齐，其余仍属于 PBASH-004 至 PBASH-006。

本切片实现、首次 hard-link 逃逸发现及修复、真实 macOS 负向矩阵与完整门禁见
[公共测试说明](../TESTING.md)。`sandbox-exec` 已由系统手册标记
deprecated，本检查点只证明当前本机后端，不是签名发布或未来 macOS 兼容声明。

## 7. PBASH-003 本机完成

- [x] 私有 Pi IPC 升级到 v5；`pi.tool.progress` 使用请求内单调序号，Pi Host 丢弃重复、迟到和已
      结束请求的帧，并映射到 ToolDefinition `onUpdate`。
- [x] macOS Runner 按 stdout/stderr 到达顺序输出；跨 chunk 缓冲后统一去除 ANSI/控制字符、替换
      授权根/Runner 临时目录/宿主 HOME，并遮蔽常见凭证形态。
- [x] 无换行超长单行在 64 KiB 处 fail-closed 为固定脱敏标记，不跨截断边界泄露凭证片段。
- [x] 模型结果同时限制为尾部 2,000 行和 50 KiB；已脱敏完整日志限制为 2 MiB，并通过现有
      FileAppService/ObjectStore 创建 `text/plain` Artifact，ToolResult 返回稳定 Artifact ID。
- [x] Pi `AbortSignal` 通过 `pi.tool.cancel` 回到 AppService；Run Stop、Pi Host 断连、AppService close、
      timeout 和自然退出共用 Abort/Runner `stopAll`/进程组回收路径。
- [x] AppService 响应完成后不再外发进度；Pi Host 按序号和 pending request 双重过滤迟到帧。
- [x] Contracts、Pi Host、AppService、Tool SDK 定向测试和全仓 `check:v2` 通过。

本切片实现与复现证据见
[公共测试说明](../TESTING.md)。

## 8. PBASH-004A 本机完成

- [x] `workspace_write` 在 Runner 启动前、进程组完全销毁后，对每个可写 grant 收集不跟随符号链接且
      排除任意层级 `.git` 的快照，返回 pre/post revision、Git clean/dirty 状态和 changed-path manifest。
- [x] manifest 区分创建、修改、删除和基于 inode 的 rename；文本 diff 单文件限 1 MB、合计限 5 MB，
      二进制和超大文件只返回类型与大小，不返回内容。
- [x] 直接写结果固定标记 `DIRECT_WORKSPACE_WRITE`、`workspace_delta_during_execution` 和
      `NOT_AVAILABLE_FOR_DIRECT_WRITE`，不把 Bash 副作用伪装成事务或通用 Undo。
- [x] 基线已 dirty 且命令执行窗口修改同一路径时返回 `preexisting_dirty_overlap`；Git 不可用与非 Git
      工作区分别显式返回，不把未知状态报告成 clean。
- [x] 既有 hard-link pre/post 边界、运行时新增 link/clone 拒绝和 `.git` Seatbelt 保护继续生效；测试补齐
      rename、删除、二进制、超大 diff 和多层 `.git` 负向矩阵。
- [x] 冻结合同显式加入 `none / direct_workspace / isolated_change_set`。无人值守 Remote 或高隔离请求
      只能路由到 `isolated_change_set`；当前后端未实现时返回
      `BROKERED_BASH_ISOLATED_CHANGE_SET_UNAVAILABLE`，不会降级为直接写。

PBASH-004A 的实现与复现证据见
[公共测试说明](../TESTING.md)。

## 9. PBASH-004B 本机完成

- [x] macOS Runner 使用 `/bin/cp -cRp` 建立 APFS CoW working copy；可写授权根只在副本中执行，宿主
      根不会进入可写 sandbox root。副本来自命令开始时当前工作区，因此包含用户已有 dirty state。
- [x] Runner 销毁全部后代后生成 `ISOLATED_CHANGE_SET`；公开结果只含 manifest/diff，before/after 恢复
      材料不进入模型结果。
- [x] SQLite v14 持久化 `WorkspaceChangeSet`、manifest、diff、恢复材料和状态机；
      `openerx_workspace_changes` 可重新发现 pending、blocked 或 `outcome_unknown` change set。
- [x] 新增 review/apply/discard/undo 工具。apply/undo 必须经过 L3 per-call 审批；未 review 的 set 不能
      apply，blocked set 不能 apply 但可以 discard。
- [x] apply 在任何写入前校验全部 grant、路径和 before hash；创建、修改、删除、rename 全部可表达时才
      多文件应用。中途失败反向恢复 preimage；apply 后只有全部 after hash 仍匹配才能 Undo。
- [x] `applying` 崩溃恢复为 `outcome_unknown`；只在每项处于 before 或 after 已知状态时允许恢复 Undo，
      第三方内容一律冲突拒绝。
- [x] 二进制、超限、目录、symlink、`.git` 或不可表达项 fail-closed 为 blocked；`node_modules` 与常见
      build cache 留在 overlay，不进入 change set。文本恢复材料单文件 1 MB、全快照 20 MB。
- [x] 真实 macOS AppService→Broker→Runner 测试证明隔离命令生成并持久化 change set，宿主 canary
      不存在；直接写 PBASH-004A 路径保持不变。

实现与复现证据见 [公共测试说明](../TESTING.md)。

## 10. PBASH-005 本机完成

- [x] Remote prompt 合同加入 `attended / unattended`：手机现有会话发送标记 attended，新任务标记
      unattended；旧客户端未提供时按 unattended 处理。
- [x] App Service 把来源冻结为模型不可修改的 `executionOrigin`，并纳入
      `BrokeredBashExecutionContext`、operation digest、Pi Host 回传匹配和审计结果。
- [x] `remote_unattended + workspace_write` 在合同层只能使用 `isolated_change_set`；Remote 同时强制
      `environment-core-v1 + network-deny-v1`，不能选择新 Workspace、额外根或网络。
- [x] `remote_attended + workspace_write` 的每个 Bash 调用使用 L3 per-call 审批；生成审批的 message/run
      绑定原 `pairingId + controllerDeviceId + hostDeviceId`，其他控制器即使同会话也不能解除等待。
- [x] Remote 审批继续校验 permission ID、attention ID、payload digest、会话、设备解锁、新鲜重认证和
      L5 生物识别；审批不能改变 grant、命令、timeout 或 policy。
- [x] Gateway 的 command ID、pairing idempotency key、base revision、session sequence 和 TTL，与
      Connector/App Service durable replay 共同覆盖至少一次投递；同键不同 payload 稳定拒绝。
- [x] SQLite v15 为所有 Tool side-effect journal 保存 operation digest；完成结果、执行中 attempt 和
      `outcome_unknown` 都拒绝 payload substitution，不会回放旧结果给新操作。
- [x] App Service 重启时未完成 Remote application 从 `applying` 转为 `outcome_unknown`；同命令重投
      返回 `REMOTE_COMMAND_OUTCOME_UNKNOWN`，Connector 生成加密 `review.available` 对账事件而不重跑。
- [x] Tool side effect 和 WorkspaceChangeSet 的 pending/blocked/apply-failed/outcome-unknown 状态通过
      受限 reconciliation 元数据投影到 Remote 收件箱；不传 before/after 材料或宿主路径。
- [x] 本机测试覆盖 attended/unattended 路由、错误控制器审批、正确控制器恢复同一 Pi 调用、Relay
      重投、App Service response 丢失、payload digest 冲突、重启恢复和加密对账事件。

实现与复现证据见 [公共测试说明](../TESTING.md)。

## 11. PBASH-006 本机完成

1. Runner 已实现 `none/core/all + include/exclude/set`：`core` 继续默认，`include` 宿主值在 App Service
   冻结后进入 policy digest，最终展开环境另存 SHA-256 证明；当前合同没有 `danger_full_access`，因此
   `all` 保持实现但不可达，Remote 只接受未修改的 `core`。
2. Secret 名称和值双重 canary 已覆盖 SSH Agent、Git、npm、pip、AWS/GCP/Azure、GitHub、Pi/Codex、
   数据库和宿主代理；Runner 自有 HOME/TMP、Git/npm/pip hardening 与短生命周期代理值在过滤后注入。
3. 显式 `allowNetwork` grant 可为 Local generation 冻结 domain allowlist；Shell 仍由 Seatbelt 拒绝全部
   直连，只能访问 Runner 的单端口代理。代理逐 HTTP 请求和 HTTPS CONNECT 重新校验域名、80/443
   端口与 DNS 全部答案，并使用已验证 IP 拨号，阻断回环、私网、链路本地、CGNAT、metadata、混合
   DNS rebinding、重定向新目标和任意代理隧道；HTTPS CONNECT 还要求 ClientHello SNI 与批准域名一致。
4. 本机真实测试证明 allowlist 中的 `example.com` 可经代理访问，而 `--noproxy` 直连失败；默认 deny、
   Unix/本机网络边界和所有既有 PBASH-002 门禁保持不变。

实现与复现证据见 [公共测试说明](../TESTING.md)。

## 12. PBASH-007 本机完成

1. 固定同一工作区、命令、timeout 和默认断网，对比旧 argv Shell 与 Brokered raw Bash；9 类任务中
   旧路径 8/9、Brokered 路径 9/9，安全越界与未解释回归均为 0。
2. 唯一差异是旧 Seatbelt profile 使 Git 无法打开 `/dev/null`，导致补丁前验证 exit 128；Brokered
   路径成功。探索、搜索、构建、测试、lint、失败诊断、长输出和停止均对齐。
3. 工具中心展示 Local Alpha、Runner/backend、policy、环境、网络和工作区状态；flag 关闭只显示
   `openerx_shell` 回滚路径，打开只投影 `bash`，Runner unavailable 时不静默回退。
4. 随后用 `deepseek-v4-flash`、thinking off、同一固定快照与默认断网完成 3 次真实模型配对：legacy
   严格 22/27，Brokered 严格 26/27、功能 27/27；Token -13.3%，未预期工具错误 3→0。
5. Platform Provider 在请求前脱敏 Pi 私有 Session/Agent 路径；`bash` 合同明确从活动授权根启动。
   Brokered 27 次运行未观察到活动根或 Pi 私有 cwd 绝对路径暴露。

实现与复现证据见 [公共测试说明](../TESTING.md) 与
[公共测试说明](../TESTING.md)。

## 13. PBASH-008 本机 fail-closed 完成

1. 已发布机器可读平台矩阵：当前 macOS 26.5.2 arm64 仅为 unsigned Local Alpha；macOS x64 未做
   主机 Runner 验证；Linux、WSL2 和 Windows 均 unavailable。
2. Linux/Windows、缺失 `sandbox-exec`/Bash、强制拒绝自检失败与 App Service probe 失败都有稳定
   fail-closed 结果；开启 flag 后 Runner 失败不会回退到旧 Shell 或 Pi 内置 Bash。
3. 工具中心新增实际 backend ID 与 platform/OS build，避免只显示含糊的“macos runner”。
4. 宽松签名检查把现有 macOS/Windows 制品全部标为 `LOCAL UNSIGNED`；严格 macOS 门禁按预期以
   `MAC_CODE_SIGNATURE_INVALID` 拒绝当前 arm64 App。

实现与复现证据见 [公共测试说明](../TESTING.md)，机器可读支持矩阵见
[公共测试说明](../TESTING.md)。Developer ID/公证包、
macOS x64 真机、Linux/WSL2/Windows backend 仍是外部硬门禁，不以本机完成状态替代。
