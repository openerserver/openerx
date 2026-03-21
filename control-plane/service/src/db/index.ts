import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { openPostgresDatabase } from "./postgres-client";
import * as schema from "./schema";

const postgresRuntime = openPostgresDatabase();

await postgresRuntime.sql`
  ALTER TABLE IF EXISTS "workflow_template_stages"
  ADD COLUMN IF NOT EXISTS "initial_task_definition_json" jsonb
`;

export const dbDialect = "postgres" as const;
export const db = drizzlePostgres(postgresRuntime.sql, { schema });
export const postgresSql = postgresRuntime.sql as Sql;

export async function closeDatabase() {
  await postgresRuntime.sql.end();
}

export type DB = typeof db;
