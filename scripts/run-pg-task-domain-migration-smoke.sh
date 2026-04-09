#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BASE_DATABASE_URL=${TEST_DATABASE_URL:-${DATABASE_URL:-postgres://127.0.0.1:5432/openerx}}
SMOKE_SUFFIX=${SMOKE_SUFFIX:-$(date +%s)}

DB_PARTS=$(
  bun -e '
    const baseUrl = new URL(process.argv[1]);
    const tempDbName = `openerx_task_domain_smoke_${process.pid}_${process.argv[2]}`;
    const tempUrl = new URL(baseUrl.toString());
    tempUrl.pathname = `/${tempDbName}`;
    process.stdout.write(`${baseUrl.hostname}\n`);
    process.stdout.write(`${baseUrl.port || "5432"}\n`);
    process.stdout.write(`${decodeURIComponent(baseUrl.username || "")}\n`);
    process.stdout.write(`${decodeURIComponent(baseUrl.password || "")}\n`);
    process.stdout.write(`${tempDbName}\n`);
    process.stdout.write(`${tempUrl.toString()}\n`);
  ' "$BASE_DATABASE_URL" "$SMOKE_SUFFIX"
)

DB_HOST=$(printf '%s\n' "$DB_PARTS" | sed -n '1p')
DB_PORT=$(printf '%s\n' "$DB_PARTS" | sed -n '2p')
DB_USER=$(printf '%s\n' "$DB_PARTS" | sed -n '3p')
DB_PASSWORD=$(printf '%s\n' "$DB_PARTS" | sed -n '4p')
SMOKE_DB_NAME=$(printf '%s\n' "$DB_PARTS" | sed -n '5p')
SMOKE_DATABASE_URL=$(printf '%s\n' "$DB_PARTS" | sed -n '6p')

export PGPASSWORD="$DB_PASSWORD"

createdb_args=(--host "$DB_HOST" --port "$DB_PORT")
dropdb_args=(--if-exists --host "$DB_HOST" --port "$DB_PORT")
if [[ -n "$DB_USER" ]]; then
  createdb_args+=(--username "$DB_USER")
  dropdb_args+=(--username "$DB_USER")
fi

created=false

cleanup() {
  if [[ "$created" == "true" ]]; then
    dropdb "${dropdb_args[@]}" "$SMOKE_DB_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[pg-smoke] creating temporary database $SMOKE_DB_NAME"
createdb "${createdb_args[@]}" "$SMOKE_DB_NAME"
created=true

echo "[pg-smoke] running PostgreSQL migrations"
(
  cd "$ROOT_DIR/control-plane/service"
  DATABASE_DIALECT=postgres DATABASE_URL="$SMOKE_DATABASE_URL" bun run db:migrate
)

echo "[pg-smoke] validating task-domain schema objects"
psql "$SMOKE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  missing_table_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_table_count
  FROM (
    VALUES
      ('tasks'),
      ('task_execution_phases'),
      ('task_sessions'),
      ('task_session_runs'),
      ('task_messages'),
      ('task_message_parts'),
      ('task_operations'),
      ('task_snapshots'),
      ('task_timeline_views')
  ) AS expected(table_name)
  WHERE to_regclass(format('public.%s', expected.table_name)) IS NULL;

  IF missing_table_count <> 0 THEN
    RAISE EXCEPTION 'Missing expected task-domain canonical tables: %', missing_table_count;
  END IF;
END $$;

DO $$
DECLARE
  bridge_column_count integer;
BEGIN
  SELECT COUNT(*) INTO bridge_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'runtime_usage_ledgers' AND column_name IN ('task_id', 'runtime_session_id')) OR
      (table_name = 'runtime_usage_ledger_steps' AND column_name IN ('task_id', 'run_id', 'run_node_id')) OR
      (table_name = 'project_tree_nodes' AND column_name IN ('runtime_session_id', 'branch_name'))
    );

  IF bridge_column_count <> 7 THEN
    RAISE EXCEPTION 'Expected 7 bridge columns, found %', bridge_column_count;
  END IF;
END $$;

DO $$
DECLARE
  missing_index_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_index_count
  FROM (
    VALUES
      ('idx_tasks_project_created_at'),
      ('idx_task_execution_phases_task_created_at'),
      ('idx_task_sessions_task_created_at'),
      ('idx_task_session_runs_task_phase_created_at'),
      ('idx_task_snapshots_project_lifecycle_execution_activity'),
      ('idx_task_timeline_views_task_sort_at')
  ) AS expected(index_name)
  LEFT JOIN pg_indexes indexes
    ON indexes.schemaname = 'public'
   AND indexes.indexname = expected.index_name
  WHERE indexes.indexname IS NULL;

  IF missing_index_count <> 0 THEN
    RAISE EXCEPTION 'Missing expected task-domain indexes: %', missing_index_count;
  END IF;
END $$;
SQL

echo "[pg-smoke] task-domain PostgreSQL migration smoke passed"