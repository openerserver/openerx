import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { openPostgresDatabase } from "../postgres-client";

const MIGRATION_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(MIGRATION_DIR, "../../..");
const POSTGRES_MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle-pg");
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const MIGRATION_MILLIS = {
  taskMessageFkCutover: 1775001240000,
  taskMessagesReconcileLegacy: 1775001300000,
  dropLegacyTaskSessionMessageTables: 1775001360000,
  addOperationId: 1775001420000,
  taskOperationFkCutover: 1775001480000,
  dropAgentRuns: 1775001540000,
  canonicalSchemaFinalization: 1775001600000,
} as const;

type MigrationFile = {
  folderMillis: number;
  hash: string;
  sql: string[];
};

const { databaseUrl, sql } = openPostgresDatabase({
  logPrefix: "[db:reconcile:migration-state]",
});

async function ensureMigrationTable() {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function getAppliedMigrationMillisSet() {
  const rows = await sql.unsafe<Array<{ created_at: number | string }>>(`
    SELECT created_at
    FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
  `);

  return new Set(rows.map((row) => Number(row.created_at)));
}

function getMigrationByMillis(migrations: MigrationFile[], folderMillis: number) {
  const migration = migrations.find((entry) => entry.folderMillis === folderMillis);
  if (!migration) {
    throw new Error(`Missing migration metadata for ${folderMillis}`);
  }
  return migration;
}

async function insertMigrationRecord(migration: MigrationFile) {
  await sql.unsafe(
    `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`,
    [migration.hash, migration.folderMillis],
  );
}

async function isMigrationRecorded(folderMillis: number) {
  const rows = await sql.unsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS(
      SELECT 1
      FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
      WHERE created_at = $1
    ) AS exists`,
    [folderMillis],
  );

  return rows[0]?.exists === true;
}

async function ensureMigrationRecorded(migration: MigrationFile, reason: string) {
  if (await isMigrationRecorded(migration.folderMillis)) {
    console.log(
      `[db:reconcile:migration-state] migration ${migration.folderMillis} already recorded`,
    );
    return;
  }

  await insertMigrationRecord(migration);
  console.log(
    `[db:reconcile:migration-state] recorded migration ${migration.folderMillis}: ${reason}`,
  );
}

async function tableExists(tableName: string) {
  const rows = await sql.unsafe<Array<{ regclass: string | null }>>(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
  );
  return rows[0]?.regclass != null;
}

async function columnExists(tableName: string, columnName: string) {
  const rows = await sql.unsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS exists`,
    [tableName, columnName],
  );
  return rows[0]?.exists === true;
}

async function indexExists(indexName: string) {
  const rows = await sql.unsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS(
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = $1
    ) AS exists`,
    [indexName],
  );
  return rows[0]?.exists === true;
}

async function constraintExists(constraintName: string) {
  const rows = await sql.unsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS(
      SELECT 1
      FROM pg_constraint
      WHERE conname = $1
    ) AS exists`,
    [constraintName],
  );
  return rows[0]?.exists === true;
}

async function countRows(tableName: string) {
  const rows = await sql.unsafe<Array<{ count: number | string }>>(
    `SELECT count(*)::bigint AS count FROM "${tableName}"`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function countTasksWithoutSnapshots() {
  const rows = await sql.unsafe<Array<{ count: number | string }>>(`
    SELECT count(*)::bigint AS count
    FROM tasks AS task
    LEFT JOIN task_snapshots AS snapshot
      ON snapshot.task_id = task.id
    WHERE snapshot.task_id IS NULL
  `);
  return Number(rows[0]?.count ?? 0);
}

async function ensureLegacyTaskSnapshotsBackfilled() {
  const hasLegacyStatus = await columnExists("tasks", "status");
  const hasLegacyCurrentSessionId = await columnExists("tasks", "current_session_id");
  const hasLegacyLatestResult = await columnExists("tasks", "latest_result");
  const hasLegacyLatestResultSummary = await columnExists("tasks", "latest_result_summary");
  const hasLegacyStartedAt = await columnExists("tasks", "started_at");
  const hasLegacyFinishedAt = await columnExists("tasks", "finished_at");

  const tasksWithoutSnapshots = await countTasksWithoutSnapshots();
  if (tasksWithoutSnapshots === 0) {
    return;
  }

  const lifecycleStatusExpr = hasLegacyStatus
    ? `COALESCE(
        task.lifecycle_status,
        CASE
          WHEN task.status = 'completed' THEN 'done'::task_lifecycle_status
          WHEN task.status = 'cancelled' THEN 'archived'::task_lifecycle_status
          WHEN task.status IS NULL OR task.status = 'pending' THEN 'draft'::task_lifecycle_status
          ELSE 'active'::task_lifecycle_status
        END
      )`
    : `COALESCE(task.lifecycle_status, 'draft'::task_lifecycle_status)`;
  const currentExecutionStatusExpr = hasLegacyStatus
    ? `CASE
        WHEN task.status = 'awaiting_adoption' THEN 'awaiting_adoption'::execution_status
        WHEN task.status = 'completed' THEN 'complete'::execution_status
        WHEN task.status = 'failed' THEN 'failed'::execution_status
        WHEN task.status = 'cancelled' THEN 'cancelled'::execution_status
        WHEN task.status IS NULL OR task.status = 'pending' THEN NULL
        ELSE 'running'::execution_status
      END`
    : `NULL::execution_status`;
  const resolvedLegacySessionIdExpr = hasLegacyCurrentSessionId
    ? `COALESCE(
        (
          SELECT exact.id
          FROM task_sessions AS exact
          WHERE exact.id = task.current_session_id
          LIMIT 1
        ),
        (
          SELECT runtime.id
          FROM task_sessions AS runtime
          WHERE runtime.task_id = task.id
            AND runtime.runtime_session_id = task.current_session_id
          LIMIT 1
        ),
        (
          SELECT alias.id
          FROM task_sessions AS alias
          WHERE alias.id = replace(task.current_session_id, 'task_session:', 'task-session:')
          LIMIT 1
        )
      )`
    : `NULL`;
  const currentSessionIdExpr = resolvedLegacySessionIdExpr;
  const latestSessionIdExpr = resolvedLegacySessionIdExpr;
  const latestResultSummaryExpr =
    hasLegacyLatestResultSummary && hasLegacyLatestResult
      ? `COALESCE(task.latest_result_summary, task.latest_result)`
      : hasLegacyLatestResultSummary
        ? `task.latest_result_summary`
        : hasLegacyLatestResult
          ? `task.latest_result`
          : `NULL`;
  const lastActivityExpr =
    hasLegacyFinishedAt && hasLegacyStartedAt
      ? `COALESCE(task.finished_at::text, task.started_at::text, task.updated_at::text, task.created_at::text, CURRENT_TIMESTAMP::text)`
      : hasLegacyFinishedAt
        ? `COALESCE(task.finished_at::text, task.updated_at::text, task.created_at::text, CURRENT_TIMESTAMP::text)`
        : hasLegacyStartedAt
          ? `COALESCE(task.started_at::text, task.updated_at::text, task.created_at::text, CURRENT_TIMESTAMP::text)`
          : `COALESCE(task.updated_at::text, task.created_at::text, CURRENT_TIMESTAMP::text)`;

  await sql.unsafe(`
    INSERT INTO task_snapshots (
      task_id,
      project_id,
      lifecycle_status,
      current_execution_mode,
      current_execution_status,
      current_session_id,
      latest_session_id,
      latest_result_summary,
      latest_error_text,
      active_candidate_count,
      total_chain_steps,
      completed_chain_steps,
      last_activity_at,
      updated_at
    )
    SELECT
      task.id,
      task.project_id,
      ${lifecycleStatusExpr},
      NULL,
      ${currentExecutionStatusExpr},
      ${currentSessionIdExpr},
      ${latestSessionIdExpr},
      ${latestResultSummaryExpr},
      NULL,
      0,
      0,
      0,
      ${lastActivityExpr},
      COALESCE(task.updated_at::text, task.created_at::text, CURRENT_TIMESTAMP::text)
    FROM tasks AS task
    LEFT JOIN task_snapshots AS snapshot
      ON snapshot.task_id = task.id
    WHERE snapshot.task_id IS NULL
  `);

  const remainingTasksWithoutSnapshots = await countTasksWithoutSnapshots();
  if (remainingTasksWithoutSnapshots !== 0) {
    throw new Error(
      `Snapshot backfill incomplete: ${remainingTasksWithoutSnapshots} tasks still missing task_snapshots rows`,
    );
  }

  console.log(
    `[db:reconcile:migration-state] backfilled ${tasksWithoutSnapshots} legacy task snapshots`,
  );
}

async function ensureSessionOperationsDropped() {
  if (!(await tableExists("session_operations"))) {
    return;
  }

  const rowCount = await countRows("session_operations");
  if (rowCount !== 0) {
    throw new Error(
      `session_operations still contains ${rowCount} rows; refusing to auto-drop before manual review`,
    );
  }

  await sql.unsafe(`DROP TABLE IF EXISTS "session_operations"`);
  console.log("[db:reconcile:migration-state] dropped empty session_operations table");
}

async function ensureAgentRunsDropped() {
  if (!(await tableExists("agent_runs"))) {
    return;
  }

  await sql.unsafe(`DROP TABLE IF EXISTS "agent_runs" CASCADE`);
  console.log("[db:reconcile:migration-state] dropped agent_runs table");
}

async function ensureLegacyTaskColumnsDropped() {
  await sql.unsafe(`DROP INDEX IF EXISTS "idx_tasks_current_run_id"`);
  await sql.unsafe(`DROP INDEX IF EXISTS "idx_tasks_current_session_id"`);
  await sql.unsafe(`DROP INDEX IF EXISTS "idx_tasks_project_status_created_at"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "status"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "current_run_id"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "current_session_id"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "current_agent_run_id"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "latest_result"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "latest_result_summary"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "selected_model"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "started_at"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "finished_at"`);
  await sql.unsafe(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "changes_summary_json"`);
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS "idx_task_messages_user_input"
      ON "task_messages" ("session_id", "role")
      WHERE "user_input_text" IS NOT NULL
  `);
  console.log("[db:reconcile:migration-state] removed legacy task columns and ensured prompt index");
}

async function reconcileMissingMigrationRecords(migrations: MigrationFile[]) {
  const messageFkConstraints = [
    "task_artifacts_message_id_task_messages_id_fk",
    "task_usage_ledger_entries_message_id_task_messages_id_fk",
    "task_timeline_views_message_id_task_messages_id_fk",
  ];
  const operationFkConstraints = [
    "task_artifacts_operation_id_task_operations_id_fk",
    "task_usage_ledger_entries_operation_id_task_operations_id_fk",
    "task_timeline_views_operation_id_task_operations_id_fk",
  ];

  if (
    (await Promise.all(messageFkConstraints.map((name) => constraintExists(name)))).every(Boolean)
  ) {
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.taskMessageFkCutover),
      "task message foreign keys already point at task_messages",
    );
  }

  const legacyMessageTablesAbsent =
    !(await tableExists("task_session_messages")) &&
    !(await tableExists("task_session_message_parts"));

  if (legacyMessageTablesAbsent) {
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.taskMessagesReconcileLegacy),
      "legacy task_session_messages tables are already gone locally",
    );
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.dropLegacyTaskSessionMessageTables),
      "legacy task_session_messages tables already dropped",
    );
  }

  const hasOperationIdColumns =
    (await columnExists("task_sessions", "operation_id")) &&
    (await columnExists("task_session_runs", "operation_id"));
  if (hasOperationIdColumns) {
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.addOperationId),
      "operation_id columns already exist on task_sessions and task_session_runs",
    );
  }

  if (
    (await Promise.all(operationFkConstraints.map((name) => constraintExists(name)))).every(Boolean)
  ) {
    await ensureSessionOperationsDropped();
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.taskOperationFkCutover),
      "task operation foreign keys already point at task_operations",
    );
  }

  await ensureAgentRunsDropped();
  if (!(await tableExists("agent_runs"))) {
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.dropAgentRuns),
      "agent_runs table already removed",
    );
  }

  await ensureLegacyTaskSnapshotsBackfilled();
  await ensureLegacyTaskColumnsDropped();

  const legacyTaskColumns = [
    "status",
    "current_run_id",
    "current_session_id",
    "current_agent_run_id",
    "latest_result",
    "latest_result_summary",
    "selected_model",
    "started_at",
    "finished_at",
    "changes_summary_json",
  ];
  const legacyColumnsStillPresent = await Promise.all(
    legacyTaskColumns.map((columnName) => columnExists("tasks", columnName)),
  );
  const promptIndexReady = await indexExists("idx_task_messages_user_input");
  if (!legacyColumnsStillPresent.some(Boolean) && promptIndexReady) {
    await ensureMigrationRecorded(
      getMigrationByMillis(migrations, MIGRATION_MILLIS.canonicalSchemaFinalization),
      "legacy tasks columns removed and prompt visibility index present",
    );
  }
}

async function main() {
  console.log(
    `[db:reconcile:migration-state] reconciling PostgreSQL migration state against ${databaseUrl}`,
  );

  await ensureMigrationTable();

  const migrations = readMigrationFiles({
    migrationsFolder: POSTGRES_MIGRATIONS_FOLDER,
  }) as MigrationFile[];

  await reconcileMissingMigrationRecords(migrations);

  const appliedMigrationMillis = await getAppliedMigrationMillisSet();
  const lastAppliedMigrationMillis = Math.max(...appliedMigrationMillis);

  console.log(
    `[db:reconcile:migration-state] reconcile complete; latest recorded migration=${lastAppliedMigrationMillis}`,
  );
}

try {
  await main();
} finally {
  await sql.end();
}