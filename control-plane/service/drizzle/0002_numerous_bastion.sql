CREATE TABLE `task_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`graph_id` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`agent_type` text NOT NULL,
	`session_id` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 2 NOT NULL,
	`output` text,
	`error` text,
	`token_used` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`graph_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`edge_type` text DEFAULT 'blocks' NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_node_id`) REFERENCES `task_nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_node_id`) REFERENCES `task_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`node_id` text,
	`session_id` text,
	`agent_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model_used` text,
	`token_used` integer DEFAULT 0 NOT NULL,
	`result` text,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `task_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`plugin_path` text NOT NULL,
	`version` text,
	`source` text DEFAULT 'local' NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`description` text,
	`capabilities` text,
	`last_verified_at` text,
	`error_detail` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_name_unique` ON `plugins` (`name`);
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `category` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `strategy` text;
