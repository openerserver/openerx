# 任务详情页角色评审组件结构与状态模型草案

> 适用范围：OpenerX Web UI TaskDetail 页面
>
> 状态：Future target draft，当前实现尚未落地
>
> 目标：把任务详情页中“角色结论 / 冲突 / 开发者修正请求”方案进一步收成可实现的组件结构、状态模型和数据流草案，贴近当前 [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue) 与 [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts) 的实现边界

## 0. 文档定位

这份文档是 role-review UI plan 的“未来组件与状态模型落地草案”，不是当前 TaskDetailV3 代码结构的直接描述。

1. 当前实现：当前 TaskDetailV3 的装配中心是 [control-plane/web-ui/src/composables/useTaskDetailPageModel.ts](../control-plane/web-ui/src/composables/useTaskDetailPageModel.ts)，页面壳与右栏 feature 已经拆成当前模块；角色评审相关组件尚未进入生产代码。
2. 未来目标：给 role review、conflict、developer change request 设计一组可逐步接入的组件、state slice 和 composable。
3. 阅读建议：先看 [task-detail-role-review-ui-plan.md](task-detail-role-review-ui-plan.md) 确认产品结构，再用本文安排组件与状态模型；同时对照 [taskdetail-v3-page-dataflow.md](taskdetail-v3-page-dataflow.md) 避免重新回到旧的大组件思路。

## 1. 文档目标

本文档回答以下问题：

- 现有 TaskDetail 大组件里，新增能力应拆成哪些子组件
- 状态应该继续放在页面级 `ref/computed`，还是抽为 composable
- BFF 聚合读模型如何映射到页面展示状态
- 哪些交互应该在 MVP 就做，哪些后置

相关文档：

- [docs/task-detail-role-review-ui-plan.md](docs/task-detail-role-review-ui-plan.md)
- [docs/task-thread-session-workbench-plan.md](docs/task-thread-session-workbench-plan.md)
- [docs/role-workflow-data-api-design.md](docs/role-workflow-data-api-design.md)

## 2. 与现有页面结构的对齐

当前生产页 [control-plane/web-ui/src/pages/TaskDetailV3.vue](../control-plane/web-ui/src/pages/TaskDetailV3.vue) 与其 page model 装配边界的特点：

- 页面壳已经稳定为左栏 / 中栏 / 右栏
- 主要展示状态由 page model 与 composables 派生，而不是全部堆回单文件大组件
- 页面结构已经稳定为左栏 / 中栏 / 右栏
- 右栏已经有编排、流水线、治理等折叠面板

因此本草案建议：

- 不直接把整页改写成全新页面框架
- 先在现有 V3 页面壳和右栏 feature 边界上引入几个小组件
- 数据获取先由 page model 统一拉取，再作为 props 传给右栏子组件
- 如果状态继续膨胀，再在第二阶段抽 role-review 专属 composable

## 3. 建议新增组件

建议在 `control-plane/web-ui/src/components/task-detail/` 下新增：

- `TaskWorkflowBanner.vue`
- `TaskWorkflowStagePanel.vue`
- `RoleReviewList.vue`
- `RoleReviewCard.vue`
- `RoleConflictList.vue`
- `DeveloperChangeRequestList.vue`

### 3.1 TaskWorkflowBanner.vue

职责：

- 展示当前阶段、阶段状态、阻断状态、待审批状态、待修正数量
- 用作页面顶部横幅

建议 props：

```ts
interface TaskWorkflowBannerProps {
  currentStage: string;
  workflowStatus: string;
  blocked: boolean;
  approvalPending: boolean;
  openChangeRequestCount: number;
  blockingReason?: string;
}
```

### 3.2 TaskWorkflowStagePanel.vue

职责：

- 展示阶段时间线和每个阶段的简要状态

建议 props：

```ts
interface TaskWorkflowStagePanelProps {
  stages: TaskStageViewModel[];
  currentStage: string;
}
```

### 3.3 RoleReviewList.vue

职责：

- 按角色聚合结论列表渲染多个角色卡片

建议 props：

```ts
interface RoleReviewListProps {
  items: RoleConclusionViewModel[];
  canViewConflictDetail: boolean;
  canViewRawBindings: boolean;
}
```

### 3.4 RoleReviewCard.vue

职责：

- 展示单个角色聚合结论
- 支持展开 merged/minority findings

建议 props：

```ts
interface RoleReviewCardProps {
  item: RoleConclusionViewModel;
  showConflictEntry: boolean;
  canViewRawBindings: boolean;
}
```

### 3.5 RoleConflictList.vue

职责：

- 展示冲突列表与冲突摘要

建议 props：

```ts
interface RoleConflictListProps {
  items: RoleConflictViewModel[];
}
```

### 3.6 DeveloperChangeRequestList.vue

职责：

- 展示开发者修正请求列表
- 支持状态变更按钮

建议 props：

```ts
interface DeveloperChangeRequestListProps {
  items: DeveloperChangeRequestViewModel[];
  canUpdateStatus: boolean;
}
```

## 4. 页面状态模型建议

### 4.1 新增页面级源数据

建议在 TaskDetailV3 的 page model 或 role-review feature 中新增以下源数据：

```ts
const workflowViewLoading = ref(false);
const workflowViewError = ref<string | null>(null);
const workflowView = ref<TaskWorkflowViewModel | null>(null);
const roleReviewActiveTab = ref("overview");
const expandedRoleReviewIds = ref<string[]>([]);
const expandedChangeRequestIds = ref<string[]>([]);
```

### 4.2 新增派生状态

建议新增 `computed`：

```ts
const workflowSummary = computed(() => workflowView.value?.workflow ?? null);
const workflowStages = computed(() => workflowView.value?.workflow.stages ?? []);
const roleConclusions = computed(() => workflowView.value?.roleConclusions ?? []);
const developerChangeRequests = computed(() => workflowView.value?.developerChangeRequests ?? []);

const openDeveloperChangeRequests = computed(() =>
  developerChangeRequests.value.filter((item) => item.status === "open" || item.status === "in-progress"),
);

const blockingRoleConclusions = computed(() =>
  roleConclusions.value.filter((item) => item.finalDecision === "block" || item.finalDecision === "human-review"),
);

const conflictItems = computed(() =>
  roleConclusions.value.flatMap((item) =>
    item.conflicts.map((conflict) => ({
      roleAgentId: item.roleAgentId,
      roleLabel: item.roleLabel,
      stage: item.stage,
      finalDecision: item.finalDecision,
      ...conflict,
    })),
  ),
);

const workflowBannerState = computed(() => ({
  currentStage: workflowSummary.value?.currentStage ?? "unknown",
  workflowStatus: workflowSummary.value?.status ?? "pending",
  blocked: blockingRoleConclusions.value.length > 0 || workflowSummary.value?.status === "blocked",
  approvalPending: workflowStages.value.some((stage) => stage.approvalState === "pending"),
  openChangeRequestCount: openDeveloperChangeRequests.value.length,
  blockingReason: workflowStages.value.find((stage) => stage.blockingReason)?.blockingReason,
}));
```

## 5. 数据获取方式建议

### 5.1 第一阶段

建议新增单个聚合接口，由页面统一加载：

- `GET /api/tasks/:taskId/workflow-view`

优点：

- 避免页面发 3 到 5 个并行请求再自行拼装
- 更适合当前 TaskDetailV3 page model 统一装配模式

### 5.2 页面加载伪代码

```ts
async function loadWorkflowView(taskId: string) {
  workflowViewLoading.value = true;
  workflowViewError.value = null;
  try {
    workflowView.value = await getTaskWorkflowView(taskId);
  } catch (error) {
    workflowViewError.value = error instanceof Error ? error.message : "加载角色评审数据失败";
  } finally {
    workflowViewLoading.value = false;
  }
}
```

### 5.3 刷新时机建议

建议在以下时机刷新：

- 进入任务详情页时
- `taskId` 变化时
- 收到角色评审相关实时事件时
- 开发者修正请求状态更新后

## 6. 实时事件接入建议

建议在现有 realtime store 之上增加以下事件消费：

- `task.role-review.started`
- `task.role-review.completed`
- `task.role-review.conflicted`
- `task.developer-change-request.created`

页面处理建议：

- 轻量事件直接触发 `loadWorkflowView(taskId)` 重载
- 不在前端本地手工增量拼接复杂聚合对象

原因：

- 后端聚合逻辑复杂，前端增量修补容易和真值偏离

## 7. 右栏布局接入建议

### 7.1 第一阶段接入方式

在现有右栏折叠区之外，新增一个“角色工作流”标签式区块。

建议顺序：

1. 顶部横幅插入标题区下方
2. 右栏新增 tabs，包含：
   - 概览
   - 阶段
   - 角色评审
   - 冲突
   - 修正请求

### 7.2 第二阶段接入方式

如果右栏信息继续增多，可把“治理 / 编排 / 角色工作流”做成更上层的 inspector tabs。

## 8. 视图模型草案

建议在 `control-plane/web-ui/src/lib/api.ts` 中后续补以下类型：

```ts
export interface TaskWorkflowViewModel {
  taskId: string;
  workflow: {
    currentStage: string;
    status: string;
    stages: TaskStageViewModel[];
  };
  roleConclusions: RoleConclusionViewModel[];
  developerChangeRequests: DeveloperChangeRequestViewModel[];
}

export interface TaskStageViewModel {
  stageKey: string;
  stageLabel: string;
  status: string;
  approvalState: string;
  blockingReason?: string;
  primaryRoleLabel?: string;
}

export interface RoleConclusionViewModel {
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

export interface DeveloperChangeRequestViewModel {
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

## 9. composable 草案

如果第二阶段要降低 TaskDetailV3 page model / 右栏装配复杂度，建议抽：

- `useTaskWorkflowView(taskId)`
- `useRoleReviewPanel(workflowView)`

### 9.1 useTaskWorkflowView

职责：

- 统一管理拉取、刷新、错误、加载态

### 9.2 useRoleReviewPanel

职责：

- 管理展开/折叠、冲突高亮、标签切换

## 10. MVP 范围建议

第一阶段只做：

- 顶部横幅
- 阶段面板
- 角色评审列表
- 修正请求列表

暂不做：

- 原始 binding 输出详情抽屉
- 复杂冲突 diff 对比
- 中栏消息流内嵌修正请求联动提示条

## 11. 实现顺序建议

1. 先补 BFF 统一读模型接口。
2. 再在 `api.ts` 中补类型和请求函数。
3. 然后在 TaskDetailV3 page model / 右栏 feature 中接入页面级状态。
4. 最后抽出右栏子组件。

## 12. 首批验收标准

1. TaskDetailV3 page model 不需要自己拼装复杂聚合逻辑，只消费统一读模型。
2. 新增 UI 不破坏当前左栏 / 中栏 / 右栏结构。
3. 角色结论、冲突、修正请求分别有独立组件边界。
4. 顶部横幅可以准确反映阻断、审批和待修正状态。
