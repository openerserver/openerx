# Remote 设置修复与 Codex 对齐 — 2026-09-08

状态：LOCAL VERIFIED（macOS 本地开发版）；未做手机真机、跨网络或生产部署验收。

## 问题与修复

日常 `npm run dev:v2` 使用 `tests/v2/fixtures/deepseek-platform.ts`，没有向 `createPlatformAlphaServer()` 注入 RemoteControlGateway。已登录用户调用 Remote hosts/pairings API 时得到 `REMOTE_NOT_CONFIGURED`。独立的 Remote E2E 服务早已注入网关，不能发现日常启动路径的遗漏。

- 开发入口增加持久化 `remote.sqlite` 网关，关闭服务时释放数据库。
- 从账户页面抽出独立的“设置 → 远程连接”，提供电脑控制开关、连接状态、扫码添加设备、撤销配对、刷新及连接说明。
- 未登录、未配置服务或网络错误显示中文说明；状态未就绪时不允许开启；二维码生成失败可重试，过期或关闭后不再显示；状态缓存按账户隔离。
- Remote E2E 改为点击真实设置入口、开关和添加设备按钮，验证二维码清理。其模拟模型补充 `thinkingLevels: ["off", "medium"]`，匹配桌面默认档位，避免旧测试配置触发 `PLATFORM_MODEL_NOT_FOUND`。

## 参考依据

- 官方流程：[Codex Remote](https://learn.chatgpt.com/docs/remote)：电脑端设置连接、扫码、同账户授权、保持电脑在线且唤醒。
- 本机已安装客户端 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 中 `webview/assets/remote-connections-settings-e745983ec0d2.js`：设置入口、允许控制开关、添加设备、授权设备撤销及状态提示。只参考产品行为，未复制账户凭据或连接 OpenAI 的 Remote 服务。

## 验证

- `npx vitest run apps/desktop/tests/remote-settings.test.tsx tests/v2/dev-platform-remote.test.ts services/remote-control-gateway/tests/remote-control-gateway.test.ts tests/v2/remote-host-gateway.test.ts`：4 个文件、18 项测试全部通过。
- 新增开发入口测试实际构建并启动日常服务，使用隔离数据库和无效测试 Provider Key，不调用模型供应商；验证登录、主机列表、注册、配对挑战、重启持久化及关闭。
- Electron Remote E2E：`E2E_REMOTE_OK same-account-pairing-e2ee-start-cursor-replay-single-charge-revoke-disable-key-vault`。使用隔离测试账户、测试服务和临时桌面目录，覆盖加密命令执行、事件游标、重放只计费一次及加密密钥存储。
- E2E 截图：`tmp/remote-settings-2026-09-08.png`（模拟手机配对，不是真机截图）。
- Desktop TypeScript、V2 boundary check、相关新增文件的 Biome check、修改代码的 Biome lint、`git diff --check` 通过。`App.tsx` 的既有格式问题未批量改写。
- 扩大运行 `chat-ui.test.tsx` 时：63 项通过，1 项记忆录入测试失败（输入文字被截断）。将该测试指向提交 `0fba434` 的原始 App.tsx 后同样失败；单独运行此项通过。已确认为原有测试问题，本次不改记忆逻辑。

## 发布范围

基于 GitHub main 迁移通用桌面修复，保留 OpenERX 默认品牌及外部品牌配置。公共仓库不包含手机应用；手机入口文案的一行变更保存在 `docs/v2/evidence/remote-mobile-navigation-2026-09-08.patch`，供独立手机仓库应用。上述完整 Electron 验证来自原本地工作区；迁移后的验证记录另附。

## GitHub 主线迁移验证

基线 `cbe938e`，独立克隆并按锁文件安装依赖。迁移后 4 个测试文件共 18 项通过；桌面 TypeScript、V2 边界检查（365 个文件）、新增文件 Biome check 与差异空白检查通过。修改文件 lint 无错误，App.tsx 保留已有的一条警告和一条提示。二维码替代文本改用中性名称，未引入企业品牌资源。
