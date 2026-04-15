# 模型付费设置重规划方案

## 1. 目标

这次重规划只解决一件事：

- 把“模型是否付费、怎么收费、项目还能不能继续用”收敛成一条简单闭环。

用户提出的新方向是：

1. 哪些模型是付费模型，由管理员明确配置。
2. 付费方式由模型自己选择。
3. 项目使用付费模型时，靠“给项目分配费用额度”来限制使用，其他治理限制全部移除。

因此，这份方案不再沿用旧的“付费模型强约束治理”思路，不再把限制中心放在租约、环境变量开关、按 cost tier 的多层 guard 上，而是改成：

**模型目录定义计费属性，项目额度定义可用边界。**

## 2. 当前问题与根因

### 2.1 问题出在哪里

当前系统把“付费模型治理”拆散在了四层里：

1. 系统模型配置层
2. 项目设置层
3. BFF 预检/租约层
4. 成本预算层

这四层都碰了“付费模型限制”，但没有一个单一真值源。

### 2.2 根因是什么

根因不是字段不够，而是**产品抽象错位**：

1. 模型层没有显式的“是否付费/怎么收费”字段。
当前模型配置只有 provider、模型 ID、上下文窗口等基础信息，管理员还不能直接在模型目录里声明“这个模型是付费模型”以及“它按什么方式计费”。相关结构见 [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue) 和 [control-plane/web-ui/src/lib/api.ts](../../control-plane/web-ui/src/lib/api.ts)。

2. 付费属性是靠代码启发式推断的，不是靠后台配置。
当前 BFF 在 [control-plane/web-ui-bff/src/lib/paid-execution-guard.ts](../../control-plane/web-ui-bff/src/lib/paid-execution-guard.ts) 里通过模型路由字符串推断 `costTier`、`isPaid`，例如按 `gpt-4o`、`claude-sonnet`、`gpt-5` 等关键字分类。这意味着：
   - 管理员不能直接改
   - 新模型接入时容易误判
   - 产品规则实际被写死在代码里

3. 项目侧现在用的是“允许开关 + 预算阈值”，不是“可消费额度”。
当前项目设置里存在：
   - `allowPaidExecution`
   - `budgetMonthly`
   - `warnThreshold`
   - `throttleThreshold`

这些字段分别散落在 [control-plane/service/src/modules/projects/routes.ts](../../control-plane/service/src/modules/projects/routes.ts)、[control-plane/service/src/db/schema.pg.ts](../../control-plane/service/src/db/schema.pg.ts)、[control-plane/web-ui/src/components/ProjectSettingsPanel.vue](../../control-plane/web-ui/src/components/ProjectSettingsPanel.vue)。

问题在于：
   - `allowPaidExecution` 是布尔放行，不是消费控制。
   - `budgetMonthly` 更像预算参考值，不是“给项目可花的钱包”。
   - `warnThreshold` / `throttleThreshold` 是告警/限流阈值，不是项目可理解的余额机制。

4. BFF 又额外叠加了租约和预检路由。
当前还有：
   - `/projects/:projectId/paid-execution-lease`
   - `/projects/:projectId/paid-execution-preflight`

相关实现位于 [control-plane/web-ui-bff/src/modules/projects/routes.ts](../../control-plane/web-ui-bff/src/modules/projects/routes.ts)，并且任务执行前还会读取项目的 `allowPaidExecution` 再做一次判断，见 [control-plane/web-ui-bff/src/modules/tasks/routes.ts](../../control-plane/web-ui-bff/src/modules/tasks/routes.ts)。

这导致现在的限制路径变成：

- 模型像不像付费模型，由代码猜
- 项目是否允许付费，由布尔开关控制
- 某些模型还要租约
- 项目预算再额外做预警/限流/阻断

**最终问题是：管理员配置的不是“一个清晰的计费系统”，而是一组彼此叠加的开关和 guard。**

## 3. 新方案的设计原则

### 3.1 模型付费属性必须显式配置

“这个模型是不是付费模型”不能再靠模型名启发式判断，必须变成管理员可维护的数据。

### 3.2 计费方式必须挂在模型上

“怎么收费”是模型属性，不是项目属性，也不是 BFF 代码里的策略常量。

### 3.3 项目侧只保留一种业务限制

项目是否还能继续使用付费模型，只由“项目剩余额度是否足够”决定。

### 3.4 删除其他业务治理限制

以下旧机制不再作为业务限制：

- `allowPaidExecution`
- `paid execution lease`
- 按 `costTier` 的 allow / deny / require-approval
- `warnThreshold`
- `throttleThreshold`
- 测试环境强制白名单付费模型

保留的只应是技术兜底，例如：

- 模型不存在
- Provider 不可用
- 额度记录写入失败
- 运行时实际花费超过预留上界

### 3.5 预估还可以保留，但不再是第二套限制体系

执行前预估仍然有价值，但它只做两件事：

1. 给用户看预计花费。
2. 给系统做额度预留。

它不再承载“租约审批”“cost tier 降级”“并行 shape 审批”等额外产品约束。

## 4. 重规划后的目标模型

新方案拆成两个真值源：

1. 系统级模型目录
2. 项目级额度钱包

### 4.1 系统级模型目录

管理员在模型管理页维护每个模型的计费属性。

建议新增模型字段：

```ts
interface ModelCatalogItem {
  route: string;
  providerId: string;
  modelId: string;
  name: string;
  enabled: boolean;

  billingStatus: "free" | "paid";
  billingMethod?: "token_metered" | "request_metered" | "run_metered";

  price?: {
    currency: "USD";
    inputPerMillionTokens?: number;
    outputPerMillionTokens?: number;
    perRequestUsd?: number;
    perRunUsd?: number;
  };
}
```

其中：

- `billingStatus` 用来回答“哪些模型是付费模型”。
- `billingMethod` 用来回答“付费方式有哪些，模型可以选择哪一种”。
- `price` 是该模型对应的结算参数。

### 4.2 推荐支持的付费方式

第一阶段建议只支持 3 种付费方式，足够清晰，也足够覆盖大部分模型：

1. `token_metered`
按 token 扣费。适用于标准大模型 API，也是默认推荐方式。

2. `request_metered`
按请求次数固定扣费。适用于没有稳定 token 结算、但有固定调用成本的模型或内部代理。

3. `run_metered`
按一次执行固定扣费。适用于一个运行周期整体收费、而不是按单次请求收费的能力型模型。

免费模型则使用：

- `billingStatus = free`
- `billingMethod` 为空

不建议第一阶段就引入更多付费方式，例如 seat、包月套餐、租约包次、环境专属授权等，因为那会再次把问题复杂化。

## 5. 项目侧改成“额度钱包”

### 5.1 为什么不能继续沿用当前 budget 配置

当前 `budget_configs` 的语义是：

- 一个周期内的预算上限
- 到达某个比例后预警
- 再往上进入限流/阻断

这套机制适合“治理预算”，不适合“给项目分配费用并扣减”。

用户现在要的是：

- 给项目一笔钱
- 项目用掉就减少
- 不够就不能继续用付费模型

这本质上是**余额钱包**，不是**阈值预算**。

所以不建议继续把 `budget_configs` 当成未来主模型。

### 5.2 新的项目额度结构

建议新增项目级额度钱包：

```ts
interface ProjectModelFund {
  projectId: string;
  currency: "USD";
  totalGrantedUsd: number;
  reservedUsd: number;
  consumedUsd: number;
  availableUsd: number;
  status: "active" | "exhausted" | "disabled";
}
```

同时增加流水表：

```ts
interface ProjectModelFundLedger {
  id: string;
  projectId: string;
  type: "grant" | "reserve" | "consume" | "refund" | "adjust";
  amountUsd: number;
  modelRoute?: string;
  taskId?: string;
  runtimeSessionId?: string;
  createdBy?: string;
  createdAt: string;
  note?: string;
}
```

这样项目限制路径就会非常简单：

- 免费模型：不扣钱包，直接允许。
- 付费模型：先检查 `availableUsd`，够就预留，不够就拒绝。

## 6. 新的执行流程

### 6.1 统一执行判断

执行时不再先问“这个项目有没有 allowPaidExecution”，也不再问“当前有没有租约”。

新的判断流程应该是：

1. 解析本次实际要用的模型。
2. 去模型目录读取该模型的 `billingStatus` / `billingMethod` / `price`。
3. 如果是免费模型，直接执行。
4. 如果是付费模型，生成一次执行前费用预估。
5. 用预估上界去检查并预留项目额度。
6. 额度足够则执行。
7. 执行结束后按实际花费结算，多退少补。

### 6.2 预估与预留

建议保留执行前预估，但只作为“额度预留”用途：

```ts
interface ModelCostEstimate {
  estimatedMinUsd: number;
  estimatedMaxUsd: number;
  pricingSource: "token_metered" | "request_metered" | "run_metered";
}
```

判断规则：

- 若 `availableUsd < estimatedMaxUsd`，拒绝执行，提示“项目额度不足”。
- 若 `availableUsd >= estimatedMaxUsd`，先预留 `estimatedMaxUsd`。
- 实际运行结束后：
  - 扣减真实消耗
  - 退回未使用的预留差额

这能避免两类问题：

1. 运行前余额看起来够，但实际执行后超支。
2. 只按实际记账，无法在运行前阻止明显不够的请求。

### 6.3 计费计算规则

不同付费方式的计算建议如下：

#### 1. `token_metered`

```ts
costUsd = inputTokens / 1_000_000 * inputPerMillionTokens
        + outputTokens / 1_000_000 * outputPerMillionTokens
```

#### 2. `request_metered`

```ts
costUsd = requestCount * perRequestUsd
```

#### 3. `run_metered`

```ts
costUsd = perRunUsd
```

## 7. 管理端与项目端的产品调整

### 7.1 管理员模型配置页

在 [control-plane/web-ui/src/pages/Settings.vue](../../control-plane/web-ui/src/pages/Settings.vue) 的模型列表里增加三列：

1. 是否付费
2. 付费方式
3. 价格配置

推荐交互：

- “是否付费”是开关
- 开启后才显示“付费方式”下拉
- 选中付费方式后展示对应价格输入框

例如：

- token 计费：输入 input / output 单价
- request 计费：输入每次请求单价
- run 计费：输入每次运行单价

### 7.2 项目设置页

项目设置页 [control-plane/web-ui/src/components/ProjectSettingsPanel.vue](../../control-plane/web-ui/src/components/ProjectSettingsPanel.vue) 需要从现在的“布尔放行 + 月预算阈值”改成“项目额度钱包”：

删除：

- 付费执行权限
- 月预算
- 预警阈值
- 限流阈值

替换为：

- 当前可用额度
- 已消耗额度
- 最近一次充值/调整
- 手动增减额度入口

### 7.3 项目详情页

项目详情页 [control-plane/web-ui/src/pages/ProjectDetail.vue](../../control-plane/web-ui/src/pages/ProjectDetail.vue) 里的“付费执行预检”区域需要同步简化：

删除：

- 租约状态
- 开启执行许可
- 开启项目付费执行权限
- guardDecision 对应的 allow / require-approval / deny 文案

保留并改造为：

- 生效模型
- 本次预计花费
- 项目剩余额度
- 是否可执行
- 最近付费模型消费记录

核心提示文案从“缺少授权/缺少租约/建议降级”改为：

- “项目额度不足，无法执行该付费模型”
- “项目额度充足，可以继续执行”

## 8. 需要下线或废弃的旧能力

新方案落地后，以下能力应进入废弃列表：

### 8.1 项目设置字段

应废弃：

- `allowPaidExecution`
- `budgetMonthly`
- `budgetConfigId`
- `warnThreshold`
- `throttleThreshold`

### 8.2 BFF 路由

应废弃：

- `/projects/:projectId/paid-execution-lease`
- `/projects/:projectId/paid-execution-preflight`

### 8.3 BFF 付费 guard 逻辑

[control-plane/web-ui-bff/src/lib/paid-execution-guard.ts](../../control-plane/web-ui-bff/src/lib/paid-execution-guard.ts) 需要从“策略决策器”降级为“计费估算器”，最终移除以下职责：

- 启发式 `costTier` 判断
- `requiresExplicitGate`
- `requiresLease`
- `allowJudge` / `allowHooks` 的付费治理限制
- `defaultDecision = deny | require-approval`

保留的只应是：

- 模型计费信息解析
- 估算成本
- 生成额度预留请求

## 9. 推荐落地顺序

### Phase 1: 建立显式计费模型

目标：让管理员先能配置“哪些模型付费、怎么收费”。

改动：

- 扩展 `ModelsConfig` 结构
- 模型管理页增加计费字段
- 保存并读取新字段
- 保留旧执行路径不变

### Phase 2: 建立项目额度钱包

目标：把项目侧限制中心切到额度钱包。

改动：

- 新增 `project_model_funds`
- 新增 `project_model_fund_ledger`
- 增加项目充值/扣减/退款接口
- 项目页展示额度余额

### Phase 3: 执行链路切换

目标：让付费模型的唯一限制变成项目额度检查。

改动：

- 执行前改为“估算 -> 预留 -> 执行 -> 结算”
- 删除租约、显式付费开关、cost tier deny 逻辑
- 项目详情页和设置页同步换 UI

### Phase 4: 兼容收尾

目标：移除旧抽象，减少未来维护成本。

改动：

- 删除 `allowPaidExecution` 相关字段与测试
- 删除 lease/preflight 路由
- 将 `budget_configs` 回收到历史兼容用途，或迁移后下线

## 10. 最终决策总结

这次重规划后的最终方案应当明确成下面四条：

1. 付费模型不再由代码猜，而是由管理员显式配置。
2. 付费模型支持 3 种付费方式：按 token、按请求、按运行。
3. 项目是否还能继续使用付费模型，只由项目额度余额决定。
4. 租约、显式 paid 开关、cost tier 风险 guard、预算预警/限流都不再作为业务限制。

换句话说，未来的产品语义应该从：

- “这个模型贵不贵，要不要过额外审批”

切换成：

- “这个模型怎么收费，项目还有没有钱继续用”

这才是与当前需求一致、并且能长期稳定演进的抽象。