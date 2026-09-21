import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { isDesktopBuildArtifact } from "./scripts/desktop-dev-watch.mjs";
import { buildInfoDefine } from "./vite.build-info";

export default defineConfig({
  define: buildInfoDefine,
  plugins: [
    react(),
    {
      name: "openerx-development-browser-helper",
      configureServer() {
        // Prepare the native helper for development without packaging an app.
        // Its fixed .native-build path survives Forge clearing the .vite cache.
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
    headers: { "Cache-Control": "no-store" },
    watch: {
      ignored: isDesktopBuildArtifact,
    },
  },
  build: {
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
