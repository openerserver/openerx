# 公共核心测试与证据

## 可复现检查

```sh
npm ci
npm run check:source
npm run check:release-graph:v2
npm run check:release:v2
npm run package:v2
npm run check:package
```

源码检查不需要真实模型或商户凭据；联网模型评测、平台 E2E 和系统交互测试是单独的可选流程。没有相应系统沙箱时，真实执行测试明确跳过，能力不可用和拒绝授权的合同测试仍保留。任何发布结论都应记录实际版本、平台和执行结果。

## 测试输入与历史记录

- `tests/v2/golden/catalog.json` 冻结 50 个合成任务，配套的账户、文件、工具、Skill 和可选账本测试验证公共合同。
- `docs/v2/evidence/golden/local-implementation/` 保留这些公共任务的本地验证映射，不代表生产付款、手机真机或正式发行验收。
- `docs/v2/evidence/lws-probes/` 是搜索探针历史输入；测试依赖其 Schema 和日期状态，不需要实时网络。
- PDF、Office、图片和 HTML fixture 是生成的固定样例，不是客户业务文件。测试中的假密钥、号码和路径用于验证脱敏与拒绝规则。
- 内部决策、人力工期、移动产品说明和原始执行报告不属于公开测试输入，在企业资料归档维护。

## 个人项目回归映射

项目功能的公开回归包括存储事务与迁移、App Service、目录授权、上下文隔离和 Renderer 交互：

- `packages/storage/tests/`：项目、目录绑定、主目录、墓碑与恢复。
- `packages/app-service/tests/`：项目 CRUD、上下文与权限边界。
- `apps/desktop/tests/chat-ui.test.tsx`：项目和对话的界面交互。
- `apps/desktop/scripts/e2e-projects.mjs`：可选的 Electron 集成验证。

这份映射替代私人逐日执行记录作为公开可追溯入口，但不替代测试执行本身，也不将尚未完成的原生验收标记为通过。当前验证快照见 [验证记录](RELEASE_VALIDATION.md)。

## 正式桌面发布

公共桌面版的待验收事项见 [发布门禁](RELEASE_GATES.md)。移动商店、企业支付渠道及企业交付验收由私有仓库负责，不是 BYOK 桌面版发布的前置。
