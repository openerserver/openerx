# PG 事件溯源、搜索与增量推送优化方案

> 状态：可选优化草案，非任务域主链路收尾阻塞项  
> 日期：2026-03-21  
> 关联文档：[project-tree-storage-design.md](project-tree-storage-design.md)

> 说明：本文讨论的是 `project_tree_events` 这一历史兼容链路的可选优化与收敛，不再代表 task/session/timeline 当前主读写架构，也不再构成任务域主读收尾的必做项。当前主路径已经切到 `conversation_*`、`task_domain_events` 与 `task_timeline_views`。

## 0. 背景与动机

本文档用于承接 [project-tree-storage-design.md](project-tree-storage-design.md) 中已单列出来的可选优化项，将 `pg_trgm` 搜索能力与基于 `project_tree_events` 的增量推送能力，统一收敛到一份“树模型后续优化方案”中。

历史实现里的 `project_tree_events` 曾采用纯追加（append-only）事件溯源模式存储所有对话消息。
在旧写路径里，每次 OpenCode Runtime 发出 `message.updated` SSE 事件，BFF 的 `persistSessionMessageSnapshot()` 都会向 CP Service 发送完整消息快照，Service 端写入 **2~3 行事件**（created/updated + snapshot + 可选 completed）。

如果后续仍选择继续维护项目树侧搜索与增量读面，历史项目树兼容层主要还有两项可补强能力：

1. 基于 `pg_trgm` 的项目内消息 / 上下文模糊搜索。
2. 基于 `project_tree_events` 的增量推送 / 增量拉取能力，用于替代高频全量回放与整段消息重载。

因此，本方案不再只讨论事件表存储膨胀问题，而是统一覆盖三类可选优化目标：

1. **写入更轻**：减少 `project_tree_events` 的写放大。
2. **读取更快**：消息列表、增量时间线、搜索结果都不再依赖大范围事件回放。
3. **能力补齐**：在确有产品需求时，再把树侧项目级搜索与实时 / 增量同步能力一并落地。

### 0.1 写放大分析

一条典型的 assistant 消息在 streaming 过程中会触发 10–20 次 `message.updated` SSE 事件（每次 LLM 返回新的 content delta），每次触发会写入 2–3 行事件：

| SSE 触发次数 | 事件类型 | 每次 INSERT 行数 | 累计 |
|---|---|---|---|
| 第 1 次 | `session.message.created` + `session.message.snapshot` | 2 | 2 |
| 第 2~N 次 | `session.message.updated` + `session.message.snapshot` | 2 | 2(N-1) |
| 最后 1 次（含 completedAt）| `session.message.updated` + `session.message.completed` + `session.message.snapshot` | 3 | 3 |

**一条 assistant 消息** = **2N + 1 行事件**（假设 N=15 次 SSE → **31 行**）。

每行 `session.message.snapshot` 携带完整消息 JSON（payload 含 `message` 字段），后期消息体可达 2–10 KB。

### 0.2 读放大分析

当前读取路径 `loadPersistedSessionEventsForNode()` 会：
1. 加载某 session node 下 **全部** 事件（`ORDER BY seq ASC`）
2. 用 `buildPersistedSessionMessages()` 做 last-write-wins 合并（只保留每个 messageId 的最新 snapshot）

session 生命周期越长，需要读取的冗余事件越多。1 个 session 内如果有 50 条消息 × 15 次快照/消息 = **750 行事件**，但实际只需要最终 **50 行快照**。

### 0.3 增长预估

| 指标 | 当前（日均） | 半年后预估 | 一年后预估 |
|---|---|---|---|
| 活跃任务数 | ~50 | ~500 | ~2,000 |
| 消息数/任务 | ~30 | ~30 | ~50 |
| SSE 事件/消息 | ~15 | ~15 | ~20 |
| 事件行数/天 | ~45,000 | ~450,000 | ~4,000,000 |
| 存储增量/天 | ~200 MB | ~2 GB | ~15 GB |

---

## 1. 优化目标

这些目标适用于“继续保留并增强 `project_tree_events` 侧搜索/增量读面”的前提，不应再解读为当前任务域主链路的必达 gate。

| 目标 | 量化指标 |
|---|---|
| **降低写放大** | 每条消息写入从 ~31 行降为 ≤ 5 行 |
| **降低读延迟** | 消息列表查询从全量扫描降为单行读取 |
| **补齐项目级搜索** | 项目内消息 / context 搜索 P95 < 200ms（10 万 message 节点量级） |
| **补齐增量推送** | 前端支持基于 cursor / seq 拉取新增事件，避免全量重放 |
| **控制存储增长** | 事件表体积增长不超过优化前的 30% |
| **保留审计能力** | 全量事件仍可查（冷存），不丢失任何历史 |
| **零停机** | 所有变更可在线滚动部署，无需锁表或停服 |

---

## 2. 优化措施总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 措施 1: BFF 侧节流 — 减少写入源头                                │
│ 措施 2: 物化最终快照 — 加速消息读取                               │
│ 措施 3: `pg_trgm` 搜索读面 — 补齐项目级模糊搜索                    │
│ 措施 4: 基于 events 的增量推送 — 补齐实时 / 增量消费能力           │
│ 措施 5: 分区 + TTL — 控制事件表体积                               │
│ 措施 6: 索引优化 — 提升查询效率                                   │
│ 措施 7: 冷热分离 — 长期可持续                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 措施 1：BFF 侧写入节流（Throttle + Dedup）

### 3.1 问题

`persistSessionMessageSnapshot()` 在每次 `message.updated` SSE 事件时都无条件发起 HTTP POST，streaming 期间同一条消息的中间快照被大量写入。

### 3.2 方案

在 BFF `SSEAggregator` 中增加 **per-message 节流** + **内容去重**：

```typescript
// sse-aggregator.ts — 新增节流逻辑

// ── 配置 ──
const SNAPSHOT_THROTTLE_MS = 3000;       // 最小间隔 3 秒
const SNAPSHOT_FINAL_DELAY_MS = 500;     // 消息完成后延迟 500ms 确保最终快照落盘

// ── 状态 ──
private snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
private lastSnapshotTime = new Map<string, number>();
private lastSnapshotHash = new Map<string, string>();

private scheduleMessageSnapshotPersist(event: RealtimeEvent): void {
  if (event.type !== "message.updated" || !event.taskId || !event.sessionId) {
    return;
  }

  const messageId = this.extractMessageId(event.data);
  if (!messageId) return;

  const key = `${event.taskId}:${event.sessionId}:${messageId}`;

  // ── 内容去重：payload hash 未变则跳过 ──
  const hash = this.computeSnapshotHash(event.data);
  if (this.lastSnapshotHash.get(key) === hash) return;

  // ── 检测最终快照：含 completedAt 时立即写入 ──
  const isComplete = this.isMessageComplete(event.data);
  if (isComplete) {
    this.flushSnapshot(key, event);
    return;
  }

  // ── 节流：距上次写入不足 THROTTLE_MS，则排队等待 ──
  const lastTime = this.lastSnapshotTime.get(key) || 0;
  const elapsed = Date.now() - lastTime;

  if (elapsed >= SNAPSHOT_THROTTLE_MS) {
    this.flushSnapshot(key, event);
  } else {
    // 取消旧 timer，设置新 timer（trailing edge）
    const existingTimer = this.snapshotTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    this.snapshotTimers.set(
      key,
      setTimeout(() => {
        this.flushSnapshot(key, event);
      }, SNAPSHOT_THROTTLE_MS - elapsed),
    );
  }
}

private flushSnapshot(key: string, event: RealtimeEvent): void {
  const timer = this.snapshotTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    this.snapshotTimers.delete(key);
  }

  const hash = this.computeSnapshotHash(event.data);
  this.lastSnapshotHash.set(key, hash);
  this.lastSnapshotTime.set(key, Date.now());

  void this.persistSessionMessageSnapshot(event).catch((error) => {
    console.error(`Failed to persist message snapshot for task ${event.taskId}:`, error);
  });
}

private computeSnapshotHash(data: unknown): string {
  // 取 message text + part count 作为轻量 hash，避免 JSON.stringify 全量
  const text = extractPersistedMessageText(data) ?? "";
  const parts = extractPersistedMessagePartTypes(data);
  return `${text.length}:${parts?.join(",") || ""}`;
}
```

### 3.3 效果预估

| 指标 | 优化前 | 优化后 |
|---|---|---|
| SSE → HTTP POST 次数/消息 | ~15 | ~4–5（首次 + 每 3s 一次 + 最终） |
| 事件行数/消息 | ~31 | ~9–11 |
| **写放大降幅** | — | **约 65%** |

### 3.4 改动文件

| 文件 | 变更 |
|---|---|
| [sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) | 新增节流逻辑，替换原 `persistSessionMessageSnapshot` 调用点 |

---

## 4. 措施 2：物化最终快照（Materialized Snapshots）

### 4.1 问题

当前读取消息列表时必须加载该 session 下 **所有** 事件，然后在内存中做 last-write-wins 合并。随着消息数增长，查询性能线性退化。

### 4.2 方案

在 `project_tree_nodes` 中新增一列 `message_snapshot`，在消息完成时写入最终快照；读取时直接查这一列，**不再需要回放事件**。

#### 4.2.1 Schema 变更

```sql
-- 新增迁移文件
ALTER TABLE project_tree_nodes
  ADD COLUMN message_snapshot JSONB;

-- 为消息节点快照查询添加索引（仅在 message_snapshot 不为 null 时索引）
CREATE INDEX idx_ptn_message_snapshot
  ON project_tree_nodes (parent_id, created_at)
  WHERE message_snapshot IS NOT NULL;
```

对应 Drizzle schema 变更：

```typescript
// schema.pg.ts — projectTreeNodes 新增列
messageSnapshot: jsonb("message_snapshot").$type<Record<string, unknown>>(),
```

#### 4.2.2 写入时机

在 `POST /:taskId/branches/messages` 路由中，**当检测到消息完成**（`completedAt` 存在）时，同步将快照写入对应的 message node：

```typescript
// tasks/routes.ts — 在写入事件之后

// ── 物化最终快照 ──
if (completedAt) {
  const messageNodeId = getMessageNodeId(nodeId, messageId);
  const existingMessageNode = await db.query.projectTreeNodes.findFirst({
    where: eq(projectTreeNodes.id, messageNodeId),
  });

  if (existingMessageNode) {
    // 更新已有 message node 的快照
    await db
      .update(projectTreeNodes)
      .set({
        messageSnapshot: body.message as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(projectTreeNodes.id, messageNodeId));
  } else {
    // 创建 message node 并写入快照
    await db.insert(projectTreeNodes).values({
      id: messageNodeId,
      projectId: task.projectId,
      parentId: nodeId, // session node
      path: buildChildPath(sessionNode.path, "message", messageNodeId),
      depth: sessionNode.depth + 1,
      nodeType: "message",
      role: eventSummary.role,
      contentText: eventSummary.text?.slice(0, 500) ?? null, // 文本摘要
      contentJson: { tokenUsed: eventSummary.tokenUsed, partTypes: eventSummary.partTypes },
      runtimeSessionId: body.runtimeSessionId,
      runtimeMessageId: messageId,
      messageSnapshot: body.message as Record<string, unknown>,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}
```

#### 4.2.3 优化后的读取路径

```typescript
async function getSessionMessagesOptimized(
  projectId: string,
  sessionNodeId: string,
): Promise<Record<string, unknown>[]> {
  // 优先从 message_snapshot 读取（O(1) per message）
  const messageNodes = await db
    .select({
      id: projectTreeNodes.id,
      messageSnapshot: projectTreeNodes.messageSnapshot,
      createdAt: projectTreeNodes.createdAt,
    })
    .from(projectTreeNodes)
    .where(
      and(
        eq(projectTreeNodes.parentId, sessionNodeId),
        eq(projectTreeNodes.projectId, projectId),
        eq(projectTreeNodes.nodeType, "message"),
        isNotNull(projectTreeNodes.messageSnapshot),
      ),
    )
    .orderBy(asc(projectTreeNodes.createdAt));

  if (messageNodes.length > 0) {
    return messageNodes
      .map((n) => n.messageSnapshot)
      .filter((s): s is Record<string, unknown> => s !== null);
  }

  // Fallback: 事件回放（兼容尚未物化的老数据）
  const events = await loadPersistedSessionEventsForNode(projectId, sessionNodeId);
  return buildPersistedSessionMessages(events);
}
```

#### 4.2.4 存量数据回填

对已有 `session.message.completed` 事件但尚未物化快照的历史数据，运行一次性脚本回填：

```typescript
// scripts/backfill-message-snapshots.ts

async function backfillMessageSnapshots() {
  const completedEvents = await db
    .select()
    .from(projectTreeEvents)
    .where(eq(projectTreeEvents.eventType, "session.message.completed"))
    .orderBy(asc(projectTreeEvents.seq));

  for (const event of completedEvents) {
    const messageId = event.payload.messageId as string;
    if (!messageId || !event.nodeId) continue;

    // 找到同一 messageId 的最新 snapshot 事件
    const latestSnapshot = await db
      .select()
      .from(projectTreeEvents)
      .where(
        and(
          eq(projectTreeEvents.nodeId, event.nodeId),
          eq(projectTreeEvents.eventType, "session.message.snapshot"),
        ),
      )
      .orderBy(desc(projectTreeEvents.seq))
      .limit(1);

    const snapshotPayload = latestSnapshot[0]?.payload;
    const message = snapshotPayload?.message;
    if (!message) continue;

    const messageNodeId = getMessageNodeId(event.nodeId, messageId);
    const existing = await db.query.projectTreeNodes.findFirst({
      where: eq(projectTreeNodes.id, messageNodeId),
    });

    if (existing && !existing.messageSnapshot) {
      await db
        .update(projectTreeNodes)
        .set({
          messageSnapshot: message as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(projectTreeNodes.id, messageNodeId));
    }
  }
}
```

### 4.3 效果预估

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 读取 50 条消息 | 扫描 ~750 行事件 → 内存合并 | 查询 50 行 message node |
| **读取量降幅** | — | **约 93%** |
| 查询复杂度 | O(总事件数) | O(消息数) |

### 4.4 改动文件

| 文件 | 变更 |
|---|---|
| [schema.pg.ts](../control-plane/service/src/db/schema.pg.ts) | `projectTreeNodes` 新增 `messageSnapshot` 列 |
| 新增迁移文件 | `ALTER TABLE ... ADD COLUMN message_snapshot JSONB` + 部分索引 |
| [tasks/routes.ts](../control-plane/service/src/modules/tasks/routes.ts) | 消息完成时写入物化快照 |
| 新增 `scripts/backfill-message-snapshots.ts` | 存量数据回填脚本 |

---

## 5. 措施 3：`pg_trgm` 搜索读面

### 5.1 问题

项目树当前具备结构查询能力，但还缺少“按内容找消息 / 上下文 / 工具输出”的项目级模糊搜索能力。现有 `ltree` 与节点类型索引只能解决“在哪棵子树里找”，不能解决“按文本近似匹配找什么”。

这会直接限制以下场景：

1. 在任务详情中搜索历史对话片段。
2. 在项目级工作台中跨 task / branch 搜索消息与上下文。
3. 在增量推送断线恢复后，用关键词快速定位事件对应的最终消息节点。

### 5.2 方案

基于 `project_tree_nodes(node_type='message'|'context')` 建立 `pg_trgm` 搜索读面，优先搜索已物化的稳定内容，而不是直接对 `project_tree_events.payload` 做模糊匹配。

#### 5.2.1 Schema 与索引

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_ptn_message_search_trgm
  ON project_tree_nodes
  USING gin (content_text gin_trgm_ops)
  WHERE node_type = 'message' AND content_text IS NOT NULL;

CREATE INDEX idx_ptn_context_search_trgm
  ON project_tree_nodes
  USING gin (content_text gin_trgm_ops)
  WHERE node_type = 'context' AND content_text IS NOT NULL;

CREATE INDEX idx_ptn_project_message_lookup
  ON project_tree_nodes (project_id, node_type, created_at)
  WHERE node_type IN ('message', 'context');
```

#### 5.2.2 搜索接口建议

```text
GET /api/projects/:projectId/search?q=retry&nodeType=message&limit=20&cursor=...
```

返回结构建议包含：

1. 命中的 `nodeId` / `path` / `nodeType`。
2. 所属 task / branch / session 元信息。
3. 截断后的命中文本片段与相似度分数。
4. 若命中来自 message node，附带 `runtimeMessageId` 便于 UI 直接滚动定位。

#### 5.2.3 查询示例

```sql
SELECT
  id,
  project_id,
  parent_id,
  path,
  node_type,
  content_text,
  similarity(content_text, $1) AS score,
  created_at
FROM project_tree_nodes
WHERE project_id = $2
  AND node_type IN ('message', 'context')
  AND content_text % $1
ORDER BY score DESC, created_at DESC
LIMIT $3;
```

#### 5.2.4 设计取舍

1. **只搜稳定节点，不直接搜事件表**：避免 streaming 中间态污染结果，也避免对大 JSONB payload 建重索引。
2. **优先搜 `content_text` 摘要 / 文本**：工具调用结果若需要更强搜索，可后续补 `content_json` 的结构化索引，不在本阶段混做。
3. **项目隔离优先**：搜索条件必须显式带 `project_id`，不做跨项目全文检索。

### 5.3 效果预估

| 指标 | 当前 | 优化后 |
|---|---|---|
| 项目级消息搜索 | 不具备或需业务层全量扫 | `pg_trgm` 模糊搜索 |
| 搜索读面 | 依赖回放 / 拼装 | 直接读取稳定 message/context 节点 |
| 搜索范围 | 单接口局部语义 | 项目级统一树节点语义 |

### 5.4 改动文件

| 文件 | 变更 |
|---|---|
| 新增迁移文件 | 启用 `pg_trgm`、创建 GIN/辅助索引 |
| [schema.pg.ts](../control-plane/service/src/db/schema.pg.ts) | 如需显式声明搜索相关列/索引元数据则同步更新 |
| service / BFF search routes | 新增项目级搜索接口与结果整形 |

---

## 6. 措施 4：基于 `project_tree_events` 的增量推送

### 6.1 问题

当前前端虽然能通过 SSE 与持久化接口拿到消息变化，但缺少明确的“增量消费边界”：

1. 断线恢复后通常只能重新拉整段消息。
2. TaskDetail / 多任务监控 / 项目级视图难以共用统一 cursor。
3. BFF / service 之间对“哪些变化已经持久化、哪些变化仅是实时态”没有统一对外协议。

### 6.2 方案

把 `project_tree_events` 明确提升为**增量同步日志**，同时保留 `project_tree_nodes` 作为稳定读模型：

1. **events**：表示过程变化，按 `project_id + created_at` 与 `node_id + seq` 递增读取。
2. **nodes**：表示稳定快照，适合详情读取、搜索命中、断线重建最终状态。
3. **客户端**：优先消费增量事件，必要时回落到节点快照读面修正状态。

#### 6.2.1 建议的对外能力

```text
GET /api/projects/:projectId/events?afterSeq=123&limit=200
GET /api/projects/:projectId/events?after=2026-03-21T10:00:00.000Z&limit=200
```

返回建议结构：

```json
{
  "items": [
    {
      "id": "evt_xxx",
      "projectId": "proj_xxx",
      "nodeId": "node_xxx",
      "eventType": "session.message.updated",
      "seq": 124,
      "createdAt": "2026-03-21T10:00:01.234Z",
      "payload": {}
    }
  ],
  "nextCursor": {
    "afterSeq": 124,
    "after": "2026-03-21T10:00:01.234Z"
  },
  "hasMore": false
}
```

#### 6.2.2 使用语义

1. **实时页面**：先订阅 SSE，若连接断开或页面重开，则从最近 cursor 补拉 `/events`。
2. **项目级监控页**：按 `projectId` 消费增量事件，驱动 task / branch / stage 状态刷新。
3. **任务详情页**：增量事件只驱动草稿态与局部 patch，最终完整消息仍以 `message_snapshot` 或 message node 为准。

#### 6.2.3 事件分类建议

| 类别 | 典型事件 | 用途 |
|---|---|---|
| 消息流式事件 | `session.message.created` / `updated` / `completed` | 驱动消息增量渲染 |
| 工具事件 | `tool_call_start` / `tool_result` | 驱动工具调用卡片 |
| 分支事件 | `fork_created` / `branch_switched` | 驱动 branch lineage 与头指针更新 |
| 任务状态事件 | `task.updated` / `pipeline.stage.updated` | 驱动任务状态与流水线 UI |

#### 6.2.4 与搜索 / 快照的关系

1. 增量事件不是搜索主读面，搜索只查稳定节点。
2. 增量事件不是最终事实快照，最终展示仍以物化后的 `message_snapshot` / node 内容为准。
3. 增量事件的价值在于“低延迟同步过程”，节点读面的价值在于“稳定重建结果”。

### 6.3 效果预估

| 指标 | 当前 | 优化后 |
|---|---|---|
| 断线恢复 | 需重拉整段消息 / 重新拼装 | 通过 cursor 补拉缺失事件 |
| 项目级监控刷新 | 多路散落接口 | 基于统一 events 日志驱动 |
| streaming UI 一致性 | 依赖本地状态 + 全量回读 | 事件增量 + 快照纠偏 |

### 6.4 改动文件

| 文件 | 变更 |
|---|---|
| service tree/event routes | 新增项目级事件增量读取接口 |
| [sse-aggregator.ts](../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator.ts) | 对齐事件落盘与 cursor 语义 |
| BFF / 前端 realtime store | 增量消费、断线补拉、cursor 持久化 |

---

## 7. 措施 5：事件表分区 + TTL 清理

### 7.1 问题

`project_tree_events` 是无界增长的追加表，随时间推移会成为最大的单表。物化快照落地后，**中间事件的唯一价值是审计**，不再支撑读取路径。

### 7.2 方案：按月范围分区 + 自动 TTL drop

#### 7.2.1 分区表改造

```sql
-- 将 project_tree_events 改为范围分区表（按 created_at 月分区）
-- 注意：PG 不支持直接把已有表改成分区表，需要 rename + 重建

-- Step 1: 重命名旧表
ALTER TABLE project_tree_events RENAME TO project_tree_events_legacy;

-- Step 2: 创建分区表
CREATE TABLE project_tree_events (
  id           TEXT NOT NULL,
  node_id      TEXT REFERENCES project_tree_nodes(id),
  project_id   TEXT NOT NULL REFERENCES projects(id),
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  seq          INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, created_at)      -- 分区键必须包含在 PK 中
) PARTITION BY RANGE (created_at);

-- Step 3: 创建当前月和未来几个月的分区
CREATE TABLE project_tree_events_2026_03
  PARTITION OF project_tree_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE project_tree_events_2026_04
  PARTITION OF project_tree_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- Step 4: 将旧数据导入对应分区
INSERT INTO project_tree_events
  SELECT * FROM project_tree_events_legacy;

-- Step 5: 重建索引（每个分区自动创建本地索引）
CREATE INDEX idx_pte_node_seq ON project_tree_events (node_id, seq);
CREATE INDEX idx_pte_project_time ON project_tree_events (project_id, created_at);

-- Step 6: 确认无误后删除旧表
-- DROP TABLE project_tree_events_legacy;  -- 手动确认后执行
```

#### 7.2.2 自动分区创建（cron）

```typescript
// scripts/ensure-event-partitions.ts
// 建议通过 pg_cron 或应用层定时任务每月 1 号执行

async function ensureNextMonthPartition() {
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");

  const partName = `project_tree_events_${year}_${month}`;
  const rangeStart = `${year}-${month}-01`;

  const following = new Date(next);
  following.setMonth(following.getMonth() + 1);
  const rangeEnd = `${following.getFullYear()}-${String(following.getMonth() + 1).padStart(2, "0")}-01`;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(partName)}
      PARTITION OF project_tree_events
      FOR VALUES FROM (${rangeStart}) TO (${rangeEnd})
  `);
}
```

#### 7.2.3 TTL 清理策略

| 数据类型 | 保留期 | 清理方式 |
|---|---|---|
| 中间事件（`session.message.updated`、`session.message.snapshot`，且对应消息已物化） | **90 天** | `DROP PARTITION` 整分区删除 |
| 完成事件（`session.message.completed`、`session.message.created`） | **永久** | 不清理（审计用） |

分区粒度为月，因此 TTL 清理的最小粒度也是月。不需要行级 DELETE，直接 `DROP TABLE project_tree_events_2025_12` 即可释放空间，**零碎片、零 vacuum**。

```typescript
// scripts/ttl-cleanup-event-partitions.ts

const RETENTION_MONTHS = 3; // 保留最近 3 个月

async function dropExpiredPartitions() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  const cutoffStr = `${cutoff.getFullYear()}_${String(cutoff.getMonth() + 1).padStart(2, "0")}`;

  // 列出所有分区，drop 早于 cutoff 的
  const partitions = await db.execute(sql`
    SELECT inhrelid::regclass AS partition_name
    FROM pg_inherits
    WHERE inhparent = 'project_tree_events'::regclass
  `);

  for (const row of partitions.rows) {
    const name = String(row.partition_name);
    const match = name.match(/project_tree_events_(\d{4}_\d{2})/);
    if (match && match[1] < cutoffStr) {
      // 在 drop 前先确认该分区内的消息已全部物化
      const unmateriazedCount = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM ${sql.identifier(name)} e
        WHERE e.event_type = 'session.message.completed'
          AND NOT EXISTS (
            SELECT 1 FROM project_tree_nodes n
            WHERE n.id = CONCAT(e.node_id, ':msg:', (e.payload->>'messageId'))
              AND n.message_snapshot IS NOT NULL
          )
      `);

      if (Number(unmateriazedCount.rows[0]?.cnt) > 0) {
        console.warn(`Skipping ${name}: ${unmateriazedCount.rows[0]?.cnt} unmaterialized messages`);
        continue;
      }

      console.log(`Dropping expired partition: ${name}`);
      await db.execute(sql`DROP TABLE ${sql.identifier(name)}`);
    }
  }
}
```

### 7.3 效果预估

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 事件表总体积（1年后） | ~5 TB | ~450 GB（仅保留 3 个月） |
| `VACUUM` 开销 | 全表 vacuum | 按分区局部 vacuum / 直接 drop |
| 旧月清理耗时 | 行级 DELETE（小时级） | DDL DROP（秒级） |

### 7.4 改动文件

| 文件 | 变更 |
|---|---|
| 新增迁移文件 | 分区表重建DDL |
| 新增 `scripts/ensure-event-partitions.ts` | 自动创建下月分区 |
| 新增 `scripts/ttl-cleanup-event-partitions.ts` | 过期分区清理 |

---

## 8. 措施 6：索引优化

### 6.1 当前索引

```
idx_pte_node_seq      ON project_tree_events (node_id, seq)
idx_pte_project_time  ON project_tree_events (project_id, created_at)
```

### 6.2 优化建议

#### 6.2.1 新增覆盖索引（加速消息列表查询）

如果仍需从事件中读取消息列表（物化快照尚未完全覆盖），新增覆盖索引避免回表：

```sql
CREATE INDEX idx_pte_node_snapshot_covering
  ON project_tree_events (node_id, seq)
  INCLUDE (event_type, payload)
  WHERE event_type IN ('session.message.snapshot', 'session.message.updated');
```

> **注意**：`payload` 为 JSONB 类型且可能较大（2–10 KB），`INCLUDE` 会增加索引体积。仅在物化快照尚未完全替代事件读取路径时使用，Phase 完成后可移除。

#### 6.2.2 `project_tree_nodes` message 查询索引

```sql
-- 优化消息节点子查询（物化快照方案的核心读取路径）
CREATE INDEX idx_ptn_parent_message
  ON project_tree_nodes (parent_id, created_at)
  WHERE node_type = 'message' AND message_snapshot IS NOT NULL;
```

#### 6.2.3 移除冗余索引

当物化快照路径稳定后，`idx_pte_node_seq` 的作用将仅限审计场景，可降级为按分区本地索引（分区表自动实现）。

### 6.3 改动文件

| 文件 | 变更 |
|---|---|
| 新增迁移文件 | 新索引创建 SQL |

---

## 9. 措施 7：冷热分离（Phase 2）

### 7.1 思路

| 数据温度 | 定义 | 存储位置 |
|---|---|---|
| **热数据** | 最近 7 天的活跃 session 消息快照 | `project_tree_nodes.message_snapshot` |
| **温数据** | 7 天 ~ 3 个月的事件 | `project_tree_events` 月分区 |
| **冷数据** | > 3 个月的事件 | 对象存储（S3/MinIO） + 审计索引表 |

### 7.2 冷存归档流程

```
            ┌──────────────────┐
            │  月分区到期（>3M） │
            └────────┬─────────┘
                     ▼
  ┌───────────────────────────────────┐
  │  pg_dump 导出分区 → 压缩 → 上传  │
  │  到对象存储 (JSONL.gz)            │
  └────────┬──────────────────────────┘
           ▼
  ┌───────────────────────────────────┐
  │  在审计索引表记录归档元数据        │
  │  (分区名, 时间范围, 行数, S3 key) │
  └────────┬──────────────────────────┘
           ▼
  ┌───────────────────────────────────┐
  │  DROP PARTITION                    │
  └───────────────────────────────────┘
```

### 7.3 审计索引表

```sql
CREATE TABLE event_archive_index (
  id              TEXT PRIMARY KEY,
  partition_name  TEXT NOT NULL UNIQUE,
  time_range_from TEXT NOT NULL,
  time_range_to   TEXT NOT NULL,
  row_count       BIGINT NOT NULL,
  storage_key     TEXT NOT NULL,          -- s3://bucket/path/events_2025_12.jsonl.gz
  checksum_sha256 TEXT NOT NULL,
  archived_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

> 此措施为 Phase 2，在前 6 项措施落地并验证后再实施。

---

## 10. 可选实施计划

### Phase 1A：BFF 节流（低风险，可单独启用）

**范围**：仅修改 BFF `sse-aggregator.ts`，不涉及 DB 变更。

| 步骤 | 内容 | 估计改动量 |
|---|---|---|
| 1 | 在 `SSEAggregator` 中新增 `scheduleMessageSnapshotPersist()` | ~80 行 |
| 2 | 将 `processParsedEvent` 中的 `persistSessionMessageSnapshot` 调用替换为节流版 | 1 行 |
| 3 | 在 `cleanup()` 中清理 timer 和缓存 | ~10 行 |
| 4 | 添加单元测试验证节流行为 | ~50 行 |
| 5 | 灰度发布，监控事件写入 QPS 降幅 | — |

**回滚**：环境变量 `SNAPSHOT_THROTTLE_ENABLED=false` 关闭节流。

**验收**：
- [ ] 节流启用后，同一消息的 HTTP POST 次数降至 ≤ 5
- [ ] 消息完成后最终快照在 1 秒内落盘
- [ ] 现有 BFF 测试全部通过

---

### Phase 1B：物化快照（中风险，在确认仍需树侧快照读面后再执行）

**范围**：DB schema 变更 + Service 路由修改 + 读取路径优化。

| 步骤 | 内容 |
|---|---|
| 1 | 新增 Drizzle 迁移：`ALTER TABLE project_tree_nodes ADD COLUMN message_snapshot JSONB` |
| 2 | 修改 `POST /:taskId/branches/messages`：消息完成时写入 `message_snapshot` |
| 3 | 新增 `getSessionMessagesOptimized()`：优先从 `message_snapshot` 读取 |
| 4 | 运行 `backfill-message-snapshots.ts` 回填存量数据 |
| 5 | 切换 `GET /:taskId/branches/:runtimeSessionId/messages` 到优化读取路径 |
| 6 | 灰度发布，对比新旧读取路径返回结果一致性 |

**回滚**：读取路径已有 fallback 到事件回放，`message_snapshot` 列为新增列不影响现有写入。

**验收**：
- [ ] 已完成的消息均有 `message_snapshot IS NOT NULL`
- [ ] 消息列表 API 响应时间 < 100ms（50 条消息场景）
- [ ] 新旧读取路径返回一致的消息列表
- [ ] 回填脚本无报错，覆盖存量消息 100%

---

### Phase 1C：`pg_trgm` 搜索（中风险，确有项目级树侧搜索需求时再执行）

| 步骤 | 内容 |
|---|---|
| 1 | 启用 `pg_trgm` 扩展并新增 `project_tree_nodes.content_text` GIN 索引 |
| 2 | 新增项目级搜索接口，限定 `project_id` 范围与 `message/context` 节点类型 |
| 3 | 在 TaskDetail / 项目级工作台接入搜索结果跳转 |
| 4 | 对比精确过滤与模糊搜索结果，校验召回与误报率 |

**验收**：
- [ ] 项目内关键词 / 近似词搜索可命中 message 与 context 节点
- [ ] 搜索接口 P95 < 200ms（10 万 message/context 节点量级）
- [ ] 搜索结果能定位到对应 task / branch / message 节点

---

### Phase 1D：增量推送读面（中风险，确有前端共享 cursor 需求时再执行）

| 步骤 | 内容 |
|---|---|
| 1 | 新增 `/api/projects/:projectId/events` cursor 增量接口 |
| 2 | 定义 `afterSeq` / `after` 双 cursor 协议与返回结构 |
| 3 | 在 BFF / 前端实时 store 中接入断线补拉与去重 |
| 4 | 在 TaskDetail / MultiTaskMonitor 中切换为“事件增量 + 快照纠偏”模式 |
| 5 | 验证跨页面共享 cursor 时不会重复应用事件 |

**验收**：
- [ ] 页面断线恢复后可仅补拉缺失事件，不触发整段消息重载
- [ ] TaskDetail / MultiTaskMonitor 能消费统一的项目级事件增量流
- [ ] 事件去重后不会重复渲染消息或重复推进 pipeline 状态

---

### Phase 1E：索引优化（低风险，Phase 1D 后执行）

| 步骤 | 内容 |
|---|---|
| 1 | 新增 `idx_ptn_parent_message` 部分索引 |
| 2 | 监控消息列表查询 explain plan，确认走索引 |
| 3 | 评估并移除 Phase 1B 中的临时覆盖索引（如有） |

---

### Phase 2：分区 + TTL（仅在 Phase 1 相关能力实际落地后再考虑）

| 步骤 | 内容 |
|---|---|
| 1 | 在 staging 环境执行分区表重建 |
| 2 | 验证分区表读写性能与非分区一致 |
| 3 | 在生产环境执行分区表切换（低流量时段） |
| 4 | 部署 `ensure-event-partitions` cron |
| 5 | 部署 `ttl-cleanup-event-partitions` cron，首次保守设置 RETENTION_MONTHS=6 |
| 6 | 稳定运行 1 个月后调整为 RETENTION_MONTHS=3 |

**前置条件**：Phase 1B 的物化快照与 Phase 1C/1D 的搜索、增量读面已稳定运行，所有消息主读取路径已切换到 `message_snapshot`。

---

### Phase 3：冷热分离（可选，视业务规模决定）

| 步骤 | 内容 |
|---|---|
| 1 | 搭建对象存储（S3 / MinIO） |
| 2 | 实现分区导出 + 上传脚本 |
| 3 | 创建 `event_archive_index` 表 |
| 4 | 在审计 UI 中支持从冷存按需加载事件 |

**触发条件**：事件表月增量 > 100 GB 或总体积 > 500 GB。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| BFF 节流导致最终快照丢失 | 消息完成后 snapshot 未落盘 | `isComplete` 检测强制立即写入 + `cleanup()` 中 flush 所有待写快照 |
| `message_snapshot` 列膨胀 | `project_tree_nodes` 表体积增大 | TOAST 自动压缩 JSONB > 2 KB 的值；如极端可改为外表引用 |
| `pg_trgm` 索引体积偏大 | message/context 节点写入与 vacuum 成本上升 | 仅对 `node_type in ('message', 'context')` 建部分索引，必要时拆 message/context 两套索引 |
| 增量 cursor 漏洞导致事件重复或丢失 | 实时 UI 与持久化状态不一致 | cursor 返回统一以服务端时间/seq 为准，前端做幂等去重并保留快照纠偏 |
| 分区表主键变更 | `id` 不再是唯一 PK，需包含 `created_at` | 应用层仍按 `id` 查询（有唯一索引保证）；PK 变更仅影响 DDL |
| 分区切换期间写入失败 | 无对应分区时 INSERT 失败 | 提前 2 个月创建分区；添加 `DEFAULT` 分区兜底 |
| 回填脚本运行时间长 | 大量存量数据 | 分批执行（按 project_id），支持断点续跑 |

---

## 12. 监控指标

优化上线后应关注以下指标：

| 指标 | 数据源 | 告警阈值 |
|---|---|---|
| 事件写入 QPS | `project_tree_events` INSERT 速率 | > 500/s 持续 5 分钟 |
| 消息列表 P99 延迟 | API 响应时间 | > 500ms |
| 项目级搜索 P95 延迟 | 搜索 API 响应时间 | > 200ms |
| 增量补拉失败率 | `/events` 接口 4xx/5xx 比例 | > 1% |
| 事件表总体积 | `pg_total_relation_size('project_tree_events')` | > 100 GB |
| 未物化消息数 | `COUNT(*) WHERE message_snapshot IS NULL AND node_type = 'message'` | > 1000 |
| 节流缓冲区大小 | BFF `snapshotTimers.size` | > 500 |
| 分区数量 | `pg_inherits` 计数 | < 3（说明清理失败）或 > 24 |

---

## 13. 验收标准汇总

### 整体验收

- [ ] 单条 assistant 消息产生的事件行数 ≤ 11（节流后）
- [ ] 50 条消息的消息列表 API 响应 < 100ms（物化快照后）
- [ ] 项目级 message/context 模糊搜索可稳定命中，P95 < 200ms
- [ ] 增量推送支持 cursor 补拉，断线恢复不需要全量重放消息历史
- [ ] 事件表每月增量不超过优化前的 30%（节流 + TTL 清理后）
- [ ] 全部现有测试通过，无功能回归
- [ ] 审计场景仍可查看完整事件历史（从 PG 分区或冷存）
