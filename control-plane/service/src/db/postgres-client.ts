import postgres from "postgres";
import { resolvePostgresDatabaseUrl } from "./config";

interface OpenPostgresDatabaseOptions {
  logPrefix?: string;
  max?: number;
}

export function openPostgresDatabase(options: OpenPostgresDatabaseOptions = {}) {
  const databaseUrl = resolvePostgresDatabaseUrl();
  const { logPrefix = "[db:postgres]", max = 1 } = options;

  console.log(`${logPrefix} using ${databaseUrl}`);

  const sql = postgres(databaseUrl, {
    max,
    prepare: false,
  });

  return {
    databaseUrl,
    sql,
  };
}
