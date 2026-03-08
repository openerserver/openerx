import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const DATABASE_URL = process.env.DATABASE_URL || "./data/openerx.db";

const sqlite = new Database(DATABASE_URL, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const db = drizzle(sqlite);

console.log("Running migrations...");
migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied successfully!");

sqlite.close();
