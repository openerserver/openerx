import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = process.env.OPENERX_PACKAGE_OUT_DIR
  ? path.resolve(process.env.OPENERX_PACKAGE_OUT_DIR)
  : path.join(desktopRoot, "out");
const brandManifestPath = process.env.OPENERX_BRAND_MANIFEST;
const executableName = brandManifestPath
  ? JSON.parse(readFileSync(path.resolve(brandManifestPath), "utf8")).executableName
  : "OpenERX";

function findPackagedExecutables(directory) {
  const targets = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      targets.push(absolutePath);
    } else if (entry.isDirectory()) {
      targets.push(...findPackagedExecutables(absolutePath));
    } else if (entry.isFile() && entry.name === `${executableName}.exe`) {
      targets.push(absolutePath);
    }
  }
  return targets;
}

const expectedStates = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
  [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
]);

const targets = findPackagedExecutables(outRoot);
if (targets.length === 0) {
  throw new Error(`No packaged OpenERX executable found under ${outRoot}`);
}

for (const target of targets) {
  const current = await getCurrentFuseWire(target);
  for (const [fuse, expected] of expectedStates) {
    if (current[fuse] !== expected) {
      throw new Error(
        `${path.relative(desktopRoot, target)} has unexpected ${FuseV1Options[fuse]} state: ${current[fuse]}`,
      );
    }
  }
  console.log(`[v2-fuses] OK: ${path.relative(desktopRoot, target)}`);
}
