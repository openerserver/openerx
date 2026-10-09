import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const piShrinkwrapPolicy = Object.freeze({
  piVersion: "1.0.0",
  piTarball:
    "https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.0.0.tgz",
  piIntegrity:
    "sha512-/FtbxoSQU/mEv1QnichJjRjqteqaIaMWxmhB4G367+MwZfX7/DI5B9YAg5lqbN7nztFskBEtUSZ+FlmMBECtMw==",
  braceVersion: "5.0.12",
  braceTarball: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
  braceIntegrity:
    "sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==",
  braceRuntimeHashes: Object.freeze({
    "dist/commonjs/index.js": "e0ede97c712339a70bae2c96c675b1ffd30052bdf57f37f5a97b5945c40a9ae6",
    "dist/esm/index.js": "eea9a18920e1cde68f0068c36c040541ad6e93b0bb89eaab38c8ab49925b90a8",
  }),
});

export function assertPiVersions(packages) {
  for (const [location, entry] of Object.entries(packages)) {
    if (
      /(?:^|\/)node_modules\/@earendil-works\/(?:pi-[^/]+|chord)$/u.test(location) &&
      entry.version !== piShrinkwrapPolicy.piVersion
    ) {
      throw new Error(`PI_SHRINKWRAP_PI_VERSION_CHANGED: ${location}`);
    }
  }
}

export function resolveLockDependency(packages, from, name) {
  let directory = from;
  while (true) {
    if (path.posix.basename(directory) !== "node_modules") {
      const candidate = path.posix.join(directory, "node_modules", name);
      if (packages[candidate]) return candidate;
    }
    if (!directory || directory === ".") break;
    directory = path.posix.dirname(directory);
  }
  throw new Error(`PI_SHRINKWRAP_DEPENDENCY_MISSING: ${from} -> ${name}`);
}

export function piBraceLockLocations(packages, piLocation) {
  const minimatch = resolveLockDependency(packages, piLocation, "minimatch");
  const loadedBrace = resolveLockDependency(packages, minimatch, "brace-expansion");
  return [
    ...new Set([
      loadedBrace,
      ...Object.keys(packages).filter(
        (location) =>
          location.startsWith(`${piLocation}/node_modules/`) &&
          location.endsWith("/brace-expansion"),
      ),
    ]),
  ];
}

export function repairPiShrinkwrapLock(lock) {
  if (!lock.packages || ![2, 3].includes(lock.lockfileVersion)) {
    throw new Error("PI_SHRINKWRAP_LOCK_FORMAT_INVALID");
  }
  const repaired = structuredClone(lock);
  const packages = repaired.packages;
  assertPiVersions(packages);
  const parents = Object.entries(packages).filter(([location]) =>
    /(?:^|\/)node_modules\/@earendil-works\/pi-coding-agent$/u.test(location),
  );
  if (parents.length === 0) throw new Error("PI_SHRINKWRAP_PACKAGE_MISSING");
  for (const [location, entry] of parents) {
    if (
      entry.resolved !== piShrinkwrapPolicy.piTarball ||
      entry.integrity !== piShrinkwrapPolicy.piIntegrity
    ) {
      throw new Error(`PI_SHRINKWRAP_UPSTREAM_IDENTITY_CHANGED: ${location}`);
    }
    // npm may hoist brace-expansion above Pi's shrinkwrap subtree. Follow the
    // same ancestor lookup as Node instead of assuming every dependency nests.
    for (const child of piBraceLockLocations(packages, location)) {
      const dependency = packages[child];
      if (!/^5\.\d+\.\d+$/u.test(dependency.version)) {
        throw new Error(`PI_SHRINKWRAP_BRACE_MAJOR_CHANGED: ${child}`);
      }
      dependency.version = piShrinkwrapPolicy.braceVersion;
      dependency.resolved = piShrinkwrapPolicy.braceTarball;
      dependency.integrity = piShrinkwrapPolicy.braceIntegrity;
    }
    // npm 11.3 re-inflates the published shrinkwrap during reify, ignoring root
    // overrides AND a patched root lock. Omit this inflation hint deliberately:
    // our complete root lock owns resolution, while the upstream tarball stays
    // byte-for-byte original. Fresh locks must run this repair before npm ci;
    // the separate installation gate verifies the actual code loaded by Pi.
    delete entry.hasShrinkwrap;
  }
  return repaired;
}

export function checkPiShrinkwrapLock(lock) {
  const repaired = repairPiShrinkwrapLock(lock);
  if (JSON.stringify(lock) !== JSON.stringify(repaired)) {
    throw new Error("PI_SHRINKWRAP_LOCK_UNREPAIRED: run pi-shrinkwrap-lock.mjs --write");
  }
  return repaired;
}

export function parseRootArguments(args, { allowWrite = false } = {}) {
  let root = process.cwd();
  let write = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--root" && args[index + 1]) root = path.resolve(args[++index]);
    else if (argument === "--write" && allowWrite) write = true;
    else if (argument !== "--check") throw new Error(`PI_SHRINKWRAP_ARGUMENT_INVALID: ${argument}`);
  }
  return { root, write };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { root, write } = parseRootArguments(process.argv.slice(2), { allowWrite: true });
    const file = path.join(root, "package-lock.json");
    const original = JSON.parse(readFileSync(file, "utf8"));
    const repaired = write ? repairPiShrinkwrapLock(original) : checkPiShrinkwrapLock(original);
    if (write && JSON.stringify(original) !== JSON.stringify(repaired)) {
      const temporary = `${file}.pi-shrinkwrap-${process.pid}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify(repaired, null, 2)}\n`, { flag: "wx" });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    console.log(
      JSON.stringify({
        piVersion: piShrinkwrapPolicy.piVersion,
        braceVersion: piShrinkwrapPolicy.braceVersion,
        rootLockAuthority: true,
        upstreamTarballUnchanged: true,
        changed: JSON.stringify(original) !== JSON.stringify(repaired),
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
