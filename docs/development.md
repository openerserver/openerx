# 开发指南

## 环境

使用 Node.js >= 24.3.0、npm >= 11.0.0。仓库采用 npm workspaces，`package-lock.json` 是安装基准。桌面开发使用 Windows 或 macOS；原生构建还需要相应平台工具链。

```sh
npm ci
npm run dev:desktop
```

开发服务器复用 `apps/desktop/.vite/`，Renderer 通过 Vite 热更新。修改 Main 或共享启动模块后可能需要重启同一开发命令。macOS 原生辅助程序生成到 `apps/desktop/.native-build/`。

## 检查

所有检查、测试和构建均在本地执行，GitHub Actions 已停用。提交代码前运行 `npm run check:local`；该命令依次检查版本、公开文件范围、全部依赖漏洞（包括开发和打包依赖）、模块边界、内置 Skill、发布配置、代码规范、类型及单元和集成测试，任一步失败即停止。依赖审计需要连接 npm registry，检查程序在本机运行；高危和严重漏洞会阻断检查，中等及以下风险仍需评估，并不代表没有漏洞。

桌面构建依赖由根目录 `overrides` 和锁文件固定到已审查版本。`scripts/forge-runner.mjs` 适配 Forge 7 与 Packager 20 的 hook 接口；`scripts/dmg-image-size.mjs` 适配 DMG 背景尺寸读取与新版图片解析器。升级这些依赖时必须同时审查适配器及回归测试，验证开发启动和目标平台打包；不要直接修改 `node_modules`，不要为消除告警恢复旧 ZIP 解压器，也不要只修改版本声明而不更新锁文件。

| 命令 | 用途 |
| --- | --- |
| `npm run check:local` | 提交前的本地源码检查与测试，不打包应用。 |
| `npm run check:public-surface` | 检查公开文件范围、文档白名单和相对链接。 |
| `npm run lint:v2` | Biome 源码检查。 |
| `npm run typecheck:v2` | 全部 workspace 类型检查。 |
| `npm run test:desktop-common` | 桌面公共回归。 |
| `npm run test:v2` | workspace 与集成测试。 |
| `npm run test:e2e:v2` | 桌面端到端测试，需要构建产物和对应平台环境。 |
| `npm run version:check` | 检查各产品版本一致性。 |

`npm run check:v2` 还涉及构建、产物和签名校验，适合完整验证环境。修改代码时先运行对应测试；完整检查通过后不必重复相同测试。

这些命令需主动执行，`git push` 不会自动运行检查。检查已提交的内置 Skill 变更时，用 `npm run check:builtin-skills:v2 -- --base <推送前的远端提交>` 比较版本。桌面打包、端到端测试和签名验证按需在对应的本地 macOS 或 Windows 环境完成；在 Mac 上通过不能证明 Windows 已通过。

## 模型与本地平台

默认桌面使用自己的模型 API，无需部署平台。设置方式见 [模型接入](models.md)。

只有开发可选平台服务时，才将 `.env.example` 复制为 `.env` 并配置开发参数，然后运行 `npm run dev:v2`。平台默认监听 `127.0.0.1:4099`。`npm run test:deepseek -- "只回答：连接成功"` 会调用真实模型并消耗服务额度。

## MCP、Skill 与浏览器

在 **设置 → 工具 → 添加工具** 中填写服务，或导入 `mcpServers` JSON。支持本机 STDIO 和 Streamable HTTP，以及启动参数、环境变量、工作目录、请求头、Bearer 和 OAuth。Context7 与 GitHub 提供快捷配置；GitHub 默认使用只读接口。

敏感配置保存在本机加密存储中。编辑时留空保留已有敏感值；环境变量或请求头填写 `{}` 可清空。STDIO 服务需要预先安装其运行环境。

Skill 描述任务方法，工具提供执行能力。内置 Skill 位于 `packages/skills/src/builtins.ts`；修改资源后需要递增对应版本，再运行 `npm run update:builtin-skills:v2` 更新快照。

Windows Shell 默认自动选择外部 Codex 的可用沙箱，无需设置环境变量。工具就绪状态只做初步安装检查；执行用户命令前异步检查 MXC 兼容性，成功结果缓存 60 秒，兼容时选择 MXC，否则检查已配置的 `elevated` 沙箱；两者均不可用时拒绝执行。选定后，初始化或命令失败均不会切换后端重试。MXC 使用 Windows 原生进程隔离、当前账户和每次命令独立的私有临时目录，已在 Codex CLI 0.162 上验证；`elevated` 使用独立的离线/在线账户，临时目录位于工作区，仍需满足当前命令协议要求。需要固定后端时可设置 `OPENERX_WINDOWS_SANDBOX_BACKEND=mxc` 或 `elevated`；显式选择不可用时直接拒绝执行。`auto`、空值和未设置均使用自动选择，其他值无效。应用不修改 Codex 全局配置。两种后端均按授权限制工作区写入和网络，当前 `workspaceWrite` 策略不承诺工作区外的读取隔离。外部程序路径可用 `OPENERX_CODEX_EXECUTABLE` 指定。

Chrome 扩展位于 `apps/desktop/browser-extension/`。已有标签页需显式配对授权；独立浏览器和系统辅助功能后端有不同的能力与平台权限要求。

终端的 `command` 是可执行程序，`args` 按原始参数传递。Windows 内建命令、重定向和 npm 等批处理入口需显式使用 `cmd.exe /d /c`；PowerShell 使用 `powershell.exe -NoLogo -NoProfile -NonInteractive -Command`。Windows PowerShell 5 的默认代码页可能丢失 emoji 等字符，输出 Unicode 时在命令中设置 `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)`。macOS 的 shell 语法需显式使用 `/bin/sh -c` 等解释器；Linux 的普通终端工具当前因缺少支持的 OS 沙箱而不可用。Node、npm、Git、Bash 等程序需安装并出现在应用启动时的 PATH 中；开发服务器附加的工具路径不会自动成为桌面应用的系统依赖。Skill 的 JavaScript 脚本依赖可用的 Node，Windows Store 的 Python 别名也不代表安装了 Python。

进程输出与输入采用 UTF-8；原生流协议返回程序的原始字节，`cmd` 等程序的旧代码页输出不会自动转码，即使 `chcp 65001` 成功也不保证重定向输出为 UTF-8。需要中文等非 ASCII 输出时优先使用显式设置 UTF-8 的 PowerShell，旧编码输出当前属于已知限制。

Windows 进程控制依赖外部 Codex 的沙箱命令流协议，执行前会核验协议字段，不支持时返回明确错误并要求更新外部程序。进程使用管道，可读取实时输出、发送 UTF-8 标准输入及停止单个后台命令；需要后续输入的程序应使用 `background=true`，完整交互式 TTY 程序另需终端能力。超时和取消结束对应命令，后台完成后自动收录工作区产物；输出截断会保留明确标志。

## 提交代码

保持模块边界，补充与行为有关的回归，在 PR 中注明平台、命令、结果及未验证项。用户文档只保留本仓库文档白名单中的七个文件；运行报告、截图与临时产物写入忽略的 `artifacts/`。

不要提交 API Key、用户数据、完整配置目录或构建目录。需要清理开发产物时先执行 `npm run clean:desktop` 预览，再按需加 `-- --apply`。
