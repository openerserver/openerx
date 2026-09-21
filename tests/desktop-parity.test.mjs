import assert from "node:assert/strict";
import test from "node:test";
import { compareBaseline, createBaseline, inScope } from "../scripts/desktop-parity.mjs";

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
  ])
    assert.equal(inScope(file), true);
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
