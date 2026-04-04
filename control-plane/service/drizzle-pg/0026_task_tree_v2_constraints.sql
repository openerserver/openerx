ALTER TABLE "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_completed_terminal_refs_chk";
--> statement-breakpoint
ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_completed_terminal_refs_chk"
    CHECK (
      "status" <> 'completed'
      OR ("head_message_id" IS NOT NULL AND "latest_run_id" IS NOT NULL)
    ) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_root_source_pair_chk";
--> statement-breakpoint
ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_root_source_pair_chk"
    CHECK (
      ("parent_session_id" IS NULL AND "source_message_id" IS NULL)
      OR "parent_session_id" IS NOT NULL
    ) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_messages"
  DROP CONSTRAINT IF EXISTS "task_messages_user_created_by_run_null_chk";
--> statement-breakpoint
ALTER TABLE "task_messages"
  ADD CONSTRAINT "task_messages_user_created_by_run_null_chk"
    CHECK ("role" <> 'user' OR "created_by_run_id" IS NULL) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_messages"
  DROP CONSTRAINT IF EXISTS "task_messages_completed_time_chk";
--> statement-breakpoint
ALTER TABLE "task_messages"
  ADD CONSTRAINT "task_messages_completed_time_chk"
    CHECK ("status" <> 'completed' OR "completed_at" IS NOT NULL) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_session_runs"
  DROP CONSTRAINT IF EXISTS "task_session_runs_completed_finished_at_chk";
--> statement-breakpoint
ALTER TABLE "task_session_runs"
  ADD CONSTRAINT "task_session_runs_completed_finished_at_chk"
    CHECK ("status" <> 'completed' OR "finished_at" IS NOT NULL) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_operations"
  DROP CONSTRAINT IF EXISTS "task_operations_kind_tool_name_chk";
--> statement-breakpoint
ALTER TABLE "task_operations"
  ADD CONSTRAINT "task_operations_kind_tool_name_chk"
    CHECK (
      ("operation_kind" = 'model_request' AND "tool_name" IS NULL)
      OR ("operation_kind" = 'tool_call' AND "tool_name" IS NOT NULL)
      OR "operation_kind" NOT IN ('model_request', 'tool_call')
    ) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_head_message_fk";
--> statement-breakpoint
ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_head_message_fk"
    FOREIGN KEY ("id", "head_message_id")
    REFERENCES "task_messages" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_latest_run_fk";
--> statement-breakpoint
ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_latest_run_fk"
    FOREIGN KEY ("id", "latest_run_id")
    REFERENCES "task_session_runs" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_messages"
  DROP CONSTRAINT IF EXISTS "task_messages_created_by_run_fk";
--> statement-breakpoint
ALTER TABLE "task_messages"
  ADD CONSTRAINT "task_messages_created_by_run_fk"
    FOREIGN KEY ("session_id", "created_by_run_id")
    REFERENCES "task_session_runs" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_sessions"
  DROP CONSTRAINT IF EXISTS "task_sessions_source_message_fk";
--> statement-breakpoint
ALTER TABLE "task_sessions"
  ADD CONSTRAINT "task_sessions_source_message_fk"
    FOREIGN KEY ("parent_session_id", "source_message_id")
    REFERENCES "task_messages" ("session_id", "id")
    DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_session_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_session_id text;
  session_row record;
  head_message record;
  latest_run record;
BEGIN
  IF TG_TABLE_NAME = 'task_sessions' THEN
    target_session_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'task_messages' THEN
    target_session_id := NEW."session_id";
  ELSIF TG_TABLE_NAME = 'task_session_runs' THEN
    target_session_id := NEW."session_id";
  ELSE
    RETURN NEW;
  END IF;

  SELECT * INTO session_row
  FROM "task_sessions"
  WHERE "id" = target_session_id;

  IF NOT FOUND OR session_row."status" <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF session_row."head_message_id" IS NULL OR session_row."latest_run_id" IS NULL THEN
    RAISE EXCEPTION 'completed session % must have head_message_id and latest_run_id', target_session_id;
  END IF;

  SELECT * INTO head_message
  FROM "task_messages"
  WHERE "session_id" = target_session_id AND "id" = session_row."head_message_id";

  IF NOT FOUND OR head_message."role" <> 'assistant' OR head_message."status" <> 'completed' THEN
    RAISE EXCEPTION 'session % head message must be a completed assistant message', target_session_id;
  END IF;

  SELECT * INTO latest_run
  FROM "task_session_runs"
  WHERE "session_id" = target_session_id AND "id" = session_row."latest_run_id";

  IF NOT FOUND OR latest_run."status" <> 'completed' THEN
    RAISE EXCEPTION 'session % latest run must be completed', target_session_id;
  END IF;

  IF head_message."created_by_run_id" IS DISTINCT FROM session_row."latest_run_id" THEN
    RAISE EXCEPTION 'session % head message must be produced by latest run', target_session_id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "task_sessions_terminal_state_chk" ON "task_sessions";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "task_sessions_terminal_state_chk"
AFTER INSERT OR UPDATE ON "task_sessions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_session_terminal_state();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "task_messages_terminal_state_chk" ON "task_messages";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "task_messages_terminal_state_chk"
AFTER INSERT OR UPDATE ON "task_messages"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_session_terminal_state();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "task_session_runs_terminal_state_chk" ON "task_session_runs";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "task_session_runs_terminal_state_chk"
AFTER INSERT OR UPDATE ON "task_session_runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_session_terminal_state();