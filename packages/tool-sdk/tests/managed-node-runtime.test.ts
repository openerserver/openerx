import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  assertManagedNodeRuntime,
  managedNodeRuntimeCacheKey,
  managedNodeRuntimeEnvironment,
  readManagedNodeRuntimeState,
  resolveManagedNodeCommand,
  verifyManagedNodeRuntime,
} from "../src/managed-node-runtime";
import lock from "../src/managed-node-runtime-lock.json";

const roots: string[] = [];
test.runIf(process.platform === "win32")(
  "the prepared official runtime runs npm lifecycle children without a system Node PATH",
  () => {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error("LOCALAPPDATA_REQUIRED");
    const directory = path.join(
      local,
      "openerx-runtime-cache",
      "runtimes",
      managedNodeRuntimeCacheKey,
      "win32-x64",
    );
    // Preparation is a build/dev step; unit-only checkouts do not download artifacts.
    if (!existsSync(path.join(directory, "manifest.json"))) return;
    const runtime = verifyManagedNodeRuntime(
      path.join(directory, "files"),
      path.join(directory, "manifest.json"),
    );
    const workspace = mkdtempSync(path.join(tmpdir(), "npm lifecycle space-"));
    roots.push(workspace);
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ private: true, scripts: { verify: "node verify.cjs && npm --version" } }),
    );
    writeFileSync(
      path.join(workspace, "verify.cjs"),
      "const cp=require('node:child_process');const child=cp.spawnSync('node',['--version'],{encoding:'utf8'});if(child.status!==0)throw new Error('child node missing');process.stdout.write('MANAGED_CHILD='+child.stdout.trim());",
    );
    const environment = {
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      TEMP: workspace,
      TMP: workspace,
      ...managedNodeRuntimeEnvironment(runtime, {
        path: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
        cwd: workspace,
      }),
    };
    const output = execFileSync(
      runtime.nodeExecutable,
      [runtime.npmCli, "run", "verify", "--offline"],
      { cwd: workspace, env: environment, encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    expect(output).toContain("MANAGED_CHILD=v" + runtime.nodeVersion);
    expect(output).toContain(runtime.npmVersion);
    expect(
      execFileSync(runtime.nodeExecutable, [runtime.npxCli, "--version"], {
        env: environment,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      }).trim(),
    ).toBe(runtime.npmVersion);
  },
  60_000,
);
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "runtime space-"));
  roots.push(directory);
  const root = path.join(directory, "files");
  const data: Record<string, string> = {
    "node.exe": "fixture executable",
    "node_modules/npm/bin/npm-cli.js": "fixture npm",
    "node_modules/npm/bin/npx-cli.js": "fixture npx",
    "node_modules/npm/package.json": JSON.stringify({ version: lock.npmVersion }),
    "node_modules/npm/LICENSE": "npm fixture license",
    LICENSE: "Node fixture license",
    "NOTICE.txt": "fixture notice",
    "third-party-notices.json": "[]",
    npmrc: "# empty",
    "npmrc-global": "# empty global",
  };
  const files = Object.entries(data).map(([name, bytes]) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return {
      path: name,
      size: Buffer.byteLength(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const artifact = lock.artifacts["win32-x64"];
  const value = {
    schemaVersion: 1,
    nodeVersion: lock.nodeVersion,
    npmVersion: lock.npmVersion,
    platform: "win32",
    architecture: "x64",
    archive: artifact.file,
    archiveSha256: artifact.sha256,
    files,
  };
  const manifest = path.join(directory, "manifest.json");
  const save = () => writeFileSync(manifest, JSON.stringify(value));
  save();
  const verify = () =>
    verifyManagedNodeRuntime(root, manifest, { platform: "win32", architecture: "x64" });
  return { root, manifest, value, save, verify };
}
test("pins distribution identity and resolves npm/npx with preserved argv, never shell interpolation", () => {
  const f = fixture(),
    runtime = f.verify();
  const args = ["exec", "package with spaces", "& echo secret", "${value}"];
  expect(resolveManagedNodeCommand(runtime, "npm.cmd", args)).toEqual({
    command: runtime.nodeExecutable,
    args: [runtime.npmCli, ...args],
    readOnlyRoots: [runtime.rootDirectory],
  });
  expect(resolveManagedNodeCommand(runtime, "NPX", ["--offline"])).toMatchObject({
    command: runtime.nodeExecutable,
    args: [runtime.npxCli, "--offline"],
  });
  expect(resolveManagedNodeCommand(runtime, "node.exe", ["--version"])).toMatchObject({
    command: runtime.nodeExecutable,
    args: ["--version"],
  });
  expect(resolveManagedNodeCommand(runtime, path.join(f.root, "other.exe"), args).command).toBe(
    path.join(f.root, "other.exe"),
  );
});
test("runtime environment prepends only its bin and confines npm writes to the granted cwd", () => {
  const f = fixture(),
    runtime = f.verify();
  const environment = managedNodeRuntimeEnvironment(runtime, {
    path: `relative;${path.dirname(process.execPath)};${runtime.binDirectory}`,
    cwd: f.root,
  });
  expect(environment.PATH!.split(";")[0]).toBe(runtime.binDirectory);
  expect(environment.PATH).not.toContain("relative");
  expect(environment.npm_config_cache).toBe(path.join(f.root, ".openerx-npm-cache"));
  expect(environment.npm_config_prefix).toBe(path.join(f.root, ".openerx-npm-prefix"));
  expect(environment.npm_config_userconfig).toBe(path.join(f.root, "npmrc"));
  expect(environment.npm_config_globalconfig).toBe(path.join(f.root, "npmrc-global"));
  expect(environment).not.toHaveProperty("NODE_OPTIONS");
});
test.each(["nodeVersion", "npmVersion", "archiveSha256", "architecture"] as const)(
  "rejects unapproved manifest %s",
  (field) => {
    const f = fixture();
    f.value[field] = "unapproved";
    f.save();
    expect(f.verify).toThrow("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
  },
);
test("rejects traversal and tampered or missing files instead of searching system PATH", () => {
  const f = fixture();
  f.value.files[0]!.path = "../node.exe";
  f.save();
  expect(f.verify).toThrow("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
  const g = fixture(),
    runtime = g.verify();
  writeFileSync(runtime.nodeExecutable, "tampered executable");
  expect(() => resolveManagedNodeCommand(runtime, "node", [])).toThrow(
    "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED",
  );
  const h = fixture(),
    valid = h.verify();
  rmSync(valid.npmCli);
  expect(() => resolveManagedNodeCommand(valid, "npm", [])).toThrow(
    "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED",
  );
});
test("a manifest changed after bootstrap cannot authorize changed entrypoints", () => {
  const f = fixture(),
    runtime = f.verify();
  f.value.files[0]!.sha256 = "a".repeat(64);
  f.save();
  expect(() => assertManagedNodeRuntime(runtime)).toThrow("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
  expect(readFileSync(runtime.nodeExecutable, "utf8")).toBe("fixture executable");
});

test("startup rejects unlisted module files and junctions instead of following npm resolution outside the inventory", () => {
  const f = fixture();
  writeFileSync(path.join(f.root, "node_modules/npm/injected.js"), "unexpected module");
  expect(f.verify).toThrow("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
  const g = fixture(),
    outside = fixture();
  symlinkSync(
    outside.root,
    path.join(g.root, "linked-modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(g.verify).toThrow("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
});
test("trusted startup reports missing or corrupt runtime without making the application unavailable", () => {
  const f = fixture();
  expect(
    readManagedNodeRuntimeState(f.root, f.manifest, { platform: "win32", architecture: "x64" })
      .nodeRuntime,
  ).toBeDefined();
  writeFileSync(path.join(f.root, "extra-module.js"), "unlisted");
  expect(
    readManagedNodeRuntimeState(f.root, f.manifest, { platform: "win32", architecture: "x64" }),
  ).toEqual({ nodeRuntimeError: "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED" });
  rmSync(f.manifest);
  expect(
    readManagedNodeRuntimeState(f.root, f.manifest, { platform: "win32", architecture: "x64" }),
  ).toEqual({ nodeRuntimeError: "MANAGED_NODE_RUNTIME_MISSING" });
  expect(
    readManagedNodeRuntimeState(f.root, f.manifest, {
      platform: "unsupported",
      architecture: "x64",
    }),
  ).toEqual({ nodeRuntimeError: "MANAGED_NODE_RUNTIME_TARGET_UNSUPPORTED" });
});
test.each(["node", "node.exe", "npm", "npm.cmd", "npx", "npx.cmd"])(
  "product runtime errors reject explicit %s without blocking ordinary OS commands",
  (alias) => {
    expect(() =>
      resolveManagedNodeCommand(undefined, alias, ["--version"], "MANAGED_NODE_RUNTIME_MISSING"),
    ).toThrow("MANAGED_NODE_RUNTIME_MISSING");
    expect(
      resolveManagedNodeCommand(
        undefined,
        "powershell.exe",
        ["-NoProfile"],
        "MANAGED_NODE_RUNTIME_MISSING",
      ),
    ).toEqual({ command: "powershell.exe", args: ["-NoProfile"], readOnlyRoots: [] });
  },
);
