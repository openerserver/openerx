CREATE TABLE "boss_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"ts" text NOT NULL,
	"decision_type" text NOT NULL,
	"reason" text NOT NULL,
	"confidence" double precision,
	"stage_key" text,
	"metadata_json" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"ts" text NOT NULL,
	"reason" text NOT NULL,
	"status" text,
	"stage_key" text,
	"requested_by" text,
	"metadata_json" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_operating_modes" (
	"task_id" text PRIMARY KEY NOT NULL,
	"collaboration_mode" text NOT NULL,
	"autopilot_level" text NOT NULL,
	"boss_participation_mode" text NOT NULL,
	"selected_template_id" text,
	"scenario_key" text,
	"source" text DEFAULT 'task-override' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boss_decisions" ADD CONSTRAINT "boss_decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_escalations" ADD CONSTRAINT "human_escalations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_operating_modes" ADD CONSTRAINT "task_operating_modes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;