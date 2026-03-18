import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import { defineConfig } from "vite";

const appPort = process.env.VITE_APP_PORT || process.env.APP_PORT || "4098";
const bffHttpTarget = process.env.VITE_BFF_TARGET || `http://127.0.0.1:${appPort}`;
const bffWsTarget = process.env.VITE_BFF_WS_TARGET || `ws://127.0.0.1:${appPort}`;

function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("ant-design-vue")) return "antd";
  if (id.includes("@ant-design/icons-vue")) return "antd-icons";
  if (id.includes("@vue-flow/")) {
    return "graph";
  }
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
      "@vue/test-utils": resolve(__dirname, "node_modules/@vue/test-utils"),
      pinia: resolve(__dirname, "node_modules/pinia"),
      vue: resolve(__dirname, "node_modules/vue"),
      "vue-router": resolve(__dirname, "node_modules/vue-router"),
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
        target: bffHttpTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: bffWsTarget,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["../../tests/web-ui/**/*.test.ts"],
    setupFiles: "../../tests/web-ui/vitest.setup.ts",
  },
});
