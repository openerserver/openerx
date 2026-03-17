import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DatabaseDialect = "postgres";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");

export function resolveDatabaseDialect(
  databaseDialect = process.env.DATABASE_DIALECT || process.env.TEST_DATABASE_DIALECT,
  databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL,
): DatabaseDialect {
  if (!databaseDialect || databaseDialect === "postgres") {
    if (databaseUrl && !/^(postgres|postgresql):\/\//i.test(databaseUrl)) {
      throw new Error(
        `DATABASE_URL must be a PostgreSQL URL. Received: ${databaseUrl}. SQLite runtime support has been removed; use the offline migration scripts under src/db/migration to export old SQLite snapshots.`,
      );
    }

    return "postgres";
  }

  throw new Error(
    `Unsupported DATABASE_DIALECT: ${databaseDialect}. PostgreSQL is now the only supported runtime database. Use the offline SQLite migration scripts to move historical snapshots.`,
  );
}

export function resolveDatabaseUrl(
  databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL,
) {
  if (!databaseUrl) {
    return "postgres://127.0.0.1:5432/openerx";
  }

  if (/^(postgres|postgresql):\/\//i.test(databaseUrl)) {
    return databaseUrl;
  }

  if (isAbsolute(databaseUrl)) {
    throw new Error(
      `Absolute SQLite path ${databaseUrl} is no longer supported for runtime startup. Provide a PostgreSQL DATABASE_URL instead.`,
    );
  }

  const resolvedPath = resolve(SERVICE_ROOT, databaseUrl);
  throw new Error(
    `Resolved DATABASE_URL ${resolvedPath} is not a PostgreSQL URL. Runtime SQLite support has been removed.`,
  );
}

export function resolveDatabaseConfig() {
  const url = resolveDatabaseUrl();
  const dialect = resolveDatabaseDialect(process.env.DATABASE_DIALECT, url);

  return {
    dialect,
    url,
  };
}

export function resolvePostgresDatabaseUrl() {
  const config = resolveDatabaseConfig();

  return config.url;
}
