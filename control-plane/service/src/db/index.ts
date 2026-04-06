import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { openPostgresDatabase } from "./postgres-client";
import {
  ensurePostgresRuntimeTables,
  type PostgresRuntimeBootstrapSummary,
} from "./postgres-runtime-bootstrap";
import * as schema from "./schema";

const DEFAULT_RUNTIME_DB_MAX = 10;

function resolveRuntimeDbMax() {
  const rawValue = process.env.CONTROL_PLANE_DB_MAX_CONNECTIONS;
  if (!rawValue) {
    return DEFAULT_RUNTIME_DB_MAX;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return DEFAULT_RUNTIME_DB_MAX;
  }

  return Math.floor(parsedValue);
}

const postgresRuntime = openPostgresDatabase({ max: resolveRuntimeDbMax() });

function logRuntimeBootstrapSummary(summary: PostgresRuntimeBootstrapSummary) {
  console.log(
    [
      "[db:bootstrap:pg]",
      `durationMs=${summary.durationMs}`,
      `catalogReads=${summary.catalogReadCount}`,
      `tablesCreated=${summary.tablesCreated}`,
      `indexesCreated=${summary.indexesCreated}`,
      `columnsAdded=${summary.columnsAdded}`,
      `foreignKeysDropped=${summary.foreignKeysDropped}`,
      `foreignKeysAdded=${summary.foreignKeysAdded}`,
    ].join(" "),
  );
}

const runtimeBootstrapSummary = await ensurePostgresRuntimeTables(postgresRuntime.sql);
logRuntimeBootstrapSummary(runtimeBootstrapSummary);

export const dbDialect = "postgres" as const;
export const db = drizzlePostgres(postgresRuntime.sql, { schema });
export const postgresSql = postgresRuntime.sql as Sql;

export async function closeDatabase() {
  await postgresRuntime.sql.end();
}

export type DB = typeof db;
