CREATE EXTENSION IF NOT EXISTS ltree;

INSERT INTO "project_tree_nodes" (
  "id",
  "project_id",
  "parent_id",
  "path",
  "depth",
  "node_type",
  "content_text",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  'project_root:' || p."id" AS "id",
  p."id" AS "project_id",
  NULL AS "parent_id",
  CAST('project_' || regexp_replace(p."id", '[^A-Za-z0-9_]', '_', 'g') AS ltree) AS "path",
  0 AS "depth",
  'project_root' AS "node_type",
  p."name" AS "content_text",
  TRUE AS "is_active",
  COALESCE(p."created_at", CURRENT_TIMESTAMP::text) AS "created_at",
  COALESCE(p."updated_at", p."created_at", CURRENT_TIMESTAMP::text) AS "updated_at"
FROM "projects" p
WHERE NOT EXISTS (
  SELECT 1
  FROM "project_tree_nodes" n
  WHERE n."id" = 'project_root:' || p."id"
);

INSERT INTO "project_tree_nodes" (
  "id",
  "project_id",
  "parent_id",
  "path",
  "depth",
  "node_type",
  "content_text",
  "content_json",
  "runtime_session_id",
  "branch_name",
  "is_active",
  "created_at",
  "updated_at",
  "archived_at"
)
SELECT
  t."id" AS "id",
  t."project_id" AS "project_id",
  'project_root:' || t."project_id" AS "parent_id",
  CAST(
    ('project_' || regexp_replace(t."project_id", '[^A-Za-z0-9_]', '_', 'g')) ||
    '.task_' || regexp_replace(t."id", '[^A-Za-z0-9_]', '_', 'g')
    AS ltree
  ) AS "path",
  1 AS "depth",
  'task' AS "node_type",
  t."title" AS "content_text",
  jsonb_build_object(
    'userId', t."user_id",
    'prompt', t."prompt",
    'status', t."status",
    'sessionId', t."session_id",
    'agentRunId', t."agent_run_id",
    'result', t."result",
    'category', t."category",
    'strategy', t."strategy",
    'repoId', t."repo_id",
    'workspaceRoot', t."workspace_root",
    'baseRevision', t."base_revision",
    'workingBranch', t."working_branch",
    'selectedModel', t."selected_model",
    'executionMode', t."execution_mode",
    'executionPlan', t."execution_plan",
    'autoAdvanceStages', t."auto_advance_stages",
    'credentialId', t."credential_id",
    'gitAuthorName', t."git_author_name",
    'gitAuthorEmail', t."git_author_email",
    'gitCommitterName', t."git_committer_name",
    'gitCommitterEmail', t."git_committer_email",
    'finalCommitSha', t."final_commit_sha",
    'finalBranchName', t."final_branch_name",
    'changesSummary', t."changes_summary",
    'createdAt', t."created_at",
    'startedAt', t."started_at",
    'finishedAt', t."finished_at"
  ) AS "content_json",
  t."session_id" AS "runtime_session_id",
  t."working_branch" AS "branch_name",
  TRUE AS "is_active",
  t."created_at" AS "created_at",
  COALESCE(t."finished_at", t."started_at", CURRENT_TIMESTAMP::text) AS "updated_at",
  NULL AS "archived_at"
FROM "tasks" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "project_tree_nodes" n
  WHERE n."id" = t."id"
);

ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_task_id_tasks_id_fk";
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "code_changes" DROP CONSTRAINT IF EXISTS "code_changes_task_id_tasks_id_fk";
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "task_sessions" DROP CONSTRAINT IF EXISTS "task_sessions_task_id_tasks_id_fk";
ALTER TABLE "task_sessions" ADD CONSTRAINT "task_sessions_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "task_workflow_runs" DROP CONSTRAINT IF EXISTS "task_workflow_runs_task_id_tasks_id_fk";
ALTER TABLE "task_workflow_runs" ADD CONSTRAINT "task_workflow_runs_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "role_aggregate_conclusions" DROP CONSTRAINT IF EXISTS "role_aggregate_conclusions_task_id_tasks_id_fk";
ALTER TABLE "role_aggregate_conclusions" ADD CONSTRAINT "role_aggregate_conclusions_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "developer_change_requests" DROP CONSTRAINT IF EXISTS "developer_change_requests_task_id_tasks_id_fk";
ALTER TABLE "developer_change_requests" ADD CONSTRAINT "developer_change_requests_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "task_operating_modes" DROP CONSTRAINT IF EXISTS "task_operating_modes_task_id_tasks_id_fk";
ALTER TABLE "task_operating_modes" ADD CONSTRAINT "task_operating_modes_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "boss_decisions" DROP CONSTRAINT IF EXISTS "boss_decisions_task_id_tasks_id_fk";
ALTER TABLE "boss_decisions" ADD CONSTRAINT "boss_decisions_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "human_escalations" DROP CONSTRAINT IF EXISTS "human_escalations_task_id_tasks_id_fk";
ALTER TABLE "human_escalations" ADD CONSTRAINT "human_escalations_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "runtime_usage_ledgers" DROP CONSTRAINT IF EXISTS "runtime_usage_ledgers_task_id_tasks_id_fk";
ALTER TABLE "runtime_usage_ledgers" ADD CONSTRAINT "runtime_usage_ledgers_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "runtime_usage_ledger_steps" DROP CONSTRAINT IF EXISTS "runtime_usage_ledger_steps_task_id_tasks_id_fk";
ALTER TABLE "runtime_usage_ledger_steps" ADD CONSTRAINT "runtime_usage_ledger_steps_task_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."project_tree_nodes"("id") ON DELETE no action ON UPDATE no action;