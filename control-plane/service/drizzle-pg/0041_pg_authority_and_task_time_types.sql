-- Migration 0041: restore PostgreSQL migration authority and strengthen canonical task times.

ALTER TYPE "execution_status" ADD VALUE IF NOT EXISTS 'awaiting_adoption';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION openerx_parse_timestamptz(value text)
RETURNS timestamp with time zone
LANGUAGE SQL
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(btrim(value), '')::timestamp with time zone
$$;
--> statement-breakpoint

ALTER TABLE "tasks"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "activated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("activated_at"),
  ALTER COLUMN "done_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("done_at"),
  ALTER COLUMN "archived_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("archived_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_execution_phases"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "awaiting_adoption_since" TYPE timestamp with time zone USING openerx_parse_timestamptz("awaiting_adoption_since"),
  ALTER COLUMN "cancel_requested_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("cancel_requested_at"),
  ALTER COLUMN "cancelled_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("cancelled_at"),
  ALTER COLUMN "last_heartbeat_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("last_heartbeat_at"),
  ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
  ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  ALTER COLUMN "last_activity_at" DROP DEFAULT,
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "last_activity_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("last_activity_at"),
  ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
  ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "archived_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("archived_at"),
  ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_session_runs"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
  ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_messages"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "completed_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("completed_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_operations"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
  ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_snapshots"
  ALTER COLUMN "last_activity_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "last_activity_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("last_activity_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_artifacts"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_usage_ledger_entries"
  ALTER COLUMN "recorded_at" DROP DEFAULT,
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "recorded_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("recorded_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "recorded_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_timeline_views"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "sort_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("sort_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

DROP FUNCTION openerx_parse_timestamptz(text);