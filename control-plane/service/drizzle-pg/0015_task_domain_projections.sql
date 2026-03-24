CREATE TABLE "task_domain_events" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "task_id" text,
  "run_id" text,
  "run_node_id" text,
  "session_id" text,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "seq" bigint NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_domain_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_domain_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_domain_events_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_domain_events_run_node_id_task_run_nodes_id_fk" FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_domain_events_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_domain_events_task_seq_unique" UNIQUE ("task_id", "seq")
);
--> statement-breakpoint
CREATE INDEX "idx_task_domain_events_run_created_at" ON "task_domain_events" USING btree ("run_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_domain_events_session_created_at" ON "task_domain_events" USING btree ("session_id", "created_at");
--> statement-breakpoint

CREATE TABLE "task_snapshots" (
  "task_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "current_status" text NOT NULL,
  "orchestration_kind" text,
  "current_run_id" text,
  "current_session_id" text,
  "latest_result" text,
  "latest_result_summary" text,
  "latest_error_text" text,
  "active_candidate_count" integer DEFAULT 0 NOT NULL,
  "completed_candidate_count" integer DEFAULT 0 NOT NULL,
  "failed_candidate_count" integer DEFAULT 0 NOT NULL,
  "total_chain_steps" integer DEFAULT 0 NOT NULL,
  "completed_chain_steps" integer DEFAULT 0 NOT NULL,
  "winner_node_id" text,
  "last_activity_at" text,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_snapshots_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_task_snapshots_project_status_last_activity" ON "task_snapshots" USING btree ("project_id", "current_status", "last_activity_at");
--> statement-breakpoint
CREATE INDEX "idx_task_snapshots_project_updated_at" ON "task_snapshots" USING btree ("project_id", "updated_at");
--> statement-breakpoint

CREATE TABLE "task_timeline_views" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "task_id" text NOT NULL,
  "run_id" text,
  "run_node_id" text,
  "session_id" text,
  "message_id" text,
  "item_kind" text NOT NULL,
  "item_role" text,
  "title" text,
  "display_text" text,
  "metadata_json" jsonb,
  "sort_at" text NOT NULL,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "task_timeline_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_timeline_views_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_timeline_views_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_timeline_views_run_node_id_task_run_nodes_id_fk" FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_timeline_views_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "task_timeline_views_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_task_timeline_views_task_sort_at" ON "task_timeline_views" USING btree ("task_id", "sort_at", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_timeline_views_run_sort_at" ON "task_timeline_views" USING btree ("run_id", "sort_at", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_task_timeline_views_session_sort_at" ON "task_timeline_views" USING btree ("session_id", "sort_at", "created_at");