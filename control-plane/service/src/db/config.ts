import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DatabaseDialect = "sqlite" | "postgres";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");

function inferDatabaseDialectFromUrl(databaseUrl?: string): DatabaseDialect {
  if (!databaseUrl) {
    return "sqlite";
  }

  return /^(postgres|postgresql):\/\//i.test(databaseUrl) ? "postgres" : "sqlite";
}

export function resolveDatabaseDialect(
  databaseDialect = process.env.DATABASE_DIALECT,
  databaseUrl = process.env.DATABASE_URL,
): DatabaseDialect {
  if (!databaseDialect) {
    return inferDatabaseDialectFromUrl(databaseUrl);
  }

  if (databaseDialect === "sqlite" || databaseDialect === "postgres") {
    return databaseDialect;
  }

  throw new Error(
    `Unsupported DATABASE_DIALECT: ${databaseDialect}. Expected \"sqlite\" or \"postgres\".`,
  );
}

export function resolveDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  const dialect = resolveDatabaseDialect(process.env.DATABASE_DIALECT, databaseUrl);

  if (!databaseUrl) {
    return dialect === "postgres"
      ? "postgres://127.0.0.1:5432/openerx"
      : resolve(SERVICE_ROOT, "data/openerx.db");
  }

  if (dialect === "postgres") {
    return databaseUrl;
  }

  return isAbsolute(databaseUrl) ? databaseUrl : resolve(SERVICE_ROOT, databaseUrl);
}

export function resolveDatabaseConfig() {
  const url = resolveDatabaseUrl();
  const dialect = resolveDatabaseDialect(process.env.DATABASE_DIALECT, url);

  return {
    dialect,
    url,
  };
}

export function resolveSqliteDatabaseUrl() {
  const config = resolveDatabaseConfig();

  if (config.dialect !== "sqlite") {
    throw new Error(
      `DATABASE_DIALECT=${config.dialect} is not supported by the current SQLite bootstrap path. PostgreSQL wiring must be completed before switching the runtime dialect.`,
    );
  }

  return config.url;
}

export function resolvePostgresDatabaseUrl() {
  const config = resolveDatabaseConfig();

  if (config.dialect !== "postgres") {
    throw new Error(
      `DATABASE_DIALECT=${config.dialect} is not supported by the PostgreSQL bootstrap path.`,
    );
  }

  return config.url;
}
