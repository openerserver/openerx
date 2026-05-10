CREATE TABLE IF NOT EXISTS "contributor_profiles" (
  "user_id" text PRIMARY KEY NOT NULL,
  "level" text DEFAULT 'L1' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "reputation_score" numeric(8,2) DEFAULT 0 NOT NULL,
  "completed_tasks" integer DEFAULT 0 NOT NULL,
  "rejected_changes" integer DEFAULT 0 NOT NULL,
  "risk_incidents" integer DEFAULT 0 NOT NULL,
  "daily_task_quota" integer DEFAULT 1 NOT NULL,
  "active_task_quota" integer DEFAULT 1 NOT NULL,
  "runtime_minutes_quota" integer DEFAULT 60 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "contributor_profiles_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "contributor_profiles_level_check"
    CHECK ("level" IN ('L1', 'L2', 'L3', 'L4', 'L5')),
  CONSTRAINT "contributor_profiles_status_check"
    CHECK ("status" IN ('active', 'suspended', 'banned')),
  CONSTRAINT "contributor_profiles_quotas_check"
    CHECK ("daily_task_quota" >= 0 AND "active_task_quota" >= 0 AND "runtime_minutes_quota" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contributor_profiles_level_status"
  ON "contributor_profiles" ("level", "status", "updated_at");
