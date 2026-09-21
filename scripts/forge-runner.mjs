import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installDmgImageSizeAdapter } from "./dmg-image-size.mjs";

// Forge 7 supplies callback/positional hooks; maintained Packager 20 uses a
// Promise/object contract. Adapt the boundary without patching node_modules or
// restoring the vulnerable extract-zip dependency of older Packager releases.
export function adaptForgePackagerOptions(options) {
  const adapted = { ...options };
  for (const name of [
    "afterComplete",
    "afterCopy",
    "afterExtract",
    "afterPrune",
    "afterFinalizePackageTargets",
  ]) {
    if (!options[name]) continue;
    adapted[name] = options[name].map((hook) => async (input) => {
      const args =
        name === "afterFinalizePackageTargets"
          ? [input]
          : [input.buildPath, input.electronVersion, input.platform, input.arch];
      await new Promise((resolve, reject) => {
        try {
          hook(...args, (error) => (error ? reject(error) : resolve()));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  return adapted;
}

export function installForgePackagerAdapter() {
  const require = createRequire(import.meta.url);
  const forgeVersion = require("@electron-forge/core/package.json").version;
  const packagerPath = require.resolve("@electron/packager");
  const packager = require("@electron/packager");
  const packagerVersion = require(
    path.resolve(path.dirname(packagerPath), "../package.json"),
  ).version;
  if (forgeVersion !== "7.11.2" || packagerVersion !== "20.3.0")
    throw new Error("FORGE_ADAPTER_VERSION_REVIEW_REQUIRED");
  const cached = require.cache[packagerPath];
  if (!cached) throw new Error("FORGE_PACKAGER_MODULE_NOT_CACHED");
  cached.exports = {
    ...packager,
    packager: (options) => packager.packager(adaptForgePackagerOptions(options)),
  };
  // Forge stops at core/package-lock.json, although npm hoists Electron into
  // the enclosing edition workspace. Use Node's ancestor resolution instead.
  const locatorPath = path.join(
    path.dirname(require.resolve("@electron-forge/core/package.json")),
    "dist/util/electron-executable.js",
  );
  require(locatorPath).default = async (directory) => resolveElectronExecutable(directory);
}

export function resolveElectronExecutable(directory) {
  const require = createRequire(path.resolve(directory, "package.json"));
  const executable = require("electron");
  if (typeof executable !== "string" || !path.isAbsolute(executable))
    throw new Error("ELECTRON_EXECUTABLE_INVALID");
  return executable;
}

function main() {
  const action = process.argv[2];
  if (!["start", "package", "make"].includes(action)) throw new Error("FORGE_ACTION_NOT_SUPPORTED");
  installForgePackagerAdapter();
  installDmgImageSizeAdapter();
  const require = createRequire(import.meta.url);
  const cliRoot = path.dirname(require.resolve("@electron-forge/cli/package.json"));
  const entry = path.join(cliRoot, "dist", `electron-forge-${action}.js`);
  process.argv = [process.execPath, entry, ...process.argv.slice(3)];
  require(entry);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) main();
