ALTER TABLE "task_messages"
  ADD COLUMN IF NOT EXISTS "runtime_message_id" text,
  ADD COLUMN IF NOT EXISTS "client_message_id" text,
  ADD COLUMN IF NOT EXISTS "provider_message_id" text,
  ADD COLUMN IF NOT EXISTS "text_content" text,
  ADD COLUMN IF NOT EXISTS "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "error_text" text,
  ADD COLUMN IF NOT EXISTS "started_at" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_messages_session_runtime_message_id"
  ON "task_messages" USING btree ("session_id", "runtime_message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_messages_session_client_message_id"
  ON "task_messages" USING btree ("session_id", "client_message_id");
