import { defineConfig } from "vite";
import { desktopBrandDefine } from "./vite.brand";

export default defineConfig({
  define: desktopBrandDefine,
  build: {
    rollupOptions: { output: { entryFileNames: "pi-host.js" } },
    sourcemap: process.env.OPENERX_RELEASE_MODE !== "1",
  },
});
