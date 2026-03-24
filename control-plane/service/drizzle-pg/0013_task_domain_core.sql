CREATE TABLE "tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "tree_node_id" text,
  "created_by_user_id" text,
  "title" text NOT NULL,
  "prompt" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "category" text,
  "current_run_id" text,
  "current_session_id" text,
  "current_agent_run_id" text,
  "latest_result" text,
  "latest_result_summary" text,
  "selected_model" text,
  "repo_id" text,
  "workspace_root" text,
  "base_revision" text,
  "working_branch" text,
  "credential_id" text,
  "strategy_json" jsonb,
  "final_commit_sha" text,
  "final_branch_name" text,
  "changes_summary_json" jsonb,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "started_at" text,
  "finished_at" text,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "tasks_tree_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("tree_node_id") REFERENCES "project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "tasks_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "tasks_credential_id_repository_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "repository_credentials"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_tree_node_id" ON "tasks" USING btree ("tree_node_id");
--> statement-breakpoint
CREATE INDEX "idx_tasks_project_created_at" ON "tasks" USING btree ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_tasks_project_status_created_at" ON "tasks" USING btree ("project_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_tasks_current_run_id" ON "tasks" USING btree ("current_run_id");
--> statement-breakpoint
CREATE INDEX "idx_tasks_current_session_id" ON "tasks" USING btree ("current_session_id");
--> statement-breakpoint

CREATE TABLE "task_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "orchestration_kind" text NOT NULL,
  "trigger_type" text NOT NULL,
  "source_type" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "root_session_id" text,
  "winner_node_id" text,
  "judge_node_id" text,
  "requested_model" text,
  "effective_model" text,
  "pipeline_step_count" integer,
  "candidate_count" integer,
  "result_text" text,
  "result_summary" text,
  "error_text" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_task_runs_task_created_at" ON "task_runs" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_runs_project_created_at" ON "task_runs" USING btree ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_runs_status_created_at" ON "task_runs" USING btree ("status", "created_at");
--> statement-breakpoint

CREATE TABLE "task_run_nodes" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "task_id" text NOT NULL,
  "project_id" text NOT NULL,
  "node_kind" text NOT NULL,
  "node_key" text NOT NULL,
  "title" text,
  "instruction" text,
  "candidate_index" integer,
  "chain_step_index" integer,
  "hook_trigger" text,
  "agent_type" text,
  "model_used" text,
  "session_id" text,
  "agent_run_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "result_text" text,
  "result_summary" text,
  "error_text" text,
  "token_used" integer,
  "started_at" text,
  "finished_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_run_nodes_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_nodes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_nodes_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_nodes_run_id_node_key_unique" UNIQUE ("run_id", "node_key")
);
--> statement-breakpoint
CREATE INDEX "idx_task_run_nodes_run_created_at" ON "task_run_nodes" USING btree ("run_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_run_nodes_task_created_at" ON "task_run_nodes" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_run_nodes_session_id" ON "task_run_nodes" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "idx_task_run_nodes_agent_run_id" ON "task_run_nodes" USING btree ("agent_run_id");
--> statement-breakpoint
CREATE INDEX "idx_task_run_nodes_run_candidate_index" ON "task_run_nodes" USING btree ("run_id", "candidate_index");
--> statement-breakpoint
CREATE INDEX "idx_task_run_nodes_run_chain_step_index" ON "task_run_nodes" USING btree ("run_id", "chain_step_index");
--> statement-breakpoint

CREATE TABLE "task_run_edges" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "task_id" text NOT NULL,
  "from_node_id" text NOT NULL,
  "to_node_id" text NOT NULL,
  "edge_kind" text NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_run_edges_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_edges_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_edges_from_node_id_task_run_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_edges_to_node_id_task_run_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_run_edges_unique" UNIQUE ("run_id", "from_node_id", "to_node_id", "edge_kind")
);
--> statement-breakpoint
CREATE INDEX "idx_task_run_edges_run_id" ON "task_run_edges" USING btree ("run_id");