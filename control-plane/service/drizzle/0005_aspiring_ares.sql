CREATE TABLE `code_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`repo_id` text,
	`agent_run_id` text,
	`change_source` text NOT NULL,
	`summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `file_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`file_path` text NOT NULL,
	`change_type` text NOT NULL,
	`old_path` text,
	`insertions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `code_changes`(`id`) ON UPDATE no action ON DELETE no action
);
