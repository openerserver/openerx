import path from "node:path";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(repositoryRoot, ".vite/cx108-office-evidence"),
    rollupOptions: {
      output: { entryFileNames: "generate-office-evidence.mjs" },
    },
    ssr: path.join(import.meta.dirname, "generate-office-evidence.ts"),
    target: "node24",
  },
  resolve: {
    alias: {
      "@openerx/contracts": path.join(repositoryRoot, "packages/contracts/src/index.ts"),
      "@openerx/file-service": path.join(repositoryRoot, "packages/file-service/src/index.ts"),
      "@openerx/storage": path.join(repositoryRoot, "packages/storage/src/index.ts"),
    },
  },
  ssr: {
    noExternal: [/^@openerx\//u],
  },
});
