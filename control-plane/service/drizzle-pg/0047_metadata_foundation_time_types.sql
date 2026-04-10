-- Migration 0047: tighten remaining foundation metadata timestamps.

CREATE OR REPLACE FUNCTION openerx_parse_timestamptz(value text)
RETURNS timestamp with time zone
LANGUAGE SQL
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(btrim(value), '')::timestamp with time zone
$$;
--> statement-breakpoint

ALTER TABLE "organizations"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "projects"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "environments"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "budget_configs"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "code_changes"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "plugins"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "last_verified_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("last_verified_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "policy_templates"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

DROP FUNCTION openerx_parse_timestamptz(text);