import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import baseConfig from "./vite.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: [],
    },
  }),
);