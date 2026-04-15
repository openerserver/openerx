# Historical: 模型付费设置改造 — 可执行任务清单

> 源方案：[model-paid-settings-replan.md](../../product/model-paid-settings-replan.md)
> 改造目标：把"模型是否付费 + 怎么收费"收敛到系统模型目录；把"项目能不能继续用"收敛到项目额度钱包。
> 状态更新（2026-04-14）：接口层收口已先行完成一部分：service `/:projectId/paid-execution-lease` 接口与 `project.settings.allowPaidExecution` 已删除，Dashboard governance 已去掉 `activeLeaseCount`，测试 helper 也不再使用 `ALLOW_PAID_MODEL_EXECUTION`。下文保留的 lease / allowPaidExecution 条目主要用于记录迁移路径与尚未完成的 DB 清理。

---

## Phase 1：模型目录增加计费字段

让管理员在模型管理页可以显式标记「是否付费 / 付费方式 / 价格」。

### 1.1 BFF — 扩展 ModelsConfig 类型

| 位置 | 改动 |
|---|---|
| [chat-settings/types.ts](../../../control-plane/web-ui-bff/src/modules/chat-settings/types.ts) | `ModelsConfig.list` 的元素类型从 `Record<string, unknown>` 收窄为带 billing 字段的显式接口 |

新增/扩展类型：

```ts
export interface ModelBillingPrice {
  currency: "USD";
  inputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  perRequestUsd?: number;
  perRunUsd?: number;
}

export type ModelBillingStatus = "free" | "paid";
export type ModelBillingMethod = "token_metered" | "request_metered" | "run_metered";

// list 元素接口（已有字段 + 新增 billing 字段）
export interface ModelListItem {
  route?: string;
  provider?: string;
  model?: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  // ─ new ──────────────────────
  billingStatus?: ModelBillingStatus;   // 默认 "free"
  billingMethod?: ModelBillingMethod;
  price?: ModelBillingPrice;
}
```

### 1.2 BFF — config-patch-applier 读写兼容

| 位置 | 改动 |
|---|---|
| [chat-settings/config-patch-applier.ts](../../../control-plane/web-ui-bff/src/modules/chat-settings/config-patch-applier.ts) `readModelsConfig()` | 读取 opencode.json 时，对 list 元素补充 `billingStatus ?? "free"` 默认值 |
| 同文件 patch 写入路径 | 确保写回 opencode.json 时序列化 billing 字段 |

### 1.3 BFF — paid-execution-guard 消费新字段

| 位置 | 改动 |
|---|---|
| [paid-execution-guard.ts](../../../control-plane/web-ui-bff/src/lib/paid-execution-guard.ts) `detectModelCostTier()` / `isFreeExecutionModelRoute()` | 改为先查 ModelsConfig.list 中对应模型的 `billingStatus`；找到则直接使用，找不到再 fallback 到原启发式逻辑 |

> Phase 4 时再彻底移除启发式分支；Phase 1 先做 "优先读配置" 的双源兼容。

### 1.4 Web-UI — Settings.vue 模型列表增加 billing 列

| 位置 | 改动 |
|---|---|
| [Settings.vue](../../../control-plane/web-ui/src/pages/Settings.vue) 模型列表表格 | 增加 3 列：「是否付费」Switch、「付费方式」Select、「价格配置」嵌套输入 |

交互规则：

- 「是否付费」关闭 → `billingStatus = "free"`，付费方式 & 价格 disabled
- 「是否付费」开启 → `billingStatus = "paid"`，显示付费方式下拉
- 付费方式选中后，按类型展示对应价格输入框：
  - `token_metered` → inputPerMillionTokens / outputPerMillionTokens
  - `request_metered` → perRequestUsd
  - `run_metered` → perRunUsd

### 1.5 Web-UI — api.ts 类型同步

| 位置 | 改动 |
|---|---|
| [api.ts](../../../control-plane/web-ui/src/lib/api.ts) | 新增 `ModelBillingPrice`, `ModelBillingStatus`, `ModelBillingMethod`, `ModelListItem` 类型，与 BFF types.ts 保持一致 |

### 1.6 验收标准

- [ ] 管理员在 Settings → 模型列表里可以把某个模型标记为 paid / free
- [ ] 标记后重新读 `readModelsConfig()` 返回对应 billing 字段
- [ ] `isFreeExecutionModelRoute()` 对已标记的模型优先采用配置值
- [ ] 没有标记 billing 的老模型行为不变（回退到启发式）

---

## Phase 2：新建项目额度钱包

把项目的"能不能用付费模型"从布尔开关改成余额扣减。

### 2.1 DB — 新增 project_model_funds 表

| 位置 | 改动 |
|---|---|
| [schema.pg.ts](../../../control-plane/service/src/db/schema.pg.ts) | 新增 `projectModelFunds` pgTable |
| `drizzle/0019_project_model_funds.sql` | 对应 DDL 迁移文件 |

表结构：

```sql
CREATE TABLE project_model_funds (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  currency       TEXT NOT NULL DEFAULT 'USD',
  total_granted  DOUBLE PRECISION NOT NULL DEFAULT 0,
  reserved       DOUBLE PRECISION NOT NULL DEFAULT 0,
  consumed       DOUBLE PRECISION NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_project_model_funds_project ON project_model_funds(project_id);
```

> `available = total_granted - reserved - consumed`，由查询时计算，不存物理列。

### 2.2 DB — 新增 project_model_fund_ledger 表

| 位置 | 改动 |
|---|---|
| [schema.pg.ts](../../../control-plane/service/src/db/schema.pg.ts) | 新增 `projectModelFundLedger` pgTable |
| 同 `0019_project_model_funds.sql` | 一并写入 |

表结构：

```sql
CREATE TABLE project_model_fund_ledger (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  fund_id          TEXT NOT NULL REFERENCES project_model_funds(id),
  type             TEXT NOT NULL,  -- grant | reserve | consume | refund | adjust
  amount_usd       DOUBLE PRECISION NOT NULL,
  balance_after    DOUBLE PRECISION NOT NULL,
  model_route      TEXT,
  task_id          TEXT,
  runtime_session_id TEXT,
  created_by       TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note             TEXT
);

CREATE INDEX idx_fund_ledger_project_time ON project_model_fund_ledger(project_id, created_at);
CREATE INDEX idx_fund_ledger_fund ON project_model_fund_ledger(fund_id);
```

### 2.3 DB — migration metadata 注册

| 位置 | 改动 |
|---|---|
| [migration/metadata.ts](../../../control-plane/service/src/db/migration/metadata.ts) | 在 `allTables` 和 `foreignKeys` 数组中注册新表 |

### 2.4 Service — 项目额度 CRUD 路由

| 位置 | 改动 |
|---|---|
| [service/projects/routes.ts](../../../control-plane/service/src/modules/projects/routes.ts) | 新增以下路由 |

新增路由：

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/fund` | 查询项目当前额度快照（含 available 计算） |
| POST | `/api/projects/:projectId/fund/grant` | 管理员给项目充值（写 grant 流水） |
| POST | `/api/projects/:projectId/fund/adjust` | 管理员手动调整余额（写 adjust 流水） |
| GET | `/api/projects/:projectId/fund/ledger` | 查询额度流水（分页） |

内部函数（不做路由，供执行流程调用）：

| 函数 | 说明 |
|---|---|
| `reserveFund(projectId, amountUsd, meta)` | 预留额度，写 reserve 流水，更新 reserved |
| `consumeFund(projectId, amountUsd, meta)` | 实际扣费，写 consume 流水，更新 consumed，释放对应 reserved |
| `refundReserve(projectId, amountUsd, meta)` | 退回未使用的预留部分，写 refund 流水 |

### 2.5 BFF — 项目额度代理路由

| 位置 | 改动 |
|---|---|
| [web-ui-bff/projects/routes.ts](../../../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 新增 BFF 代理路由，透传到 Service 层 |

新增路由：

| Method | Path |
|---|---|
| GET | `/:projectId/fund` |
| POST | `/:projectId/fund/grant` |
| POST | `/:projectId/fund/adjust` |
| GET | `/:projectId/fund/ledger` |

### 2.6 Web-UI — api.ts 类型 + 请求函数

| 位置 | 改动 |
|---|---|
| [api.ts](../../../control-plane/web-ui/src/lib/api.ts) | 新增 `ProjectModelFund`, `ProjectModelFundLedgerEntry` 类型；新增 `getProjectFund()`, `grantProjectFund()`, `adjustProjectFund()`, `getProjectFundLedger()` 请求函数 |

### 2.7 Web-UI — ProjectSettingsPanel.vue 替换预算区域

| 位置 | 改动 |
|---|---|
| [ProjectSettingsPanel.vue](../../../control-plane/web-ui/src/components/ProjectSettingsPanel.vue) | 删除「付费执行权限 / 月预算 / 预警阈值 / 限流阈值」表单区域；替换为「项目额度钱包」卡片 |

钱包卡片内容：

- 当前可用额度（total_granted − reserved − consumed）
- 已消耗 / 已预留 / 总充值
- 「充值」按钮 → 弹窗输入金额 → `grantProjectFund()`
- 「调整」按钮 → 弹窗输入调整金额 + 备注 → `adjustProjectFund()`

### 2.8 Web-UI — ProjectDetail.vue 替换预检区域

| 位置 | 改动 |
|---|---|
| [ProjectDetail.vue](../../../control-plane/web-ui/src/pages/ProjectDetail.vue) | 「付费执行预检」区域改为「额度钱包概览 + 最近消费记录」 |

展示内容：

- 可用额度 badge（绿色 / 黄色 / 红色，按 available 比例）
- 最近 N 条消费流水列表
- 不再显示：guardDecision card、lease 操作按钮、enable paid execution 开关

### 2.9 验收标准

- [ ] 项目详情页展示钱包余额，管理员可充值 & 调整
- [ ] 流水表正确记录每笔 grant / adjust
- [ ] `GET /fund` 返回 available = total_granted − reserved − consumed
- [ ] 旧 budget 字段仍保留但不再在 UI 上展示（兼容期）

---

## Phase 3：执行流程对接「估算→预留→扣费→退回」

把任务执行时的付费检查从「开关 + 租约 + guard」切换成「模型计费属性 + 钱包余额」。

### 3.1 BFF — 新建 model-billing.ts 计费估算模块

| 位置 | 改动 |
|---|---|
| `control-plane/web-ui-bff/src/lib/model-billing.ts` (新文件) | 从 paid-execution-guard.ts 提取并重写估算逻辑 |

核心函数：

```ts
/** 读取 ModelsConfig 获取模型计费信息 */
export function resolveModelBilling(modelRoute: string): ModelBillingInfo | null;

/** 根据 billingMethod + 执行 shape 估算费用区间 */
export function estimateExecutionCost(billing: ModelBillingInfo, shape: ExecutionShape): CostEstimate;

/** 检查项目钱包余额是否足够 + 预留 */
export async function reserveIfAffordable(
  projectId: string, estimateMax: number, meta: ReserveMeta
): Promise<{ ok: true; reservationId: string } | { ok: false; reason: string }>;

/** 执行结束后按实际消耗结算，退回多余预留 */
export async function settleExecution(
  projectId: string, reservationId: string, actualCostUsd: number
): Promise<void>;
```

### 3.2 BFF — tasks/routes.ts 执行入口切换

| 位置 | 改动 |
|---|---|
| [tasks/routes.ts](../../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) L35-37 import | 把 `isFreeExecutionModelRoute` 替换为 `resolveModelBilling` |
| 同文件 L1128 `isFree` 判断 | 改为 `resolveModelBilling(model)?.billingStatus === "free"` |
| 同文件旧的项目级 paid gate 布尔开关读取 | 删除；改为调用 `reserveIfAffordable()` |

新执行流程伪代码：

```
1. billing = resolveModelBilling(modelRoute)
2. if billing.billingStatus === "free" → 直接执行
3. estimate = estimateExecutionCost(billing, shape)
4. reservation = await reserveIfAffordable(projectId, estimate.max, meta)
5. if !reservation.ok → 返回 403 { reason: "项目额度不足" }
6. 执行任务 …
7. actualCost = 从 runtime usage 统计实际花费
8. await settleExecution(projectId, reservation.id, actualCost)
```

### 3.3 BFF — paid-execution-runtime.ts 结算集成

| 位置 | 改动 |
|---|---|
| `control-plane/web-ui-bff/src/lib/paid-execution-runtime.ts` `recordPaidExecutionRuntimeUsage()` | 在记录 runtime usage 之后，追加调用 `settleExecution()` 完成余额扣减 |

### 3.4 BFF — projects/routes.ts 已跳过 deprecated 过渡阶段

| 位置 | 现状 |
|---|---|
| [web-ui-bff/projects/routes.ts](../../../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 旧的项目级 lease / preflight 兼容路由已不在当前源码保留；继续收口时只需关注 fund 接口与 DB / 文档残留 |

### 3.5 Web-UI — 执行前预检 UI 简化

| 位置 | 改动 |
|---|---|
| [ProjectDetail.vue](../../../control-plane/web-ui/src/pages/ProjectDetail.vue) 执行预检卡片 | 「是否可执行」只读钱包余额；提示文案改为「额度充足 / 额度不足」 |
| [TaskDetailV3](../../../control-plane/web-ui/src/pages/TaskDetailV3.vue)（如有执行前提示） | 同步去除 lease/guard 相关 UI |

### 3.6 验收标准

- [ ] 免费模型执行路径不受影响
- [ ] 付费模型执行前自动预留成功 → 执行 → 结算 → 退回差额
- [ ] 余额不足时返回 403 且 UI 提示「额度不足」
- [ ] runtime_usage_ledgers 记录与 fund_ledger 流水金额一致
- [ ] 旧项目级 lease 路由在接口层保持不可访问，fund 路径与 task preflight 合同继续可用

---

## Phase 4：清理旧机制

移除所有已废弃的字段、路由、逻辑。

### 4.1 DB — 清理 ProjectSettings 废弃字段

| 位置 | 改动 |
|---|---|
| [schema.pg.ts](../../../control-plane/service/src/db/schema.pg.ts) `ProjectSettings` 接口 | 移除旧的付费执行布尔开关与预算兼容字段，仅保留当前 fund 相关语义 |
| [api.ts](../../../control-plane/web-ui/src/lib/api.ts) `ProjectSettings` 接口 | 同步移除 |
| Service projects/routes.ts `projectSettingsSchema` | 同步移除对应字段 |

> 写一个迁移脚本，把已有 project settings JSON 中的废弃 key 清除，避免脏数据残留。

### 4.2 DB — budget_configs 表迁移 / 废弃

| 位置 | 改动 |
|---|---|
| `drizzle/0020_retire_budget_configs.sql` | 如果不再需要旧 budget_configs 表，加 `ALTER TABLE budget_configs RENAME TO _budget_configs_deprecated;` 或 drop（根据数据保留策略决定） |
| migration/metadata.ts | 标记 budget_configs deprecated |

### 4.3 DB — paid_execution_leases 表废弃

| 位置 | 改动 |
|---|---|
| 与 4.2 同一个迁移文件 | `ALTER TABLE paid_execution_leases RENAME TO _paid_execution_leases_deprecated;` |

### 4.4 Service — 删除租约 & 预算路由

| 位置 | 改动 |
|---|---|
| [service/projects/routes.ts](../../../control-plane/service/src/modules/projects/routes.ts) | 2026-04-14 状态：项目级 lease 接口与 `getActivePaidExecutionLease()` 已从 service 接口层删除；后续只剩 budget / DB 表残留的清理 |

### 4.5 BFF — 删除旧路由 & guard 逻辑

| 位置 | 改动 |
|---|---|
| [web-ui-bff/projects/routes.ts](../../../control-plane/web-ui-bff/src/modules/projects/routes.ts) | 当前源码已不再保留项目级 lease / preflight 兼容路由 |
| [paid-execution-guard.ts](../../../control-plane/web-ui-bff/src/lib/paid-execution-guard.ts) | 移除以下导出 |

要从 paid-execution-guard.ts 删除的内容：

| 导出 | 类型 |
|---|---|
| `ModelCostTier` | type – 替换为 billingStatus |
| `detectModelCostTier()` | function – 不再需要启发式 |
| `POLICY_BY_COST_TIER` | const – 不再需要 |
| `buildModelExecutionPolicy()` | function – 不再需要 |
| `ModelExecutionPolicy` | interface – 不再需要 |
| `PaidExecutionLeaseRecord` | interface – 移至 deprecated |
| `PaidExecutionLeaseState` | interface |
| `PaidExecutionRequirements` | interface |
| `evaluatePaidExecutionPreflight()` | function |
| `createPaidExecutionGuardState()` | function |

保留（可留在此文件或已迁到 model-billing.ts）：

| 导出 | 说明 |
|---|---|
| `ExecutionEstimateRange` | 通用范围类型 |
| `PaidExecutionEstimate` (重命名为 `ModelCostEstimate`) | 估算结果 |
| `estimatePaidExecutionUsage()` (重命名为 `estimateExecutionCost`) | 估算函数 |

### 4.6 BFF — tasks/routes.ts 清理残留引用

| 位置 | 改动 |
|---|---|
| [tasks/routes.ts](../../../control-plane/web-ui-bff/src/modules/tasks/routes.ts) L35-37 | 删除 `isFreeExecutionModelRoute` import（Phase 3 已替换，此处只是确认删除） |
| 同文件 `recordPaidExecutionRuntimeUsage` import | 如果结算已内置到 model-billing.ts，删除此 import |

### 4.7 Web-UI — 清理前端类型 & 组件

| 位置 | 改动 |
|---|---|
| [api.ts](../../../control-plane/web-ui/src/lib/api.ts) | 删除 `PaidExecutionLeaseRecord`, `PaidExecutionRequirements`, `PaidExecutionLeaseStateResponse`, `ModelExecutionPolicy`, `GuardDecision` 类型 |
| [ProjectSettingsPanel.vue](../../../control-plane/web-ui/src/components/ProjectSettingsPanel.vue) | 确认无旧 paid gate / budget 表单残留 |
| [ProjectDetail.vue](../../../control-plane/web-ui/src/pages/ProjectDetail.vue) | 删除 `refreshPaidExecutionState()`, `enableProjectPaidExecution()`, `issueLease()`, `revokeLease()` 及对应 UI 区块 |

### 4.8 验收标准

- [ ] 活源码中的旧 paid gate / lease 兼容字符串只允许留在 deprecated、migration 或明确标注为历史方案的文档中
- [ ] 所有现有单元测试 & 集成测试通过
- [ ] Settings 页模型 billing 字段正常读写
- [ ] 项目额度钱包 CRUD + 流水正常
- [ ] 付费模型执行 → 预留 → 结算 → 退回流程端到端通过，且 Dashboard governance 不再暴露 `activeLeaseCount`

---

## 依赖关系总结

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
  模型目录      额度钱包      执行对接      清理旧代码
  billing字段   DB + API      估算→预留     删除废弃
```

Phase 1 和 Phase 2 可以**并行开发**（无数据依赖）。
Phase 3 依赖 Phase 1（模型计费信息）+ Phase 2（钱包 API）。
Phase 4 依赖 Phase 3 全部完成后才能安全清理。

---

## 文件变更矩阵

| 文件 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| `web-ui-bff/src/modules/chat-settings/types.ts` | ✏️ | | | |
| `web-ui-bff/src/modules/chat-settings/config-patch-applier.ts` | ✏️ | | | |
| `web-ui-bff/src/lib/paid-execution-guard.ts` | ✏️ | | | 🗑️ 大幅删除 |
| `web-ui-bff/src/lib/model-billing.ts` | | | 🆕 | |
| `web-ui-bff/src/lib/paid-execution-runtime.ts` | | | ✏️ | ✏️ |
| `web-ui-bff/src/modules/projects/routes.ts` | | ✏️ | ✏️ | 🗑️ 删旧路由 |
| `web-ui-bff/src/modules/tasks/routes.ts` | | | ✏️ | 🗑️ 删残留 |
| `service/src/db/schema.pg.ts` | | ✏️ | | ✏️ |
| `service/drizzle/0019_project_model_funds.sql` | | 🆕 | | |
| `service/drizzle/0020_retire_budget_configs.sql` | | | | 🆕 |
| `service/src/db/migration/metadata.ts` | | ✏️ | | ✏️ |
| `service/src/modules/projects/routes.ts` | | ✏️ | | 🗑️ 删旧路由 |
| `web-ui/src/pages/Settings.vue` | ✏️ | | | |
| `web-ui/src/lib/api.ts` | ✏️ | ✏️ | | 🗑️ 删旧类型 |
| `web-ui/src/components/ProjectSettingsPanel.vue` | | ✏️ | | ✏️ |
| `web-ui/src/pages/ProjectDetail.vue` | | ✏️ | ✏️ | 🗑️ 删旧 UI |

图例：✏️ 修改 | 🆕 新建 | 🗑️ 删除/大幅移除
