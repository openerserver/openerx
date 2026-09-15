import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "openerx-development-browser-helper",
      configureServer() {
        // Forge clears .vite before starting this server. Build the fixed-path
        // helper afterwards so development can use it without packaging an app.
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL("./scripts/build-macos-browser-helper.mjs", import.meta.url))],
          { stdio: "inherit" },
        );
      },
    },
  ],
  optimizeDeps: {
    exclude: ["@openerx/contracts"],
  },
  server: {
    watch: {
      ignored: ["**/out/**"],
    },
  },
  build: {
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
