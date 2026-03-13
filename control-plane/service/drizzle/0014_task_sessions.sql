CREATE TABLE `task_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL REFERENCES `tasks`(`id`),
	`runtime_session_id` text NOT NULL,
	`parent_runtime_session_id` text,
	`forked_from_message_id` text,
	`branch_name` text,
	`source_type` text NOT NULL DEFAULT 'root',
	`is_active` integer NOT NULL DEFAULT false,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`archived_at` text
);
