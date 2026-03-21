# 项目树形存储方案设计

> 状态：Draft  
> 日期：2026-03-20  
> 作者：AI Architecture Assistant

## 0. 当前实施状态（截至 2026-03-21）

### 0.1 明确 Checklist

#### 已实现

- [x] 落地树模型基础设施：`ltree` 自定义类型、`project_tree_nodes` / `project_tree_branches` / `project_tree_events` / `project_tree_links` schema、`0006_project_tree_foundation.sql` 迁移、`0007_narrow_prism.sql` + `meta/0007_snapshot.json` snapshot 基线。
- [x] `POST /api/projects` 创建项目时自动建立 root 节点，并返回 `rootNodeId`。
- [x] `POST /api/tasks` 主写已切到 `project_tree_nodes(node_type=task)`，运行时不再依赖 `tasks` 镜像写入。
- [x] 任务关系主写已切到 `project_tree_links`，旧 `project_task_relations` 已退出运行时路径与 schema 主线。
- [x] 第一批项目树 API 已落地：`GET /api/projects/:projectId/tree`、`GET /api/projects/:projectId/tree/:nodeId`、`GET /api/projects/:projectId/tree/:nodeId/children`、`GET /api/projects/:projectId/tree/:nodeId/ancestors`、`POST /api/projects/:projectId/tree/:nodeId/children`、`GET /api/projects/:projectId/branches`、`PUT /api/projects/:projectId/branches/:branchId`、`GET /api/projects/:projectId/tree/:nodeId/links`、`POST /api/projects/:projectId/tree/:nodeId/links`、`GET /api/projects/:projectId/links`、`DELETE /api/projects/:projectId/links/:linkId`。
- [x] 旧 `task_sessions` 写入口已同步投影树模型：创建 / activate / archive 会同步维护 `node_type=session` 节点。
- [x] 旧衍生表的 `task_id` FK 已切到 `project_tree_nodes(id)`，覆盖 `task_sessions`、`agent_runs`、`code_changes`、`task_workflow_runs`、`role_aggregate_conclusions`、`developer_change_requests`、`task_operating_modes`、`boss_decisions`、`human_escalations`、`runtime_usage_ledgers`、`runtime_usage_ledger_steps`。
- [x] Web UI BFF 已代理 `tree` / `branches` / `links` 路由，前端无需直连 control-plane service。
- [x] 项目“任务总图”页已接入项目树工作台，可浏览节点树、祖先链、子节点、links 与分支头状态。
- [x] BFF `getSessionMessages` 与相关 runtime/BFF 模块已优先消费 `project_tree_events` 聚合出的 timeline / lineage 数据，`routes.ts` 之外的直接 `task_sessions` 兼容调用已集中收口到共享 helper。
- [x] 前端通用消息读取已改走 execution-trace/tree 消息源，Web UI BFF 的 `/api/tasks/:taskId/sessions/:sessionId/messages` 兼容读取入口已下线。
- [x] 前端任务分支读取已切到 `/api/tasks/:taskId/branches` 与 `/api/tasks/:taskId/branch-lineage`，Web UI BFF 的旧 `/api/tasks/:taskId/sessions` 与 `/api/tasks/:taskId/session-tree` 兼容读取入口已下线。
- [x] Web UI 侧最后残留的 `SessionTree*` 文件名与 `SessionTreeNode` 类型别名已统一改成 branch lineage 语义；BFF `/api/tasks/:taskId/branches` 也不再从旧 task payload 合成 cp-only fallback branch。
- [x] 前端任务分支写入已切到 `/api/tasks/:taskId/branches/:sessionId/(fork|activate|archive)`，Web UI BFF 旧 `/api/tasks/:taskId/sessions/:sessionId/*` 写入口已下线。
- [x] task list/detail 的 BFF 与内部 helper 读取已统一切到显式树视图入口 `/api/project-tree/tasks` 与 `/api/project-tree/tasks/:taskId`。
- [x] 旧项目级 `task-relations` 兼容路由已下线，任务关系只通过 `project_tree_links` 系列接口暴露。
- [x] SQLite 快照迁移链已调整为 tree-first：`tasks` / `sessions` 仅作为输入快照源，不再作为 PostgreSQL 导入目标前提。

#### 未实现

- [x] 删除 service 侧旧 `/api/tasks` list/detail 兼容读取接口。
- [x] 删除旧 `/api/tasks/:taskId/task-sessions*` 兼容接口族，service/BFF 统一改走 `/api/tasks/:taskId/branches*`。
- [x] 删除旧 `/api/tasks/:taskId/sessions/:sessionId/(fork|activate|archive)` 兼容写入口。
- [x] 完成 `tasks` / `sessions` 的物理删表发布，并同步清理 schema、teardown、断言、历史注释。
- [x] `project_task_relations` 已完成代码侧收尾：独立 drop migration 已存在，活引用/teardown 已清理；环境发布仅需按既有 migration 正常执行。
- [x] 下线 `task_sessions` 兼容 lineage 存储，并完成离线输入链、测试 teardown、历史断言、migration 文案与独立删表迁移 `0011_drop_task_sessions.sql` 的收口。
- [ ] 落地 `pg_trgm` 与基于 `project_tree_events` 的搜索 / 增量推送能力。
- [x] 完成“无旧任务域表”前提下的完整回归验证：`db:migrate:pg`、干净目标库 SQLite 快照迁移链、`role-workflow-storage`、`TaskDetail.test.ts`、`TaskDetailV2.test.ts`、`MultiTaskMonitor.test.ts`、全量 `test:ui` 与 Playwright `test:e2e:chat-settings` 已全部通过。

#### 下一批次

- [x] 批次 1：改造前端消息源，替换 `useTaskMessages.ts` 对旧 session-message API 的依赖。
- [x] 批次 2：迁移并删除 `/api/tasks*` 兼容读取接口，旧 list/detail GET 已下线；`task_sessions` 也已完成独立删表。
- [x] 批次 3：执行并验证 `0010_drop_tasks_and_sessions.sql` 与 `0011_drop_task_sessions.sql`，完成 schema、测试清理语句、断言与 migration 文案收口。
- [ ] 批次 4：补 `pg_trgm` 搜索与 `project_tree_events` 增量能力，再做一轮端到端验证。

### 0.2 现阶段结论

1. 运行时主路径已经切到项目树模型，`/api/tasks` 兼容面已收敛到写入与子资源路由，list/detail GET 已删除。
2. `tasks`、`sessions`、`task_sessions` 已全部退出运行时事实面，并已分别通过 `0010_drop_tasks_and_sessions.sql` 与 `0011_drop_task_sessions.sql` 完成物理删表落地。
3. `db:migrate:pg` 已在真实本地 PostgreSQL 环境执行通过；更宽的 service regression 未发现对 `task_sessions` 旧表的隐藏依赖。
4. 旧任务域删表的 repo 侧代码收尾已完成；此前独立阻塞的 `TaskDetailV2.test.ts`、`MultiTaskMonitor.test.ts`、全量 `test:ui` 与 Playwright Chat Settings 导航问题均已修复并验证通过。环境发布阶段只需继续执行既有 `db:migrate:pg`。

### 0.4 `task_sessions` 物理删表结果（2026-03-21）

#### 已完成收口

1. `control-plane/service/src/db/schema.pg.ts` 已移除 `taskSessions = pgTable("task_sessions", ...)` 定义。
2. `control-plane/service/src/db/migration/metadata.ts` 已将 `task_sessions` 从 `IMPORT_ORDER` 与 `KEY_FOREIGN_KEYS` 中移除，只保留为 legacy offline source table。
3. `control-plane/service/src/db/migration/transform-export.ts` 已停止从 `rowsByTable.get("task_sessions")` 合成 session lineage，旧输入改为显式 omit warning。

#### 已完成测试收口

1. `tests/service/task-operating-runtime-tree.test.ts`、`tests/service/runtime-usage-ledger.test.ts`、`tests/service/identity-binding.test.ts`、`tests/service/project-task-relations.test.ts`、`tests/service/tree-task-aggregations.test.ts`、`tests/service/role-workflow-storage.test.ts` 已清理 `DELETE FROM task_sessions ...` teardown。
2. `tests/service/project-tree-routes.test.ts` 已改为直接断言 `project_tree_nodes(node_type=session)`，不再查询 `task_sessions`。
3. `tests/web-ui-bff/test-env.ts` 已移除全局 `task_sessions` 清理语句。

#### 迁移与验证结果

1. `task_sessions` 已采用独立 migration `0011_drop_task_sessions.sql` 落地，没有与 `0010_drop_tasks_and_sessions.sql` 混批。
2. `db:migrate:pg` 已在真实本地 PostgreSQL 环境执行通过，验证 `0011_drop_task_sessions.sql` 可直接落地。
3. 更宽 service regression 已覆盖 `project-tree-routes`、`runtime-usage-ledger`、`task-operating-runtime-tree`、`tree-task-aggregations`、`project-task-relations`、`identity-binding`、`role-workflow-storage`；其中未发现 `task_sessions` 隐藏依赖，且 `role-workflow-storage.test.ts` 已切到 `/api/project-tree/tasks/:taskId` 后恢复通过。

### 0.3 当前兼容镜像与残余依赖盘点（截至 2026-03-21）

当前运行时已经不是“所有 service 模块都主读 `tasks`”的状态，实际遗留面可以分成两类：

#### A. 显式触发 legacy `tasks` 镜像的入口

| 位置 | 当前行为 | 性质 | 是否可继续删除 |
|---|---|---|---|
| 无 | runtime 已不再从 `tasks` 回填或修复 task node | 已收口 | 可继续推进到 drop legacy 表 |

#### B. 已完成的收口结果

1. `tasks/routes.ts` 中 task create / patch / session activate 的 `tasks` 镜像写入已删除。
2. `task-workflows/legacy-role-workflow-storage.ts` 中 `ensureLegacyTaskMirror` 已删除，workflow lazy migration 改为 tree-first 并直接清洗 tree strategy。
3. `agent_runs` / `code_changes` / `runtime_usage_ledgers` 入口已先行切到 tree-first 任务校验。
4. 旧衍生表的 `task_id` FK 已整体迁移到 `project_tree_nodes.id`，删除 `tasks` 镜像写入不再会触发这批表的 FK 失败。
5. `task-view.ts` 的 `backfillMissing` 调用点与 `storage.ts` 的 legacy repair helper 已从 runtime 路径移除。

#### C. 2026-03-21 全局扫描结论（离线脚本 / runbook / 导出工具）

1. `scripts/` 与 `runbooks/` 中未发现直接读写控制面 PostgreSQL `tasks` / `sessions` / `task_sessions` 的真实离线入口。
2. 命中的 shell 脚本仅操作 OpenCode Runtime 自身的 SQLite `session` 表，不属于控制面任务域旧表，不构成 `tasks`/`sessions` 删表阻塞。
3. 唯一仍直接依赖旧表语义的真实离线工具，是 `control-plane/service/src/db/migration/*` 这条 SQLite 快照迁移链；它此前按旧目标表顺序导入 `tasks` / `sessions`，现已调整为在 normalize 阶段合成 `project_tree_nodes` / `project_tree_branches`，并将 `tasks` / `sessions` 只保留为输入快照源，不再作为 PostgreSQL 目标表前提。

#### D. 当前可以优先继续删除的点

1. `tasks` 表本身以及相关 PostgreSQL drop/truncate 计划。
2. `sessions` 表本身以及与之相关的旧汇总语义。
3. 测试与 schema 中残余的 `tasks` / `sessions` 类型引用、清理语句与注释。

#### E. 当前还不能直接删除的点

1. `task_sessions` 已完成独立 drop，不再是兼容 branch lineage 接口的真实存储。
2. service / tests / docs 中与 `tasks`、`sessions`、`task_sessions` 相关的主要 schema 定义、历史清理语句与 migration 文案已完成一轮收口，但仍有个别历史文档待继续同步。
3. 当前旧表删除的 repo 侧收尾已完成；剩余事项主要是后续环境发布时继续执行既有 migration，以及个别与已下线 `/api/tasks/:taskId` detail GET 绑定的历史文档/测试口径持续同步。

结论：runtime 已不再依赖 `tasks` / `sessions` / `task_sessions` / `project_task_relations` 作为事实表；离线迁移链也已切换到以 `project_tree_nodes` / `project_tree_branches` 作为目标，且在干净目标库上完成了一轮真实 SQLite 快照迁移与校验。当前旧任务域删表工作已完成 repo 侧收口，环境发布只需继续执行既有 migration。

---

## 1. 设计目标

1. **允许使用 PostgreSQL 扩展**（`ltree`, `pg_trgm` 等），充分利用 PostgreSQL 原生层级查询能力。
2. **项目创建即建立 root 节点**；所有任务、会话、消息均挂载在该 root 节点之下，形成统一的树。
3. **跨树链接**：不同项目的树之间允许建立引用关系（依赖、引用、衍生等），树保持纯净的包含结构，链接作为独立层存储。
4. **直接切换目标**：目标态是新树表从空状态启用、旧表数据不做迁移、无法继续使用的历史数据直接清除；当前代码已完成主路径切树，仍处于兼容接口与删表收尾阶段。

---

## 2. 现状分析

### 2.1 当前层级关系

```
Organization
  └─ Project                          (projects 表)
      ├─ Task A                      (tasks 表, projectId FK)
      │    ├─ TaskSession root       (历史/兼容 lineage 存储：task_sessions, sourceType=root)
      │    ├─ TaskSession fork-1     (历史/兼容 lineage 存储：task_sessions, parentRuntimeSessionId → root)
       │    └─ TaskSession fork-2
       ├─ Task B
       │    └─ ...
       └─ ProjectTaskRelation A→B     (project_task_relations 表, 任务间依赖图)
```

**问题**：

| # | 问题 | 影响 |
|---|------|------|
| 1 | 项目与任务之间只有「扁平 FK」，无统一树根 | 无法将「项目级上下文」（如 README、架构决策）作为节点参与到执行树中 |
| 2 | `task_sessions` 只记录 session 级分支，消息级分叉靠 runtime 保存 | 历史消息在 runtime 重启后丢失；无法做跨 session 的消息搜索 |
| 3 | 任务间关系 (`project_task_relations`) 是独立图，与 session tree 割裂 | 查询「一条从项目根到当前消息的完整路径」需要跨 3 张表 join |
| 4 | 未使用 PostgreSQL 扩展 | 层级查询只能靠递归 CTE，深度 >10 时性能急剧下降 |

### 2.2 已弃用结构

`task_nodes` + `task_edges` 曾尝试过图结构，已在迁移 `0003_smiling_nightcrawler.sql` 中 DROP。新方案避免重蹈覆辙，选择 **ltree 路径树** 而非 **邻接表图**。

---

## 3. 核心设计

### 3.1 设计原则

| 原则 | 说明 |
|------|------|
| **单根树** | 每个 Project 有且仅有一个 root 节点；所有结构挂在它之下 |
| **路径可查** | 使用 `ltree` 类型存储 materialized path，支持祖先/后代/距离查询 |
| **节点类型多态** | 同一张表存储 project_root / task / session / message / context 等不同类型 |
| **不可变节点** | 写入后只追加、不修改（消息编辑 = 新节点 + 标记旧节点为 superseded） |
| **树纯净 + 链接分离** | 树只表达「包含关系」（containment）；跨树的「引用关系」（reference）用独立边表存储 |
| **直接切换目标** | 目标态是不迁移旧表历史数据、清空旧表并启用新树表；当前仍保留少量兼容接口与收尾迁移 |

### 3.2 PostgreSQL 扩展需求

```sql
-- 在迁移文件顶部启用
CREATE EXTENSION IF NOT EXISTS ltree;    -- 层级路径查询
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 消息全文模糊搜索（可选，Phase 2）
```

### 3.3 核心新表：`project_tree_nodes`

```sql
CREATE TABLE project_tree_nodes (
  -- ── 标识 ──────────────────────────────────────────────────
  id           TEXT PRIMARY KEY,                     -- UUID v7（时间有序）
  project_id   TEXT NOT NULL REFERENCES projects(id),

  -- ── 树结构 ────────────────────────────────────────────────
  parent_id    TEXT REFERENCES project_tree_nodes(id),  -- 邻接指针（直接父）
  path         LTREE NOT NULL,                          -- materialized path, e.g. "root.task_abc.ses_xyz.msg_001"
  depth        INTEGER NOT NULL DEFAULT 0,              -- 冗余深度，方便分页

  -- ── 节点类型 ──────────────────────────────────────────────
  node_type    TEXT NOT NULL,
  -- 枚举值:
  --   'project_root'  — 项目根（创建项目时自动生成）
  --   'task'          — 任务
  --   'session'       — 运行时会话（tree-first 原生节点）
  --   'message'       — 聊天消息 (user/assistant/system/tool)
  --   'context'       — 项目级上下文挂载（README、设计决策等）
  --   'fork_point'    — 分叉标记节点

  -- ── 内容 ──────────────────────────────────────────────────
  role         TEXT,           -- 仅 message 类型: user / assistant / system / tool
  content_text TEXT,           -- 纯文本内容或摘要
  content_json JSONB,          -- 结构化内容（tool_call 参数、结果、元数据）
  token_count  INTEGER,        -- 该节点消耗的 token 数

  -- ── 关联 ──────────────────────────────────────────────────
  runtime_session_id   TEXT,                                -- node_type in (session, message)
  runtime_message_id   TEXT,                                -- node_type = message 时的 runtime 原始 ID

  -- ── 分支元数据 ────────────────────────────────────────────
  branch_name          TEXT,        -- 分支显示名（"候选 A"、"fork-1" 等）
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by        TEXT REFERENCES project_tree_nodes(id),  -- 编辑时指向新版本

  -- ── 时间 ──────────────────────────────────────────────────
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at  TEXT
);

-- ── 索引 ──────────────────────────────────────────────────────
CREATE INDEX idx_ptn_project_path   ON project_tree_nodes USING GIST (path);
CREATE INDEX idx_ptn_project_id     ON project_tree_nodes (project_id);
CREATE INDEX idx_ptn_parent_id      ON project_tree_nodes (parent_id);
CREATE INDEX idx_ptn_node_type      ON project_tree_nodes (project_id, node_type);
CREATE INDEX idx_ptn_runtime_ses    ON project_tree_nodes (runtime_session_id) WHERE runtime_session_id IS NOT NULL;
CREATE INDEX idx_ptn_runtime_msg    ON project_tree_nodes (runtime_message_id) WHERE runtime_message_id IS NOT NULL;
```

### 3.4 辅助表：`project_tree_branches`（分支引用）

类似 Git 的 refs，指向树中的「当前活跃分支头」。

```sql
CREATE TABLE project_tree_branches (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  task_node_id TEXT REFERENCES project_tree_nodes(id),  -- 归属任务节点（null = 项目级分支）
  branch_name  TEXT NOT NULL,
  head_node_id TEXT NOT NULL REFERENCES project_tree_nodes(id),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_ptb_project_branch_unique
  ON project_tree_branches (project_id, branch_name)
  WHERE task_node_id IS NULL;

CREATE UNIQUE INDEX idx_ptb_task_branch_unique
  ON project_tree_branches (project_id, task_node_id, branch_name)
  WHERE task_node_id IS NOT NULL;
```

### 3.5 辅助表：`project_tree_events`（追加式事件日志）

用于 streaming 场景，SSE 事件落盘后再合并到 `project_tree_nodes`。

```sql
CREATE TABLE project_tree_events (
  id           TEXT PRIMARY KEY,
  node_id      TEXT REFERENCES project_tree_nodes(id),  -- 可能尚未创建（streaming 中）
  project_id   TEXT NOT NULL REFERENCES projects(id),
  event_type   TEXT NOT NULL,
  -- 枚举: 'message_start' | 'content_delta' | 'tool_call_start' | 'tool_result'
  --        | 'message_complete' | 'fork_created' | 'branch_switched'
  payload      JSONB NOT NULL,
  seq          INTEGER NOT NULL,   -- 同一 node 内的序列号
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pte_node_seq ON project_tree_events (node_id, seq);
CREATE INDEX idx_pte_project  ON project_tree_events (project_id, created_at);
```

### 3.6 跨树链接表：`project_tree_links`

每棵项目树是独立的包含结构，但不同树之间需要表达「引用关系」——任务依赖、内容引用、分叉来源等。这类关系用独立的边表存储，**不破坏树的单父结构**。

> 类比：文件系统的「目录树 + 符号链接」、Git 的「对象树 + submodule」、HTML 的「DOM 树 + 超链接」。

#### 3.6.1 为什么链接不能放在树里

| 约束 | 原因 |
|------|------|
| **ltree 不支持多父** | 一个节点只能有一条 `path`，不可能同时属于两棵树 |
| **项目隔离是安全边界** | 树内查询必带 `project_id`；跨项目链接需要显式权限检查，放在独立表里逻辑更清晰 |
| **链接可删除，节点不可变** | 「A 依赖 B」可以解除，但消息节点是不可变的；生命周期不同，必须分离 |

#### 3.6.2 跨树场景

| 场景 | 示例 | link_type |
|------|------|----------|
| **项目间依赖** | 项目 A 的任务依赖项目 B 的任务完成 | `depends-on` |
| **上下文引用** | 项目 A 的消息引用了项目 B 的设计文档节点 | `cites` |
| **共享衍生** | 从项目 A 的某个消息 fork 出项目 B 的新任务 | `forked-from` |
| **触发创建** | 项目 A 的任务执行过程中创建了项目 B 的任务 | `spawned` |
| **阻塞关系** | 项目 A 的输出阻塞了项目 B 的推进 | `blocks` |
| **松散关联** | 两个项目的某些节点有概念上的关联 | `related` |

#### 3.6.3 表定义

```sql
CREATE TABLE project_tree_links (
  id              TEXT PRIMARY KEY,

  -- 源节点
  source_node_id    TEXT NOT NULL REFERENCES project_tree_nodes(id),
  source_project_id TEXT NOT NULL REFERENCES projects(id),

  -- 目标节点
  target_node_id    TEXT NOT NULL REFERENCES project_tree_nodes(id),
  target_project_id TEXT NOT NULL REFERENCES projects(id),

  -- 链接语义
  link_type       TEXT NOT NULL,
  -- 枚举:
  --   'depends-on'     — source 的完成依赖 target
  --   'blocks'         — source 阻塞 target
  --   'cites'          — source 引用 target 的内容
  --   'forked-from'    — source 从 target 的某个节点分叉而来
  --   'spawned'        — source 触发创建了 target
  --   'related'        — 松散关联

  -- 元数据
  metadata        JSONB,            -- 附加信息（引用原因、权限要求等）
  bidirectional   BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否双向可见

  created_by      TEXT,             -- 谁建立的链接
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- 去重
  UNIQUE (source_node_id, target_node_id, link_type)
);

CREATE INDEX idx_ptl_source          ON project_tree_links (source_node_id);
CREATE INDEX idx_ptl_target          ON project_tree_links (target_node_id);
CREATE INDEX idx_ptl_source_project  ON project_tree_links (source_project_id, link_type);
CREATE INDEX idx_ptl_target_project  ON project_tree_links (target_project_id, link_type);
```

#### 3.6.4 与现有 `project_task_relations` 的关系

现有的 `project_task_relations` 是任务级别的链接表，`project_tree_links` 是其泛化：

```
project_task_relations           →  project_tree_links
  source_task_id / target_task_id     source_node_id / target_node_id
  relation_type                       link_type
  只能连接 task                        可以连接任意粒度的节点
  限定同一 project_id                  允许跨 project
```

当前运行时已经不再使用 `project_task_relations`；独立 drop migration 已存在且 repo 侧活引用已清理，环境发布时按既有 migration 执行即可。旧关系数据不会迁移到 `project_tree_links`。

#### 3.6.5 Drizzle schema

```typescript
export const projectTreeLinks = pgTable(
  "project_tree_links",
  {
    id: text("id").primaryKey(),
    sourceNodeId: text("source_node_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    sourceProjectId: text("source_project_id")
      .notNull()
      .references(() => projects.id),
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    targetProjectId: text("target_project_id")
      .notNull()
      .references(() => projects.id),
    linkType: text("link_type").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    bidirectional: boolean("bidirectional").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_ptl_unique_edge").on(
      table.sourceNodeId,
      table.targetNodeId,
      table.linkType,
    ),
    index("idx_ptl_source").on(table.sourceNodeId),
    index("idx_ptl_target").on(table.targetNodeId),
    index("idx_ptl_source_project").on(table.sourceProjectId, table.linkType),
    index("idx_ptl_target_project").on(table.targetProjectId, table.linkType),
  ],
);
```

---

## 4. 树结构示例

### 4.1 单项目树

一个典型的项目树：

```
project_root (P-001)                          path: "P001"
├── context: README.md                        path: "P001.ctx_readme"
├── context: Architecture Decision            path: "P001.ctx_arch"
├── task: "实现用户登录" (T-001)               path: "P001.T001"
│   ├── session: root (ses_aaa)               path: "P001.T001.ses_aaa"
│   │   ├── msg: user "请实现登录接口"         path: "P001.T001.ses_aaa.msg_001"
│   │   ├── msg: assistant "好的，我来..."     path: "P001.T001.ses_aaa.msg_002"
│   │   ├── msg: tool_call read_file           path: "P001.T001.ses_aaa.msg_003"
│   │   ├── msg: tool_result                   path: "P001.T001.ses_aaa.msg_004"
│   │   └── msg: assistant "已完成实现..."     path: "P001.T001.ses_aaa.msg_005"
│   ├── session: fork-1 (ses_bbb)             path: "P001.T001.ses_bbb"
│   │   │  (forked from msg_002)
│   │   ├── msg: user "换一种方案"             path: "P001.T001.ses_bbb.msg_006"
│   │   └── msg: assistant "好的，另一种..."   path: "P001.T001.ses_bbb.msg_007"
│   └── session: fork-2 (ses_ccc)             path: "P001.T001.ses_ccc"
│       │  (parallel compare: 候选 A)
│       └── ...
├── task: "编写单元测试" (T-002)               path: "P001.T002"
│   └── session: root                         path: "P001.T002.ses_ddd"
│       └── ...
└── (T-001 → T-002 depends-on 关系存储在 project_tree_links 中)
```

### 4.2 跨树链接示例

```
Project A tree (ltree)               Link Layer (project_tree_links)           Project B tree (ltree)
─────────────────────               ─────────────────────────────             ─────────────────────
A_root                               A.T001 ──depends-on──▶ B.T003            B_root
├─ ctx: README                       A.msg_007 ──cites──▶ B.msg_042           ├─ ctx: API Spec
├─ T001: "实现登录"                   A_root ──related──▶ B_root               ├─ T003: "SSO 集成"
│  └─ ses_aaa                                                                 │  └─ ses_eee
│     ├─ msg_001                                                              │     ├─ msg_041
│     ├─ ...                                                                  │     ├─ msg_042
│     └─ msg_007 ─── cites ─────────────────────────────────▶ msg_042         │     └─ ...
├─ T002: "单元测试"                                                            └─ T004: "文档"
│  └─ ...                                                                        └─ ...
└─ (T001 ──depends-on──▶ T003 via link)
```

> **关键区别**：树内路径 (`ltree`) 表达「属于」，链接表 (`project_tree_links`) 表达「引用」。一个节点只能属于一棵树，但可以被任意多棵树的节点链接。

---

## 5. ltree 查询示例

### 5.1 查询项目下所有任务节点

```sql
SELECT * FROM project_tree_nodes
WHERE project_id = 'P-001'
  AND node_type = 'task';
```

### 5.2 查询某任务的全部消息（含所有分支）

```sql
SELECT * FROM project_tree_nodes
WHERE path <@ 'P001.T001'       -- ltree: 是 P001.T001 的后代
  AND node_type = 'message'
ORDER BY path, created_at;
```

### 5.3 查询从 root 到某消息的完整路径

```sql
SELECT * FROM project_tree_nodes
WHERE path @> 'P001.T001.ses_aaa.msg_005'  -- ltree: 是 msg_005 的祖先
ORDER BY depth;
```

### 5.4 查询某节点的直接子节点

```sql
SELECT * FROM project_tree_nodes
WHERE parent_id = 'node-xxx'
ORDER BY created_at;
```

### 5.5 查询某 session 下第 N 层的所有节点

```sql
SELECT * FROM project_tree_nodes
WHERE path ~ 'P001.T001.ses_aaa.*{1}'   -- 直接子节点
ORDER BY created_at;
```

### 5.6 统计某任务下各分支的消息数

```sql
SELECT
  branch_name,
  COUNT(*) FILTER (WHERE node_type = 'message') AS message_count
FROM project_tree_nodes
WHERE path <@ 'P001.T001'
GROUP BY branch_name;
```

### 5.7 查找某节点的所有外部链接

```sql
SELECT l.*, t.path AS target_path, t.node_type AS target_type
FROM project_tree_links l
JOIN project_tree_nodes t ON t.id = l.target_node_id
WHERE l.source_node_id = 'node-xxx';
```

### 5.8 查找依赖项目 B 的所有项目 A 任务（带权限过滤）

```sql
SELECT src.*
FROM project_tree_links l
JOIN project_tree_nodes src ON src.id = l.source_node_id
WHERE l.target_project_id = 'project-B'
  AND l.link_type = 'depends-on'
  AND l.source_project_id = 'project-A';  -- 权限边界
```

### 5.9 查找某节点的完整上下文（树路径 + 外部引用）

```sql
-- 1) 树内祖先
SELECT * FROM project_tree_nodes
WHERE path @> 'P001.T001.ses_aaa.msg_005'
ORDER BY depth;

-- 2) 该节点的外部引用（出链 + 入链）
SELECT 'outgoing' AS direction, l.*, t.path AS linked_path
FROM project_tree_links l
JOIN project_tree_nodes t ON t.id = l.target_node_id
WHERE l.source_node_id = 'msg_005_id'
UNION ALL
SELECT 'incoming' AS direction, l.*, t.path AS linked_path
FROM project_tree_links l
JOIN project_tree_nodes t ON t.id = l.source_node_id
WHERE l.target_node_id = 'msg_005_id';
```

---

## 6. Drizzle ORM 集成

### 6.1 自定义 ltree 列类型

Drizzle 尚未内置 `ltree` 类型，需自定义：

```typescript
// control-plane/service/src/db/custom-types.ts
import { customType } from "drizzle-orm/pg-core";

export const ltree = customType<{ data: string; driverParam: string }>({
  dataType() {
    return "ltree";
  },
  toDriver(value: string): string {
    return value;
  },
  fromDriver(value: string): string {
    return String(value);
  },
});
```

### 6.2 schema 定义

```typescript
// 在 schema.pg.ts 中新增
import { ltree } from "./custom-types";

export type ProjectTreeNodeType =
  | "project_root"
  | "task"
  | "session"
  | "message"
  | "context"
  | "fork_point";

export const projectTreeNodes = pgTable(
  "project_tree_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),

    // ── 树结构 ──────────────
    parentId: text("parent_id"), // self-reference, FK via raw SQL
    path: ltree("path").notNull(),
    depth: integer("depth").notNull().default(0),

    // ── 类型 ────────────────
    nodeType: text("node_type").$type<ProjectTreeNodeType>().notNull(),

    // ── 内容 ────────────────
    role: text("role"),
    contentText: text("content_text"),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>(),
    tokenCount: integer("token_count"),

    // ── 关联 ────────────────
    runtimeSessionId: text("runtime_session_id"),
    runtimeMessageId: text("runtime_message_id"),

    // ── 分支 ────────────────
    branchName: text("branch_name"),
    isActive: boolean("is_active").notNull().default(true),
    supersededBy: text("superseded_by"),

    // ── 时间 ────────────────
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("idx_ptn_project_path").using("gist", table.path),
    index("idx_ptn_project_id").on(table.projectId),
    index("idx_ptn_parent_id").on(table.parentId),
    index("idx_ptn_node_type").on(table.projectId, table.nodeType),
    // ⚠ 以下条件索引需通过 raw SQL 迁移文件创建（Drizzle 不原生支持 WHERE 子句）:
    //   CREATE INDEX idx_ptn_runtime_ses ON project_tree_nodes (runtime_session_id) WHERE runtime_session_id IS NOT NULL;
    //   CREATE INDEX idx_ptn_runtime_msg ON project_tree_nodes (runtime_message_id) WHERE runtime_message_id IS NOT NULL;
  ],
);

export const projectTreeBranches = pgTable(
  "project_tree_branches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    taskNodeId: text("task_node_id").references(() => projectTreeNodes.id),
    branchName: text("branch_name").notNull(),
    headNodeId: text("head_node_id")
      .notNull()
      .references(() => projectTreeNodes.id),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  // ⚠ 唯一约束需要通过 raw SQL 迁移文件创建（Drizzle 不原生支持 partial unique index）:
  //   CREATE UNIQUE INDEX idx_ptb_project_branch_unique ON ... WHERE task_node_id IS NULL;
  //   CREATE UNIQUE INDEX idx_ptb_task_branch_unique   ON ... WHERE task_node_id IS NOT NULL;
  // 此处不定义 uniqueIndex，避免生成错误的三列组合唯一约束
);

export const projectTreeEvents = pgTable(
  "project_tree_events",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    seq: integer("seq").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_pte_node_seq").on(table.nodeId, table.seq),
    index("idx_pte_project_time").on(table.projectId, table.createdAt),
  ],
);
```

---

## 7. 项目创建时自动建立 root 节点

### 7.1 修改项目创建路由

在 `control-plane/service/src/modules/projects/routes.ts` 的 `POST /api/projects` 中，项目插入后立即创建 root 节点：

```typescript
// 伪代码 — 在 db.insert(projects).values({...}) 之后
const rootNodeId = crypto.randomUUID();
const pathLabel = id.replace(/-/g, "_"); // ltree 不允许 `-`

await db.insert(projectTreeNodes).values({
  id: rootNodeId,
  projectId: id,
  parentId: null,
  path: pathLabel,          // e.g. "a1b2c3d4_..."
  depth: 0,
  nodeType: "project_root",
  contentText: body.name,   // 项目名称作为 root 内容
  isActive: true,
});

// 创建默认分支引用
await db.insert(projectTreeBranches).values({
  id: crypto.randomUUID(),
  projectId: id,
  taskNodeId: null,
  branchName: "main",
  headNodeId: rootNodeId,
  isDefault: true,
});
```

### 7.2 任务创建逻辑（直接写树节点，不再写 tasks 表）

任务创建时直接在树中插入 `node_type=task` 节点，任务元数据存储在 `content_json` 中：

```typescript
// 伪代码 — 直接创建 task 树节点，无需写 tasks 表
const projectRoot = await db.query.projectTreeNodes.findFirst({
  where: and(
    eq(projectTreeNodes.projectId, body.projectId),
    eq(projectTreeNodes.nodeType, "project_root"),
  ),
});

const taskNodeId = crypto.randomUUID();
const taskPathLabel = taskNodeId.replace(/-/g, "_");

await db.insert(projectTreeNodes).values({
  id: taskNodeId,
  projectId: body.projectId,
  parentId: projectRoot!.id,
  path: `${projectRoot!.path}.${taskPathLabel}`,
  depth: 1,
  nodeType: "task",
  contentText: body.title,
  contentJson: {
    prompt: body.prompt,
    status: "pending",
    category: body.category,
    strategy: body.strategy,
    selectedModel: body.selectedModel,
    executionMode: body.executionMode,
    repoId: body.repoId,
    workspaceRoot: body.workspaceRoot,
    baseRevision: body.baseRevision,
    workingBranch: body.workingBranch,
  },
  isActive: true,
});
```

---

## 8. 被替换的旧表与清理策略

### 8.1 当前映射与目标收尾

| 旧表 | 处理 | 替代方案 |
|------|------|---------|
| `tasks` | **已执行 DROP** | 任务事实已由 `node_type=task` 节点承载，元数据存 `content_json` |
| `task_sessions` | **已执行 DROP（独立 migration `0011_drop_task_sessions.sql`）** | 运行时事实已切到 `node_type=session` 节点；离线输入链也不再将其作为导入目标 |
| `project_task_relations` | **运行时已退出主线；drop migration 已落地** | 跨树关系已进入 `project_tree_links` |
| `sessions` | **已执行 DROP** | token / cost 聚合后续从 `project_tree_nodes` + `project_tree_events` 或新统计表计算 |

### 8.2 清理原则

1. 旧表历史数据不进入新树表，不做回填、不保留 `old_task_id` 之类桥接字段。
2. 只要旧数据在新版本中无法继续消费，就直接清空后删除，不为历史兼容保留读路径。
3. 在删表批次真正落地后，项目需要重新创建 task / session / link 节点；旧任务历史默认视为失效。
4. `projects`、`users`、`organizations`、`repositories` 等基础实体继续保留；被删除的是任务域旧表以及所有以旧 `task_id` 为核心的工作流/审计衍生表。

### 8.3 连带清理范围

凡是以 `task_id` 为核心外键且无法在切换时同步改造成新树模型的表，均与旧任务数据一起清空或删除，避免保留悬挂数据。该原则仍然成立；但截至 2026-03-21，下列表已完成 `task_id -> project_tree_nodes.id` 迁移，不再阻塞 `tasks` 镜像写入的删除：

- `agent_runs`
- `code_changes`
- `task_workflow_runs`
- `task_stage_runs`
- `role_aggregate_conclusions`
- `developer_change_requests`
- `task_operating_modes`
- `boss_decisions`
- `human_escalations`
- `runtime_usage_ledgers`
- `runtime_usage_ledger_steps`

这些表已经不再依赖旧 `tasks.id`，当前可以视为“tree-adjacent 衍生表”。后续是否继续保留，取决于产品是否继续沿用这批事实表，而不再受 `tasks` 镜像约束。

### 8.4 最终删表清单

以下表属于最终仍应删除的旧核心表，或尚待产品决策的兼容衍生表：

| 表名 | 类型 | 删除原因 |
|------|------|----------|
| `tasks` | 核心旧表 | 旧任务实体被 `project_tree_nodes(node_type=task)` 取代 |
| `task_sessions` | 已删除旧表 | 旧会话分支模型已被 `project_tree_nodes(node_type=session)` 取代；兼容 lineage API 与离线导入目标均已移除 |
| `sessions` | 核心旧表 | 旧 session 汇总模型不再作为事实来源 |
| `project_task_relations` | 核心旧表 | 旧任务关系图被 `project_tree_links` 取代 |
| `agent_runs` | 衍生表 | 已迁到 tree task FK；是否删除取决于是否保留独立 execution 事实表 |
| `code_changes` | 衍生表 | 已迁到 tree task FK；是否删除取决于是否保留独立代码变更事实表 |
| `file_changes` | 衍生表 | 仅依附 `code_changes` 存在 |
| `task_workflow_runs` | 衍生表 | 已迁到 tree task FK；是否删除取决于 workflow 模型是否继续保留 |
| `task_stage_runs` | 衍生表 | 仅依附 `task_workflow_runs` 存在 |
| `role_aggregate_conclusions` | 衍生表 | 已迁到 tree task FK；是否删除取决于聚合结论能力是否继续保留 |
| `developer_change_requests` | 衍生表 | 已迁到 tree task FK；是否删除取决于整改请求能力是否继续保留 |
| `task_operating_modes` | 衍生表 | 已迁到 tree task FK；是否删除取决于运行档位事实表是否继续保留 |
| `boss_decisions` | 衍生表 | 已迁到 tree task FK；是否删除取决于 boss 决策日志是否继续保留 |
| `human_escalations` | 衍生表 | 已迁到 tree task FK；是否删除取决于人工升级日志是否继续保留 |
| `runtime_usage_ledgers` | 衍生表 | 已迁到 tree task FK；是否删除取决于统一账本模型是否继续保留 |
| `runtime_usage_ledger_steps` | 衍生表 | 仅依附 `runtime_usage_ledgers` 存在 |

### 8.5 `drop tasks / sessions / task_sessions` 落地结果（2026-03-21）

本轮落地基于当日代码扫描结论执行：运行时已不再直接 SQL 读写 `tasks` / `sessions` / `task_sessions`，离线 SQLite 快照迁移链也已改为把旧 task/session 事实投影进 `project_tree_nodes` / `project_tree_branches`。

#### Phase A. 删表前置条件确认结果

1. 已确认 `scripts/`、`runbooks/`、导出工具不存在新的 `tasks` / `sessions` / `task_sessions` 直读入口。
2. 已确认 SQLite 快照迁移链产物不再将 `tasks` / `sessions` / `task_sessions` 作为 PostgreSQL 导入目标表。
3. 原先需要单独保留的 `task_sessions` 兼容 lineage 表也已完成清理与独立 drop。

#### Phase B. 一次性数据收口结果

1. 保留已有 `0009_task_fk_to_project_tree_nodes.sql` 作为 task 事实迁树基础，不再新增 `tasks` 镜像回填逻辑。
2. 若生产库仍存在仅保存在 `sessions` 中、但尚未写入 session 树节点 `content_json` 的汇总信息，可在 drop migration 前增加一次性 SQL，将 `tokens_used`、`cost`、`model_used`、`agent_used`、`started_at`、`finished_at` 合并进对应 `node_type=session` 节点的 `content_json.legacySession`。
3. 该步完成后，`sessions` 的剩余价值仅限历史审计，不再承担运行时或离线迁移职责。

#### Phase C. 物理删表迁移结果

已按两批 migration 落地：`0010_drop_tasks_and_sessions.sql` 与 `0011_drop_task_sessions.sql`。

执行顺序：

1. 删除 `tasks` / `sessions` 上残余索引、视图或约束（若环境中仍存在额外自定义对象）。
2. `DROP TABLE IF EXISTS sessions;`
3. `DROP TABLE IF EXISTS tasks;`
4. 通过独立 migration `0011_drop_task_sessions.sql` 执行 `DROP TABLE IF EXISTS task_sessions;`。

#### Phase D. 代码与文档收口结果

1. 已从 PostgreSQL schema、migration metadata、启动期兼容 SQL 中移除 `task_sessions` 定义与兼容补丁，并完成 `tasks` / `sessions` 的已删状态收口。
2. 已清理 service/BFF/tests 中针对 `task_sessions` 的 teardown、断言与历史注释；`tasks` / `sessions` 相关清理也已同步完成主体收口。
3. 本文档已将 8.1、8.4 中 `tasks` / `sessions` / `task_sessions` 状态更新为“已删”或“待物理删除的唯一旧表”。

#### Phase E. 验证结果

1. 已运行 `db:migrate:pg`，确认 `0011_drop_task_sessions.sql` 在真实本地 PostgreSQL 环境可落地。
2. 已在干净目标库 `openerx_sqlite_recheck_20260321` 上执行 `db:migrate:sqlite-snapshot` 并完成校验；产物位于 `tmp/sqlite-pg-migration/run-2026-03-21T08-51-09.715Z/`。
3. 更宽 service regression 已覆盖 task tree、workflow lazy migration、runtime usage ledger、session lineage/tree 相关主路径，未发现 `task_sessions` 隐藏依赖；`role-workflow-storage.test.ts` 已切到 tree-first detail 读面后恢复通过。
4. targeted 前端/UI regression 已补齐 `TaskDetail.test.ts`、`TaskDetailV2.test.ts`、`MultiTaskMonitor.test.ts` 与现有 Chat Settings Vitest 用例；Playwright `test:e2e:chat-settings` 已修复登录后侧边栏菜单重挂载导致的点击超时并重新通过；随后补跑的全量 `test:ui` 也已全部通过，确认当前 tree-first / legacy task table 退场没有残留独立 UI 回归。

### 8.5 保留表结构但清空历史记录

以下表不必删表，但若其记录引用旧 `task_id` / `session_id` / `agent_run_id`，切换时应清空历史数据，避免新旧语义混杂：

| 表名 | 处理 | 原因 |
|------|------|------|
| `audit_events` | **DELETE 历史记录** | 含 `taskId` / `sessionId` / `agentRunId` 文本字段，旧追踪链失效 |
| `cost_records` | **DELETE 历史记录** | 含 `taskId` / `sessionId` / `agentRunId` 文本字段，旧成本归因失效 |
| `approval_tickets` | **DELETE 历史记录** | `taskId` 仍绑定旧任务模型，旧审批单不可继续使用 |

这些表后续可以继续保留结构，但只接收新树模型下重新定义后的事件或统计数据。

### 8.6 明确保留的基础表

以下表属于平台基础实体、配置实体或与任务树解耦的能力表，应继续保留：

| 表名 | 保留原因 |
|------|----------|
| `organizations` | 组织主体 |
| `projects` | 项目主体，新树以 `project_id` 关联 |
| `environments` | 环境配置 |
| `users` | 用户主体 |
| `project_roles` | 项目成员授权 |
| `paid_execution_leases` | 付费执行配额控制 |
| `runtime_usage_baselines` | 基线统计，可在新模型下继续生成 |
| `repositories` | 仓库注册信息 |
| `repository_credentials` | 仓库凭据引用 |
| `policy_templates` | 策略模板 |
| `budget_configs` | 预算配置 |
| `plugins` | 插件注册 |
| `workbench_layouts` | 用户工作台布局 |
| `role_agents` | 角色代理定义 |
| `role_agent_bindings` | 角色代理绑定 |
| `role_agent_project_overrides` | 角色代理项目级覆盖 |
| `workflow_templates` | 工作流模板定义 |
| `workflow_template_stages` | 工作流模板阶段定义 |

如果未来需要在新树模型下恢复审批、成本、审计、工作流能力，应优先复用这些基础表，再为新节点模型补新的事实表，而不是回收旧任务域表。

---

## 9. 切换与清理计划

### 9.1 切换文件草案

当前已落地文件：`control-plane/service/drizzle-pg/0006_project_tree_foundation.sql`

当前已落地的 snapshot 对齐文件：`control-plane/service/drizzle-pg/0007_narrow_prism.sql`（no-op，占位以保留 `0007_snapshot.json`）

```sql
-- Step 1: 启用扩展
CREATE EXTENSION IF NOT EXISTS ltree;

-- Step 2: 创建新表
CREATE TABLE IF NOT EXISTS project_tree_nodes (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  parent_id    TEXT REFERENCES project_tree_nodes(id),
  path         LTREE NOT NULL,
  depth        INTEGER NOT NULL DEFAULT 0,
  node_type    TEXT NOT NULL,
  role         TEXT,
  content_text TEXT,
  content_json JSONB,
  token_count  INTEGER,
  runtime_session_id   TEXT,
  runtime_message_id   TEXT,
  branch_name  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by TEXT REFERENCES project_tree_nodes(id),
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at  TEXT
);

CREATE INDEX idx_ptn_project_path ON project_tree_nodes USING GIST (path);
CREATE INDEX idx_ptn_project_id   ON project_tree_nodes (project_id);
CREATE INDEX idx_ptn_parent_id    ON project_tree_nodes (parent_id);
CREATE INDEX idx_ptn_node_type    ON project_tree_nodes (project_id, node_type);
CREATE INDEX idx_ptn_runtime_ses  ON project_tree_nodes (runtime_session_id)
  WHERE runtime_session_id IS NOT NULL;
CREATE INDEX idx_ptn_runtime_msg  ON project_tree_nodes (runtime_message_id)
  WHERE runtime_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_tree_branches (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  task_node_id TEXT REFERENCES project_tree_nodes(id),
  branch_name  TEXT NOT NULL,
  head_node_id TEXT NOT NULL REFERENCES project_tree_nodes(id),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_ptb_project_branch_unique
  ON project_tree_branches (project_id, branch_name)
  WHERE task_node_id IS NULL;

CREATE UNIQUE INDEX idx_ptb_task_branch_unique
  ON project_tree_branches (project_id, task_node_id, branch_name)
  WHERE task_node_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_tree_events (
  id           TEXT PRIMARY KEY,
  node_id      TEXT REFERENCES project_tree_nodes(id),
  project_id   TEXT NOT NULL REFERENCES projects(id),
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  seq          INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pte_node_seq    ON project_tree_events (node_id, seq);
CREATE INDEX idx_pte_project_time ON project_tree_events (project_id, created_at);

CREATE TABLE IF NOT EXISTS project_tree_links (
  id                TEXT PRIMARY KEY,
  source_node_id    TEXT NOT NULL REFERENCES project_tree_nodes(id),
  source_project_id TEXT NOT NULL REFERENCES projects(id),
  target_node_id    TEXT NOT NULL REFERENCES project_tree_nodes(id),
  target_project_id TEXT NOT NULL REFERENCES projects(id),
  link_type         TEXT NOT NULL,
  metadata          JSONB,
  bidirectional     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_node_id, target_node_id, link_type)
);

CREATE INDEX idx_ptl_source          ON project_tree_links (source_node_id);
CREATE INDEX idx_ptl_target          ON project_tree_links (target_node_id);
CREATE INDEX idx_ptl_source_project  ON project_tree_links (source_project_id, link_type);
CREATE INDEX idx_ptl_target_project  ON project_tree_links (target_project_id, link_type);

-- Step 3: 清空旧任务域数据
-- ⚠ 必须在一条 TRUNCATE 内列出所有表，否则 FK 交叉引用会导致 RESTRICT 报错
TRUNCATE TABLE
  file_changes,
  code_changes,
  task_stage_runs,
  task_workflow_runs,
  runtime_usage_ledger_steps,
  runtime_usage_ledgers,
  role_aggregate_conclusions,
  developer_change_requests,
  task_operating_modes,
  boss_decisions,
  human_escalations,
  agent_runs,
  project_task_relations,
  task_sessions,
  sessions,
  tasks
CASCADE;

-- Step 3.5: 清空保留表中的旧历史记录
DELETE FROM approval_tickets;
DELETE FROM cost_records;
DELETE FROM audit_events;

-- Step 4: 删除旧任务域表（叶子表先删，避免 FK 约束报错）
-- Layer 1: 叶子表（不被任何待删表引用）
DROP TABLE IF EXISTS file_changes;
DROP TABLE IF EXISTS task_stage_runs;
DROP TABLE IF EXISTS runtime_usage_ledger_steps;
DROP TABLE IF EXISTS role_aggregate_conclusions;
DROP TABLE IF EXISTS developer_change_requests;
DROP TABLE IF EXISTS task_operating_modes;
DROP TABLE IF EXISTS boss_decisions;
DROP TABLE IF EXISTS human_escalations;
DROP TABLE IF EXISTS task_sessions;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS project_task_relations;
-- Layer 2: 被 Layer 1 引用的表
DROP TABLE IF EXISTS code_changes;
DROP TABLE IF EXISTS task_workflow_runs;
DROP TABLE IF EXISTS runtime_usage_ledgers;
-- Layer 3: 被 Layer 2 引用的表
DROP TABLE IF EXISTS agent_runs;
-- Layer 4: 根表
DROP TABLE IF EXISTS tasks;

-- Step 5: 后续所有 root/task/session/message/link 数据仅写新树表
```

---

## 10. API 变更概要

### 10.1 新增端点

| 方法 | 路径 | 说明 | 当前状态 |
|------|------|------|---------|
| GET | `/api/projects/:projectId/tree` | 返回项目树（可选 `?depth=N`、`?nodeType=task` 过滤） | **已完成** |
| GET | `/api/projects/:projectId/tree/:nodeId` | 返回单个节点详情 | **已完成** |
| GET | `/api/projects/:projectId/tree/:nodeId/ancestors` | 返回从 root 到该节点的完整路径 | **已完成** |
| GET | `/api/projects/:projectId/tree/:nodeId/children` | 返回直接子节点 | **已完成** |
| POST | `/api/projects/:projectId/tree/:nodeId/children` | 在指定节点下创建子节点 | **已完成** |
| GET | `/api/projects/:projectId/branches` | 列出项目所有分支引用 | **已完成** |
| PUT | `/api/projects/:projectId/branches/:branchId` | 更新分支 head 指针 | **已完成** |
| GET | `/api/projects/:projectId/tree/:nodeId/links` | 查询某节点的所有跨树链接（出链 + 入链） | **已完成** |
| POST | `/api/projects/:projectId/tree/:nodeId/links` | 创建从该节点到目标节点的链接 | **已完成** |
| DELETE | `/api/projects/:projectId/links/:linkId` | 删除一条跨树链接 | **已完成** |
| GET | `/api/projects/:projectId/links` | 列出项目涉及的所有跨树链接 | **已完成** |

### 10.2 现有端点切换

| 现有端点 | 变更 |
|---------|------|
| `POST /api/projects` | 内部自动创建 root 节点，响应新增 `rootNodeId` 字段。**当前状态：已完成** |
| `POST /api/tasks` | 当前兼容保留，但已同步写 `node_type=task` 节点；后续由新的树节点创建端点替代并删除该入口。 |
| `POST /api/tasks/:taskId/branches` | 当前作为 branch lineage 写入口，直接同步 `node_type=session` 节点。 |
| `GET /api/tasks/:taskId/branches` | 当前作为 branch lineage 读取入口，直接返回树侧分支记录；不再从旧 task payload 合成 fallback branch。 |
| `GET /api/tasks` | 当前仍保留兼容读取；后续改为项目树查询接口并删除该入口。 |
| `GET /api/audit` / `GET /api/cost/*` / `GET /api/approvals/*` | 端点保留；待数据收口后只展示新周期数据。 |

说明：后续完成接口收口后，不会提供旧任务 ID 到新节点 ID 的兼容映射；任何继续依赖旧 `task_id` / `runtime_session_id` 的历史调用都需要同步迁移。

---

## 11. 性能考量

| 场景 | 策略 |
|------|------|
| 深层消息查询（depth > 20） | ltree GiST 索引，`path <@` 操作符 O(log N) |
| 项目级全消息搜索 | `project_id + node_type='message'` 索引 + `pg_trgm` 全文搜索 |
| 高频 streaming 写入 | 先写 `project_tree_events`（追加），定期合并到 `project_tree_nodes` |
| 跨项目查询（树内） | 不支持（by design：项目间数据隔离） |
| 跨项目查询（链接） | 通过 `project_tree_links` 支持；每次跨项目读取需验证用户对目标项目有权限 |
| path 更新（子树移动） | 批量 `UPDATE path = new_prefix || subpath(path, old_depth)` |

### 11.1 ltree vs 递归 CTE 性能对比

| 查询类型 | 递归 CTE | ltree |
|---------|---------|-------|
| 找所有后代 | O(N) 每层递归 | O(log N) GiST 索引 |
| 找所有祖先 | O(depth) 递归 | O(1) `@>` 操作 |
| 判断祖先关系 | 需要遍历 | `path @> path2` 常数时间 |
| 子树计数 | 多层 JOIN | 单次 `<@` 扫描 |

---

## 12. 安全与隔离

- **项目隔离**：树内查询必须带 `project_id` 条件，索引首列均为 `project_id`。
- **跨树链接权限**：查询跨树链接时，返回结果前必须验证当前用户对 `target_project_id` 也有读权限；无权限的链接不返回目标节点详情，仅返回链接存在性。
- **权限**：复用现有 `requireRole("developer")` / `requireRole("org_admin")` 中间件。
- **path 注入防护**：ltree label 只允许 `[a-zA-Z0-9_]`，UUID 中的 `-` 替换为 `_`，其他字符一律拒绝。
- **不可变性**：消息节点一旦创建不可修改 `content_text` / `content_json`，只能通过 `superseded_by` 指向新版本。
- **链接可变性**：链接（`project_tree_links`）可以创建和删除，因为引用关系的生命周期与节点不同。

---

## 13. 与 Git 对象模型的对照

| Git 概念 | 本方案对应 | 说明 |
|---------|-----------|------|
| Tree object | `project_tree_nodes` (node_type = project_root / task / session) | 目录/容器节点 |
| Blob object | `project_tree_nodes` (node_type = message / context) | 叶子内容节点 |
| Commit | `project_tree_events` 的 message_complete 事件 | 状态快照点 |
| Branch ref | `project_tree_branches` | 指向 head 节点的可移动指针 |
| HEAD | `project_tree_branches.is_default = true` | 当前活跃分支 |
| Object hash (SHA) | `id` (UUID v7) | 唯一标识，时间有序 |
| Merkle DAG | `path` (ltree) + `parent_id` | 路径 + 邻接双重索引 |
| Submodule / remote | `project_tree_links` | 跨树引用（不改变归属，仅建立链接） |

---

## 14. 批次计划

| Phase | 内容 | 预估工作 | 当前状态 |
|-------|------|---------|---------|
| **Phase 0** | 树表、扩展、root 初始化、tree-first 主写切换 | 切换脚本 + 类型定义 | **已完成** |
| **Phase 1** | tree / branches / links API、BFF tree 数据面接入、`task_sessions` 兼容调用收口 | 路由改造 + BFF 适配 | **已完成** |
| **Phase 2** | 前端通用消息源切树模型；删除 `/api/tasks*` 兼容读取入口；完成 `tasks` / `sessions` / `task_sessions` 删表收口 | 前端 composable 改造 + 旧路由清理 + migration 收口 | **已完成** |
| **Phase 3** | `pg_trgm` 搜索、`project_tree_events` 增量能力、完整端到端验证 | 统一收敛到 [pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md) 执行 | **未开始** |

---

## 15. 开放问题

| # | 问题 | 待决策 |
|---|------|--------|
| 1 | ltree path label 最大长度限制（PostgreSQL 默认 256 字符/label） | 评估 UUID→短 hash 映射方案 |
| 2 | 消息内容是否存全文还是仅存摘要？全文 = 存储膨胀，摘要 = 需要回 runtime 取原文 | Phase 2 前决策 |
| 3 | `project_tree_events` 合并频率？实时 vs 批量？ | 已转入 [pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md) 统一评估 |
| 4 | 是否需要支持「子树移动」（如将任务从一个项目迁移到另一个） | 当前设计不支持，需确认 |
| 5 | `pg_trgm` 全文搜索如何与 message snapshot / 项目级搜索接口协同落地？ | 已转入 [pg-event-sourcing-optimization-plan.md](pg-event-sourcing-optimization-plan.md) 统一评估 |
| 6 | 跨树链接是否需要审批流？（如项目 A 主动链接到项目 B 的节点） | 取决于组织权限模型 |
| 7 | `bidirectional` 链接的反向查询是否需要额外索引优化？ | 根据实际查询模式评估 |
