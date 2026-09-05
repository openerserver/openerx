import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(repositoryRoot, ".vite", "pbash-model-ab"),
    rollupOptions: {
      output: { entryFileNames: "pbash-model-ab.mjs" },
    },
    ssr: path.join(repositoryRoot, "scripts", "pbash", "model-ab-eval.ts"),
    target: "node24",
  },
  ssr: {
    noExternal: [/^@openerx\//u],
  },
});
