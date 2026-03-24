CREATE TABLE "conversation_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "task_id" text,
  "run_id" text,
  "run_node_id" text,
  "parent_session_id" text,
  "root_session_id" text,
  "forked_from_message_id" text,
  "session_kind" text NOT NULL,
  "source_type" text NOT NULL,
  "branch_name" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "runtime_session_id" text,
  "tree_node_id" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "archived_at" text,
  CONSTRAINT "conversation_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_sessions_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_sessions_run_node_id_task_run_nodes_id_fk" FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_sessions_tree_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("tree_node_id") REFERENCES "project_tree_nodes"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_conversation_sessions_runtime_session_id" ON "conversation_sessions" USING btree ("runtime_session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_conversation_sessions_tree_node_id" ON "conversation_sessions" USING btree ("tree_node_id");
--> statement-breakpoint
CREATE INDEX "idx_conversation_sessions_task_created_at" ON "conversation_sessions" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_conversation_sessions_run_created_at" ON "conversation_sessions" USING btree ("run_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_conversation_sessions_parent_session_id" ON "conversation_sessions" USING btree ("parent_session_id");
--> statement-breakpoint
CREATE INDEX "idx_conversation_sessions_root_session_id" ON "conversation_sessions" USING btree ("root_session_id");
--> statement-breakpoint

CREATE TABLE "conversation_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "task_id" text,
  "run_id" text,
  "run_node_id" text,
  "project_id" text NOT NULL,
  "runtime_message_id" text,
  "role" text NOT NULL,
  "message_index" integer NOT NULL,
  "text_content" text,
  "summary_text" text,
  "raw_payload" jsonb,
  "token_used" integer,
  "started_at" text,
  "completed_at" text,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "conversation_messages_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_messages_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_messages_run_node_id_task_run_nodes_id_fk" FOREIGN KEY ("run_node_id") REFERENCES "task_run_nodes"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_messages_session_message_index_unique" UNIQUE ("session_id", "message_index"),
  CONSTRAINT "conversation_messages_session_runtime_message_id_unique" UNIQUE ("session_id", "runtime_message_id")
);
--> statement-breakpoint
CREATE INDEX "idx_conversation_messages_task_created_at" ON "conversation_messages" USING btree ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_conversation_messages_run_created_at" ON "conversation_messages" USING btree ("run_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_conversation_messages_session_created_at" ON "conversation_messages" USING btree ("session_id", "created_at");
--> statement-breakpoint

CREATE TABLE "conversation_message_parts" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "part_index" integer NOT NULL,
  "part_type" text NOT NULL,
  "text_content" text,
  "json_payload" jsonb,
  "created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "conversation_message_parts_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "conversation_message_parts_message_part_index_unique" UNIQUE ("message_id", "part_index")
);
--> statement-breakpoint
CREATE INDEX "idx_conversation_message_parts_message_id" ON "conversation_message_parts" USING btree ("message_id");