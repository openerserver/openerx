import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import { defineConfig } from "vite";

function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("ant-design-vue")) return "antd";
  if (id.includes("@ant-design/icons-vue")) return "antd-icons";
  if (id.includes("@vue-flow/") || id.includes("dagre")) return "graph";
  if (
    id.includes("vue-router") ||
    id.includes("pinia") ||
    id.includes("pinia-plugin-persistedstate")
  ) {
    return "app-core";
  }
  if (id.includes("/vue/") || id.includes("@vue/")) return "vue-vendor";

  return "vendor";
}

export default defineConfig({
  plugins: [
    vue(),
    Components({
      dts: "src/components.d.ts",
      resolvers: [AntDesignVueResolver({ importStyle: false })],
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4098",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:4098",
        ws: true,
      },
    },
  },
});
