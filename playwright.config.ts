import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_UI_PORT || 4173);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`,
    headless: true,
  },
  webServer: {
    command: `cd control-plane/web-ui && bun run dev --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  reporter: "list",
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});