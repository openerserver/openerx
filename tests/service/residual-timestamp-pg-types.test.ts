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

test("residual PG timestamp columns use timestamptz", async () => {
  const rows = await sql.unsafe<Array<{ tableName: string; columnName: string; dataType: string }>>(
    `SELECT
      table_name AS "tableName",
      column_name AS "columnName",
      data_type AS "dataType"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'audit_events' AND column_name IN ('ts')) OR
        (table_name = 'cost_records' AND column_name IN ('ts')) OR
        (table_name = 'role_agents' AND column_name IN ('created_at', 'updated_at')) OR
        (table_name = 'role_agent_bindings' AND column_name IN ('created_at', 'updated_at')) OR
        (table_name = 'role_agent_project_overrides' AND column_name IN ('created_at', 'updated_at')) OR
        (table_name = 'task_message_parts' AND column_name IN ('created_at')) OR
        (table_name = 'task_operating_modes' AND column_name IN ('created_at', 'updated_at')) OR
        (table_name = 'workbench_layouts' AND column_name IN ('updated_at')) OR
        (table_name = 'workflow_templates' AND column_name IN ('created_at', 'updated_at'))
      )
    ORDER BY table_name ASC, column_name ASC`,
  );

  expect(rows).toEqual([
    { tableName: "audit_events", columnName: "ts", dataType: "timestamp with time zone" },
    { tableName: "cost_records", columnName: "ts", dataType: "timestamp with time zone" },
    {
      tableName: "role_agent_bindings",
      columnName: "created_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "role_agent_bindings",
      columnName: "updated_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "role_agent_project_overrides",
      columnName: "created_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "role_agent_project_overrides",
      columnName: "updated_at",
      dataType: "timestamp with time zone",
    },
    { tableName: "role_agents", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "role_agents", columnName: "updated_at", dataType: "timestamp with time zone" },
    {
      tableName: "task_message_parts",
      columnName: "created_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "task_operating_modes",
      columnName: "created_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "task_operating_modes",
      columnName: "updated_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "workbench_layouts",
      columnName: "updated_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "workflow_templates",
      columnName: "created_at",
      dataType: "timestamp with time zone",
    },
    {
      tableName: "workflow_templates",
      columnName: "updated_at",
      dataType: "timestamp with time zone",
    },
  ]);
});