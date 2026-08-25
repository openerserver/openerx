import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: "node24",
    ssr: path.join(desktopDirectory, "../../tests/v2/fixtures/platform-alpha.ts"),
    outDir: path.join(desktopDirectory, ".vite/build"),
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: "platform-alpha-test.mjs", inlineDynamicImports: true },
    },
    sourcemap: true,
  },
  ssr: {
    noExternal: [
      "@openerx/account-sync-api",
      "@openerx/contracts",
      "@openerx/identity-api",
      "@openerx/model-gateway",
      "@openerx/platform-alpha",
      "@openerx/token-usage-store",
    ],
  },
});
