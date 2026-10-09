import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const checksum = (value, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(value).digest(encoding);

export function verifyBracesArchive(root) {
  const directory = path.join(root, "vendor/security");
  const provenance = JSON.parse(readFileSync(path.join(directory, "braces-backport.json")));
  assert.equal(provenance.name, "@openerx/braces");
  assert.equal(provenance.version, "3.0.3-security.1");
  assert.equal(provenance.patch.advisory, "GHSA-vfj7-8cjw-p6xm");
  assert.equal(provenance.artifact.file, "openerx-braces-3.0.3-security.1.tgz");
  assert.equal(provenance.upstream.name, "braces");
  assert.equal(provenance.upstream.version, "3.0.3");
  assert.equal(provenance.upstream.url, "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz");
  assert.equal(
    provenance.upstream.integrity,
    "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==",
  );
  assert.equal(provenance.patch.url, "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm");
  assert.equal(provenance.patch.maxAstDepth, 128);
  assert.equal(provenance.patch.maxAstNodes, 131074);
  assert.equal(Object.keys(provenance.files).length, 12, "BRACES_DISTRIBUTED_FILES_CHANGED");
  assert.equal(provenance.files["lib/security.js"], provenance.patch.guardSourceSha256);
  assert.equal(
    checksum(readFileSync(path.join(root, provenance.patch.guardSource))),
    provenance.patch.guardSourceSha256,
  );
  for (const [relative, hashes] of Object.entries(provenance.patch.changes)) {
    assert.equal(provenance.files[relative], hashes.patchedSha256, relative);
    assert.equal(provenance.upstreamFileHashes[relative] ?? null, hashes.originalSha256, relative);
  }
  const archive = readFileSync(path.join(directory, provenance.artifact.file));
  assert.equal(checksum(archive), provenance.artifact.sha256);
  assert.equal(`sha512-${checksum(archive, "sha512", "base64")}`, provenance.artifact.integrity);
  return provenance;
}

function verifyInstalledDirectory(installed, provenance) {
  const manifest = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
  assert.equal(manifest.name, provenance.name, "BRACES_ORIGINAL_UNPATCHED_PACKAGE");
  assert.equal(manifest.version, provenance.version);
  for (const [relative, expected] of Object.entries(provenance.files)) {
    assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/u).includes(".."));
    assert.equal(checksum(readFileSync(path.join(installed, relative))), expected, relative);
  }
  return manifest;
}

function bracesDirectory(require) {
  return realpathSync(path.dirname(require.resolve("braces/package.json")));
}

function lockRoots(root) {
  const roots = [root];
  const outer = path.dirname(root);
  const outerLock = path.join(outer, "package-lock.json");
  if (path.basename(root) === "core" && existsSync(outerLock)) {
    const lock = JSON.parse(readFileSync(outerLock, "utf8"));
    const workspaces = lock.packages?.[""]?.workspaces ?? [];
    const containsCore =
      Array.isArray(workspaces) &&
      workspaces.some((workspace) => workspace === "core" || workspace.startsWith("core/"));
    const lockedCore = Object.keys(lock.packages ?? {}).some(
      (location) => location === "core" || location.startsWith("core/"),
    );
    if (containsCore && lockedCore) roots.push(outer);
  }
  return roots;
}

function consumerDirectory(lockRoot, location, name) {
  const exact = path.join(lockRoot, location);
  if (existsSync(path.join(exact, "package.json"))) return realpathSync(exact);
  // UWA's core lock may describe packages physically hoisted to the outer
  // workspace. Nested lock locations must remain exact; never substitute a
  // same-named root package for a missing nested consumer.
  const relative = location.slice("node_modules/".length);
  if (!location.startsWith("node_modules/") || relative.includes("node_modules/")) return null;
  const require = createRequire(path.join(lockRoot, "package.json"));
  const allowed = new Set();
  for (let directory = lockRoot; ; directory = path.dirname(directory)) {
    allowed.add(path.join(directory, "node_modules"));
    if (path.dirname(directory) === directory) break;
  }
  for (const directory of require.resolve.paths(name) ?? []) {
    if (!allowed.has(directory)) continue;
    const candidate = path.join(directory, name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
  }
  return null;
}

function bracesLockState(root) {
  root = path.resolve(root);
  const provenance = verifyBracesArchive(root);
  const archive = realpathSync(path.join(root, "vendor/security", provenance.artifact.file));
  const locks = [];
  const records = [];
  for (const lockRoot of lockRoots(root)) {
    const lockFile = path.join(lockRoot, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    assert.ok(lock.packages && typeof lock.packages === "object", "BRACES_LOCK_PACKAGES_MISSING");
    let lockedBracesPackages = 0;
    for (const [location, entry] of Object.entries(lock.packages)) {
      if (!/(?:^|\/)node_modules\/braces$/u.test(location)) continue;
      assert.equal(entry.name, provenance.name, `BRACES_LOCK_PACKAGE_IDENTITY: ${location}`);
      assert.equal(entry.version, provenance.version, `BRACES_LOCK_PACKAGE_VERSION: ${location}`);
      assert.equal(
        entry.integrity,
        provenance.artifact.integrity,
        `BRACES_LOCK_PACKAGE_INTEGRITY: ${location}`,
      );
      assert.ok(entry.resolved?.startsWith("file:"), `BRACES_LOCK_PACKAGE_NONLOCAL: ${location}`);
      const source = entry.resolved.startsWith("file://")
        ? fileURLToPath(entry.resolved)
        : path.resolve(lockRoot, decodeURIComponent(entry.resolved.slice("file:".length)));
      assert.equal(realpathSync(source), archive, `BRACES_LOCK_PACKAGE_SOURCE: ${location}`);
      lockedBracesPackages += 1;
    }
    assert.ok(lockedBracesPackages > 0, "BRACES_LOCK_PACKAGE_MISSING");
    locks.push({ lockFile, lockedBracesPackages });
    records.push({ lockRoot, lockFile, lock });
  }
  return { root, provenance, locks, records };
}

// This preflight deliberately needs no installed dependency. A lock mismatch
// must fail before npm ci replaces the current installation.
export function verifyBracesLocks(root) {
  const { provenance, locks } = bracesLockState(root);
  return { name: provenance.name, version: provenance.version, locks };
}

export function resolveDeclaredConsumer(root, name) {
  root = path.resolve(root);
  const candidates = [];
  let declared = false;
  for (const lockRoot of lockRoots(root)) {
    const manifest = JSON.parse(readFileSync(path.join(lockRoot, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(path.join(lockRoot, "package-lock.json"), "utf8"));
    for (const fields of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
    ]) {
      if (Object.hasOwn(fields ?? {}, name)) declared = true;
    }
    for (const [location, entry] of Object.entries(lock.packages ?? {})) {
      const isConsumer =
        location === `node_modules/${name}` ||
        location.endsWith(`/node_modules/${name}`) ||
        entry.name === name;
      if (isConsumer) {
        declared = true;
        candidates.push({ lockRoot, location });
      }
      for (const fields of [
        entry.dependencies,
        entry.devDependencies,
        entry.optionalDependencies,
      ]) {
        if (Object.hasOwn(fields ?? {}, name)) declared = true;
      }
    }
  }
  if (!declared) return null;
  const require = createRequire(path.join(root, "package.json"));
  try {
    return require.resolve(name);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    for (const candidate of candidates) {
      const directory = consumerDirectory(candidate.lockRoot, candidate.location, name);
      if (directory) return createRequire(path.join(directory, "package.json")).resolve(name);
    }
    throw new Error(`BRACES_DECLARED_CONSUMER_MISSING: ${name}`, { cause: error });
  }
}

export function verifyBracesBackport(root) {
  const state = bracesLockState(root);
  root = state.root;
  const { provenance, locks, records } = state;
  const require = createRequire(path.join(root, "package.json"));
  const installed = bracesDirectory(require);
  const checked = new Map();
  const checkDirectory = (directory) => {
    if (!checked.has(directory))
      checked.set(directory, verifyInstalledDirectory(directory, provenance));
    return checked.get(directory);
  };
  const manifest = checkDirectory(installed);
  const consumers = [];
  const skippedConsumers = [];
  for (const { lockRoot, lockFile, lock } of records) {
    for (const [location, entry] of Object.entries(lock.packages)) {
      // Check every physically installed lock entry, including aliases reachable
      // only through optional/peer dependencies rather than dependencies.
      if (/(?:^|\/)node_modules\/braces$/u.test(location)) {
        const directory = consumerDirectory(lockRoot, location, "braces");
        if (!directory && entry.optional === true) continue;
        assert.ok(directory, `BRACES_LOCK_PACKAGE_NOT_INSTALLED: ${location}`);
        checkDirectory(directory);
      }
      if (
        ![entry.dependencies, entry.optionalDependencies, entry.peerDependencies].some(
          (dependencies) => Object.hasOwn(dependencies ?? {}, "braces"),
        )
      )
        continue;
      const name =
        entry.name ??
        location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
      const directory = consumerDirectory(lockRoot, location, name);
      if (!directory && entry.optional === true) {
        skippedConsumers.push({
          lockFile,
          location,
          package: name,
          reason: "optional_not_installed",
        });
        continue;
      }
      assert.ok(directory, `BRACES_CONSUMER_NOT_INSTALLED: ${location}`);
      const consumerManifest = JSON.parse(
        readFileSync(path.join(directory, "package.json"), "utf8"),
      );
      assert.equal(consumerManifest.name, name, `BRACES_CONSUMER_IDENTITY: ${location}`);
      const consumerRequire = createRequire(path.join(directory, "package.json"));
      const actualBraces = bracesDirectory(consumerRequire);
      checkDirectory(actualBraces);
      consumers.push({
        lockFile,
        location,
        package: name,
        directory,
        bracesDirectory: actualBraces,
      });
    }
  }
  return {
    name: manifest.name,
    version: manifest.version,
    verifiedFiles: Object.keys(provenance.files).length,
    verifiedPackageDirectories: checked.size,
    locks,
    consumers,
    skippedConsumers,
  };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../.."));
  console.log(JSON.stringify(verifyBracesBackport(root)));
}
