INSERT INTO "task_operations" (
  "id",
  "task_id",
  "session_id",
  "run_id",
  "message_id",
  "parent_operation_id",
  "runtime_operation_id",
  "operation_index",
  "operation_kind",
  "tool_name",
  "title",
  "status",
  "summary_json",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at"
)
SELECT
  so."id",
  so."task_id",
  so."session_id",
  concat('run_', so."session_id"),
  NULL,
  NULL,
  so."runtime_operation_id",
  so."operation_index",
  CASE
    WHEN COALESCE(so."metadata_json" ->> 'toolName', so."metadata_json" ->> 'tool_name') IS NOT NULL THEN 'tool_call'
    WHEN so."operation_kind" = 'judge' THEN 'judge'
    WHEN so."operation_kind" = 'hook' THEN 'hook'
    WHEN so."operation_kind" = 'resume' THEN 'resume'
    WHEN so."operation_kind" = 'system' THEN 'system'
    ELSE 'model_request'
  END,
  COALESCE(so."metadata_json" ->> 'toolName', so."metadata_json" ->> 'tool_name'),
  COALESCE(so."executor_label", so."executor_key"),
  CASE
    WHEN so."execution_status" = 'complete' THEN 'completed'
    WHEN so."execution_status" = 'cancelled' THEN 'cancelled'
    ELSE COALESCE(so."execution_status"::text, 'running')
  END,
  so."metadata_json",
  so."started_at",
  so."finished_at",
  so."created_at",
  so."updated_at"
FROM "session_operations" so
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

ALTER TABLE "task_artifacts"
  DROP CONSTRAINT IF EXISTS "task_artifacts_operation_id_session_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "task_artifacts"
  ADD CONSTRAINT "task_artifacts_operation_id_task_operations_id_fk"
    FOREIGN KEY ("operation_id")
    REFERENCES "task_operations" ("id")
    ON DELETE NO ACTION
    ON UPDATE NO ACTION
    NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_usage_ledger_entries"
  DROP CONSTRAINT IF EXISTS "task_usage_ledger_entries_operation_id_session_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "task_usage_ledger_entries"
  ADD CONSTRAINT "task_usage_ledger_entries_operation_id_task_operations_id_fk"
    FOREIGN KEY ("operation_id")
    REFERENCES "task_operations" ("id")
    ON DELETE NO ACTION
    ON UPDATE NO ACTION
    NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_timeline_views"
  DROP CONSTRAINT IF EXISTS "task_timeline_views_operation_id_session_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "task_timeline_views"
  ADD CONSTRAINT "task_timeline_views_operation_id_task_operations_id_fk"
    FOREIGN KEY ("operation_id")
    REFERENCES "task_operations" ("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION
    NOT VALID;
--> statement-breakpoint

DROP TABLE IF EXISTS "session_operations";