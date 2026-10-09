import { defineConfig } from "vite";

export default defineConfig({
  // Pi resolves its separately built worker next to this bundle.
  define: { PI_BUNDLED_NODE: "true" },
  build: {
    rollupOptions: { output: { entryFileNames: "pi-host.js" } },
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
