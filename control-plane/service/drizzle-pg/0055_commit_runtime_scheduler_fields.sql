ALTER TABLE "commit_runtimes"
  ADD COLUMN IF NOT EXISTS "target_url" text,
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "stopped_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_accessed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "error_message" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commit_runtimes_expiry_status"
  ON "commit_runtimes" ("status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commit_runtimes_last_accessed"
  ON "commit_runtimes" ("last_accessed_at");
