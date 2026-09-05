import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(desktopDirectory, ".vite/browser-smoke");

export default defineConfig({
  plugins: [
    {
      name: "browser-computer-use-smoke-package",
      closeBundle() {
        writeFileSync(
          path.join(outputDirectory, "package.json"),
          `${JSON.stringify({
            name: "openerx-browser-computer-use-smoke",
            version: "1.0.0",
            private: true,
            type: "module",
            main: "browser-computer-use-smoke.mjs",
          })}\n`,
          "utf8",
        );
      },
    },
  ],
  build: {
    target: "node24",
    ssr: path.join(desktopDirectory, "scripts/e2e-browser-computer-use.mts"),
    outDir: outputDirectory,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "browser-computer-use-smoke.mjs",
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
  },
  ssr: {
    noExternal: ["@openerx/contracts"],
  },
});
