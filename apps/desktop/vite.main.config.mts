import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { buildInfoDefine } from "./vite.build-info";

export default defineConfig(({ command }) => {
  if (command === "serve" && process.platform === "darwin") {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./scripts/build-macos-screen-permission.mjs", import.meta.url))],
      { stdio: "inherit" },
    );
  }
  return {
    define: buildInfoDefine,
    build: {
      rollupOptions: {
        // Enterprise task files reuse Office previews in the main process.
        // Load the platform-native renderer at runtime, as the file worker does.
        external: ["@resvg/resvg-js"],
        output: {
          entryFileNames: "main.js",
        },
      },
      sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
    },
  };
});
