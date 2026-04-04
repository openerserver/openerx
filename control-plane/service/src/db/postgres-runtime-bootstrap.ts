import type { Sql } from "postgres";

const POSTGRES_RUNTIME_BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "task_sessions" (
    "id" text PRIMARY KEY,
    "task_id" text NOT NULL,
    "project_id" text NOT NULL,
    "tree_node_id" text,
    "parent_session_id" text,
    "root_session_id" text,
    "coordination_key" text NOT NULL,
    "session_kind" text NOT NULL,
    "trigger_type" text NOT NULL,
    "execution_mode_snapshot" text NOT NULL,
    "execution_status" text NOT NULL DEFAULT 'running',
    "branch_name" text,
    "candidate_index" integer,
    "step_index" integer,
    "runtime_session_id" text,
    "forked_from_message_id" text,
    "selected_model" text,
    "effective_model" text,
    "winner_session_id" text,
    "judge_session_id" text,
    "result_text" text,
    "result_summary" text,
    "error_text" text,
    "input_tokens" bigint NOT NULL DEFAULT 0,
    "output_tokens" bigint NOT NULL DEFAULT 0,
    "total_tokens" bigint NOT NULL DEFAULT 0,
    "cost_usd" double precision NOT NULL DEFAULT 0,
    "last_activity_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" text,
    "finished_at" text,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" text
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_task_sessions_task_created_at"
    ON "task_sessions" ("task_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "idx_task_sessions_runtime_session_id"
    ON "task_sessions" ("runtime_session_id")`,
  `CREATE TABLE IF NOT EXISTS "session_operations" (
    "id" text PRIMARY KEY,
    "session_id" text NOT NULL,
    "task_id" text NOT NULL,
    "project_id" text NOT NULL,
    "runtime_operation_id" text,
    "operation_index" integer NOT NULL DEFAULT 0,
    "operation_kind" text NOT NULL,
    "executor_key" text NOT NULL,
    "executor_label" text,
    "provider_id" text,
    "model_id" text,
    "execution_status" text NOT NULL DEFAULT 'running',
    "input_tokens" bigint NOT NULL DEFAULT 0,
    "output_tokens" bigint NOT NULL DEFAULT 0,
    "total_tokens" bigint NOT NULL DEFAULT 0,
    "cost_usd" double precision NOT NULL DEFAULT 0,
    "output_text" text,
    "error_text" text,
    "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "started_at" text,
    "finished_at" text,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_session_operations_session_created_at"
    ON "session_operations" ("session_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "idx_session_operations_session_operation_index"
    ON "session_operations" ("session_id", "operation_index")`,
  `CREATE TABLE IF NOT EXISTS "task_artifacts" (
    "id" text PRIMARY KEY,
    "task_id" text NOT NULL,
    "project_id" text NOT NULL,
    "session_id" text,
    "message_id" text,
    "operation_id" text,
    "parent_artifact_id" text,
    "artifact_kind" text NOT NULL,
    "storage_kind" text NOT NULL DEFAULT 'inline',
    "title" text,
    "mime_type" text,
    "file_path" text,
    "external_uri" text,
    "content_text" text,
    "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "byte_size" bigint,
    "sha256" text,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_task_artifacts_session_created_at"
    ON "task_artifacts" ("session_id", "created_at")`,
  `CREATE TABLE IF NOT EXISTS "task_usage_ledger_entries" (
    "id" text PRIMARY KEY,
    "task_id" text NOT NULL,
    "project_id" text NOT NULL,
    "session_id" text,
    "message_id" text,
    "operation_id" text,
    "entry_kind" text NOT NULL,
    "provider_id" text,
    "model_id" text,
    "request_count" integer NOT NULL DEFAULT 1,
    "input_tokens" bigint NOT NULL DEFAULT 0,
    "output_tokens" bigint NOT NULL DEFAULT 0,
    "total_tokens" bigint NOT NULL DEFAULT 0,
    "cost_usd" double precision NOT NULL DEFAULT 0,
    "currency_code" text NOT NULL DEFAULT 'USD',
    "recorded_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_task_usage_ledger_entries_session_recorded_at"
    ON "task_usage_ledger_entries" ("session_id", "recorded_at")`,
  `CREATE TABLE IF NOT EXISTS "task_timeline_views" (
    "id" text PRIMARY KEY,
    "project_id" text NOT NULL,
    "task_id" text NOT NULL,
    "session_id" text,
    "message_id" text,
    "operation_id" text,
    "artifact_id" text,
    "item_kind" text NOT NULL,
    "item_role" text,
    "title" text,
    "display_text" text,
    "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "sort_at" text NOT NULL,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `ALTER TABLE IF EXISTS "task_timeline_views"
    ADD COLUMN IF NOT EXISTS "message_id" text`,
  `ALTER TABLE IF EXISTS "task_timeline_views"
    ADD COLUMN IF NOT EXISTS "operation_id" text`,
  `ALTER TABLE IF EXISTS "task_timeline_views"
    ADD COLUMN IF NOT EXISTS "artifact_id" text`,
  `ALTER TABLE IF EXISTS "task_timeline_views"
    ADD COLUMN IF NOT EXISTS "updated_at" text DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE IF EXISTS "task_timeline_views"
    DROP CONSTRAINT IF EXISTS "task_timeline_views_session_id_conversation_sessions_id_fk"`,
  `ALTER TABLE IF EXISTS "task_timeline_views"
    DROP CONSTRAINT IF EXISTS "task_timeline_views_message_id_conversation_messages_id_fk"`,
  `CREATE INDEX IF NOT EXISTS "idx_task_timeline_views_task_sort_at"
    ON "task_timeline_views" ("task_id", "sort_at", "created_at")`,
];

export async function ensurePostgresRuntimeTables(sql: Sql) {
  for (const statement of POSTGRES_RUNTIME_BOOTSTRAP_STATEMENTS) {
    await sql.unsafe(statement);
  }
}