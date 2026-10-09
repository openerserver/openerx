import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkInstalledPi } from "./pi-shrinkwrap-install.mjs";
import { checkPiShrinkwrapLock, repairPiShrinkwrapLock } from "./pi-shrinkwrap-lock.mjs";

// Network integration probe, deliberately separate from offline local checks.
// It installs public packages only inside one disposable fixture, never runs
// dependency lifecycle scripts, and never reads or writes a Pi user profile.
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === "--report")) {
  throw new Error("PI_SHRINKWRAP_PROBE_ARGUMENT_INVALID");
}
const reportPath = args[0] === "--report" ? path.resolve(args[1]) : null;
const root = mkdtempSync(path.join(tmpdir(), "pi-shrinkwrap-probe-"));
const lockFile = path.join(root, "package-lock.json");
const readLock = () => JSON.parse(readFileSync(lockFile, "utf8"));
const userConfig = path.join(root, "isolated-npmrc");
writeFileSync(userConfig, "");
const env = {
  ...process.env,
  npm_config_cache: path.join(root, "npm-cache"),
  npm_config_userconfig: userConfig,
};
function npm(args) {
  return execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      ...args,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org",
    ],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}
let report;
try {
  const npmVersion = npm(["--version"]).trim();
  assert.equal(npmVersion, "11.3.0", "Run this installation-policy probe with npm 11.3.0");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "pi-shrinkwrap-security-probe", private: true, dependencies: { "@earendil-works/pi-coding-agent": "1.0.0" }, overrides: { "brace-expansion@^5": "5.0.12" } }, null, 2)}\n`,
  );
  npm(["install", "--package-lock-only"]);
  const original = readLock();
  assert.throws(() => checkPiShrinkwrapLock(original), /PI_SHRINKWRAP_LOCK_UNREPAIRED/u);
  npm(["install"]);
  const repaired = repairPiShrinkwrapLock(readLock());
  writeFileSync(lockFile, `${JSON.stringify(repaired, null, 2)}\n`);
  // A repaired/audit-clean lock cannot bless stale vulnerable files on disk.
  assert.throws(() => checkInstalledPi(root), /PI_SHRINKWRAP_INSTALLED_BRACE_UNPATCHED/u);
  npm(["ci"]);
  const installed = checkInstalledPi(root);
  npm(["install", "--package-lock-only"]);
  checkPiShrinkwrapLock(readLock());
  npm(["ci"]);
  checkInstalledPi(root);
  const final = readLock();
  for (const [location, entry] of Object.entries(original.packages)) {
    if (!location.endsWith("/brace-expansion")) {
      assert.equal(
        final.packages[location]?.version,
        entry.version,
        `Unexpected change: ${location}`,
      );
    }
  }
  report = {
    ...installed,
    npmVersion,
    freshLockRepairVerified: true,
    staleDiskRejected: true,
    cleanCiVerified: true,
    lockRefreshAndSecondCiVerified: true,
    otherPackageVersionsUnchanged: true,
    upstreamTarballUnchanged: true,
  };
} finally {
  rmSync(root, { recursive: true, force: true });
}
report.temporaryFixtureRemoved = true;
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
