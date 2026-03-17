import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { openPostgresDatabase } from "./postgres-client";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");
const POSTGRES_MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle-pg");

const { databaseUrl: DATABASE_URL, sql } = openPostgresDatabase({
  logPrefix: "[db:migrate:pg]",
});
const db = drizzlePostgres(sql);

console.log(`Running PostgreSQL migrations against ${DATABASE_URL}...`);
await migratePostgres(db, { migrationsFolder: POSTGRES_MIGRATIONS_FOLDER });
console.log("PostgreSQL migrations applied successfully!");

await sql.end();
