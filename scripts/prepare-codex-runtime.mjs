import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import lock from "../packages/tool-sdk/src/managed-codex-runtime-lock.json" with { type: "json" };

export const managedCodexRuntimeCacheKey = `codex-${lock.codexVersion}-${lock.schemaVersion}`;
const hash = (bytes, algorithm = "sha256") =>
  createHash(algorithm)
    .update(bytes)
    .digest(algorithm === "sha512" ? "base64" : "hex");
function cacheRoot() {
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"),
    "openerx-runtime-cache",
  );
}
export function codexRuntimeDevelopmentDirectory(
  platform = process.platform,
  architecture = process.arch,
) {
  return path.join(
    cacheRoot(),
    "runtimes",
    managedCodexRuntimeCacheKey,
    `${platform}-${architecture}`,
  );
}
function inventory(root, relative = "") {
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("MANAGED_CODEX_RUNTIME_LINK_REJECTED");
      if (entry.isDirectory()) return inventory(root, name);
      if (!entry.isFile()) throw new Error("MANAGED_CODEX_RUNTIME_FILE_REJECTED");
      const bytes = readFileSync(path.join(root, name));
      return [{ path: name, size: bytes.length, sha256: hash(bytes) }];
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
}
function manifestFor(platform, architecture, artifact) {
  return {
    schemaVersion: lock.schemaVersion,
    codexVersion: lock.codexVersion,
    platform,
    architecture,
    archive: artifact.archive,
    archiveIntegrity: artifact.integrity,
    archiveSha256: artifact.archiveSha256,
    executable: artifact.executable,
    files: artifact.files,
  };
}
export function verifyPreparedCodexRuntime(
  directory,
  platform = process.platform,
  architecture = process.arch,
  suppliedManifest,
) {
  const artifact = lock.artifacts[`${platform}-${architecture}`];
  if (!artifact) throw new Error("MANAGED_CODEX_RUNTIME_TARGET_UNSUPPORTED");
  if (
    lstatSync(directory).isSymbolicLink() ||
    JSON.stringify(
      suppliedManifest ?? JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")),
    ) !== JSON.stringify(manifestFor(platform, architecture, artifact)) ||
    JSON.stringify(inventory(path.join(directory, "files"))) !== JSON.stringify(artifact.files)
  )
    throw new Error("MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED");
  return manifestFor(platform, architecture, artifact);
}
async function download(file, url, verify, offline) {
  if (!existsSync(file)) {
    if (offline) throw new Error("MANAGED_CODEX_RUNTIME_OFFLINE_CACHE_MISS");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error("MANAGED_CODEX_RUNTIME_DOWNLOAD_FAILED");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!verify(bytes)) throw new Error("MANAGED_CODEX_RUNTIME_ARCHIVE_CHECKSUM_FAILED");
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes, { flag: "wx" });
    try {
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  if (!verify(readFileSync(file))) throw new Error("MANAGED_CODEX_RUNTIME_ARCHIVE_CHECKSUM_FAILED");
}
export async function prepareCodexRuntime({
  platform = process.platform,
  architecture = process.arch,
  offline = false,
} = {}) {
  const artifact = lock.artifacts[`${platform}-${architecture}`];
  if (!artifact) throw new Error("MANAGED_CODEX_RUNTIME_TARGET_UNSUPPORTED");
  const destination = codexRuntimeDevelopmentDirectory(platform, architecture);
  if (existsSync(destination)) {
    verifyPreparedCodexRuntime(destination, platform, architecture);
    return destination;
  }
  const downloads = path.join(cacheRoot(), "downloads");
  mkdirSync(downloads, { recursive: true });
  const archive = path.join(downloads, artifact.archive);
  await download(
    archive,
    artifact.url,
    (bytes) =>
      bytes.length === artifact.archiveSize &&
      hash(bytes) === artifact.archiveSha256 &&
      `sha512-${hash(bytes, "sha512")}` === artifact.integrity,
    offline,
  );
  for (const license of lock.licenses)
    await download(
      path.join(downloads, `codex-${lock.codexVersion}-${license.path}`),
      license.url,
      (bytes) => bytes.length === license.size && hash(bytes) === license.sha256,
      offline,
    );
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, ".prepare-codex-"));
  // Only this newly created absolute directory may be recursively removed.
  const safeParent = realpathSync(parent);
  if (!path.isAbsolute(staging) || !realpathSync(staging).startsWith(`${safeParent}${path.sep}`))
    throw new Error("MANAGED_CODEX_RUNTIME_STAGING_REJECTED");
  try {
    const extraction = path.join(staging, "extract");
    mkdirSync(extraction);
    execFileSync(
      process.platform === "win32" ? "tar.exe" : "tar",
      ["-xzf", archive, "-C", extraction],
      { windowsHide: true, stdio: "pipe" },
    );
    const source = path.join(extraction, "package");
    const expected = artifact.files.filter(
      (entry) => !lock.licenses.some((license) => license.path === entry.path),
    );
    if (JSON.stringify(inventory(source)) !== JSON.stringify(expected))
      throw new Error("MANAGED_CODEX_RUNTIME_ARCHIVE_CONTENT_INVALID");
    const ready = path.join(staging, "ready");
    mkdirSync(ready);
    renameSync(source, path.join(ready, "files"));
    for (const license of lock.licenses)
      cpSync(
        path.join(downloads, `codex-${lock.codexVersion}-${license.path}`),
        path.join(ready, "files", license.path),
        { errorOnExist: true, force: false },
      );
    writeFileSync(
      path.join(ready, "manifest.json"),
      `${JSON.stringify(manifestFor(platform, architecture, artifact), null, 2)}\n`,
    );
    verifyPreparedCodexRuntime(ready, platform, architecture);
    try {
      renameSync(ready, destination);
    } catch (error) {
      if (!existsSync(destination)) throw error;
      verifyPreparedCodexRuntime(destination, platform, architecture);
    }
    return destination;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
export async function copyCodexRuntime(buildPath, platform, architecture) {
  if (platform !== "win32") return undefined;
  const source = await prepareCodexRuntime({
    platform,
    architecture,
    offline: process.env.OPENERX_RUNTIME_OFFLINE === "1",
  });
  const destination = path.join(buildPath, "runtime", "codex");
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  verifyPreparedCodexRuntime(destination, platform, architecture);
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name, fallback) => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
  };
  console.log(
    await prepareCodexRuntime({
      platform: value("--platform", process.platform),
      architecture: value("--arch", process.arch),
      offline: args.includes("--offline"),
    }),
  );
}
