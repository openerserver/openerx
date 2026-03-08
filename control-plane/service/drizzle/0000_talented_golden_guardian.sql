CREATE TABLE `approval_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_run_id` text,
	`node_id` text,
	`action_type` text NOT NULL,
	`risk_level` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_detail` text,
	`approver` text,
	`comment` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`resolved_at` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text DEFAULT '(datetime(''now''))' NOT NULL,
	`user_id` text,
	`project_id` text,
	`session_id` text,
	`task_id` text,
	`agent_run_id` text,
	`event_type` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`risk_level` text DEFAULT 'low',
	`trace_id` text
);
--> statement-breakpoint
CREATE TABLE `budget_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`period` text NOT NULL,
	`limit_amount` real NOT NULL,
	`warn_threshold` real DEFAULT 0.8 NOT NULL,
	`throttle_threshold` real DEFAULT 0.95 NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cost_records` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text DEFAULT '(datetime(''now''))' NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`session_id` text,
	`task_id` text,
	`agent_run_id` text,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost` real NOT NULL,
	`budget_period` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `policy_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`rules` text,
	`applies_to` text DEFAULT 'all' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`settings` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`tokens_used` integer DEFAULT 0,
	`cost` real DEFAULT 0,
	`model_used` text,
	`agent_used` text,
	`started_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'developer' NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);