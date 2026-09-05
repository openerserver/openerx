# 公共技术参考

本目录保留通用技术设计、架构决策和合成测试映射。历史产品合同、内部审批、移动产品说明及私人执行记录已移出公开树。当前范围以 [公共架构](../ARCHITECTURE.md)、[开发指南](../DEVELOPMENT.md) 和 [桌面发布门禁](../RELEASE_GATES.md) 为准。

## 技术设计

- [架构决策记录](adr/README.md)
- [本地安全边界](security/electron-threat-model.md)
- [浏览器操作设计](17-browser-computer-use-plan.md) 与 [合同测试](18-browser-computer-use-contract-test-plan.md)
- [受控 Shell 设计](19-pi-bash-brokered-execution-plan.md) 与 [执行方案](20-pbash-implementation-plan.md)
- [本地搜索](21-local-web-search-plan.md)
- [BYOK 独立运行](22-standalone-byok-deployment.md)
- [自动化](22-codex-style-automation-execution-plan.md)
- [记忆设计](23-codex-style-memory-plan.md) 与 [方法](24-memory-system-method.md)
- [Pi Runtime 更新设计](25-pi-runtime-remote-update-plan.md)
- [个人项目](26-personal-projects-plan.md)

设计文档包含历史方案或尚未实现的计划，不等于当前版本的功能和安全保证。实际行为以源码、合同测试及新版本验证结果为依据；发现不一致时应更新文档。

## 测试资料

[evidence/golden/local-implementation/](evidence/golden/local-implementation/) 和 [evidence/lws-probes/](evidence/lws-probes/) 是现有公共测试使用的映射/输入。它们不是手机真机、商户验收或生产发布批准。新增原始执行日志应存于被忽略的本地输出目录，审核脱敏后才能转成公开测试输入。
