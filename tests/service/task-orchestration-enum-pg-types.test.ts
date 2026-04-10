import { afterAll, expect, test } from "bun:test";
import postgres from "../../control-plane/service/node_modules/postgres";

const rawDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(rawDatabaseUrl)
  ? rawDatabaseUrl
  : "postgres://127.0.0.1:5432/openerx";
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

afterAll(async () => {
  await sql.end();
});

test("core task orchestration status columns use PostgreSQL enums", async () => {
  const rows = await sql.unsafe<
    Array<{
      tableName: string;
      columnName: string;
      dataType: string;
      udtName: string;
    }>
  >(
    `SELECT
      table_name AS "tableName",
      column_name AS "columnName",
      data_type AS "dataType",
      udt_name AS "udtName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'task_execution_phases' AND column_name IN ('phase_kind', 'trigger_type', 'status', 'terminal_reason')) OR
        (table_name = 'task_sessions' AND column_name IN ('status')) OR
        (table_name = 'task_session_runs' AND column_name IN ('trigger_type', 'execution_kind', 'lane_role', 'status')) OR
        (table_name = 'task_messages' AND column_name IN ('role', 'message_kind', 'status')) OR
        (table_name = 'task_message_parts' AND column_name IN ('part_type')) OR
        (table_name = 'task_operations' AND column_name IN ('operation_kind', 'status')) OR
        (table_name = 'task_snapshots' AND column_name IN ('lifecycle_status', 'current_execution_mode', 'current_execution_status'))
      )
    ORDER BY table_name ASC, ordinal_position ASC`,
  );

  expect(rows).toEqual([
    {
      tableName: "task_execution_phases",
      columnName: "phase_kind",
      dataType: "USER-DEFINED",
      udtName: "task_execution_phase_kind",
    },
    {
      tableName: "task_execution_phases",
      columnName: "trigger_type",
      dataType: "USER-DEFINED",
      udtName: "task_execution_phase_trigger_type",
    },
    {
      tableName: "task_execution_phases",
      columnName: "status",
      dataType: "USER-DEFINED",
      udtName: "task_execution_phase_status",
    },
    {
      tableName: "task_execution_phases",
      columnName: "terminal_reason",
      dataType: "USER-DEFINED",
      udtName: "task_execution_phase_terminal_reason",
    },
    {
      tableName: "task_message_parts",
      columnName: "part_type",
      dataType: "USER-DEFINED",
      udtName: "task_session_message_part_type",
    },
    {
      tableName: "task_messages",
      columnName: "role",
      dataType: "USER-DEFINED",
      udtName: "task_session_message_role",
    },
    {
      tableName: "task_messages",
      columnName: "message_kind",
      dataType: "USER-DEFINED",
      udtName: "task_message_kind",
    },
    {
      tableName: "task_messages",
      columnName: "status",
      dataType: "USER-DEFINED",
      udtName: "task_message_status",
    },
    {
      tableName: "task_operations",
      columnName: "operation_kind",
      dataType: "USER-DEFINED",
      udtName: "task_operation_kind",
    },
    {
      tableName: "task_operations",
      columnName: "status",
      dataType: "USER-DEFINED",
      udtName: "task_session_node_status",
    },
    {
      tableName: "task_session_runs",
      columnName: "trigger_type",
      dataType: "USER-DEFINED",
      udtName: "task_session_run_trigger_type",
    },
    {
      tableName: "task_session_runs",
      columnName: "execution_kind",
      dataType: "USER-DEFINED",
      udtName: "task_session_run_execution_kind",
    },
    {
      tableName: "task_session_runs",
      columnName: "lane_role",
      dataType: "USER-DEFINED",
      udtName: "task_session_run_lane_role",
    },
    {
      tableName: "task_session_runs",
      columnName: "status",
      dataType: "USER-DEFINED",
      udtName: "task_session_node_status",
    },
    {
      tableName: "task_sessions",
      columnName: "status",
      dataType: "USER-DEFINED",
      udtName: "task_session_node_status",
    },
    {
      tableName: "task_snapshots",
      columnName: "lifecycle_status",
      dataType: "USER-DEFINED",
      udtName: "task_lifecycle_status",
    },
    {
      tableName: "task_snapshots",
      columnName: "current_execution_mode",
      dataType: "USER-DEFINED",
      udtName: "task_session_mode",
    },
    {
      tableName: "task_snapshots",
      columnName: "current_execution_status",
      dataType: "USER-DEFINED",
      udtName: "execution_status",
    },
  ]);
});