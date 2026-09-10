import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateMsixConfiguration } from "./build-windows-msix.mjs";
import { desktopStoreInputs } from "./desktop-artifact-identity.mjs";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("WINDOWS_STORE_X64_RUNNER_REQUIRED");
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const product = desktopStoreInputs(desktop);
validateMsixConfiguration(product.configuration);
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output-dir"))
  throw new Error("WINDOWS_STORE_USAGE: --output-dir <new-directory>");
const output = args[1]
  ? path.resolve(args[1])
  : path.join(
      root,
      "deliverables",
      `${product.executableName}-store-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    );
if (existsSync(output)) throw new Error("WINDOWS_STORE_OUTPUT_EXISTS");
const staging = path.join(root, ".codex-temp", `store-package-${randomUUID()}`);
mkdirSync(staging, { recursive: true });
process.env.OPENERX_DISTRIBUTION = "ms-store";
process.env.OPENERX_RELEASE_MODE = "1";
process.env.OPENERX_RELEASE_OUT_DIR = staging;
process.env.OPENERX_RELEASE_TARGET = "win32-x64";
process.chdir(desktop);
const require = createRequire(import.meta.url);
const adapter = path.join(root, "scripts", "forge-runner.mjs");
if (existsSync(adapter)) (await import(pathToFileURL(adapter).href)).installForgePackagerAdapter();
const { api } = require("@electron-forge/core");
await api.package({ dir: desktop, outDir: staging, platform: "win32", arch: "x64" });
execFileSync(process.execPath, [path.join(desktop, "scripts", "verify-release-artifacts.mjs")], {
  stdio: "inherit",
  windowsHide: true,
});
execFileSync(
  process.execPath,
  [
    path.join(desktop, "scripts", "build-windows-msix.mjs"),
    "--package-dir",
    path.join(staging, `${product.productName}-win32-x64`),
    "--config",
    product.configurationFile,
    "--output-dir",
    output,
    "--logo",
    product.logoFile,
  ],
  { stdio: "inherit", windowsHide: true },
);
console.log(`Microsoft Store upload artifacts: ${output}`);
