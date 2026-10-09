import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertRuntimeHashes, verifyInstalledBrace } from "./pi-shrinkwrap-install.mjs";
import {
  checkPiShrinkwrapLock,
  piBraceLockLocations,
  piShrinkwrapPolicy,
  repairPiShrinkwrapLock,
  resolveLockDependency,
} from "./pi-shrinkwrap-lock.mjs";

const piLocation = "node_modules/@earendil-works/pi-coding-agent";
const braceLocation = `${piLocation}/node_modules/brace-expansion`;
function upstreamLock() {
  return {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@earendil-works/pi-coding-agent": "1.0.0" } },
      [piLocation]: {
        version: "1.0.0",
        resolved: piShrinkwrapPolicy.piTarball,
        integrity: piShrinkwrapPolicy.piIntegrity,
        hasShrinkwrap: true,
        dependencies: { minimatch: "10.2.6" },
      },
      [braceLocation]: {
        version: "5.0.9",
        resolved: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz",
        integrity: "old-fixture-integrity",
        dependencies: { "balanced-match": "^4.0.2" },
      },
      [`${piLocation}/node_modules/minimatch`]: {
        version: "10.2.6",
        dependencies: { "brace-expansion": "^5.0.8" },
      },
      [`${piLocation}/node_modules/@earendil-works/pi-ai`]: { version: "1.0.0" },
      "node_modules/minimatch/node_modules/brace-expansion": { version: "2.1.7" },
    },
  };
}

test("fresh upstream locks fail closed until the root policy is explicitly repaired", () => {
  assert.throws(() => checkPiShrinkwrapLock(upstreamLock()), /PI_SHRINKWRAP_LOCK_UNREPAIRED/u);
  const repaired = repairPiShrinkwrapLock(upstreamLock());
  assert.doesNotThrow(() => checkPiShrinkwrapLock(repaired));
  assert.deepEqual(repairPiShrinkwrapLock(repaired), repaired);
});

test("Pi's nested minimatch can resolve the official brace package hoisted at the root", () => {
  const lock = upstreamLock();
  const hoisted = "node_modules/brace-expansion";
  lock.packages[hoisted] = lock.packages[braceLocation];
  delete lock.packages[braceLocation];
  // A separate, older root minimatch must not redirect Pi to its brace 2.x.
  lock.packages["node_modules/minimatch"] = { version: "9.0.0" };
  assert.deepEqual(piBraceLockLocations(lock.packages, piLocation), [hoisted]);
  const repaired = repairPiShrinkwrapLock(lock);
  assert.equal(repaired.packages[hoisted].version, "5.0.12");
  assert.equal(repaired.packages[hoisted].integrity, piShrinkwrapPolicy.braceIntegrity);
  assert.deepEqual(
    repaired.packages["node_modules/minimatch/node_modules/brace-expansion"],
    lock.packages["node_modules/minimatch/node_modules/brace-expansion"],
  );
  assert.doesNotThrow(() => checkPiShrinkwrapLock(repaired));
  assert.deepEqual(repairPiShrinkwrapLock(repaired), repaired);
});

test("ancestor dependency lookup supports fully hoisted Pi dependencies and nearest shadowing", () => {
  const lock = upstreamLock();
  const nestedMinimatch = `${piLocation}/node_modules/minimatch`;
  lock.packages["node_modules/minimatch"] = lock.packages[nestedMinimatch];
  lock.packages["node_modules/brace-expansion"] = lock.packages[braceLocation];
  delete lock.packages[nestedMinimatch];
  delete lock.packages[braceLocation];
  delete lock.packages["node_modules/minimatch/node_modules/brace-expansion"];
  assert.equal(
    resolveLockDependency(lock.packages, piLocation, "minimatch"),
    "node_modules/minimatch",
  );
  assert.deepEqual(piBraceLockLocations(lock.packages, piLocation), [
    "node_modules/brace-expansion",
  ]);
  assert.doesNotThrow(() => checkPiShrinkwrapLock(repairPiShrinkwrapLock(lock)));
  lock.packages["node_modules/minimatch/node_modules/brace-expansion"] = { version: "4.0.0" };
  assert.equal(
    resolveLockDependency(lock.packages, "node_modules/minimatch", "brace-expansion"),
    "node_modules/minimatch/node_modules/brace-expansion",
  );
  assert.throws(() => repairPiShrinkwrapLock(lock), /BRACE_MAJOR_CHANGED/u);
});

test("a patched root brace cannot hide Pi's stale nested copy or a missing dependency edge", () => {
  const lock = upstreamLock();
  lock.packages["node_modules/brace-expansion"] = {
    ...lock.packages[braceLocation],
    version: "5.0.12",
    resolved: piShrinkwrapPolicy.braceTarball,
    integrity: piShrinkwrapPolicy.braceIntegrity,
  };
  assert.deepEqual(piBraceLockLocations(lock.packages, piLocation), [braceLocation]);
  assert.throws(() => checkPiShrinkwrapLock(lock), /LOCK_UNREPAIRED/u);
  const repaired = repairPiShrinkwrapLock(lock);
  assert.equal(repaired.packages[braceLocation].version, "5.0.12");
  delete lock.packages[`${piLocation}/node_modules/minimatch`];
  assert.throws(() => repairPiShrinkwrapLock(lock), /DEPENDENCY_MISSING.*minimatch/u);
});

test("reintroducing the shrinkwrap hint fails even when audit-visible versions look patched", () => {
  const lock = repairPiShrinkwrapLock(upstreamLock());
  lock.packages[piLocation].hasShrinkwrap = true;
  assert.equal(lock.packages[braceLocation].version, "5.0.12");
  assert.throws(() => checkPiShrinkwrapLock(lock), /PI_SHRINKWRAP_LOCK_UNREPAIRED/u);
});

test("repair changes only the target dependency and root shrinkwrap inflation hint", () => {
  const original = upstreamLock();
  const snapshot = structuredClone(original);
  const repaired = repairPiShrinkwrapLock(original);
  assert.deepEqual(original, snapshot);
  assert.equal(repaired.packages[braceLocation].version, "5.0.12");
  assert.equal(repaired.packages[braceLocation].integrity, piShrinkwrapPolicy.braceIntegrity);
  assert.equal(Object.hasOwn(repaired.packages[piLocation], "hasShrinkwrap"), false);
  assert.equal(repaired.packages[piLocation].version, "1.0.0");
  assert.equal(repaired.packages[piLocation].resolved, original.packages[piLocation].resolved);
  assert.equal(repaired.packages[piLocation].integrity, original.packages[piLocation].integrity);
  for (const [location, entry] of Object.entries(original.packages)) {
    if (![piLocation, braceLocation].includes(location))
      assert.deepEqual(repaired.packages[location], entry);
  }
});

test("CLI rejects fresh locks, repairs them atomically, and leaves repeated repair unchanged", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-shrinkwrap-lock-cli-"));
  try {
    const file = path.join(directory, "package-lock.json");
    const script = fileURLToPath(new URL("./pi-shrinkwrap-lock.mjs", import.meta.url));
    writeFileSync(file, JSON.stringify(upstreamLock()));
    const rejected = spawnSync(process.execPath, [script, "--root", directory], {
      encoding: "utf8",
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /PI_SHRINKWRAP_LOCK_UNREPAIRED/u);
    execFileSync(process.execPath, [script, "--write", "--root", directory]);
    const repaired = readFileSync(file, "utf8");
    assert.doesNotThrow(() => checkPiShrinkwrapLock(JSON.parse(repaired)));
    execFileSync(process.execPath, [script, "--root", directory]);
    const repeated = execFileSync(process.execPath, [script, "--write", "--root", directory], {
      encoding: "utf8",
    });
    assert.equal(JSON.parse(repeated).changed, false);
    assert.equal(readFileSync(file, "utf8"), repaired);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unexpected upstream identities, Pi versions, or dependency majors cannot be repaired silently", () => {
  const cases = [
    [piLocation, "resolved", "https://untrusted.invalid/pi.tgz", /UPSTREAM_IDENTITY_CHANGED/u],
    [piLocation, "integrity", "sha512-untrusted", /UPSTREAM_IDENTITY_CHANGED/u],
    [`${piLocation}/node_modules/@earendil-works/pi-ai`, "version", "1.0.1", /PI_VERSION_CHANGED/u],
    [braceLocation, "version", "4.0.0", /BRACE_MAJOR_CHANGED/u],
  ];
  for (const [location, field, value, expected] of cases) {
    const lock = upstreamLock();
    lock.packages[location][field] = value;
    assert.throws(() => repairPiShrinkwrapLock(lock), expected);
  }
});

test("disk gate rejects the vulnerable installed version even when the root lock claims a patch", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-shrinkwrap-old-disk-"));
  try {
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "brace-expansion", version: "5.0.9" }),
    );
    assert.throws(() => verifyInstalledBrace(directory), /INSTALLED_BRACE_UNPATCHED/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("faking the patched version without official runtime code fails the disk gate", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-shrinkwrap-fake-version-"));
  try {
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "brace-expansion", version: "5.0.12" }),
    );
    for (const file of Object.keys(piShrinkwrapPolicy.braceRuntimeHashes)) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), "export const vulnerableFixture = true;\n");
    }
    assert.throws(() => verifyInstalledBrace(directory), /RUNTIME_INTEGRITY_MISMATCH/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime hashing detects corruption rather than trusting package metadata", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-shrinkwrap-hash-"));
  try {
    const file = path.join(directory, "entry.js");
    writeFileSync(file, "export const fixture = 12;\n");
    const hashes = { "entry.js": createHash("sha256").update(readFileSync(file)).digest("hex") };
    assert.doesNotThrow(() => assertRuntimeHashes(directory, hashes));
    writeFileSync(file, "export const fixture = 9;\n");
    assert.throws(() => assertRuntimeHashes(directory, hashes), /RUNTIME_INTEGRITY_MISMATCH/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
