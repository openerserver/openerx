import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBuildInfo, getBuildInfo } from "../scripts/build-info.mjs";

test("build identifiers advance across dates and keep native version bounds", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openerx-version-"));
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "2.1.1" }));
    const first = createBuildInfo(root, new Date("2026-09-15T23:59:59Z"));
    const next = createBuildInfo(root, new Date("2026-09-16T00:00:00Z"));
    assert.equal(first.version, "2.1.1");
    assert.equal(next.buildId, "20260916T000000Z");
    assert.ok(next.androidVersionCode > first.androidVersionCode);
    assert.ok(Number(next.nativeBuildNumber.split(".")[0]) > Number(first.nativeBuildNumber.split(".")[0]));
    assert.match(first.nativeBuildNumber, /^\d{1,4}\.\d{1,2}\.\d{1,2}$/u);
    const previous = process.env.OPENERX_BUILD_INFO;
    try {
      process.env.OPENERX_BUILD_INFO = JSON.stringify(first);
      assert.deepEqual(getBuildInfo(root), first);
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "2.1.2" }));
      assert.throws(() => getBuildInfo(root), /BUILD_INFO_INVALID/u);
    } finally {
      if (previous === undefined) delete process.env.OPENERX_BUILD_INFO;
      else process.env.OPENERX_BUILD_INFO = previous;
    }
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.0.0" }));
    assert.throws(() => createBuildInfo(root), /PRODUCT_VERSION_REQUIRED/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
