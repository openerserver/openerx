import type { Database } from "bun:sqlite";

function hasColumn(sqlite: Database, tableName: string, columnName: string) {
  const rows = sqlite.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(sqlite: Database, tableName: string, columnName: string, columnDefinition: string) {
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
  `);

  ensureColumn(sqlite, "role_agents", "allowed_stages_json", `text NOT NULL DEFAULT '["implement"]'`);
  ensureColumn(sqlite, "role_agent_bindings", "project_id", "text REFERENCES projects(id)");
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_role_agent_bindings_role_project_key
      ON role_agent_bindings(role_agent_id, COALESCE(project_id, ''), binding_key);
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_role_agent_project_overrides_role_project
      ON role_agent_project_overrides(role_agent_id, project_id);
  `);
}
