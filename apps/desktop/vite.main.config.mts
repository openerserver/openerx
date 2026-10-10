import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { buildInfoDefine } from "./vite.build-info";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    try {
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("./scripts/prepare-node-runtime.mjs", import.meta.url))],
        { stdio: "inherit" },
      );
    } catch {
      // Main reports the runtime error; keep the desktop and Skill text access usable.
      console.warn("MANAGED_NODE_RUNTIME_PREPARATION_UNAVAILABLE");
    }
  }
  if (command === "serve" && process.platform === "darwin") {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./scripts/build-macos-screen-permission.mjs", import.meta.url))],
      { stdio: "inherit" },
    );
  }
  if (command === "serve" && process.platform === "win32") {
    try {
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL("../../scripts/prepare-codex-runtime.mjs", import.meta.url)),
          ...(process.env.OPENERX_RUNTIME_OFFLINE === "1" ? ["--offline"] : []),
        ],
        { stdio: "inherit" },
      );
    } catch {
      console.warn("CODEX_RUNTIME_PREPARATION_UNAVAILABLE");
    }
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
