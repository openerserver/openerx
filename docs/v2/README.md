# OpenerX 2.0 产品合同包

> 状态：`PRODUCT_CONTRACT_APPROVED / IMPLEMENTATION_BOOTSTRAP_IN_PROGRESS`
>
> 修订日期：2026-08-25
>
> 当前效力：已批准的个人客户端产品合同；它描述目标而不是当前实现，不自动取代 `docs/current`。用户已明确授权开始实施准备，当前先建立新主线目录和可回滚的代码边界。

## 1. 当前已经确定的方向

1. `已确定`：对当前 OpenerX 进行完全重构。
2. `已确定`：主要用户仍是企业普通用户。
3. `已确定`：首个实现版本聚焦单个用户直接使用的个人客户端，体验形态参考 ChatGPT、WorkBuddy。
4. `已确定`：产品/团队负责人视角、组织协作和企业管理能力不进入首版，只保留为未来可能方向。
5. `已确定`：V1 首发为跨平台桌面客户端，使用桌面壳内嵌本地 Web UI。
6. `已确定`：V1 前端从 Vue 切换为 React + TypeScript。
7. `已确定`：桌面壳采用 Electron，Web UI 由 Vite 构建后打包进客户端。
8. `已确定`：V1 只支持 Windows 和 macOS，不考虑 Linux、移动端或其他平台。
9. `已确定`：V1 支持个人账户云同步和跨设备历史恢复。
10. `已确定`：V1 使用 OpenerX 平台统一提供的模型，不要求用户配置 API Key；用户可以明确选择平台模型。
11. `已确定`：V1 在 Token 使用记录基础上提供个人额度、费用、积分、充值、支付和账单完整闭环。
12. `已确定`：文件、工具和 Skill 按 Codex 桌面能力基线建设和验收。
13. `已确定`：Windows 支持 Windows 10 以上；“较新的 macOS”当前具体化为 macOS 14 及以上。

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
4. 旧 `docs/current`、`docs/product` 和其他历史方案。

## 4. 建议审阅顺序

1. [00-product-decision-review.md](00-product-decision-review.md)：集中修改和决策入口。
2. [01-product-contract.md](01-product-contract.md)：个人客户端定位、范围和非目标。
3. [02-users-and-scenarios.md](02-users-and-scenarios.md)：单用户画像和核心场景。
4. [03-experience-and-information-architecture.md](03-experience-and-information-architecture.md)：聊天主界面、导航和交互合同。
5. [04-domain-and-api-contract.md](04-domain-and-api-contract.md)：Conversation-first 领域模型。
6. [05-platform-and-runtime-contract.md](05-platform-and-runtime-contract.md)：客户端、工具层、Runtime 和 Pi 边界。
7. [06-security-and-governance-contract.md](06-security-and-governance-contract.md)：个人文件、凭证、工具权限和数据安全。
8. [07-migration-and-delivery-contract.md](07-migration-and-delivery-contract.md)：旧系统处置和 V1 阶段计划。
9. [08-acceptance-contract.md](08-acceptance-contract.md)：个人客户端验收门槛。
10. [09-golden-task-catalog.md](09-golden-task-catalog.md)：50 条端到端个人任务。
11. [10-codex-capability-baseline.md](10-codex-capability-baseline.md)：文件、工具与 Skill 的 Codex 对标矩阵。
12. [11-billing-and-commerce-contract.md](11-billing-and-commerce-contract.md)：个人额度、计费、积分、充值、支付、账单与对账合同。

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
| 模型与 Runtime 可替换 | 私有部署和组织级 Runtime 治理 |

未来能力不得以隐藏页面、预建复杂 Schema 或额外 V1 操作步骤的方式提前进入首版。

## 6. 生效与实施规则

产品合同范围已经批准，以下规则继续有效：

1. 产品名称、导航、账户、系统范围、Runtime 边界、权限、验收和商业规则均按 [00-product-decision-review.md](00-product-decision-review.md) 生效。
2. 积分兑换数字、充值档位/上下限和支付商户参数作为运营参数，在 Billing Alpha 前配置，在发布前冻结。
3. 用户已明确要求按本合同开始实施准备；本轮先建立目录骨架和实施记录，后续代码、数据库和基础设施修改仍按阶段退出条件推进。

旧 `docs/current`、旧控制平面和旧 Runtime 依赖继续作为受保护资产；新 V2 主线不得通过改名或覆盖旧路径进入生产。

## 7. 实施启动入口

目录骨架、旧资产保护边界和下一步顺序记录在 [12-implementation-bootstrap.md](12-implementation-bootstrap.md)。
