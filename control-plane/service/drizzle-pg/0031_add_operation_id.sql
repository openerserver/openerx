ALTER TABLE "task_sessions" ADD COLUMN IF NOT EXISTS "operation_id" text;
ALTER TABLE "task_session_runs" ADD COLUMN IF NOT EXISTS "operation_id" text;

CREATE INDEX IF NOT EXISTS "idx_task_sessions_task_operation_id" ON "task_sessions" ("task_id", "operation_id");
CREATE INDEX IF NOT EXISTS "idx_task_session_runs_task_operation_id" ON "task_session_runs" ("task_id", "operation_id");
