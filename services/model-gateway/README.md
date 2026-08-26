# Model Gateway

平台统一模型目录和模型请求网关边界。V2 客户端不提供 BYOK、自定义 Provider 或本地模型入口。

M2 Account Alpha 冻结版本化模型目录、能力预检、显式降级批准和 UsageRecord 写入。上游执行器
由部署环境注入；仓库中的确定性执行器只存在于测试文件。

## DeepSeek 官方 API

生产服务端可通过 `createDeepSeekModelExecutorFromEnv()` 注入 DeepSeek 执行器。密钥仅从服务端
`DEEPSEEK_API_KEY` 环境变量读取，请放在 Git 忽略的根目录 `.env` 中；桌面客户端、日志和诊断包
都不得保存或输出该密钥。执行器固定访问官方 `https://api.deepseek.com/chat/completions`。

本地真实连通性与服务端结算测试：

```bash
npm run test:deepseek -- "只回答：连接成功"
npm run test:deepseek:tools
```

该命令必须同时得到 `providerReported=true` 的 UsageRecord 和 `status=settled` 的
`finalBilling`，才算通过。默认使用 `deepseek-v4-flash` 且关闭 thinking。请求使用 DeepSeek
V4 官方单次最大输出 384,000 Token；实际输出仍受供应商模型上限约束。可用环境变量见根目录
`.env.example`。

服务端价格快照采用 2026-08-26 官方人民币费率：Flash 缓存命中/未命中输入/输出分别为
¥0.02/¥1/¥2 每百万 Token，Pro 为 ¥0.025/¥3/¥6。`prompt_cache_miss_tokens` 和
`prompt_cache_hit_tokens` 分开写入 UsageRecord，Pro 的 2.5 micro-minor 精度保留到单笔最终
人民币分位向上取整。客户端不生成 Token 估算、费率、报价或 Charge。

启动包含本地 Platform Gateway 的 V2 桌面开发环境：

```bash
npm run dev:deepseek
```

开发 Gateway 只监听 `127.0.0.1:4099`，默认邮箱验证码为 `123456`。本地账户需在 Billing
设置中接受服务端条款；首次模型授权会得到一笔幂等的本地开发额度，最终 Charge 仍由服务端
形成。打包后的桌面应用仍拒绝明文 HTTP Platform 地址。

当前 DeepSeek Chat Completions 请求使用官方 SSE，并请求带最终 Usage 的流终态。Platform Alpha
以账户鉴权的 `text/event-stream` 转发统一 `delta/completed/failed` 事件，Pi Provider 再把增量
投影为产品 `message.delta`；不支持原生流的其他执行器仍通过同一协议兼容。Pi 的工具定义通过
官方 `tools` 字段发送，DeepSeek `tool_calls` 作为结构化终态返回给 Pi，工具结果使用 `tool`
消息续跑。一次用户回复内的每个模型轮次按完整上下文派生独立幂等键，避免首轮工具调用被缓存
后重复回放。真实长请求 Stop、供应商失败与账单对账演练仍是 M8 外部门禁，不以单次流式烟测
冒充完成。
