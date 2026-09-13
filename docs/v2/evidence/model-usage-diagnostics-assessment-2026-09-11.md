# openerx 模型使用问题与效率诊断核查

本文件保留修复前的核查快照。错误分类与 BYOK 用量的后续实现及验证见 [2026-09-11 交付记录](./model-errors-and-byok-usage-2026-09-11.md)。

- 核查日期：2026-09-11（Asia/Shanghai）。
- 本机运行数据采样：2026-09-11 11:45:29 +08:00。
- 检查分支：`codex/desktop-connection-20260910`，包含核查前已有的未提交修改。
- 范围：当前 Desktop 源码、Pi Host、模型网关、用量存储、诊断、已有评测，以及本机两个 profile 的只读聚合数据。
- 证据级别：当前源码核查、本地定向测试、历史真实模型评测、本机历史运行样本。没有在本轮重新调用付费模型或验证发布包。

## 结论

目前能发现并修正一部分模型使用问题，已有真实评测证明过效率收益。但尚未形成覆盖日常调用的“发现异常、定位原因、修正、验证收益”完整流程。

已具备运行时间线、部分错误码、模型重试与上下文压缩事件、平台模型用量，以及 Shell 和记忆专项评测。主要缺口是错误原因传递、BYOK 用量采集、每次模型请求的性能指标，以及日常任务质量的回归评测。

“运行完成”只表明运行结束，并不能单独证明任务正确完成。优化应同时看任务正确率、完成耗时和每个成功任务的 Token 消耗，不能仅以调用成功率或总 Token 下降判断。

## 当前能力与缺口

| 能力 | 当前证据 | 判断 |
| --- | --- | --- |
| 定位配置和运行错误 | 保存 `ACCESS_TOKEN_INVALID`、`PI_MODEL_NOT_CONFIGURED`、`PI_BRANCH_ALREADY_ACTIVE` 等错误码 | 能发现部分明确问题；应区分认证、配置、运行调度和模型错误 |
| 查看工具、模型轮次、重试和压缩 | Pi Host 发送活动事件，App Service 保存到 Run 时间线 | 有逐次排查基础，尚无统一的跨运行模型效率分析 |
| 平台模型 Token 记录 | 网关保存输入、缓存、输出、推理 Token、实际模型及回退原因；缺失值允许为 `null` | 有用量基础；不能把未知用量当成零 |
| BYOK Token 记录 | BYOK 直接使用 Pi provider；终态用量集合仅由平台 provider 的回调填充 | 当前缺失，已被本机样本证实 |
| 模型性能诊断 | 诊断性能字段只有 Desktop 启动、App Service 就绪和进程内存 | 尚缺逐请求首个输出时间、生成耗时、重试等待和 Token 速率等模型指标 |
| 模型质量评测 | 已有 Shell A/B、记忆 Golden 与独立 holdout | 专项可验证，不能外推到全部日常任务 |

## 已确认的问题

### P0：具体模型错误在 Host 出口被合并

`packages/pi-host/src/platform-provider.ts:395` 附近把调用异常写入 assistant 的 `errorMessage`。但 `packages/pi-host/src/host.ts:966` 对 `stopReason === "error"` 统一发出 `PI_PROVIDER_FAILURE`，没有把安全分类后的具体原因一并传出。`apps/desktop/src/renderer/App.tsx:530` 又把它统一解释为模型没有响应、检查网络后重试。

因此，认证失败、限流、服务端异常、响应格式错误等原因可能无法在产品错误提示中区分。重试活动虽然保存次数和等待时间，也没有完整保留触发原因。这里确认的是信息丢失，不能据此断言底层 Pi 没有重试策略。

建议：建立共同错误结构，保留错误类别、HTTP 状态、可重试性、请求标识和脱敏摘要；区分认证/配置错误、限流、超时、服务端错误、上下文限制、响应协议错误、工具错误及用户取消。让提示与恢复动作依据具体类别生成。

验收：用受控失败覆盖上述类别，验证从 provider 到 Host、存储、界面和诊断导出的分类一致；错误字段不包含凭证或完整请求正文。

### P0：BYOK 没有接入统一用量记录

平台路径通过 `packages/pi-host/src/host.ts:606` 的 `onUsage` 填充 `authoritativeUsageRecords`。BYOK 路径（同文件 `629` 行起）直接使用 Pi 的 OpenAI-compatible provider，没有对应的用量采集。终态仅发送该集合，App Service 在缺失时使用空数组（`packages/app-service/src/chat-app-service.ts:966`）。

本机两个 profile 共 19 次 BYOK Run，13 次完成，统一用量数组全部为空。这不代表没有消耗 Token，也不能由此推算实际消耗；部分失败还可能发生在调用模型之前。

建议：采集 BYOK 每次 assistant 响应的 provider 用量，包括可获得的失败/取消用量，并关联 Run 和模型请求。将本地 BYOK 用量与平台计费账本明确区分；provider 未提供的字段保留未知状态。后台记忆调用也应纳入覆盖范围。

验收：成功、工具多轮、失败、取消和缺失用量场景均可正确记录，重复事件不重复累计；BYOK 不生成平台消费账单。

### P1：应用诊断尚不能分析模型效率

`packages/observability/src/service.ts:76` 的性能指标只有 `desktop_interactive`、`app_service_ready`、`idle_rss`。`apps/desktop/src/main/index.ts:1561` 订阅服务事件时，写入通用诊断的是 `service.status`；模型活动继续传给界面，没有接入模型指标聚合。

本机当前诊断文件有 185 条事件，代码全部属于 Desktop 启动、服务启动/就绪/重启/不可用、Renderer 就绪。这与源码边界一致。

建议：在实际模型请求边界增加可关联到 Run 的记录，包含调用模式、选择/实际模型、开始/首个输出/结束时间、终态、尝试次数和用量来源。区分网络与模型等待、工具执行、重试等待和用户审批等待；再按模型与任务类型聚合。

注意：已有 Run 时间戳可以帮助分析总耗时，但不能直接充当纯模型生成时间。当前诊断脱敏规则会匹配包含 `token` 的字段；新增用量指标应设计明确的数值字段白名单，并验证现有脱敏边界，不能直接把原始请求塞入诊断日志。

验收：可以解释一条慢运行的主要耗时来源，并展示样本数、缺失指标比例、成功率和耗时分位数。稀疏历史样本不得当作整体模型 SLA。

### P1：专项评测需要扩展到日常任务和修正验证

根 `package.json` 已提供 `eval:pbash:model` 和 `eval:memory:model`，但 `check:v2` 不包含真实模型评测，当前 `.github` 中也未发现这两个命令的调用。因此本地单元测试通过不能证明实际模型质量没有退化。

建议：把复现过的失败转为固定任务案例，覆盖工具选错、参数无效、反复搜索、输出不符合要求、上下文过大及任务未完成却宣告完成。修正前后固定模型、任务与评分口径，分别比较正确率、完成时间、Token 和无效工具调用；采用独立样本及重复运行验证稳定性。

## 本机运行数据

只查询 SQLite 聚合字段，没有读取或导出对话正文。profile 使用逻辑名称；未导出账号标识。数据库包含历史运行，不能证明每条记录来自当前源码版本，也不是生产总体故障率。

| 项目 | 账号 profile | 本地 profile |
| --- | ---: | ---: |
| Run 数 | 12 | 18 |
| 完成 | 8 | 12 |
| 失败 | 4 | 4 |
| 取消 | 0 | 2 |
| BYOK Run | 1 | 18 |
| BYOK 完成 Run | 1 | 12 |
| BYOK 有统一用量记录的 Run | 0 | 0 |

- 账号 profile 的 Run 样本覆盖 2026-08-27 至 2026-09-08，4 次失败均为 `ACCESS_TOKEN_INVALID`。
- 本地 profile 的 Run 样本覆盖 2026-09-09 至 2026-09-11，3 次失败为 `PI_BRANCH_ALREADY_ACTIVE`，1 次为 `TOOL_HOST_INTERRUPTED`。
- 账号 profile 的消息错误中另有 1 条 `PI_PROVIDER_FAILURE`；消息与 Run 是不同统计口径，不能相加。
- 2026-09-11 当天本地 profile 采样到 4 次 Run：3 次完成、1 次取消，全部没有统一用量记录。

上述认证、分支占用和中断样本应优先按调用链排查，不能归因为模型本身能力不足。现有记录不足以给出模型质量总体分数或新的提效百分比。

## 已有提效证据

2026-08-28 的 Shell 真实模型 A/B 为 9 类固定任务、每组 27 次运行。同一任务快照和模型下：

| 指标 | 旧 Shell | Brokered Bash |
| --- | ---: | ---: |
| 严格完成 | 22/27（81.5%） | 26/27（96.3%） |
| 未预期工具错误 | 3 | 0 |
| 总 Token | 61,473 | 53,298（减少 13.3%） |
| 总耗时 | 57,467 ms | 55,128 ms（减少 4.1%） |

本轮核对了 [A/B 原始 JSON](pbash-007-model-ab-2026-08-28.json) 的汇总值与 [评测说明](pbash-007-model-ab-2026-08-28.md)。这是历史特定测试集的收益，不代表当前所有任务均有相同比例提升。

2026-08-30 的记忆评测也保留了真实失败及修正证据：原始 Golden 门禁失败，修正后 Golden 与独立 holdout 均通过。参见 [原始结果](memory-model-golden-2026-08-30.json)、[修正结果](memory-model-golden-fixed-2026-08-30.json)、[独立 holdout](memory-model-holdout-fixed-2026-08-30.json)。

## 本轮验证与交付范围

运行以下定向测试，8 个文件、56 项测试全部通过：

```sh
./node_modules/.bin/vitest run \
  packages/observability/tests/observability.test.ts \
  packages/pi-host/tests/platform-provider.test.ts \
  packages/pi-host/tests/agent-session.test.ts \
  packages/pi-host/tests/byok-fetch.test.ts \
  services/model-gateway/tests/model-gateway-service.test.ts \
  services/model-gateway/tests/deepseek-model-executor.test.ts \
  services/token-usage-store/tests/usage-store.test.ts \
  packages/app-service/tests/chat-app-service.test.ts
```

这些测试验证已有实现与受控场景，不替代真实供应商调用或任务正确性评测。本机 Node 为 v24.2.0，低于仓库声明的 >=24.3.0；本次定向测试通过不能当作完整支持环境或发布门禁验证。

本轮仅新增这份核查报告，没有修改模型调用逻辑；检查前已有的 7 个已跟踪修改文件保持原状。优先实施顺序为：错误原因传递和 BYOK 用量采集 → 逐请求性能诊断 → 将已复现问题纳入评测并验证修正收益。
