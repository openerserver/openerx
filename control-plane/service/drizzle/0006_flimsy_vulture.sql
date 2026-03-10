CREATE TABLE `repository_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repo_id` text,
	`label` text NOT NULL,
	`provider` text NOT NULL,
	`credential_type` text NOT NULL,
	`secret_ref` text NOT NULL,
	`git_author_name` text,
	`git_author_email` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`owner_user_id` text,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `credential_id` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `author_resolved_as` text;--> statement-breakpoint
ALTER TABLE `code_changes` ADD `commit_sha` text;--> statement-breakpoint
ALTER TABLE `code_changes` ADD `commit_author_name` text;--> statement-breakpoint
ALTER TABLE `code_changes` ADD `commit_author_email` text;--> statement-breakpoint
ALTER TABLE `code_changes` ADD `commit_message` text;--> statement-breakpoint
ALTER TABLE `code_changes` ADD `branch_name` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `credential_id` text REFERENCES repository_credentials(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `git_author_name` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `git_author_email` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `git_committer_name` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `git_committer_email` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `final_commit_sha` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `final_branch_name` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `changes_summary` text;