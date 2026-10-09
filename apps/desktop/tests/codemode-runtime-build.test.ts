import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { build, loadConfigFromFile } from "vite";
import { expect, test } from "vitest";

const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("Pi resolves a dedicated worker in both dev and release bundles", async () => {
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    path.join(desktopDirectory, "vite.pi-host.config.mts"),
  );
  expect(loaded?.config.define?.PI_BUNDLED_NODE).toBe("true");
  const forgeSource = readFileSync(path.join(desktopDirectory, "forge.config.ts"), "utf8");
  expect(forgeSource).toContain('entry: "src/utility/codemode-worker.ts"');
  expect(forgeSource).toContain('config: "vite.codemode-worker.config.mts"');
  expect(forgeSource).toContain('copyRuntimePackage(buildPath, "quickjs-wasi")');
});

test("the bundled worker executes with a packaged WASM payload and no source tree", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "openerx-codemode-build-")));
  try {
    await build({
      configFile: path.join(desktopDirectory, "vite.codemode-worker.config.mts"),
      root: desktopDirectory,
      logLevel: "error",
      resolve: { conditions: ["node"] },
      build: {
        lib: {
          entry: path.join(desktopDirectory, "src/utility/codemode-worker.ts"),
          formats: ["cjs"],
        },
        outDir: root,
        sourcemap: false,
        rollupOptions: {
          external: builtinModules.flatMap((name) => [name, `node:${name}`]),
        },
      },
    });
    const packageRoot = path.dirname(require.resolve("quickjs-wasi/package.json"));
    const destination = path.join(root, "node_modules/quickjs-wasi");
    cpSync(packageRoot, destination, { recursive: true });
    const bundledRequire = createRequire(path.join(root, "pi-host.js"));
    const wasmPath = bundledRequire.resolve("quickjs-wasi/quickjs.wasm");
    expect(wasmPath).toBe(path.join(destination, "quickjs.wasm"));
    const wasm = await WebAssembly.compile(readFileSync(wasmPath));
    let toolCalls = 0;
    const sandbox = new CodemodeSandbox({
      wasm,
      workerUrl: pathToFileURL(path.join(root, "codemode-worker.js")),
      timeoutMs: 5_000,
      tools: [
        {
          name: "numbers",
          execute: async () => {
            toolCalls += 1;
            return [2, 5, 11];
          },
        },
      ],
    });
    try {
      const result = await sandbox.execute(
        "const values = await tools.numbers(); return values.reduce((sum, value) => sum + value, 0);",
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(18);
      expect(result.calls).toEqual([expect.objectContaining({ name: "numbers", status: "ok" })]);
      const flood = await sandbox.execute(
        'for (let index = 0; index < 5000; index++) text("x".repeat(32)); await tools.numbers();',
      );
      expect(flood.ok).toBe(false);
      if (!flood.ok) expect(flood.error.message).toContain("PI_NATIVE_OUTPUT_LIMIT");
      expect(
        flood.output.reduce(
          (bytes, item) => bytes + new TextEncoder().encode(JSON.stringify(item)).byteLength,
          0,
        ),
      ).toBeLessThanOrEqual(64 * 1024);
      expect(flood.output.length).toBeLessThanOrEqual(4096);
      expect(toolCalls).toBe(1);

      const oversizedReturn = await sandbox.execute('return "x".repeat(70 * 1024);');
      expect(oversizedReturn.ok).toBe(false);
      if (!oversizedReturn.ok)
        expect(oversizedReturn.error.message).toContain("PI_NATIVE_OUTPUT_LIMIT");

      const oversizedError = await sandbox.execute('throw new Error("x".repeat(70 * 1024));');
      expect(oversizedError.ok).toBe(false);
      if (!oversizedError.ok)
        expect(oversizedError.error.message).toContain("PI_NATIVE_OUTPUT_LIMIT");
    } finally {
      await sandbox.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
