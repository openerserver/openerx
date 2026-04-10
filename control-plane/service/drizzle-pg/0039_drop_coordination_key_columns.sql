ALTER TABLE "task_execution_phases"
  DROP COLUMN IF EXISTS "coordination_key";
--> statement-breakpoint

ALTER TABLE "task_session_runs"
  DROP COLUMN IF EXISTS "coordination_key";
--> statement-breakpoint

ALTER TABLE "task_sessions"
  DROP COLUMN IF EXISTS "coordination_key";
