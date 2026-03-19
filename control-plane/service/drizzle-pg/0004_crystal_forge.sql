ALTER TABLE IF EXISTS "workflow_template_stages"
ADD COLUMN IF NOT EXISTS "initial_task_definition_json" jsonb;--> statement-breakpoint