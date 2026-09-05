# 第三方许可审核

`notices.json` 与根目录 `THIRD_PARTY_LICENSES.txt` 由 `npm run notices:update` 生成。清单一致性通过不代表许可审核通过。

首次整理的 851 个锁定依赖路径中，25 条记录被标记 `review-required`（包含相同原生库的多个平台版本）：上游未附发行版对应许可文件，已记录可取得的上游许可/标准 SPDX 条款与来源，没有虚构版权归属。主要涉及部分 AWS SDK 子包、clipboard、Electron 内部解压工具和少量旧工具依赖。

审核者应：

1. 在 `notices.json` 中搜索 `review-required`，核对对应版本的源码、版权持有人、许可与 NOTICE，必要时向上游确认或替换依赖。
2. 核对 MPL 依赖的对应源码获取方式，以及 Electron 自带第三方许可；审核本项目代码/素材的发布权。
3. 如需补充声明，更新生成器/来源并重新生成，不能只手改生成文本。
4. 全部确认后，将 `review-status.json` 中 `approved` 改为 true，填写实际审核人、ISO 时间和 `notices.json` 文件的 SHA-256。该值必须匹配当前清单；依赖升级会使原审批失效。

`npm run notices:release` 在未批准或清单变更时阻止正式签名候选包流程。当前状态刻意保持未批准，不以自动检查代替人工确认。
