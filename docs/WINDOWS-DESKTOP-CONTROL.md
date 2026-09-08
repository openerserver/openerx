# Windows 桌面控制

Windows x64 的桌面控制实现使用独立 .NET 10 助手，提供应用发现、窗口绑定、UI Automation 观察、窗口截图和键鼠操作。源码遵循项目 Apache-2.0 许可证。

## 从源码运行

安装 Node/npm 依赖及 .NET 10 SDK。Windows 打包会自动编译助手；开发时先运行：

```powershell
npm run build:windows-desktop-helper --workspace @openerx/desktop
$env:OPENERX_WINDOWS_DESKTOP_CONTROL = "1"
npm run dev:desktop
```

`OPENERX_DOTNET` 可指定 dotnet 可执行文件。功能默认关闭；助手以当前用户权限运行，桌面必须解锁。Windows 应用控制可能阻止未签名的开发构建，应用不会修改该策略。

窗口切换与输入共用持续助手进程，观察和用户输入监视器各自独立。自动切换使用 Win32 激活与最小化恢复，并核对 HWND、PID、进程启动时间和实际前台。用户操作键鼠会暂停控制；超时、取消、监视器丢失及停止会清理交互进程。恢复必须由用户界面发起。

## 真实应用验收

2026-09-08 的原生助手与 Driver 验收完成记事本/计算器四次自动切换及最小化恢复，验证中文和 emoji 保存、`1+2=3`，没有接管误报。测试环境由用户关闭 SAC；未逐窗口手动切前台。原生助手 SHA-256 为 `b3d227e102c5d447018a5f6d155e2032d799777473aa6d9bfe9024c262a93b1e`。

查看[自动切换结果](v2/evidence/assets/wdc-004/foreground-result.json)、[计算器截图](v2/evidence/assets/wdc-004/calculator.png)、[记事本截图](v2/evidence/assets/wdc-004/notepad.png)和[主机验收结果](v2/evidence/assets/wdc-004/host-result.json)。这些结果来自同步前的相同原生源码与控制模块，不等同于本开源分支已完成安装包或完整对话调用链验收。

开发者可在没有个人记事本/计算器窗口的测试桌面重跑。测试期间会控制前台，操作键鼠会使测试停止：

```powershell
dotnet build apps/desktop/tests/native/WdcFixture/WdcFixture.csproj -c Release
npx vite build --config apps/desktop/vite.windows-desktop-control.config.mts
node apps/desktop/.vite/windows-desktop-live/foreground.mjs
```

## Windows 签名和 Microsoft Store

普通 EXE 发布支持 PFX 或证书存储区指纹；签名后才生成助手哈希清单。不要把证书私钥或密码提交到仓库。

MSIX 打包需要 Windows SDK MakeAppx、自己的 Partner Center 产品身份 JSON 和有权使用的 PNG 图标。身份 JSON 包含 `name`、`publisher`、`publisherDisplayName`、`displayName`、四段式 `version`，以及与实际包一致的 `executable`（默认 `OpenERX.exe`）。版本最后一段应为 0。

```powershell
node apps/desktop/scripts/package-windows-store.mjs --config C:/release/identity.json --logo C:/release/logo.png --output-dir C:/release/new-msix
```

`OPENERX_MAKEAPPX` 可指定 SDK 工具路径。输出目录必须不存在；构建器验证 MSIX 语义和解包后的全部 payload。该命令生成待 Store 签名的上传包，不提交审核、不发布、不提供可用于任意 EXE 的签名证书。Store 模式禁用自有更新器，当前不支持登录启动。
