CREATE TABLE `project_task_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`),
	`source_task_id` text NOT NULL REFERENCES `tasks`(`id`),
	`target_task_id` text NOT NULL REFERENCES `tasks`(`id`),
	`relation_type` text NOT NULL,
	`relation_source` text NOT NULL DEFAULT 'manual',
	`metadata` text,
	`created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX `idx_project_task_relations_unique_edge`
	ON `project_task_relations` (`project_id`, `source_task_id`, `target_task_id`, `relation_type`);

CREATE INDEX `idx_project_task_relations_project`
	ON `project_task_relations` (`project_id`, `relation_type`);
