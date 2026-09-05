# OpenERX Pi Bash Broker 化执行方案

- 状态：`ARCHITECTURE ACCEPTED / PBASH-001..PBASH-007 LOCAL COMPLETE / PBASH-008 LOCAL FAIL-CLOSED COMPLETE / EXTERNAL RELEASE BLOCKED`
- 日期：2026-08-28（Asia/Shanghai）
- 范围：Desktop Pi Host、App Service Capability Broker、Platform Sandbox Engine、Workspace Scope、Remote
- 依赖：[ADR-V2-007](adr/007-pi-harness-boundary.md)、
  [ADR-V2-012](adr/012-capability-broker-and-tool-projection.md)、
  [ADR-V2-018](adr/018-brokered-bash-and-platform-sandbox.md)
- 当前证据边界：本文件保留受控 Shell 技术设计；旧逐次执行报告在私有资料归档维护。
  当前系统后端、签名和恢复验证以 [测试说明](../TESTING.md) 与 [桌面发布门禁](../RELEASE_GATES.md) 为准。

## 1. 结论

推荐保留 Pi 默认 Bash 对模型最有价值的部分——原始命令表达、`command + timeout` 调用习惯、Shell
语义、流式输出和取消体验——但不启用 Pi 默认的本机 Shell 执行器。安全边界不放在命令黑名单里，
而放在 Shell 外部的 Broker、执行 profile 和操作系统级沙盒里。

目标结构如下：

```text
Pi AgentSession
  -> OpenERX-owned raw-shell `bash` ToolDefinition
  -> private pi.tool.request / progress / response
  -> App Service Capability Broker
  -> Brokered Shell Runner
  -> PlatformSandboxEngine
       -> macOS Seatbelt (`/usr/bin/sandbox-exec` implementation detail)
       -> Linux bubblewrap / maintained helper
       -> Windows native sandbox or separate PowerShell backend
  -> raw Shell process and all descendants
```

必须同时保持以下决定：

1. Pi 继续是唯一 Agent Loop；OpenERX 不实现第二套规划、重试或上下文压缩。
2. `noTools: "builtin"` 继续生效，不恢复 Pi 原始 `read/bash/edit/write` 本地执行路径。
3. Pi Host 注册一个产品自有、名称为 `bash` 的 ToolDefinition，使模型仍按 Pi Bash 方式调用。
4. ToolDefinition 必须保留 `piToolCallId`，把命令转为版本化 `shell_command_execute` 操作后交给 Broker。
5. Broker 继续拥有 Workspace Scope、风险分级、审批、幂等、审计、取消和崩溃恢复。
6. Broker 分离 WorkspaceGrant、执行 profile、审批策略和风险级别；模型不能把其中任一项写进参数来扩权。
7. Runner 只能看到受信 UI 授权的工作区根、额外授权根和最小系统运行时；Pi 和模型不能提供宿主机
   绝对路径。
8. 网络默认关闭，环境变量默认使用 `core` 最小策略，不继承 SSH Agent、浏览器、云服务或包管理器
   凭证。
9. 当前 `openerx_shell` argv 工具在迁移期间保留为回滚路径，不与新 `bash` 同时执行同一调用。
10. macOS 当前可把 Seatbelt/`sandbox-exec` 作为本地后端，但系统已将该接口标记 deprecated；它必须
    封装在统一接口内，并在签名构建、OS 版本和逃逸矩阵通过后才可能成为发布后端。不可用时
    fail-closed，不得裸跑 Shell。
11. 基础 `workspace_write` 可以直接写授权工作区并生成变更证据；CoW/worktree 是高隔离 profile，外部
    无人值守远程写入必须使用，但不再是所有本地 Beta 的统一硬门槛。

这不是“开放默认 Bash”，而是“复用 Pi Bash 合同，由 OpenERX 接管执行权”。

## 2. 当前基线与关键差距

### 2.1 已有基线

- 根依赖将 `@earendil-works/pi-coding-agent` 固定为 `0.84.3`。
- `packages/pi-host/src/agent-session.ts` 使用 `noTools: "builtin"`，只注册产品自有工具。
- `packages/pi-host/src/capability-tools.ts` 当前暴露 `openerx_shell`，参数为
  `workspaceGrantId + relativeCwd + command + args`，不是 Shell 字符串。
- `packages/tool-sdk/src/shell-adapter.ts` 当前在 macOS 上使用 `/usr/bin/sandbox-exec`，限制工作区、
  过滤环境、默认拒绝网络、设置超时并管理进程组。
- `packages/tool-sdk/src/broker.ts` 已具有 Scope、精确载荷审批、ToolCall 投影、幂等和
  `outcome_unknown` 保护。
- Desktop 是唯一执行主机；Remote 只能把 Pi 原生命令送回在线 Desktop，不能直接运行 Shell。

### 2.2 Pi 默认 Bash 的事实

Pi 0.84.3 的默认 Bash：

- 接收一段任意 Shell `command`；`timeout` 可选且没有默认值；
- 使用启动 Pi 的用户权限执行，没有内置 OS 沙盒；
- 默认继承 Shell 环境，并默认加入部分 `PI_*` 会话环境变量；
- 支持输出流、截断、取消和进程树终止；
- 允许通过 `BashOperations` 替换执行后端。

`BashOperations.exec()` 证明 Pi 支持委托执行，但其 0.84.3 签名只有
`command/cwd/onData/signal/timeout/env`，没有 `piToolCallId`。直接使用该接口会丢失 OpenERX 当前
基于 `generationId + piToolCallId + toolName` 的精确幂等键和 Run 投影。因此首版不得只把
`BashOperations` 接到一个匿名远程执行器；应由 OpenERX 自己定义兼容的 `bash` ToolDefinition，
在 `execute(toolCallId, ...)` 层进入现有私有工具协议。

### 2.3 当前与目标的差异

| 维度         | 当前 `openerx_shell` | Pi 原始本地 Bash     | 目标 Broker 化 `bash`                                         |
| ------------ | -------------------- | -------------------- | ------------------------------------------------------------- |
| 模型接口     | argv + grant id      | `command + timeout`  | `command + timeout`                                           |
| Shell 语法   | 无                   | 完整                 | 完整，但在隔离 Runner 内                                      |
| 工作区       | 模型传 grant id      | Pi Host cwd/宿主权限 | 可信 UI 选择活动根和额外授权根                                |
| 权限与审批   | Broker               | 无产品 Broker        | Broker                                                        |
| 执行 profile | 无显式 profile       | 宿主用户权限         | `read_only` / `workspace_write`；危险全权限不进入 V1 远程合同 |
| 环境         | allowlist            | 继承用户环境         | `none/core/all` 策略；默认 `core`、临时 HOME/TMP              |
| 网络         | 默认拒绝             | 宿主网络             | 默认拒绝；可选受控 egress proxy/domain policy                 |
| 输出         | 最终结果为主         | 原生流式更新         | 私有协议流式更新 + 最终标准结果                               |
| 幂等/审计    | 有                   | 无产品投影           | 有，绑定原始 Pi ToolCall                                      |
| 文件写入     | 工作区直接写         | 宿主任意写           | 基础直接写 + 变更证据；高隔离 CoW/worktree 可选/按场景强制    |
| 跨平台       | 当前仅 macOS 可用    | 依赖本机 Shell       | PlatformSandboxEngine 后端显式声明能力，不可静默降级          |

### 2.4 Codex 设计参照与 OpenERX 适配

本方案采用 Codex 已验证的基本模式，但不复制其产品默认值：

- [OpenAI 官方 Sandboxing 文档](https://developers.openai.com/codex/sandboxing)明确把 sandbox 和
  approval 作为两个协作但独立的控制，并说明边界作用于 `git`、包管理器、测试运行器等所有派生
  命令。OpenERX 因此允许完整 Shell 语义，把强制边界放到 Runner 外层。
- Codex 使用平台原生隔离，并在权限边界内减少逐命令审批；OpenERX 对应采用
  `PlatformSandboxEngine`，各操作系统提供自己的后端，而不是强制所有平台使用同一容器或 VM。
- [OpenAI 官方 Agent approvals & security 文档](https://developers.openai.com/codex/agent-approvals-security)
  将文件、网络与审批边界分开。OpenERX 同样分离执行 profile、网络 policy 和审批，但网络默认 deny，
  环境变量与宿主数据读取比通用本地 Coding Agent 更严格。
- OpenERX 额外保留 WorkspaceGrant、持久 ToolCall、精确 payload digest、`outcome_unknown` 和 Remote
  至少一次投递对账。这些属于本产品的远程副作用合同，不能用本地沙盒代替。

这里的“参考 Codex”是架构模式和安全原则，不是声称 OpenERX 与 Codex 内部实现、默认权限或发布
保证完全相同。

## 3. 目标与非目标

### 3.1 目标

1. 让模型可使用管道、重定向、条件、here-document、通配符、命令替换和项目脚本等标准 Bash
   语义，减少 argv 工具的拆分调用和无效参数。
2. 保持 Pi 的工具调用、输出更新、停止和上下文语义，不复制 Agent Loop。
3. 确保任何命令都不能绕过 Capability Broker 或扩大当前 Conversation 的 Workspace Scope。
4. 确保 Desktop 本地请求和 Remote 请求使用完全相同的权限、审批、幂等和执行链。
5. 对宿主文件、网络、环境变量、凭证、子进程、输出和持久化变更建立可验证边界。
6. 用显式执行 profile 和平台能力探测表达权限，不把 L2/L3/L4 风险级别混同为 OS 隔离等级。
7. 使用 feature flag 分阶段引入，能够无数据迁移地回滚到 `openerx_shell`。
8. 用同一组 Golden Task 比较安全 argv Shell 与 Broker 化 Bash 的完成率、调用次数、Token 和错误。

### 3.2 非目标

- 不恢复 Pi 默认 File/Edit/Write 工具。
- 不让 Pi Host 获得直接 `child_process` 或任意宿主网络权限。
- 不通过正则、命令黑名单或 LLM 判断把任意 Shell 字符串证明为“安全”。
- 不允许模型选择宿主绝对路径、用户 HOME、SSH Key、浏览器 Profile、Keychain 或任意凭证目录。
- 不在首版支持 PTY、交互式密码输入、长期后台 daemon 或宿主 Docker Socket。
- 不要求每次本地交互式命令都运行在容器、VM 或 CoW 文件系统中；高隔离按 channel/profile 强制。
- 不向 Remote 或外部发布会话提供 `danger_full_access`；V1 也不允许它作为失败时的降级路径。
- 不把一次 macOS 未签名本地运行当作 Windows、签名安装包或生产隔离证据。
- 不在本方案中删除现有 `openerx_shell` 或改写历史 ToolCall。

## 4. 目标架构和信任边界

```text
Renderer / Remote control plane
  -> App Service prepares active workspace and available tools
  -> Pi Host creates AgentSession with built-ins disabled
  -> product raw-shell `bash` receives { command, timeout }
  -> Pi Host sends typed shell_command_execute with piToolCallId
  -> App Service validates active generation and operation schema
  -> Capability Broker
       -> resolves current unexpired WorkspaceGrant
       -> derives execution profile, writable roots, env/network policy and exact payload digest
       -> waits for approval when required
       -> journals attempt before uncertain side effects
       -> dispatches BrokeredShellRunner
  -> PlatformSandboxEngine
       -> selects a verified OS backend or fails closed
       -> maps logical roots to trusted WorkspaceGrants
       -> applies filesystem/network/env/resource policy to the full process tree
       -> starts one foreground process group
       -> streams redacted output
  <- progress frames / final normalized result
  <- Pi continues its own Agent Loop
```

### 4.1 Pi Host 边界

Pi Host 只负责：

- 暴露模型熟悉的 `bash` 工具；
- 保留 Pi 原始 `piToolCallId`；
- 将 Pi 的 AbortSignal 和输出更新映射到私有工具协议；
- 把 Broker 返回的标准内容转换为 Pi ToolResult。

Pi Host 不负责：

- 解析命令以决定权限；
- 解析或保存真实工作区根路径；
- 启动本机 Bash；
- 获取宿主凭证；
- 自行批准、重试或恢复有副作用的命令。

### 4.2 App Service / Broker 边界

Broker 是唯一授权点：

- 以 Conversation、Generation、WorkspaceGrant 和 Pi ToolCall 为绑定条件；
- 将 WorkspaceGrant、执行 profile、审批策略和风险等级分别计算，任何一层都只能收窄权限；
- 使用完整版本化操作计算 payload digest；
- 在执行前写入 ToolCall 和 side-effect attempt；
- 对重复请求返回已完成结果，或对 `executing/outcome_unknown` 要求先对账；
- 在权限撤销、Run 停止、Pi Host 断开或 App Service 关闭时取消 Runner；
- 不把 Runner 的私有宿主路径返回 Pi、Renderer 或 Remote。

### 4.3 Runner 边界

Runner 是唯一请求创建 Shell 进程的产品组件；真正的 spawn 必须由 `PlatformSandboxEngine` 的已验证
后端完成。Runner 至少是独立 Helper/进程，也可以在高隔离模式使用 container/VM，但不得退化为 Pi
Host 内部函数。至少满足：

- 只有最小只读系统运行时、已授权工作区根和显式额外根可见；
- 工作区外默认 deny；
- 临时 HOME、TMP、cache 和配置目录；
- 无继承的 `SSH_AUTH_SOCK`、云 Token、Git 凭证、npm/pip 凭证或 `PI_*`；
- 网络按 Broker 下发的不可变 network policy 决定；
- 一个 ToolCall 一个进程组和一个所有者；
- 超时、取消、断连和关闭都会回收整个进程树；
- 无 Docker Socket、宿主 IPC、任意设备或浏览器 Profile 挂载；
- Runner 版本和策略摘要进入审计结果。

### 4.4 Platform Sandbox Engine 边界

`PlatformSandboxEngine` 是稳定的产品接口，平台实现是可替换细节。统一输入至少包括：

- 逻辑 cwd、只读根和可写根；
- 执行 profile、环境 policy、网络 policy 和资源上限；
- Shell argv、timeout、取消信号和 ToolCall identity；
- Runner/backend/policy 版本。

统一输出至少包括 exit/signal、截断后的 stdout/stderr、完整日志 Artifact、changed-path manifest、后端
证明和销毁状态。引擎必须先完成能力探测再向 Pi 投影工具；某后端缺少必需文件、网络或进程边界时，
该 profile 不可用，不能改用无沙盒 spawn。

## 5. 工具投影与版本化合同

### 5.1 模型可见工具

首版工具保持 Pi Bash 的核心调用形状：

```ts
interface BrokeredBashInput {
  command: string;
  timeout?: number; // seconds
}
```

产品约束：

- 工具名：`bash`。
- `command` 最大 64 KiB；拒绝 NUL 和无效 UTF-8。
- 默认超时 120 秒；最小 1 秒，最大 1,800 秒。
- 固定为前台、非 PTY 执行；Shell 中的 `&` 不获得可持续后台生命周期。
- 描述中明确“当前目录”为可信 UI 选定的活动工作区，不是 Pi Host 的私有
  `profile/pi-workspace`。
- 持久文件编辑继续优先使用 `openerx_workspace_apply_patch`；Bash 主要用于检查、构建、测试和
  项目工具链。
- 不向模型暴露 `workspaceGrantId`、绝对 cwd、Runner 类型或宿主路径。
- V1 不接受模型传入 execution profile、writable roots、environment policy 或 network policy；这些都由
  可信 UI、WorkspaceGrant 和 Broker 派生。

名称兼容不等于直接导入 Pi 的原始本地工具。`noTools: "builtin"` 必须持续通过源码检查和测试。

### 5.2 活动工作区与额外授权根

Pi 默认 Bash 没有 `workspaceGrantId` 参数，因此产品必须在可信控制面预先确定活动执行工作区：

1. `PiPromptFrame.workspace` 增加可选 `execution` 对象，其中包含 `activeExecutionGrantId`、由可信 UI
   产生的 `additionalExecutionGrantIds`，以及冻结的 profile、environment/network/sandbox policy 版本；
   这些字段都不进入模型可见 schema。
2. 该 ID 必须属于同一帧的有效 grant，并在 App Service 执行时重新查询，不能只信 Pi Host 缓存。
3. 只有一个有效工作区时，可信 UI 可把它设为活动工作区；多个工作区时必须由用户明确选择活动根。
   额外根必须逐个授权，并以稳定逻辑名称挂载，不能让模型提交宿主绝对路径。
4. 没有活动 grant、grant 已撤销/过期或平台 Runner 不可用时，不向 Pi 提供 `bash`。
5. `read_only` grant 只能进入只读根；`read_write` grant 也只有在 `workspace_write` profile 下才能进入
   可写根。grant 和 profile 任一为只读时，最终结果都是只读。
6. 模型在命令中使用 `cd ..`、绝对路径、符号链接、挂载点或子进程时，最终访问仍由 OS/虚拟化
   边界限制，不能只依赖 cwd 字符串校验。

### 5.3 Broker 操作

新增操作，不改变现有 argv `shell_execute` 的持久化语义：

```ts
interface ShellCommandExecuteV1 {
  operation: "shell_command_execute";
  contractVersion: "brokered_bash_v1";
  idempotencyKey: string;
  activeWorkspaceGrantId: string;
  additionalWorkspaceGrantIds: string[];
  shell: "bash";
  command: string;
  timeoutMs: number;
  executionProfile: "read_only" | "workspace_write";
  environmentPolicyId: string;
  networkPolicyId: string;
  sandboxPolicyVersion: string;
}
```

所有 grant、profile 和 policy 字段都由 Pi Host 的受信会话上下文与 App Service 当前状态派生，
不是从模型参数复制。任何以下变化都必须产生新的 payload digest，旧审批不得复用：

- 命令字节；
- 活动 grant、额外根及其只读/可写模式；
- timeout；
- execution profile、environment/network policy；
- shell/contract 版本；
- Runner/backend/sandbox policy 版本。

### 5.4 为什么不直接只用 `BashOperations`

Pi 的 `BashOperations` 仍可用于未来适配，但 0.84.3 的接口不能单独满足：

- 取得原始 `piToolCallId`；
- 表达 Permission Required 等产品状态；
- 使用现有 `pi.tool.request` 精确投影；
- 返回 OpenERX Artifact ID 而不是 Pi Host 临时文件路径；
- 将活动 WorkspaceGrant 绑定到操作。

因此首版采用 OpenERX-owned `bash` ToolDefinition。增加一项 Pi 升级兼容测试：每次升级 Pi 时比较
其 Bash 工具名称、输入 schema、默认提示贡献、输出截断和取消语义；发生漂移必须显式评审，不能
静默假装兼容。

## 6. 权限、风险和审批策略

执行 profile 定义 OS 边界，WorkspaceGrant 定义资源范围，L2/L3/L4 定义产品风险与审批。三者必须分开：

| 执行 profile         | 文件能力                                           | 产品可用范围                                                     |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `read_only`          | 授权根只读；仅 Runner HOME/TMP/cache 可写          | Local、Remote；默认诊断模式                                      |
| `workspace_write`    | 只写 `read_write` grant 对应根；其他授权根保持只读 | Local 默认写入模式；Remote 需相同或更严格审批                    |
| `danger_full_access` | 不施加工作区文件边界                               | 仅保留为本地开发/故障诊断架构槽位；V1 外部构建和 Remote 合同禁止 |

| 条件                                                 | 结果                             | 风险/审批                                    |
| ---------------------------------------------------- | -------------------------------- | -------------------------------------------- |
| 无活动 WorkspaceGrant                                | 不暴露工具或拒绝                 | fail-closed                                  |
| `read_only` profile + network deny                   | 允许授权根只读命令；临时目录可写 | L2/L3，按 Workspace Scope                    |
| `workspace_write` profile + network deny             | 允许 `read_write` 根内变更       | L3，要求有效执行 Scope                       |
| 任一受限 profile + egress policy                     | 只允许 policy 内的受控出站网络   | L4；首启/按 Scope 明确授权，不得隐式持久授权 |
| 工作区外路径、宿主 HOME、设备或 Socket               | 拒绝                             | 不降级为 L5 执行                             |
| 字面凭证、SSH Agent、云 Token 注入                   | V1 拒绝                          | 未来 SecretRef 单独设计                      |
| PTY、提权、长期 daemon                               | V1 拒绝                          | 不可自动降级                                 |
| `danger_full_access` 来自 Remote、模型参数或外部构建 | 拒绝                             | 不允许通过审批把不支持的 profile 变成可用    |

规则：

1. 网络授权以 WorkspaceGrant 的可信设置为上限；模型不能在 `command` 外附带“允许网络”声明。
2. 审批只能允许已定义边界内的动作，不能把后端能力缺失、不可用 profile 或越界根“批准”为可执行。
3. Shell 字符串检查只能用于提示和遥测，不能作为安全边界。`eval`、子 Shell、脚本、包管理器
   lifecycle hook 和解释器都能绕过静态命令分类。
4. 原始命令需要出现在用户审批卡中，但不得把已知 Vault Secret 写入命令、ToolCall 摘要或日志。
   V1 不提供 Secret 注入；发现凭证型输入时拒绝并提示使用未来的受控 SecretRef。
5. 网络命令属于不确定外部副作用。Broker 在 spawn 前写 journal；崩溃后标记
   `outcome_unknown`，不能自动重跑。
6. Remote 发起不会降低风险级别。审批仍由 Desktop Broker 产生，Remote 只能响应原请求，不能扩大
   grant、命令或网络范围。

## 7. 文件写入与可恢复性

完整 Bash 可以通过重定向、脚本或编译器写文件。只限制 cwd 不能保证 Patch/Diff/Undo，但也不需要
把每次本地命令都强制放进 CoW 文件系统。方案分为“基础直接写”和“高隔离 working copy”两级。

### 7.1 基础 `workspace_write`

- 复用现有 `read_write` WorkspaceGrant 和工作区边界；
- 命令开始前记录工作区 revision、用户已有 dirty state 和受影响范围基线；结束后记录 changed-path
  manifest、Git 状态和可生成的文本 diff；
- 禁止写 `.git` 元数据、工作区外路径和宿主配置目录；
- 结构化文件修改仍优先使用 `openerx_workspace_apply_patch`；Shell 直接写用于构建工具、生成器和项目脚本；
- 对执行期间发生的用户并发修改进行 revision/conflict 检查，不能用旧基线静默覆盖；
- 明确标记结果为 `DIRECT_WORKSPACE_WRITE`，不声称任意 Shell 命令都能原子 Undo；
- Local Alpha 和 External Beta 都可以使用该模式，但必须通过签名构建、路径逃逸、崩溃恢复和变更证据
  门禁。

### 7.2 高隔离 working copy / CoW

高隔离模式让 Runner 为每次 ToolCall 使用独立 copy-on-write、临时 worktree 或等价 working copy：

1. 基线来自命令开始时的当前工作区，包括用户已有未提交修改。
2. 系统运行时和依赖可只读共享；HOME、TMP 和 cache 独立。
3. 命令写入先落到 overlay，不直接破坏宿主工作区。
4. 结束后生成 `WorkspaceChangeSet`：文本 patch、二进制清单、创建/删除/重命名和大小摘要。
5. 可接受变更通过现有 Workspace 变更通道原子导入，并保留 Undo 前镜像；超限、设备文件、Socket、
   `.git` 或不可表达变更 fail-closed。
6. `node_modules`、构建 cache 和临时输出默认留在 Runner cache/overlay，不自动合并；用户需要的结果
   通过 Artifact 或显式工作区变更导入。
7. Runner 退出前终止所有后代，避免后台进程在提交后继续修改 overlay 或宿主目录。

该模式不是所有本地 Beta 的统一硬门槛，但以下场景必须使用：

- 外部无人值守 Remote 的写入命令；
- 产品判断为高破坏性、批量或难以表达恢复边界的写入；
- 用户选择“隔离运行/先审阅后应用”。

若高隔离后端不可用，上述场景必须降级为 `read_only` 或拒绝，不能静默改成直接写。

### 7.3 恢复与 channel 决策

| 场景                          | 默认写入模式                                  |
| ----------------------------- | --------------------------------------------- |
| Local 交互式会话              | `workspace_write` 直接写 + diff/manifest      |
| Remote 实时控制且用户正在审批 | 可直接写，但权限、证据和恢复边界与 Local 相同 |
| Remote 无人值守/延迟执行      | 高隔离 working copy；不可用则拒绝写入         |
| `read_only` profile           | 只允许 Runner 临时目录写，不合并到工作区      |

Git diff、补丁和备份能提高可恢复性，但不能伪装成所有 Shell 副作用的事务保证；数据库、外部网络和
工具自身状态仍按独立 capability 与 `outcome_unknown` 规则处理。

## 8. 环境、网络与凭证

### 8.1 环境变量

环境策略采用可审计的 `none/core/all` 模型，并支持 `include/exclude/set`：

- `none`：除启动 Shell 所需的 Runner 内部值外不继承宿主环境；
- `core`：V1 默认，只提供下列最小非敏感集合；
- `all`：仅允许本地 `danger_full_access` 诊断槽位显式选择，外部构建和 Remote 禁止。

`core` 默认只提供：

- 受控 `PATH`；
- `LANG/LC_ALL`；
- Runner 内的 `HOME/TMPDIR/TEMP/TMP`；
- 非敏感的 Runner/平台标识。

默认删除：

- 所有 `PI_*`；
- `SSH_AUTH_SOCK`、`GIT_ASKPASS`；
- AWS/GCP/Azure、GitHub/GitLab、npm/pip、数据库和代理凭证；
- Electron/浏览器 Profile 路径；
- App Service、账户、模型 Provider 和支付 Token。

即使用户配置了 include，也必须先经过 Secret 名称和值 canary 过滤；policy 的最终展开值和摘要由
Broker 记录，但日志不能记录 Secret 明文。Pi 侧的兼容 ToolDefinition 不得重新开启
`exposeSessionEnvironment`。未来若命令需要凭证，必须新增
独立、可审计、短期、目标受限的 SecretRef 合同，不能把 Secret 拼接到 `command` 或普通环境变量。

### 8.2 网络

- 默认 `deny`，包括 DNS、Unix Socket/Named Pipe 和本机服务探测。
- 只有 WorkspaceGrant 明确允许且 Broker 选择了 network policy 时才能开启网络，并按 L4 处理。
- 允许网络时优先通过受控 egress proxy/domain allowlist 实施；policy 必须阻止回环、链路本地、宿主私网、
  云 metadata，并对重定向、代理隧道和 DNS rebinding 做 best-effort 防护。
- 命令字符串中的域名只用于展示和遥测，不是执行边界；实际目标由代理或平台网络层校验。
- 不允许访问云实例 metadata、本机回环管理端口或宿主私网，除非未来有单独 capability。
- 下载内容仍是不可信输入，不能扩大 Scope；包管理器 install/postinstall 在同一隔离边界内执行。

## 9. 进程、流式输出和取消

### 9.1 进程语义

- 每次调用只创建一个前台 Shell 进程组。
- 默认 120 秒，最大 30 分钟；超时后 TERM，短暂宽限后 KILL 整个进程树。
- Pi Abort、Run Stop、Workspace revoke、App Service shutdown 和 Remote abort 都走同一取消路径。
- 命令完成后不保留 `&`、`nohup`、double-fork 或 daemon 化进程。
- V1 不支持 PTY 和交互式密码；需要长期服务时继续使用现有显式进程工具，且不能绕过同一 Runner。
- 后续若加入 PTY/持续进程，必须使用新的 `brokered_shell_session_v1` 合同和 session owner，不得悄悄
  扩展当前一次性、可幂等对账的 `shell_command_execute`。
- CPU、内存、进程数、打开文件数和临时磁盘必须有上限；fork bomb 和磁盘填满属于必测负向用例。

### 9.2 私有进度协议

PBASH-003 已在私有 Pi IPC v5 中加入有序进度帧；App Service 的 `tool.progressed` 仍独立用于产品
投影，不从 Pi 回显反向构造事实：

```ts
interface PiToolProgressFrame {
  kind: "pi.tool.progress";
  requestId: string;
  sequence: number;
  delta: string;
  truncated: boolean;
}
```

- Pi Host 将进度映射到 ToolDefinition 的 `onUpdate`。
- App Service/Renderer 继续从 Broker 投影进度，不从 Pi 的回显反向构造事实。
- 序号必须单调；结束、取消或失败后忽略迟到帧。
- 进度与最终结果都经过 ANSI/控制字符处理和凭证脱敏。
- 上下文返回沿用 Pi 基线：最多 2,000 行或 50 KiB；完整日志最多 2 MiB，超出后截断。
- 完整日志进入 OpenERX Artifact/受控文件存储并返回 ID，不返回 Pi Host 或 Runner 临时绝对路径。
- 无换行单行超过 64 KiB 时整行替换为固定脱敏标记；这是防凭证跨边界泄露的 fail-closed 行为。

## 10. 平台隔离策略

### 10.1 统一 PlatformSandboxEngine

平台引擎负责能力探测、profile 编译、进程启动、全后代约束、取消、资源回收和证明采集。每个后端必须
实现相同的合同测试，但不要求使用相同底层技术：

- 输入中的根路径只能来自 Broker 已解析的 grant；
- sandbox policy 必须覆盖 Shell 启动的 `git`、包管理器、测试运行器、解释器和所有后代；
- 文件、网络、环境和资源能力逐项声明，缺少必需能力时对应 profile 不可用；
- backend/policy/OS build、签名状态和测试矩阵进入日期化证据；
- 初始化失败、profile 编译失败或销毁状态不确定时 fail-closed。

### 10.2 macOS Seatbelt 后端

macOS 后端可以把 `/bin/bash` 作为 Seatbelt profile 内的子进程运行；当前实现可调用系统自带的
`/usr/bin/sandbox-exec`，但该可执行文件只作为 `MacOSSandboxBackend` 的实现细节，不进入 Broker 或
模型合同。

它只可能在以下条件全部满足后成为 Beta/Release 的 macOS 发布后端：

- 针对工作区外读写、符号链接、hard link、`process*`、`mach-lookup`、网络和进程后代完成负向测试；
- 额外使用独立 Helper、进程组与资源限制补齐 Seatbelt 不负责的 CPU、内存、进程数和临时磁盘边界；
- 未签名开发、签名安装包和支持的 macOS 版本分别留存真实证据；
- 系统组件缺失、行为漂移或 profile 验证失败时移除工具，而不是裸跑 Bash。

PBASH-002 只证明 macOS 26.5.2 本机的 `macos-seatbelt-v1`。系统手册已明确把
`sandbox-exec` 标记为 deprecated，因此真正的发布条件仍是统一抽象、可重复测试、签名构建验证、
支持 OS 矩阵和 fail-closed；任一条件失败都必须更换后端或保持 unavailable。

### 10.3 Linux 后端

Linux/WSL2 优先使用 bubblewrap、受维护 helper 或等价的 namespace/seccomp/cgroup 组合。后端需要明确
探测 unprivileged user namespace、挂载、网络 namespace 和 cgroup 能力；主机不满足条件时不能退回
普通 `child_process`。容器可以作为部署形式，但不是合同要求。

### 10.4 Windows 后端

V1 不把 Bash 字符串静默改写为 PowerShell。Windows 有两条可选路线：

1. 提供受管 POSIX Runner，使同一 `bash` 合同跨平台执行；或
2. 使用原生受限账户/token、ACL、Job Object 和防火墙实现 Windows sandbox，并另建 Broker 化
   `powershell` ToolDefinition 与合同。

在路线和安全矩阵完成前，Windows 明确显示 `BASH_RUNNER_UNAVAILABLE`，macOS 证据不得外推。

### 10.5 高隔离后端

container、轻量 VM、远程隔离服务、CoW 或临时 worktree 是 `PlatformSandboxEngine` 可选择的高隔离
实现，用于无人值守 Remote、高风险写入和“先审阅后应用”。它们补充而不是替代基础平台后端；是否
启用由 channel/profile/policy 决定，不由模型命令决定。

## 11. 分阶段实施计划

| 阶段      | 工作项             | 主要交付                                                                                           | 退出条件                                                      |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| PBASH-000 | 决策归档           | 本方案；ADR-V2-018                                                                                 | COMPLETE                                                      |
| PBASH-001 | 合同与工具投影     | `brokered_bash_v1`、活动/额外根、执行 profile、产品 `bash` ToolDefinition、Pi 兼容测试             | 原始 Pi 本地 Bash 仍不可达；合同正负测试通过                  |
| PBASH-002 | Broker 与平台引擎  | 新操作、`PlatformSandboxEngine`、macOS Seatbelt backend、最小环境、网络 deny、timeout/process tree | 路径/环境/网络/进程负向测试通过；形成 backend capability 证据 |
| PBASH-003 | 进度、取消与日志   | `pi.tool.progress`、Abort 贯通、50 KiB 结果、受控完整日志 Artifact                                 | LOCAL COMPLETE；流式顺序、截断、取消、迟到帧和断连测试通过    |
| PBASH-004 | 变更可见与恢复     | 直接写 diff/manifest/conflict；高隔离 CoW/worktree `WorkspaceChangeSet`                            | 基础写入门禁通过；无人值守 Remote 不会降级为直接写            |
| PBASH-005 | Remote、审批与幂等 | Remote 同链路、精确审批、重复投递、`outcome_unknown` 对账                                          | LOCAL COMPLETE；重放不重复执行；Remote 不扩大权限             |
| PBASH-006 | 网络与环境 policy  | `none/core/all`、include/exclude/set、egress proxy/domain policy、Secret canary                    | 默认离线；环境无凭证；允许网络仍不能访问本机/私网/metadata    |
| PBASH-007 | 效果评估与渐进启用 | Golden A/B、feature flag、工具可用性 UI、回滚演练                                                  | LOCAL COMPLETE；真实模型 3 次配对已记录                        |
| PBASH-008 | 发布与平台矩阵     | 签名 macOS、Linux/Windows 后端路线和安装包证据                                                     | LOCAL FAIL-CLOSED COMPLETE；签名/跨 OS External Blocked       |

### 11.1 建议改动位置

以下是实施候选，不代表已经修改：

- `packages/contracts/src/pi.ts`
  - 活动/额外执行根；执行 profile；工具进度帧。
- `packages/contracts/src/tool.ts`
  - `shell_command_execute`、`brokered_bash_v1`、Runner 结果和错误码。
- `packages/pi-host/src/bash-tool.ts`
  - 新增产品自有 `bash` ToolDefinition；保留 toolCall ID、signal 和 onUpdate。
- `packages/pi-host/src/host.ts`
  - 创建 `bash`、传递活动 grant、处理有序进度帧。
- `packages/pi-host/src/agent-session.ts`
  - 保持 built-ins disabled；更新安全提示和活动工作区说明。
- `packages/app-service/src/pi-host-client.ts`
  - 私有进度帧转发和结束状态清理。
- `packages/app-service/src/tool-app-service.ts`
  - Broker 请求、权限等待、取消和 Runner 生命周期。
- `packages/tool-sdk/src/policy.ts`
  - 新操作风险与审批映射。
- `packages/tool-sdk/src/brokered-shell-runner.ts`
  - Runner 协议，不在 Pi Host 内 spawn。
- `packages/tool-sdk/src/platform-sandbox/*`
  - 稳定引擎合同、capability probe、macOS/Linux/Windows backend 和统一合同测试。
- `apps/desktop/src/main/*`
  - Runner Host、平台能力探测和 feature flag；Renderer 不获得任意 IPC。
- 对应 contracts、pi-host、app-service、tool-sdk 和 Desktop E2E 测试。

## 12. 测试与证据矩阵

### 12.1 合同与兼容

- 接受 `command + timeout`，拒绝未知字段、NUL、超长命令和超限 timeout。
- 自定义 `bash` 与 Pi 0.84.3 的名称、核心 schema、非零退出、截断和取消语义一致。
- `noTools: "builtin"` 源码/运行时检查持续通过。
- 新操作不会被旧 `shell_execute` schema 接受，旧历史调用仍可读取。
- 无活动 grant、多个未选择 grant、额外根、profile、只读/读写、撤销和过期状态全部 fail-closed。
- 模型不能提交或覆盖 grant、profile、env/network policy、backend 或宿主路径。

### 12.2 Shell 正确性

- quoting、空格、Unicode、管道、重定向、here-document、条件、通配符、子 Shell。
- stdout/stderr 交错、非零 exit、signal exit、空输出和二进制输出。
- 项目 `build/test/lint`、Git 只读检查和常见包脚本。
- 每次调用从活动工作区逻辑根开始；跨调用不隐式保留 `cd` 或 Shell 环境。
- 额外授权根使用稳定逻辑路径，多个根中的同名文件不会产生不确定映射。

### 12.3 安全负向

- `$HOME`、`~/.ssh`、浏览器 Profile、Keychain、云配置和未授权相邻仓库不可读写。
- `..`、绝对路径、符号链接、hard link、挂载点、`/proc` 类接口和竞态逃逸。
- `$(...)`、反引号、`eval`、解释器、下载脚本、npm/pip lifecycle hook 不能扩大边界。
- network deny 下的 DNS、IPv4/IPv6、回环、Unix Socket/Named Pipe 和私网访问全部失败。
- 环境中无宿主 Token、`PI_*`、SSH Agent 或真实 HOME。
- `none/core/all`、include/exclude/set 的优先级、Secret canary 和 digest 绑定通过测试；外部/Remote
  不能选择 `all`。
- fork bomb、后台 daemon、`nohup`、double-fork、进程数、内存、CPU、磁盘和输出洪泛被限制并回收。
- Runner 或 Broker 崩溃后没有存活子进程、越界写入或自动重复命令。
- 每个支持平台运行同一套 PlatformSandboxEngine 合同测试；能力探测失败不会进入无沙盒 fallback。
- egress allowlist 下的重定向、DNS rebinding、代理隧道、回环、私网和 metadata 负向测试通过。

### 12.4 Broker、审批和 Remote

- payload 改一个字节、timeout、grant、网络模式或 Runner policy 后旧审批失效。
- 相同 idempotency key 的完成调用只回放结果，不再次 spawn。
- `executing/outcome_unknown` 阻止盲目重试并给出可对账状态。
- Permission pending 时 Pi 调用保持等待；拒绝、过期、停止和断连正确结束。
- Remote 至少一次投递不会重复执行；Remote 不能选择新 workspace 或开启网络。
- 无人值守 Remote 写入只能进入高隔离 working copy；后端不可用时拒绝而非直接写。
- ToolCall、RunStep、PermissionRequest 和最终结果使用同一 Pi ToolCall 身份。

### 12.5 Golden A/B

使用固定模型、相同提示、相同工作区快照和相同网络策略，对比：

- 当前 `openerx_shell`；
- Broker 化 `bash`。

任务至少覆盖：仓库探索、组合搜索、构建、测试、lint、失败诊断、生成补丁前验证、长输出和停止。
记录完成率、模型轮次、工具调用数、无效调用、Token、总耗时、审批次数和安全拒绝。推广条件不是只看
速度：所有安全负向必须零越界，现有 Golden Task 不得因工具切换产生未解释回归。

## 13. 验收门槛

### 13.1 Local Alpha

- [x] Pi 原始 `createLocalBashOperations` 不可从生产会话到达。
- [x] `bash` 只在存在有效活动 WorkspaceGrant 且 Runner 可用时出现。
- [x] 所有 Bash 命令通过 Broker，ToolCall、Scope、审批和幂等可查询。
- [x] 工作区外读写、宿主凭证和默认网络负向测试通过。
- [x] timeout、Abort、Stop、Host/App Service 断连能回收整个进程树。
- [x] Pi 收到有序流式更新和最终 exit code；完整输出不暴露宿主路径。
- [x] Remote 重复投递不重复执行。
- [x] 当前 argv Shell 可通过单一 feature flag 恢复。
- [x] 证据明确标记 `LOCAL ALPHA / DIRECT_WORKSPACE_WRITE / NO GENERAL UNDO`。
- [x] backend capability、policy 版本和销毁状态进入审计；初始化失败不会裸跑 Shell。

### 13.2 External Beta

- [ ] `PlatformSandboxEngine` 与目标平台后端合同稳定；macOS 可以使用 Seatbelt/`sandbox-exec` 实现，
      但不得绕过独立 Runner、资源限制、能力探测和 fail-closed。
- [ ] 签名安装包中的文件、网络、进程、权限与销毁测试通过。
- [x] 基础直接写具有 pre/post revision、changed-path manifest、diff 和已有 dirty overlap 冲突证据；产品不承诺任意
      Shell 变更原子 Undo。
- [x] 无人值守 Remote 写入已使用 working copy/CoW `WorkspaceChangeSet`，或明确限定为只读；不可用时
      不降级为直接写。
- [x] 本机凭证 canary、网络、路径逃逸、资源耗尽和崩溃恢复测试通过；签名包/跨 OS 仍待 PBASH-008。
- [x] `core` 环境 policy 默认生效；受控 egress 的域名、重定向和私网阻断测试通过。
- [x] Golden A/B 显示核心 Coding 功能不回归，并记录严格完成率、格式偏差、Token、耗时与错误的真实数据。
- [ ] Privacy/diagnostics/export 不包含原始 Secret、宿主路径或超限命令输出。

### 13.3 Release

- [x] macOS/Linux/Windows 明确支持矩阵已发布；当前无 Release Supported 平台，未支持平台 fail-closed。
- [ ] Runner 更新、签名、版本锁定和回滚流程完成。
- [ ] 每个平台的 backend/policy/OS 版本支持矩阵和失效策略已经发布；不要求所有平台使用同一隔离技术。
- [ ] 真实 Remote、离线、重复投递、网络切换和主机重启故障演练通过。
- [ ] 发布说明明确 Bash 的 workspace、network、credential、background 和 Undo 边界。

## 14. 渐进启用与回滚

建议 feature flag：`OPENERX_BROKERED_BASH_V1`。

1. 默认关闭，只运行合同和确定性测试。
2. 开发者本地 opt-in，工具中心显示 `Local Alpha`、Runner/backend、execution profile、network 和
   workspace roots 状态。
3. 小范围账户/会话开关，保留 `openerx_shell` 但同一会话只向模型暴露一个默认执行工具。
4. Golden 与安全门禁通过后，macOS Beta 候选默认开启；Windows 未完成时仍 unavailable。
5. 发布门禁通过后再考虑移除模型可见的 `openerx_shell`，历史回放能力继续保留。

回滚只关闭新工具投影并恢复 `openerx_shell`，不得：

- 修改或删除历史 ToolCall；
- 自动重放未完成 Bash；
- 把 overlay/Runner 私有路径泄露给用户；
- 在新 Runner 不可用时静默回退到 Pi 本机 Bash。
- 把高隔离请求静默降级成直接工作区写入，或把 `read_only` 升级成 `workspace_write`。

## 15. 默认产品决定与待验证项

| 项目          | 本方案默认决定                                                                | 仍需证据                            |
| ------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| 工具名        | `bash`                                                                        | Pi 升级兼容测试                     |
| 执行器        | BrokeredShellRunner + PlatformSandboxEngine                                   | macOS/Linux/Windows 真实后端        |
| 执行 profile  | V1 `read_only` / `workspace_write`；`danger_full_access` 禁止 Remote/外部构建 | profile UX 与本地诊断开关           |
| 活动目录      | 可信 UI 选定的一个 WorkspaceGrant                                             | 多工作区 UX                         |
| 额外根        | 可信 UI 逐个授权；模型只见逻辑路径                                            | 多根映射和撤销 UX                   |
| 默认网络      | deny                                                                          | 受控 egress 与真实包管理器任务      |
| 环境          | `core`；临时 HOME/TMP；支持 none/include/exclude/set                          | 真实工具链最小变量集合              |
| 默认 timeout  | 120 秒，最大 1,800 秒                                                         | 长任务分布                          |
| 后台/PTY      | V1 不支持                                                                     | 是否需要统一长期进程体验            |
| 输出          | 2,000 行/50 KiB 上下文，完整日志最大 2 MiB Artifact                           | 大日志性能与脱敏                    |
| 持久写入      | 基础直接写 + diff/manifest；无人值守 Remote 强制 working copy/CoW             | 大仓库性能、二进制策略              |
| macOS sandbox | Seatbelt/`sandbox-exec` 仅为已通过本机门禁的可替换 backend 实现细节             | deprecated 接口替代评估、签名构建和 OS 版本矩阵 |
| Linux sandbox | bubblewrap/maintained helper，能力不足 fail-closed                            | 发行版/WSL2 矩阵                    |
| Windows       | 未有等价 Runner 前 unavailable                                                | POSIX Runner 或独立 PowerShell 决策 |

## 16. 当前检查点与外部门禁

PBASH-001、PBASH-002 与 PBASH-003 已在 2026-08-28 依次完成：第一阶段冻结合同、产品 `bash`
ToolDefinition 和 deterministic fake adapter；第二阶段接入真实 `PlatformSandboxEngine`、`macos-seatbelt-v1`、capability
probe、最小环境、默认断网、hard-link 预检、资源限制和进程组回收。证据分别见
[公共测试说明](../TESTING.md) 与
[公共测试说明](../TESTING.md)。PBASH-002 严格标记为当前主机
`LOCAL REAL SHELL / UNSIGNED / NOT RELEASE`。

第三阶段新增私有 IPC v5、有序 `pi.tool.progress`、跨 chunk 脱敏、请求级取消和受控日志 Artifact，
见 [公共测试说明](../TESTING.md)。PBASH-004A 已完成直接写 changed-path
manifest、diff/conflict、明确的无通用 Undo 投影，以及 `isolated_change_set` 不降级路由；证据见
[公共测试说明](../TESTING.md)。PBASH-004B 已完成 APFS CoW working copy、
持久化 `WorkspaceChangeSet`、review/apply/discard/undo、冲突与崩溃恢复，见
[公共测试说明](../TESTING.md)。PBASH-005 已把实际 Remote 命令来源接入冻结
执行上下文，并完成控制器绑定审批、operation digest 幂等、崩溃后 `outcome_unknown` 与加密对账事件，见
[公共测试说明](../TESTING.md)。PBASH-006 已完成 `none/core/all`、
`include/exclude/set`、冻结摘要、Secret canary 与受控 HTTP(S) egress proxy，证据见
[公共测试说明](../TESTING.md)。PBASH-007 已完成 9 类本机确定性 A/B、停止、
渐进启用、运行时 UI 和回滚演练；旧路径因 `/dev/null` 边界在补丁前验证失败，Brokered 路径 9/9
通过且无未解释回归，见 [公共测试说明](../TESTING.md)。PBASH-008 已发布
[公共测试说明](../TESTING.md)，把当前 macOS arm64 限定为
unsigned Local Alpha，并验证 Linux/Windows、缺失 backend、probe 失败及严格签名门禁均 fail-closed；
见 [公共测试说明](../TESTING.md)。真实模型 A/B 进一步以固定
`deepseek-v4-flash` 完成 3 次配对：Brokered 严格 26/27、功能 27/27，legacy 严格 22/27，详见
[公共测试说明](../TESTING.md)。PBASH 本机文档任务至此收口。
真机/生产 Remote、Developer ID/公证包、macOS x64、Linux/WSL2/Windows backend 和 deprecated 后端
替代评估仍是外部发布门禁。
