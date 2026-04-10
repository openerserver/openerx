CREATE TABLE IF NOT EXISTS "task_domain_events" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "task_id" text,
  "session_id" text,
  "run_id" text,
  "run_node_id" text,
  "event_type" text NOT NULL,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "seq" bigint NOT NULL DEFAULT 0
);

ALTER TABLE "task_domain_events"
  ADD COLUMN IF NOT EXISTS "project_id" text;

UPDATE "task_domain_events" AS event
SET "project_id" = COALESCE(
  (
    SELECT task."project_id"
    FROM "tasks" AS task
    WHERE task."id" = event."task_id"
    LIMIT 1
  ),
  (
    SELECT session."project_id"
    FROM "task_sessions" AS session
    WHERE session."id" = event."session_id"
    LIMIT 1
  )
)
WHERE event."project_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_domain_events"
    WHERE "project_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'task_domain_events.project_id backfill failed; reconcile legacy rows before applying 0045_task_domain_events_canonical_reconcile';
  END IF;
END $$;

ALTER TABLE "task_domain_events"
  ALTER COLUMN "project_id" SET NOT NULL,
  ALTER COLUMN "event_type" SET NOT NULL,
  ALTER COLUMN "payload_json" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "seq" SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_domain_events_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "task_domain_events"
      ADD CONSTRAINT "task_domain_events_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_domain_events_task_id_tasks_id_fk'
  ) THEN
    ALTER TABLE "task_domain_events"
      ADD CONSTRAINT "task_domain_events_task_id_tasks_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_domain_events_session_id_task_sessions_id_fk'
  ) THEN
    ALTER TABLE "task_domain_events"
      ADD CONSTRAINT "task_domain_events_session_id_task_sessions_id_fk"
      FOREIGN KEY ("session_id") REFERENCES "task_sessions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "task_domain_events_task_seq_unique"
  ON "task_domain_events" USING btree ("task_id", "seq");

CREATE INDEX IF NOT EXISTS "idx_task_domain_events_project_created_at"
  ON "task_domain_events" USING btree ("project_id", "created_at", "seq");

CREATE INDEX IF NOT EXISTS "idx_task_domain_events_session_created_at"
  ON "task_domain_events" USING btree ("session_id", "created_at");
