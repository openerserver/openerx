import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRuntimeTables } from "./runtime-schema";
import * as schema from "./schema";

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(DB_DIR, "../..");
const DATABASE_URL = process.env.DATABASE_URL
	? isAbsolute(process.env.DATABASE_URL)
		? process.env.DATABASE_URL
		: resolve(SERVICE_ROOT, process.env.DATABASE_URL)
	: resolve(SERVICE_ROOT, "data/openerx.db");
const sqlite = new Database(DATABASE_URL, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

ensureRuntimeTables(sqlite);

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
