-- Migration 0037: phase-first task execution canonicals

CREATE TABLE IF NOT EXISTS "task_execution_phases" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "parent_phase_id" text,
  "phase_index" integer NOT NULL,
  "phase_kind" text NOT NULL,
  "trigger_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "resumed_from_phase_id" text,
  "awaiting_adoption_since" text,
  "cancel_requested_at" text,
  "cancelled_at" text,
  "terminal_reason" text,
  "last_heartbeat_at" text,
  "anchor_session_id" text,
  "anchor_message_id" text,
  "coordination_key" text,
  "candidate_count" integer,
  "winner_session_id" text,
  "judge_session_id" text,
  "requested_model" text,
  "effective_model" text,
  "result_summary" text,
  "error_text" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_parent_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("parent_phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_resumed_from_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("resumed_from_phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_anchor_session_id_task_sessions_id_fk" FOREIGN KEY ("anchor_session_id") REFERENCES "public"."task_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_winner_session_id_task_sessions_id_fk" FOREIGN KEY ("winner_session_id") REFERENCES "public"."task_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_execution_phases" ADD CONSTRAINT "task_execution_phases_judge_session_id_task_sessions_id_fk" FOREIGN KEY ("judge_session_id") REFERENCES "public"."task_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "task_sessions" ADD COLUMN IF NOT EXISTS "phase_id" text;
--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN IF NOT EXISTS "phase_role" text;
--> statement-breakpoint
ALTER TABLE "task_sessions" ADD COLUMN IF NOT EXISTS "phase_item_index" integer;
--> statement-breakpoint
ALTER TABLE "task_session_runs" ADD COLUMN IF NOT EXISTS "phase_id" text;
--> statement-breakpoint
ALTER TABLE "task_snapshots" ADD COLUMN IF NOT EXISTS "current_phase_id" text;
--> statement-breakpoint
ALTER TABLE "task_snapshots" ADD COLUMN IF NOT EXISTS "latest_phase_id" text;
--> statement-breakpoint
ALTER TABLE "task_timeline_views" ADD COLUMN IF NOT EXISTS "phase_id" text;
--> statement-breakpoint
ALTER TABLE "task_timeline_views" ADD COLUMN IF NOT EXISTS "phase_index" integer;
--> statement-breakpoint
ALTER TABLE "task_timeline_views" ADD COLUMN IF NOT EXISTS "phase_kind" text;
--> statement-breakpoint
ALTER TABLE "task_timeline_views" ADD COLUMN IF NOT EXISTS "phase_role" text;
--> statement-breakpoint
ALTER TABLE "task_timeline_views" ADD COLUMN IF NOT EXISTS "phase_item_index" integer;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "task_sessions" ADD CONSTRAINT "task_sessions_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_session_runs" ADD CONSTRAINT "task_session_runs_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_snapshots" ADD CONSTRAINT "task_snapshots_current_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("current_phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_snapshots" ADD CONSTRAINT "task_snapshots_latest_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("latest_phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_timeline_views" ADD CONSTRAINT "task_timeline_views_phase_id_task_execution_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."task_execution_phases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_execution_phases_task_phase_index"
  ON "task_execution_phases" ("task_id", "phase_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_execution_phases_task_created_at"
  ON "task_execution_phases" ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_execution_phases_task_status_phase_index"
  ON "task_execution_phases" ("task_id", "status", "phase_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_execution_phases_task_parent_phase_index"
  ON "task_execution_phases" ("task_id", "parent_phase_id", "phase_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_execution_phases_task_resumed_from_phase_id"
  ON "task_execution_phases" ("task_id", "resumed_from_phase_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_execution_phases_task_coordination_key"
  ON "task_execution_phases" ("task_id", "coordination_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_execution_phases_task_anchor_session_id"
  ON "task_execution_phases" ("task_id", "anchor_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_sessions_task_phase_item"
  ON "task_sessions" ("task_id", "phase_id", "phase_role", "phase_item_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_session_runs_task_phase_created_at"
  ON "task_session_runs" ("task_id", "phase_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_snapshots_current_phase_id"
  ON "task_snapshots" ("current_phase_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_snapshots_latest_phase_id"
  ON "task_snapshots" ("latest_phase_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_timeline_views_task_phase_sort_at"
  ON "task_timeline_views" ("task_id", "phase_id", "sort_at", "created_at");