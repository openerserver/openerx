# OpenERX V2 轻量本地 Web Search 实施方案

- 状态：`LWS-001..004 IMPLEMENTED / LWS-006 PROBE+GATE IMPLEMENTED / HISTORY 1 OF 7 / NOT RELEASE READY`
- 修订日期：2026-08-29（Asia/Shanghai）
- 范围：V2 Desktop-first Web Search；不包含 `v1-backup`
- 产品决定：用本机进程内的轻量 HTTP Search Gateway 替换云端第一方 Web Search
- 当前实现：百度 JSON Adapter + Bing 服务端 HTML Adapter；默认仍为百度且禁止自动 fallback
- 明确排除：浏览器自动化、Chromium sidecar、默认捆绑 SearXNG、通用 Shell 抓取
- 依赖：[ADR-V2-012 Capability Broker](adr/012-capability-broker-and-tool-projection.md)、
  [公共架构说明](../ARCHITECTURE.md)、
  [公共架构说明](../ARCHITECTURE.md)、
  [PBASH 实施计划](20-pbash-implementation-plan.md)
- 实现证据：[公共测试说明](../TESTING.md)
- Bing 证据：[公共测试说明](../TESTING.md)
- 设置与退避证据：[公共测试说明](../TESTING.md)
- 连续探测门禁证据：[公共测试说明](../TESTING.md)

## 1. 结论

V2 应实现一个很小的本机 `LocalWebSearchGateway`：

1. 模型继续只调用 `openerx_web_search(query, recencyDays?, domains?)`；
2. App Service 在当前 Node.js 进程中直接向已配置搜索引擎发送一次受控 HTTPS 请求；
3. Provider Adapter 解析百度 JSON 或 Bing 服务端 HTML；
4. 结果在本机规范化、过滤、去重为 `Source[]`，交回同一个 Pi Agent Loop；
5. 搜索阶段不打开浏览器、不执行 JavaScript、不启动额外进程，也不打开结果网页；
6. 默认运行链不再调用 OpenERX 云端 `/v1/tools/web-search`。

这仍然不是离线搜索，也不是在本机建设爬虫或搜索索引。查询会从用户设备直接发给百度、Bing 或
用户配置的其他 Provider；“本地”指搜索工具的策略、请求、解析、缓存和审计都在本机完成。

## 2. 为什么选择进程内 HTTP Adapter

| 方案 | 每次查询开销 | 安装/运行依赖 | 维护风险 | V2 定位 |
| --- | ---: | --- | --- | --- |
| 浏览器 Computer-Use | 高；启动/绑定/观察/截图 | 浏览器、AX/自动化权限 | 页面交互和状态复杂 | 不采用 |
| 内嵌 HTTP Adapter | 一次 HTTPS + JSON/HTML 解析 | 当前 App Service 进程 | Provider 格式可能变化 | **MVP 默认** |
| 本机 SearXNG | 查询较轻，但常驻服务较重 | Python 或约 143–265 MB 容器镜像、Docker/Podman | 版本和运维责任 | 用户已有实例时可选 |
| 搜索引擎正式 API | 轻且结构稳定 | API Key、费用和第三方云服务 | 供应商/计费依赖 | 可选 Provider |
| 通用 CLI/Shell | 进程和解析不稳定 | 可执行文件、PATH、沙箱 | 权限边界过宽 | 不采用 |

完整 SearXNG 很适合服务器或高级用户，但不适合作为每个 Desktop 安装包的默认依赖。本方案只借鉴
其“每个搜索引擎一个小 Adapter”的边界，不复制其 AGPL 代码。

## 3. 2026-08-29 本机探测证据

本次只做只读、无登录的中性查询 `OpenERX` 探测，没有修改实现。结果仅证明当日、当前网络出口可用：

| Provider 路径 | 状态 | 下载体积 | 总耗时 | 结构化结果 |
| --- | ---: | ---: | ---: | ---: |
| 百度 `/s?...&tn=json`，稳定 Electron/OpenERX 产品 UA | 200 JSON | 4,191 B | 0.415 s | 11 entries，10 条标题/摘要完整 |
| Bing `/search?...&format=rss` 首次 | 200 XML | 5,709 B | 0.666 s | 10 items |
| Bing 服务端 HTML | 200 HTML | 43,437 B | 1.186 s | 10 个 `b_algo` 结果块 |

重要限制：

- 百度 JSON 入口没有公开正式 API 合同；只带简化 Probe 标识的 UA 得到过 302，包含实际
  Electron/Chromium 与 OpenERX 版本的稳定产品 UA 得到 200，说明 UA 合同、反自动化和接口漂移都
  必须纳入 readiness，不能靠轮换或伪造 UA 处理。
- Bing RSS 首次返回 XML，后续探测曾返回 221 B HTML 页面，不能作为唯一生产入口。
- Bing 的旧 Web Search APIs 已于 2025-08-11 退役；当前不存在可直接替换的普通 Bing Search
  正式 API。
- 因此 MVP 可在 Desktop Local Alpha 使用百度 JSON/Bing HTML，但发布门槛必须包含条款确认、
  多日真实探测和 fail-closed；不能把一次成功烟测写成生产稳定性证据。

## 4. 目标架构

```text
User prompt
  -> Pi AgentSession
  -> openerx_web_search(query, recencyDays?, domains?)
  -> Capability Broker
       -> web.search scope / budget / abort / audit
       -> freeze LocalWebSearchPolicy for this Generation
  -> LocalWebSearchGateway (existing App Service process)
       -> ControlledSearchFetch
            -> BaiduJsonSearchProvider
            -> BingHtmlSearchProvider
            -> SearxngJsonProvider (optional localhost)
            -> OfficialApiProvider (optional, user configured)
       -> bounded response reader
       -> provider parser
       -> URL validation / local filter / dedupe
  <- NormalizedToolResult
       -> content[type=text]
       -> content[type=source]
       -> sources[]
  -> same Pi loop
  -> final answer with source references
```

没有 Browser Host、Renderer DOM、截图、Accessibility、用户 Profile、Cookie 或第二套 Agent。

## 5. 轻量执行路径

### 5.1 一次搜索的固定步骤

1. Broker 校验 `web.search` Scope 和冻结策略；多次检索由模型侧调研计划控制，不设置单轮调用次数门禁。
2. Gateway 按可信设置选定一个 Provider；模型不能指定 Provider。
3. Provider 用固定 origin、path 和允许的参数构造 URL。
4. `ControlledSearchFetch` 发出一个 HTTPS GET，默认不跟随 SERP 重定向。
5. 响应头和响应体通过状态码、Content-Type、Content-Length、最大字节数和超时门禁。
6. Provider Parser 只解析结果列表，不执行脚本，也不抓取结果页。
7. Gateway 校验最终 Source URL、应用 domains/recency 标记、去重并限制最多 8 条。
8. 同一 Source 同时进入 `sources` 和 `content[type=source]`。
9. 结果交回 Pi；若模型需要阅读网页，应另行调用未来独立的 `web_open`，不在 Search 内隐式读取。

目标资源线：

- 无额外常驻进程；
- 单次 Provider 请求；
- 默认响应上限 512 KiB；
- 单次超时 4 秒，总工具超时 5 秒；
- Desktop Local Alpha 的 P50 小于 1 秒，P95 小于 3 秒；
- 单次搜索解析 CPU 小于 50 ms，新增打包依赖尽量小于 500 KiB。

### 5.2 ControlledSearchFetch

`ControlledSearchFetch` 是专用网络客户端，不接受任意 URL：

- Provider 注册时冻结 `origin`、path、方法、可用 query 参数和响应类型；
- 仅允许 `https://www.baidu.com:443`、`https://www.bing.com:443` 及用户显式配置的 Provider；
- 搜索请求默认 `redirect: "manual"`，SERP 入口重定向到验证码/登录页时直接返回稳定错误；
- 不发送浏览器 Cookie、账号、Referer、工作区信息、模型凭证或系统代理中的秘密；
- 使用由实际打包 Electron/Chromium 和 OpenERX 版本生成的稳定产品 User-Agent；不伪造不存在的
  浏览器版本、不轮换 UA/代理、不伪装登录用户、不绕过 CAPTCHA；
- DNS/IP/代理规则复用 PBASH `controlled_egress` 已有的私网、metadata、DNS rebinding 和
  redirect 越界约束；
- 响应流达到大小上限立即中止，不把未验证正文写入日志或 SQLite；
- AbortSignal、Stop 和 App 关闭立即取消 socket/reader。

搜索结果 URL 在本阶段只作为数据返回，不由 Search Adapter 发起请求，因此恶意结果 URL 不能借
Search 阶段触发 SSRF。

## 6. Provider 设计

### 6.1 BaiduJsonSearchProvider：MVP 第一 Provider

请求形态：

```text
GET https://www.baidu.com/s
  ?wd=<encoded query>
  &rn=<1..10>
  &pn=0
  &tn=json
```

可选时间过滤在明确验证时使用百度 `gpc=stf=<from>,<to>|stftype=1`；否则
`recencyApplied=false`，不能在结果中声称已严格按时间过滤。

解析规则：

- Content-Type 必须是 JSON；禁止把 HTML 错误页送进宽松 JSON/HTML fallback；
- `feed.entry` 必须是有界数组；
- 每条只读取 `title`、`url`、`abs`、可选 `time`；
- 标题和 URL 缺失的条目丢弃；
- HTML entity 只做文本解码，不解释标签；
- 时间戳非法或来源不明确时 `publishedAt=null`；
- 302 到 `wappass.baidu.com` 或正文含明确反自动化状态时返回
  `LOCAL_SEARCH_PROVIDER_CHALLENGE`，不重试、不改用浏览器。

该入口是未公开正式合同。首版 Provider descriptor 必须标记：

```ts
{
  stability: "unofficial",
  releaseEligible: false,
  requiresDailyProbe: true
}
```

只有条款确认和持续真实门禁完成后才能改变 `releaseEligible`。

### 6.2 BingHtmlSearchProvider：MVP 第二 Provider

请求形态：

```text
GET https://www.bing.com/search
  ?q=<encoded query>
  &mkt=<trusted locale>
  &adlt=<off|moderate|strict>
```

解析规则：

- 只接受 `text/html` 且响应体不超过 512 KiB；
- 用一个直接依赖、锁定版本的流式/容错 HTML parser；不使用正则表达式解析完整 HTML；
- 只识别 `ol#b_results > li.b_algo` 下的 `h2 a`、摘要 `p`；
- 解码 Bing `/ck/a?u=a1...` 跳转参数后再校验最终 HTTP(S) URL；
- 广告、侧栏、Copilot 摘要、相关搜索和导航不进入 Source；
- 无结果块、挑战页或结构漂移时 fail-closed，返回
  `LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED`；
- SearXNG 当前实现也注明 Bing paging/time-range 依赖 JavaScript；首版不承诺 Bing
  `recencyDays`，而是明确返回 `recencyApplied=false`。

建议在 `@openerx/tool-sdk` 中把 `parse5` 作为直接、锁定版本依赖，而不是依赖 Electron 的
transitive package。

### 6.3 Bing RSS：只做实验优化

`format=rss` 体积最小，但本机短时间重复探测已出现 XML/HTML 不一致，且没有找到 Microsoft 当前
正式合同。它不能作为默认或唯一路径。

如果后续实验：

- 必须独立 feature flag；
- 只接受 `text/xml`/RSS schema；
- 任意 HTML、挑战页或字段缺失立即失败；
- 不能静默切换到 Bing HTML，除非用户预先允许同 Provider 内的 transport fallback；
- 真实连续多日成功率和结果质量达到门槛后才可提升优先级。

### 6.4 SearxngJsonProvider：可选 localhost Provider

不随 Desktop 安装 SearXNG。只有用户已经运行本机实例时，Gateway 才可调用：

```text
GET http://127.0.0.1:<configured-port>/search
  ?q=<query>
  &engines=baidu,bing
  &format=json
```

边界：

- 仅允许 loopback 上用户显式配置的端口，不发现局域网公共实例；
- 启动时用 `/config` 校验实例和启用的 engines；
- JSON format 必须在实例 `settings.yml` 中启用，否则 readiness unavailable；
- App 不管理 Docker/Python、不自动拉镜像、不负责 SearXNG 升级；
- 如果未来随产品分发，必须单独评估 AGPL、镜像体积、签名、更新和进程生命周期。

### 6.5 正式 API Provider：可选稳定路径

- 百度千帆提供百度 AI 搜索/百度搜索能力，但需要百度账号、鉴权和计费，仍是第三方云服务；
- Bing Web Search APIs 已退役，不能作为新接入方案；
- 其他正式搜索 API 可通过同一 Provider interface 接入；
- Key 只能以 opaque credential ref 保存在 OS Credential Vault；
- 正式 API Provider 不改变“策略和执行在本机”的边界，但 UI 必须明确查询会发往第三方云服务。

## 7. 合同

### 7.1 模型合同保持不变

```ts
interface LocalWebSearchOperation {
  operation: "web_search";
  query: string;
  recencyDays?: number;
  domains?: string[];
  idempotencyKey: string; // host-derived
}
```

模型不能提供 Provider、URL、HTTP headers、Cookie、代理、解析器、fallback、超时或缓存设置。

### 7.2 冻结策略

```ts
interface LocalWebSearchPolicy {
  policyVersion: "local-web-search-policy-v2";
  enabled: boolean;
  providerOrder: Array<
    | "direct:baidu-json"
    | "direct:bing-html"
    | "direct:bing-rss-experimental"
    | "local:searxng"
    | `api:${string}`
  >;
  allowProviderFallback: boolean;
  locale: string;
  safeSearch: "off" | "moderate" | "strict";
  maxResultsPerCall: number;
  requestTimeoutMs: number;
  toolTimeoutMs: number;
  maxResponseBytes: number;
  queryMaxBytes: number;
  cacheMode: "off" | "turn" | "local_ttl";
}
```

Provider order、fallback、单次结果/字节/超时边界在 Prompt 前冻结。同一 Generation 中设置变更
只影响下一次 Generation。多次检索的角度、去重与停止条件由模型侧调研计划控制，不以固定调用次数
截断。

### 7.3 Provider interface

```ts
interface LocalSearchProvider {
  readonly descriptor: LocalSearchProviderDescriptor;
  readiness(signal: AbortSignal): Promise<ProviderReadiness>;
  search(
    input: NormalizedLocalSearchQuery,
    context: { signal: AbortSignal; policy: FrozenLocalWebSearchPolicy },
  ): Promise<LocalSearchProviderResult>;
}
```

Provider 返回未规范化候选；只有 Gateway 能生成产品级 Source。

### 7.4 Source 一致性

每个 Source 至少包含：

```ts
interface LocalWebSearchSource {
  sourceId: string;
  title: string;
  url: string;
  canonicalUrl: string;
  excerpt: string;
  publishedAt: string | null;
  retrievedAt: string;
  provider: string;
  rank: number;
}
```

要求：

- URL 必须是最终 HTTP(S) 地址；
- 标题、URL、摘要来自同一候选；
- 同一 canonical URL 去重；
- `publishedAt` 不可验证时为 `null`；
- `retrievedAt` 使用本机可信时钟；
- `sources` 与 `content[type=source]` 必须一一对应；
- 结果文本以“Untrusted web search data”开头，网页内容不能被解释成系统指令。

### 7.5 稳定错误码

- `LOCAL_SEARCH_DISABLED`
- `LOCAL_SEARCH_PROVIDER_NOT_CONFIGURED`
- `LOCAL_SEARCH_PROVIDER_UNAVAILABLE`
- `LOCAL_SEARCH_PROVIDER_CHALLENGE`
- `LOCAL_SEARCH_QUERY_INVALID`
- `LOCAL_SEARCH_TIMEOUT`
- `LOCAL_SEARCH_CANCELLED`
- `LOCAL_SEARCH_RATE_LIMITED`
- `LOCAL_SEARCH_RESPONSE_TOO_LARGE`
- `LOCAL_SEARCH_CONTENT_TYPE_INVALID`
- `LOCAL_SEARCH_RESULT_PARSE_FAILED`
- `LOCAL_SEARCH_RESULT_SURFACE_UNRECOGNIZED`
- `LOCAL_SEARCH_NO_RESULTS`
- `LOCAL_SEARCH_SOURCE_URL_INVALID`
- `LOCAL_SEARCH_POLICY_MISMATCH`

挑战页和解析失败不能改写成“没有结果”，模型也不能把失败描述为已完成搜索。

## 8. Provider 选择、fallback 和退避

推荐默认：

- 中文环境：`direct:baidu-json`；
- 用户可显式选择 `direct:bing-html`；
- 默认 `allowProviderFallback=false`，避免把同一 query 扩散给多个引擎；
- 不以 Browser Computer-Use 作为任何自动 fallback；
- 连续 2 次 challenge/429 后对该 Provider 退避 30 分钟；
- 解析 schema digest 漂移时立即标记 unavailable，等待产品更新；
- attempt 日志只存 Provider、query digest、耗时、字节数、结果数和错误码，默认不存完整 query。

本机 turn cache 使用：

```text
normalized query + provider + locale + domains + recency + safe-search + policy version
```

首版只做 Turn 内缓存，不跨会话保存 SERP、HTML、JSON、Cookie 或挑战页。

## 9. 实施切片

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| LWS-001 | 合同、冻结策略、Fake Provider、feature flag、readiness | 无网络；合同和负向测试通过 |
| LWS-002 | ControlledSearchFetch + Baidu JSON Provider | 夹具 + 日期化真实查询；Source 闭环 |
| LWS-003 | Bing HTML Provider + 锁定 HTML parser | 独立夹具；挑战/漂移 fail-closed |
| LWS-004 | Source/UI/turn cache/退避/Provider 设置 | 模型、Run、UI 使用同一 Source |
| LWS-005 | 可选 SearXNG/正式 API Provider | 分别 feature flag、凭证和 readiness 门禁 |
| LWS-006 | Stop、性能、多日 Golden、平台/发布矩阵 | 明确 Local Alpha 与 Release 证据边界 |

当前进度：LWS-001 至 LWS-004 已完成本地实现和日期化验证。LWS-006 已实现 Stop 资源回收、Parser
性能测试、每日固定 6 次真实探测、7 个不同日期汇总门禁和平台/发布证据矩阵；2026-08-29 第 1 日为
4/6 成功，状态保持 `insufficient_history (1/7)`。Provider 条款、Source 可打开性、跨平台签名包和
其余 6 个真实日期仍未完成。

### 9.1 LWS-001：先建立可逆边界

- 新增 `local-web-search-policy-v2`、Provider descriptor/result/attempt/error schema；
- 增加 `OPENERX_LOCAL_WEB_SEARCH_V2`；当前发布默认启用本地链，显式设置为 `0` 或 `false`
  时回退到托管云端链；
- Fake Provider 固定返回 `executionPerformed=false`；
- 将 `openerx_web_search` readiness 从账户鉴权改为本机 policy/provider readiness；
- 保留旧 `HttpPlatformWebSearchTransport` 作为短期回滚代码，但本地/云端只能注册一个；
- 冻结 max calls/results/bytes/timeouts/provider order；
- 证明模型 schema 中没有 Provider、URL、headers 或凭证字段。

### 9.2 LWS-002：百度轻量纵向切片

- 实现 `ControlledSearchFetch` 和 `BaiduJsonSearchProvider`；
- 用本地 JSON fixture 覆盖正常、缺字段、错误时间、恶意摘要、超限、302/挑战和 schema 漂移；
- 完成 `Pi -> Broker -> local fetch -> Source -> model -> Renderer` 日期化烟测；
- 记录真实耗时、字节数、Source 数、最终引用和 Abort 状态；
- Provider 仍标记 `unofficial / Local Alpha`，不宣称 Release Ready。

### 9.3 LWS-003：Bing HTML

- 给 `@openerx/tool-sdk` 增加直接、锁定的 HTML parser 依赖；
- 用本地 HTML fixture 覆盖普通结果、跳转 URL、广告、无结果、挑战、漂移和超限；
- 不实现 JS、分页或隐式 recency；
- 与百度 Parser 完全隔离，任何 Provider 改版不会误走另一套解析器。

### 9.4 LWS-004：可信设置、退避和 UI

- 强制 `sources` 与 `content[type=source]` 一致；
- UI 展示 Provider、live/turn-cache、耗时、结果数、partial/error；
- 加入 Provider readiness、退避、手动选择和缓存清理；
- 设置按 profile 写入 App Service SQLite，不使用 Renderer `localStorage`；
- 设置更新只影响后续 Generation，已启动 Generation 继续使用冻结策略；
- challenge/429 连续 2 次后退避 30 分钟，schema 漂移立即锁定至手动 reset；
- 模型合同不包含 Provider 设置，用户选择始终由可信 Desktop IPC 写入。

### 9.5 LWS-005 以后

- SearXNG、正式 API 分别实现，不能阻塞默认轻量路径；
- 浏览器搜索不进入本计划，仍是用户显式调用的独立 Browser 工具。

## 10. 测试和验收

### 10.1 确定性测试

- query 长度/Unicode/domains/recency/query injection；
- 固定 endpoint，模型 URL/header/proxy/Provider 注入失败；
- JSON/HTML 正常、空、截断、超限、Content-Type 错误；
- CAPTCHA、302、403、429、5xx、超时、Abort；
- 恶意 Source 使用 `file:`、`javascript:`、`data:`、loopback、private URL；
- Bing redirect decode 异常和 Baidu schema 漂移；
- 同 Turn cache hit、策略/过滤条件改变 cache miss；
- fallback disabled 时第二 Provider 零请求；
- Stop 后 socket/reader 关闭且无结果提交。

### 10.2 日期化真实门禁

- 百度、Bing 各用 3 类中性查询连续测试至少 7 天；
- 记录日期、OS、网络出口类型、Provider、状态、耗时、字节数、结果数；
- 对比 Source 可打开性、重复率和前 5 条相关性；
- 证明模型确实在工具结果后继续推理并引用 Source；
- 记录 challenge/429/漂移率，不能通过轮换 UA、代理或验证码绕过提高数字；
- Local Alpha 目标：成功率 >= 95%，P95 < 3 秒；
- Release 候选必须另有 Provider 条款、签名包、跨平台和长期稳定性证据。

### 10.3 仓库门禁

```bash
npm run check:v2
npm run test:e2e:v2
npm run audit:prod:v2
git diff --check
```

## 11. 迁移和回滚

1. LWS-001 初始加入 V2 feature flag，不改变当时的现有路径；完成本地实现和验证后，发布默认值已
   切换为本地链。
2. LWS-002 仅在 Desktop Local Alpha 启用百度直连。
3. 本地 Adapter 现为安装包默认，旧云端 Transport 仅在显式关闭本地链后启用。
4. LWS-003 加入可信策略显式选择的 Bing，不自动 fallback。（已完成。）
5. LWS-004 在 Desktop Tool Center 提供可信选择，并移除 `authenticated` 对本地
   `openerx_web_search` 的约束。（已完成。）
6. 完成一个发布周期的回滚观察后，再删除 `/v1/tools/web-search` 客户端代码。
7. 本地 Provider 失败时只返回稳定错误；不回退云端、不启动浏览器、不调用通用 Shell。

每个实施切片单独提交、单独测试。计划文件和本次网络探测都不是实现完成证据。

## 12. 非目标

- 不启动浏览器或托管 Chromium 完成搜索；
- 不运行 JavaScript、整页 OCR 或模型生成的 CSS/XPath；
- 不自动打开、抓取或总结结果网页；
- 不在本地建立全网爬虫、倒排索引或排名系统；
- 不捆绑 Docker/Python/SearXNG 作为默认依赖；
- 不允许 Shell、MCP 或 Browser 绕过 `web.search` policy；
- 不轮换代理、伪装用户、绕过 CAPTCHA 或隐藏 Provider 错误；
- 不把未经验证的百度 JSON、Bing RSS/HTML 描述为正式稳定 API；
- 不把“本机执行”描述为离线、匿名或 query 不会发送给第三方。

## 13. 推荐冻结值与下一步

进入实现前冻结：

1. 默认 Provider：`direct:baidu-json`；
2. 第二 Provider：`direct:bing-html`，只允许用户显式选择；
3. Browser、RSS、SearXNG、CLI 都不在默认链；
4. 每 Turn 最多 3 次搜索，每次最多 8 个 Source；
5. Provider 请求 4 秒、工具总计 5 秒、响应最多 512 KiB；
6. 默认只做 Turn cache，不做跨会话缓存；
7. 默认不 fallback，不重复请求，不打开结果页；
8. Desktop Local Alpha 先行；Release 需要额外条款和多日稳定性证据。

下一项可执行任务是 **LWS-006 第 2 个不同日期真实探测**。继续按日记录百度/Bing 的成功、challenge、
429、schema 漂移、P95 和 Source 相关性；不得复制或改写第 1 日产物来凑齐 7 日。LWS-005 的
SearXNG/正式 API 保持可选，不能阻塞当前轻量直连路径。

## 14. 外部依据

- [SearXNG Baidu engine](https://github.com/searxng/searxng/blob/master/searx/engines/baidu.py)：
  当前用 `tn=json` 获取百度结果，并明确标记为非正式 API。
- [SearXNG Bing engine](https://github.com/searxng/searxng/blob/master/searx/engines/bing.py)：
  当前直接解析 Bing 服务端 HTML，并注明分页/时间过滤依赖 JavaScript。
- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)：
  本机已有实例可通过 `/search?format=json` 接入。
- [SearXNG 官方容器安装说明](https://docs.searxng.org/admin/installation-docker)：
  当前文档列出的 base/app 镜像约为 143 MB/265 MB，并依赖 Docker/Podman。
- [Microsoft：Bing Search APIs 退役](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)：
  旧 APIs 于 2025-08-11 退役。
- [百度千帆接口概览](https://cloud.baidu.com/doc/qianfan/s/Smh4sutup)：
  百度 AI 搜索可作为需要账号、鉴权和计费的可选正式 Provider。
