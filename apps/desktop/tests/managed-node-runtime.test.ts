import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPackageWithOptions, extractFile, statFile } from "@electron/asar";
import { build } from "vite";
import { afterEach, expect, test } from "vitest";
import { runtimeLock, verifyPreparedNodeRuntime } from "../scripts/managed-node-runtime.mjs";

const directories: string[] = [];
test("ASAR keeps trusted manifests packed while complete runtimes include hidden npm metadata", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "runtime-asar-"));
  directories.push(root);
  const source = path.join(root, "app"),
    archive = path.join(root, "app.asar");
  for (const [relative, content] of [
    ["runtime/node/manifest.json", "trusted manifest"],
    ["runtime/node/files/node.exe", "binary"],
    ["runtime/node/files/node_modules/npm/bin/npm-cli.js", "cli"],
    ["runtime/node/files/node_modules/npm/.npmrc", ""],
    [
      "runtime/node/files/node_modules/npm/node_modules/node-gyp/.release-please-manifest.json",
      "{}",
    ],
    [
      "runtime/node/files/node_modules/npm/node_modules/node-gyp/gyp/.release-please-manifest.json",
      "{}",
    ],
    [
      "runtime/node/files/node_modules/npm/node_modules/qrcode-terminal/.travis.yml",
      "language: node_js",
    ],
    ["runtime/node/files/.metadata/license.json", "hidden directory metadata"],
    ["runtime/codex/manifest.json", "trusted Codex manifest"],
    ["runtime/codex/files/vendor/bin/codex.exe", "official Codex fixture"],
    ["runtime/codex/files/.metadata/license.json", "trusted Codex license metadata"],
  ]) {
    const file = path.join(source, relative!);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content!);
  }
  await createPackageWithOptions(source, archive, {
    unpackDir: "runtime/{node,codex}/files",
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
  for (const relative of [
    "runtime/node/files/node_modules/npm/.npmrc",
    "runtime/node/files/node_modules/npm/node_modules/node-gyp/.release-please-manifest.json",
    "runtime/node/files/node_modules/npm/node_modules/node-gyp/gyp/.release-please-manifest.json",
    "runtime/node/files/node_modules/npm/node_modules/qrcode-terminal/.travis.yml",
    "runtime/node/files/.metadata/license.json",
    "runtime/codex/files/.metadata/license.json",
  ]) {
    const entry = path.join(...relative.split("/"));
    expect(statFile(archive, entry)).toHaveProperty("unpacked", true);
    expect(readFileSync(path.join(`${archive}.unpacked`, entry))).toEqual(
      readFileSync(path.join(source, entry)),
    );
  }
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

test.runIf(process.platform === "win32")(
  "Electron verifies a packed manifest with virtual stats and still rejects manifest and unpacked-file substitution",
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "runtime-electron-asar-"));
    directories.push(root);
    const source = path.join(root, "app");
    const archive = path.join(root, "app.asar");
    const data: Record<string, string> = {
      "node.exe": "fixture executable",
      "node_modules/npm/bin/npm-cli.js": "fixture npm",
      "node_modules/npm/bin/npx-cli.js": "fixture npx",
      "node_modules/npm/package.json": JSON.stringify({ version: runtimeLock.npmVersion }),
      LICENSE: "fixture license",
      "NOTICE.txt": "fixture notice",
      "third-party-notices.json": "[]",
      npmrc: "# fixture config",
      "npmrc-global": "# fixture global config",
    };
    const files = Object.entries(data).map(([relative, content]) => {
      const file = path.join(source, "runtime/node/files", relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      return {
        path: relative,
        size: Buffer.byteLength(content),
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    });
    const artifact = runtimeLock.artifacts["win32-x64"];
    if (!artifact) throw new Error("Missing locked Windows runtime fixture");
    const manifest = {
      schemaVersion: 1,
      nodeVersion: runtimeLock.nodeVersion,
      npmVersion: runtimeLock.npmVersion,
      platform: "win32",
      architecture: "x64",
      archive: artifact.file,
      archiveSha256: artifact.sha256,
      files,
    };
    writeFileSync(path.join(source, "runtime/node/manifest.json"), JSON.stringify(manifest));
    await createPackageWithOptions(source, archive, { unpackDir: "runtime/node/files" });
    expect(statFile(archive, path.join("runtime/node/manifest.json"))).not.toHaveProperty(
      "unpacked",
      true,
    );
    const changedSource = path.join(root, "changed");
    const changedArchive = path.join(root, "changed.asar");
    mkdirSync(path.join(changedSource, "runtime/node"), { recursive: true });
    writeFileSync(
      path.join(changedSource, "runtime/node/manifest.json"),
      JSON.stringify({ ...manifest, nodeVersion: "unapproved" }),
    );
    await createPackageWithOptions(changedSource, changedArchive, {});

    const bundle = path.join(root, "bundle");
    const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    await build({
      configFile: false,
      root: repository,
      logLevel: "error",
      build: {
        outDir: bundle,
        minify: false,
        sourcemap: false,
        lib: {
          entry: path.join(repository, "packages/tool-sdk/src/managed-node-runtime.ts"),
          formats: ["cjs"],
          fileName: () => "managed-runtime.cjs",
        },
        rollupOptions: {
          external: builtinModules.flatMap((name) => [name, `node:${name}`]),
        },
      },
    });
    const script = path.join(root, "verify.cjs");
    writeFileSync(
      script,
      [
        'const { app } = require("electron");',
        'const assert = require("node:assert/strict");',
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        "const input = JSON.parse(process.argv[2]);",
        "const { verifyManagedNodeRuntime, assertManagedNodeRuntime } = require(input.bundle);",
        'app.setPath("userData", input.profile);',
        "app.disableHardwareAcceleration();",
        "app.whenReady().then(() => { try {",
        "  const before = fs.statSync(input.manifest);",
        '  const runtime = verifyManagedNodeRuntime(input.files, input.manifest, { platform: "win32", architecture: "x64" });',
        "  assertManagedNodeRuntime(runtime);",
        "  const after = fs.statSync(input.manifest);",
        "  assert.throws(() => assertManagedNodeRuntime({ ...runtime, manifestPath: input.changedManifest }), /MANAGED_NODE_RUNTIME_INTEGRITY_FAILED/);",
        "  const original = fs.readFileSync(runtime.nodeExecutable);",
        "  fs.writeFileSync(runtime.nodeExecutable, Buffer.alloc(original.length, 120));",
        "  assert.throws(() => assertManagedNodeRuntime(runtime), /MANAGED_NODE_RUNTIME_INTEGRITY_FAILED/);",
        '  assert.throws(() => verifyManagedNodeRuntime(input.files, input.manifest, { platform: "win32", architecture: "x64" }), /MANAGED_NODE_RUNTIME_INTEGRITY_FAILED/);',
        "  fs.writeFileSync(runtime.nodeExecutable, original);",
        "  assertManagedNodeRuntime(runtime);",
        "  console.log(JSON.stringify({ nodeVersion: runtime.nodeVersion, npmVersion: runtime.npmVersion, virtualInodeChanged: before.ino !== after.ino, tamperRejected: true }));",
        "  app.exit(0);",
        "} catch (error) { console.error(error.stack); app.exit(1); } });",
      ].join("\n"),
    );
    const require = createRequire(import.meta.url);
    mkdirSync(path.join(root, "profile"));
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    const output = execFileSync(
      require("electron") as string,
      [
        script,
        JSON.stringify({
          bundle: path.join(bundle, "managed-runtime.cjs"),
          manifest: path.join(archive, "runtime/node/manifest.json"),
          changedManifest: path.join(changedArchive, "runtime/node/manifest.json"),
          files: path.join(`${archive}.unpacked`, "runtime/node/files"),
          profile: path.join(root, "profile"),
        }),
      ],
      { env: environment, encoding: "utf8", timeout: 20_000, windowsHide: true, maxBuffer: 65_536 },
    );
    expect(JSON.parse(output.trim())).toMatchObject({
      nodeVersion: runtimeLock.nodeVersion,
      npmVersion: runtimeLock.npmVersion,
      tamperRejected: true,
    });
  },
  30_000,
);

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
