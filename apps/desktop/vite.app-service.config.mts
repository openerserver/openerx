import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: { output: { entryFileNames: "app-service.js" } },
    sourcemap: true,
  },
});
