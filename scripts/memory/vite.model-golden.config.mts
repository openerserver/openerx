import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(repositoryRoot, ".vite", "memory-model-golden"),
    rollupOptions: {
      output: { entryFileNames: "memory-model-golden.mjs" },
    },
    ssr: path.join(repositoryRoot, "scripts", "memory", "model-golden-eval.ts"),
    target: "node24",
  },
  ssr: {
    noExternal: [/^@openerx\//u],
  },
});
