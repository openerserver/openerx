# Task 树数据模型 v2（最终建表版）

> 状态：Final v2  
> 日期：2026-04-02  
> 用途：新项目直接建表

## 1. 最终结论

1. `task_sessions` 是 Task 树唯一节点表（一次用户回合 = 一个 session 节点）。
2. `task_session_runs` 是 session 内执行尝试层（并行 candidate、judge、retry、resume 都在 run 层表达）。
3. `task_messages` + `task_message_parts` 是可见消息层（message 只属于一个 session）。
4. `task_operations` 是执行动作层（model_request、tool_call、judge、hook 等）。
5. `task_artifacts` 是长期可引用产物层。
6. `task_event_log` 是调试审计层，不参与主读链树重建。
7. session 终态闭环固定为：`task_sessions.head_message_id` + `task_sessions.latest_run_id` + `task_messages.created_by_run_id`。

## 2. 最终表结构（PostgreSQL）

```sql
-- ============================================================
-- Task Tree v2 Final Schema (Greenfield)
-- ============================================================

-- 1) task_sessions: 任务树节点表
CREATE TABLE IF NOT EXISTS task_sessions (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  project_id text NOT NULL,
  tree_node_id text,
  parent_session_id text,
  root_session_id text,
  source_message_id text,
  session_type text NOT NULL,
  workflow_stage_key text,
  spawn_trigger_type text NOT NULL,
  spawn_rule_key text,
  user_prompt_summary text,
  status text NOT NULL DEFAULT 'running',
  head_message_id text,
  latest_run_id text,
  depth integer NOT NULL DEFAULT 0,
  sort_key text,
  archived_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_sessions_parent
    FOREIGN KEY (parent_session_id) REFERENCES task_sessions(id),
  CONSTRAINT fk_task_sessions_root
    FOREIGN KEY (root_session_id) REFERENCES task_sessions(id),
  CONSTRAINT ck_task_sessions_type CHECK (
    session_type IN ('root', 'follow_up', 'manual_branch', 'workflow_spawn')
  ),
  CONSTRAINT ck_task_sessions_status CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'interrupted', 'archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_sessions_tree_node_id
  ON task_sessions(tree_node_id);
CREATE INDEX IF NOT EXISTS idx_task_sessions_task_created_at
  ON task_sessions(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_sessions_task_parent_created_at
  ON task_sessions(task_id, parent_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_sessions_task_sort_key
  ON task_sessions(task_id, sort_key);
CREATE INDEX IF NOT EXISTS idx_task_sessions_root_session_id
  ON task_sessions(root_session_id);


-- 2) task_session_runs: session 执行尝试表
CREATE TABLE IF NOT EXISTS task_session_runs (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  session_id text NOT NULL,
  attempt_index integer NOT NULL,
  runtime_session_id text,
  trigger_type text NOT NULL,
  execution_kind text NOT NULL,
  candidate_index integer,
  lane_role text NOT NULL,
  executor_kind text NOT NULL,
  model_route text,
  workflow_stage_key text,
  status text NOT NULL DEFAULT 'running',
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  result_summary text,
  error_text text,
  started_at text,
  finished_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_session_runs_session
    FOREIGN KEY (session_id) REFERENCES task_sessions(id),
  CONSTRAINT ck_task_session_runs_trigger_type CHECK (
    trigger_type IN ('user_prompt', 'assistant_reply', 'parallel_result', 'resume', 'workflow_spawn', 'system_retry')
  ),
  CONSTRAINT ck_task_session_runs_execution_kind CHECK (
    execution_kind IN ('single', 'parallel_candidate', 'judge', 'repair', 'resume', 'workflow_step')
  ),
  CONSTRAINT ck_task_session_runs_lane_role CHECK (
    lane_role IN ('primary', 'candidate', 'judge', 'repair', 'resume', 'hook')
  ),
  CONSTRAINT ck_task_session_runs_status CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'interrupted', 'archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_runs_session_attempt_index
  ON task_session_runs(session_id, attempt_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_runs_session_id_id
  ON task_session_runs(session_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_session_runs_runtime_session_id
  ON task_session_runs(runtime_session_id);
CREATE INDEX IF NOT EXISTS idx_task_session_runs_task_session_created_at
  ON task_session_runs(task_id, session_id, created_at);


-- 3) task_messages: session 可见消息表
CREATE TABLE IF NOT EXISTS task_messages (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  session_id text NOT NULL,
  created_by_run_id text,
  role text NOT NULL,
  message_kind text NOT NULL,
  parent_message_id text,
  reply_to_message_id text,
  seq integer NOT NULL,
  text_preview text,
  part_count integer NOT NULL DEFAULT 0,
  token_used bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'streaming',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at text,
  CONSTRAINT fk_task_messages_session
    FOREIGN KEY (session_id) REFERENCES task_sessions(id),
  CONSTRAINT fk_task_messages_parent
    FOREIGN KEY (parent_message_id) REFERENCES task_messages(id),
  CONSTRAINT fk_task_messages_reply
    FOREIGN KEY (reply_to_message_id) REFERENCES task_messages(id),
  CONSTRAINT ck_task_messages_role CHECK (
    role IN ('user', 'assistant', 'system', 'tool')
  ),
  CONSTRAINT ck_task_messages_kind CHECK (
    message_kind IN ('prompt', 'reply', 'note', 'tool_echo')
  ),
  CONSTRAINT ck_task_messages_status CHECK (
    status IN ('streaming', 'completed', 'failed', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_messages_session_seq
  ON task_messages(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_messages_session_id_id
  ON task_messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_task_messages_task_created_at
  ON task_messages(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_messages_session_created_at
  ON task_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_messages_session_role_created_at
  ON task_messages(session_id, role, created_at);


-- 4) task_message_parts: 消息分片正文表
CREATE TABLE IF NOT EXISTS task_message_parts (
  id text PRIMARY KEY,
  message_id text NOT NULL,
  part_index integer NOT NULL,
  part_type text NOT NULL,
  text_content text,
  json_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_message_parts_message
    FOREIGN KEY (message_id) REFERENCES task_messages(id),
  CONSTRAINT ck_task_message_parts_part_type CHECK (
    part_type IN ('text', 'reasoning', 'tool_call', 'tool_result', 'json', 'artifact_ref')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_message_parts_message_part_index
  ON task_message_parts(message_id, part_index);
CREATE INDEX IF NOT EXISTS idx_task_message_parts_message_id
  ON task_message_parts(message_id);


-- 5) task_operations: 执行操作事实表
CREATE TABLE IF NOT EXISTS task_operations (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  session_id text NOT NULL,
  run_id text NOT NULL,
  message_id text,
  parent_operation_id text,
  runtime_operation_id text,
  operation_index integer NOT NULL,
  operation_kind text NOT NULL,
  tool_name text,
  title text,
  status text NOT NULL DEFAULT 'running',
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at text,
  finished_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_operations_session
    FOREIGN KEY (session_id) REFERENCES task_sessions(id),
  CONSTRAINT fk_task_operations_run
    FOREIGN KEY (run_id) REFERENCES task_session_runs(id),
  CONSTRAINT fk_task_operations_message
    FOREIGN KEY (message_id) REFERENCES task_messages(id),
  CONSTRAINT fk_task_operations_parent
    FOREIGN KEY (parent_operation_id) REFERENCES task_operations(id),
  CONSTRAINT ck_task_operations_kind CHECK (
    operation_kind IN ('model_request', 'tool_call', 'judge', 'hook', 'resume', 'system')
  ),
  CONSTRAINT ck_task_operations_status CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'interrupted', 'archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_operations_run_operation_index
  ON task_operations(run_id, operation_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_operations_runtime_operation_id
  ON task_operations(runtime_operation_id);
CREATE INDEX IF NOT EXISTS idx_task_operations_task_created_at
  ON task_operations(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_operations_session_created_at
  ON task_operations(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_operations_message_id
  ON task_operations(message_id);
CREATE INDEX IF NOT EXISTS idx_task_operations_parent_operation_id
  ON task_operations(parent_operation_id);


-- 6) task_artifacts: 正式产物表
CREATE TABLE IF NOT EXISTS task_artifacts (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  session_id text,
  run_id text,
  message_id text,
  operation_id text,
  artifact_type text NOT NULL,
  title text,
  storage_kind text NOT NULL DEFAULT 'inline_json',
  text_content text,
  json_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  mime_type text,
  size_bytes bigint,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_artifacts_session
    FOREIGN KEY (session_id) REFERENCES task_sessions(id),
  CONSTRAINT fk_task_artifacts_run
    FOREIGN KEY (run_id) REFERENCES task_session_runs(id),
  CONSTRAINT fk_task_artifacts_message
    FOREIGN KEY (message_id) REFERENCES task_messages(id),
  CONSTRAINT fk_task_artifacts_operation
    FOREIGN KEY (operation_id) REFERENCES task_operations(id)
);

CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_created_at
  ON task_artifacts(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_session_created_at
  ON task_artifacts(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_run_created_at
  ON task_artifacts(run_id, created_at);


-- 7) task_event_log: 调试/审计事件表
CREATE TABLE IF NOT EXISTS task_event_log (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  session_id text,
  run_id text,
  message_id text,
  operation_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_event_log_session
    FOREIGN KEY (session_id) REFERENCES task_sessions(id),
  CONSTRAINT fk_task_event_log_run
    FOREIGN KEY (run_id) REFERENCES task_session_runs(id),
  CONSTRAINT fk_task_event_log_message
    FOREIGN KEY (message_id) REFERENCES task_messages(id),
  CONSTRAINT fk_task_event_log_operation
    FOREIGN KEY (operation_id) REFERENCES task_operations(id)
);

CREATE INDEX IF NOT EXISTS idx_task_event_log_task_created_at
  ON task_event_log(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_event_log_session_created_at
  ON task_event_log(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_event_log_run_created_at
  ON task_event_log(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_event_log_event_type_created_at
  ON task_event_log(event_type, created_at);


-- ============================================================
-- Cross-table integrity constraints (final form)
-- ============================================================

-- Ensure head message belongs to session
ALTER TABLE task_sessions
  ADD CONSTRAINT task_sessions_head_message_fk
  FOREIGN KEY (id, head_message_id)
  REFERENCES task_messages(session_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Ensure latest run belongs to session
ALTER TABLE task_sessions
  ADD CONSTRAINT task_sessions_latest_run_fk
  FOREIGN KEY (id, latest_run_id)
  REFERENCES task_session_runs(session_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Ensure message.created_by_run belongs to same session
ALTER TABLE task_messages
  ADD CONSTRAINT task_messages_created_by_run_fk
  FOREIGN KEY (session_id, created_by_run_id)
  REFERENCES task_session_runs(session_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Ensure source message belongs to parent session
ALTER TABLE task_sessions
  ADD CONSTRAINT task_sessions_source_message_fk
  FOREIGN KEY (parent_session_id, source_message_id)
  REFERENCES task_messages(session_id, id)
  DEFERRABLE INITIALLY DEFERRED;
```
