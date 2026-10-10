import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPackageWithOptions, extractFile, statFile } from "@electron/asar";
import { afterEach, expect, test } from "vitest";
import { runtimeLock, verifyPreparedNodeRuntime } from "../scripts/managed-node-runtime.mjs";

const directories: string[] = [];
test("ASAR keeps the trusted manifest packed while Node and npm entrypoints are real external files", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "runtime-asar-"));
  directories.push(root);
  const source = path.join(root, "app"),
    archive = path.join(root, "app.asar");
  for (const [relative, content] of [
    ["runtime/node/manifest.json", "trusted manifest"],
    ["runtime/node/files/node.exe", "binary"],
    ["runtime/node/files/node_modules/npm/bin/npm-cli.js", "cli"],
    ["runtime/codex/manifest.json", "trusted Codex manifest"],
    ["runtime/codex/files/vendor/bin/codex.exe", "official Codex fixture"],
  ]) {
    const file = path.join(source, relative!);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content!);
  }
  await createPackageWithOptions(source, archive, {
    unpack:
      "**/{runtime/node/files/**,runtime/codex/files/**,*.node,openerx-browser-accessibility,windows-browser-accessibility.ps1,openerx-desktop-helper.exe}",
  });
  expect(extractFile(archive, path.join("runtime", "node", "manifest.json")).toString()).toBe(
    "trusted manifest",
  );
  expect(statFile(archive, path.join("runtime", "node", "manifest.json"))).not.toHaveProperty(
    "unpacked",
    true,
  );
  expect(existsSync(path.join(`${archive}.unpacked`, "runtime/node/files/node.exe"))).toBe(true);
  expect(
    existsSync(
      path.join(`${archive}.unpacked`, "runtime/node/files/node_modules/npm/bin/npm-cli.js"),
    ),
  ).toBe(true);
  expect(extractFile(archive, path.join("runtime", "codex", "manifest.json")).toString()).toBe(
    "trusted Codex manifest",
  );
  expect(statFile(archive, path.join("runtime", "codex", "manifest.json"))).not.toHaveProperty(
    "unpacked",
    true,
  );
  expect(
    existsSync(path.join(`${archive}.unpacked`, "runtime/codex/files/vendor/bin/codex.exe")),
  ).toBe(true);
});
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
test("offline resource verification rejects changed npm dependencies and unlisted files", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "runtime-artifact-"));
  directories.push(directory);
  const root = path.join(directory, "files");
  const data = {
    "node.exe": "fixture",
    "node_modules/npm/bin/npm-cli.js": "npm",
    "node_modules/npm/bin/npx-cli.js": "npx",
    "node_modules/npm/package.json": JSON.stringify({ version: runtimeLock.npmVersion }),
    "node_modules/npm/node_modules/example/index.js": "approved dependency",
    LICENSE: "node license",
    "NOTICE.txt": "notice",
    "third-party-notices.json": "[]",
    npmrc: "",
    "npmrc-global": "",
  };
  const files = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([relative, value]) => {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, value);
      return {
        path: relative,
        size: Buffer.byteLength(value),
        sha256: createHash("sha256").update(value).digest("hex"),
      };
    });
  const artifact = runtimeLock.artifacts["win32-x64"]!;
  writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      nodeVersion: runtimeLock.nodeVersion,
      npmVersion: runtimeLock.npmVersion,
      platform: "win32",
      architecture: "x64",
      archive: artifact.file,
      archiveSha256: artifact.sha256,
      files,
    }),
  );
  expect(verifyPreparedNodeRuntime(directory, "win32", "x64").nodeVersion).toBe(
    runtimeLock.nodeVersion,
  );
  const dependency = path.join(root, "node_modules/npm/node_modules/example/index.js");
  writeFileSync(dependency, "modified dependency");
  expect(() => verifyPreparedNodeRuntime(directory, "win32", "x64")).toThrow(
    "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED",
  );
  writeFileSync(dependency, data["node_modules/npm/node_modules/example/index.js"]);
  writeFileSync(path.join(root, "injected.js"), "unexpected");
  expect(() => verifyPreparedNodeRuntime(directory, "win32", "x64")).toThrow(
    "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED",
  );
  expect(readFileSync(dependency, "utf8")).toBe("approved dependency");
});
