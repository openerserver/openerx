# 浏览器清理修复：双版本应用更新

日期：2026-09-16（Asia/Shanghai）。

## 交付

已退出旧应用，分别从 openerx 与 UWA 仓库根目录执行 `npm run package:v2`，替换固定输出位置。没有新建应用名称、额外输出目录或复制完整用户 profile。

| 版本 | 构建 ID（UTC） | 源码提交 | 构建状态 |
| --- | --- | --- | --- |
| openerx 2.0.5 | `20260915T234316Z` | `47a3d1614a0ebf05041cfedd7adaac435053bca3` | clean |
| UWA 2.1.2 | `20260915T234546Z` | `c68ebcff2ebe39a25a3c56f75dff6fd97620096e` | clean |

UWA core：`ccb73bbfe3c73d7b38bf5a4fe549e3668150708a`。打包后只增加验证记录，没有更改生产源码。

固定应用：

- openerx：`openerx/apps/desktop/out/openerx-darwin-arm64/openerx.app`
- UWA：`openerx-advanced/core/apps/desktop/out/UWA Enterprise-darwin-arm64/UWA Enterprise.app`

## 新包验证

- 两版打包成功；`codesign --verify --deep --strict` 与 Electron fuses 检查通过。UWA fuses 检查使用其品牌 manifest；未设置品牌时的首次检查未找到对应产物，补齐品牌上下文后通过。
- 本次为本机 ad-hoc 包，签名状态为 `LOCAL UNSIGNED`，没有进行发布公证。
- 使用新生成包内的可执行文件及 `app.asar`，通过仅绑定本机的临时 CDP 端口测试；未放宽生产 fuses，也未使用开发目录中的主进程代替应用包。
- 两版各 5 项真实 managed Chromium 窗口验证通过：完成、模型失败、停止、加载中停止、工具宿主断开。每项先确认窗口存活；除加载中取消外，还确认浏览器会话已经 active，再触发终止并断言窗口消失。
- 使用临时测试 profile、本机页面与本机模拟模型服务，无外部模型调用。故障注入仅终止测试应用自己的 utility 子进程。测试后删除临时 profile，关闭临时 CDP 实例。
- 双版本一致性检查通过：442 个共享文件、115 个已审阅差异，基线为 openerx `47a3d1614a0ebf05041cfedd7adaac435053bca3`。
- 公共回归结果沿用 2026-09-15 已验证且未改动的源码：openerx 223 项、UWA 224 项；本次新增的是上述 10 项应用包实测。

## 原有数据与正常启动

核验通过只读连接保存摘要，未手工改写或迁移用户数据库。五份 SQLite 数据库完整性检查均为 ok；聊天、消息、项目数据表逐行摘要一致。

| 数据库 | 对话 | 消息 | 项目 |
| --- | ---: | ---: | ---: |
| openerx 本机 | 14 | 57 | 1 |
| openerx 既有账户 | 16 | 45 | 0 |
| UWA 本机 | 8 | 46 | 1 |

- `OpenerX`：107 个表摘要相同；变化表为 `skill_installations`（仍为 5 行）。
  所选配置与加密凭据文件的摘要均一致。
- `OpenerX-Enterprise`：70 个表摘要相同；`skill_installations` 仍为 5 行，`capability_scopes` 仍为 25 行。启动恢复按既有逻辑撤销了 9 条仅当前会话有效的能力授权，未扩大授权。
  中央账号 `session.bin` 随自动登录恢复而更新；其余所选配置与加密模型凭据文件摘要一致，未解密或打印凭据。

两版均已重新从正常应用路径启动，继续使用原有的 `OpenerX` / `OpenerX-Enterprise` 数据目录。日志确认：

- openerx：07:46:54 启动，07:46:54.886 服务 ready。
- UWA：07:49:40 启动，07:49:40.636 服务 ready。

Mac 当前锁屏，CUA 无法读取正常桌面的可视状态，已请求用户解锁；这项可视复验尚未完成。以上启动结论来自正常进程与日志，新包关窗结论来自独立 profile 的实际应用包自动验证。

## 本机证据

`openerx/.codex-temp/browser-package-20260916/` 保存打包日志、测试脚本、两版 5 项结果、产物 build-info/fuses/ASAR 摘要、更新前后数据库摘要及比对结果。该目录不进入 Git，不包含应用或完整 profile 备份。
