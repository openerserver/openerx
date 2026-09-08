import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These integration tests create and migrate on-disk SQLite databases.
    // Windows hosted runners spend several seconds in durable filesystem I/O.
    testTimeout: 30_000,
    maxWorkers: process.env.CI ? 2 : undefined,
  },
});
