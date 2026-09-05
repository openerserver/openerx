import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: "esnext",
    ssr: path.join(desktopDirectory, "tests/fixtures/pi-host.ts"),
    outDir: path.join(desktopDirectory, ".vite/build"),
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: "pi-host-test.js", inlineDynamicImports: true },
    },
    sourcemap: true,
  },
  ssr: {
    noExternal: ["@openerx/pi-host"],
  },
});
