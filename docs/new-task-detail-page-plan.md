# 新任务详情页方案

> 目标：在保留旧页面的前提下，新建一个精简版任务详情页，聚焦三件事：用 VueFlow 可视化分支拓扑、独立执行追踪视图、单窗口聊天切换。
>
> 适用范围：新路由页面 + 新组件，不修改现有 TaskDetail.vue / TaskWorkbench.vue。

## 0. 核心设计原则

1. **老页面零改动。** 新页面是一条独立路由，所有旧路由、旧页面、旧 store 继续存在。
2. **精简第一。** 旧 TaskDetail.vue 6633 行，新页面目标控制在 **800 行以内**（不含子组件）。
3. **只保留用户高频路径。** 去掉双栏分屏、副窗、reply-focus 弹窗、嵌入态、compact inspector drawer。
4. **每个关注点一个组件。** 分支图、执行追踪、聊天消息、输入框各自独立。
5. **统一视觉语言——复用速览卡片风格。** VueFlow 分支节点和执行追踪面板沿用 `TaskDetailQuickOverview` 及其子卡片的设计规范，放在右侧可折叠 Sidebar 中（详见 §0.1）。

### 0.1 速览卡片风格规范（Style Spec）

当前速览区域（`TaskDetailQuickOverview` → `TaskWorkflowStageOverviewCard` / `TaskExecutionControlCard` / `TaskCompletionActionsCard`）已建立了一套紧凑卡片视觉语言，新页面中的 **VueFlow 分支节点** 和 **执行追踪面板** 必须复用此风格，保持一致性：

| 属性 | 速览规范 | 说明 |
|------|---------|------|
| 外层容器 | `border: 1px solid #e8e8e8; border-radius: 8px; padding: 8px; background: #fafafa` | 分支图画布外框、执行追踪面板外框 |
| 标题栏 | `a-flex justify="space-between"` + `a-typography-text strong style="font-size: 13px"` + 右侧折叠/操作按钮 | 面板 header |
| 内容卡片 | `a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }"` | 分支节点、trace segment 卡片 |
| 状态标签 | `a-tag` + 语义色（`blue` 进行中、`success` 已完成、`error` 失败、`orange` 待审批、`processing` 执行中） | 节点状态、segment 类型 |
| 辅助文字 | `font-size: 12px; color: secondary` | 摘要、元信息 |
| 卡片间距 | 纵向 `gap: 6px` | 多张卡片堆叠 |
| 按钮 | `a-button type="text" size="small"` | 折叠、复制、展开 |
| 进度 | `a-steps size="small"` | 可用于 trace 执行步骤 |

## 1. 新页面要做什么

### 1.1 VueFlow 分支拓扑（新增）

用 `@vue-flow/core` 画出当前任务的 session 分支树，替代旧页面的左侧列表 + SessionTreeBranch 组件。

功能：

1. 每个 session 是一个节点，显示分支名、状态（当前/历史/运行中）、简要摘要。
2. fork 关系画成有向边，从父 session 指向子 session。
3. 当前选中的 session 高亮，当前活跃 session 标记。
4. 点击节点切换到该分支的消息视图。
5. 支持缩放、拖拽画布。

### 1.2 执行追踪独立面板（从旧页面拆出）

将旧 TaskDetail 中 `<a-tab-pane key="trace">` 整块逻辑提取成独立组件：

1. 来源拆解（segments）：用户输入、工作流上下文、Hook、最终 Prompt、模型回复。
2. Hook 原始记录。
3. 会话原始消息（带过滤、复制 JSON）。
4. 执行步骤（如果有 chain/parallel plan）。

### 1.3 单窗口聊天（去掉多窗口）

1. 用户在同一个页面只有一个聊天对话窗口。
2. 右侧 Sidebar 的 VueFlow 分支图选中某个 session 后，左侧主内容区聊天区切换到该 session 的消息流。
3. 不支持分屏、不支持工作台 tabs、不支持副窗。
4. 保留续跑和分叉按钮。
5. 用户可以通过一个任务选择器切换到另一个任务。

## 2. 与旧页面的关系

| 旧页面 | 新页面 | 说明 |
|--------|--------|------|
| `/tasks/:taskId` (TaskDetail.vue) | 保留不动 | 旧页面继续作为全功能详情页 |
| `/workbench` (TaskWorkbench.vue) | 保留不动 | 旧 Workbench 不改 |
| `/tasks/:taskId/v2` (TaskDetailV2.vue) | **新增** | 精简版任务详情页 |

导航入口：

1. 任务列表页新增"精简视图"入口链接。
2. 旧详情页头部新增"切换到精简视图"按钮。

## 3. 信息架构

新页面采用**左主内容 + 右侧 Sidebar**布局——聊天区作为主内容占据大部分宽度，VueFlow 分支拓扑和执行追踪放在右侧可折叠 Sidebar 中垂直堆叠：

```text
┌─────────────────────────────────────────────────────────────────┐
│  Header: 任务标题 · 状态 · 任务切换器 · Sidebar 折叠按钮       │
├──────────────────────────────────┬──────────────────────────────┤
│  ┌─ Workflow 阶段概览 ────────┐  │  ┌─ 分支拓扑（VueFlow）────┐ │
│  │ [需求分析 ✓]→[设计 ●]→…   │  │  │  [主线]                  │ │
│  └────────────────────────────┘  │  │    ↓                      │ │
│                                  │  │  [分叉A]                  │ │
│  聊天消息流（自动滚动）          │  │    ↓                      │ │
│                                  │  │  [分叉B (当前)]           │ │
│                                  │  └────────────────────────── │ │
│                                  │  ┌─ 执行追踪 ─────────────┐ │ │
│                                  │  │ 用户输入 → Hook         │ │
│                                  │  │ → 最终Prompt → 模型回复 │ │
│                                  │  └──────────────────────── │ │
├──────────────────────────────────┤                              │
│  固定输入框：textarea + 模型选择 │                              │
│  + 续跑/分叉                     │                              │
└──────────────────────────────────┴──────────────────────────────┘
```

**布局要点：**

- **左侧主内容区**（`flex: 1; min-width: 0`）：顶部放 Workflow 阶段概览（复用 `TaskDetailQuickOverview`，可折叠），下方为聊天消息流（`flex: 1; overflow-y: auto`），底部固定输入框。
- **右侧 Sidebar**（`width: 320px; min-width: 280px; max-width: 400px`）：分支拓扑（VueFlow）和执行追踪两个面板垂直堆叠，面板之间 `gap: 6px`（§0.1 规范）。每个面板可独立折叠。分支拓扑面板展开时占据 Sidebar 上半部分（约 50%），执行追踪占据下半部分（`flex: 1; overflow-y: auto`）。
- **Sidebar 整体可折叠**——Header 右上角提供折叠按钮，折叠后 Sidebar 收起为窄条（`40px`），只显示图标按钮；主内容区扩展为全宽。
- Sidebar 宽度可通过拖拽分隔条调整（可选，Phase 6 实现）。

### 3.1 Header

1. 任务标题（可编辑）。
2. 状态标签：pending / running / completed / failed / paused。
3. 当前选中 session 标签。
4. 任务切换器（Select，从 `listTasks` 拉可选任务，切换后 router.replace 到新 taskId）。
5. Sidebar 折叠/展开切换按钮。
6. “切换到经典视图” 链接。

### 3.2 右侧 Sidebar

Sidebar 内两个面板自上而下排列，使用 §0.1 速览容器样式：

1. **分支拓扑（VueFlow）**——新建 `SessionFlowGraph.vue`，外框为速览容器，内嵌 VueFlow 画布。采用 top-down 垂直布局以适应窄宽度。
2. **执行追踪**——新建 `TaskExecutionTracePanel.vue`，外框为速览容器，内含 segment 卡片列表，支持纵向滚动。

面板 header 格式统一：左侧标题（`a-typography-text strong, 13px`）+ 右侧折叠按钮（`a-button type="text" size="small"`）。

**Workflow 阶段概览**放在左侧主内容区顶部（聊天消息流上方），直接复用现有 `TaskDetailQuickOverview`（含 `TaskWorkflowStageOverviewCard` + `TaskExecutionControlCard` + `TaskCompletionActionsCard`），零改动嵌入。

### 3.3 VueFlow 分支拓扑面板（Sidebar 上半区）

#### 数据来源

复用现有 API：

```ts
// 现有通用 API
getSessionTree(taskId: string) => Promise<{ data: SessionTreeNode[] }>
```

`SessionTreeNode` 结构：

```ts
interface SessionTreeNode {
  id: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  forkedFromMessageRole: string | null;
  forkedFromMessagePreview: string | null;
  firstPromptAfterFork: string | null;
  branchName: string | null;
  sourceType: string;           // "root" | "fork"
  isActive: boolean;
  title: string | null;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  children: SessionTreeNode[];
}
```

#### 转换逻辑

将 `SessionTreeNode[]` 转为 VueFlow 的 `Node[]` + `Edge[]`：

```ts
function sessionTreeToFlow(
  tree: SessionTreeNode[],
  selectedSessionId: string | null,
): { nodes: Node[]; edges: Edge[] }
```

规则：

1. 每个 `SessionTreeNode` 递归展平生成一个 VueFlow Node。
2. 节点位置使用 **dagre 或手动 top-down 垂直布局**：根节点在最上方，子节点依次向下排列（适配 Sidebar 窄宽度）。
3. `parentRuntimeSessionId` → 父节点到子节点的 Edge。
4. 节点类型注册为自定义 `session-node`，内部渲染分支名、状态、摘要。

#### 节点样式（速览卡片风格 §0.1）

1. 外框样式与速览容器一致：`border: 1px solid #e8e8e8; border-radius: 8px; background: #fafafa`。
2. 当前选中 session → `border: 2px solid #1677ff`（Ant Design 主题蓝）。
3. `isActive === true` → `a-tag color="processing"` 标注"当前"。
4. `sourceType === "root"` → `a-tag color="blue"` 显示"主线"。
5. `sourceType === "fork"` → `a-tag color="default"` 显示"分叉"。
6. 节点内部使用 `a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }"`。
7. 标题 `font-size: 13px`，辅助文字 `font-size: 12px; color: secondary`。
8. 节点宽度固定 200px，高度自适应。

#### 交互

1. 单击节点 → 选中该 session，左侧主内容区聊天区切换到该 session 的消息流。
2. 右键节点 → 菜单：设为当前分支、从此分叉、归档。
3. 画布支持缩放（min 0.4、max 1.8）和拖拽。
4. 卡片折叠时，标题栏旁显示当前选中分支名称的 `a-tag`，一目了然。

### 3.4 聊天消息区（主内容区）

左侧主内容区中，Workflow 概览卡片下方是聊天消息区，占据主内容区的剩余高度。

复用现有 API：

```ts
getSessionMessages(sessionId: string) => message[]
```

展示规则：

1. assistant 回复使用 markdown 渲染。
2. user 消息使用浅色背景。
3. 工具调用默认折叠，显示摘要。
4. streaming 中的消息显示"生成中"标签。
5. 每条消息旁显示：复制按钮。
6. 列表底部自动滚动（用户手动上翻时暂停）。

### 3.5 底部固定输入框

1. 多行 textarea，最大 50000 字。
2. 模型选择器（复用 `getModelsList`）。
3. "继续当前分支"主按钮。
4. "分叉"次按钮（调用 `forkTaskSession` 后在分支图新增节点）。
5. 任务 running 时禁用输入，显示"执行中"提示。
6. 终止执行按钮（如果有可控 agentRunId）。

### 3.6 任务切换器

1. 页面级 Select 下拉框。
2. 数据源：`listTasks(projectId)` 返回最近任务列表。
3. 支持搜索（标题 / ID 模糊匹配）。
4. 切换后 `router.replace({ params: { taskId: newId } })`，页面响应式刷新。
5. 不需要 tabs、不需要 store 持久化。

## 4. 文件结构

```text
control-plane/web-ui/src/
  pages/
    TaskDetailV2.vue                        # 新页面入口，<800 行
  components/task-detail-v2/
    SessionFlowGraph.vue                    # VueFlow 分支拓扑图
    SessionFlowNode.vue                     # 自定义 VueFlow 节点
    ChatMessageList.vue                     # 聊天消息列表
    ChatComposer.vue                        # 底部输入框
    TaskExecutionTracePanel.vue             # 独立执行追踪面板
    TaskSwitcher.vue                        # 任务切换下拉
  composables/
    useSessionFlow.ts                       # session tree → VueFlow nodes/edges 转换
    useTaskMessages.ts                      # 消息加载、streaming 状态
    useTaskExecutionTrace.ts                # 执行追踪数据获取与过滤
    useTaskSwitcher.ts                      # 任务列表拉取与切换
  router/
    index.ts                                # 新增 /tasks/:taskId/v2 路由
```

预估行数（不含样式）：

| 文件 | 预估行数 | 职责 |
|------|---------|------|
| TaskDetailV2.vue | 500-650 | 页面框架、左右分栏布局、Sidebar 折叠管理 |
| SessionFlowGraph.vue | 200-280 | 速览容器壳 + VueFlow 画布 + 折叠 |
| SessionFlowNode.vue | 80-120 | 自定义节点模板 |
| ChatMessageList.vue | 250-350 | 消息渲染、auto-scroll |
| ChatComposer.vue | 150-200 | 输入框、模型选择、按钮 |
| TaskExecutionTracePanel.vue | 350-450 | 速览容器壳 + 来源拆解 + 原始消息 |
| TaskSwitcher.vue | 60-80 | Select 包装 |
| useSessionFlow.ts | 100-150 | tree → flow 转换 |
| useTaskMessages.ts | 120-160 | 消息获取 + streaming |
| useTaskExecutionTrace.ts | 100-140 | trace 获取 + 过滤 |
| useTaskSwitcher.ts | 60-80 | 任务列表 |

总计约 **2100-2850 行**，对比旧 TaskDetail.vue 单文件 6633 行，结构显著清晰。Sidebar 布局需要少量分栏/折叠管理逻辑，页面壳比单栏方案略复杂，但仍远低于旧页面三种布局模式的复杂度。

## 5. 路由配置

在 [control-plane/web-ui/src/router/index.ts](control-plane/web-ui/src/router/index.ts) 新增：

```ts
{
  path: "tasks/:taskId/v2",
  name: "TaskDetailV2",
  component: () => import("../pages/TaskDetailV2.vue"),
},
```

位置：放在现有 `tasks/:taskId` 路由之后。

## 6. VueFlow 分支图详细设计

### 6.1 依赖

已安装，无需额外添加：

```json
"@vue-flow/core": "^1.41.0",
"@vue-flow/background": "^1.3.0",
"@vue-flow/controls": "^1.1.0"
```

### 6.2 布局算法

由于分支图现在放在右侧 Sidebar 中（宽度约 280-400px），采用 **top-down 垂直布局**最节省横向空间：

```ts
// useSessionFlow.ts 核心逻辑
function layoutTree(
  flatNodes: SessionTreeNode[],
  nodeWidth: number,
  nodeHeight: number,
  gapX: number,
  gapY: number,
): Map<string, { x: number; y: number }>
```

算法步骤：

1. 将 `SessionTreeNode[]` 递归展平并构建 `parentId → children` 映射。
2. DFS 遍历，为每个节点分配 `depth`（决定 **y** 坐标，从上到下）和 `siblingIndex`（决定 **x** 坐标，从左到右）。
3. 节点间距：y 方向 `gapY = 50px`，x 方向 `gapX = 30px`。
4. 叶节点占位 `nodeWidth + gapX`，非叶节点宽度等于子树宽度之和。
5. 居中对齐：父节点 x = 子节点区间中点。

节点尺寸推荐：`width = 200px`，`height = auto`（VueFlow 自动测量）。垂直布局使得 Sidebar 内仅需 200px 最小宽度即可容纳单列分支，多分叉时横向滚动或缩放适配。

### 6.3 自定义节点 SessionFlowNode.vue

**沿用速览卡片风格（§0.1）**，每个节点渲染为紧凑的 `a-card`，使用 `a-tag` 标记状态。

模板结构：

```vue
<template>
  <div
    class="session-flow-node"
    :style="{
      border: data.selected ? '2px solid #1677ff' : '1px solid #e8e8e8',
      borderRadius: '8px',
      background: '#fafafa',
      padding: '0',
      width: '200px',
    }"
  >
    <!-- 复用速览 a-card 紧凑布局 -->
    <a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }">
      <a-space size="small" wrap style="margin-bottom: 4px">
        <a-tag :color="data.sourceType === 'root' ? 'blue' : 'default'">
          {{ data.sourceType === 'root' ? '主线' : '分叉' }}
        </a-tag>
        <a-tag v-if="data.isActive" color="processing">当前</a-tag>
      </a-space>

      <a-typography-text strong style="font-size: 13px; display: block; margin-bottom: 4px">
        {{ data.title || data.branchName || data.shortId }}
      </a-typography-text>

      <a-typography-text type="secondary" style="font-size: 12px">
        {{ data.shortId }}
      </a-typography-text>

      <div v-if="data.summary" style="margin-top: 4px">
        <a-typography-text type="secondary" style="font-size: 12px">
          +{{ data.summary.additions }} -{{ data.summary.deletions }} ({{ data.summary.files }} files)
        </a-typography-text>
      </div>
    </a-card>

    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
```

注册方式：

```vue
<VueFlow :nodes="nodes" :edges="edges" ...>
  <template #node-session="slotProps">
    <SessionFlowNode :data="slotProps.data" />
  </template>
</VueFlow>
```

### 6.4 边样式

```ts
{
  id: `e-${parentId}-${childId}`,
  source: parentId,
  target: childId,
  type: 'smoothstep',
  animated: child.isActive,          // 活跃分支的边带动画
  style: { stroke: '#8bb3e0', strokeWidth: 2 },
}
```

### 6.5 刷新策略

1. 页面 mount 时调用 `getSessionTree(taskId)` 获取初始数据。
2. 分叉成功后立即重新拉取 session tree，VueFlow 响应式更新。
3. Realtime event `session.created` / `session.updated` 触发增量刷新。
4. 不使用定时轮询。

## 7. 执行追踪独立组件详细设计

> **视觉风格：沿用速览卡片风格（§0.1）。** 面板外框用速览容器样式（`#fafafa` 背景 + `8px` 圆角），每个 trace segment 渲染为 `a-card size="small" :bordered="false"`，segment 类型用 `a-tag` 语义色标签，面板 header 带标题 + 过滤/刷新按钮。

### 7.1 组件接口

```ts
// TaskExecutionTracePanel.vue
defineProps<{
  taskId: string;
  sessionId?: string;
}>();

defineEmits<{
  (e: 'refresh'): void;
}>();
```

### 7.2 内部状态

委托给 `useTaskExecutionTrace.ts` composable：

```ts
export function useTaskExecutionTrace(taskId: Ref<string>, sessionId: Ref<string | undefined>) {
  const trace = ref<TaskExecutionTrace | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const segmentFilter = ref<'all' | 'user-input' | 'hook' | 'model-response'>('all');
  const messageRoleFilter = ref<'all' | 'user' | 'assistant' | 'tool'>('all');
  const expandedSegments = ref<Record<string, boolean>>({});
  const expandedMessageRaw = ref<Record<string, boolean>>({});

  async function refresh(silent?: boolean) { ... }
  const filteredSegments = computed(() => { ... });
  const filteredMessages = computed(() => { ... });
  const summaryItems = computed(() => { ... });

  watch([taskId, sessionId], () => refresh());

  return { trace, loading, error, segmentFilter, messageRoleFilter, expandedSegments, expandedMessageRaw, refresh, filteredSegments, filteredMessages, summaryItems };
}
```

### 7.3 从旧 TaskDetail 迁移的逻辑片段

需要搬迁的代码区域（均来自旧 TaskDetail.vue）：

| 来源行号区间 | 描述 | 迁移目标 |
|-------------|------|---------|
| L407-L640 | 模板中 `<a-tab-pane key="trace">` 完整块 | TaskExecutionTracePanel.vue 模板 |
| L1088-L1095 | `taskExecutionTrace` / `loading` / `error` 状态 | useTaskExecutionTrace.ts |
| L1091-L1094 | `traceSegmentFilter` / `traceMessageRoleFilter` / `traceSegmentExpanded` / `traceMessageRawExpanded` | useTaskExecutionTrace.ts |
| L1961-L1981 | `refreshTaskExecutionTrace` 函数 | useTaskExecutionTrace.ts `refresh` |
| L4660-L4705 | `filteredTraceSegments` / `filteredTraceMessages` / `summaryItems` 计算属性 | useTaskExecutionTrace.ts |

### 7.4 样式（速览卡片风格 §0.1）

**不再复用旧页面的 `.task-trace-*` CSS class**，改为按速览规范重写：

```vue
<template>
  <!-- 面板外框 -->
  <div style="border: 1px solid #e8e8e8; border-radius: 8px; padding: 8px; background: #fafafa">
    <!-- 标题栏 -->
    <a-flex justify="space-between" align="center" style="margin-bottom: 4px; padding: 0 4px">
      <a-typography-text strong style="font-size: 13px">执行追踪</a-typography-text>
      <a-space size="small">
        <!-- segment 过滤器 -->
        <a-radio-group v-model:value="segmentFilter" size="small" button-style="solid">
          <a-radio-button value="all">全部</a-radio-button>
          <a-radio-button value="user-input">用户输入</a-radio-button>
          <a-radio-button value="hook">Hook</a-radio-button>
          <a-radio-button value="model-response">模型回复</a-radio-button>
        </a-radio-group>
        <a-button type="text" size="small" @click="$emit('refresh')">刷新</a-button>
      </a-space>
    </a-flex>

    <!-- segment 列表 -->
    <div style="display: flex; flex-direction: column; gap: 6px">
      <a-card
        v-for="seg in filteredSegments"
        :key="seg.index"
        size="small"
        :bordered="false"
        :body-style="{ padding: '8px 12px' }"
      >
        <a-space size="small" style="margin-bottom: 4px">
          <a-tag :color="segmentTagColor(seg.type)">{{ segmentLabel(seg.type) }}</a-tag>
        </a-space>
        <div style="font-size: 12px">{{ seg.preview }}</div>
      </a-card>
    </div>
  </div>
</template>
```

segment 类型 → `a-tag` 色值映射：

| segment type | a-tag color | 标签文本 |
|-------------|-------------|----------|
| `user-input` | `blue` | 用户输入 |
| `workflow-context` | `cyan` | 工作流上下文 |
| `hook-injection` | `orange` | Hook 注入 |
| `hook-result` | `orange` | Hook 结果 |
| `hook-rewrite` | `orange` | Hook 重写 |
| `final-prompt` | `purple` | 最终 Prompt |
| `model-response` | `green` | 模型回复 |

## 8. 聊天消息组件设计

### 8.1 ChatMessageList.vue

```ts
defineProps<{
  messages: ConversationMessageItem[];
  loading: boolean;
  isStreaming: boolean;
}>();

defineEmits<{
  (e: 'copy', text: string): void;
}>();
```

内部逻辑：

1. 渲染 assistant / user / tool 消息卡片。
2. markdown 渲染复用现有 `renderMarkdown`。
3. 自动滚动到底部，用户上翻时暂停。
4. streaming 消息显示动画占位。

### 8.2 ChatComposer.vue

```ts
defineProps<{
  taskId: string;
  sessionId?: string;
  disabled: boolean;
  isExecuting: boolean;
  canTerminate: boolean;
  modelOptions: Array<{ label: string; value: string }>;
  modelsLoading: boolean;
  selectedModel?: string;
}>();

defineEmits<{
  (e: 'continue', prompt: string): void;
  (e: 'fork', prompt: string): void;
  (e: 'terminate'): void;
  (e: 'update:selectedModel', model: string): void;
  (e: 'refreshModels'): void;
}>();
```

## 9. 去掉的旧功能

下列功能**不出现在新页面**中，由此大幅降低代码量：

| 旧功能 | 原因 |
|--------|------|
| Workbench iframe 嵌入模式 | 新页面不需要被 iframe 嵌入 |
| `isWorkbenchEmbedded` 及全部条件分支 | 不再有两种布局模式 |
| 双栏分屏 / 副窗 | 单窗口设计 |
| `workbench:open-fork` postMessage | 无跨窗口协议 |
| reply-focus 弹出窗 | 单窗口设计，直接在页面操作 |
| Compact inspector drawer | 执行追踪已独立为 Sidebar 面板 |
| 并行候选比较卡片区域 | 暂不在 V2 实现，需要时单独加回 |
| 任务标签页 tabs + pin / close | 改为任务切换下拉 |
| Workbench store / persist / server sync | 不需要 |
| SessionTree / SessionTreeBranch 列表组件 | 被 VueFlow 图替代 |

## 10. 保留的核心功能

| 功能 | 来源 | 新组件 |
|------|------|--------|
| 分支树可视化 | SessionTree → VueFlow | SessionFlowGraph.vue |
| 会话消息流 | TaskDetail 中栏 | ChatMessageList.vue |
| 续跑 / 分叉 | TaskDetail composer | ChatComposer.vue |
| 执行追踪 | TaskDetail trace tab | TaskExecutionTracePanel.vue |
| 模型选择 | TaskDetail composer | ChatComposer.vue |
| 终止执行 | TaskDetail terminate | ChatComposer.vue |
| 任务状态/标题 | TaskDetail header | TaskDetailV2.vue header |
| 工作流阶段概览 | TaskDetailQuickOverview | 直接复用，async import |
| 实时事件 | useRealtimeStore | 复用 |

## 11. 实施步骤

### 阶段 1：骨架搭建

1. 新建 `TaskDetailV2.vue`，只有 Header + 左侧主内容区空壳（Workflow 概览 + 聊天区 + 底部输入框）+ 右侧 Sidebar 占位区。
2. 新建路由 `/tasks/:taskId/v2`。
3. 在旧 TaskDetail header 加一个"切换到精简视图"的 router-link。
4. 在任务列表 Tasks.vue 的操作栏加一个"精简视图"入口。

验收：新路由可访问，显示任务标题和左右分栏空壳。

### 阶段 2：VueFlow 分支图（Sidebar 上半区）

1. 新建 `useSessionFlow.ts`，实现 `sessionTreeToFlow` 转换 + top-down 垂直布局。
2. 新建 `SessionFlowNode.vue`，自定义节点（速览卡片风格）。
3. 新建 `SessionFlowGraph.vue`，速览容器壳 + VueFlow + Background + Controls + 折叠功能。
4. 接入 `getSessionTree` API。
5. 点击节点 → 选中 session。

验收：打开新页面能看到右侧 Sidebar 中的分支拓扑图，可折叠/展开，点击节点可选中。

### 阶段 3：聊天消息

1. 新建 `useTaskMessages.ts`，消息拉取 + streaming 状态。
2. 新建 `ChatMessageList.vue`，主内容区消息渲染 + auto-scroll。
3. 新建 `ChatComposer.vue`，输入框 + 按钮。
4. 选中 session 后显示消息、可续跑和分叉。

验收：选择分支后能看消息流，能续跑和分叉，分叉后分支图自动更新。

### 阶段 4：执行追踪（Sidebar 下半区）

1. 新建 `useTaskExecutionTrace.ts`。
2. 新建 `TaskExecutionTracePanel.vue`，搬迁旧模板和过滤逻辑。
3. 接入 Sidebar 下半区。

验收：Sidebar 下半部分展示执行追踪，能看到来源拆解和原始消息。

### 阶段 5：任务切换器

1. 新建 `useTaskSwitcher.ts` + `TaskSwitcher.vue`。
2. 集成到 Header。

验收：下拉选择另一个任务后，页面刷新到新任务。

### 阶段 6：打磨

1. 分支图右键菜单（设为当前、归档）。
2. Realtime 事件驱动分支图和消息增量刷新。
3. 响应式布局打磨（Sidebar 折叠/展开过渡动画、窄屏自动折叠）。
4. 样式调优。

## 12. 需要复用的现有模块

以下模块直接 import，不需要重写：

| 模块 | 路径 | 用途 |
|------|------|------|
| API 函数 | `lib/api.ts` | getTask, getSessionTree, getSessionMessages, getTaskExecutionTraceView, continueTask, forkTaskSession, activateSession, archiveTaskSession, listTasks, getModelsList, terminateAgent 等 |
| Markdown 渲染 | `lib/markdown.ts` | renderMarkdown |
| Realtime store | `stores/realtime.ts` | useRealtimeStore |
| 主题样式 | `theme/ui-theme.ts` | taskDetailThemeStyles（部分复用） |
| TaskDetailQuickOverview | `components/task-detail/TaskDetailQuickOverview.vue` | 工作流阶段概览 |
| ExecutionModeModal | `components/ExecutionModeModal.vue` | 执行模式选择 |

## 13. 不需要的现有模块

| 模块 | 原因 |
|------|------|
| `stores/workbench.ts` | 新页面无多窗口 |
| `SessionTree.vue` / `SessionTreeBranch.vue` | 被 VueFlow 替代 |
| `workbenchThemeStyles` | 无 workbench 壳 |
| `confirmation-parser.ts` | 审批确认流如需要后续独立加回 |

## 14. 测试计划

新增测试文件：`tests/web-ui/TaskDetailV2.test.ts`

核心测试用例：

1. **路由挂载**：页面能正确加载，显示任务标题。
2. **分支图渲染**：mock `getSessionTree` 返回多分支数据，验证 VueFlow nodes/edges 数量正确。
3. **节点点击切换**：点击分支节点后 `selectedSessionId` 更新，消息列表重新加载。
4. **消息加载**：mock `getSessionMessages` 返回消息，验证渲染。
5. **续跑**：输入文本后点击续跑按钮，验证调用 `continueTask`。
6. **分叉**：点击分叉按钮，验证调用 `forkTaskSession`，分支图新增节点。
7. **执行追踪**：展开右侧 Sidebar 执行追踪面板，验证加载并渲染来源拆解。
8. **任务切换**：选择新任务，验证 router.replace 和数据刷新。

composable 单元测试：

1. `useSessionFlow.ts`：tree → nodes/edges 转换正确性、布局坐标。
2. `useTaskExecutionTrace.ts`：过滤逻辑、summary 计算。
3. `useTaskMessages.ts`：消息加载、streaming 判断。

## 15. 风险与注意事项

### 15.1 VueFlow 布局在大分支树下的性能

当分支数超过 50 时，VueFlow 渲染可能出现卡顿。应对方案：

1. 默认只展开到深度 3，更深的分支折叠为"展开子树"按钮。
2. `fitView` 仅在初始化时调用一次。
3. 节点内容保持简洁，不放长文本。

### 15.2 Realtime 事件需要与旧页面共用 store

`useRealtimeStore` 是全局 Pinia store，新旧页面可并存。但要确保新页面 unmount 时正确 unsubscribe。

### 15.3 不要影响旧路由

新路由使用 `/tasks/:taskId/v2` 路径，不能让 Vue Router 把 `v2` 误匹配为 `taskId`。在路由定义中要把新路由放在 `tasks/:taskId` **之前**或使用更精确的路径匹配。

推荐方案：将新路由放在 `tasks/:taskId` 之前：

```ts
{
  path: "tasks/:taskId/v2",
  name: "TaskDetailV2",
  component: () => import("../pages/TaskDetailV2.vue"),
},
{
  path: "tasks/:taskId",
  name: "TaskDetail",
  component: () => import("../pages/TaskDetail.vue"),
},
```

### 15.4 CSS 隔离

新组件全部使用 `<style scoped>`，避免与旧页面样式冲突。

## 16. 总结

| 维度 | 旧 TaskDetail | 新 TaskDetailV2 |
|------|--------------|-----------------|
| 单文件行数 | 6633 行 | ~500-650 行 |
| 总代码量 | ~6633 行 + 434 行 store | ~2100-2850 行（含子组件和 composable） |
| 页面布局 | 两栏（左 sidebar + 右内容）× 3 种模式 | **左主内容 + 右侧 Sidebar** ×1 种模式 |
| 分支可视化 | 列表 + 嵌套缩进（左侧 sidebar） | VueFlow 拓扑图（右侧 Sidebar，top-down 垂直布局） |
| 执行追踪 | 嵌在主页面 tab 里 | 右侧 Sidebar 独立可折叠面板 |
| 多窗口 | iframe + tabs + 分屏 + 副窗 + postMessage | 无，单窗口 + 任务切换 |
| 嵌入模式 | 支持（大量条件分支） | 不支持 |
| 布局模式 | 3 种（standalone / embedded / reply-focus） | 1 种（左右分栏 + Sidebar 可折叠） |
| 状态管理 | workbench store + local persist + server sync | 页面内状态 + URL 参数 |
| 视觉风格 | 自定义 CSS class | 速览卡片规范（§0.1）|
