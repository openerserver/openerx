# OpenERX Microsoft Store 包

2026-09-05 创建 Store 产品及首次提交草稿。此流程生成供 Microsoft Store 审核和签名的 MSIX，不生成可用于任意 EXE 的签名证书。

## 产品身份

身份直接取自 Partner Center，配置保存在 `apps/desktop/resources/windows-store.json`。

| 字段 | 值 |
| --- | --- |
| 名称 | OpenERX |
| Store ID | 9N7B29N19B1J |
| Package Identity Name | openerx.OpenERX |
| Publisher | CN=6533DE8D-63EF-414A-A709-7316D9261511 |
| PublisherDisplayName | openerx |
| PFN | openerx.OpenERX_mh787abak4m6w |
| 首包版本 | 2.0.1.0 |
| 支持目标 | Windows 11 x64，最低 10.0.22000.0 |

## 可重复构建

需要现有项目 Node/npm 依赖、.NET 10 SDK 和官方 Windows SDK MakeAppx。`OPENERX_DOTNET` 可指定 dotnet；`OPENERX_MAKEAPPX` 可指定 MakeAppx。

```text
npm run package:windows-store --workspace @openerx/desktop
```

也可直接调用 `node apps/desktop/scripts/package-windows-store.mjs --output-dir <尚不存在的输出目录>`。构建器在仓库 `.codex-temp` 中使用独立 Forge 输出，避免覆盖运行中的 EXE 安装目录。默认在 `deliverables` 中创建新的目录；不覆盖已有 MSIX。

Store 构建使用 `OPENERX_DISTRIBUTION=ms-store` 和 `OPENERX_RELEASE_MODE=1`：去掉源映射，禁用自有更新源，允许由 Store 签名 MSIX。普通 EXE 发布仍要求原生代码签名。Store 运行时也禁用自有更新器，首版不支持开机启动设置，避免写入不适合 MSIX 的 Run 注册表项。

MSIX 清单使用 `packagedClassicApp + mediumIL` 和 `runFullTrust`，完整保留 Electron 的 `resources/app.asar.unpacked` 布局。助手保持 `asInvoker/uiAccess=false`。图标复用项目现有小联形象。

## 本次构建证据

- 文件：`deliverables/OpenERX-2.0.1.0-store-x64/openerx.OpenERX_2.0.1.0_x64.msix`
- 大小：239656073 字节。
- SHA-256：`32eead842cd44b67a5574be7c17a6236037b82ce4ff41d0c6504ceced0d47d3c`。
- 官方 MakeAppx 语义检查通过；解包后逐文件 SHA-256 与 80 个源文件比对通过。
- Forge ASAR、原生助手哈希和无开发配置检查通过。
- MSIX 构建器 21 项测试、签名渠道/签名校验/更新/登录启动相关 15 项测试通过；桌面 TypeScript 检查通过。
- 构建报告、SDK 日志、清单及校验后的解包内容保存在同一产物目录。

## 上传与后续验收

本次 `.msix` 已上传并保存。保存后概述页显示包文件 `openerx.OpenERX_2.0.1.0_x64.msix` 为 `Validated`，包项目状态为“完成”；提交仍为草稿，认证按钮不可用。包页显示 `v2.0.1.0, X64`、`Windows.Desktop min version 10.0.22000.0`。页面返回警告：`The following restricted capabilities require approval before you can use them in your app: runFullTrust.` 这是需认证审核的受限能力，不能宣称已获批准。

只上传 `.msix` 文件到 [OpenERX 提交草稿](https://partner.microsoft.com/zh-CN/dashboard/products/9N7B29N19B1J/submissions/1152921505701818710/packages)，不上传 staging 或报告目录。包验证成功不等于认证通过、发布成功或已经取得商店签名。

后续认证所需的应用属性、年龄分级、商店说明、截图、隐私政策与测试说明需要据实填写。`runFullTrust` 用于 Electron 桌面运行、本地文件工具和用户授权的桌面自动化；不会授予管理员权限。

当前 Windows 桌面控制仍保留开发开关 `OPENERX_WINDOWS_DESKTOP_CONTROL=1`，Store 开始菜单启动不会自动设置此环境变量。此包未安装运行，原生助手启动、签名覆盖、.NET 临时解包、记事本/计算器前台闭环均须在实际 Store 签名构建上验收。不得以 MSIX 打包或上传成功替代这些检查。
