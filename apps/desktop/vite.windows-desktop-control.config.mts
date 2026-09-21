import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktop = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  build: {
    target: "node24",
    ssr: true,
    outDir: path.join(desktop, ".vite/windows-desktop-live"),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        run: path.join(desktop, "scripts/e2e-windows-desktop-control.mts"),
        apps: path.join(desktop, "scripts/e2e-windows-desktop-apps.mts"),
        foreground: path.join(desktop, "scripts/e2e-windows-foreground.mts"),
      },
      output: { entryFileNames: "[name].mjs" },
    },
  },
  ssr: { noExternal: ["@openerx/contracts"] },
});
