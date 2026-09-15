import { buildInfoDefine } from "./vite.build-info";
import { defineConfig } from "vite";

export default defineConfig({
  define: buildInfoDefine,
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "main.js",
      },
    },
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
