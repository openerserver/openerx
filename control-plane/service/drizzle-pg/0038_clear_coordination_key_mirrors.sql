ALTER TABLE "task_sessions"
  ALTER COLUMN "coordination_key" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_coordination_key_nonempty_chk";
--> statement-breakpoint

UPDATE "task_sessions" AS ts
SET "phase_id" = tep."id"
FROM "task_execution_phases" AS tep
WHERE ts."task_id" = tep."task_id"
  AND ts."phase_id" IS NULL
  AND ts."coordination_key" = tep."id";
--> statement-breakpoint

UPDATE "task_session_runs" AS tsr
SET "phase_id" = ts."phase_id"
FROM "task_sessions" AS ts
WHERE tsr."session_id" = ts."id"
  AND tsr."phase_id" IS NULL
  AND ts."phase_id" IS NOT NULL;
--> statement-breakpoint

UPDATE "task_session_runs" AS tsr
SET "phase_id" = tep."id"
FROM "task_execution_phases" AS tep
WHERE tsr."task_id" = tep."task_id"
  AND tsr."phase_id" IS NULL
  AND tsr."coordination_key" = tep."id";
--> statement-breakpoint

UPDATE "task_snapshots" AS snap
SET "current_phase_id" = ts."phase_id"
FROM "task_sessions" AS ts
WHERE snap."task_id" = ts."task_id"
  AND snap."current_phase_id" IS NULL
  AND ts."phase_id" IS NOT NULL
  AND (
    ts."id" = snap."current_session_id"
    OR ts."runtime_session_id" = snap."current_session_id"
  );
--> statement-breakpoint

UPDATE "task_snapshots" AS snap
SET "latest_phase_id" = ts."phase_id"
FROM "task_sessions" AS ts
WHERE snap."task_id" = ts."task_id"
  AND snap."latest_phase_id" IS NULL
  AND ts."phase_id" IS NOT NULL
  AND (
    ts."id" = snap."latest_session_id"
    OR ts."runtime_session_id" = snap."latest_session_id"
  );
--> statement-breakpoint

DROP INDEX IF EXISTS "idx_task_execution_phases_task_coordination_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_task_sessions_candidate_per_group";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_task_sessions_step_per_group";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_task_sessions_task_coordination_created_at";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_task_session_runs_task_coordination_created_at";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_sessions_candidate_per_phase"
  ON "task_sessions" ("task_id", "phase_id", "candidate_index");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_sessions_step_per_phase"
  ON "task_sessions" ("task_id", "phase_id", "step_index");
--> statement-breakpoint

UPDATE "task_execution_phases"
SET "coordination_key" = NULL
WHERE "coordination_key" IS NOT NULL;
--> statement-breakpoint

UPDATE "task_session_runs"
SET "coordination_key" = NULL
WHERE "coordination_key" IS NOT NULL;
--> statement-breakpoint

UPDATE "task_sessions"
SET "coordination_key" = NULL
WHERE "coordination_key" IS NOT NULL;