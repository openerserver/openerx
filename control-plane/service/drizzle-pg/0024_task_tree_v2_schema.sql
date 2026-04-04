ALTER TABLE "task_sessions"
  ADD COLUMN IF NOT EXISTS "source_message_id" text,
  ADD COLUMN IF NOT EXISTS "session_type" text,
  ADD COLUMN IF NOT EXISTS "workflow_stage_key" text,
  ADD COLUMN IF NOT EXISTS "spawn_trigger_type" text,
  ADD COLUMN IF NOT EXISTS "spawn_rule_key" text,
  ADD COLUMN IF NOT EXISTS "user_prompt_summary" text,
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'running' NOT NULL,
  ADD COLUMN IF NOT EXISTS "head_message_id" text,
  ADD COLUMN IF NOT EXISTS "latest_run_id" text,
  ADD COLUMN IF NOT EXISTS "depth" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "sort_key" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task_sessions_task_parent_created_at"
  ON "task_sessions" USING btree ("task_id", "parent_session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_sessions_task_sort_key"
  ON "task_sessions" USING btree ("task_id", "sort_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_sessions_head_message_id"
  ON "task_sessions" USING btree ("head_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_sessions_latest_run_id"
  ON "task_sessions" USING btree ("latest_run_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_session_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "session_id" text NOT NULL,
  "attempt_index" integer NOT NULL,
  "runtime_session_id" text,
  "trigger_type" text NOT NULL,
  "execution_kind" text NOT NULL,
  "coordination_key" text,
  "candidate_index" integer,
  "lane_role" text NOT NULL,
  "executor_kind" text NOT NULL,
  "model_route" text,
  "workflow_stage_key" text,
  "status" text DEFAULT 'running' NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "total_tokens" bigint DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "result_summary" text,
  "error_text" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_session_runs_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_session_runs_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_session_runs_cost_nonnegative_chk"
    CHECK ("cost_usd" >= 0),
  CONSTRAINT "task_session_runs_tokens_nonnegative_chk"
    CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0),
  CONSTRAINT "task_session_runs_time_order_chk"
    CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_session_runs_session_attempt_index"
  ON "task_session_runs" USING btree ("session_id", "attempt_index");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_session_runs_session_id_id"
  ON "task_session_runs" USING btree ("session_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_session_runs_runtime_session_id"
  ON "task_session_runs" USING btree ("runtime_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_session_runs_task_session_created_at"
  ON "task_session_runs" USING btree ("task_id", "session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_session_runs_task_coordination_created_at"
  ON "task_session_runs" USING btree ("task_id", "coordination_key", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_session_runs_session_status_created_at"
  ON "task_session_runs" USING btree ("session_id", "status", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "session_id" text NOT NULL,
  "created_by_run_id" text,
  "role" text NOT NULL,
  "message_kind" text NOT NULL,
  "parent_message_id" text,
  "reply_to_message_id" text,
  "seq" integer NOT NULL,
  "text_preview" text,
  "part_count" integer DEFAULT 0 NOT NULL,
  "token_used" bigint DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'streaming' NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" text,
  CONSTRAINT "task_messages_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_messages_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_messages_parent_message_id_task_messages_id_fk"
    FOREIGN KEY ("parent_message_id") REFERENCES "task_messages"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_messages_reply_to_message_id_task_messages_id_fk"
    FOREIGN KEY ("reply_to_message_id") REFERENCES "task_messages"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_messages_seq_nonnegative_chk"
    CHECK ("seq" >= 0),
  CONSTRAINT "task_messages_part_count_nonnegative_chk"
    CHECK ("part_count" >= 0),
  CONSTRAINT "task_messages_token_used_nonnegative_chk"
    CHECK ("token_used" >= 0),
  CONSTRAINT "task_messages_time_order_chk"
    CHECK ("completed_at" IS NULL OR "completed_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_messages_session_seq"
  ON "task_messages" USING btree ("session_id", "seq");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_messages_session_id_id"
  ON "task_messages" USING btree ("session_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_messages_task_created_at"
  ON "task_messages" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_messages_session_created_at"
  ON "task_messages" USING btree ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_messages_session_role_created_at"
  ON "task_messages" USING btree ("session_id", "role", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_messages_created_by_run_id"
  ON "task_messages" USING btree ("created_by_run_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_message_parts" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "part_index" integer NOT NULL,
  "part_type" text NOT NULL,
  "text_content" text,
  "json_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_message_parts_message_id_task_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "task_messages"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_message_parts_part_index_nonnegative_chk"
    CHECK ("part_index" >= 0),
  CONSTRAINT "task_message_parts_payload_or_text_chk"
    CHECK ("json_payload" <> '{}'::jsonb OR "text_content" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_message_parts_message_part_index"
  ON "task_message_parts" USING btree ("message_id", "part_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_message_parts_message_id"
  ON "task_message_parts" USING btree ("message_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_operations" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "session_id" text NOT NULL,
  "run_id" text NOT NULL,
  "message_id" text,
  "parent_operation_id" text,
  "runtime_operation_id" text,
  "operation_index" integer NOT NULL,
  "operation_kind" text NOT NULL,
  "tool_name" text,
  "title" text,
  "status" text DEFAULT 'running' NOT NULL,
  "summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_operations_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_operations_session_id_task_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_operations_run_id_task_session_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "task_session_runs"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_operations_message_id_task_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "task_messages"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_operations_parent_operation_id_task_operations_id_fk"
    FOREIGN KEY ("parent_operation_id") REFERENCES "task_operations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_operations_time_order_chk"
    CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_operations_run_operation_index"
  ON "task_operations" USING btree ("run_id", "operation_index");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_operations_runtime_operation_id"
  ON "task_operations" USING btree ("runtime_operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_operations_task_created_at"
  ON "task_operations" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_operations_session_created_at"
  ON "task_operations" USING btree ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_operations_message_id"
  ON "task_operations" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_operations_parent_operation_id"
  ON "task_operations" USING btree ("parent_operation_id");