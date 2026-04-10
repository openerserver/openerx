import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Sql } from "postgres";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");
const POSTGRES_MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle-pg");
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const POSTGRES_MIGRATION_LOCK_KEY = 88411230041;

type MigrationRecord = {
  created_at: number | string;
};

type MigrationFile = {
  folderMillis: number;
  hash: string;
  sql: string[];
};

export type PostgresMigrationSummary = {
  appliedCount: number;
  latestAppliedMillis: number | null;
  durationMs: number;
};

async function ensureMigrationTable(sql: Sql) {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function getLastAppliedMigrationMillis(sql: Sql) {
  const rows = await sql.unsafe<MigrationRecord[]>(`
    SELECT created_at
    FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const latestRow = rows[0] ?? null;
  if (!latestRow) {
    return null;
  }

  return Number(latestRow.created_at);
}

async function applyPendingMigrations(sql: Sql, logPrefix: string) {
  const migrations = readMigrationFiles({
    migrationsFolder: POSTGRES_MIGRATIONS_FOLDER,
  }) as MigrationFile[];

  let appliedCount = 0;
  let lastAppliedMillis = await getLastAppliedMigrationMillis(sql);

  for (const migration of migrations) {
    if (lastAppliedMillis != null && lastAppliedMillis >= migration.folderMillis) {
      continue;
    }

    console.log(`${logPrefix} applying migration ${migration.folderMillis}`);

    await sql.begin(async (tx) => {
      for (const statement of migration.sql) {
        const trimmedStatement = statement.trim();
        if (trimmedStatement.length === 0) {
          continue;
        }

        await tx.unsafe(statement);
      }

      await tx.unsafe(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
    });

    appliedCount += 1;
    lastAppliedMillis = migration.folderMillis;
  }

  return {
    appliedCount,
    latestAppliedMillis: lastAppliedMillis,
  };
}

async function withMigrationLock<T>(sql: Sql, callback: () => Promise<T>) {
  await sql.unsafe(`SELECT pg_advisory_lock($1::bigint)`, [POSTGRES_MIGRATION_LOCK_KEY]);

  try {
    return await callback();
  } finally {
    await sql.unsafe(`SELECT pg_advisory_unlock($1::bigint)`, [POSTGRES_MIGRATION_LOCK_KEY]);
  }
}

export async function ensurePostgresMigrations(
  sql: Sql,
  options: {
    logPrefix?: string;
  } = {},
): Promise<PostgresMigrationSummary> {
  const startedAt = Date.now();
  const logPrefix = options.logPrefix ?? "[db:migrate:pg]";

  return withMigrationLock(sql, async () => {
    await ensureMigrationTable(sql);
    const result = await applyPendingMigrations(sql, logPrefix);

    return {
      appliedCount: result.appliedCount,
      latestAppliedMillis: result.latestAppliedMillis,
      durationMs: Date.now() - startedAt,
    };
  });
}