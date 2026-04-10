DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'paid_execution_lease_status'
    ) THEN
        CREATE TYPE paid_execution_lease_status AS ENUM (
            'active',
            'revoked',
            'expired'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'runtime_usage_ledger_status'
    ) THEN
        CREATE TYPE runtime_usage_ledger_status AS ENUM (
            'running',
            'completed',
            'failed',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'runtime_usage_ledger_step_type'
    ) THEN
        CREATE TYPE runtime_usage_ledger_step_type AS ENUM (
            'execution',
            'judge',
            'hook',
            'resume',
            'other'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'runtime_usage_ledger_step_status'
    ) THEN
        CREATE TYPE runtime_usage_ledger_step_status AS ENUM (
            'pending',
            'completed',
            'failed',
            'skipped'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'runtime_usage_baseline_match_scope'
    ) THEN
        CREATE TYPE runtime_usage_baseline_match_scope AS ENUM (
            'project+provider+model+entrypoint+fingerprint',
            'project+provider+model+entrypoint',
            'project+provider+model',
            'project+entrypoint',
            'project'
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

ALTER TABLE "paid_execution_leases"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE paid_execution_lease_status USING "status"::paid_execution_lease_status,
    ALTER COLUMN "expires_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("expires_at"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "revoked_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("revoked_at"),
    ALTER COLUMN "status" SET DEFAULT 'active',
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "runtime_usage_ledgers"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE runtime_usage_ledger_status USING "status"::runtime_usage_ledger_status,
    ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
    ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
    ALTER COLUMN "synced_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("synced_at"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "status" SET DEFAULT 'running',
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "runtime_usage_ledger_steps"
    ALTER COLUMN "step_type" TYPE runtime_usage_ledger_step_type USING "step_type"::runtime_usage_ledger_step_type,
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE runtime_usage_ledger_step_status USING "status"::runtime_usage_ledger_step_status,
    ALTER COLUMN "started_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("started_at"),
    ALTER COLUMN "finished_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("finished_at"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "status" SET DEFAULT 'completed',
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "runtime_usage_baselines"
    ALTER COLUMN "match_scope" DROP DEFAULT,
    ALTER COLUMN "match_scope" TYPE runtime_usage_baseline_match_scope USING "match_scope"::runtime_usage_baseline_match_scope,
    ALTER COLUMN "last_ledger_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("last_ledger_at"),
    ALTER COLUMN "generated_at" DROP DEFAULT,
    ALTER COLUMN "generated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("generated_at"),
    ALTER COLUMN "created_at" DROP DEFAULT,
    ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
    ALTER COLUMN "updated_at" DROP DEFAULT,
    ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
    ALTER COLUMN "match_scope" SET DEFAULT 'project',
    ALTER COLUMN "generated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

DROP FUNCTION openerx_parse_timestamptz(text);