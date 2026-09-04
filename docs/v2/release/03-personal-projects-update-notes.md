# Personal Projects 更新说明与发布清单

> 本地实现状态：`READY FOR EXTERNAL PERSONAL BETA`
>
> Stable 发布状态：`BLOCKED PENDING SIGNED CROSS-DEVICE AND REMOTE EVIDENCE`

## 用户可见更新

- 侧栏新增“项目”。用户可先创建无目录项目，再按需要绑定一个或多个本机目录。
- 每个项目可保存名称、说明和置顶状态；项目可归档、恢复，不会删除磁盘文件。
- 第一个目录自动成为主目录；后续目录作为附加目录，可单独选择只读或可读写，并可显式切换主目录。
- 在项目中开始的对话会继承项目说明和当前设备已连接目录；普通对话不会自动取得项目目录权限。
- 既有空闲对话可移入或移出项目，历史消息不重写；运行中的对话必须先到达终态。
- 项目元数据和逻辑目录占位可跨设备同步。绝对路径、目录句柄和 Workspace Grant 不同步；新设备需要由用户重新选择本机目录。
- 手机 Remote 可选择项目开始新任务并查看目录“已连接/需重连”状态，但不能选择目录、提交路径、改变读写范围或创建权限。

## 恢复与安全行为

- 系统目录选择已经完成、但应用在 Binding 提交前中断时，同一操作可安全重放，不会生成重复授权或双主目录。
- 中间态项目 Grant 不会成为普通对话的默认工作区。
- App Service 中断会把未完成 Generation 恢复为明确失败终态；项目配置、目录连接和历史消息保持不变。
- “在此设备断开”只撤销当前设备权限；“移出项目”同步逻辑墓碑，并在各设备撤销对应本地 Binding/Grant。

## Personal Beta 验收

在目标用户 Beta 前必须完成：

1. Windows x64 与 macOS arm64/x64 签名安装包的目录选择、读写、断开、重连和升级保持。
2. 两台物理桌面设备的项目同步、主目录冲突、目录墓碑、对话移动和账户隔离恢复。
3. iOS 与 Android 真机对 Windows/macOS 主机的项目列表、项目任务、离线拒绝和只读目录状态矩阵。
4. 诊断包、同步 payload、Remote 密文解密后业务 payload 均通过绝对路径和 Grant canary 检查。

## 发布与回滚

- 发布 Gate 读取 `tests/v2/golden/personal-projects-gate-status.json`；外部证据、用户批准和总 Release Gate 未通过前，`releaseClaim` 与 `publishAllowed` 必须保持 `false`。
- 升级/回滚必须保留 Project、ProjectDirectory、Conversation.projectId 和设备本地 Binding/Grant；若旧版本无法理解新增 Schema，必须先给出受监督恢复路径。
- 若出现跨账户项目可见、普通对话继承项目 Grant、Remote 泄露路径、目录墓碑未撤权或双主目录，立即停止推广并按主发布 Runbook 回滚。
