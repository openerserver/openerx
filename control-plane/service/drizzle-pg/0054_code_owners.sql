CREATE TABLE IF NOT EXISTS "code_owners" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "path_pattern" text NOT NULL,
  "owner_type" text NOT NULL,
  "owner_ref" text NOT NULL,
  "risk_level" text DEFAULT 'low' NOT NULL,
  "requires_approval" boolean DEFAULT true NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "code_owners_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "code_owners_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE no action,
  CONSTRAINT "code_owners_owner_type_check"
    CHECK ("owner_type" IN ('user', 'role', 'team')),
  CONSTRAINT "code_owners_risk_level_check"
    CHECK ("risk_level" IN ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_code_owners_project_pattern_owner"
  ON "code_owners" ("project_id", "path_pattern", "owner_type", "owner_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_code_owners_project_updated"
  ON "code_owners" ("project_id", "updated_at");
