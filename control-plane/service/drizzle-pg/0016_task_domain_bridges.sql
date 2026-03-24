ALTER TABLE "project_tree_nodes"
  ADD COLUMN "ref_type" text,
  ADD COLUMN "ref_id" text;
--> statement-breakpoint
CREATE INDEX "idx_ptn_ref_type_ref_id"
  ON "project_tree_nodes" USING btree ("ref_type", "ref_id");
--> statement-breakpoint

ALTER TABLE "agent_runs"
  ADD COLUMN "run_id" text,
  ADD COLUMN "run_node_id" text,
  ADD CONSTRAINT "agent_runs_run_id_task_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  ADD CONSTRAINT "agent_runs_run_node_id_task_run_nodes_id_fk"
    FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_agent_runs_run_id" ON "agent_runs" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "idx_agent_runs_run_node_id" ON "agent_runs" USING btree ("run_node_id");
--> statement-breakpoint

ALTER TABLE "runtime_usage_ledgers"
  ADD COLUMN "run_id" text,
  ADD COLUMN "run_node_id" text,
  ADD CONSTRAINT "runtime_usage_ledgers_run_id_task_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  ADD CONSTRAINT "runtime_usage_ledgers_run_node_id_task_run_nodes_id_fk"
    FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledgers_run_id" ON "runtime_usage_ledgers" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledgers_run_node_id" ON "runtime_usage_ledgers" USING btree ("run_node_id");
--> statement-breakpoint

ALTER TABLE "runtime_usage_ledger_steps"
  ADD COLUMN "run_id" text,
  ADD COLUMN "run_node_id" text,
  ADD CONSTRAINT "runtime_usage_ledger_steps_run_id_task_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  ADD CONSTRAINT "runtime_usage_ledger_steps_run_node_id_task_run_nodes_id_fk"
    FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledger_steps_run_id" ON "runtime_usage_ledger_steps" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "idx_runtime_usage_ledger_steps_run_node_id" ON "runtime_usage_ledger_steps" USING btree ("run_node_id");