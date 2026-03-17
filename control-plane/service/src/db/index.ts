import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { openPostgresDatabase } from "./postgres-client";
import * as schema from "./schema";

const postgresRuntime = openPostgresDatabase();

export const dbDialect = "postgres" as const;
export const db = drizzlePostgres(postgresRuntime.sql, { schema });
export const postgresSql = postgresRuntime.sql as Sql;

export async function closeDatabase() {
  await postgresRuntime.sql.end();
}

export type DB = typeof db;
