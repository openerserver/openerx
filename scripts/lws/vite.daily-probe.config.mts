import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.join(repositoryRoot, ".vite", "lws-daily-probe"),
    rollupOptions: {
      output: { entryFileNames: "lws-daily-probe.mjs" },
    },
    ssr: path.join(repositoryRoot, "scripts", "lws", "daily-probe.ts"),
    target: "node24",
  },
  ssr: {
    noExternal: [/^@openerx\//u],
  },
});
