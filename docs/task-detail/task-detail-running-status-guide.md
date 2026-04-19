# TaskDetail 运行中状态判断说明

> 状态：2026-04-18 当前实现说明
> 适用范围：Task 页、Workbench tab、TaskDetailV3、BFF 聚合读路径、service task status 归一化读路径
> 关联文档：
>
> - [../task-domain/task-session-requirements-comprehensive.md](../task-domain/task-session-requirements-comprehensive.md)
> - [task-detail-display-write-logic.md](task-detail-display-write-logic.md)
> - [taskdetail-v3-page-dataflow.md](taskdetail-v3-page-dataflow.md)

## 1. 这份文档回答什么问题

这份文档只回答一个具体问题：**系统现在是如何判断“当前任务正在运行中”的**。

这里的“运行中”不是单看某一个数据库字段，也不是单看页面上某个 `running` 字符串，而是一个跨三层的收敛结果：

1. service 先把 task / snapshot / phase 的状态归一成公共 `TaskStatus`；
2. BFF 再把 `/api/tasks/:id` 作为页面主状态来源；
3. 前端最后再决定当前页面是否真的要显示“执行中”。

最近这份规则之所以必须单独写出来，是因为之前出现过一类典型漂移：**phase 实际已经终态完成，但 snapshot 或 lineage 写路径还把 task 保持在 `running`，导致页面长时间误显示“执行中”**。

这次收口后的目标很明确：

- 只有在**有明确证据**时，才判断任务仍在运行中；
- 否则默认应更保守地落到“已完成 / 已失败 / 已取消”，而不是继续显示“执行中”。

## 2. 先分清三个概念

判断“当前运行中”之前，必须先把下面三个概念分开。

### 2.1 持久化生命周期

来自 `tasks.lifecycle_status`，值域是：

```text
draft -> active -> done -> archived
```

它表达的是 task 作为业务对象的大生命周期，不直接等于“此刻是否真的还在执行”。

### 2.2 公共任务状态

对外返回给 Web UI 的 `task.status` 不是直接读取 `tasks.lifecycle_status`，而是 service 通过共享 helper 归一出来的公共状态。

当前公共状态值域是：

```text
pending | running | paused | awaiting_adoption | completed | failed | cancelled
```

### 2.3 页面执行态

TaskDetailV3 真正用来决定是否显示“执行中”的不是“只要 `task.status === running` 就算执行中”，而是一个更严格的前端布尔值 `isExecuting`。

也就是说：

- `task.status` 是页面主状态；
- `isExecuting` 是页面对“此刻是否仍在执行”的进一步收紧判断。

## 3. 后端如何收敛出主状态

### 3.1 主状态归一公式

service 统一通过 `public-task-status.ts` 的 `resolvePublicTaskStatus(...)` 计算公共 `status`。

当前优先级是：

```text
authoritativeStatus -> currentExecutionStatus -> fallbackStatus -> lifecycleStatus -> pending
```

其中最关键的是第一位：`authoritativeStatus`。

### 3.2 authoritativeStatus 只接受明确终态

`normalizeAuthoritativeTaskStatusValue(...)` 当前只接受下面三种值作为权威覆盖：

```text
completed | failed | cancelled
```

这意味着：

- `running` 不能作为 authoritative override；
- `awaiting_adoption` 不能作为 authoritative override；
- 只有**明确终态**才能压过 stale running snapshot。

这是这次收口的核心设计之一，因为之前的主要问题不是“终态不够强”，而是“running 太容易成立”。

### 3.3 relevant phase 的选择规则

service 在 project-tree task read 和 snapshot read 中，会先找“当前最相关的 phase”：

1. 先用 `currentPhaseId`；
2. 如果没有，再退到 `latestPhaseId`。

然后取这个 phase 的 `status` 做 terminal override 判断。

如果这个 relevant phase 已经是：

- `completed`
- `failed`
- `cancelled`

那么它的终态应优先于 snapshot 里残留的 `running`。

### 3.4 winner session 会纠正当前 session 指向

如果 relevant phase 已经 `completed`，且它有 `winnerSessionId`，那么读路径还会把当前 session 纠正到 winner，而不是继续保留旧的 loser session。

这样做的原因是：

- 终态不只是一个 `completed` 字符串；
- 它还意味着“当前主线应该已经收敛到 winner”。

### 3.5 哪些数据不能当“运行中真相”

下面这些值都不能单独拿来判断“当前仍在运行中”：

1. `tasks.lifecycle_status = active`
2. `task_snapshots.lifecycle_status = active`
3. project tree payload 上残留的历史 `running`
4. 仅凭某个候选节点还存在，就反推出主 task 仍在运行

当前统一约束是：**Task 页和 Workbench tab 的主状态以 `/api/tasks/:id` 的显式 `status` 为准**。

## 4. 为什么终态不会再轻易被刷回 running

光把读路径改对还不够，还必须堵住写路径把 terminal task 刷回 running 的问题。

### 4.1 terminal task 下 branch/session 写入会被动化

`task-branch-write.ts` 现在新增了 terminal task 保护：

- `upsertTaskBranch(...)`
- `persistTaskBranchMessage(...)`
- `activateTaskBranch(...)`

在 task 已终态或已经有 `finishedAt` 的情况下，都会强制把 `isActive` 视为 `false`，并停止把父 task snapshot 再同步回 running。

### 4.2 采纳完成后会主动关闭 active lineage

BFF 在并行候选采纳完成后，会额外关闭仍然 active 的 lineage session。

这样做是因为过去的一个深层根因是：

- task 已被 patch 成 completed；
- 但 root / candidate lineage 还保持 active；
- 后续 message 或 session 写入又把 snapshot 带回 running。

现在这条回流链已经被截断。

## 5. 前端现在如何判断“当前运行中”

前端当前实现位于 `useTaskDetailDerivedState.ts`。

判定逻辑不是“只要 `task.status === running` 就显示执行中”，而是下面这组更严格的条件：

```text
isExecuting =
  task 存在
  AND task.status === "running"
  AND task.finishedAt 为空
  AND 至少存在一条明确运行证据
```

### 5.1 明确运行证据的定义

当前任意满足一条即可：

1. `task.agentRunId` 非空
2. `task.currentRunId` 非空
3. `task.currentRunStatus` 属于 `running | paused | awaiting_adoption`
4. `task.activeCandidateCount > 0`
5. `task.currentRunCandidateCount > 0`
6. 页面上下文里 `currentPhaseId` 非空

### 5.2 哪些情况即使带着 running 字样也不会显示执行中

下面这些情况现在都会被压回 `isExecuting = false`：

1. `task.status !== running`
2. `task.finishedAt` 已经存在
3. `task.status = running`，但上面六条明确运行证据一条都没有

这正是这次收口的前端目标：**避免“只要 status 还是 running 就继续显示执行中”**。

## 6. 当前规则下的判定样例

| 场景 | 后端主状态 | 前端 `isExecuting` | 说明 |
| ------ | ------------ | -------------------- | ------ |
| phase 已 `completed`，snapshot 仍是 `running` | `completed` | `false` | terminal phase 覆盖 stale running |
| task.status = `running`，但没有任何 run/phase/candidate 证据 | `running` | `false` | 这是“保守不判运行中”的关键变化 |
| task.status = `running`，且 `agentRunId` 存在 | `running` | `true` | 有明确执行句柄 |
| task.status = `running`，且 `currentPhaseId` 存在 | `running` | `true` | 有明确当前 phase |
| task.status = `completed`，但 `activeCandidateCount` 残留 > 0 | `completed` | `false` | completed 不能再被候选数反推成运行中 |
| task.status = `running`，但 `finishedAt` 已存在 | `running` | `false` | finishedAt 优先阻断执行态 |

## 7. 推荐排查顺序

如果后续再遇到“页面还显示执行中，但实际上已经结束”的问题，排查顺序固定如下：

1. 先看 `/api/tasks/:id` 的显式 `status`。
   - 如果这里已经是 `completed / failed / cancelled`，前端不应再显示执行中。
2. 再看 snapshot 的 `currentPhaseId / latestPhaseId / currentExecutionStatus`。
   - 确认 relevant phase 是否已经终态。
3. 再看 phase 本身的 `status / winnerSessionId / finishedAt`。
   - 如果 phase 已 `completed` 且有 winner，主 session 应该已经收敛到 winner。
4. 最后看 task sessions 是否还存在不该存在的 active lineage。
   - 如果采纳已完成，但 root/candidate 还 active，就说明写侧清理有问题。

## 8. 一句话结论

当前系统对“运行中”的判断已经收紧为：**先由 service 用 phase 终态压住 stale running，再由前端要求必须存在明确运行证据；如果没有强证据，就不要再显示执行中。**
