ALTER TABLE `tasks` ADD `repo_id` text REFERENCES repositories(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `workspace_root` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `base_revision` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `working_branch` text;