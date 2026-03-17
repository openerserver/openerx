import type { Database } from "bun:sqlite";

function hasColumn(sqlite: Database, tableName: string, columnName: string) {
  const rows = sqlite.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(
  sqlite: Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  if (!hasColumn(sqlite, tableName, columnName)) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

export function ensureRuntimeTables(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL REFERENCES tasks(id),
      runtime_session_id text NOT NULL,
      parent_runtime_session_id text,
      forked_from_message_id text,
      branch_name text,
      source_type text NOT NULL DEFAULT 'root',
      is_active integer NOT NULL DEFAULT false,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at text
    );

    CREATE TABLE IF NOT EXISTS workbench_layouts (
      user_id text PRIMARY KEY NOT NULL REFERENCES users(id),
      layout_json text NOT NULL DEFAULT '{}',
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_agents (
      id text PRIMARY KEY NOT NULL,
      project_id text REFERENCES projects(id),
      name text NOT NULL,
      description text,
      scope text NOT NULL DEFAULT 'system',
      status text NOT NULL DEFAULT 'active',
      owner_team text,
      permission_profile text NOT NULL,
      tool_profile text NOT NULL,
      default_execution_mode text NOT NULL DEFAULT 'single',
      aggregation_strategy text,
      max_active_bindings integer,
      require_consensus integer NOT NULL DEFAULT false,
      risk_level text NOT NULL DEFAULT 'low',
      requires_approval_for_write integer NOT NULL DEFAULT false,
      allowed_stages_json text NOT NULL DEFAULT '["implement"]',
      output_schema_id text,
      tags_json text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_agent_bindings (
      id text PRIMARY KEY NOT NULL,
      role_agent_id text NOT NULL REFERENCES role_agents(id),
      project_id text REFERENCES projects(id),
      binding_key text NOT NULL,
      runtime_agent text NOT NULL,
      label text NOT NULL,
      enabled integer NOT NULL DEFAULT true,
      priority integer NOT NULL DEFAULT 1,
      model text,
      tags_json text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_agent_project_overrides (
      id text PRIMARY KEY NOT NULL,
      role_agent_id text NOT NULL REFERENCES role_agents(id),
      project_id text NOT NULL REFERENCES projects(id),
      name text,
      description text,
      status text,
      owner_team text,
      permission_profile text,
      tool_profile text,
      default_execution_mode text,
      aggregation_strategy text,
      max_active_bindings integer,
      require_consensus integer,
      risk_level text,
      requires_approval_for_write integer,
      allowed_stages_json text,
      output_schema_id text,
      tags_json text,
      bindings_mode text NOT NULL DEFAULT 'inherit',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_templates (
      id text PRIMARY KEY NOT NULL,
      project_id text REFERENCES projects(id),
      name text NOT NULL,
      description text,
      category text,
      enabled integer NOT NULL DEFAULT true,
      selectable_by_projects integer NOT NULL DEFAULT true,
      default_collaboration_mode text,
      default_autopilot_level text,
      default_boss_participation_mode text,
      force_boss_participation integer NOT NULL DEFAULT false,
      stage_order_json text NOT NULL,
      default_roles_json text,
      version integer NOT NULL DEFAULT 1,
      created_by text,
      updated_by text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_template_stages (
      id text PRIMARY KEY NOT NULL,
      template_id text NOT NULL REFERENCES workflow_templates(id),
      stage_key text NOT NULL,
      name text NOT NULL,
      enabled integer NOT NULL DEFAULT true,
      mode text NOT NULL DEFAULT 'single',
      primary_role_agent_id text NOT NULL,
      participant_role_agent_ids_json text NOT NULL,
      role_execution_policies_json text,
      entry_criteria_json text,
      exit_criteria_json text,
      hooks_json text,
      gates_json text,
      approvals_json text,
      stage_template_strategy_json text,
      failure_policy_json text,
      order_index integer NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_workflow_runs (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL REFERENCES tasks(id),
      template_id text NOT NULL,
      current_stage text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      started_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_stage_runs (
      id text PRIMARY KEY NOT NULL,
      workflow_run_id text NOT NULL REFERENCES task_workflow_runs(id),
      stage_key text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      primary_role_agent_id text NOT NULL,
      participant_role_agent_ids_json text,
      started_at text,
      finished_at text,
      blocking_reason text,
      approval_state text NOT NULL DEFAULT 'not-required',
      artifacts_summary_json text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_aggregate_conclusions (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL REFERENCES tasks(id),
      task_stage_run_id text,
      role_agent_id text NOT NULL,
      stage text NOT NULL,
      aggregation_strategy text NOT NULL,
      status text NOT NULL,
      final_decision text NOT NULL,
      aggregate_risk_level text NOT NULL,
      confidence_score real NOT NULL DEFAULT 0,
      consensus_score real NOT NULL DEFAULT 0,
      winning_rationale text NOT NULL,
      merged_findings_json text,
      minority_findings_json text,
      conflicts_json text,
      approval_recommendation_json text,
      generated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS developer_change_requests (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL REFERENCES tasks(id),
      task_stage_run_id text,
      source_role_agent_id text NOT NULL,
      assigned_role_agent_id text NOT NULL DEFAULT 'role.developer',
      priority text NOT NULL,
      title text NOT NULL,
      summary text NOT NULL,
      required_changes_json text NOT NULL,
      related_finding_keys_json text,
      blocking integer NOT NULL DEFAULT false,
      approval_required integer NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'open',
      resolution_note text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at text
    );

    CREATE TABLE IF NOT EXISTS task_operating_modes (
      task_id text PRIMARY KEY NOT NULL REFERENCES tasks(id),
      collaboration_mode text NOT NULL,
      autopilot_level text NOT NULL,
      boss_participation_mode text NOT NULL,
      selected_template_id text,
      scenario_key text,
      source text NOT NULL DEFAULT 'task-override',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS boss_decisions (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL REFERENCES tasks(id),
      ts text NOT NULL,
      decision_type text NOT NULL,
      reason text NOT NULL,
      confidence real,
      stage_key text,
      metadata_json text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS human_escalations (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL REFERENCES tasks(id),
      ts text NOT NULL,
      reason text NOT NULL,
      status text,
      stage_key text,
      requested_by text,
      metadata_json text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_task_relations (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id),
      source_task_id text NOT NULL REFERENCES tasks(id),
      target_task_id text NOT NULL REFERENCES tasks(id),
      relation_type text NOT NULL,
      relation_source text NOT NULL DEFAULT 'manual',
      metadata text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS paid_execution_leases (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id),
      issued_by_user_id text NOT NULL REFERENCES users(id),
      revoked_by_user_id text REFERENCES users(id),
      reason text,
      status text NOT NULL DEFAULT 'active',
      expires_at text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at text
    );

    CREATE INDEX IF NOT EXISTS idx_paid_execution_leases_project_status
      ON paid_execution_leases(project_id, status, expires_at);

    CREATE TABLE IF NOT EXISTS runtime_usage_ledgers (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id),
      task_id text REFERENCES tasks(id),
      agent_run_id text REFERENCES agent_runs(id),
      runtime_session_id text NOT NULL,
      execution_source text NOT NULL,
      entrypoint_type text NOT NULL,
      orchestration_fingerprint text,
      default_provider_id text,
      default_model_id text,
      request_count integer NOT NULL DEFAULT 0,
      step_count integer NOT NULL DEFAULT 0,
      input_tokens integer NOT NULL DEFAULT 0,
      output_tokens integer NOT NULL DEFAULT 0,
      total_tokens integer NOT NULL DEFAULT 0,
      cost_usd real NOT NULL DEFAULT 0,
      candidate_count integer NOT NULL DEFAULT 1,
      judge_request_count integer NOT NULL DEFAULT 0,
      hook_request_count integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'running',
      started_at text,
      finished_at text,
      synced_at text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS runtime_usage_ledger_steps (
      id text PRIMARY KEY NOT NULL,
      ledger_id text NOT NULL REFERENCES runtime_usage_ledgers(id),
      project_id text NOT NULL REFERENCES projects(id),
      task_id text REFERENCES tasks(id),
      agent_run_id text REFERENCES agent_runs(id),
      runtime_session_id text,
      step_type text NOT NULL,
      trigger_type text,
      hook_id text,
      candidate_index integer,
      request_index integer NOT NULL DEFAULT 0,
      provider_id text,
      model_id text,
      input_tokens integer NOT NULL DEFAULT 0,
      output_tokens integer NOT NULL DEFAULT 0,
      total_tokens integer NOT NULL DEFAULT 0,
      cost_usd real NOT NULL DEFAULT 0,
      amplification_source text,
      status text NOT NULL DEFAULT 'completed',
      started_at text,
      finished_at text,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_usage_ledgers_runtime_session
      ON runtime_usage_ledgers(runtime_session_id);

    CREATE INDEX IF NOT EXISTS idx_runtime_usage_ledgers_project_time
      ON runtime_usage_ledgers(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_runtime_usage_ledgers_agent_run
      ON runtime_usage_ledgers(agent_run_id);

    CREATE INDEX IF NOT EXISTS idx_runtime_usage_ledger_steps_ledger_request
      ON runtime_usage_ledger_steps(ledger_id, request_index);

    CREATE INDEX IF NOT EXISTS idx_runtime_usage_ledger_steps_project_time
      ON runtime_usage_ledger_steps(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_runtime_usage_ledger_steps_task_type
      ON runtime_usage_ledger_steps(task_id, step_type, trigger_type);

    CREATE TABLE IF NOT EXISTS runtime_usage_baselines (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id),
      provider_id text NOT NULL DEFAULT '',
      model_id text NOT NULL DEFAULT '',
      entrypoint_type text NOT NULL DEFAULT '',
      orchestration_fingerprint text NOT NULL DEFAULT '',
      match_scope text NOT NULL DEFAULT 'project',
      sample_size integer NOT NULL DEFAULT 0,
      p50_request_count real,
      p90_request_count real,
      p50_input_tokens real,
      p90_input_tokens real,
      p50_output_tokens real,
      p90_output_tokens real,
      p50_total_tokens real,
      p90_total_tokens real,
      p50_cost_usd real,
      p90_cost_usd real,
      last_ledger_at text,
      generated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_usage_baselines_project_scope
      ON runtime_usage_baselines(project_id, provider_id, model_id, entrypoint_type, orchestration_fingerprint, match_scope);

    CREATE INDEX IF NOT EXISTS idx_runtime_usage_baselines_project_generated
      ON runtime_usage_baselines(project_id, generated_at DESC);
  `);

  ensureColumn(
    sqlite,
    "role_agents",
    "allowed_stages_json",
    `text NOT NULL DEFAULT '["implement"]'`,
  );
  ensureColumn(sqlite, "role_agent_bindings", "project_id", "text REFERENCES projects(id)");
  ensureColumn(sqlite, "workflow_templates", "default_collaboration_mode", "text");
  ensureColumn(sqlite, "workflow_templates", "default_autopilot_level", "text");
  ensureColumn(sqlite, "workflow_templates", "default_boss_participation_mode", "text");
  ensureColumn(
    sqlite,
    "workflow_templates",
    "force_boss_participation",
    "integer NOT NULL DEFAULT false",
  );
  ensureColumn(sqlite, "workflow_template_stages", "stage_template_strategy_json", "text");
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_role_agent_bindings_role_project_key
      ON role_agent_bindings(role_agent_id, COALESCE(project_id, ''), binding_key);
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_role_agent_project_overrides_role_project
      ON role_agent_project_overrides(role_agent_id, project_id);
  `);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_boss_decisions_task_ts
      ON boss_decisions(task_id, ts DESC);
  `);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_human_escalations_task_ts
      ON human_escalations(task_id, ts DESC);
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_task_relations_unique_edge
      ON project_task_relations(project_id, source_task_id, target_task_id, relation_type);
  `);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_task_relations_project
      ON project_task_relations(project_id, relation_type);
  `);
}
