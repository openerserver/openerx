import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "node24",
    ssr: path.resolve(import.meta.dirname, "fixtures/mobile-content-runtime.ts"),
    outDir: path.resolve(import.meta.dirname, "../../apps/desktop/.vite/build"),
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: "mobile-content-runtime.mjs", inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: [/^@openerx\//] },
});
