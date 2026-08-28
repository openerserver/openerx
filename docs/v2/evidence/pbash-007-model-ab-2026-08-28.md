# PBASH-007 真实模型 Golden A/B 证据

- 日期：2026-08-28（Asia/Shanghai）
- 分支：`codex/pbash-001-20260828`
- 状态：`LOCAL LIVE MODEL A/B COMPLETE / NOT RELEASE EVIDENCE`
- 模型：`deepseek-v4-flash`
- 推理级别：`off`
- 原始记录：[pbash-007-model-ab-2026-08-28.json](pbash-007-model-ab-2026-08-28.json)

## 1. 评测边界

`npm run eval:pbash:model -- --repetitions=3` 对同一固定快照、同一提示、同一模型和默认断网策略做
3 次配对运行。每次任务创建独立的活动工作区、Pi 私有 Session 目录和 Agent 目录，避免把评测仓库本身
误当成生产工作区。A 组只暴露旧 `openerx_shell`/`openerx_shell_process`；B 组只暴露产品自有
Brokered `bash`。两组都通过真实 Pi Agent Loop、Platform Model Provider 和 Model Gateway 调用模型。

固定任务为仓库探索、组合搜索、构建、测试、lint、预期失败诊断、补丁前 Git 验证、250 行输出和
停止，共 9 类、每组 27 次运行。JSON 保存每次模型轮次、工具参数、工具结果摘要、错误、Token、耗时
和路径暴露观察值；主机目录使用逻辑占位符脱敏。

## 2. 结果

| 指标 | 旧 argv Shell | Brokered Bash | 变化 |
| --- | ---: | ---: | ---: |
| 严格完成 | 22/27（81.5%） | 26/27（96.3%） | +14.8 个百分点 |
| 模型轮次 | 56 | 58 | +2 |
| 工具调用 | 33 | 32 | -1 |
| 未预期工具错误 | 3 | 0 | -3 |
| 总 Token | 61,473 | 53,298 | -13.3% |
| 总耗时 | 57,467 ms | 55,128 ms | -4.1% |
| 活动工作区绝对路径暴露 | 3 | 0 | -3 |
| Pi 私有目录暴露 | 0 | 0 | 持平 |

逐任务严格结果：构建、搜索、lint、长输出、探索和停止均为 3/3 对齐；Brokered 的失败诊断与
补丁前验证均为 3/3，旧路径分别为 1/3 和 0/3。Brokered 测试任务为 2/3，唯一一次严格失败实际已
成功执行 `node tests/math.test.js` 并得到 `PBASH_TEST_OK`，但模型把标记写进说明句而不是按提示独占
最后一行。因此它是响应格式遵循失败，不是测试执行失败；功能工具结果仍为 27/27。

旧路径补丁前验证 3 次都因旧 Seatbelt profile 无法打开 `/dev/null` 而以 exit 128 失败。旧路径的
失败诊断还把活动工作区绝对路径带入模型可见 stderr；Brokered 结果中的工作区路径由平台 Runner
投影和脱敏，27 次均未观察到活动根或 Pi 私有目录绝对路径。

## 3. Pi 私有 cwd 修正

Pi 0.84.3 会在自定义系统提示末尾追加真实 `Current working directory`。生产 Pi Host 的该目录是
Session 持久化私有目录，不是授权工具工作区；修正前模型曾尝试 `cd` 到该目录并被沙箱正确拒绝。

本检查点增加两层约束：

1. Platform Model Provider 在生成请求摘要和发送 Gateway 请求前，对 Pi Session/Agent 私有路径做
   定点上下文替换；原始路径不再进入模型请求。
2. Brokered `bash` 的模型说明明确每次命令从活动授权工作区根开始，并禁止使用 Pi 的 cwd 元数据。

修正后的 3 轮完整 A/B 中，Brokered 私有 cwd 误用、路径暴露和由此产生的无效工具调用均为 0。

## 4. 可复现命令与限制

```bash
npm run eval:pbash:model -- --repetitions=3 \
  --output=docs/v2/evidence/pbash-007-model-ab-2026-08-28.json
```

- 评测依赖本地 `.env` 中可用的 DeepSeek 凭证；证据不保存凭证。
- Provider 返回真实 Token 计数，但当前评测未绑定价格快照，因此不报告货币成本。
- 耗时只代表当前主机和本次 Provider 状态，不外推为 SLA。
- 本结果完成 PBASH-007 的本地真实模型 A/B 门禁，但不替代签名/公证包、macOS x64、Linux/WSL2、
  Windows、真实 Remote 和发布级隐私导出的外部证据。

## 5. 最终验证

- `npm run typecheck --workspace @openerx/pi-host`：通过。
- Pi Host 定向测试：2 个文件、15 个测试通过。
- `npm run check:v2`：通过；边界检查 266 个源文件，Release Graph 189 个 production 文件，Biome
  364 个文件，85 个测试文件共 459 个测试全部通过；iOS/Android export、Desktop production package、
  Fuse 与 release artifact 验证通过。
- 原生签名检查继续正确报告 macOS arm64/x64 与 Windows x64 为 `LOCAL UNSIGNED`；本证据没有把本地
  A/B 结果升级为发布完成声明。
