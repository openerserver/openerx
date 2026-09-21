import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: { output: { entryFileNames: "remote-host.js" } },
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
