import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRuntimeTables } from "./runtime-schema";
import { configureSqliteConnection, resolveDatabaseUrl } from "./sqlite-config";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");
const DATABASE_URL = resolveDatabaseUrl();
const MIGRATIONS_FOLDER = resolve(SERVICE_ROOT, "drizzle");

const sqlite = new Database(DATABASE_URL, { create: true });
configureSqliteConnection(sqlite, {
	databaseUrl: DATABASE_URL,
	logPrefix: "[db:migrate]",
});

const db = drizzle(sqlite);

console.log(`Running migrations against ${DATABASE_URL}...`);
try {
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	console.log("Migrations applied successfully!");
} catch (error) {
	console.warn("Migrations encountered an existing-schema conflict; ensuring runtime tables instead.");
	console.warn(error instanceof Error ? error.message : String(error));
}

ensureRuntimeTables(sqlite);
console.log("Runtime compatibility tables ensured.");

sqlite.close();
