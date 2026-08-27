import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      // Office preview support loads a platform-native .node binary at runtime.
      // Keep the package external so Rollup does not parse that binary as JavaScript.
      external: ["@resvg/resvg-js"],
      output: { entryFileNames: "app-service.js" },
    },
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
