import { execSync } from "node:child_process";

function escapeSqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function resolvePostgresTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgres://127.0.0.1:5432/openerx";
}

export function runPostgresCleanupStatements(statements: string[], label: string) {
  if (statements.length === 0) {
    return;
  }

  try {
    execSync(
      `psql "${resolvePostgresTestDatabaseUrl()}" -v ON_ERROR_STOP=1 -c "${statements.join(" ")}"`,
      {
        timeout: 5000,
      },
    );
  } catch {
    console.warn(`Cleanup failed for ${label}`);
  }
}

export type DbCleanupExecutor = (query: string, params: unknown[]) => Promise<void> | void;

export function buildDeleteByIdsStatements(table: string, ids: string[], column = "id") {
  return ids.map((id) => `DELETE FROM ${table} WHERE ${column}=${escapeSqlLiteral(id)};`);
}

export function buildDeleteByTaskIdsStatements(table: string, taskIds: string[]) {
  return buildDeleteByIdsStatements(table, taskIds, "task_id");
}

export async function runDeleteByIds(
  execute: DbCleanupExecutor,
  table: string,
  ids: string[],
  column = "id",
) {
  for (const id of ids) {
    await execute(`DELETE FROM ${table} WHERE ${column} = ?1`, [id]);
  }
}

export async function runDeleteByTaskIds(
  execute: DbCleanupExecutor,
  table: string,
  taskIds: string[],
) {
  await runDeleteByIds(execute, table, taskIds, "task_id");
}

export function buildTaskProjectionCleanupStatements(taskIds: string[]) {
  return [
    ...buildDeleteByTaskIdsStatements("task_timeline_views", taskIds),
    ...buildDeleteByTaskIdsStatements("task_snapshots", taskIds),
    ...buildDeleteByTaskIdsStatements("task_domain_events", taskIds),
  ];
}

export async function runTaskProjectionCleanup(execute: DbCleanupExecutor, taskIds: string[]) {
  await runDeleteByTaskIds(execute, "task_timeline_views", taskIds);
  await runDeleteByTaskIds(execute, "task_snapshots", taskIds);
  await runDeleteByTaskIds(execute, "task_domain_events", taskIds);
}

export function buildTaskNodeDefensiveCleanupStatements(taskIds: string[]) {
  return [
    ...buildDeleteByIdsStatements("tasks", taskIds, "tree_node_id"),
    ...taskIds.map((id) => {
      const literalId = escapeSqlLiteral(id);
      return `DELETE FROM project_tree_branches WHERE task_node_id=${literalId} OR head_node_id=${literalId};`;
    }),
    ...buildDeleteByIdsStatements("project_tree_nodes", taskIds),
  ];
}

export async function runTaskNodeDefensiveCleanup(execute: DbCleanupExecutor, taskIds: string[]) {
  await runDeleteByIds(execute, "tasks", taskIds, "tree_node_id");

  for (const id of taskIds) {
    await execute("DELETE FROM project_tree_branches WHERE task_node_id = ? OR head_node_id = ?", [
      id,
      id,
    ]);
  }

  await runDeleteByIds(execute, "project_tree_nodes", taskIds);
}

export const POSTGRES_TASK_TREE_TEARDOWN_TEMPLATE = `const taskCleanupStatements = [
  ...buildTaskProjectionCleanupStatements(createdTaskIds),
  ...buildDeleteByIdsStatements("tasks", createdTaskIds),
  ...buildTaskNodeDefensiveCleanupStatements(createdTaskIds),
];`;
