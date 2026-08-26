import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: ".vite/release-tools",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "release-manifest.ts"),
      formats: ["es"],
      fileName: () => "release-manifest.mjs",
    },
    rollupOptions: {
      external: [/^node:/u],
    },
    sourcemap: false,
  },
});
