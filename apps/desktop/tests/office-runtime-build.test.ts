import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, loadConfigFromFile, mergeConfig } from "vite";
import { expect, test } from "vitest";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test.each(["vite.main.config.mts", "vite.app-service.config.mts"])(
  "%s builds Office previews with a separately loaded native renderer",
  async (configFile) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openerx-office-runtime-"));
    try {
      const loaded = await loadConfigFromFile(
        { command: "build", mode: "production" },
        path.join(desktop, configFile),
      );
      expect(loaded).toBeDefined();
      const entry = path.join(root, "fixture.ts");
      writeFileSync(
        entry,
        `export { compileOfficeArtifact } from ${JSON.stringify(path.resolve(desktop, "../../packages/file-service/src/office-artifact.ts"))};`,
      );
      await build(
        mergeConfig(loaded!.config, {
          configFile: false,
          root: desktop,
          logLevel: "error",
          resolve: { conditions: ["node"] },
          build: {
            target: "esnext",
            lib: { entry, formats: ["cjs"] },
            outDir: path.join(root, "bundle"),
            sourcemap: false,
            rollupOptions: {
              external: builtinModules.flatMap((name) => [name, `node:${name}`]),
              output: { entryFileNames: "office-runtime.cjs" },
            },
          },
        }),
      );
      const rendererPath = require.resolve("@resvg/resvg-js/package.json");
      const rendererPackage = JSON.parse(readFileSync(rendererPath, "utf8"));
      cpSync(path.dirname(rendererPath), path.join(root, "node_modules/@resvg/resvg-js"), {
        recursive: true,
      });
      let copiedNative = false;
      for (const name of Object.keys(rendererPackage.optionalDependencies)) {
        let source: string;
        try {
          source = path.dirname(require.resolve(`${name}/package.json`));
        } catch {
          continue;
        }
        cpSync(source, path.join(root, "node_modules", name), { recursive: true });
        copiedNative = true;
      }
      expect(copiedNative).toBe(true);
      const bundle = path.join(root, "bundle/office-runtime.cjs");
      const compiled = createRequire(bundle)(bundle).compileOfficeArtifact({
        format: "docx",
        title: "Native preview",
        pages: [{ paragraphs: ["Amount 60"] }],
      });
      expect(compiled.bytes.subarray(0, 2).toString()).toBe("PK");
      expect(compiled.parsedText).toContain("Amount 60");
      const png = Buffer.from(
        compiled.renderedSurfaces[0].modelImageDataUrl.split(",")[1],
        "base64",
      );
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
