ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "git_author_name" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "git_author_email" text;