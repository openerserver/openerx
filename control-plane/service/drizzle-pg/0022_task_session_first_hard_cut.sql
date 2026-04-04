CREATE TYPE "task_lifecycle_status" AS ENUM ('draft', 'active', 'done', 'archived');
--> statement-breakpoint
CREATE TYPE "execution_status" AS ENUM ('running', 'complete', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "task_session_kind" AS ENUM (
  'primary',
  'candidate',
  'judge',
  'sequential_step',
  'resume',
  'manual_branch',
  'hook'
);
--> statement-breakpoint
CREATE TYPE "task_session_trigger_type" AS ENUM (
  'execute',
  'continue',
  'resume',
  'workflow_spawn',
  'manual_branch',
  'hook_spawn',
  'system_retry'
);
--> statement-breakpoint
CREATE TYPE "task_session_mode" AS ENUM ('single', 'parallel', 'sequential_chain');
--> statement-breakpoint
CREATE TYPE "session_operation_kind" AS ENUM ('executor', 'judge', 'hook', 'resume', 'system');
--> statement-breakpoint
CREATE TYPE "task_session_message_role" AS ENUM ('user', 'assistant', 'system', 'tool');
--> statement-breakpoint
CREATE TYPE "task_session_message_part_type" AS ENUM (
  'text',
  'tool_call',
  'tool_result',
  'thinking',
  'file_reference',
  'diff'
);
--> statement-breakpoint
CREATE TYPE "task_timeline_item_kind" AS ENUM (
  'task_lifecycle',
  'session',
  'message',
  'operation',
  'artifact'
);
--> statement-breakpoint
CREATE TYPE "task_artifact_kind" AS ENUM (
  'result',
  'report',
  'diff',
  'patch',
  'file',
  'image',
  'archive',
  'link'
);
--> statement-breakpoint
CREATE TYPE "task_artifact_storage_kind" AS ENUM ('inline', 'blob_ref', 'git_ref', 'external_url');
--> statement-breakpoint
CREATE TYPE "task_usage_entry_kind" AS ENUM (
  'model_request',
  'judge_request',
  'hook_request',
  'tool_request',
  'system_overhead'
);
--> statement-breakpoint
CREATE TYPE "workflow_task_source" AS ENUM ('manual_seed', 'workflow_spawn');
--> statement-breakpoint
CREATE TYPE "workflow_task_trigger_event" AS ENUM ('created', 'running', 'completed', 'failed');
--> statement-breakpoint

DROP TABLE IF EXISTS "task_timeline_views" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_usage_ledger_entries" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_artifacts" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_snapshots" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "session_operations" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_session_message_parts" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_session_messages" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_sessions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_domain_events" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "conversation_message_parts" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "conversation_messages" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "conversation_sessions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_run_edges" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_run_nodes" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "task_runs" CASCADE;
--> statement-breakpoint

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "workflow_template_id" text,
  ADD COLUMN IF NOT EXISTS "workflow_template_version" integer,
  ADD COLUMN IF NOT EXISTS "workflow_source" "workflow_task_source" DEFAULT 'manual_seed' NOT NULL,
  ADD COLUMN IF NOT EXISTS "stage_key" text,
  ADD COLUMN IF NOT EXISTS "spawned_from_task_id" text,
  ADD COLUMN IF NOT EXISTS "spawn_trigger_event" "workflow_task_trigger_event",
  ADD COLUMN IF NOT EXISTS "spawn_rule_key" text,
  ADD COLUMN IF NOT EXISTS "lifecycle_status" "task_lifecycle_status" DEFAULT 'draft' NOT NULL,
  ADD COLUMN IF NOT EXISTS "preferred_model" text,
  ADD COLUMN IF NOT EXISTS "activated_at" text,
  ADD COLUMN IF NOT EXISTS "done_at" text,
  ADD COLUMN IF NOT EXISTS "archived_at" text;
--> statement-breakpoint
UPDATE "tasks"
SET "lifecycle_status" = CASE
  WHEN "status" = 'completed' THEN 'done'::"task_lifecycle_status"
  WHEN "status" IS NULL THEN 'draft'::"task_lifecycle_status"
  ELSE 'active'::"task_lifecycle_status"
END;
--> statement-breakpoint
UPDATE "tasks"
SET "preferred_model" = COALESCE("preferred_model", "selected_model")
WHERE "selected_model" IS NOT NULL;
--> statement-breakpoint
UPDATE "tasks"
SET
  "activated_at" = COALESCE("activated_at", "started_at"),
  "done_at" = COALESCE("done_at", "finished_at");
--> statement-breakpoint
UPDATE "tasks"
SET "strategy_json" = '{}'::jsonb
WHERE "strategy_json" IS NULL;
--> statement-breakpoint
ALTER TABLE "tasks"
  ALTER COLUMN "strategy_json" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "strategy_json" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_spawned_from_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_spawned_from_task_id_tasks_id_fk"
    FOREIGN KEY ("spawned_from_task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks"
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "current_run_id",
  DROP COLUMN IF EXISTS "current_session_id",
  DROP COLUMN IF EXISTS "current_agent_run_id",
  DROP COLUMN IF EXISTS "latest_result",
  DROP COLUMN IF EXISTS "latest_result_summary",
  DROP COLUMN IF EXISTS "selected_model",
  DROP COLUMN IF EXISTS "changes_summary_json",
  DROP COLUMN IF EXISTS "started_at",
  DROP COLUMN IF EXISTS "finished_at";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_project_lifecycle_updated_at"
  ON "tasks" USING btree ("project_id", "lifecycle_status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_project_stage_lifecycle_updated_at"
  ON "tasks" USING btree ("project_id", "stage_key", "lifecycle_status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_project_template_stage_lifecycle_updated_at"
  ON "tasks" USING btree (
    "project_id",
    "workflow_template_id",
    "stage_key",
    "lifecycle_status",
    "updated_at"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_spawned_from_task_id"
  ON "tasks" USING btree ("spawned_from_task_id");
--> statement-breakpoint

CREATE TABLE "task_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "tree_node_id" text,
  "parent_session_id" text,
  "root_session_id" text NOT NULL,
  "coordination_key" text NOT NULL,
  "session_kind" "task_session_kind" NOT NULL,
  "trigger_type" "task_session_trigger_type" NOT NULL,
  "execution_mode_snapshot" "task_session_mode" NOT NULL,
  "execution_status" "execution_status" DEFAULT 'running' NOT NULL,
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
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "total_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "last_activity_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "archived_at" text,
  CONSTRAINT "task_sessions_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_sessions_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_sessions_tree_node_id_project_tree_nodes_id_fk"
    FOREIGN KEY ("tree_node_id") REFERENCES "project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_sessions_parent_session_id_task_sessions_id_fk"
    FOREIGN KEY ("parent_session_id") REFERENCES "task_sessions"("id") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "task_sessions_root_session_id_task_sessions_id_fk"
    FOREIGN KEY ("root_session_id") REFERENCES "task_sessions"("id") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "task_sessions_winner_session_id_task_sessions_id_fk"
    FOREIGN KEY ("winner_session_id") REFERENCES "task_sessions"("id") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "task_sessions_judge_session_id_task_sessions_id_fk"
    FOREIGN KEY ("judge_session_id") REFERENCES "task_sessions"("id") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "task_sessions_coordination_key_nonempty_chk"
    CHECK (length(btrim("coordination_key")) > 0),
  CONSTRAINT "task_sessions_cost_nonnegative_chk"
    CHECK ("cost_usd" >= 0),
  CONSTRAINT "task_sessions_tokens_nonnegative_chk"
    CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0),
  CONSTRAINT "task_sessions_time_order_chk"
    CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_sessions_tree_node_id"
  ON "task_sessions" USING btree ("tree_node_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_sessions_runtime_session_id"
  ON "task_sessions" USING btree ("runtime_session_id")
  WHERE "runtime_session_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_sessions_candidate_per_group"
  ON "task_sessions" USING btree ("task_id", "coordination_key", "candidate_index")
  WHERE "candidate_index" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_sessions_step_per_group"
  ON "task_sessions" USING btree ("task_id", "coordination_key", "step_index")
  WHERE "step_index" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_sessions_judge_per_group"
  ON "task_sessions" USING btree ("task_id", "coordination_key")
  WHERE "session_kind" = 'judge';
--> statement-breakpoint
CREATE INDEX "idx_task_sessions_task_created_at"
  ON "task_sessions" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_sessions_task_execution_status_activity"
  ON "task_sessions" USING btree ("task_id", "execution_status", "last_activity_at");
--> statement-breakpoint
CREATE INDEX "idx_task_sessions_task_root_created_at"
  ON "task_sessions" USING btree ("task_id", "root_session_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_sessions_task_coordination_created_at"
  ON "task_sessions" USING btree ("task_id", "coordination_key", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_sessions_parent_session_id"
  ON "task_sessions" USING btree ("parent_session_id");
--> statement-breakpoint

CREATE TABLE "task_session_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "runtime_message_id" text,
  "role" "task_session_message_role" NOT NULL,
  "message_index" integer NOT NULL,
  "text_content" text,
  "summary_text" text,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "token_used" bigint,
  "started_at" text,
  "completed_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_session_messages_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_session_messages_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_session_messages_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_session_messages_message_index_nonnegative_chk"
    CHECK ("message_index" >= 0),
  CONSTRAINT "task_session_messages_token_used_nonnegative_chk"
    CHECK ("token_used" IS NULL OR "token_used" >= 0),
  CONSTRAINT "task_session_messages_time_order_chk"
    CHECK ("completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at"),
  CONSTRAINT "task_session_messages_payload_or_text_chk"
    CHECK ("raw_payload" <> '{}'::jsonb OR "text_content" IS NOT NULL OR "summary_text" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_session_messages_session_message_index"
  ON "task_session_messages" USING btree ("session_id", "message_index");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_session_messages_session_runtime_message_id"
  ON "task_session_messages" USING btree ("session_id", "runtime_message_id")
  WHERE "runtime_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_task_session_messages_task_created_at"
  ON "task_session_messages" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_session_messages_session_created_at"
  ON "task_session_messages" USING btree ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_session_messages_session_role_created_at"
  ON "task_session_messages" USING btree ("session_id", "role", "created_at");
--> statement-breakpoint

CREATE TABLE "task_session_message_parts" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "part_index" integer NOT NULL,
  "part_type" "task_session_message_part_type" NOT NULL,
  "text_content" text,
  "json_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_session_message_parts_message_id_task_session_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "task_session_messages"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_session_message_parts_part_index_nonnegative_chk"
    CHECK ("part_index" >= 0),
  CONSTRAINT "task_session_message_parts_payload_or_text_chk"
    CHECK ("json_payload" <> '{}'::jsonb OR "text_content" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_task_session_message_parts_message_part_index"
  ON "task_session_message_parts" USING btree ("message_id", "part_index");
--> statement-breakpoint
CREATE INDEX "idx_task_session_message_parts_message_id"
  ON "task_session_message_parts" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "idx_task_session_message_parts_message_part_type"
  ON "task_session_message_parts" USING btree ("message_id", "part_type", "part_index");
--> statement-breakpoint

ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_forked_from_message_id_task_session_messages_id_fk"
    FOREIGN KEY ("forked_from_message_id") REFERENCES "task_session_messages"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

CREATE TABLE "session_operations" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "runtime_operation_id" text,
  "operation_index" integer DEFAULT 0 NOT NULL,
  "operation_kind" "session_operation_kind" NOT NULL,
  "executor_key" text NOT NULL,
  "executor_label" text,
  "provider_id" text,
  "model_id" text,
  "execution_status" "execution_status" DEFAULT 'running' NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "total_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "output_text" text,
  "error_text" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "session_operations_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "session_operations_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "session_operations_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "session_operations_executor_key_nonempty_chk"
    CHECK (length(btrim("executor_key")) > 0),
  CONSTRAINT "session_operations_cost_nonnegative_chk"
    CHECK ("cost_usd" >= 0),
  CONSTRAINT "session_operations_tokens_nonnegative_chk"
    CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0),
  CONSTRAINT "session_operations_time_order_chk"
    CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_operations_session_index"
  ON "session_operations" USING btree ("session_id", "operation_index");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_operations_runtime_operation_id"
  ON "session_operations" USING btree ("runtime_operation_id")
  WHERE "runtime_operation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_session_operations_task_created_at"
  ON "session_operations" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_session_operations_session_created_at"
  ON "session_operations" USING btree ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_session_operations_session_execution_status"
  ON "session_operations" USING btree ("session_id", "execution_status", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_session_operations_executor_key"
  ON "session_operations" USING btree ("executor_key", "created_at");
--> statement-breakpoint

CREATE TABLE "task_snapshots" (
  "task_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "lifecycle_status" "task_lifecycle_status" NOT NULL,
  "current_execution_mode" "task_session_mode",
  "current_execution_status" "execution_status",
  "current_session_id" text,
  "latest_session_id" text,
  "latest_result_summary" text,
  "latest_error_text" text,
  "active_candidate_count" integer DEFAULT 0 NOT NULL,
  "total_chain_steps" integer DEFAULT 0 NOT NULL,
  "completed_chain_steps" integer DEFAULT 0 NOT NULL,
  "last_activity_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_snapshots_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_snapshots_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_snapshots_current_session_id_task_sessions_id_fk"
    FOREIGN KEY ("current_session_id") REFERENCES "task_sessions"("id") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "task_snapshots_latest_session_id_task_sessions_id_fk"
    FOREIGN KEY ("latest_session_id") REFERENCES "task_sessions"("id") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "task_snapshots_candidate_count_nonnegative_chk"
    CHECK ("active_candidate_count" >= 0),
  CONSTRAINT "task_snapshots_chain_steps_nonnegative_chk"
    CHECK ("total_chain_steps" >= 0 AND "completed_chain_steps" >= 0),
  CONSTRAINT "task_snapshots_chain_steps_order_chk"
    CHECK ("completed_chain_steps" <= "total_chain_steps")
);
--> statement-breakpoint
CREATE INDEX "idx_task_snapshots_project_lifecycle_execution_activity"
  ON "task_snapshots" USING btree (
    "project_id",
    "lifecycle_status",
    "current_execution_status",
    "last_activity_at"
  );
--> statement-breakpoint
CREATE INDEX "idx_task_snapshots_project_updated_at"
  ON "task_snapshots" USING btree ("project_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "idx_task_snapshots_current_session_id"
  ON "task_snapshots" USING btree ("current_session_id");
--> statement-breakpoint
CREATE INDEX "idx_task_snapshots_latest_session_id"
  ON "task_snapshots" USING btree ("latest_session_id");
--> statement-breakpoint

CREATE TABLE "task_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "session_id" text,
  "message_id" text,
  "operation_id" text,
  "parent_artifact_id" text,
  "artifact_kind" "task_artifact_kind" NOT NULL,
  "storage_kind" "task_artifact_storage_kind" DEFAULT 'inline' NOT NULL,
  "title" text,
  "mime_type" text,
  "file_path" text,
  "external_uri" text,
  "content_text" text,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "byte_size" bigint,
  "sha256" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_artifacts_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_artifacts_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_artifacts_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_artifacts_message_id_task_session_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "task_session_messages"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_artifacts_operation_id_session_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "session_operations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_artifacts_parent_artifact_id_task_artifacts_id_fk"
    FOREIGN KEY ("parent_artifact_id") REFERENCES "task_artifacts"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_artifacts_byte_size_nonnegative_chk"
    CHECK ("byte_size" IS NULL OR "byte_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_task_artifacts_task_created_at"
  ON "task_artifacts" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_artifacts_session_created_at"
  ON "task_artifacts" USING btree ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_artifacts_message_id"
  ON "task_artifacts" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "idx_task_artifacts_operation_id"
  ON "task_artifacts" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX "idx_task_artifacts_parent_artifact_id"
  ON "task_artifacts" USING btree ("parent_artifact_id");
--> statement-breakpoint

CREATE TABLE "task_usage_ledger_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "session_id" text,
  "message_id" text,
  "operation_id" text,
  "entry_kind" "task_usage_entry_kind" NOT NULL,
  "provider_id" text,
  "model_id" text,
  "request_count" integer DEFAULT 1 NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "total_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "currency_code" text DEFAULT 'USD' NOT NULL,
  "recorded_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_usage_ledger_entries_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_usage_ledger_entries_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_usage_ledger_entries_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_usage_ledger_entries_message_id_task_session_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "task_session_messages"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_usage_ledger_entries_operation_id_session_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "session_operations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_usage_ledger_entries_request_count_positive_chk"
    CHECK ("request_count" > 0),
  CONSTRAINT "task_usage_ledger_entries_tokens_nonnegative_chk"
    CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0),
  CONSTRAINT "task_usage_ledger_entries_cost_nonnegative_chk"
    CHECK ("cost_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_task_usage_ledger_entries_project_recorded_at"
  ON "task_usage_ledger_entries" USING btree ("project_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX "idx_task_usage_ledger_entries_task_recorded_at"
  ON "task_usage_ledger_entries" USING btree ("task_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX "idx_task_usage_ledger_entries_session_recorded_at"
  ON "task_usage_ledger_entries" USING btree ("session_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX "idx_task_usage_ledger_entries_operation_id"
  ON "task_usage_ledger_entries" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX "idx_task_usage_ledger_entries_provider_model_recorded_at"
  ON "task_usage_ledger_entries" USING btree ("provider_id", "model_id", "recorded_at");
--> statement-breakpoint

CREATE TABLE "task_timeline_views" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "session_id" text,
  "message_id" text,
  "operation_id" text,
  "artifact_id" text,
  "item_kind" "task_timeline_item_kind" NOT NULL,
  "item_role" "task_session_message_role",
  "title" text,
  "display_text" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sort_at" text NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_timeline_views_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_timeline_views_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_timeline_views_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_timeline_views_message_id_task_session_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "task_session_messages"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_timeline_views_operation_id_session_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "session_operations"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_timeline_views_artifact_id_task_artifacts_id_fk"
    FOREIGN KEY ("artifact_id") REFERENCES "task_artifacts"("id") ON DELETE CASCADE ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_task_timeline_views_task_sort_at"
  ON "task_timeline_views" USING btree ("task_id", "sort_at", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_timeline_views_session_sort_at"
  ON "task_timeline_views" USING btree ("session_id", "sort_at", "created_at");