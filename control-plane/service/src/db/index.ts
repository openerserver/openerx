import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { resolveDatabaseConfig } from "./config";
import { openPostgresDatabase } from "./postgres-client";
import * as schema from "./schema";
import { openSqliteDatabase } from "./sqlite-client";

const database = resolveDatabaseConfig();

export const dbDialect = database.dialect;
const sqliteRuntime = database.dialect === "sqlite" ? openSqliteDatabase() : null;
const postgresRuntime = database.dialect === "postgres" ? openPostgresDatabase() : null;

export const db: BunSQLiteDatabase<typeof schema> =
  database.dialect === "postgres"
    ? (() => {
        if (!postgresRuntime) {
          throw new Error("PostgreSQL runtime was not initialized");
        }

        return drizzlePostgres(postgresRuntime.sql, { schema }) as unknown as BunSQLiteDatabase<
          typeof schema
        >;
      })()
    : (() => {
        if (!sqliteRuntime) {
          throw new Error("SQLite runtime was not initialized");
        }

        return drizzleSqlite(sqliteRuntime.sqlite, { schema });
      })();

export const sqlite = sqliteRuntime?.sqlite ?? null;
export const postgresSql = (postgresRuntime?.sql ?? null) as Sql | null;

export async function closeDatabase() {
  if (sqliteRuntime) {
    sqliteRuntime.sqlite.close();
  }

  if (postgresRuntime) {
    await postgresRuntime.sql.end();
  }
}

export type DB = typeof db;
