import assert from "node:assert/strict";
import test from "node:test";
import { createBaseline, compareBaseline } from "../scripts/desktop-parity.mjs";

const shared = "apps/desktop/src/renderer/RemoteSettings.tsx",
  overlay = "apps/desktop/src/main/index.ts";
const a = "a".repeat(64),
  b = "b".repeat(64),
  revision = "c".repeat(40);
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
