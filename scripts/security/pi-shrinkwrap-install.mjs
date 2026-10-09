import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkPiShrinkwrapLock,
  parseRootArguments,
  piBraceLockLocations,
  piShrinkwrapPolicy,
  resolveLockDependency,
} from "./pi-shrinkwrap-lock.mjs";

function packageDirectory(entry) {
  let directory = path.dirname(realpathSync(entry));
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      if (manifest.name) return directory;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("PI_SHRINKWRAP_INSTALLED_PACKAGE_MISSING");
    directory = parent;
  }
}

function installedPackageDirectory(name, require) {
  // Pi exposes import-only entry points. Search Node's normal node_modules
  // hierarchy for its manifest instead of changing conditions to load code.
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = path.join(directory, name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
  }
  throw new Error(`PI_SHRINKWRAP_INSTALLED_PACKAGE_MISSING: ${name}`);
}

export function assertRuntimeHashes(directory, expectedHashes) {
  for (const [relativePath, expected] of Object.entries(expectedHashes)) {
    const actual = createHash("sha256")
      .update(readFileSync(path.join(directory, relativePath)))
      .digest("hex");
    if (actual !== expected) {
      throw new Error(`PI_SHRINKWRAP_RUNTIME_INTEGRITY_MISMATCH: ${relativePath}`);
    }
  }
}

export function verifyInstalledBrace(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  if (manifest.name !== "brace-expansion" || manifest.version !== piShrinkwrapPolicy.braceVersion) {
    throw new Error(`PI_SHRINKWRAP_INSTALLED_BRACE_UNPATCHED: ${manifest.version}`);
  }
  assertRuntimeHashes(directory, piShrinkwrapPolicy.braceRuntimeHashes);
}

export function checkInstalledPi(root) {
  const lock = checkPiShrinkwrapLock(
    JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")),
  );
  const require = createRequire(path.join(root, "package.json"));
  const piDirectory = installedPackageDirectory("@earendil-works/pi-coding-agent", require);
  const piLockLocation = "node_modules/@earendil-works/pi-coding-agent";
  if (!lock.packages[piLockLocation]) throw new Error("PI_SHRINKWRAP_INSTALLED_LAYOUT_UNSUPPORTED");
  const checkedPackages = [];
  let checkedBracePackages = 0;
  const directoryForLocation = (location) => {
    const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
    return location.startsWith(`${piLockLocation}/`)
      ? path.join(piDirectory, location.slice(piLockLocation.length + 1))
      : location.startsWith("node_modules/") &&
          !location.slice("node_modules/".length).includes("node_modules/")
        ? installedPackageDirectory(name, require)
        : path.join(root, location);
  };
  for (const location of piBraceLockLocations(lock.packages, piLockLocation)) {
    verifyInstalledBrace(directoryForLocation(location));
    checkedBracePackages += 1;
  }
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!/(?:^|\/)node_modules\/@earendil-works\/(?:pi-[^/]+|chord)$/u.test(location)) continue;
    // Resolve root-level packages through npm's normal hierarchy (UWA core may
    // share its outer workspace installation); nested packages stay exact.
    const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
    const directory = directoryForLocation(location);
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    if (manifest.name !== name || manifest.version !== entry.version)
      throw new Error(`PI_SHRINKWRAP_INSTALLED_PI_VERSION_CHANGED: ${name}`);
    checkedPackages.push({ name, version: manifest.version });
  }
  const piRequire = createRequire(path.join(piDirectory, "package.json"));
  const minimatchDirectory = packageDirectory(piRequire.resolve("minimatch"));
  const minimatchLocation = resolveLockDependency(lock.packages, piLockLocation, "minimatch");
  const minimatchManifest = JSON.parse(
    readFileSync(path.join(minimatchDirectory, "package.json"), "utf8"),
  );
  if (
    minimatchManifest.name !== "minimatch" ||
    minimatchManifest.version !== lock.packages[minimatchLocation].version
  )
    throw new Error("PI_SHRINKWRAP_INSTALLED_MINIMATCH_VERSION_CHANGED");
  const minimatchRequire = createRequire(path.join(minimatchDirectory, "package.json"));
  const braceDirectory = packageDirectory(minimatchRequire.resolve("brace-expansion"));
  verifyInstalledBrace(braceDirectory);
  return {
    piVersion: piShrinkwrapPolicy.piVersion,
    installedBraceVersion: piShrinkwrapPolicy.braceVersion,
    officialRuntimeHashesVerified: true,
    checkedBracePackages,
    checkedPiPackages: checkedPackages,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { root } = parseRootArguments(process.argv.slice(2));
    console.log(JSON.stringify(checkInstalledPi(root)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
