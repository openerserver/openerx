import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "node24",
    ssr: "scripts/e2e-browser-extension.mts",
    outDir: ".vite/browser-extension-e2e",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "run.mjs", inlineDynamicImports: true } },
  },
  ssr: { noExternal: ["@openerx/contracts"] },
});
