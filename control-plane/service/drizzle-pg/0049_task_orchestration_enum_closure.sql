-- Migration 0049: close remaining core task-orchestration enum gaps.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_execution_phase_kind'
    ) THEN
        CREATE TYPE task_execution_phase_kind AS ENUM (
            'root',
            'single',
            'parallel',
            'sequential_chain',
            'manual_branch',
            'hook'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_execution_phase_trigger_type'
    ) THEN
        CREATE TYPE task_execution_phase_trigger_type AS ENUM (
            'execute',
            'continue',
            'resume',
            'workflow_spawn',
            'candidate_adopt',
            'manual_branch',
            'hook_spawn'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_execution_phase_status'
    ) THEN
        CREATE TYPE task_execution_phase_status AS ENUM (
            'pending',
            'running',
            'paused',
            'awaiting_adoption',
            'completed',
            'failed',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_execution_phase_terminal_reason'
    ) THEN
        CREATE TYPE task_execution_phase_terminal_reason AS ENUM (
            'winner_adopted',
            'user_cancelled',
            'runtime_terminated',
            'runtime_failed',
            'timeout',
            'superseded'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_session_node_status'
    ) THEN
        CREATE TYPE task_session_node_status AS ENUM (
            'queued',
            'running',
            'completed',
            'failed',
            'cancelled',
            'interrupted',
            'archived'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_session_run_trigger_type'
    ) THEN
        CREATE TYPE task_session_run_trigger_type AS ENUM (
            'user_prompt',
            'assistant_reply',
            'parallel_result',
            'resume',
            'workflow_spawn',
            'manual_branch',
            'system_retry'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_session_run_execution_kind'
    ) THEN
        CREATE TYPE task_session_run_execution_kind AS ENUM (
            'single',
            'parallel_candidate',
            'judge',
            'repair',
            'resume',
            'workflow_step',
            'hook'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_session_run_lane_role'
    ) THEN
        CREATE TYPE task_session_run_lane_role AS ENUM (
            'primary',
            'candidate',
            'judge',
            'repair',
            'resume',
            'hook'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_session_message_role'
    ) THEN
        CREATE TYPE task_session_message_role AS ENUM (
            'user',
            'assistant',
            'system',
            'tool'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_message_kind'
    ) THEN
        CREATE TYPE task_message_kind AS ENUM (
            'prompt',
            'reply',
            'note',
            'tool_echo'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_message_status'
    ) THEN
        CREATE TYPE task_message_status AS ENUM (
            'pending',
            'streaming',
            'completed',
            'failed',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_session_message_part_type'
    ) THEN
        CREATE TYPE task_session_message_part_type AS ENUM (
            'text',
            'tool_call',
            'tool_result',
            'thinking',
            'file_reference',
            'diff'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_operation_kind'
    ) THEN
        CREATE TYPE task_operation_kind AS ENUM (
            'model_request',
            'tool_call',
            'judge',
            'hook',
            'resume',
            'system'
        );
    END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "task_sessions"
    DROP CONSTRAINT IF EXISTS "task_sessions_completed_terminal_refs_chk";
--> statement-breakpoint

ALTER TABLE "task_session_runs"
    DROP CONSTRAINT IF EXISTS "task_session_runs_completed_finished_at_chk";
--> statement-breakpoint

ALTER TABLE "task_messages"
    DROP CONSTRAINT IF EXISTS "task_messages_completed_time_chk";
--> statement-breakpoint

ALTER TABLE "task_messages"
    DROP CONSTRAINT IF EXISTS "task_messages_user_created_by_run_null_chk";
--> statement-breakpoint

ALTER TABLE "task_operations"
    DROP CONSTRAINT IF EXISTS "task_operations_kind_tool_name_chk";
--> statement-breakpoint

ALTER TABLE "task_execution_phases"
    ALTER COLUMN "phase_kind" TYPE task_execution_phase_kind USING "phase_kind"::task_execution_phase_kind,
    ALTER COLUMN "trigger_type" TYPE task_execution_phase_trigger_type USING "trigger_type"::task_execution_phase_trigger_type,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_execution_phase_status USING "status"::task_execution_phase_status,
    ALTER COLUMN "terminal_reason" TYPE task_execution_phase_terminal_reason USING "terminal_reason"::task_execution_phase_terminal_reason,
    ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint

ALTER TABLE "task_sessions"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_session_node_status USING "status"::task_session_node_status,
    ALTER COLUMN "status" SET DEFAULT 'running';
--> statement-breakpoint

ALTER TABLE "task_session_runs"
    ALTER COLUMN "trigger_type" TYPE task_session_run_trigger_type USING "trigger_type"::task_session_run_trigger_type,
    ALTER COLUMN "execution_kind" TYPE task_session_run_execution_kind USING "execution_kind"::task_session_run_execution_kind,
    ALTER COLUMN "lane_role" TYPE task_session_run_lane_role USING "lane_role"::task_session_run_lane_role,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_session_node_status USING "status"::task_session_node_status,
    ALTER COLUMN "status" SET DEFAULT 'running';
--> statement-breakpoint

ALTER TABLE "task_messages"
    ALTER COLUMN "role" TYPE task_session_message_role USING "role"::task_session_message_role,
    ALTER COLUMN "message_kind" TYPE task_message_kind USING "message_kind"::task_message_kind,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_message_status USING "status"::task_message_status,
    ALTER COLUMN "status" SET DEFAULT 'streaming';
--> statement-breakpoint

ALTER TABLE "task_message_parts"
    ALTER COLUMN "part_type" TYPE task_session_message_part_type USING "part_type"::task_session_message_part_type;
--> statement-breakpoint

ALTER TABLE "task_operations"
    ALTER COLUMN "operation_kind" TYPE task_operation_kind USING "operation_kind"::task_operation_kind,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_session_node_status USING "status"::task_session_node_status,
    ALTER COLUMN "status" SET DEFAULT 'running';
--> statement-breakpoint

ALTER TABLE "task_sessions"
    ADD CONSTRAINT "task_sessions_completed_terminal_refs_chk"
    CHECK ((("status" <> 'completed'::task_session_node_status) OR (("head_message_id" IS NOT NULL) AND ("latest_run_id" IS NOT NULL)))) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_session_runs"
    ADD CONSTRAINT "task_session_runs_completed_finished_at_chk"
    CHECK ((("status" <> 'completed'::task_session_node_status) OR ("finished_at" IS NOT NULL))) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_messages"
    ADD CONSTRAINT "task_messages_completed_time_chk"
    CHECK ((("status" <> 'completed'::task_message_status) OR ("completed_at" IS NOT NULL))) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_messages"
    ADD CONSTRAINT "task_messages_user_created_by_run_null_chk"
    CHECK ((("role" <> 'user'::task_session_message_role) OR ("created_by_run_id" IS NULL))) NOT VALID;
--> statement-breakpoint

ALTER TABLE "task_operations"
    ADD CONSTRAINT "task_operations_kind_tool_name_chk"
    CHECK (((("operation_kind" = 'model_request'::task_operation_kind) AND ("tool_name" IS NULL)) OR (("operation_kind" = 'tool_call'::task_operation_kind) AND ("tool_name" IS NOT NULL)) OR ("operation_kind" <> ALL (ARRAY['model_request'::task_operation_kind, 'tool_call'::task_operation_kind])))) NOT VALID;