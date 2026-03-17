import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_APP_URL = process.env.TEST_APP_URL;

export function resolveBffUrl() {
  return process.env.TEST_BFF_URL || TEST_APP_URL || "http://127.0.0.1:4098";
}

export function resolveControlPlaneUrl() {
  return process.env.TEST_CP_URL || TEST_APP_URL || "http://127.0.0.1:4097";
}

export function resolveServiceUrl() {
  return (
    process.env.TEST_SERVICE_URL ||
    TEST_APP_URL ||
    process.env.TEST_CP_URL ||
    "http://127.0.0.1:4097"
  );
}

function resolveDatabaseDialect() {
  const explicit = process.env.TEST_DATABASE_DIALECT || process.env.DATABASE_DIALECT;
  if (explicit === "postgres" || explicit === "sqlite") {
    return explicit;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  return databaseUrl && /^(postgres|postgresql):\/\//i.test(databaseUrl) ? "postgres" : "sqlite";
}

function resolveDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgres://127.0.0.1:5432/openerx"
  );
}

function resolveSqliteDbPath() {
  return (
    process.env.TEST_DB_PATH || resolve(__dirname, "../../control-plane/service/data/openerx.db")
  );
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeSqlValue(value: string) {
  return value.replace(/'/g, "''");
}

export function buildDeleteStatements(tableName: string, ids: string[]) {
  return ids
    .filter(isNonEmptyId)
    .map((id) => `DELETE FROM ${tableName} WHERE id='${escapeSqlValue(id)}';`);
}

export function buildTaskCleanupStatements(taskIds: string[]) {
  return taskIds.filter(isNonEmptyId).flatMap((taskId) => {
    const id = escapeSqlValue(taskId);
    return [
      `DELETE FROM runtime_usage_ledger_steps WHERE task_id='${id}' OR agent_run_id IN (SELECT id FROM agent_runs WHERE task_id='${id}');`,
      `DELETE FROM runtime_usage_ledgers WHERE task_id='${id}' OR agent_run_id IN (SELECT id FROM agent_runs WHERE task_id='${id}');`,
      `DELETE FROM file_changes WHERE change_id IN (SELECT id FROM code_changes WHERE task_id='${id}');`,
      `DELETE FROM code_changes WHERE task_id='${id}';`,
      `DELETE FROM task_stage_runs WHERE workflow_run_id IN (SELECT id FROM task_workflow_runs WHERE task_id='${id}');`,
      `DELETE FROM task_workflow_runs WHERE task_id='${id}';`,
      `DELETE FROM project_task_relations WHERE source_task_id='${id}' OR target_task_id='${id}';`,
      `DELETE FROM task_edges WHERE task_id='${id}';`,
      `DELETE FROM task_nodes WHERE task_id='${id}';`,
      `DELETE FROM task_sessions WHERE task_id='${id}';`,
      `DELETE FROM role_aggregate_conclusions WHERE task_id='${id}';`,
      `DELETE FROM developer_change_requests WHERE task_id='${id}';`,
      `DELETE FROM approval_tickets WHERE task_id='${id}';`,
      `DELETE FROM task_operating_modes WHERE task_id='${id}';`,
      `DELETE FROM boss_decisions WHERE task_id='${id}';`,
      `DELETE FROM human_escalations WHERE task_id='${id}';`,
      `DELETE FROM agent_runs WHERE task_id='${id}';`,
      `DELETE FROM tasks WHERE id='${id}';`,
    ];
  });
}

export async function runCleanupStatements(statements: string[], label: string) {
  if (statements.length === 0) {
    return;
  }

  try {
    if (resolveDatabaseDialect() === "postgres") {
      await Bun.$`psql ${resolveDatabaseUrl()} -v ON_ERROR_STOP=1 -c ${statements.join(" ")}`;
      return;
    }

    await Bun.$`sqlite3 ${resolveSqliteDbPath()} ${statements.join(" ")}`;
  } catch {
    console.warn(`Cleanup failed for ${label}`);
  }
}
