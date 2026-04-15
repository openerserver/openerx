# 多任务监控台 API 清单

本文整理页面 `/multi-task-monitor` 在前端运行时实际使用到的 API、参数和调用场景。

说明：

- 这里只列出多任务监控台页面本身直接调用，或通过同页依赖的 store 间接触发的接口。
- 页面内没有发现写操作接口，当前行为以读取和实时订阅为主。

## 页面入口

- 路由：`/multi-task-monitor`
- 页面文件：`control-plane/web-ui/src/pages/MultiTaskMonitor.vue`
- 任务列表关联入口：`control-plane/web-ui/src/pages/Tasks.vue`

## 直接使用的接口

| 类别 | 接口 / 协议 | 页面调用位置 | 入参 | 实际请求参数 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 项目列表 | `listProjects(orgId?)` | 页面挂载时调用 `projectStore.loadProjects()` | `orgId?: string` | `GET /api/projects`，可选 `orgId` | 用于初始化项目下拉框。页面通常不传 `orgId`。 |
| 任务列表 | `listTasks(projectId?, status?)` | `reloadTaskPicker()`、`ensureTaskPickerRefreshTimer()` 间接触发 | `projectId?: string`，`status?: string` | `GET /api/tasks?projectId=...&limit=200` | 用于“添加任务到监控台”和“导入运行中”。页面只传 `projectId`，`status` 未使用。接口内部固定追加 `limit=200`。 |
| 任务详情 | `getTask(taskId)` | `refreshNodeSummary(taskId)` | `taskId: string` | `GET /api/tasks/{taskId}` | 监控卡片标题、状态、模型等摘要的基础数据来源。 |
| 任务分支 / 会话 | `getTaskBranches(taskId)` | `refreshNodeSummary(taskId)` | `taskId: string` | `GET /api/tasks/{taskId}/branches` | 用于识别 active session，并取回会话列表。 |
| 任务 pipeline | `getTaskPipeline(taskId, sessionId?)` | `refreshNodeSummary(taskId)` | `taskId: string`，`sessionId?: string` | `GET /api/tasks/{taskId}/pipeline`，可选 `sessionId` | 用于展示阶段进度、当前 stage 标签和汇总信息。页面当前未显式传 `sessionId`。 |
| 会话消息 / 运行轨迹 | `getTaskConversationMessages(taskId, sessionId, options?)` | `refreshSessionMessagesForMonitor(taskId, sessionId)` | `taskId: string`，`sessionId: string`，`options?: { includeLineage?: boolean; includeDebug?: boolean }` | 间接请求 `GET /api/tasks/{taskId}/execution-trace?sessionId=...` | 用于实时回复、工具调用摘要和消息流。页面当前只传 `taskId` 和 `sessionId`。 |

## 间接依赖接口

### 1. `projectStore.loadProjects()` -> `listProjects(orgId?)`

页面在挂载时调用项目 store 的加载方法，实际触发 `listProjects`。

- 调用文件：`control-plane/web-ui/src/pages/MultiTaskMonitor.vue`
- store 文件：`control-plane/web-ui/src/stores/project.ts`
- 请求形式：`GET /api/projects`
- 参数：
  - `orgId?: string`

### 2. `getTaskConversationMessages()` -> `getTaskExecutionTraceView(taskId, sessionId, options?)`

消息流并不是单独查“聊天记录”，而是从 execution trace 派生出来的。

- 请求形式：`GET /api/tasks/{taskId}/execution-trace?sessionId=...`
- 参数：
  - `taskId: string`
  - `sessionId?: string`
  - `includeLineage?: boolean`
  - `includeDebug?: boolean`

页面当前使用方式：

- 传 `taskId`
- 传 `sessionId`
- 不传 `includeLineage`
- 不传 `includeDebug`

## 实时通道

页面依赖全局 realtime store 来接收任务级增量事件。多任务监控台本身不负责建立连接，但会订阅任务。

### WebSocket 连接

- 连接地址：`/ws?token={token}`
- 触发位置：全局 `control-plane/web-ui/src/stores/realtime.ts`
- 说明：页面本身不直接调用 `connect()`，但如果全局 realtime store 没有连上，这个页面的实时刷新会退化为轮询。

### 订阅消息

| 事件类型 | 发送体 | 页面触发位置 | 说明 |
| --- | --- | --- | --- |
| 订阅任务 | `{ type: "subscribe_task", taskId }` | 监控台新增任务节点后 | 这是页面最关键的实时输入，用于接收任务级事件。 |

说明：

- 监控台当前没有调用 `subscribe_project`。
- `taskId` 来自监控台节点列表，节点变化时会重新订阅。

## 页面内的调用节奏

- 初次进入页面时：加载项目列表、加载任务列表、拉取已投放任务的详情/分支/pipeline/消息。
- 每 10 秒：重新拉取任务列表，并对当前监控中的任务做批量刷新。
- 节点新增时：立即刷新该任务的详情、分支、pipeline、消息，并订阅实时事件。

## 结论

多任务监控台当前依赖的后端能力可以归纳为：

1. 项目列表：`GET /api/projects`
2. 任务列表：`GET /api/tasks`
3. 任务详情：`GET /api/tasks/{taskId}`
4. 任务分支：`GET /api/tasks/{taskId}/branches`
5. 任务 pipeline：`GET /api/tasks/{taskId}/pipeline`
6. 任务 execution trace：`GET /api/tasks/{taskId}/execution-trace`
7. 实时 WebSocket：`/ws?token=...` + `subscribe_task`

如果后续需要，我可以继续把这份清单扩展成“请求/响应字段级别”的版本。