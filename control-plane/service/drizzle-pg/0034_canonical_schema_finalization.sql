-- Migration 0034: Canonical schema finalization
-- Drop legacy runtime-state columns from tasks table (moved to task_snapshots).
-- Add prompt visibility columns to task_messages for pi-mono canonical write path.

-- ── Step 1: Add prompt visibility columns to task_messages ──────────
ALTER TABLE "task_messages" ADD COLUMN IF NOT EXISTS "user_input_text" TEXT;
--> statement-breakpoint
ALTER TABLE "task_messages" ADD COLUMN IF NOT EXISTS "system_context_text" TEXT;
--> statement-breakpoint
ALTER TABLE "task_messages" ADD COLUMN IF NOT EXISTS "final_sent_text" TEXT;
--> statement-breakpoint

-- ── Step 2: Purge all historical task data ──────────────────────────
-- No backfill — wipe legacy rows so the DB starts clean after migration.
DELETE FROM "task_snapshots";
--> statement-breakpoint
DELETE FROM "task_timeline_views";
--> statement-breakpoint
DELETE FROM "task_message_events";
--> statement-breakpoint
DELETE FROM "task_artifacts";
--> statement-breakpoint
DELETE FROM "task_usage_ledger_entries";
--> statement-breakpoint
DELETE FROM "runtime_usage_ledger_steps";
--> statement-breakpoint
DELETE FROM "runtime_usage_ledgers";
--> statement-breakpoint
DELETE FROM "task_operations";
--> statement-breakpoint
DELETE FROM "task_message_parts";
--> statement-breakpoint
DELETE FROM "task_messages";
--> statement-breakpoint
DELETE FROM "task_session_runs";
--> statement-breakpoint
DELETE FROM "task_sessions";
--> statement-breakpoint
DELETE FROM "task_operating_modes";
--> statement-breakpoint
DELETE FROM "task_stage_runs";
--> statement-breakpoint
DELETE FROM "task_workflow_runs";
--> statement-breakpoint
DELETE FROM "role_aggregate_conclusions";
--> statement-breakpoint
DELETE FROM "developer_change_requests";
--> statement-breakpoint
DELETE FROM "file_changes";
--> statement-breakpoint
DELETE FROM "code_changes";
--> statement-breakpoint
DELETE FROM "approval_tickets";
--> statement-breakpoint
DELETE FROM "audit_events";
--> statement-breakpoint
DELETE FROM "boss_decisions";
--> statement-breakpoint
DELETE FROM "human_escalations";
--> statement-breakpoint
DELETE FROM "project_tree_nodes" WHERE "node_type" = 'task';
--> statement-breakpoint
DELETE FROM "tasks";
--> statement-breakpoint

-- ── Step 3: Drop legacy columns from tasks ──────────────────────────
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "status";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "current_run_id";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "current_session_id";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "current_agent_run_id";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "latest_result";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "latest_result_summary";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "selected_model";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "started_at";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "finished_at";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "changes_summary_json";
--> statement-breakpoint

-- ── Step 4: Drop stale indexes that referenced removed columns ──────
DROP INDEX IF EXISTS "idx_tasks_current_run_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tasks_current_session_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tasks_project_status_created_at";
--> statement-breakpoint

-- ── Step 5: Add canonical index for prompt visibility reads ─────────
CREATE INDEX IF NOT EXISTS "idx_task_messages_user_input"
  ON "task_messages" ("session_id", "role")
  WHERE "user_input_text" IS NOT NULL;
