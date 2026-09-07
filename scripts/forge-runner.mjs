import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

export async function runForgeCliAction(action, entry, require) {
  const cli = require(entry);
  // Unlike start/package, Forge's make module only runs automatically when it
  // is require.main. This adapter loads it as a dependency, so invoke its API.
  if (action === "make") {
    const options = await cli.getMakeOptions();
    require("@electron/get").initializeProxy();
    await require("@electron-forge/core").api.make(options);
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const action = process.argv[2];
  if (!["start", "package", "make"].includes(action)) throw new Error("FORGE_ACTION_NOT_SUPPORTED");
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
  const cliRoot = path.dirname(require.resolve("@electron-forge/cli/package.json"));
  const entry = path.join(cliRoot, "dist", `electron-forge-${action}.js`);
  process.argv = [process.execPath, entry, ...process.argv.slice(3)];
  await runForgeCliAction(action, entry, require);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
