# 任务详情页角色评审与开发者修正请求方案

> 适用范围：OpenerX 任务详情页 / Task Workbench
>
> 状态：Future target draft，当前实现尚未落地
>
> 目标：在现有任务详情页和工作台演进方向上，增加角色结论、冲突和开发者修正请求视图，让用户能看清当前任务处于什么阶段、哪些辅助角色提出了什么问题、开发者还需要修什么

## 0. 文档定位

这份文档属于 TaskDetail role-review 能力的“未来目标 UI 方案”，不是当前 TaskDetailV3 的现网说明。

1. 当前实现：当前任务详情主页面已经是 [control-plane/web-ui/src/pages/TaskDetailV3.vue](../../control-plane/web-ui/src/pages/TaskDetailV3.vue)，右栏目前以 workflow、trace、member、preview 为主，尚未把角色评审、冲突、修正请求作为统一治理视图落地。
2. 未来目标：在不挤占中栏消息流的前提下，把 role review 与 developer change request 纳入右栏和顶部横幅。
3. 阅读建议：先看 [taskdetail-v3-page-dataflow.md](taskdetail-v3-page-dataflow.md) 了解现网页壳，再读本文定义未来 UI 形态；如果要继续拆组件和状态模型，再接 [task-detail-role-review-component-state-draft.md](task-detail-role-review-component-state-draft.md)。

## 1. 文档目标

本文档回答以下问题：

- 任务详情页中“角色结论 / 冲突 / 开发者修正请求”应放在哪里
- 哪些信息给普通用户看，哪些信息给管理员或审批人看
- 如何和现有 Task Workbench 方案兼容，不抢占回复主视图
- 前端应该读取什么数据模型和交互动作

相关文档：

- [docs/task-thread-session-workbench-plan.md](../task-domain/task-thread-session-workbench-plan.md)
- [docs/role-workflow-data-api-design.md](../workflow/role-workflow-data-api-design.md)
- [docs/role-aggregation-conclusion-model.md](../workflow/role-aggregation-conclusion-model.md)
- [docs/workflow-template-stage-machine-design.md](../workflow/workflow-template-stage-machine-design.md)

## 2. 设计定位

任务详情页的主中心仍然是会话内容与模型回复，不应退化成“治理表格页”。

因此角色评审相关信息应遵循：

- 中栏不被挤占
- 右栏承担治理和评审辅助信息
- 高风险或阻断信息允许以顶部横幅形式提升可见性

## 3. 页面总体结构建议

延续工作台三栏结构：

1. 左栏：分支 / Session 树
2. 中栏：消息流与续跑输入框
3. 右栏：任务上下文、阶段状态、角色结论、冲突、修正请求

其中新增内容主要放在右栏，并补一个顶部状态横幅。

## 4. 顶部状态横幅

建议在任务标题下方增加阶段与风险横幅。

展示内容：

- 当前阶段
- 阶段状态
- 是否被阻断
- 是否等待审批
- 未解决的开发者修正请求数量

示例状态：

- 进行中：设计阶段，2 条待修正
- 已阻断：安全评审阻断，等待开发者修复
- 待审批：发布前高风险变更等待审批

交互：

- 点击横幅可滚动到右侧对应区块

## 5. 右栏信息架构

建议右栏改为标签式结构，避免信息过长。

推荐标签：

- 概览
- 阶段
- 角色评审
- 冲突
- 修正请求
- 治理

### 5.1 概览

展示：

- 当前阶段
- 当前主责角色
- 当前阻塞原因
- 最近一次角色聚合结论摘要
- 待处理修正请求计数

### 5.2 阶段

展示阶段时间线：

- intake
- clarify
- design
- plan
- implement
- verify
- release
- post-release
- retrospective

每个阶段卡片展示：

- 状态
- 主责角色
- 审批状态
- 关键产物摘要
- 是否存在修正请求

### 5.3 角色评审

这是核心新增区块。

展示单位：角色结论卡片，而不是底层实例卡片。

每张卡片建议展示：

- 角色名称，例如安全、架构、QA
- 所属阶段
- 最终结论
- 风险等级
- 共识分数
- 结论摘要
- 主要 findings 前 3 条
- 是否通知开发者
- 是否触发审批

卡片动作：

- 展开查看完整 findings
- 查看冲突详情
- 查看原始实例输出

### 5.4 冲突

该标签页只在存在冲突时高亮。

列表字段建议：

- 角色
- 阶段
- 冲突类型
- 严重级别
- 处理结果
- 是否已升级人工判断

展开后展示：

- 冲突摘要
- 参与 binding 列表，例如安全 A、安全 B
- 系统采用的收敛策略
- 少数派高风险意见

### 5.5 修正请求

这是开发者最直接需要看的区块。

列表字段建议：

- 优先级
- 来源角色
- 标题
- 状态
- 是否阻断
- 是否需要审批

展开项展示：

- 问题摘要
- 需要修改的事项列表
- 关联 findings
- 来源结论摘要
- 当前处理状态

操作建议：

- 标记已确认
- 标记处理中
- 标记已解决
- 查看关联会话 / 分支

### 5.6 治理

展示：

- Hook 执行记录
- 审批状态
- 身份与仓库上下文
- 变更统计

## 6. 核心交互设计

### 6.1 角色结论卡片交互

默认只展示聚合后的单一角色结论。

展开后分三层：

1. 聚合结论摘要
2. merged findings 与 minority findings
3. 原始实例输出

这样既不让页面一开始过载，也能保留审计深度。

### 6.2 冲突高亮交互

当存在 `conflicted` 或 `escalated` 结论时：

- 右栏“冲突”标签出现红点
- 顶部横幅出现“存在角色冲突”提示
- 角色卡片显示“需人工复核”标记

### 6.3 修正请求与开发者工作流联动

当存在 `open` 或 `in-progress` 的修正请求时：

- 当前阶段卡片显示待修正计数
- 如果 `blocking=true`，阶段状态显示阻断
- 中栏输入区上方可显示“本轮待修正要点”折叠条

注意：

- 该提示条是辅助提醒，不应替代右栏完整信息

## 7. 推荐数据模型

前端建议直接消费 BFF 聚合读模型。

```ts
interface TaskWorkflowViewModel {
  taskId: string;
  workflow: {
    currentStage: string;
    status: string;
    stages: TaskStageViewModel[];
  };
  roleConclusions: RoleConclusionViewModel[];
  developerChangeRequests: DeveloperChangeRequestViewModel[];
}
```

### 7.1 角色结论视图模型

```ts
interface RoleConclusionViewModel {
  id: string;
  roleAgentId: string;
  roleLabel: string;
  stage: string;
  finalDecision: string;
  aggregateRiskLevel: string;
  consensusScore: number;
  winningRationale: string;
  mergedFindings: Array<{ key: string; title: string; severity: string }>;
  minorityFindings: Array<{ key: string; title: string; severity: string }>;
  conflicts: Array<{ type: string; severity: string; summary: string }>;
  approvalRequired: boolean;
}
```

### 7.2 修正请求视图模型

```ts
interface DeveloperChangeRequestViewModel {
  id: string;
  sourceRoleAgentId: string;
  sourceRoleLabel: string;
  priority: string;
  title: string;
  summary: string;
  requiredChanges: string[];
  blocking: boolean;
  approvalRequired: boolean;
  status: string;
}
```

## 8. 页面状态建议

### 8.1 空状态

当某阶段还没有角色评审结果时，显示：

- 暂无角色评审结果
- 当前阶段尚未触发辅助角色复核

### 8.2 加载状态

建议用右栏骨架屏，不阻塞中栏消息流。

### 8.3 错误状态

若角色评审数据读取失败：

- 右栏对应标签展示错误提示
- 中栏和左栏不受影响

## 9. 权限与信息分层

### 9.1 普通成员可见

- 角色结论摘要
- 修正请求摘要
- 当前阶段状态

### 9.2 管理员 / 审批人额外可见

- 冲突详情
- minority findings
- 原始实例输出
- 审批建议依据

## 10. 视觉与布局建议

遵循现有工作台原则：

- 中栏保持最大区域
- 右栏卡片信息密度高，但默认折叠细节
- 风险色只用于真正高风险信息，避免全页泛红

建议卡片层级：

- 阻断：红色边框 + 状态章
- 待审批：橙色状态章
- 待修正：黄色提示条
- 已对齐：中性色

## 11. MVP 落地建议

### 11.1 第一阶段

- 先做右栏中的“阶段 / 角色评审 / 修正请求”三个标签
- 先展示聚合结论，不展示原始实例细节
- 冲突先用列表页形式展示

### 11.2 第二阶段

- 增加冲突详情展开
- 增加原始实例输出抽屉
- 增加与审批状态联动的顶部横幅

### 11.3 第三阶段

- 在中栏输入区上方加入本轮待修正要点提醒
- 支持从修正请求跳转到关联会话片段、消息和变更点

## 12. 首批验收标准

1. 任务详情页可以清晰展示当前阶段与阻塞状态。
2. 用户可以看到角色聚合后的结论，而不是只能看原始实例输出。
3. 冲突信息和开发者修正请求有独立可见区域。
4. 中栏回复主视图不被治理信息挤占。
5. 管理员与普通成员的信息可见范围区分明确。
