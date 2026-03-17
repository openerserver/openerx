import { Database } from "bun:sqlite";
import { resolveSqliteDatabaseUrl } from "./config";
import { ensureRuntimeTables } from "./runtime-schema";
import { configureSqliteConnection } from "./sqlite-config";

type OpenSqliteDatabaseOptions = {
  logPrefix?: string;
  ensureRuntimeCompatibility?: boolean;
};

export function openSqliteDatabase(options: OpenSqliteDatabaseOptions = {}) {
  const databaseUrl = resolveSqliteDatabaseUrl();
  const sqlite = new Database(databaseUrl, { create: true });

  configureSqliteConnection(sqlite, {
    databaseUrl,
    logPrefix: options.logPrefix,
  });

  if (options.ensureRuntimeCompatibility !== false) {
    ensureRuntimeTables(sqlite);
  }

  return {
    databaseUrl,
    sqlite,
  };
}
