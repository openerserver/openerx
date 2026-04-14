-- Migration 0050: add project model fund wallet tables.

CREATE TABLE IF NOT EXISTS "project_model_funds" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id"),
  "currency" text NOT NULL DEFAULT 'USD',
  "total_granted" double precision NOT NULL DEFAULT 0,
  "reserved" double precision NOT NULL DEFAULT 0,
  "consumed" double precision NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_model_funds_project"
  ON "project_model_funds" ("project_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_model_fund_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id"),
  "fund_id" text NOT NULL REFERENCES "project_model_funds"("id"),
  "type" text NOT NULL,
  "amount_usd" double precision NOT NULL,
  "balance_after" double precision NOT NULL,
  "model_route" text,
  "task_id" text,
  "runtime_session_id" text,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_fund_ledger_project_time"
  ON "project_model_fund_ledger" ("project_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_fund_ledger_fund"
  ON "project_model_fund_ledger" ("fund_id");