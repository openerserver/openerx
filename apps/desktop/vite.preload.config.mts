import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "preload.js",
      },
    },
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
