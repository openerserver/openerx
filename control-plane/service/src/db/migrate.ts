import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { resolveDatabaseConfig } from "./config";
import { openPostgresDatabase } from "./postgres-client";
import { ensureRuntimeTables } from "./runtime-schema";
import { openSqliteDatabase } from "./sqlite-client";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");
const SQLITE_MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle");
const POSTGRES_MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle-pg");

const database = resolveDatabaseConfig();

if (database.dialect === "sqlite") {
  const { databaseUrl: DATABASE_URL, sqlite } = openSqliteDatabase({
    logPrefix: "[db:migrate]",
    ensureRuntimeCompatibility: false,
  });

  const db = drizzle(sqlite);

  console.log(`Running migrations against ${DATABASE_URL}...`);
  try {
    migrate(db, { migrationsFolder: SQLITE_MIGRATIONS_FOLDER });
    console.log("Migrations applied successfully!");
  } catch (error) {
    console.warn(
      "Migrations encountered an existing-schema conflict; ensuring runtime tables instead.",
    );
    console.warn(error instanceof Error ? error.message : String(error));
  }

  // Runtime compatibility tables remain on the migration path until all SQLite bootstrap
  // behavior is moved into formal migrations.
  ensureRuntimeTables(sqlite);
  console.log("Runtime compatibility tables ensured.");

  sqlite.close();
} else {
  const { databaseUrl: DATABASE_URL, sql } = openPostgresDatabase({
    logPrefix: "[db:migrate:pg]",
  });
  const db = drizzlePostgres(sql);

  console.log(`Running PostgreSQL migrations against ${DATABASE_URL}...`);
  await migratePostgres(db, { migrationsFolder: POSTGRES_MIGRATIONS_FOLDER });
  console.log("PostgreSQL migrations applied successfully!");

  await sql.end();
}
