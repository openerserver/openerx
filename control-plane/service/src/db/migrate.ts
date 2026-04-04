import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { openPostgresDatabase } from "./postgres-client";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");
const POSTGRES_MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle-pg");
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const { databaseUrl: DATABASE_URL, sql } = openPostgresDatabase({
  logPrefix: "[db:migrate:pg]",
});

type MigrationRecord = {
  created_at: number | string;
};

type MigrationFile = {
  folderMillis: number;
  hash: string;
  sql: string[];
};

async function ensureMigrationTable() {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function getLastAppliedMigrationMillis() {
  const rows = await sql.unsafe<MigrationRecord[]>(`
    SELECT created_at
    FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (rows.length === 0) {
    return null;
  }

  const latestRow = rows[0];
  if (!latestRow) {
    return null;
  }

  return Number(latestRow.created_at);
}

async function applyPendingMigrations() {
  const migrations = readMigrationFiles({
    migrationsFolder: POSTGRES_MIGRATIONS_FOLDER,
  }) as MigrationFile[];

  let lastAppliedMillis = await getLastAppliedMigrationMillis();

  for (const migration of migrations) {
    if (lastAppliedMillis != null && lastAppliedMillis >= migration.folderMillis) {
      continue;
    }

    console.log(`[db:migrate:pg] applying migration ${migration.folderMillis}`);

    await sql.begin(async (tx) => {
      for (const statement of migration.sql) {
        const trimmedStatement = statement.trim();
        if (trimmedStatement.length === 0) {
          continue;
        }

        await tx.unsafe(statement);
      }

      await tx.unsafe(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ('${migration.hash}', ${migration.folderMillis})`,
      );
    });

    lastAppliedMillis = migration.folderMillis;
  }
}

console.log(`Running PostgreSQL migrations against ${DATABASE_URL}...`);
// Drizzle wraps all pending PostgreSQL migrations in a single transaction.
// Run each migration file in its own transaction so heavy backfills can commit
// before later deferred-FK DDL executes.
await ensureMigrationTable();
await applyPendingMigrations();
console.log("PostgreSQL migrations applied successfully!");

await sql.end();
