import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("release bump preserves parity and refuses to approve unrelated package edits", () => {
  const root = mkdtempSync(path.join(tmpdir(), "product-version-"));
  const json = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
  };
  const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const hash = (file) =>
    createHash("sha256")
      .update(readFileSync(path.join(root, file)))
      .digest("hex");
  try {
    for (const file of [
      "package.json",
      "core/package.json",
      "core/apps/desktop/package.json",
      "apps/mobile/package.json",
    ])
      json(file, { name: file, version: "2.1.1" });
    json("apps/mobile/app.json", { expo: { version: "2.1.1" } });
    for (const file of ["package-lock.json", "core/package-lock.json"])
      json(file, { version: "2.1.1", packages: { "": { version: "2.1.1" } } });
    const overlay = {
      source: "a".repeat(64),
      core: hash("core/apps/desktop/package.json"),
      reason: "edition metadata",
    };
    json("config/desktop-parity.json", {
      version: 1,
      files: { "apps/desktop/package.json": overlay, "untouched.ts": { sha256: "b".repeat(64) } },
    });
    mkdirSync(path.join(root, "scripts"));
    copyFileSync(
      new URL("../scripts/product-version.mjs", import.meta.url),
      path.join(root, "scripts/product-version.mjs"),
    );
    const run = (...args) =>
      execFileSync(process.execPath, ["scripts/product-version.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
      });
    run("bump", "patch");
    run("check");
    assert.equal(read("package.json").version, "2.1.2");
    const baseline = read("config/desktop-parity.json");
    assert.equal(
      baseline.files["apps/desktop/package.json"].core,
      hash("core/apps/desktop/package.json"),
    );
    assert.equal(baseline.files["apps/desktop/package.json"].source, overlay.source);
    assert.deepEqual(baseline.files["untouched.ts"], { sha256: "b".repeat(64) });
    json("core/apps/desktop/package.json", {
      ...read("core/apps/desktop/package.json"),
      scripts: { extra: "unreviewed" },
    });
    const refused = spawnSync(process.execPath, ["scripts/product-version.mjs", "bump"], {
      cwd: root,
    });
    assert.notEqual(refused.status, 0);
    assert.equal(read("package.json").version, "2.1.2");
    assert.deepEqual(read("config/desktop-parity.json"), baseline);
    assert.notEqual(
      spawnSync(process.execPath, ["scripts/product-version.mjs", "set", "invalid"], { cwd: root })
        .status,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
