# Contributing to OpenERX

感谢参与 OpenERX。提交 Pull Request 前请：

请使用 GitHub 账户提供的 noreply 邮箱提交，避免个人邮箱进入公开历史。自动生成的项目基线使用 `OpenERX Contributors <noreply@openerx.invalid>`；这是无收件能力的项目署名，不是支持邮箱。仅设置当前仓库的 Git 身份，不更改全局身份或他人贡献的署名。

1. 从最新主分支创建短生命周期分支。
2. 保持改动聚焦，并为行为变化补充测试。
3. 运行 `npm run check:source`；桌面/打包相关改动另运行 `npm run package:v2` 和 `npm run check:package`。环境和可选测试见 [开发指南](docs/DEVELOPMENT.md)。
4. 不提交密钥、个人数据、构建产物、企业代码或第三方品牌素材。
5. 确认贡献可以按 Apache License 2.0 发布。

Bug 报告应包含复现步骤、预期行为、实际行为、操作系统和应用版本。涉及安全的问题不要创建公开 Issue，请使用仓库的私有安全报告渠道。

修改依赖后更新锁文件与 `npm run notices:update` 的第三方声明；修改内置 Skill 内容需提高基础版本并更新快照。提交 PR 时说明验证命令、实际结果、平台和未覆盖部分，不应把条件跳过的测试描述为实测通过。

请遵守 [行为准则](CODE_OF_CONDUCT.md)。贡献应为原创或已获相应授权，并保留第三方版权声明；提交贡献即表示允许按本项目 Apache-2.0 条款使用该贡献，不要求转让著作权。
