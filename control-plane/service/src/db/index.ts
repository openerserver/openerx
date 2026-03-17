import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { ensureRuntimeTables } from "./runtime-schema";
import * as schema from "./schema";
import { configureSqliteConnection, resolveDatabaseUrl } from "./sqlite-config";

const DATABASE_URL = resolveDatabaseUrl();
const sqlite = new Database(DATABASE_URL, { create: true });
configureSqliteConnection(sqlite, { databaseUrl: DATABASE_URL });

ensureRuntimeTables(sqlite);

export const db = drizzle(sqlite, { schema });
export { sqlite };
export type DB = typeof db;
