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

test("foundation metadata PG columns use timestamptz", async () => {
  const rows = await sql.unsafe<Array<{ tableName: string; columnName: string; dataType: string }>>(
    `SELECT
      table_name AS "tableName",
      column_name AS "columnName",
      data_type AS "dataType"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'organizations' AND column_name IN ('created_at')) OR
        (table_name = 'projects' AND column_name IN ('created_at', 'updated_at')) OR
        (table_name = 'environments' AND column_name IN ('created_at')) OR
        (table_name = 'budget_configs' AND column_name IN ('created_at')) OR
        (table_name = 'code_changes' AND column_name IN ('created_at')) OR
        (table_name = 'plugins' AND column_name IN ('last_verified_at', 'created_at', 'updated_at')) OR
        (table_name = 'policy_templates' AND column_name IN ('created_at'))
      )
    ORDER BY table_name ASC, column_name ASC`,
  );

  expect(rows).toEqual([
    { tableName: "budget_configs", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "code_changes", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "environments", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "organizations", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "plugins", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "plugins", columnName: "last_verified_at", dataType: "timestamp with time zone" },
    { tableName: "plugins", columnName: "updated_at", dataType: "timestamp with time zone" },
    { tableName: "policy_templates", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "projects", columnName: "created_at", dataType: "timestamp with time zone" },
    { tableName: "projects", columnName: "updated_at", dataType: "timestamp with time zone" },
  ]);
});