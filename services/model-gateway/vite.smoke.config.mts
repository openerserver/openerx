import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(repositoryRoot, ".vite", "deepseek-smoke"),
    rollupOptions: {
      output: { entryFileNames: "deepseek-smoke.mjs" },
    },
    ssr: path.join(repositoryRoot, "tests/v2/fixtures/deepseek-smoke.ts"),
    target: "node24",
  },
  resolve: {
    alias: {
      "@openerx/contracts": path.join(repositoryRoot, "packages/contracts/src/index.ts"),
    },
  },
  ssr: {
    noExternal: [/^@openerx\//u],
  },
});
