import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(MIGRATION_DIR, "../../..");

export const BAD_TIMESTAMP_LITERAL = "(datetime('now'))";
export const DEFAULT_SQLITE_SNAPSHOT_PATH = resolve(SERVICE_ROOT, "data/openerx.db");
export const DEFAULT_WORK_DIR = resolve(SERVICE_ROOT, "../../tmp/sqlite-pg-migration");

export interface TableManifest {
  name: string;
  columns: string[];
  rowCount: number;
  primaryKeyColumn: string | null;
  fileName: string;
}

export interface SnapshotManifest {
  kind: "sqlite-export" | "normalized-export" | "validation-report";
  generatedAt: string;
  sourceDatabasePath?: string;
  sourceDir?: string;
  outputDir?: string;
  tables: TableManifest[];
  warnings?: Record<string, string[]>;
  stats?: Record<string, unknown>;
}

export interface ForeignKeyValidationRule {
  table: string;
  column: string;
  targetTable: string;
  targetColumn?: string;
}

export const JSONB_COLUMN_NAMES = new Set([
  "settings",
  "strategy_json",
  "changes_summary_json",
  "changes_summary",
  "payload",
  "raw_payload",
  "json_payload",
  "rules",
  "detail",
  "request_detail",
  "metadata",
  "capabilities",
  "allowed_stages_json",
  "tags_json",
  "stage_order_json",
  "default_roles_json",
  "participant_role_agent_ids_json",
  "role_execution_policies_json",
  "entry_criteria_json",
  "exit_criteria_json",
  "initial_task_definition_json",
  "hooks_json",
  "gates_json",
  "approvals_json",
  "stage_template_strategy_json",
  "failure_policy_json",
  "artifacts_summary_json",
  "merged_findings_json",
  "minority_findings_json",
  "conflicts_json",
  "approval_recommendation_json",
  "required_changes_json",
  "related_finding_keys_json",
  "metadata_json",
]);

export const BOOLEAN_COLUMN_NAMES = new Set([
  "requires_approval",
  "must_change_password",
  "is_default",
  "enabled",
  "require_consensus",
  "requires_approval_for_write",
  "selectable_by_projects",
  "force_boss_participation",
  "auto_advance_stages",
  "blocking",
  "approval_required",
  "is_active",
]);

export const PRIMARY_KEY_COLUMN_BY_TABLE: Record<string, string> = {
  workbench_layouts: "user_id",
  task_operating_modes: "task_id",
  task_snapshots: "task_id",
};

export const IMPORT_ORDER = [
  "organizations",
  "users",
  "projects",
  "project_tree_nodes",
  "project_tree_branches",
  "project_tree_links",
  "environments",
  "project_roles",
  "repositories",
  "repository_credentials",
  "tasks",
  "task_runs",
  "conversation_sessions",
  "conversation_messages",
  "conversation_message_parts",
  "task_domain_events",
  "task_snapshots",
  "task_timeline_views",
  "policy_templates",
  "budget_configs",
  "project_model_funds",
  "project_model_fund_ledger",
  "task_run_nodes",
  "task_run_edges",
  "code_changes",
  "file_changes",
  "approval_tickets",
  "audit_events",
  "cost_records",
  "plugins",
  "workbench_layouts",
  "role_agents",
  "role_agent_bindings",
  "role_agent_project_overrides",
  "workflow_templates",
  "workflow_template_stages",
  "task_workflow_runs",
  "task_stage_runs",
  "role_aggregate_conclusions",
  "developer_change_requests",
  "task_operating_modes",
  "boss_decisions",
  "human_escalations",
  "paid_execution_leases",
  "runtime_usage_ledgers",
  "runtime_usage_ledger_steps",
  "runtime_usage_baselines",
];

export const KEY_FOREIGN_KEYS: ForeignKeyValidationRule[] = [
  { table: "projects", column: "org_id", targetTable: "organizations" },
  { table: "project_tree_nodes", column: "project_id", targetTable: "projects" },
  { table: "project_tree_nodes", column: "parent_id", targetTable: "project_tree_nodes" },
  { table: "project_tree_nodes", column: "superseded_by", targetTable: "project_tree_nodes" },
  { table: "project_tree_branches", column: "project_id", targetTable: "projects" },
  { table: "project_tree_branches", column: "task_node_id", targetTable: "project_tree_nodes" },
  { table: "project_tree_branches", column: "head_node_id", targetTable: "project_tree_nodes" },
  { table: "project_tree_links", column: "source_node_id", targetTable: "project_tree_nodes" },
  { table: "project_tree_links", column: "source_project_id", targetTable: "projects" },
  { table: "project_tree_links", column: "target_node_id", targetTable: "project_tree_nodes" },
  { table: "project_tree_links", column: "target_project_id", targetTable: "projects" },
  { table: "environments", column: "project_id", targetTable: "projects" },
  { table: "project_roles", column: "user_id", targetTable: "users" },
  { table: "project_roles", column: "project_id", targetTable: "projects" },
  { table: "repositories", column: "project_id", targetTable: "projects" },
  { table: "repository_credentials", column: "project_id", targetTable: "projects" },
  { table: "repository_credentials", column: "repo_id", targetTable: "repositories" },
  { table: "tasks", column: "project_id", targetTable: "projects" },
  { table: "tasks", column: "tree_node_id", targetTable: "project_tree_nodes" },
  { table: "tasks", column: "created_by_user_id", targetTable: "users" },
  { table: "tasks", column: "repo_id", targetTable: "repositories" },
  { table: "tasks", column: "credential_id", targetTable: "repository_credentials" },
  { table: "task_runs", column: "task_id", targetTable: "tasks" },
  { table: "task_runs", column: "project_id", targetTable: "projects" },
  { table: "task_run_nodes", column: "run_id", targetTable: "task_runs" },
  { table: "task_run_nodes", column: "task_id", targetTable: "tasks" },
  { table: "task_run_nodes", column: "project_id", targetTable: "projects" },
  { table: "task_run_edges", column: "run_id", targetTable: "task_runs" },
  { table: "task_run_edges", column: "task_id", targetTable: "tasks" },
  { table: "task_run_edges", column: "from_node_id", targetTable: "task_run_nodes" },
  { table: "task_run_edges", column: "to_node_id", targetTable: "task_run_nodes" },
  { table: "conversation_sessions", column: "project_id", targetTable: "projects" },
  { table: "conversation_sessions", column: "task_id", targetTable: "tasks" },
  { table: "conversation_sessions", column: "run_id", targetTable: "task_runs" },
  { table: "conversation_sessions", column: "run_node_id", targetTable: "task_run_nodes" },
  { table: "conversation_sessions", column: "tree_node_id", targetTable: "project_tree_nodes" },
  { table: "conversation_messages", column: "session_id", targetTable: "conversation_sessions" },
  { table: "conversation_messages", column: "task_id", targetTable: "tasks" },
  { table: "conversation_messages", column: "run_id", targetTable: "task_runs" },
  { table: "conversation_messages", column: "run_node_id", targetTable: "task_run_nodes" },
  { table: "conversation_messages", column: "project_id", targetTable: "projects" },
  {
    table: "conversation_message_parts",
    column: "message_id",
    targetTable: "conversation_messages",
  },
  { table: "task_domain_events", column: "project_id", targetTable: "projects" },
  { table: "task_domain_events", column: "task_id", targetTable: "tasks" },
  { table: "task_domain_events", column: "run_id", targetTable: "task_runs" },
  { table: "task_domain_events", column: "run_node_id", targetTable: "task_run_nodes" },
  { table: "task_domain_events", column: "session_id", targetTable: "conversation_sessions" },
  { table: "task_sessions", column: "task_id", targetTable: "tasks" },
  { table: "task_sessions", column: "project_id", targetTable: "projects" },
  { table: "task_sessions", column: "tree_node_id", targetTable: "project_tree_nodes" },
  { table: "task_sessions", column: "parent_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "root_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "phase_id", targetTable: "task_execution_phases" },
  { table: "task_sessions", column: "winner_session_id", targetTable: "task_sessions" },
  { table: "task_sessions", column: "judge_session_id", targetTable: "task_sessions" },
  { table: "task_session_runs", column: "task_id", targetTable: "tasks" },
  { table: "task_session_runs", column: "session_id", targetTable: "task_sessions" },
  { table: "task_session_runs", column: "phase_id", targetTable: "task_execution_phases" },
  { table: "task_snapshots", column: "task_id", targetTable: "tasks" },
  { table: "task_snapshots", column: "project_id", targetTable: "projects" },
  { table: "task_snapshots", column: "current_phase_id", targetTable: "task_execution_phases" },
  { table: "task_snapshots", column: "latest_phase_id", targetTable: "task_execution_phases" },
  { table: "task_snapshots", column: "current_session_id", targetTable: "task_sessions" },
  { table: "task_snapshots", column: "latest_session_id", targetTable: "task_sessions" },
  { table: "task_timeline_views", column: "project_id", targetTable: "projects" },
  { table: "task_timeline_views", column: "task_id", targetTable: "tasks" },
  { table: "task_timeline_views", column: "phase_id", targetTable: "task_execution_phases" },
  { table: "task_timeline_views", column: "session_id", targetTable: "task_sessions" },
  { table: "task_timeline_views", column: "message_id", targetTable: "task_messages" },
  { table: "task_timeline_views", column: "operation_id", targetTable: "task_operations" },
  { table: "task_timeline_views", column: "artifact_id", targetTable: "task_artifacts" },
  { table: "code_changes", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "code_changes", column: "repo_id", targetTable: "repositories" },
  { table: "file_changes", column: "change_id", targetTable: "code_changes" },
  { table: "budget_configs", column: "project_id", targetTable: "projects" },
  { table: "project_model_funds", column: "project_id", targetTable: "projects" },
  { table: "project_model_fund_ledger", column: "project_id", targetTable: "projects" },
  {
    table: "project_model_fund_ledger",
    column: "fund_id",
    targetTable: "project_model_funds",
  },
  { table: "policy_templates", column: "project_id", targetTable: "projects" },
  { table: "cost_records", column: "project_id", targetTable: "projects" },
  { table: "workbench_layouts", column: "user_id", targetTable: "users" },
  { table: "role_agents", column: "project_id", targetTable: "projects" },
  { table: "workflow_template_stages", column: "template_id", targetTable: "workflow_templates" },
  { table: "task_workflow_runs", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "task_stage_runs", column: "workflow_run_id", targetTable: "task_workflow_runs" },
  { table: "role_agent_bindings", column: "role_agent_id", targetTable: "role_agents" },
  { table: "role_agent_bindings", column: "project_id", targetTable: "projects" },
  { table: "role_agent_project_overrides", column: "role_agent_id", targetTable: "role_agents" },
  { table: "role_agent_project_overrides", column: "project_id", targetTable: "projects" },
  { table: "role_aggregate_conclusions", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "developer_change_requests", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "task_operating_modes", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "boss_decisions", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "human_escalations", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "paid_execution_leases", column: "project_id", targetTable: "projects" },
  { table: "paid_execution_leases", column: "issued_by_user_id", targetTable: "users" },
  { table: "paid_execution_leases", column: "revoked_by_user_id", targetTable: "users" },
  { table: "runtime_usage_ledgers", column: "project_id", targetTable: "projects" },
  { table: "runtime_usage_ledgers", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "runtime_usage_ledgers", column: "run_id", targetTable: "task_runs" },
  { table: "runtime_usage_ledgers", column: "run_node_id", targetTable: "task_run_nodes" },
  {
    table: "runtime_usage_ledger_steps",
    column: "ledger_id",
    targetTable: "runtime_usage_ledgers",
  },
  { table: "runtime_usage_ledger_steps", column: "project_id", targetTable: "projects" },
  { table: "runtime_usage_ledger_steps", column: "task_id", targetTable: "project_tree_nodes" },
  { table: "runtime_usage_ledger_steps", column: "run_id", targetTable: "task_runs" },
  { table: "runtime_usage_ledger_steps", column: "run_node_id", targetTable: "task_run_nodes" },
  { table: "runtime_usage_baselines", column: "project_id", targetTable: "projects" },
];

export const SAMPLE_TABLES = [
  "organizations",
  "projects",
  "users",
  "project_tree_nodes",
  "workflow_templates",
  "role_agents",
  "runtime_usage_ledgers",
];

export const LEGACY_OFFLINE_SOURCE_TABLES = new Set(["sessions", "task_sessions"]);

export const RETIRED_SQLITE_SOURCE_TABLES = new Set([
  "agent_runs",
  "project_task_relations",
  "task_edges",
  "task_nodes",
]);

export function nowIso() {
  return new Date().toISOString();
}

export function resolveInputPath(inputPath: string) {
  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
}

export async function ensureDir(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const normalized = token.slice(2);
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex >= 0) {
      parsed[normalized.slice(0, equalsIndex)] = normalized.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[normalized] = next;
      index += 1;
      continue;
    }

    parsed[normalized] = true;
  }

  return parsed;
}

export function getStringArg(
  args: Record<string, string | boolean>,
  key: string,
  defaultValue?: string,
) {
  const value = args[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing required --${key} argument.`);
}

export function getBooleanArg(
  args: Record<string, string | boolean>,
  key: string,
  defaultValue = false,
) {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return !["0", "false", "no"].includes(value.toLowerCase());
  }

  return defaultValue;
}

export function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function getPrimaryKeyColumn(tableName: string) {
  return PRIMARY_KEY_COLUMN_BY_TABLE[tableName] ?? "id";
}

export function getOrderedTables(tableNames: string[]) {
  const remaining = new Set(tableNames);
  const ordered: string[] = [];

  for (const tableName of IMPORT_ORDER) {
    if (remaining.delete(tableName)) {
      ordered.push(tableName);
    }
  }

  return [...ordered, ...[...remaining].sort()];
}

export function isTimestampColumn(columnName: string) {
  return columnName === "ts" || columnName.endsWith("_at");
}

export function normalizeBooleanValue(value: unknown) {
  if (value === null || value === undefined || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no"].includes(normalized)) {
      return false;
    }
  }

  return value;
}

export async function readJsonLines<T>(filePath: string) {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonLines(filePath: string, rows: unknown[]) {
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
}
