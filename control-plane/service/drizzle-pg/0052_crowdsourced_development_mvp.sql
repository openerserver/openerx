CREATE TABLE IF NOT EXISTS "task_boundaries" (
  "task_id" text PRIMARY KEY NOT NULL,
  "allowed_paths_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blocked_paths_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "acceptance_checks_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "runtime_level" integer DEFAULT 1 NOT NULL,
  "reward_amount" numeric(12,2),
  "reward_currency" text DEFAULT 'points' NOT NULL,
  "risk_level" text DEFAULT 'low' NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_boundaries_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_boundaries_runtime_level_check"
    CHECK ("runtime_level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "contributor_user_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "released_at" timestamp with time zone,
  CONSTRAINT "task_assignments_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "task_assignments_contributor_user_id_users_id_fk"
    FOREIGN KEY ("contributor_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_assignments_status_check"
    CHECK ("status" IN ('active', 'released', 'expired', 'submitted', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_assignments_one_active"
  ON "task_assignments" ("task_id")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_assignments_user_status"
  ON "task_assignments" ("contributor_user_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_branches" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "assignment_id" text,
  "user_id" text NOT NULL,
  "branch_name" text NOT NULL,
  "base_revision" text,
  "workspace_root" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "workspace_branches_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "workspace_branches_assignment_id_task_assignments_id_fk"
    FOREIGN KEY ("assignment_id") REFERENCES "task_assignments"("id") ON DELETE SET NULL ON UPDATE no action,
  CONSTRAINT "workspace_branches_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "workspace_branches_status_check"
    CHECK ("status" IN ('active', 'archived', 'abandoned', 'merged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_branches_task_user_active"
  ON "workspace_branches" ("task_id", "user_id")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workspace_branches_task_created"
  ON "workspace_branches" ("task_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commit_steps" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "assignment_id" text,
  "workspace_branch_id" text,
  "code_change_id" text,
  "step_index" integer NOT NULL,
  "commit_sha" text NOT NULL,
  "parent_commit_sha" text,
  "branch_name" text,
  "summary" text,
  "test_status" text DEFAULT 'not_run' NOT NULL,
  "preview_status" text DEFAULT 'not_requested' NOT NULL,
  "risk_level" text DEFAULT 'low' NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "commit_steps_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "commit_steps_assignment_id_task_assignments_id_fk"
    FOREIGN KEY ("assignment_id") REFERENCES "task_assignments"("id") ON DELETE SET NULL ON UPDATE no action,
  CONSTRAINT "commit_steps_workspace_branch_id_workspace_branches_id_fk"
    FOREIGN KEY ("workspace_branch_id") REFERENCES "workspace_branches"("id") ON DELETE SET NULL ON UPDATE no action,
  CONSTRAINT "commit_steps_code_change_id_code_changes_id_fk"
    FOREIGN KEY ("code_change_id") REFERENCES "code_changes"("id") ON DELETE SET NULL ON UPDATE no action,
  CONSTRAINT "commit_steps_test_status_check"
    CHECK ("test_status" IN ('not_run', 'running', 'passed', 'failed', 'skipped')),
  CONSTRAINT "commit_steps_preview_status_check"
    CHECK ("preview_status" IN ('not_requested', 'queued', 'starting', 'running', 'failed', 'stopped')),
  CONSTRAINT "commit_steps_risk_level_check"
    CHECK ("risk_level" IN ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_commit_steps_task_step"
  ON "commit_steps" ("task_id", "step_index");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_commit_steps_commit_sha"
  ON "commit_steps" ("commit_sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commit_steps_task_created"
  ON "commit_steps" ("task_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commit_runtimes" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "commit_step_id" text,
  "commit_sha" text NOT NULL,
  "runtime_level" integer DEFAULT 1 NOT NULL,
  "provider" text DEFAULT 'local' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "preview_url" text,
  "logs_url" text,
  "ttl_seconds" integer DEFAULT 1800 NOT NULL,
  "requested_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "expires_at" timestamp with time zone,
  CONSTRAINT "commit_runtimes_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE no action,
  CONSTRAINT "commit_runtimes_commit_step_id_commit_steps_id_fk"
    FOREIGN KEY ("commit_step_id") REFERENCES "commit_steps"("id") ON DELETE SET NULL ON UPDATE no action,
  CONSTRAINT "commit_runtimes_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "commit_runtimes_runtime_level_check"
    CHECK ("runtime_level" BETWEEN 1 AND 5),
  CONSTRAINT "commit_runtimes_status_check"
    CHECK ("status" IN ('queued', 'prepared', 'starting', 'running', 'failed', 'stopped', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_commit_runtimes_commit_sha"
  ON "commit_runtimes" ("commit_sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commit_runtimes_task_status"
  ON "commit_runtimes" ("task_id", "status", "updated_at");
