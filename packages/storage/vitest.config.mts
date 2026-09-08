import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Preserve real migrations and durable writes; allow for hosted Windows I/O.
    testTimeout: 30_000,
    maxWorkers: process.env.CI ? 2 : undefined,
  },
});
