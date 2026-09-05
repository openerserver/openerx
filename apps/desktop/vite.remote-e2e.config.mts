import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: "node24",
    ssr: path.join(desktopDirectory, "tests/remote-e2e.ts"),
    outDir: path.join(desktopDirectory, ".vite/build"),
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: "remote-e2e.mjs", inlineDynamicImports: true },
    },
    sourcemap: true,
  },
  ssr: {
    noExternal: ["@openerx/contracts", "@openerx/remote-protocol"],
  },
});
