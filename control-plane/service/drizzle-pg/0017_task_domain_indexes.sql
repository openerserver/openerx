CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_conversation_messages_text_content_trgm"
  ON "conversation_messages" USING gin ("text_content" gin_trgm_ops)
  WHERE "text_content" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_conversation_messages_project_created_at"
  ON "conversation_messages" USING btree ("project_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_conversation_messages_run_node_created_at"
  ON "conversation_messages" USING btree ("run_node_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task_domain_events_task_created_at"
  ON "task_domain_events" USING btree ("task_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task_snapshots_current_run_id"
  ON "task_snapshots" USING btree ("current_run_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task_snapshots_current_session_id"
  ON "task_snapshots" USING btree ("current_session_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task_timeline_views_project_sort_at"
  ON "task_timeline_views" USING btree ("project_id", "sort_at", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_conversation_sessions_task_active_created_at"
  ON "conversation_sessions" USING btree ("task_id", "is_active", "created_at");