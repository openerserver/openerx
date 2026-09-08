# 开发、构建与故障排查

## 环境

- Git、Node.js 24.3+、npm 11+；CI 使用根目录 `.node-version`。请使用 npm，不混用 pnpm/yarn 锁文件。
- Windows x64 与 macOS arm64/x64 是打包目标；CI 使用原生架构 runner。源码检查和发布预检查在 Windows 上执行，暂不运行 Linux CI。
- macOS 打包需要 Xcode Command Line Tools（辅助程序使用 Swift）。Windows 打包需 PowerShell；安装需要访问 npm registry 和 Electron 下载源。
- 根目录运行 `npm ci`。安装失败先检查版本、代理、下载源及磁盘空间，不要先删除用户数据或改写锁文件。

## 日常命令

```sh
npm ci
npm run dev:desktop
npm run check:source
npm run package:v2
npm run check:package
# 可选：Squirrel Windows 安装程序，或 macOS ZIP
npm run make --workspace @openerx/desktop
```

`package:v2` 输出可直接运行的未签名应用目录；`make` 输出 `apps/desktop/out/make/`。打包前退出之前的开发包，避免 Windows 文件锁。不要提交 `out/`、`.vite/`、用户配置或安装包。

若旧输出目录被占用，可将 `OPENERX_PACKAGE_OUT_DIR` 设置为新的绝对输出目录；打包和 `check:package` 使用同一个值。PowerShell 示例：`$env:OPENERX_PACKAGE_OUT_DIR = Join-Path $PWD '.codex-temp/release-check'`。不必终止其他任务或删除旧包；完成后移除该环境变量以恢复默认目录。

macOS 使用 ZIP 分发 `.app`。默认不生成 DMG：旧 DMG 工具依赖的 `image-size` 存在未修复的高危解析漏洞，已移除该生成器而不是豁免审计。Electron Forge 的 packager/rebuild/get 和 tar/tmp 使用根目录 overrides 中的修复版本；更新 Forge 后应重新核对这些覆盖，并运行打包回归。首次发布以实际 CI 结果为准。

`scripts/forge-runner.mjs` 显式适配 Forge 7.11.2 的回调 hook 与 Packager 20.3.0 的 Promise hook，不修改 `node_modules` 文件。使用仓库 npm 命令运行构建；直接调用旧 `electron-forge package` 不经过该适配。升级任一版本会要求审核适配器，相关合同测试必须通过。

首次配置使用「设置 → 模型」BYOK，不需要 `.env` 或平台服务器。调用模型、联网搜索或外部工具会产生相应网络请求。

## 可选平台开发

`npm run dev:deepseek` 是本地平台集成开发流程，不是默认桌面启动方式。需要时复制 `.env.example` 为 `.env` 并填写自己的测试凭据；不要把真实密钥写入示例。`test:deepseek*`、模型评测、联网探针和部分历史 E2E 会访问服务或产生费用，不包含在无凭据源码检查中。

## 测试分层

- `check:source`：公开路径/历史/高置信凭据检查、第三方清单一致性、代码边界、内置 Skill 版本、lint、typecheck、工作区及集成测试、全依赖高危审计。
- `check:package`：ASAR 内容、Electron fuses、签名状态与真实包启动；使用新建临时 profile，不读取日常数据库。覆盖自动化、Skill 和记忆读写及重启保留。
- `test:e2e:v2`：历史平台集成 E2E，需要额外服务/权限；不是首次克隆必须运行的无凭据门禁。
- `check:v2`、`release:gate:v2`：公共桌面研发/正式发行验收，范围见 [桌面发布门禁](RELEASE_GATES.md)。企业移动和生产支付验收由企业仓库维护。人工验收和生产配置不能由源码检查代替，不能为通过门禁伪造批准。

沙箱集成测试仅在对应后端可用时执行；无后端时明确跳过真实执行测试，并保留能力不可用、授权拒绝等合同测试。macOS 与 Windows 隔离能力不同，见 [隐私说明](PRIVACY.md)。

## 一套代码与企业品牌

通用功能在本仓库修改、测试和提交；企业仓库更新 `core` submodule 的固定 commit。品牌/外观只放企业品牌清单和资源；移动端、企业集成放企业仓库，不复制入公共核心。

默认不设置 `OPENERX_BRAND_MANIFEST` 即构建 OpenERX。企业构建时指向仓库外品牌 JSON；字段及验证位于 `packages/branding/src/node.ts`。切换品牌后必须重新完整构建，不能复用旧 `.vite` 产物。公共 CI 不加载品牌覆盖文件。

修改内置 Skill 内容必须提高基础版本号（品牌后缀不算递增），运行 `npm run update:builtin-skills:v2` 并提交快照；旧 profile 升级测试避免 `SKILL_VERSION_IMMUTABLE` 导致启动失败。

## 常见问题

- `App Service exited before readiness`：确认运行最新包，再看脱敏后的主进程/utility 日志。旧品牌 Skill 同版本冲突已通过独立版本修复；不要删除日常数据库绕过升级问题。
- Skill、记忆和自动化一起读取失败：涉及共同的 App Service，先运行 `check:package`，报告错误与 commit；页面空白不等于数据丢失。
- Shell 不可用：macOS 需要系统沙箱；Windows 需要已配置的外部 Windows 沙箱及运行时（可用 `OPENERX_CODEX_EXECUTABLE` 指向安装）。本仓库不捆绑外部程序，不绕过后端不可用状态。Skill 脚本另需 Node 可执行文件。
- 未签名：本地开发包的预期状态。正式发行要求证书、公证及有效更新配置，见 [发布清单](PUBLISHING.md)。
