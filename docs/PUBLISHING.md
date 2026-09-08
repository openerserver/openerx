# GitHub 源码与桌面发行清单

最近一次本地验证结果见 [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md)。

## 源码发布

```sh
npm ci
npm run check:source
npm run package:v2
npm run check:package
git status --short
```

检查覆盖当前公开候选文件和 Git 可达历史，但不能证明所有商业权利、隐私或安全风险均不存在。维护者仍须确认原创代码/资源发布权、合作者与企业合同及第三方素材授权。

- 使用独立开源历史，不能从旧私有仓库 `push --mirror`。
- 公开检查会拒绝个人 home 路径、私人剪贴板引用及非隐私保护的提交邮箱。初始历史使用项目署名；后续贡献使用作者自己确认的 GitHub noreply 地址。
- 不上传 `v1-backup`、移动端、企业品牌、交付物、嵌套仓库、数据库、环境文件、证书、构建产物和个人日志。
- 依赖变更后运行 `npm run notices:update`，审核许可并提交锁文件和声明。不能只审计 `--omit=dev`，构建依赖同样影响发行安全。
- `CHANGELOG.md` 记录真实状态；现有 `2.0.1` 包版本不代表公开 tag 已发布。

## 首次推送需要维护者配置

以下依赖真实 GitHub 仓库/组织，不能在本地伪造完成：

- 确定 owner/repository、默认分支、公开时点，配置准确 `origin`。不要添加虚构 URL、徽章或 CODEOWNERS 账号。
- 确认提交作者信息可公开：检查 `git log --format=fuller`，需要时由作者选择 GitHub noreply 地址。
- 启用 Actions、依赖图、Dependabot、Secret scanning/Push protection（可用时）及 **Private vulnerability reporting**；确认 `Security → Report a vulnerability` 可见，再宣传该渠道。
- 设置默认分支 ruleset：PR 审核、必需 CI、阻止 force push；必需 job 名以首次运行结果为准。配置真实 CODEOWNERS、维护者双因素认证和支持渠道。
- 首次 CI 通过 Windows x64、macOS arm64/x64；本机 Windows 验证不能替代 macOS 验证。

确认后普通 `git push -u origin <默认分支>`；不要推送私有历史、备份分支或使用 `--all`/`--mirror`。本项目检查脚本不执行推送。

## CI 与正式发行不同

`OpenERX CI` 在 Windows 上执行无凭据源码检查，并保留 Windows x64、macOS arm64/x64 的打包/冒烟。暂不运行 Linux CI；签名发布流程的预检查也使用 Windows，测试、许可审核与发布审批要求不变。上传产物明确标为 **unsigned**，仅供测试，自动更新关闭；不自动创建 GitHub Release。

`npm run archive:package` 将当前平台开发包封装为保留 macOS 符号链接/权限的 `.tar.gz`，同时生成 `SHA256SUMS`。CI 只上传封装后的归档，避免直接上传 `.app` 目录破坏 framework 链接。校验和检测下载完整性，不等于代码签名或可信发布。

手动 `OpenERX signed release candidate` 使用 `production-release` environment 审批，只上传已签名候选包，不自动最终发布，也不代替更新清单签名或灰度验收。

## 签名、更新与人工验收

- Windows：`WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD`；有效代码签名证书和 `OPENERX_PROJECT_URL` 生产主页变量。
- macOS：`MAC_CERTIFICATE_BASE64`、`MAC_CERTIFICATE_PASSWORD`、`MAC_KEYCHAIN_PASSWORD`、`OPENERX_MAC_SIGN_IDENTITY`；公证还需 `APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。
- 更新：`OPENERX_UPDATE_MANIFEST_URL`、`OPENERX_UPDATE_KEY_ID`、`OPENERX_UPDATE_PUBLIC_KEY_BASE64`；实际 HTTPS 托管、对应私钥与受控签名流程。私钥不能进入源码或客户端。
- 核对 `.github/workflows/v2-release.yml` 中 secrets/vars 归属，为 environment 配置必需审批人。
- 完成 [第三方许可人工审核](../third-party/README.md)。`notices:release` 要求审核记录匹配当前清单，未完成时正式签名候选流程保持阻断。
- 实测干净安装、旧 profile 升级、卸载数据行为、自动化、Skill、记忆、权限、网络失败、重启和更新回滚。
- 保留项目 NOTICE、第三方许可和 Electron 自带 `LICENSE`、`LICENSES.chromium.html`，不得用项目 LICENSE 覆盖 Electron 的文件。
- 审核 [桌面发布门禁](RELEASE_GATES.md) 及人工验收；未批准项保持未批准，不为了发布改成通过。

## 参考

[GitHub runner 架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[Actions 最小权限与固定 SHA](https://docs.github.com/en/actions/reference/security/secure-use)、[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)、[MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。
