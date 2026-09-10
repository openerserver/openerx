# openerx 名称与升级兼容记录

日期：2026-09-10（Asia/Shanghai）。开源产品名称为 `openerx`；UWA 专指联通版本，品牌素材保存在独立私有仓库。

## 本次变化

- 桌面、Remote 界面、助手文案、通知、授权返回页、内置 Skill 发布者及当前构建脚本统一使用 `openerx`。
- 桌面改用项目内的 SVG 标志及其 PNG、ICO、ICNS 派生文件；移除开源树中原有联通标志、助手图片。生成命令为 `node apps/desktop/scripts/build-brand-icons.mjs`。
- 应用版本为 `2.0.3`；Windows Store 候选为 `2.0.3.0`，高于原配置的 `2.0.2.0`。Store 的已登记 Identity/Publisher 保留，不表示已上传或通过审核。
- 更新清单只接受产品 `openerx`；本地包自动更新关闭。原有发布证据文件和 Git 历史保留原时点记录。
- 内置 Skill 升至 `1.0.2`，从历史 `1.0.0`、`1.0.1` 升级并保留回滚记录。

## 保留的兼容标识

- `com.openerx.desktop`、`com.openerx.remote` 与用户配置目录 `OpenerX` 保持稳定。
- 旧 `UWA Workspace` 目录存在时继续使用，不搬移、删除或覆盖文件；新目录名为 `openerx Workspace`。
- 主进程在 Electron ready 前使用历史 `UWA` 存储名称，ready 后显示为 `openerx`。Windows 登录启动的历史 Run 键也继续保留，保证关闭开机启动能作用于已有安装。这些是持久化兼容键，不是当前产品名。
- Electron 44 在 ready 前固定系统加密配置；参考其 [主进程初始化源码](https://github.com/electron/electron/blob/v44.0.0/shell/browser/electron_browser_main_parts.cc) 与 [异步凭据提供器源码](https://github.com/electron/electron/blob/v44.0.0/shell/browser/browser_process_impl.cc)。真实 Electron 回归使用隔离配置和临时系统钥匙串条目验证跨进程解密，完成后清理测试条目。

## 验证和交付边界

`npm run check:v2` 全流程通过：770 项测试通过，2 项按平台跳过；包括全仓类型检查、边界检查、桌面和移动打包、产物校验。本地签名检查明确报告 unsigned，CSS 既有 lint 警告保留。`node apps/desktop/scripts/e2e-brand-identity.mjs` 通过，验证应用名称、图标加载及 macOS 凭据兼容。结构化结果见 [验证记录](verification/openerx-brand-20260910.json)。

本地 macOS ARM64 应用位于 `apps/desktop/out/openerx-darwin-arm64/openerx.app`。此包没有正式签名、公证或 Store 提交证据；Windows 真机安装升级、代码签名变化后的系统授权行为仍需对应设备验收。目录与钥匙串兼容测试不替代这些发布验收。
