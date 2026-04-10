-- Migration 0048: close the remaining PostgreSQL text timestamp columns.

CREATE OR REPLACE FUNCTION openerx_parse_timestamptz(value text)
RETURNS timestamp with time zone
LANGUAGE SQL
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(btrim(value), '')::timestamp with time zone
$$;
--> statement-breakpoint

ALTER TABLE "audit_events"
  ALTER COLUMN "ts" DROP DEFAULT,
  ALTER COLUMN "ts" TYPE timestamp with time zone USING openerx_parse_timestamptz("ts"),
  ALTER COLUMN "ts" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "cost_records"
  ALTER COLUMN "ts" DROP DEFAULT,
  ALTER COLUMN "ts" TYPE timestamp with time zone USING openerx_parse_timestamptz("ts"),
  ALTER COLUMN "ts" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "workbench_layouts"
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "role_agents"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "role_agent_bindings"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "role_agent_project_overrides"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "workflow_templates"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_message_parts"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_operating_modes"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

DROP FUNCTION openerx_parse_timestamptz(text);