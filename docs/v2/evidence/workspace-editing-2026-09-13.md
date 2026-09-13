# openerx 文件编辑与撤销验收

日期：2026-09-13（Asia/Shanghai）。状态：LOCAL VERIFIED。

本次补齐桌面工作区的上下文补丁、多文件操作、差异查看与直接撤销。保留原来的精确替换协议，模型不需要在新协议中抄写文件 SHA256 或指令摘要。

## 使用方式

在已授权读写的工作区中，模型先读取已有文件，并加载源路径、目标路径适用的 AGENTS.md，再调用 `openerx_workspace_apply_patch`。新参数为 `{ workspaceGrantId, patch }`：

```diff
*** Begin Patch
*** Update File: src/app.ts
@@
-export const value = 1;
+export const value = 2;
*** Add File: docs/notes.md
+# 更新说明
*** Update File: old-name.txt
*** Move to: docs/new-name.txt
*** Delete File: obsolete.txt
*** End Patch
```

支持多个 `@@` 修改块、`@@ 函数或其他唯一行` 定位、`*** End of File` 定位文件结尾。上下文行以空格开头，增删行以 `+` / `-` 开头。保留原文件的 LF / CRLF、末尾换行状态和已有文件权限；新增目录按需创建。

新协议返回 `data.changeSet.id`，对应整组修改。模型可用 `openerx_workspace_change_set_review` 查看，用 `openerx_workspace_change_set_undo` 撤销。原来的 `{ relativePath, expectedSha256, replacements, instructionDigests }` 参数和单文件 diff / undo 工具继续适用于旧修改记录。

桌面回复下方直接展示“文件修改”卡片，无需展开“用时”。用户可以查看每组差异；本轮结束后点“撤销这组修改”，多组修改时也可点“撤销本轮修改”。操作直接进入本机服务，不需要模型再生成一段反向补丁。同一文件连续修改的整轮撤销会恢复到该轮开始前的内容。

## 一致性与恢复

- 宿主在每次读取时记录该轮文件版本；写入前核对当前内容、工作区权限和已加载的指令。过期读取、重复目标、模糊上下文、路径越界、符号链接和 `.git` 写入会被拒绝。
- 一组补丁全部预检、生成真实的上下文 diff 并保存前后内容后才写入。每个文件通过临时文件与 rename 替换；写入过程中失败时只补偿本次已经写入、且内容仍匹配的文件。
- 撤销同样先检查全部目标。后续人工修改会阻止本次撤销，保留当前内容，不强制覆盖。
- 数据库迁移 v35 增加 `workspace_undo_journal`。整轮撤销先记录合并后的恢复计划，再改文件，最后在数据库事务中更新修改状态并移除日志。进程中断后可继续这个计划，已经恢复的文件不会重复写入。
- 单个文件写入具有原子替换能力；多文件操作采用预检、补偿和恢复日志，不承诺操作系统级跨文件原子事务，也不提供断电时的 fsync 持久性保证。

## 范围

上下文补丁最多 100 个文件操作，补丁和单文件各最多 5 MB，一组前后内容合计最多 20 MB。每文件上下文匹配有 200 万次行比较上限，diff 计算有 1 秒上限；复杂修改应拆分，避免阻塞宿主。

目前编辑普通 UTF-8 文本；二进制、符号链接、覆盖式重命名、同组重复使用同一路径、仅改变大小写的重命名会被拒绝。混合换行文件可以使用旧精确替换协议。新语法采用 `apply_patch` 的文件操作结构，未宣称完全复刻其解析和模糊匹配行为。

撤销范围是已记录的工作区修改，包括历史精确替换和可恢复的已应用变更集。直接 Shell 命令绕过记录的写入、数据库或其他外部副作用不在本次撤销范围内。恢复文件内容不会删除空目录，也不会删除已保存的历史成果版本。

## 验证

- tool-sdk 全套：136 项通过，2 项联网 Web Search 测试按默认配置跳过。编辑相关 21 项包含多文件增删改与重命名、权限保留、过期读取、指令变化、越界与符号链接、写入中途失败补偿、外部并发修改保护、连续编辑整轮撤销、数据库重新打开后的部分/完整撤销恢复、重命名中断恢复以及复杂度限制。
- storage 全套 82 项、contracts 全套 81 项、app-service 全套 93 项、pi-host 全套 63 项、desktop 全套 302 项通过。共 757 项通过、2 项跳过。
- 类型检查覆盖全部 workspaces；架构边界检查通过。Biome 检查通过，保留仓库已有警告。
- 使用 `npm run dev:desktop`、独立临时 profile 和临时工作区运行 Electron。确定性 Pi 模型依次发出真实工具调用，经 IPC / App Service / SQLite 修改真实文件；UI 实际点击查看差异、冲突拒绝、单组撤销，并重启后台服务后执行整轮撤销。页面无未处理错误。
- 此证据属于 macOS 本地开发版；不包括真实在线模型适配率、Windows 运行或安装包发布验证。没有重新打包 Electron。

可复跑的桌面验收入口：`apps/desktop/scripts/e2e-workspace-editing.mjs`。先构建 `apps/desktop/vite.pi-host-test.config.mts`，再从仓库根目录运行：

```sh
OPENERX_E2E=1 OPENERX_E2E_PROFILE_DIR=/tmp/openerx-editing-dev-profile npm run dev:desktop -- -- --inspect-electron -- --remote-debugging-port=9238
```

开发版就绪后，用另一个终端执行：

```sh
node apps/desktop/scripts/e2e-workspace-editing.mjs /tmp/openerx-editing-evidence
```

该脚本只连接已开启 E2E 标志的进程，临时替换模型目录与目录选择框，不调用在线模型。验证结束保持开发版运行；重新启动开发版可恢复真实模型目录。

## 本次源码恢复点

基线 commit：`fcd2d7d26a4626bb088b94db878fac06da071db7`。

源码检查点目录：`/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/2026-09-13-workspace-editing-100739`。其中 `before.patch`、`source-before.tar.gz` 和 `manifest.json` 保存开始时已经存在的 8 个未提交文件；本次保持它们的内容不变。检查点没有复制应用、Electron、node_modules 或用户 profile。

桌面截图和机器报告位于该目录的 `evidence/`：`01-edits.png`、`02-conflict.png`、`03-undone.png`、`report.json`。运行只升级了临时测试数据库，未启动真实用户 profile 的数据库迁移。本次验收未打包、未发布。
