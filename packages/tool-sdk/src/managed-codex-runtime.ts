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
import lock from "./managed-codex-runtime-lock.json";

export const managedCodexRuntimeCacheKey = `codex-${lock.codexVersion}-${lock.schemaVersion}`;
export type ManagedCodexRuntimeError =
  | "MANAGED_CODEX_RUNTIME_UNAVAILABLE"
  | "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED";
export interface ManagedCodexRuntimeState {
  executable?: string;
  error?: ManagedCodexRuntimeError;
}
interface Entry {
  path: string;
  size: number;
  sha256: string;
}
interface Artifact {
  archive: string;
  integrity: string;
  archiveSha256: string;
  executable: string;
  files: Entry[];
}
interface Manifest {
  schemaVersion: number;
  codexVersion: string;
  platform: string;
  architecture: string;
  archive: string;
  archiveIntegrity: string;
  archiveSha256: string;
  executable: string;
  files: Entry[];
}
const hashes = new Map<string, { stamp: string; digest: string }>();
function fail(): never {
  throw new Error("MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED");
}
function digest(file: string): string {
  const info = statSync(file);
  const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const cached = hashes.get(file);
  if (cached?.stamp === stamp) return cached.digest;
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
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
  const value = hash.digest("hex");
  if (hashes.size > 512) hashes.clear();
  hashes.set(file, { stamp, digest: value });
  return value;
}
function inventory(root: string, relative = ""): string[] {
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) fail();
      if (entry.isDirectory()) return inventory(root, name);
      if (!entry.isFile()) fail();
      return [name];
    })
    .sort();
}
/** No download, global installation, account lookup, or user configuration access occurs here. */
export function verifyManagedCodexRuntime(
  rootDirectory: string,
  manifestPath: string,
  expected: { platform?: string; architecture?: string } = {},
): string {
  const platform = expected.platform ?? process.platform;
  const architecture = expected.architecture ?? process.arch;
  const artifact = (lock.artifacts as Record<string, Artifact>)[`${platform}-${architecture}`];
  if (!artifact || !existsSync(rootDirectory) || !existsSync(manifestPath))
    throw new Error("MANAGED_CODEX_RUNTIME_UNAVAILABLE");
  try {
    if (
      !path.isAbsolute(rootDirectory) ||
      !path.isAbsolute(manifestPath) ||
      lstatSync(rootDirectory).isSymbolicLink()
    )
      fail();
    const root = realpathSync(rootDirectory);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (
      manifest.schemaVersion !== lock.schemaVersion ||
      manifest.codexVersion !== lock.codexVersion ||
      manifest.platform !== platform ||
      manifest.architecture !== architecture ||
      manifest.archive !== artifact.archive ||
      manifest.archiveIntegrity !== artifact.integrity ||
      manifest.archiveSha256 !== artifact.archiveSha256 ||
      manifest.executable !== artifact.executable ||
      JSON.stringify(manifest.files) !== JSON.stringify(artifact.files)
    )
      fail();
    if (
      JSON.stringify(inventory(root)) !==
      JSON.stringify(artifact.files.map((entry) => entry.path).sort())
    )
      fail();
    for (const entry of artifact.files) {
      if (
        !entry.path ||
        entry.path.includes("\\") ||
        path.win32.isAbsolute(entry.path) ||
        entry.path.split("/").some((part) => !part || part === "." || part === "..")
      )
        fail();
      const file = path.join(root, entry.path);
      if (
        !lstatSync(file).isFile() ||
        realpathSync(file) !== file ||
        statSync(file).size !== entry.size ||
        digest(file) !== entry.sha256
      )
        fail();
    }
    return path.join(root, artifact.executable);
  } catch {
    fail();
  }
}
export function readManagedCodexRuntimeState(
  rootDirectory: string,
  manifestPath: string,
  expected: { platform?: string; architecture?: string } = {},
): ManagedCodexRuntimeState {
  try {
    return { executable: verifyManagedCodexRuntime(rootDirectory, manifestPath, expected) };
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message === "MANAGED_CODEX_RUNTIME_UNAVAILABLE"
          ? "MANAGED_CODEX_RUNTIME_UNAVAILABLE"
          : "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED",
    };
  }
}
