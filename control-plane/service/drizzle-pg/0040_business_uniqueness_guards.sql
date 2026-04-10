-- Migration 0040: business uniqueness guards
-- Tighten obvious business-identity constraints and normalize default credentials.

UPDATE "repository_credentials"
SET
  "is_default" = false,
  "updated_at" = CURRENT_TIMESTAMP::text
WHERE "is_default" = true
  AND "status" = 'revoked';
--> statement-breakpoint

WITH ranked_defaults AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "project_id", "repo_id"
      ORDER BY "updated_at" DESC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC
    ) AS row_num
  FROM "repository_credentials"
  WHERE "is_default" = true
    AND "status" = 'active'
)
UPDATE "repository_credentials" AS rc
SET
  "is_default" = false,
  "updated_at" = CURRENT_TIMESTAMP::text
FROM ranked_defaults AS ranked
WHERE rc."id" = ranked."id"
  AND ranked.row_num > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_org_slug"
  ON "projects" ("org_id", "slug");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_roles_user_project"
  ON "project_roles" ("user_id", "project_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_environments_project_name"
  ON "environments" ("project_id", "name");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_repositories_project_name"
  ON "repositories" ("project_id", "name");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_repositories_project_remote_url"
  ON "repositories" ("project_id", "remote_url");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_repository_credentials_project_default_active"
  ON "repository_credentials" ("project_id")
  WHERE "repo_id" IS NULL AND "is_default" = true AND "status" = 'active';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_repository_credentials_repo_default_active"
  ON "repository_credentials" ("project_id", "repo_id")
  WHERE "repo_id" IS NOT NULL AND "is_default" = true AND "status" = 'active';