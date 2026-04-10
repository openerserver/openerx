import { openPostgresDatabase } from "./postgres-client";
import { ensurePostgresMigrations } from "./postgres-migrations";

const { databaseUrl: DATABASE_URL, sql } = openPostgresDatabase({
  logPrefix: "[db:migrate:pg]",
});

console.log(`Running PostgreSQL migrations against ${DATABASE_URL}...`);
await ensurePostgresMigrations(sql, { logPrefix: "[db:migrate:pg]" });
console.log("PostgreSQL migrations applied successfully!");

await sql.end();
