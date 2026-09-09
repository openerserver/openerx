import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { desktopBrandDefine } from "./vite.brand";

export default defineConfig({
  define: desktopBrandDefine,
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@openerx/contracts"],
  },
  server: {
    headers: { "Cache-Control": "no-store" },
    watch: {
      ignored: ["**/out/**"],
    },
  },
  build: {
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
