import { buildInfoDefine } from "./vite.build-info";
import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
        output: {
          entryFileNames: "main.js",
        },
      },
      sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
    },
  };
});
