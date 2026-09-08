import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateMsixConfiguration } from "./build-windows-msix.mjs";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("WINDOWS_STORE_X64_RUNNER_REQUIRED");
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!["--output-dir", "--config", "--logo"].includes(key) || !args[i + 1] || options[key])
    throw new Error(
      "WINDOWS_STORE_USAGE: --config <identity.json> --logo <brand.png> [--output-dir <new-directory>]",
    );
  options[key] = args[i + 1];
}
if (!options["--config"] || !options["--logo"])
  throw new Error("WINDOWS_STORE_IDENTITY_AND_LOGO_REQUIRED");
const configurationFile = path.resolve(options["--config"]);
validateMsixConfiguration(JSON.parse(readFileSync(configurationFile, "utf8")));
const logoFile = path.resolve(options["--logo"]);
if (!existsSync(logoFile)) throw new Error("WINDOWS_STORE_LOGO_MISSING");
const output = options["--output-dir"]
  ? path.resolve(options["--output-dir"])
  : path.join(
      root,
      "deliverables",
      `OpenERX-store-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    );
if (existsSync(output)) throw new Error("WINDOWS_STORE_OUTPUT_EXISTS");
const staging = path.join(root, ".codex-temp", `store-package-${randomUUID()}`);
mkdirSync(staging, { recursive: true });
process.env.OPENERX_DISTRIBUTION = "ms-store";
process.env.OPENERX_RELEASE_MODE = "1";
process.env.OPENERX_PACKAGE_OUT_DIR = staging;
process.env.OPENERX_RELEASE_TARGET = "win32-x64";
process.chdir(desktop);
execFileSync(
  process.execPath,
  [path.join(root, "scripts/forge-runner.mjs"), "package", "--platform", "win32", "--arch", "x64"],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);
const packages = readdirSync(staging, { withFileTypes: true }).filter(
  (entry) => entry.isDirectory() && entry.name.endsWith("-win32-x64"),
);
if (packages.length !== 1) throw new Error("WINDOWS_STORE_PACKAGE_AMBIGUOUS");
execFileSync(process.execPath, [path.join(desktop, "scripts", "verify-release-artifacts.mjs")], {
  stdio: "inherit",
  windowsHide: true,
});
execFileSync(
  process.execPath,
  [
    path.join(desktop, "scripts", "build-windows-msix.mjs"),
    "--package-dir",
    path.join(staging, packages[0].name),
    "--config",
    configurationFile,
    "--logo",
    logoFile,
    "--output-dir",
    output,
  ],
  { stdio: "inherit", windowsHide: true },
);
console.log(`Microsoft Store upload artifacts: ${output}`);
