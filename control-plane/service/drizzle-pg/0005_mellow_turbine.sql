ALTER TABLE IF EXISTS "tasks"
ADD COLUMN IF NOT EXISTS "auto_advance_stages" boolean DEFAULT false;--> statement-breakpoint