import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/managed-codex-runtime-lock.json", async () => {
  const { createHash } = await import("node:crypto");
  return {
    default: {
      schemaVersion: 1,
      codexVersion: "0.162.0",
      artifacts: {
        "win32-x64": {
          archive: "official.tgz",
          integrity: "sha512-fixture",
          archiveSha256: "locked-archive",
          executable: "bin/codex.exe",
          files: ["LICENSE", "bin/codex.exe", "helpers/runner.exe"].map((name) => ({
            path: name,
            size: Buffer.byteLength(name),
            sha256: createHash("sha256").update(name).digest("hex"),
          })),
        },
      },
    },
  };
});

import {
  managedCodexRuntimeCacheKey,
  readManagedCodexRuntimeState,
  verifyManagedCodexRuntime,
} from "../src/managed-codex-runtime";
import lock from "../src/managed-codex-runtime-lock.json";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "codex controlled space-"));
  roots.push(directory);
  const root = path.join(directory, "files");
  const artifact = lock.artifacts["win32-x64"];
  for (const entry of artifact.files) {
    const file = path.join(root, entry.path);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, entry.path);
  }
  const manifest = {
    schemaVersion: 1,
    codexVersion: lock.codexVersion,
    platform: "win32",
    architecture: "x64",
    archive: artifact.archive,
    archiveIntegrity: artifact.integrity,
    archiveSha256: artifact.archiveSha256,
    executable: artifact.executable,
    files: structuredClone(artifact.files),
  };
  const manifestPath = path.join(directory, "manifest.json");
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest));
  save();
  const verify = () =>
    verifyManagedCodexRuntime(root, manifestPath, { platform: "win32", architecture: "x64" });
  const state = () =>
    readManagedCodexRuntimeState(root, manifestPath, { platform: "win32", architecture: "x64" });
  return { directory, root, manifest, manifestPath, save, verify, state };
}
test("resolves only the pinned executable after verifying helpers and licenses", () => {
  const f = fixture();
  expect(managedCodexRuntimeCacheKey).toBe("codex-0.162.0-1");
  expect(f.verify()).toBe(path.join(f.root, "bin/codex.exe"));
  expect(f.state()).toEqual({ executable: f.verify() });
});
test.each([
  "codexVersion",
  "archiveSha256",
  "archiveIntegrity",
  "architecture",
  "executable",
] as const)("rejects manifest substitution of %s", (field) => {
  const f = fixture();
  f.manifest[field] = "unapproved";
  f.save();
  expect(f.state()).toEqual({ error: "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED" });
});
test("rejects same-size replacement after a successful cached verification", () => {
  const f = fixture();
  f.verify();
  writeFileSync(path.join(f.root, "helpers/runner.exe"), "x".repeat("helpers/runner.exe".length));
  expect(f.state()).toEqual({ error: "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED" });
});
test("rejects a tampered development manifest even when it describes the new file hash", () => {
  const f = fixture();
  f.manifest.files[0]!.sha256 = "a".repeat(64);
  f.save();
  expect(f.verify).toThrow("MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED");
});
test("requires the exact tree without injected or missing helpers", () => {
  const f = fixture();
  writeFileSync(path.join(f.root, "injected.dll"), "injected");
  expect(f.verify).toThrow("MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED");
  const g = fixture();
  rmSync(path.join(g.root, "helpers/runner.exe"));
  expect(g.verify).toThrow("MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED");
});
test("rejects linked runtime directories", () => {
  const f = fixture();
  const link = path.join(f.directory, "link");
  symlinkSync(f.root, link, process.platform === "win32" ? "junction" : "dir");
  expect(() =>
    verifyManagedCodexRuntime(link, f.manifestPath, { platform: "win32", architecture: "x64" }),
  ).toThrow("MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED");
});
test("reports missing and unsupported runtimes without consulting an installed Codex", () => {
  const f = fixture();
  expect(
    readManagedCodexRuntimeState(f.root, f.manifestPath, {
      platform: "linux",
      architecture: "x64",
    }),
  ).toEqual({ error: "MANAGED_CODEX_RUNTIME_UNAVAILABLE" });
  rmSync(f.manifestPath);
  expect(f.state()).toEqual({ error: "MANAGED_CODEX_RUNTIME_UNAVAILABLE" });
});
