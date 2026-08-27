# P1 Codex 对齐 CX-110-D1 桌面 MCP OAuth 实现证据（2026-08-27）

> 状态：`PASS / DESKTOP LOCAL IMPLEMENTATION CHECKPOINT`；完整 CX-110 仍为 `IN PROGRESS`
>
> 时间：2026-08-27 13:24（Asia/Shanghai）
>
> 基线：`HEAD e8983b8a13cc5e9f6df7e065ee375deefbff4ae9` 加当前未提交的 P0、CX-101 至 CX-109 与 CX-110-D1 实现
>
> 范围：`docs/v2/16-codex-aligned-implementation-assessment.md` 中 CX-110 的桌面端 MCP OAuth Authorization Code + PKCE 本地切片

## 1. 结论

CX-110-D1 已形成可运行的桌面本地检查点。原实现把 OAuth 错误地做成 Renderer 收集 `client_secret`、App Service 使用 `client_credentials`；现在改为桌面公开客户端的 Authorization Code + PKCE：Renderer 只保存可选 Client ID/Scope 并显示授权状态，Desktop Main 创建随机 Loopback 回调、调用系统浏览器并持有 OS 加密凭证库，App Service 通过官方 MCP Client SDK 完成受保护资源发现、授权服务器发现、动态客户端注册、PKCE、授权回调、Token 交换与刷新。

普通工具发现不会自动弹出浏览器。未授权时返回 `authorization_required`；用户必须在桌面工具中心明确点击“在浏览器中授权”。已授权、需授权、无需 OAuth 与不可用都有稳定合同，旧版 `client_credentials` 数据被明确标为不可用，不会静默继续使用。

本轮真实启动了本机 HTTP OAuth + MCP 协议夹具，走完整发现、动态注册、浏览器回调参数、PKCE Token 交换和 MCP 工具发现链路。它证明桌面实现与协议链路，不等于任意第三方 OAuth 服务的实网兼容证据，因此完整 CX-110 和完整 P1 仍未完成。

## 2. 进程边界

```text
Renderer 状态/按钮
  -> 窄 Preload IPC
  -> Desktop Main
       - 127.0.0.1 临时回调监听
       - 系统默认浏览器
       - Electron safeStorage 加密凭证库
  <-> 严格 MessagePort OAuth/credential frame
  -> App Service / MCP Client SDK
       - OAuth metadata / DCR / PKCE / Token / refresh
  -> Streamable HTTP MCP Server
```

- Renderer 不接触 Client Secret、Access Token、Refresh Token、PKCE verifier 或回调 URL。
- Desktop Main 是系统浏览器、Loopback listener 和持久凭证加密的唯一所有者。
- App Service 只在执行 OAuth/MCP 协议时经 Main capability channel 读取或更新加密值。
- MCP OAuth 未授权不会触发隐式交互；只有显式桌面命令会创建交互式回调 Session。

## 3. 实现与证据映射

| 边界 | 关键实现 | 自动化证据 |
| --- | --- | --- |
| 公共合同 | 新增 `McpServerAuthorizationState`、状态查询和显式授权命令；桌面保存输入只允许可选 Client ID/Scope，不接受 Client Secret。 | Contracts 接受 Authorization Code 配置、拒绝 `oauthClientSecret`，并验证 credential/OAuth 进程帧为 strict object。 |
| Main OAuth Host | `OAuthLoopbackController` 只绑定 `127.0.0.1` 随机端口和随机路径；校验 GET、URL 长度、origin/path；只允许 HTTPS 授权地址或 Loopback HTTP；用系统浏览器打开。 | Desktop 测试验证可信 URL、精确回调、非 Loopback HTTP 拒绝、Session 取消和安全完成页。 |
| SDK 协议 | `DesktopMcpOAuthProvider` 实现 MCP SDK `OAuthClientProvider`，支持授权服务器发现、DCR、PKCE state/verifier、Token/refresh 与 issuer 绑定。 | Tool SDK 的真实本机协议夹具完成 RFC 9728 protected-resource metadata、authorization-server metadata、DCR、S256 PKCE、Token exchange 和 MCP tool discovery。 |
| 进程往返 | App Service 通过 strict MessagePort frame 请求 Main 保存凭证、准备回调、等待授权和取消 Session；响应 operation 必须与请求匹配。 | App Service 测试直接往返 credential save 与 OAuth prepare/authorize/cancel 四类 frame。 |
| 凭证生命周期 | OAuth 数据只通过 Main capability channel 写入 `ToolCredentialVault`，由 Electron `safeStorage` 加密并以 `0600` 原子替换；Token 成功保存后立即清除 PKCE verifier。 | Provider 测试验证 Client/Token 持久化、verifier 清除、state 不匹配拒绝、过期且不可刷新 Token 回到需授权状态。 |
| 非交互发现 | 正常 MCP discovery 使用非交互 Provider；缺少有效 Token 时返回稳定 `MCP_OAUTH_AUTHORIZATION_REQUIRED`，不打开浏览器。 | Adapter 授权状态在交互前为 `authorization_required`，显式 authorize 后变为 `authorized + connected`，后续发现直接复用连接。 |
| 桌面交互 | 工具中心显示认证方式、授权/连接状态、Token 到期时间与可操作中文错误；提供显式授权/重新授权按钮，等待时禁用重复提交。 | Desktop UI 测试验证需要授权状态、不存在 Client Secret 输入、点击授权、成功状态与重新授权入口。 |
| 旧实现迁移 | 旧版 `client_credentials` JSON 不再被执行，并显示“移除后重新添加并授权”。 | Provider 测试验证旧数据被明确拒绝；Adapter 把该错误投影为 `unavailable`，不会回退到旧 Grant。 |

## 4. 安全边界

- 桌面应用不收集 OAuth Client Secret；公共客户端使用 `token_endpoint_auth_method=none`，支持预配置 Client ID 或动态注册。
- 每次交互生成 256-bit 随机 `state`；回调必须匹配本次随机 Loopback origin/path 和 state，并包含 `code` 或明确 OAuth error。
- PKCE 使用 SDK 生成的 S256 challenge；verifier 只在 Token 交换前暂存，Token 保存后清除。
- Authorization URL 禁止用户名/密码，非 Loopback HTTP 被拒绝；系统浏览器而非主 Renderer 承载身份登录。
- Loopback 完成页无动态授权数据，使用 `no-store`、`no-referrer`、CSP 与 `nosniff`；回调 Session 有五分钟上限并在成功、失败、取消或进程关闭时清理。
- Access/Refresh Token 不进入 Renderer、普通日志或 MCP 配置表；磁盘持久化依赖 Electron `safeStorage`，不可用时明确失败。
- 旧版 Client Secret 可能仍存在于历史加密 Vault 中，直到用户移除或重新保存该 MCP；产品不会再读取执行它，并提示重新配置。

## 5. 验证结果

专项验证全部通过：

- Contracts：20 个测试。
- Tool SDK：27 个测试，包括真实本机 OAuth + MCP 协议夹具。
- App Service：17 个测试。
- Desktop：48 个测试。
- 上述四组共 112 个测试，且四个 workspace TypeScript 检查通过。

2026-08-27 13:24（Asia/Shanghai）执行完整 `npm run check:v2`，结果 `exit 0`：

- V2 boundaries：215 个源文件，PASS。
- Release graph：158 个 production 文件、13 个 Pi imports 仅位于 `packages/pi-host`、45 条 workspace edges，PASS。
- Local release readiness：PASS；仍明确保留 12 组外部证据。
- Biome：311 个文件，PASS。
- TypeScript：全部 workspace，PASS。
- Tests：workspace 239 个测试加根目录 61 个测试，合计 300 个，PASS。
- Build：Contracts、Release、Mobile iOS/Android 和 Desktop production bundle，PASS。
- Package：Darwin arm64/x64 与 Windows x64 Fuse 检查，PASS。
- Release artifact：`app.asar` 版本 `2.0.0-alpha.0`、update boundary，PASS。
- Native signature：三平台本地包仍按预期为 `LOCAL UNSIGNED`，不作为签名发布证据。

## 6. 明确限制与下一任务

- 本机协议夹具不是 GitHub、Google、Microsoft 或任意第三方 MCP Provider 的实网授权证据；真实服务仍需日期化账户与端到端记录。
- 当前没有独立的“取消授权”按钮；Session 会在请求结束、超时、应用关闭或内部取消时释放。桌面交互取消可在后续体验切片补充。
- 本轮不证明 Windows/macOS 签名安装、公证、升级回滚或原生 Browser/Shell/Desktop 控制矩阵。
- 完整 CX-110 继续保持 `IN PROGRESS`，不能因为本切片或本地 unsigned package 宣称完整 P1。
- 后续 CX-110-D2 已完成桌面 Host runtime readiness 与当前 Mac 的 Browser/Shell/Desktop 本机矩阵，见 [CX-110-D2 证据](p1-codex-alignment-cx110-desktop-runtime-2026-08-27.md)；第三方实网、签名 TCC 身份和 Windows 原生矩阵仍待补证据。
