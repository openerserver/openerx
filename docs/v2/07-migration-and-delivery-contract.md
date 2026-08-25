# V1 迁移与交付合同

> 状态：`APPROVED_PRODUCT_SCOPE / V1_ARCHIVED / IMPLEMENTATION_AUTHORIZED`
>
> 合同类型：从旧企业控制平面切换到个人客户端的资产处置、阶段计划和回滚

## 1. 迁移原则

1. 个人客户端是新产品，不把旧 Dashboard、Project、Task、AgentOps 页面改名后继续使用。
2. 优先复用基础技术和经过验证的 Runtime 行为，不复用旧用户心智。
3. 先建立桌面聊天骨架，再并行建设账户/模型与个人商业平台，随后接文件、Codex 级工具、Skill 和复杂任务。
4. 产品/团队负责人和企业治理能力不进入 V1 迁移清单。
5. 旧平台保留可恢复快照，未经批准不删除。

## 2. 当前工作区保护

2026-08-25 已先通过提交 `d4cc116` 建立可恢复 checkpoint，随后按用户授权把旧系统整体移动到 `v1-backup/`。移动只改变路径，不删除源码或本地运行状态。

实施前必须：

- V2 新代码只进入 `apps/`、`services/` 和 `packages/`。
- 旧系统从 `v1-backup/` 恢复或运行时，使用独立依赖、数据库和端口。
- 不使用破坏性 Git 操作清理备份资产。
- 复用旧实现前先提取合同和测试，不直接从备份目录 import。

## 3. 现有资产处置

| 资产 | V1 默认处置 |
| --- | --- |
| Vue 3 | 退出 V1 前端主线；旧页面仅作行为参考 |
| Vite | 保留为 React Renderer 构建工具候选 |
| Ant Design Vue | 不迁移；React 组件库另行选择 |
| Electron | 新增跨平台桌面壳、打包、更新和系统集成 |
| React + TypeScript | 新建 Renderer 前端体系 |
| PostgreSQL | 作为账户、同步元数据、模型目录、Token/费用、不可变账本和支付订单的云端候选；桌面缓存仍使用本地存储 |
| 现有认证 | 按个人账户、设备会话和云同步要求重新评估；不直接继承旧组织角色语义 |
| TaskDetail 对话与流式经验 | 转化为 Message/Conversation 测试参考 |
| task artifacts 经验 | 转化为个人 Artifact/ArtifactVersion |
| Runtime Provider 测试 | 转化为 Runtime Adapter 验收用例 |
| Control Plane Service/BFF | 不作为 V1 产品边界，选择性提取基础能力 |
| service-go | 默认退出 V1 主线 |
| Dashboard、Projects、AgentOps、审批页 | 不进入 V1 员工界面 |
| 旧 pi-mono 源码树 | 退出运行依赖，改用维护中的包 |
| opencode-fork、claude-code-main | 归档或移出主产品依赖 |
| 旧任务和运行记录 | 默认只读保留，不迁入新 Conversation 主表 |

## 4. 数据迁移

V1 默认不做大规模旧数据迁移。

| 旧数据 | 默认策略 |
| --- | --- |
| 用户账户 | 仅在确定云账户后映射有效个人账户 |
| Projects/Organizations | 不迁入 V1 主域 |
| Tasks | 只读历史；可选择性导出文本和成果 |
| Task Messages | 不自动转换为个人对话，除非能保证顺序和语义 |
| Task Artifacts | 用户明确选择后导入个人成果区 |
| Runtime Sessions/Runs | 不迁移，只保留诊断或审计快照 |
| Provider 配置 | 不迁入桌面端；V1 改为平台统一模型和服务端凭证 |
| Skills/MCP | 迁移安装清单前重新验证兼容性，每台设备重新授权 |
| 旧额度、余额或费用数据 | 默认不迁入；只有来源、金额、币种和账本平衡可验证时才通过专项迁移导入 |

## 5. 交付阶段

账户云同步、平台模型、Token/计费、额度/积分、充值/支付/账单及 Codex 文件、工具、Skill 基线都已进入 V1，原 12 至 16 周估算失效。

`已确认规划基线`：6 至 8 人具备桌面、安全、云同步、支付计费和 Agent Runtime 经验的团队约 24 至 32 周；若只有 4 至 6 人，按 32 至 42 周规划。该估算允许账户/商业平台与桌面骨架并行，仍需在技术 Spike、支付渠道和属地合规确认后重估。

### Phase 0：产品决策，1 至 2 周

- 冻结 Windows 10 22H2+/macOS 14+ 的 CPU 架构矩阵、匿名/离线模式、保留周期和工具默认授权策略。
- 完成 Electron、React、Vite、打包签名和更新 ADR。
- 固化账户同步、平台模型、Token/费用、额度/积分、充值/账单和 Codex 能力兼容合同。
- 固化人民币结算、额度单位、扣减顺序、不透支、支付宝+微信支付、退款和非订阅边界；积分具体兑换数值作为上线配置参数。
- 完成聊天主界面原型。
- 确认 50 条黄金任务和固定测试数据。
- 封存旧工作区。

退出条件：用户明确授权实施。

### Phase 1：Electron + React 客户端骨架，2 至 3 周

- Electron Main、Preload Bridge 和 React Renderer。
- 新对话、历史、搜索、设置壳。
- Conversation/Message 存储。
- Fake Runtime 流式、停止、失败和重试。
- Windows 和 macOS 安装包及安全基线测试。

退出条件：无需文件和工具即可稳定完成日常聊天闭环。

### Phase 2：账户、云同步、平台模型与 Token，4 至 5 周

- 个人账户、设备会话、登录/退出和系统凭证库。
- Sync Adapter、云端 revision/游标、离线队列、冲突和删除墓碑。
- Model Catalog、Platform Model Gateway、明确选模和实际模型记录。
- 消息/对话/账户 Token 使用记录、价格目录骨架及账户用量页。
- 两账户隔离、设备撤销、Token 去重和 Windows/macOS 跨设备恢复。

退出条件：同一账户可以在两台支持设备恢复聊天，模型与 Token 记录可核对，跨账户访问为零。

### Phase 3：个人计费、充值与账单，5 至 7 周

- Price Catalog、报价、价格快照、费用预留和按真实 Token 结算。
- QuotaGrant、PointGrant、CashBalanceAccount 和追加式复式账本。
- 额度/积分/余额扣减、过期、退款、冲正和有审计的人工调账。
- 支付宝与微信支付充值订单、托管收银台、验签回调、查单、退款和每日对账。
- 用量/费用页、充值页、账单页、月度 CSV/PDF 明细和跨设备只读快照。
- 重复回调、重复请求、服务重启、支付成功未入账、失败误入账和对账差异测试。
- 完成上线地区的支付、税务、隐私和数据保留审查。

退出条件：[11-billing-and-commerce-contract.md](11-billing-and-commerce-contract.md) 的个人商业闭环和所有资金硬门禁通过，测试资金可以逐笔重建且没有重复扣费/入账。

### Phase 4：真实 Runtime、文件与成果，3 至 4 周

- 维护中的 Pi Adapter 或批准的首个 Runtime。
- 平台模型目录和明确选择接入 Runtime Adapter。
- 文件/文件夹授权、解析、引用、云副本和个人文件区。
- DOCX、XLSX、PPTX、PDF、图片和 HTML 的创建/编辑/预览/版本。
- 真实流式、停止、长上下文和错误恢复。

退出条件：非研发用户独立完成文件问答和成果闭环，并在另一设备恢复成果。

### Phase 5：Codex 工具与长任务，5 至 6 周

- Tool Gateway、沙箱、权限卡片和统一工具记录。
- 第一方 Web 搜索、隔离浏览器、本地 Web 预览。
- Shell/代码执行、长进程和受控桌面应用操作。
- STDIO/Streamable HTTP MCP、Bearer/OAuth 和连接管理。
- WorkItem、ExecutionRun 和持久化事件。
- 离开对话后继续、恢复和取消。

退出条件：TOOL-01 至 TOOL-10 在 Windows 和 macOS 达到安全和可靠性门禁。

### Phase 6：Skill 系统与能力对齐，3 至 4 周

- `SKILL.md`、scripts、references、assets 与依赖声明。
- 内置、个人和工作区 Scope；显式/自动触发和渐进加载。
- 安装、更新、权限复核、账户安装记录同步、禁用和卸载。
- Codex 能力基线缺口关闭和固定兼容测试。

退出条件：FILE、TOOL、SKILL 全部能力行都有双平台端到端证据。

### Phase 7：个人 Beta，3 至 4 周

- 5 至 20 名个人用户试用。
- 启动、历史、搜索、数据清理和诊断完善。
- 安全、性能和高频失败修复。
- 50 条黄金任务达到 Beta 门槛。

退出条件：用户批准 V1 发布或继续迭代。

## 6. 功能开关

V1 建议使用本地/账户级功能开关控制：

- 新聊天客户端入口。
- 真实 Runtime。
- 文件和成果。
- 高风险工具。
- Skill/MCP 分批启用。
- 云同步迁移或紧急只读模式。
- 收费执行紧急只读/停止开关；不得通过关闭记录来继续产生无法结算的用量。
- 充值渠道独立开关；关闭渠道不能改变已有订单、余额或账本。

不使用 Organization 级灰度作为 V1 前置。功能开关只用于开发和分批发布；账户云同步及 [10-codex-capability-baseline.md](10-codex-capability-baseline.md) 锁定能力在 V1 Release 中必须可发现并通过，不得以关闭开关冒充完成。

## 7. 回滚

每阶段必须保留：

- 可回滚应用版本。
- 向前兼容的数据迁移窗口。
- 活动 Run 停止或排空方式。
- Conversation 和 Artifact 备份/导出路径。
- 关闭实验工具而不删除历史的方法。
- 价格目录和支付渠道回滚方案；已生效价格快照和已入账账本不可随代码回滚而回写或删除。

回滚代码不得自动删除用户的个人历史、成果、支付订单、账本和账单。

## 8. 文档切换

- `v1-backup/docs/current` 继续描述旧平台事实。
- `docs/v2` 在批准前只描述个人客户端目标。
- V1 实施后，每个合同标记“未实现、部分实现、已实现”。
- V1 发布后，旧成员优先和企业控制平面前台方案进入 archive。
- Future Enterprise 仍保持未来提案，不冒充 V1 能力。
