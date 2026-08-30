# Pi `0.84.4` 普通依赖升级证据（2026-08-30）

- 日期：2026-08-30（Asia/Shanghai）
- 状态：`PIRU-001 LOCAL PASS / ORDINARY DEPENDENCY UPGRADE / NOT REMOTE UPDATE / NOT RELEASE`
- 升级范围：`@earendil-works/pi-* 0.84.3 → 0.84.4`
- 方案：[25-pi-runtime-remote-update-plan.md](../25-pi-runtime-remote-update-plan.md)
- 上游基线：`v0.84.3` = `4e58f324fae8ebfa98a3d45181fb248072a2afac`
- 上游目标：`v0.84.4` = `b79e4cc834970cca69daebffab7df1da7d1e52c4`

## 1. 本切片完成内容

1. 根工作区、Desktop 测试构建和 `packages/pi-host` 的直接 Pi 依赖全部精确锁定为 `0.84.4`，
   没有使用 `^`、`~` 或 tag 漂移。
2. `package-lock.json` 已由 npm 重新解析；9 个 Pi lock 节点（含嵌套的 `agent-core`、`ai`、
   `client`、`protocol`、`telemetry` 和 `tui`）全部为 `0.84.4`。
3. App Service 保存的 `piPackageVersion`、Desktop/Pi Host fixture 和 M1 Golden 输出已同步到
   `0.84.4`，当前架构/合同文档也已更新。
4. Pi Host 新增运行时版本断言，直接读取 coding-agent 导出的 `VERSION`，证明实际加载的模块是
   `0.84.4`，不是只修改 manifest 或 lockfile。
5. Pi Host 新增旧 Session JSONL 无尾换行回归：模拟升级前的持久化 Session，删除最后一个换行，
   用 `0.84.4` 重建 `ProductSessionRegistry`；历史 user/assistant 消息可恢复，文件尾换行会自动修复。

本切片没有实现外部 Runtime Loader、签名 Bundle、远程下载、灰度、激活或回滚；这些仍属于
PIRU-002 及后续阶段。

## 2. 依赖、构建与架构门禁

| 门禁 | 结果 |
| --- | --- |
| 实际模块加载 | `pi-coding-agent=0.84.4`、`pi-ai=0.84.4` |
| npm lock 审计 | 9 个 Pi 节点全部为 `0.84.4`，未发现混合 Pi `0.84.3` |
| V2 boundary | 317 个源码文件通过 |
| Release graph | 217 个生产文件；16 个 Pi import 仍全部隔离在 `packages/pi-host`；45 条 workspace edge |
| 全工作区 TypeScript | 所有 workspace 通过 |
| 生产 Pi Host Bundle | Vite SSR 构建通过，生成 `pi-host.js`，284,490 bytes |
| 定向 Biome 代码检查 | 8 个升级相关代码/manifest 文件通过（关闭 checkout 换行格式检查） |
| `git diff --check` | 通过 |
| 生产依赖审计 | high/critical 门禁通过；存在 10 个 Expo/xcode/uuid 链路的 moderate 基线问题 |

## 3. 行为验证

| 测试面 | 结果 |
| --- | --- |
| `@openerx/pi-host` 全包 | 13 files / 45 tests PASS |
| Pi 运行时精确版本 | `VERSION === "0.84.4"` PASS |
| Session 无尾换行恢复 | 历史消息恢复 + 自动补换行 PASS |
| Session/Branch/Compaction 现有回归 | 恢复、损坏 registry 重建、compaction context、分支隔离 PASS |
| AgentSession/Tool 路径 | prompt、stream、stop、tool continuation、产品 File/Bash/Skill/Memory 工具回归 PASS |
| M1 Pi Golden | 1 file / 6 tests PASS |
| App Service（排除独立 Office 性能用例） | 11 files / 65 tests PASS，1 个 Office 用例显式跳过 |
| Desktop 历史 Run/安全 reasoning 定向回归 | 1 test PASS |
| Storage 旧 Run 元数据兼容 | 8 files / 62 tests PASS；保留的 `0.84.3` Run fixture 可读 |
| Tool SDK Broker 旧 Run 元数据兼容 | 1 file / 13 tests PASS；保留的 `0.84.3` fixture 可投影 |
| V2 Golden 总体 | 13 files PASS；75 tests PASS，1 个 Windows symlink 权限用例失败 |

真实 DeepSeek 门禁也已执行并通过：

- `platform/deepseek-v4-flash`：普通流式请求成功，delta 可重建，终态位于 delta 之后；
- Tool Call：首轮返回工具调用，Tool Result continuation 成功，协议内容未泄漏；
- `platform/deepseek-v4-flash-vision-exp`：图片输入、流式重建和 provider usage 成功。

这些真实接口检查证明当前 Model Gateway 路径可用；它们不是签名安装包或未来远程 Runtime Bundle
的发布证据。

## 4. 全量门禁例外

本次升级相关门禁已通过，但当前 Windows 工作区的完整 `test:v2/check:v2` 不能记为绿色，原因如下：

1. Desktop 全包为 17 files / 126 tests PASS，`chat-ui.test.tsx` 另有 3 个失败，分别位于思考强度
   下拉框、Skill 下拉框和本地 Web Search 状态 UI；它们不经过 Pi 模块或本次升级路径。
2. App Service 的 Office DOCX/XLSX/PPTX/PDF 自然语言工作流在当前机器耗时约 17 秒，超过用例自身
   15 秒上限，随后清理仍被占用的临时目录时出现 `EPERM`。排除该独立用例后其余 65 个测试通过。
3. V2 Golden 的 `FILE-02` 需要创建 Windows 符号链接；当前进程没有对应权限，在测试准备阶段以
   `EPERM` 失败。其余 75 个 Golden 测试通过。
4. Biome formatter 会把当前 Windows checkout 的 CRLF 报为格式差异；升级相关文件的 lint/import
   检查和 `git diff --check` 已通过，没有为此批量改写用户工作区换行。
5. Tool SDK 全包另有 7 个 Windows 平台失败，集中在仅有 macOS sandbox 的 Shell 路径、POSIX
   PATH/HOME 断言、Git 子进程和 Windows symlink 权限；与 Run 版本兼容有关的 Broker 定向用例
   13/13 通过。

因此结论限定为：`0.84.4` 已完成普通源码依赖升级和本地兼容验证，可以作为后续 Runtime Loader
工作的内置基线；尚不能据此声明完整发布门禁、签名安装态或远程升级链路完成。

## 5. 后续入口

下一阶段按方案进入 PIRU-002：先验证 ASAR 所有的稳定 Loader 能在 Windows x64、macOS arm64/x64
从不可变目录加载已验签的外部 ESM Bundle，并在 import、Host Contract 或启动握手失败时回到内置
`0.84.4`。在该 SPIKE 通过之前，不允许客户端下载 npm 包、修改 ASAR 或把当前依赖切换包装成远程
升级能力。
