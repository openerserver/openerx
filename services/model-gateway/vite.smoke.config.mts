import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  const toolSmoke = mode === "tool";
  const visionSmoke = mode === "vision";
  const entryName = toolSmoke
    ? "deepseek-tool-smoke"
    : visionSmoke
      ? "deepseek-vision-smoke"
      : "deepseek-smoke";
  return {
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: path.join(repositoryRoot, ".vite", entryName),
      rollupOptions: {
        output: { entryFileNames: `${entryName}.mjs` },
      },
      ssr: path.join(
        repositoryRoot,
        "tests/v2/fixtures",
        toolSmoke
          ? "deepseek-tool-smoke.ts"
          : visionSmoke
            ? "deepseek-vision-smoke.ts"
            : "deepseek-smoke.ts",
      ),
      target: "node24",
    },
    resolve: {
      alias: {
        "@openerx/contracts": path.join(repositoryRoot, "packages/contracts/src/index.ts"),
      },
    },
    ssr: {
      noExternal: [/^@openerx\//u],
    },
  };
});
