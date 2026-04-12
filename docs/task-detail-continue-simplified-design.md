# TaskDetail Continue 简化方案（接口与页面职责）

> 状态：Draft v1
> 日期：2026-04-11
> 作者：GitHub Copilot
> 关联文档：[task-detail-continue-sequence-diagrams.md](task-detail-continue-sequence-diagrams.md)、[task-detail-message-state-machine-plan.md](task-detail-message-state-machine-plan.md)、[task-detail-realtime-event-contract.md](task-detail-realtime-event-contract.md)、[task-detail-continue-simplified-migration-checklist.md](task-detail-continue-simplified-migration-checklist.md)、[task-detail-continue-target-module-architecture.md](task-detail-continue-target-module-architecture.md)

## 1. 文档目的

这份文档给出一版更简单的 TaskDetail 方案，只回答两个问题：

1. continue 相关接口应该收敛成什么样
2. 页面、BFF、realtime 各自应该负责什么

目标不是在现有实现上继续加兼容层，而是把主链路重新压缩成一个容易理解、容易验证、容易维护的最小闭环。

## 2. 现状问题与根因

当前复杂度主要不是业务需求本身造成的，而是职责边界被揉在了一起。

1. `continue` 同时承载了普通续聊、parallel compare、sequential-chain 三类能力。
2. 页面同时承担发送编排、session 切换、流式 overlay 合并、持久化回读收敛四类职责。
3. BFF route、SSE aggregator、页面 store 都在各自补一遍状态机。

结果是：

1. 任意一类新能力都会污染主聊天链路。
2. realtime 与 snapshot 不再是清晰的“真源 + patch”关系。
3. 前后端都需要处理大量“如果是 parallel / 如果是 sequential / 如果是 child session”的分支。

## 3. 重设计原则

### 3.1 continue 只做一件事

`continue` 只表示“基于当前轮次，再发一条新的用户输入，并得到一条主回复”。

它不再承担：

1. 并行候选比较
2. 顺序步骤执行
3. 前端排队续发

### 3.2 对外统一成 round，内部仍可保留 session

对页面与公共接口，统一暴露 round 概念：一轮 round 对应一次用户输入和一次主回复。

内部仍可继续使用现有 session / lineage / runtime session 作为实现细节，不要求第一阶段重写底层存储。

### 3.3 compare 与 workflow 是外挂能力，不是 continue mode

1. compare 是独立入口，用来生成多个候选结果并采纳 winner。
2. workflow 是独立入口，用来执行顺序步骤并查看步骤状态。
3. 主聊天页始终只消费一个 active round 的消息流。

### 3.4 页面只消费稳定 task-domain DTO

页面不再解析 runtime 原始事件，也不再自己推断“这是不是一条完成态 assistant”。

页面只消费：

1. REST 读接口返回的 round / message DTO
2. websocket 推送的稳定 `task.*` patch

## 4. 目标领域模型

```ts
type RoundStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface TaskRoundDto {
  id: string;
  taskId: string;
  sessionId: string;
  parentSessionId?: string;
  kind: "continue" | "compare-candidate" | "workflow-step";
  source: "continue" | "compare" | "workflow";
  status: RoundStatus;
  promptText: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

说明：

1. round 是对页面暴露的公共抽象。
2. 一个 round 背后可以继续由一个 runtime child session 承载。
3. 比较候选和 workflow step 也都可以映射为 round，但不会混进主 continue 接口。

## 5. 简化后的接口设计

### 5.1 主聊天 continue 接口

```http
POST /api/tasks/:taskId/continue
Content-Type: application/json

{
  "prompt": "继续完善登录失败重试逻辑",
  "parentRoundId": "round_xxx"
}
```

返回：

```json
{
  "taskId": "task_xxx",
  "round": {
    "id": "round_yyy",
    "sessionId": "session_yyy",
    "parentSessionId": "session_xxx",
    "kind": "continue",
    "source": "continue",
    "status": "running",
    "promptText": "继续完善登录失败重试逻辑",
    "createdAt": "2026-04-11T10:00:00.000Z"
  }
}
```

语义约束：

1. 每次 continue 必定创建一个新的 child round。
2. 请求里不再传 `executionMode`。
3. 如果当前 active round 仍在运行，接口直接返回 `409 round_in_progress`。
4. 前端不再维护 continue 队列。

辅助读接口：

```http
GET /api/tasks/:taskId/current-round
GET /api/tasks/:taskId/rounds/:roundId/messages
GET /api/tasks/:taskId/rounds
```

### 5.2 compare 独立接口

```http
POST /api/tasks/:taskId/compare
Content-Type: application/json

{
  "prompt": "给出 3 个不同实现方案",
  "baseRoundId": "round_xxx",
  "candidates": [
    { "label": "Fast", "model": "openai/gpt-5.4-mini" },
    { "label": "Balanced", "model": "openai/gpt-5.4" },
    { "label": "Deep", "model": "anthropic/claude-opus" }
  ]
}
```

返回：

```json
{
  "taskId": "task_xxx",
  "compareRunId": "compare_123",
  "candidateRounds": [
    { "id": "round_a", "status": "running" },
    { "id": "round_b", "status": "running" },
    { "id": "round_c", "status": "running" }
  ]
}
```

第一阶段约束：

1. compare 候选只在 compare 面板里展示。
2. 候选结果第一版只要求结果态，不要求像主聊天一样逐 token 流式展示。
3. 只有用户采纳 winner 后，winner 对应结果才进入主聊天历史。

采纳接口：

```http
POST /api/tasks/:taskId/compare/:compareRunId/adopt
Content-Type: application/json

{
  "roundId": "round_b"
}
```

### 5.3 workflow 独立接口

```http
POST /api/tasks/:taskId/workflows
Content-Type: application/json

{
  "steps": [
    { "title": "分析问题", "prompt": "先定位根因" },
    { "title": "给出方案", "prompt": "给出改造方案" },
    { "title": "整理输出", "prompt": "生成最终结论" }
  ]
}
```

返回：

```json
{
  "taskId": "task_xxx",
  "workflowRunId": "workflow_123",
  "status": "running",
  "currentStepIndex": 0,
  "totalSteps": 3
}
```

语义约束：

1. workflow 只从 workflow 入口启动。
2. `continue` 接口永远不再接受 `sequential-chain`。
3. step 自动推进属于 workflow executor 内部职责，不属于聊天页职责。

## 6. 简化后的 realtime 合同

主聊天页只需要 5 类领域事件：

1. `task.round.started`
2. `task.message.updated`
3. `task.message.delta`
4. `task.round.finished`
5. `task.reconcile.required`

要求：

1. `task.message.updated` 必须是可直接写入 normalized store 的完整 patch。
2. `task.message.delta` 只用于当前 active round 的流式正文追加。
3. 页面收到未知 gap 或乱序时，不做复杂补丁，直接触发 silent reconcile。

compare 与 workflow 可以各自拥有独立事件：

1. `task.compare.updated`
2. `task.workflow.updated`

它们不进入主聊天消息 reducer。

## 7. 页面职责划分

### 7.1 TaskDetail 主聊天页

只负责：

1. 展示当前 active round 的消息流
2. 提交 continue
3. 展示当前 round 的运行状态
4. 停止当前 round
5. 浏览 round 历史

不再负责：

1. continue 排队
2. parallel candidate 聚合
3. workflow step 推进
4. 解析 runtime 原始事件
5. 合并 persisted messages 和 raw realtime overlay

### 7.2 Compare 面板或抽屉

只负责：

1. 发起 compare
2. 展示多个 candidate round 的结果
3. 展示模型与耗时等元数据
4. 采纳 winner

不再负责：

1. 主聊天流式渲染
2. 把候选卡插回主时间线中实时抖动更新

### 7.3 Workflow 面板或独立区域

只负责：

1. 启动 workflow
2. 展示 step 状态
3. 展示当前 step 输出与最终汇总
4. 取消或重试 workflow

不再负责：

1. 复用 continue composer
2. 复用主聊天消息状态机

## 8. 前后端模块职责

### 8.1 web-ui

1. realtime store 只负责连接、订阅、去重，不负责业务归并。
2. `useRoundMessages` 负责单 round normalized message state。
3. `useTaskDetailActionCoordinator` 只保留发送 continue、停止 round、切换历史 round。
4. compare 与 workflow 各自拥有独立 composable，不再塞进 TaskDetail 主链路。

### 8.2 web-ui-bff

1. `continue` route 只做 child round 创建、prompt 持久化、runtime 启动。
2. `compare` route 单独负责 candidate round 批量启动与采纳。
3. `workflow` route 单独负责 step workflow 的启动与状态查询。
4. broadcaster 对外只发布稳定 task-domain DTO，不把 runtime 原始事件直接透给页面。

### 8.3 service / runtime

1. session lineage 仍可作为底层实现。
2. message 持久化仍以 canonical message 表为真源。
3. workflow step 自动推进保留在 workflow executor 内，不再挂在 continue 主链路上。

## 9. 推荐改造顺序

1. 第一阶段：把 continue UI 和接口收敛成 single-only，移除 `executionMode`。
2. 第二阶段：为主聊天页补 round DTO 与单 round message store。
3. 第三阶段：把 parallel compare 从 TaskDetail 主聊天链路拆成独立 compare feature。
4. 第四阶段：把 sequential-chain 从 continue 语义中彻底移除，只保留 workflow 入口。

## 10. 预期收益

这版方案的收益不是功能变少，而是边界更清楚：

1. 主聊天只解决一轮对话的发送与展示。
2. compare 只解决多候选比较与采纳。
3. workflow 只解决多步骤执行。
4. 页面、BFF、aggregator 不再各自维护一套半重叠状态机。
5. 测试可以按 continue / compare / workflow 三条链分别覆盖，不再互相牵连。