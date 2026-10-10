import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  type ManagedNodeRuntime,
  type ManagedNodeRuntimeError,
  type ManagedNodeRuntimeState,
  managedNodeRuntimeSchema,
} from "@openerx/contracts";
import lock from "./managed-node-runtime-lock.json";

export type {
  ManagedNodeRuntime,
  ManagedNodeRuntimeError,
  ManagedNodeRuntimeState,
} from "@openerx/contracts";
export const managedNodeRuntimeCacheKey = `${lock.nodeVersion}-${lock.schemaVersion}`;
interface RuntimeEntry {
  path: string;
  size: number;
  sha256: string;
}
interface RuntimeManifest {
  schemaVersion: number;
  nodeVersion: string;
  npmVersion: string;
  platform: string;
  architecture: string;
  archive: string;
  archiveSha256: string;
  files: RuntimeEntry[];
}
function digest(file: string): string {
  const stat = statSync(file);
  const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  // A same-size replacement can preserve all available filesystem timestamps.
  // Hash actual bytes on every verification; stream large executables to bound memory.
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, stat.size || 1));
  const fd = openSync(file, "r");
  try {
    for (;;) {
      const count = readSync(fd, buffer);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(fd);
  }
  const after = statSync(file);
  if (`${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== stamp) fail();
  return hash.digest("hex");
}
function fail(): never {
  throw new Error("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
}
function regularFile(root: string, relative: string): string {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => !part || part === "." || part === "..") ||
    path.win32.isAbsolute(relative)
  )
    fail();
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail();
  }
  if (!lstatSync(current).isFile() || realpathSync(current) !== current) fail();
  return current;
}
function manifestFor(runtime: ManagedNodeRuntime): RuntimeManifest {
  if (digest(runtime.manifestPath) !== runtime.manifestSha256) fail();
  return JSON.parse(readFileSync(runtime.manifestPath, "utf8")) as RuntimeManifest;
}
function expectedPaths(platform: string) {
  return platform === "win32"
    ? {
        node: "node.exe",
        npm: "node_modules/npm/bin/npm-cli.js",
        npx: "node_modules/npm/bin/npx-cli.js",
        bin: "",
      }
    : {
        node: "bin/node",
        npm: "lib/node_modules/npm/bin/npm-cli.js",
        npx: "lib/node_modules/npm/bin/npx-cli.js",
        bin: "bin",
      };
}
function checkEntry(root: string, entry: RuntimeEntry, inventoriedFile?: string): string {
  const file = inventoriedFile ?? regularFile(root, entry.path);
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    statSync(file).size !== entry.size ||
    digest(file) !== entry.sha256
  )
    fail();
  return file;
}
/** Verify all files once during trusted Main initialization. No downloads occur here. */
export function verifyManagedNodeRuntime(
  rootDirectory: string,
  manifestPath: string,
  expected: { platform?: string; architecture?: string } = {},
): ManagedNodeRuntime {
  try {
    if (
      !path.isAbsolute(rootDirectory) ||
      !path.isAbsolute(manifestPath) ||
      lstatSync(rootDirectory).isSymbolicLink()
    )
      fail();
    const root = realpathSync(rootDirectory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeManifest;
    const artifact =
      lock.artifacts[
        `${manifest.platform}-${manifest.architecture}` as keyof typeof lock.artifacts
      ];
    if (
      manifest.schemaVersion !== 1 ||
      !artifact ||
      manifest.nodeVersion !== lock.nodeVersion ||
      manifest.npmVersion !== lock.npmVersion ||
      manifest.archive !== artifact.file ||
      manifest.archiveSha256 !== artifact.sha256 ||
      manifest.platform !== (expected.platform ?? process.platform) ||
      manifest.architecture !== (expected.architecture ?? process.arch) ||
      !Array.isArray(manifest.files) ||
      manifest.files.length < 5 ||
      manifest.files.length > 20_000
    )
      fail();
    const inventory = new Map<string, string>();
    const inspect = (relative = ""): void => {
      for (const name of readdirSync(path.join(root, relative))) {
        const entry = relative ? `${relative}/${name}` : name;
        const file = path.join(root, entry);
        const stat = lstatSync(file);
        if (stat.isSymbolicLink()) fail();
        if (stat.isDirectory()) inspect(entry);
        else if (!stat.isFile()) fail();
        else inventory.set(entry, file);
      }
    };
    inspect();
    const entries = new Map<string, RuntimeEntry>();
    for (const entry of manifest.files) {
      if (entries.has(entry.path) || !inventory.has(entry.path)) fail();
      entries.set(entry.path, entry);
      checkEntry(root, entry, inventory.get(entry.path));
    }
    if (entries.size !== inventory.size) fail();
    const paths = expectedPaths(manifest.platform);
    for (const required of [
      paths.node,
      paths.npm,
      paths.npx,
      "npmrc",
      "npmrc-global",
      "LICENSE",
      "NOTICE.txt",
      "third-party-notices.json",
    ]) {
      if (!entries.has(required)) fail();
    }
    const npmPackage = paths.npm.replace(/bin\/npm-cli\.js$/, "package.json");
    if (JSON.parse(readFileSync(regularFile(root, npmPackage), "utf8")).version !== lock.npmVersion)
      fail();
    return Object.freeze(
      managedNodeRuntimeSchema.parse({
        nodeVersion: manifest.nodeVersion,
        npmVersion: manifest.npmVersion,
        platform: manifest.platform,
        architecture: manifest.architecture,
        rootDirectory: root,
        nodeExecutable: path.join(root, paths.node),
        npmCli: path.join(root, paths.npm),
        npxCli: path.join(root, paths.npx),
        binDirectory: path.join(root, paths.bin),
        manifestPath,
        manifestSha256: digest(manifestPath),
      }),
    );
  } catch {
    return fail();
  }
}
/** Recheck the sealed manifest and entrypoints without hashing the npm tree per command. */
export function readManagedNodeRuntimeState(
  rootDirectory: string,
  manifestPath: string,
  expected: { platform?: string; architecture?: string } = {},
): ManagedNodeRuntimeState {
  const target = `${expected.platform ?? process.platform}-${expected.architecture ?? process.arch}`;
  if (!(target in lock.artifacts))
    return { nodeRuntimeError: "MANAGED_NODE_RUNTIME_TARGET_UNSUPPORTED" };
  if (!existsSync(rootDirectory) || !existsSync(manifestPath))
    return { nodeRuntimeError: "MANAGED_NODE_RUNTIME_MISSING" };
  try {
    return { nodeRuntime: verifyManagedNodeRuntime(rootDirectory, manifestPath, expected) };
  } catch {
    return { nodeRuntimeError: "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED" };
  }
}

export function assertManagedNodeRuntime(runtime: ManagedNodeRuntime): void {
  try {
    managedNodeRuntimeSchema.parse(runtime);
    const manifest = manifestFor(runtime);
    const paths = expectedPaths(runtime.platform);
    if (
      runtime.nodeVersion !== lock.nodeVersion ||
      runtime.npmVersion !== lock.npmVersion ||
      runtime.nodeExecutable !== path.join(runtime.rootDirectory, paths.node) ||
      runtime.npmCli !== path.join(runtime.rootDirectory, paths.npm) ||
      runtime.npxCli !== path.join(runtime.rootDirectory, paths.npx) ||
      runtime.binDirectory !== path.join(runtime.rootDirectory, paths.bin) ||
      lstatSync(runtime.rootDirectory).isSymbolicLink() ||
      realpathSync(runtime.rootDirectory) !== runtime.rootDirectory
    )
      fail();
    for (const name of [paths.node, paths.npm, paths.npx, "npmrc", "npmrc-global"]) {
      const entry = manifest.files.find((item) => item.path === name);
      if (!entry) fail();
      checkEntry(runtime.rootDirectory, entry);
    }
  } catch {
    fail();
  }
}
export function resolveManagedNodeCommand(
  runtime: ManagedNodeRuntime | undefined,
  command: string,
  args: readonly string[],
  runtimeError?: ManagedNodeRuntimeError,
): { command: string; args: string[]; readOnlyRoots: string[] } {
  if (
    runtimeError &&
    ["node", "node.exe", "npm", "npm.cmd", "npx", "npx.cmd"].includes(
      process.platform === "win32" ? command.toLowerCase() : command,
    )
  )
    throw new Error(runtimeError);
  if (!runtime) return { command, args: [...args], readOnlyRoots: [] };
  assertManagedNodeRuntime(runtime);
  const alias = runtime.platform === "win32" ? command.toLowerCase() : command;
  if (alias === "node" || alias === "node.exe") {
    return {
      command: runtime.nodeExecutable,
      args: [...args],
      readOnlyRoots: [runtime.rootDirectory],
    };
  }
  if (["npm", "npm.cmd", "npx", "npx.cmd"].includes(alias)) {
    const cli = alias.startsWith("npm") ? runtime.npmCli : runtime.npxCli;
    return {
      command: runtime.nodeExecutable,
      args: [cli, ...args],
      readOnlyRoots: [runtime.rootDirectory],
    };
  }
  return { command, args: [...args], readOnlyRoots: [runtime.rootDirectory] };
}
/** These are trusted additions to an already filtered sandbox environment, not a copy of process.env. */
export function managedNodeRuntimeEnvironment(
  runtime: ManagedNodeRuntime,
  options: { path?: string; cwd?: string } = {},
): Record<string, string> {
  assertManagedNodeRuntime(runtime);
  const delimiter = runtime.platform === "win32" ? ";" : ":";
  const inherited = (options.path ?? process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => path.isAbsolute(entry) && entry !== runtime.binDirectory);
  const configuration = path.join(runtime.rootDirectory, "npmrc");
  return {
    PATH: [runtime.binDirectory, ...inherited].join(delimiter),
    npm_config_userconfig: configuration,
    npm_config_globalconfig: path.join(runtime.rootDirectory, "npmrc-global"),
    ...(options.cwd
      ? {
          npm_config_cache: path.join(options.cwd, ".openerx-npm-cache"),
          npm_config_prefix: path.join(options.cwd, ".openerx-npm-prefix"),
        }
      : {}),
  };
}
