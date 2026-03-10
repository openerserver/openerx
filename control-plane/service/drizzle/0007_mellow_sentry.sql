PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_repository_credentials` (
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
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_repository_credentials` (
	`id`,
	`project_id`,
	`repo_id`,
	`label`,
	`provider`,
	`credential_type`,
	`secret_ref`,
	`git_author_name`,
	`git_author_email`,
	`scope`,
	`is_default`,
	`status`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`project_id`,
	`repo_id`,
	`label`,
	`provider`,
	`credential_type`,
	`secret_ref`,
	`git_author_name`,
	`git_author_email`,
	`scope`,
	`is_default`,
	`status`,
	`created_at`,
	`updated_at`
FROM `repository_credentials`;
--> statement-breakpoint
DROP TABLE `repository_credentials`;
--> statement-breakpoint
ALTER TABLE `__new_repository_credentials` RENAME TO `repository_credentials`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;