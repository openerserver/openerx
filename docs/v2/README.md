# OpenerX 2.0 产品合同包

> 状态：`PRODUCT_CONTRACT_APPROVED / IMPLEMENTATION_IN_PROGRESS`
>
> 修订日期：2026-08-26
>
> 当前效力：已批准的个人客户端产品合同和实施边界。用户已授权重构；M1、Pi Foundation、M2
> 至 M8 本地实现检查点已完成，M8 外部 Beta 证据正在补齐；新主线只在 `apps/`、`services/` 和
> `packages/` 推进。

## 1. 当前已经确定的方向

1. `已确定`：对当前 OpenerX 进行完全重构。
2. `已确定`：主要用户仍是企业普通用户。
3. `已确定`：首个实现版本聚焦单个用户直接使用的个人客户端，体验形态参考 ChatGPT、WorkBuddy。
4. `已确定`：产品/团队负责人视角、组织协作和企业管理能力不进入首版，只保留为未来可能方向。
5. `已确定`：V1 首发为跨平台桌面客户端，使用桌面壳内嵌本地 Web UI。
6. `已确定`：V1 前端从 Vue 切换为 React + TypeScript。
7. `已确定`：桌面壳采用 Electron，Web UI 由 Vite 构建后打包进客户端。
8. `已确定`：V1 的执行主机只支持 Windows 和 macOS；同时发布 iOS/Android Remote Companion 作为手机控制面，不在移动端运行 Pi 或本地工具。
9. `已确定`：V1 支持个人账户云同步和跨设备历史恢复。
10. `已确定`：V1 使用 OpenerX 平台统一提供的模型，不要求用户配置 API Key；用户可以明确选择平台模型。
11. `已确定`：V1 在 Token 使用记录基础上提供个人额度、费用、积分、充值、支付和账单完整闭环。
12. `已确定`：文件、工具和 Skill 按 Codex 桌面能力基线建设和验收。
13. `已确定`：Windows 支持 Windows 10 以上；“较新的 macOS”当前具体化为 macOS 14 及以上。
14. `已确定`：V1 的 agent harness 完全由维护中的 Pi 提供；V2 只实现宿主、产品投影和能力/权限 Broker，不重复实现 Agent Loop、Session、压缩、重试或工具调用生命周期。
15. `已确定`：V1 提供 Codex Remote 同类远程能力；手机可开始、Queue、Steer、Stop、审批和审阅桌面任务，桌面保持唯一执行面。

这里的“个人客户端”表示产品围绕单个用户的对话、文件、工具、历史和个人成果展开；用户可能处于企业工作环境，但首版不要求企业先完成组织部署、角色配置或团队治理。

## 2. 版本术语

- `OpenerX 2.0`：本次完全重构计划的总称。
- `V1`：2.0 的首个可用版本，即个人 AI 客户端。
- `Future Enterprise`：未来可能增加的产品/团队负责人、组织、团队知识、管理员治理和企业级部署能力。

## 3. 文档标记

- `已确定`：来自用户已经明确表达的要求。
- `已确认`：已经纳入获批产品范围；修改时需要同步更新相关合同。
- `运营参数`：不改变产品范围，但必须在发布前配置和验证。

冲突优先级：

1. 用户最新明确决定。
2. [00-product-decision-review.md](00-product-decision-review.md) 中已确认事项。
3. 本合同包专项文档。
4. `v1-backup/docs/current`、`v1-backup/docs/product` 和其他历史方案。

## 4. 建议审阅顺序

1. [00-product-decision-review.md](00-product-decision-review.md)：集中修改和决策入口。
2. [01-product-contract.md](01-product-contract.md)：个人客户端定位、范围和非目标。
3. [02-users-and-scenarios.md](02-users-and-scenarios.md)：单用户画像和核心场景。
4. [03-experience-and-information-architecture.md](03-experience-and-information-architecture.md)：聊天主界面、导航和交互合同。
5. [04-domain-and-api-contract.md](04-domain-and-api-contract.md)：Conversation-first 领域模型。
6. [05-platform-and-pi-contract.md](05-platform-and-pi-contract.md)：客户端、Pi-owned harness、能力 Broker 与产品投影边界。
7. [06-security-and-governance-contract.md](06-security-and-governance-contract.md)：个人文件、凭证、工具权限和数据安全。
8. [07-migration-and-delivery-contract.md](07-migration-and-delivery-contract.md)：旧系统处置和 V1 阶段计划。
9. [08-acceptance-contract.md](08-acceptance-contract.md)：个人客户端验收门槛。
10. [09-golden-task-catalog.md](09-golden-task-catalog.md)：50 条端到端个人任务。
11. [10-codex-capability-baseline.md](10-codex-capability-baseline.md)：文件、工具与 Skill 的 Codex 对标矩阵。
12. [11-billing-and-commerce-contract.md](11-billing-and-commerce-contract.md)：个人额度、计费、积分、充值、支付、账单与对账合同。
13. [12-implementation-bootstrap.md](12-implementation-bootstrap.md)：V2 新主线目录和旧资产保护边界。
14. [13-development-plan.md](13-development-plan.md)：里程碑、依赖、首个迭代、质量门禁和风险清单。
15. [14-overall-architecture.md](14-overall-architecture.md)：V2 总体逻辑架构、主链路、信任边界和数据真值。
16. [15-remote-control-contract.md](15-remote-control-contract.md)：iOS/Android 手机控制面、桌面执行主机、Pi 映射和远程安全合同。
17. [adr/README.md](adr/README.md)：M0 已冻结的工程与安全架构决策。
18. [security/electron-threat-model.md](security/electron-threat-model.md)：Electron 和本地 App Service 威胁模型。
19. [evidence/m0-2026-08-25.md](evidence/m0-2026-08-25.md)：M0 检查点命令、结果和残余风险。
20. [evidence/pi-foundation-2026-08-25.md](evidence/pi-foundation-2026-08-25.md)：Pi Foundation 的实现、测试、打包与边界证据。
21. [evidence/m2-2026-08-25.md](evidence/m2-2026-08-25.md)：M2 账户、同步、平台模型、Token 与 Remote 合同检查点证据。
22. [evidence/m3-2026-08-25.md](evidence/m3-2026-08-25.md)：M3 服务端计费、账本、支付和账单检查点证据。
23. [evidence/m4-2026-08-26.md](evidence/m4-2026-08-26.md)：M4 文件、成果、云对象与 Pi Session 恢复检查点证据。
24. [evidence/m5-2026-08-26.md](evidence/m5-2026-08-26.md)：M5 工具、权限、MCP 与长任务检查点证据。
25. [evidence/m6-2026-08-26.md](evidence/m6-2026-08-26.md)：M6 手机控制面、配对、E2EE、Remote Gateway、Connector 与 Pi 映射检查点证据。
26. [evidence/m7-2026-08-26.md](evidence/m7-2026-08-26.md)：M7 Pi-native Skill 包、生命周期、Broker 与同步检查点证据。
27. [evidence/m8-2026-08-26.md](evidence/m8-2026-08-26.md)：M8 本地 Personal Beta 基础与真实 DeepSeek/服务端 Charge 首个外部切片证据。

## 5. V1 与未来方向边界

| V1 必须做好 | Future Enterprise 可能增加 |
| --- | --- |
| 新对话、流式回答、停止和重试 | 企业组织与成员目录 |
| 对话历史、搜索、重命名和删除 | 产品/团队负责人工作台 |
| 个人账户云同步、设备恢复和同步状态 | 组织目录、SSO、SCIM 和管理员身份治理 |
| 文件上传、个人资料和上下文选择 | 团队知识库和权限继承 |
| Web 搜索、隔离浏览器、Shell、桌面控制、MCP 与权限确认 | 组织级连接器、策略和审批 |
| 内置、个人及工作区 Skill 的安装、使用与设置 | 管理员控制台和组织级 Skill 分发 |
| 个人成果预览、下载和再次使用 | 团队共享、评论和发布流程 |
| 平台统一模型、显式选模、Token、个人额度/积分、充值和账单 | 组织预算中心、企业授信账期和私有模型治理 |
| 模型可替换、Pi 版本可在宿主边界内升级 | 私有部署和组织级能力治理 |
| iOS/Android 远程发起、Queue、Steer、Stop、审批和审阅桌面任务 | 云端代跑、远程唤醒和无人值守桌面登录 |

未来能力不得以隐藏页面、预建复杂 Schema 或额外 V1 操作步骤的方式提前进入首版。

## 6. 生效与实施规则

产品合同范围已经批准，以下规则继续有效：

1. 产品名称、导航、账户、系统范围、Pi 边界、权限、验收和商业规则均按 [00-product-decision-review.md](00-product-decision-review.md) 生效。
2. 积分兑换数字、充值档位/上下限和支付商户参数作为运营参数，在 Billing Alpha 前配置，在发布前冻结。
3. 实现按 [13-development-plan.md](13-development-plan.md) 的阶段退出条件推进；M8 本地检查点与
   真实 DeepSeek Usage→服务端 Charge 首个切片已完成，不设置旧执行引擎迁移阶段。真实 SSE/Stop、
   Provider 对账、Remote 真机/生产推送、支付沙箱、属地合规和原生发布矩阵证据仍按发布 Gate 补齐。

`v1-backup/` 中的旧文档、旧控制平面和旧执行引擎依赖继续作为受保护资产；新 V2 主线不得从备份目录导入模块，或通过旧页面改名冒充完成。

## 7. 实施启动入口

目录骨架和旧资产保护边界记录在 [12-implementation-bootstrap.md](12-implementation-bootstrap.md)，可执行阶段计划记录在 [13-development-plan.md](13-development-plan.md)，最新整体架构图见 [14-overall-architecture.md](14-overall-architecture.md)，手机远程控制边界见 [15-remote-control-contract.md](15-remote-control-contract.md)。
