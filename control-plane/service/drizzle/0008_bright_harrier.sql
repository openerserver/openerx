ALTER TABLE `users` ADD `email` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `account_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;