import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareBaseline, createBaseline, inScope, inventory } from "../scripts/desktop-parity.mjs";

const shared = "apps/desktop/src/renderer/RemoteSettings.tsx",
  overlay = "apps/desktop/src/main/index.ts";
const a = "a".repeat(64),
  b = "b".repeat(64),
  revision = "c".repeat(40);
test("reviewed desktop build adapters and their regressions belong to parity", () => {
  for (const file of [
    "scripts/forge-runner.mjs",
    "scripts/dmg-image-size.mjs",
    "tests/v2/forge-runner.test.ts",
    "tests/v2/dmg-image-size.test.ts",
    "apps/desktop/tests/build-dependencies.test.ts",
    "scripts/security/pi-shrinkwrap-lock.mjs",
    "scripts/security/pi-shrinkwrap-install.mjs",
    "scripts/security/check-forge-backport.mjs",
    "scripts/security/build-forge-backport.py",
    "scripts/security/braces-runtime-guard.cjs",
    "scripts/security/braces-backport.test.mjs",
    "scripts/security/build-braces-backport.py",
    "scripts/security/check-braces-backport.mjs",
    "vendor/security/node-forge-backport.json",
    "vendor/security/openerx-node-forge-1.4.0-security.1.tgz",
    "vendor/security/braces-backport.json",
    "vendor/security/openerx-braces-3.0.3-security.1.tgz",
  ])
    assert.equal(inScope(file), true);
});
test("the actual security runtime guard cannot drift or disappear outside the paired baseline", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "desktop-parity-security-"));
  const guard = "scripts/security/braces-runtime-guard.cjs";
  try {
    const sourceRoot = path.join(root, "source");
    const coreRoot = path.join(root, "core");
    for (const repo of [sourceRoot, coreRoot]) {
      mkdirSync(path.join(repo, "scripts/security"), { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: repo });
      writeFileSync(path.join(repo, guard), '"use strict";\nmodule.exports = { maxDepth: 128 };\n');
    }
    const source = inventory(sourceRoot);
    const core = inventory(coreRoot);
    assert.match(source[guard], /^[a-f0-9]{64}$/u);
    const baseline = createBaseline(source, core, revision, {});
    assert.deepEqual(compareBaseline(baseline, core, "core"), []);

    writeFileSync(
      path.join(coreRoot, guard),
      '"use strict";\nmodule.exports = { maxDepth: Infinity };\n',
    );
    assert.deepEqual(compareBaseline(baseline, inventory(coreRoot), "core"), [
      `core: changed or missing ${guard}`,
    ]);
    rmSync(path.join(coreRoot, guard));
    assert.deepEqual(compareBaseline(baseline, inventory(coreRoot), "core"), [
      `core: changed or missing ${guard}`,
    ]);
    writeFileSync(
      path.join(sourceRoot, "scripts/security/extra-runtime-guard.cjs"),
      "module.exports = {};\n",
    );
    assert.deepEqual(compareBaseline(baseline, inventory(sourceRoot), "source"), [
      "source: unreviewed addition scripts/security/extra-runtime-guard.cjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("browser extension control and permission files belong to desktop parity", () => {
  for (const file of ["background.js", "manifest.json", "page-agent.js", "popup.html", "popup.js"])
    assert.equal(inScope(`apps/desktop/browser-extension/${file}`), true);
});
test("parity checks both shared code and reviewed edition overlays, including additions and removals", () => {
  const source = { [shared]: a, [overlay]: a },
    core = { [shared]: a, [overlay]: b };
  assert.throws(() => createBaseline(source, core, revision, {}), /OVERLAY_REASON_REQUIRED/);
  const baseline = createBaseline(source, core, revision, { [overlay]: "Edition account adapter" });
  assert.deepEqual(compareBaseline(baseline, core, "core"), []);
  assert.deepEqual(compareBaseline(baseline, source, "source"), []);
  assert.equal(compareBaseline(baseline, { ...core, [shared]: b }, "core").length, 1);
  assert.equal(compareBaseline(baseline, { ...core, [overlay]: a }, "core").length, 1);
  assert.equal(compareBaseline(baseline, { [overlay]: b }, "core").length, 1);
  assert.equal(
    compareBaseline(baseline, { ...source, "packages/contracts/src/new.ts": a }, "source").length,
    1,
  );
  assert.throws(
    () => createBaseline(core, core, revision, { [overlay]: "obsolete" }),
    /OBSOLETE_OVERLAY/,
  );
});
