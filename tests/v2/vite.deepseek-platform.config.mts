import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(repositoryRoot, ".vite", "deepseek-platform"),
    rollupOptions: {
      output: { entryFileNames: "platform.mjs" },
    },
    ssr: path.join(repositoryRoot, "tests/v2/fixtures/deepseek-platform.ts"),
    target: "node24",
  },
  ssr: {
    noExternal: [/^@openerx\//u],
  },
});
