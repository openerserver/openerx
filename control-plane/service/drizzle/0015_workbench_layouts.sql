CREATE TABLE `workbench_layouts` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`),
	`layout_json` text NOT NULL DEFAULT '{}',
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
