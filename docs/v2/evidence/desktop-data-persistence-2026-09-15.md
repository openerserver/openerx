# openerx 更新与重启数据保留修复

- 日期：2026-09-15，Asia/Shanghai。
- 基线：`932300819045a7fa9bf2e9ed4d4ac90b5d3cee33`，开始时工作区干净。
- 分支：`codex/desktop-data-persistence-20260915`。
- 验证范围：本机 macOS arm64、桌面开发启动与现有应用包替换。

## 问题与修复

启动时 `AccountSessionManager.initialize()` 曾对所有 refresh 错误调用 `vault.clear()`。
当次运行仍保留内存中的账户，但下一次启动失去账户信息，选择本机数据库，原账户历史不再显示。
开发自动登录也会在刷新失败后登录配置的默认账户，改变正在使用的数据目录。

本次将本地数据选择与登录凭据的有效性分开保存：

- 断网、服务端暂时异常、系统凭据设施不可用时保留凭据；只在服务端明确拒绝会话时移除失效凭据。
- 账户和设备会话的非密钥元数据单独原子保存；旧版可读凭据在刷新前补齐元数据。失效后连续重启仍选择同一账户数据库。
- 元数据不包含 refresh credential 或 access token；离线状态不会获得网络授权。主动退出登录才清除账户选择，数据库继续保留。
- 已有账户不会被开发自动登录替换。操作系统数据目录和 Chromium session 数据目录固定为历史 `OpenerX` 目录，与应用包和版本无关。
- 旧凭据无法解密且没有可确认的账户元数据时继续报错，保留原文件；不猜测账户、不创建空数据库来掩盖读取失败。

保留了现有 OS 加密身份与原来的加密 API。Electron 的系统密钥存储与应用身份有关，参见
[Electron safeStorage 文档](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)。

## 验证

1. `npm run test --workspace @openerx/desktop`：47 个测试文件，379 项通过；附加 build-info Node 测试 1 项通过。
2. 定向账户、凭据、真实 SQLite 文件和迁移测试：4 个文件，44 项通过。覆盖连续 3 次重启、网络失败、会话拒绝、系统凭据不可读、旧凭据元数据补齐、主动退出及开发账户隔离。
3. `npm run typecheck --workspace @openerx/desktop`、`npm run check:boundaries:v2`、修改文件格式检查与 `git diff --check` 通过。
4. 从根目录运行 `npm run dev:desktop`，使用独立测试 profile。没有登录凭据时仍打开已保存账户的 1 个聊天、2 条消息和 1 个项目；主进程重新编译并重启后，CUA 再次确认项目、聊天和正文可见。诊断记录有 2 次启动、2 次 service.ready；没有生成错误的本机空数据库。
5. 退出旧应用后执行 `npm run package:v2`，替换固定位置的 `apps/desktop/out/openerx-darwin-arm64/openerx.app`。构建为 `2.0.5 / 20260915T124704Z`，从上述基线加本次源码修改构建，manifest 正确标记 `dirty: true`。
6. `npm run verify:package:v2` 通过。签名检查报告 `LOCAL UNSIGNED`，本次未执行正式签名发布或 Windows 实机更新验证。
7. 新应用已启动，CUA 确认原项目、历史正文、DeepSeek 模型选择与现有配置仍可读取。

## 本机数据比对与备份

在更新前通过 SQLite 在线备份保存两份数据库，并保存小型模型配置、加密凭据和设备标识文件。
没有复制应用、Electron、node_modules 或完整浏览器 profile。

| 数据位置 | 对话 | 消息 | 项目 |
| --- | ---: | ---: | ---: |
| 当前本机数据库 | 14 | 57 | 1 |
| 既有账户数据库 | 16 | 45 | 0 |

更新前后比较了 107 个数据库表的逐行摘要。106 个表完全一致；`skill_installations` 的 5 个内置 skill 仅在正常启动时更新 `updated_at` 和 `revision`，其内容、启用状态与权限保持不变。模型配置、加密模型凭据和设备标识文件的 SHA-256 均一致。

本次没有把不同账户的历史合并到本机历史。既有账户的 16 个对话仍在原数据库中；缺失的旧登录状态不会被自动恢复为有效授权。

本机证据和定向备份目录：

`/Users/wanglei/Downloads/phones-cloud/openerx/.codex-temp/data-persistence-20260915/`

包含 `desktop-tests.log`、`package.log`、`personal-data-before.json`、`personal-data-after.json`、`personal-data-comparison.json` 和 `database-before-update/`。备份仅在本机保存，不进入 Git。

## 双版本交付补充

本修复同步进入 UWA 的 `openerx-advanced/core`。公共 profile 初始化接受版本固定目录名；默认仍为 `OpenerX`，UWA 传入既有的 `OpenerX-Enterprise`。两个目录均加入重编译、多次重启、离线刷新及已撤销登录的数据库和模型配置保留回归。

仓库 `AGENTS.md` 已要求共通桌面修复同时检查、修复和验证两个版本；公共回归入口增加账号会话、数据保留及远程请求超时测试。`npm run test:desktop-common` 在 openerx 通过 15 个桌面测试文件（106 项）与 9 个公共执行测试文件（60 项），同时通过 5 个包的类型检查。UWA 的独立账号、数据与应用验证详见该仓库 `docs/DESKTOP_DATA_PERSISTENCE_20260915.md`。
