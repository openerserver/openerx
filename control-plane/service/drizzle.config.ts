import { defineConfig } from "drizzle-kit";
import { resolveDatabaseConfig } from "./src/db/config";

const database = resolveDatabaseConfig();

export default defineConfig({
  schema: "./src/db/schema.pg.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  dbCredentials: {
    url: database.url,
  },
});
