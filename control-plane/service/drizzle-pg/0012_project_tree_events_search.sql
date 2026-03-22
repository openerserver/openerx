CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ptn_context_search_trgm"
  ON "project_tree_nodes" USING gin ("content_text" gin_trgm_ops)
  WHERE "node_type" = 'context' AND "content_text" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_pte_snapshot_text_trgm"
  ON "project_tree_events" USING gin (((payload ->> 'text')) gin_trgm_ops)
  WHERE "event_type" = 'session.message.snapshot' AND payload ? 'text';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_pte_project_event_cursor"
  ON "project_tree_events" USING btree ("project_id", "created_at", "id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_pte_project_snapshot_lookup"
  ON "project_tree_events" USING btree ("project_id", "event_type", "node_id", "seq", "created_at")
  WHERE "event_type" = 'session.message.snapshot';--> statement-breakpoint