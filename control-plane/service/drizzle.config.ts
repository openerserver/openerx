import { defineConfig } from "drizzle-kit";
import { resolveDatabaseConfig } from "./src/db/config";

const database = resolveDatabaseConfig();
const drizzleDialect = database.dialect === "postgres" ? "postgresql" : "sqlite";

export default defineConfig({
  schema: database.dialect === "postgres" ? "./src/db/schema.pg.ts" : "./src/db/schema.sqlite.ts",
  out: database.dialect === "postgres" ? "./drizzle-pg" : "./drizzle",
  dialect: drizzleDialect,
  dbCredentials: {
    url: database.url,
  },
});
