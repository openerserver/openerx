ALTER TABLE `projects` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `updated_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `projects` SET `updated_at` = `created_at` WHERE `updated_at` = '';
