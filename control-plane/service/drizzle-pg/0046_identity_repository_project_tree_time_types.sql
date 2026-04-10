-- Migration 0046: tighten remaining identity, repository, project-tree, and domain-event timestamps.

CREATE OR REPLACE FUNCTION openerx_parse_timestamptz(value text)
RETURNS timestamp with time zone
LANGUAGE SQL
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(btrim(value), '')::timestamp with time zone
$$;
--> statement-breakpoint

ALTER TABLE "project_tree_nodes"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "archived_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("archived_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "project_tree_branches"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "project_tree_links"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "users"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "locked_until" TYPE timestamp with time zone USING openerx_parse_timestamptz("locked_until"),
  ALTER COLUMN "last_login_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("last_login_at"),
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "repositories"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "repository_credentials"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("updated_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "task_domain_events"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING openerx_parse_timestamptz("created_at"),
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint

DROP FUNCTION openerx_parse_timestamptz(text);