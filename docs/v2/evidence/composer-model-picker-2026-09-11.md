# 对话模型选择器 · 2026-09-11

状态：LOCAL VERIFIED。

新建和已有对话的模型菜单只展示模型目录中 `status=available` 的选项，原生 select 使用相同筛选。BYOK 预设模型的可用状态由服务商是否已配置凭据决定；设置页仍保留全部服务商配置入口。

没有可用模型时隐藏模型与思考选择器，保留配置入口，阻止按钮和 Enter 发送。新任务的默认模型只从可用模型中回退选择。已有对话使用的模型失效时，可主动选择其他兼容模型，保存后恢复发送。

验证：

- `npm run test --workspace @openerx/desktop -- tests/chat-ui.test.tsx`：90 项通过，覆盖新建/已有对话的选项筛选、未配置/空目录隐藏、发送限制及失效模型切换。
- Desktop TypeScript 检查通过；V2 边界检查通过，401 个源文件。
- Biome 无错误；保留 App.tsx 已有的 1 条 warning 和 1 条 info。
- `e2e-byok-default.mjs`：临时 profile 中，未配置时菜单隐藏；使用测试字符串保存 DeepSeek 配置后，菜单和原生 select 仅显示该服务商的可用模型。未发起模型请求。
- macOS arm64 应用打包完成并通过严格签名验证，已更新本机应用。真实对话菜单仅显示 DeepSeek V4 Flash、V4 Pro、V4 Flash Vision，未配置的其他服务商选项消失，思考强度保留。
- 本机 SQLite 更新前后逐行核对：11 个对话、51 条消息、1 个项目、14 个成果及 14 个成果版本均未变化。

检查点、更新前后的应用、数据库备份、测试日志和菜单对照截图保存在：

`/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/model-picker-20260911-180800/`

本次验证覆盖本地桌面交互与构建，不代表外部模型接口连通性或正式发布验证。
