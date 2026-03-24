ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "git_committer_name" text,
ADD COLUMN IF NOT EXISTS "git_committer_email" text;