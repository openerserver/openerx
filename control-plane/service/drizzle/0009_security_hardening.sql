ALTER TABLE `users` ADD `token_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `failed_login_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` text;