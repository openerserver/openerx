# Historical: 任务工作台前端复杂度评估与拆分方案

> 状态：historical
> 适用范围：Task Workbench、Task Detail 嵌入态、Workbench Pinia store
>
> 历史注记：本文形成于旧 `TaskDetail.vue` / `TaskDetail.test.ts` 仍作为任务详情主锚点的阶段。当前主任务详情页已经切到 `TaskDetailV3`，现行说明请优先阅读 [../../task-detail/taskdetail-v3-page-dataflow.md](../../task-detail/taskdetail-v3-page-dataflow.md) 与 [../../task-detail/task-detail-display-write-logic.md](../../task-detail/task-detail-display-write-logic.md)。下文保留为历史复杂度评估与拆分思路，不再作为当前实现或当前改造计划依据。

## 1. 结论

当前“任务工作台”前端**已经出现结构性复杂度偏高的问题**，但问题不在于单一页面代码行数大，而在于三个层面叠加耦合：

1. Workbench 外壳负责 tabs、分屏、副窗、清空撤销、跨页打开、任务补全、状态轮询。
2. TaskDetail 同时承担“独立详情页”和“Workbench 嵌入页”两种模式。
3. Workbench store 同时承担布局规则、快照恢复、历史兼容、local persist、服务端同步。

这意味着当前复杂度不是“某一个文件太长”，而是：

1. 页面壳、嵌入协议、详情页展示逻辑之间的边界不清。
2. Workbench 的产品能力已经升级成子系统，但代码组织仍停留在“单页 + 单 store + query 开关”的形态。

因此，结论不是“必须推翻重写”，而是：

1. **可以拆，而且应该拆。**
2. **优先做结构拆分，不优先做视觉改版。**
3. **第一阶段应以降低耦合为目标，不追求功能变化。**

## 2. 判断依据

### 2.1 文件体量已经超过单页可维护阈值

当前关键文件规模如下：

1. [control-plane/web-ui/src/pages/TaskWorkbench.vue](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue): 634 行
2. [control-plane/web-ui/src/stores/workbench.ts](../../../control-plane/web-ui/src/stores/workbench.ts): 434 行
3. `control-plane/web-ui/src/pages/TaskDetail.vue`: 6633 行
4. `tests/web-ui/TaskDetail.test.ts`: 2478 行
5. [tests/web-ui/MultiTaskMonitor.test.ts](../../../tests/web-ui/MultiTaskMonitor.test.ts): 2594 行

单看 [control-plane/web-ui/src/pages/TaskWorkbench.vue](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue) 并不算灾难级，但它依赖的 `control-plane/web-ui/src/pages/TaskDetail.vue` 已经是超重页面。Workbench 实际上是把一个超重详情页通过 iframe 作为运行内核再次组合。

### 2.2 TaskDetail 处于“双模页面”状态

TaskDetail 不是纯详情页，而是通过 query 参数切换出嵌入模式：

1. 历史上的 `control-plane/web-ui/src/pages/TaskDetail.vue#L1044` 通过 `route.query.workbench === "1"` 判定嵌入态。
2. 历史上的 `control-plane/web-ui/src/pages/TaskDetail.vue#L1145-L1163` 大量侧栏、上下文、治理、流程、事件面板的展示规则都依赖嵌入态。
3. 历史上的 `control-plane/web-ui/src/pages/TaskDetail.vue#L5340-L5349` 又继续构造 `embedded=1&workbench=1&reply=1` 的衍生页面。

这类“一个页面服务两种信息架构”的做法在早期很快，但在中后期会让任何局部改动都需要考虑两套布局与交互分支。

### 2.3 Workbench 与 TaskDetail 通过 iframe + postMessage 建立弱协议

当前 Workbench 不是组合复用组件，而是组合一个路由页面：

1. [control-plane/web-ui/src/pages/TaskWorkbench.vue#L95-L96](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue#L95-L96) 和 [control-plane/web-ui/src/pages/TaskWorkbench.vue#L151-L152](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue#L151-L152) 通过 iframe 加载 TaskDetail。
2. [control-plane/web-ui/src/pages/TaskWorkbench.vue#L485-L507](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue#L485-L507) 监听 `workbench:open-fork` 消息。
3. 历史上的 `control-plane/web-ui/src/pages/TaskDetail.vue#L2779-L2787` 在嵌入态分叉后主动向父窗口发消息。

这说明 Workbench 与 TaskDetail 之间已经存在一层“页面协议”，但该协议没有被显式抽成 bridge/composable，也没有独立测试边界。

### 2.4 store 承担了过多职责

[control-plane/web-ui/src/stores/workbench.ts](../../../control-plane/web-ui/src/stores/workbench.ts) 同时负责：

1. tabs 和 activeTask 的领域状态
2. splitMode 与 secondaryPane 的布局约束
3. snapshot restore / legacy layout migration
4. missing task prune
5. pin / close other / close right 等 UI 行为
6. local persist
7. saveWorkbenchLayout 服务端同步

尤其是 [control-plane/web-ui/src/stores/workbench.ts#L367-L409](../../../control-plane/web-ui/src/stores/workbench.ts#L367-L409) 已经把“状态变更监听 + debounce + 服务端保存”也放进了 store。这样做短期方便，长期会带来两个问题：

1. store 很难做纯逻辑测试，因为有 IO 副作用。
2. 任何布局规则调整，都可能影响持久化和恢复语义。

另外，成稿时 [control-plane/web-ui/src/stores/workbench.ts#L382-L394](../../../control-plane/web-ui/src/stores/workbench.ts#L382-L394) 的 `loadFromServer` 没有调用方，说明当时服务端同步链路还处于半接入状态；后续如果代码已有接入，应以当前实现为准。

## 3. 当前复杂度主要来自哪里

### 3.1 不是 tabs 本身复杂

Tabs、固定、关闭其他、右侧关闭，这些都属于普通工作台能力，本身不算异常复杂。

### 3.2 真正复杂的是“Workbench 壳 + TaskDetail 双模 + 跨窗口协议”

当前系统的复杂度核心是：

1. Workbench 需要决定打开哪个任务、主副窗是什么、何时进入 split。
2. TaskDetail 需要决定自己是独立页还是嵌入页，以及嵌入页下隐藏哪些块。
3. fork、reply focus 等行为又反向影响 Workbench。

这三层之间不是父子组件关系，而是页面间协作关系，所以比普通组件拆分更难维护。

### 3.3 复杂度已经开始反映到测试成本

TaskDetail 和 MultiTaskMonitor 的测试体量很大，说明行为面已经铺得很宽。继续在现有结构上叠加新功能，会继续放大以下成本：

1. 每次改动都要回归独立页与嵌入页。
2. 每次改动都要确认 iframe 行为是否仍成立。
3. store 行为改动容易影响恢复、持久化和分屏边界。

## 4. 是否建议拆分

建议拆分，且建议按“纵向切边界”的方式拆，不建议先做局部函数搬家。

错误做法：

1. 只把 [control-plane/web-ui/src/pages/TaskWorkbench.vue](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue) 再切成几个小组件，但继续保留当前 iframe 协议和 TaskDetail 双模。
2. 只把 [control-plane/web-ui/src/stores/workbench.ts](../../../control-plane/web-ui/src/stores/workbench.ts) 切成更多方法，但 store 仍继续承担 IO。

正确做法：

1. 先把 Workbench Shell、自身状态、嵌入协议、TaskDetail 嵌入态视图分开。
2. 再决定后续是否保留 iframe。

## 5. 拆分目标

目标不是立即消灭 iframe，而是先把当前结构改造成以下边界：

1. `Workbench Shell`：只负责页面框架、任务集合、主副窗布局、命令分发。
2. `Workbench Bridge`：只负责 iframe src、postMessage、reply focus window 等跨窗口协议。
3. `Workbench Persistence`：只负责快照保存、恢复、服务端同步。
4. `TaskDetailCore`：只负责任务详情共享能力，不感知 workbench query。
5. `TaskDetailEmbedded`：只负责嵌入态布局裁剪与 workbench 专属交互。
6. `TaskDetailPage`：只负责独立详情页布局。

也就是把今天的“一个重页面 + 一个中等页面 + 一个中等 store”改成：

1. 一个薄页面壳
2. 两到三个领域 composable
3. 一个共享详情核心
4. 两个模式 wrapper

## 6. 推荐拆分结构

建议按下面的目录结构演进：

```text
control-plane/web-ui/src/
  pages/
    TaskWorkbench.vue                  # 只保留页面入口与路由编排
    TaskDetailPage.vue                 # 独立详情页 wrapper
  components/workbench/
    WorkbenchToolbar.vue
    WorkbenchTabs.vue
    WorkbenchPane.vue
    WorkbenchSplitLayout.vue
    WorkbenchEmptyState.vue
  components/task-detail/
    TaskDetailCore.vue
    TaskDetailEmbeddedLayout.vue
    TaskDetailStandaloneLayout.vue
  composables/workbench/
    useWorkbenchLayout.ts
    useWorkbenchTaskCatalog.ts
    useWorkbenchBridge.ts
    useWorkbenchPersistence.ts
  stores/
    workbench-layout.ts
```

说明：

1. `TaskWorkbench.vue` 不再直接处理任务 picker 数据获取、轮询、消息桥接、通知撤销细节。
2. `TaskDetail.vue` 不再同时承载 standalone 和 embedded 两种信息架构。
3. `useWorkbenchBridge.ts` 明确管理 `workbench:open-fork` 之类协议。
4. `useWorkbenchPersistence.ts` 接管 server sync 与 snapshot restore。

## 7. 分阶段实施方案

### 阶段 1：只做结构拆分，不改产品行为

目标：让代码边界清晰，但不改 URL、不改接口、不改 iframe 策略。

建议动作：

1. 从 [control-plane/web-ui/src/pages/TaskWorkbench.vue](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue) 提取：
   1. `WorkbenchToolbar.vue`
   2. `WorkbenchTabs.vue`
   3. `WorkbenchSplitLayout.vue`
   4. `useWorkbenchTaskCatalog.ts`
2. 从 [control-plane/web-ui/src/stores/workbench.ts](../../../control-plane/web-ui/src/stores/workbench.ts) 提取：
   1. 纯布局状态到 `workbench-layout.ts`
   2. 保存/恢复逻辑到 `useWorkbenchPersistence.ts`
3. 从历史上的 `control-plane/web-ui/src/pages/TaskDetail.vue` 提取：
   1. `TaskDetailCore.vue`
   2. `TaskDetailEmbeddedLayout.vue`
   3. `TaskDetailPage.vue`

阶段 1 验收标准：

1. Workbench 页面入口控制在 200 到 250 行以内。
2. Workbench store 只保留纯状态与纯规则，不直接发请求。
3. TaskDetail 不再通过 `isWorkbenchEmbedded` 在一个文件里裁剪大块区域。
4. 现有路由与交互行为不变。

### 阶段 2：显式化嵌入协议

目标：把当前隐式页面协议收敛到一个地方。

建议动作：

1. 新建 `useWorkbenchBridge.ts`，统一封装：
   1. iframe URL 构造
   2. `window.addEventListener("message")`
   3. `workbench:open-fork`
   4. reply focus window URL 构造
2. 为 bridge 增加单元测试，覆盖：
   1. open-fork 事件解析
   2. 非法 origin / payload 忽略
   3. sessionId 缺失的保护逻辑

阶段 2 验收标准：

1. Workbench 页面文件中不再直接处理 postMessage 细节。
2. TaskDetail embedded wrapper 中不再直接散落 workbench 协议常量。

### 阶段 3：切断 TaskDetail 的双模耦合

目标：让 TaskDetail shared core 不再知道 workbench 是什么。

建议动作：

1. `TaskDetailCore.vue` 只接收显式 props：
   1. `layoutMode: "standalone" | "embedded" | "reply-focus"`
   2. `initialSessionId`
   3. `allowForkToWorkbench`
2. route query 解析移动到 wrapper：
   1. `TaskDetailPage.vue`
   2. `TaskDetailEmbeddedLayout.vue`
3. 所有 `showXxxPanel = !isWorkbenchEmbedded || ...` 模式判断迁移到 embedded wrapper 统一裁剪。

阶段 3 验收标准：

1. TaskDetailCore 中不再出现 `route.query.workbench`。
2. 嵌入态和独立页差异主要体现在 wrapper，而不是核心逻辑。

### 阶段 4：评估是否移除 iframe

这是可选阶段，不建议现在立即做。

只有在阶段 1 到 3 完成后，才值得评估：

1. 继续保留 iframe，保持强隔离。
2. 改为组件级直挂载，提升状态共享能力。

当前更推荐：

1. 先保留 iframe。
2. 等 Embedded TaskDetail wrapper 稳定后，再评估是否无 iframe 化。

原因：

1. 现有 reply focus window、fork、深链路都已经围绕页面边界构建。
2. 现在直接去 iframe，会把结构治理问题和运行时隔离问题混在一起。

## 8. 优先级建议

如果只能做一轮重构，推荐优先级如下：

1. **最高优先级：拆 TaskDetail 双模。**
2. **第二优先级：拆 Workbench store 的 IO 职责。**
3. **第三优先级：拆 Workbench 页面壳组件。**
4. 第四优先级：评估 iframe 去留。

原因很直接：

1. 体量和耦合最大的是真正的 TaskDetail 双模。
2. 只拆 Workbench 页面，对整体维护性帮助有限。

## 9. 风险与注意事项

### 9.1 不要同时改视觉和结构

这一轮要解决的是边界问题，不是视觉问题。否则很难判断回归来自 UI 文案还是结构迁移。

### 9.2 不要先改接口

现阶段问题主要在前端边界，不在 API 形状。先稳住接口，再拆前端。

### 9.3 要保留现有深链路

以下入口属于当前系统稳定能力，拆分时应保持兼容：

1. `/workbench?task=...`
2. `/tasks/:taskId?embedded=1&workbench=1`
3. `/tasks/:taskId?embedded=1&workbench=1&reply=1`

### 9.4 要补专门的桥接测试

当前测试很多，但大多是页面行为回归。拆分后需要新增“协议层测试”，否则复杂度只是换地方隐藏。

## 10. 建议落地顺序

建议按下面顺序推进：

1. 新建 `TaskDetailPage.vue` 和 `TaskDetailEmbeddedLayout.vue`，把现有历史 `control-plane/web-ui/src/pages/TaskDetail.vue` 先包起来。
2. 把 `isWorkbenchEmbedded` 相关的布局裁剪搬到 embedded wrapper。
3. 提取 `useWorkbenchBridge.ts` 和 `useWorkbenchPersistence.ts`。
4. 最后再把 [control-plane/web-ui/src/pages/TaskWorkbench.vue](../../../control-plane/web-ui/src/pages/TaskWorkbench.vue) 切成 toolbar、tabs、split-layout。

这样做的好处是：

1. 先打断最大耦合源头。
2. 后续 Workbench 页面拆分会自然很多。

## 11. 最终判断

最终判断如下：

1. 当前任务工作台前端**不是功能过多，而是边界过于模糊**。
2. 单独看 Workbench 页不算太离谱，但放在整个“Workbench + Embedded TaskDetail + store”系统里，复杂度已经明显偏高。
3. **可以拆，而且拆分收益会很直接。**
4. 最值得优先拆的是 TaskDetail 的双模结构，而不是先纠结 Workbench 页是不是 600 行。

如果要把这件事做成一轮低风险重构，建议把目标定义为：

**把任务工作台从“页面拼页面”演进为“Shell + Bridge + Persistence + DetailCore/EmbeddedWrapper”的结构。**
