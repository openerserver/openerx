CREATE EXTENSION IF NOT EXISTS ltree;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_tree_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"path" ltree NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"node_type" text NOT NULL,
	"role" text,
	"content_text" text,
	"content_json" jsonb,
	"token_count" integer,
	"runtime_session_id" text,
	"runtime_message_id" text,
	"branch_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"superseded_by" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"archived_at" text,
	CONSTRAINT "project_tree_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_nodes_parent_id_project_tree_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_nodes_superseded_by_project_tree_nodes_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_tree_branches" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_node_id" text,
	"branch_name" text NOT NULL,
	"head_node_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "project_tree_branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_branches_task_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("task_node_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_branches_head_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("head_node_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_tree_events" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text,
	"project_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"seq" integer NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "project_tree_events_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_tree_links" (
	"id" text PRIMARY KEY NOT NULL,
	"source_node_id" text NOT NULL,
	"source_project_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"target_project_id" text NOT NULL,
	"link_type" text NOT NULL,
	"metadata" jsonb,
	"bidirectional" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "project_tree_links_source_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_links_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_links_target_node_id_project_tree_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "project_tree_links_target_project_id_projects_id_fk" FOREIGN KEY ("target_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ptn_project_path" ON "project_tree_nodes" USING gist ("path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptn_project_id" ON "project_tree_nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptn_parent_id" ON "project_tree_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptn_node_type" ON "project_tree_nodes" USING btree ("project_id","node_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptn_runtime_ses" ON "project_tree_nodes" USING btree ("runtime_session_id") WHERE "runtime_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptn_runtime_msg" ON "project_tree_nodes" USING btree ("runtime_message_id") WHERE "runtime_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ptb_project_branch_unique" ON "project_tree_branches" USING btree ("project_id","branch_name") WHERE "task_node_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ptb_task_branch_unique" ON "project_tree_branches" USING btree ("project_id","task_node_id","branch_name") WHERE "task_node_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pte_node_seq" ON "project_tree_events" USING btree ("node_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pte_project_time" ON "project_tree_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ptl_unique_edge" ON "project_tree_links" USING btree ("source_node_id","target_node_id","link_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptl_source" ON "project_tree_links" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptl_target" ON "project_tree_links" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptl_source_project" ON "project_tree_links" USING btree ("source_project_id","link_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ptl_target_project" ON "project_tree_links" USING btree ("target_project_id","link_type");--> statement-breakpoint

INSERT INTO "project_tree_nodes" (
	"id",
	"project_id",
	"parent_id",
	"path",
	"depth",
	"node_type",
	"content_text",
	"is_active",
	"created_at",
	"updated_at"
)
SELECT
	'project_root:' || p.id,
	p.id,
	NULL,
	CAST('project_' || regexp_replace(p.id, '[^A-Za-z0-9_]', '_', 'g') AS ltree),
	0,
	'project_root',
	p.name,
	true,
	COALESCE(p.created_at, CURRENT_TIMESTAMP::text),
	COALESCE(p.updated_at, p.created_at, CURRENT_TIMESTAMP::text)
FROM "projects" p
WHERE NOT EXISTS (
	SELECT 1
	FROM "project_tree_nodes" n
	WHERE n."project_id" = p.id
	  AND n."node_type" = 'project_root'
);--> statement-breakpoint

INSERT INTO "project_tree_branches" (
	"id",
	"project_id",
	"task_node_id",
	"branch_name",
	"head_node_id",
	"is_default",
	"created_at",
	"updated_at"
)
SELECT
	'project_branch:main:' || p.id,
	p.id,
	NULL,
	'main',
	'project_root:' || p.id,
	true,
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
FROM "projects" p
WHERE NOT EXISTS (
	SELECT 1
	FROM "project_tree_branches" b
	WHERE b."project_id" = p.id
	  AND b."task_node_id" IS NULL
	  AND b."branch_name" = 'main'
);--> statement-breakpoint