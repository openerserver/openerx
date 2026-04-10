DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'approval_ticket_action_type'
    ) THEN
        CREATE TYPE approval_ticket_action_type AS ENUM (
            'production_write',
            'level3_command',
            'budget_exceed',
            'batch_edit',
            'external_api'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'approval_ticket_status'
    ) THEN
        CREATE TYPE approval_ticket_status AS ENUM (
            'pending',
            'approved',
            'rejected',
            'expired'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_workflow_run_status'
    ) THEN
        CREATE TYPE task_workflow_run_status AS ENUM (
            'pending',
            'running',
            'blocked',
            'waiting-approval',
            'failed',
            'completed',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_stage_run_status'
    ) THEN
        CREATE TYPE task_stage_run_status AS ENUM (
            'pending',
            'running',
            'blocked',
            'waiting-approval',
            'failed',
            'completed',
            'skipped',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'task_stage_run_approval_state'
    ) THEN
        CREATE TYPE task_stage_run_approval_state AS ENUM (
            'not-required',
            'pending',
            'approved',
            'rejected',
            'expired',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'role_aggregate_conclusion_aggregation_strategy'
    ) THEN
        CREATE TYPE role_aggregate_conclusion_aggregation_strategy AS ENUM (
            'first-pass',
            'majority',
            'merge-summary',
            'human-review'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'role_aggregate_conclusion_status'
    ) THEN
        CREATE TYPE role_aggregate_conclusion_status AS ENUM (
            'aligned',
            'partially-aligned',
            'conflicted',
            'escalated',
            'blocked'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'role_aggregate_conclusion_final_decision'
    ) THEN
        CREATE TYPE role_aggregate_conclusion_final_decision AS ENUM (
            'allow',
            'notify-developer',
            'needs-approval',
            'block',
            'observe',
            'human-review'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'role_aggregate_conclusion_risk_level'
    ) THEN
        CREATE TYPE role_aggregate_conclusion_risk_level AS ENUM (
            'low',
            'medium',
            'high',
            'critical'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'developer_change_request_status'
    ) THEN
        CREATE TYPE developer_change_request_status AS ENUM (
            'open',
            'acknowledged',
            'in-progress',
            'resolved',
            'won''t-fix'
        );
    END IF;
END $$;

CREATE OR REPLACE FUNCTION openerx_parse_timestamptz(value text)
RETURNS timestamp with time zone
LANGUAGE SQL
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
    SELECT NULLIF(btrim(value), '')::timestamp with time zone
$$;

ALTER TABLE "approval_tickets"
    ALTER COLUMN "action_type" TYPE approval_ticket_action_type USING "action_type"::approval_ticket_action_type,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE approval_ticket_status USING "status"::approval_ticket_status,
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "resolved_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("resolved_at"),
    ALTER COLUMN "expires_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("expires_at"),
    ALTER COLUMN "status" SET DEFAULT 'pending',
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "task_workflow_runs"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_workflow_run_status USING "status"::task_workflow_run_status,
    ALTER COLUMN "started_at" DROP DEFAULT,
    ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
    ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "status" SET DEFAULT 'pending',
    ALTER COLUMN "started_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "task_stage_runs"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE task_stage_run_status USING "status"::task_stage_run_status,
    ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
    ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
    ALTER COLUMN "approval_state" DROP DEFAULT,
    ALTER COLUMN "approval_state" TYPE task_stage_run_approval_state USING "approval_state"::task_stage_run_approval_state,
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "status" SET DEFAULT 'pending',
    ALTER COLUMN "approval_state" SET DEFAULT 'not-required',
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "role_aggregate_conclusions"
    ALTER COLUMN "aggregation_strategy" TYPE role_aggregate_conclusion_aggregation_strategy USING "aggregation_strategy"::role_aggregate_conclusion_aggregation_strategy,
    ALTER COLUMN "status" TYPE role_aggregate_conclusion_status USING "status"::role_aggregate_conclusion_status,
    ALTER COLUMN "final_decision" TYPE role_aggregate_conclusion_final_decision USING "final_decision"::role_aggregate_conclusion_final_decision,
    ALTER COLUMN "aggregate_risk_level" TYPE role_aggregate_conclusion_risk_level USING "aggregate_risk_level"::role_aggregate_conclusion_risk_level,
    ALTER COLUMN "generated_at" DROP DEFAULT,
    ALTER COLUMN "generated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("generated_at"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "generated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "developer_change_requests"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE developer_change_request_status USING "status"::developer_change_request_status,
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "resolved_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("resolved_at"),
    ALTER COLUMN "status" SET DEFAULT 'open',
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "boss_decisions"
    ALTER COLUMN "ts" TYPE timestamp with time zone USING openerx_parse_timestamptz("ts"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "human_escalations"
    ALTER COLUMN "ts" TYPE timestamp with time zone USING openerx_parse_timestamptz("ts"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

DROP FUNCTION openerx_parse_timestamptz(text);