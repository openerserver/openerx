ALTER TABLE "task_artifacts"
  DROP CONSTRAINT IF EXISTS "task_artifacts_message_id_task_session_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "task_artifacts"
  ADD CONSTRAINT "task_artifacts_message_id_task_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "task_messages" ("id")
    ON DELETE NO ACTION
    ON UPDATE NO ACTION
    NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_usage_ledger_entries"
  DROP CONSTRAINT IF EXISTS "task_usage_ledger_entries_message_id_task_session_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "task_usage_ledger_entries"
  ADD CONSTRAINT "task_usage_ledger_entries_message_id_task_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "task_messages" ("id")
    ON DELETE NO ACTION
    ON UPDATE NO ACTION
    NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_timeline_views"
  DROP CONSTRAINT IF EXISTS "task_timeline_views_message_id_task_session_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "task_timeline_views"
  ADD CONSTRAINT "task_timeline_views_message_id_task_messages_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "task_messages" ("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION
    NOT VALID;
