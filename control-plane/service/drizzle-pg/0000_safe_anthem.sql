CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"node_id" text,
	"session_id" text,
	"agent_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model_used" text,
	"token_used" integer DEFAULT 0 NOT NULL,
	"result" text,
	"error" text,
	"candidate_index" integer,
	"started_at" text,
	"finished_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"agent_run_id" text,
	"node_id" text,
	"action_type" text NOT NULL,
	"risk_level" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_detail" jsonb,
	"approver" text,
	"comment" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"resolved_at" text,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"user_id" text,
	"project_id" text,
	"session_id" text,
	"task_id" text,
	"agent_run_id" text,
	"event_type" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb,
	"risk_level" text DEFAULT 'low',
	"trace_id" text,
	"credential_id" text,
	"author_resolved_as" text
);
--> statement-breakpoint
CREATE TABLE "budget_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period" text NOT NULL,
	"limit_amount" double precision NOT NULL,
	"warn_threshold" double precision DEFAULT 0.8 NOT NULL,
	"throttle_threshold" double precision DEFAULT 0.95 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"repo_id" text,
	"agent_run_id" text,
	"change_source" text NOT NULL,
	"commit_sha" text,
	"commit_author_name" text,
	"commit_author_email" text,
	"commit_message" text,
	"branch_name" text,
	"summary" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"session_id" text,
	"task_id" text,
	"agent_run_id" text,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost" double precision NOT NULL,
	"budget_period" text
);
--> statement-breakpoint
CREATE TABLE "developer_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"task_stage_run_id" text,
	"source_role_agent_id" text NOT NULL,
	"assigned_role_agent_id" text DEFAULT 'role.developer' NOT NULL,
	"priority" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"required_changes_json" jsonb NOT NULL,
	"related_finding_keys_json" jsonb,
	"blocking" boolean DEFAULT false NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"file_path" text NOT NULL,
	"change_type" text NOT NULL,
	"old_path" text,
	"insertions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "paid_execution_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"revoked_by_user_id" text,
	"reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"plugin_path" text NOT NULL,
	"version" text,
	"source" text DEFAULT 'local' NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"description" text,
	"capabilities" jsonb,
	"last_verified_at" text,
	"error_detail" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "plugins_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "policy_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"rules" jsonb,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_task_id" text NOT NULL,
	"target_task_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"relation_source" text DEFAULT 'manual' NOT NULL,
	"metadata" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"settings" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"remote_url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repo_id" text,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"credential_type" text NOT NULL,
	"secret_ref" text NOT NULL,
	"git_author_name" text,
	"git_author_email" text,
	"scope" text DEFAULT 'project' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_agent_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"role_agent_id" text NOT NULL,
	"project_id" text,
	"binding_key" text NOT NULL,
	"runtime_agent" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"model" text,
	"tags_json" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_agent_project_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"role_agent_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text,
	"description" text,
	"status" text,
	"owner_team" text,
	"permission_profile" text,
	"tool_profile" text,
	"default_execution_mode" text,
	"aggregation_strategy" text,
	"max_active_bindings" integer,
	"require_consensus" boolean,
	"risk_level" text,
	"requires_approval_for_write" boolean,
	"allowed_stages_json" jsonb,
	"output_schema_id" text,
	"tags_json" jsonb,
	"bindings_mode" text DEFAULT 'inherit' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'system' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_team" text,
	"permission_profile" text NOT NULL,
	"tool_profile" text NOT NULL,
	"default_execution_mode" text DEFAULT 'single' NOT NULL,
	"aggregation_strategy" text,
	"max_active_bindings" integer,
	"require_consensus" boolean DEFAULT false NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"requires_approval_for_write" boolean DEFAULT false NOT NULL,
	"allowed_stages_json" jsonb NOT NULL,
	"output_schema_id" text,
	"tags_json" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_aggregate_conclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"task_stage_run_id" text,
	"role_agent_id" text NOT NULL,
	"stage" text NOT NULL,
	"aggregation_strategy" text NOT NULL,
	"status" text NOT NULL,
	"final_decision" text NOT NULL,
	"aggregate_risk_level" text NOT NULL,
	"confidence_score" double precision DEFAULT 0 NOT NULL,
	"consensus_score" double precision DEFAULT 0 NOT NULL,
	"winning_rationale" text NOT NULL,
	"merged_findings_json" jsonb,
	"minority_findings_json" jsonb,
	"conflicts_json" jsonb,
	"approval_recommendation_json" jsonb,
	"generated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_baselines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider_id" text DEFAULT '' NOT NULL,
	"model_id" text DEFAULT '' NOT NULL,
	"entrypoint_type" text DEFAULT '' NOT NULL,
	"orchestration_fingerprint" text DEFAULT '' NOT NULL,
	"match_scope" text DEFAULT 'project' NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"p50_request_count" double precision,
	"p90_request_count" double precision,
	"p50_input_tokens" double precision,
	"p90_input_tokens" double precision,
	"p50_output_tokens" double precision,
	"p90_output_tokens" double precision,
	"p50_total_tokens" double precision,
	"p90_total_tokens" double precision,
	"p50_cost_usd" double precision,
	"p90_cost_usd" double precision,
	"last_ledger_at" text,
	"generated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_ledger_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"agent_run_id" text,
	"runtime_session_id" text,
	"step_type" text NOT NULL,
	"trigger_type" text,
	"hook_id" text,
	"candidate_index" integer,
	"request_index" integer DEFAULT 0 NOT NULL,
	"provider_id" text,
	"model_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"amplification_source" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"started_at" text,
	"finished_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_ledgers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"agent_run_id" text,
	"runtime_session_id" text NOT NULL,
	"execution_source" text NOT NULL,
	"entrypoint_type" text NOT NULL,
	"orchestration_fingerprint" text,
	"default_provider_id" text,
	"default_model_id" text,
	"request_count" integer DEFAULT 0 NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 1 NOT NULL,
	"judge_request_count" integer DEFAULT 0 NOT NULL,
	"hook_request_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" text,
	"finished_at" text,
	"synced_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"tokens_used" integer DEFAULT 0,
	"cost" double precision DEFAULT 0,
	"model_used" text,
	"agent_used" text,
	"started_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "task_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"graph_id" text NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"edge_type" text DEFAULT 'blocks' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"graph_id" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent_type" text NOT NULL,
	"session_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"output" text,
	"error" text,
	"token_used" integer DEFAULT 0 NOT NULL,
	"started_at" text,
	"finished_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"runtime_session_id" text NOT NULL,
	"parent_runtime_session_id" text,
	"forked_from_message_id" text,
	"branch_name" text,
	"source_type" text DEFAULT 'root' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE "task_stage_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"primary_role_agent_id" text NOT NULL,
	"participant_role_agent_ids_json" jsonb,
	"started_at" text,
	"finished_at" text,
	"blocking_reason" text,
	"approval_state" text DEFAULT 'not-required' NOT NULL,
	"artifacts_summary_json" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"template_id" text NOT NULL,
	"current_stage" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"session_id" text,
	"agent_run_id" text,
	"result" text,
	"category" text,
	"strategy" text,
	"repo_id" text,
	"workspace_root" text,
	"base_revision" text,
	"working_branch" text,
	"selected_model" text,
	"execution_mode" text DEFAULT 'single',
	"execution_plan" text,
	"credential_id" text,
	"git_author_name" text,
	"git_author_email" text,
	"git_committer_name" text,
	"git_committer_email" text,
	"final_commit_sha" text,
	"final_branch_name" text,
	"changes_summary" jsonb,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'developer' NOT NULL,
	"account_status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" text,
	"last_login_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "workbench_layouts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"layout_json" text DEFAULT '{}' NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_template_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'single' NOT NULL,
	"primary_role_agent_id" text NOT NULL,
	"participant_role_agent_ids_json" jsonb NOT NULL,
	"role_execution_policies_json" jsonb,
	"entry_criteria_json" jsonb,
	"exit_criteria_json" jsonb,
	"hooks_json" jsonb,
	"gates_json" jsonb,
	"approvals_json" jsonb,
	"stage_template_strategy_json" jsonb,
	"failure_policy_json" jsonb,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"selectable_by_projects" boolean DEFAULT true NOT NULL,
	"default_collaboration_mode" text,
	"default_autopilot_level" text,
	"default_boss_participation_mode" text,
	"force_boss_participation" boolean DEFAULT false NOT NULL,
	"stage_order_json" jsonb NOT NULL,
	"default_roles_json" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_node_id_task_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."task_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_configs" ADD CONSTRAINT "budget_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_change_requests" ADD CONSTRAINT "developer_change_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_changes" ADD CONSTRAINT "file_changes_change_id_code_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."code_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_execution_leases" ADD CONSTRAINT "paid_execution_leases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_execution_leases" ADD CONSTRAINT "paid_execution_leases_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_execution_leases" ADD CONSTRAINT "paid_execution_leases_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_templates" ADD CONSTRAINT "policy_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_relations" ADD CONSTRAINT "project_task_relations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_relations" ADD CONSTRAINT "project_task_relations_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_relations" ADD CONSTRAINT "project_task_relations_target_task_id_tasks_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_credentials" ADD CONSTRAINT "repository_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_credentials" ADD CONSTRAINT "repository_credentials_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_agent_bindings" ADD CONSTRAINT "role_agent_bindings_role_agent_id_role_agents_id_fk" FOREIGN KEY ("role_agent_id") REFERENCES "public"."role_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_agent_bindings" ADD CONSTRAINT "role_agent_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_agent_project_overrides" ADD CONSTRAINT "role_agent_project_overrides_role_agent_id_role_agents_id_fk" FOREIGN KEY ("role_agent_id") REFERENCES "public"."role_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_agent_project_overrides" ADD CONSTRAINT "role_agent_project_overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_agents" ADD CONSTRAINT "role_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_aggregate_conclusions" ADD CONSTRAINT "role_aggregate_conclusions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_baselines" ADD CONSTRAINT "runtime_usage_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledger_steps" ADD CONSTRAINT "runtime_usage_ledger_steps_ledger_id_runtime_usage_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."runtime_usage_ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledger_steps" ADD CONSTRAINT "runtime_usage_ledger_steps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledger_steps" ADD CONSTRAINT "runtime_usage_ledger_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledger_steps" ADD CONSTRAINT "runtime_usage_ledger_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledgers" ADD CONSTRAINT "runtime_usage_ledgers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledgers" ADD CONSTRAINT "runtime_usage_ledgers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_ledgers" ADD CONSTRAINT "runtime_usage_ledgers_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_edges" ADD CONSTRAINT "task_edges_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_edges" ADD CONSTRAINT "task_edges_from_node_id_task_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."task_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_edges" ADD CONSTRAINT "task_edges_to_node_id_task_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."task_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_nodes" ADD CONSTRAINT "task_nodes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sessions" ADD CONSTRAINT "task_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_stage_runs" ADD CONSTRAINT "task_stage_runs_workflow_run_id_task_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."task_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_runs" ADD CONSTRAINT "task_workflow_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_credential_id_repository_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."repository_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench_layouts" ADD CONSTRAINT "workbench_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_stages" ADD CONSTRAINT "workflow_template_stages_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;