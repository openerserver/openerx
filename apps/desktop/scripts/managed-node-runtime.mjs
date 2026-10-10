import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
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

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const runtimeLock = JSON.parse(
  readFileSync(
    path.join(desktopRoot, "../../packages/tool-sdk/src/managed-node-runtime-lock.json"),
    "utf8",
  ),
);
export const runtimeDevelopmentDirectory = (
  platform = process.platform,
  architecture = process.arch,
) =>
  path.join(
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : path.join(os.homedir(), ".cache"),
    "openerx-runtime-cache",
    "runtimes",
    `${runtimeLock.nodeVersion}-${runtimeLock.schemaVersion}`,
    `${platform}-${architecture}`,
  );
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function filesIn(root, relative = "") {
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("MANAGED_NODE_RUNTIME_LINK_REJECTED");
      if (entry.isDirectory()) return filesIn(root, name);
      if (!entry.isFile()) throw new Error("MANAGED_NODE_RUNTIME_FILE_REJECTED");
      const bytes = readFileSync(path.join(root, name));
      return [{ path: name, size: bytes.length, sha256: sha256(bytes) }];
    });
}
export function verifyPreparedNodeRuntime(
  directory,
  platform = process.platform,
  architecture = process.arch,
  suppliedManifest,
) {
  const manifest =
    suppliedManifest ?? JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const artifact = runtimeLock.artifacts[`${platform}-${architecture}`];
  if (
    !artifact ||
    manifest.schemaVersion !== 1 ||
    manifest.nodeVersion !== runtimeLock.nodeVersion ||
    manifest.npmVersion !== runtimeLock.npmVersion ||
    manifest.platform !== platform ||
    manifest.architecture !== architecture ||
    manifest.archive !== artifact.file ||
    manifest.archiveSha256 !== artifact.sha256
  )
    throw new Error("MANAGED_NODE_RUNTIME_MANIFEST_INVALID");
  if (JSON.stringify(filesIn(path.join(directory, "files"))) !== JSON.stringify(manifest.files))
    throw new Error("MANAGED_NODE_RUNTIME_INTEGRITY_FAILED");
  const npm = platform === "win32" ? "node_modules/npm" : "lib/node_modules/npm";
  if (
    JSON.parse(readFileSync(path.join(directory, "files", npm, "package.json"), "utf8")).version !==
    runtimeLock.npmVersion
  )
    throw new Error("MANAGED_NODE_RUNTIME_NPM_VERSION_INVALID");
  for (const required of [
    platform === "win32" ? "node.exe" : "bin/node",
    `${npm}/bin/npm-cli.js`,
    `${npm}/bin/npx-cli.js`,
    "LICENSE",
    "NOTICE.txt",
    "npmrc",
    "npmrc-global",
    "third-party-notices.json",
  ]) {
    if (!manifest.files.some((file) => file.path === required))
      throw new Error("MANAGED_NODE_RUNTIME_ENTRY_MISSING");
  }
  return manifest;
}
export async function prepareNodeRuntime({
  platform = process.platform,
  architecture = process.arch,
  offline = false,
} = {}) {
  const target = `${platform}-${architecture}`;
  const artifact = runtimeLock.artifacts[target];
  if (!artifact) throw new Error("MANAGED_NODE_RUNTIME_TARGET_UNSUPPORTED");
  const destination = runtimeDevelopmentDirectory(platform, architecture);
  if (existsSync(destination)) {
    verifyPreparedNodeRuntime(destination, platform, architecture);
    return destination;
  }
  const cache = path.join(
    platform === "win32" && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : path.join(os.homedir(), ".cache"),
    "openerx-runtime-cache",
    "downloads",
  );
  mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, artifact.file);
  if (!existsSync(archive)) {
    if (offline) throw new Error("MANAGED_NODE_RUNTIME_OFFLINE_CACHE_MISS");
    const response = await fetch(new URL(artifact.file, runtimeLock.source), {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || new URL(response.url).origin !== "https://nodejs.org")
      throw new Error("MANAGED_NODE_RUNTIME_DOWNLOAD_FAILED");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 150_000_000 || sha256(bytes) !== artifact.sha256)
      throw new Error("MANAGED_NODE_RUNTIME_ARCHIVE_CHECKSUM_FAILED");
    const temporary = `${archive}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes, { flag: "wx" });
    try {
      renameSync(temporary, archive);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  if (sha256(readFileSync(archive)) !== artifact.sha256)
    throw new Error("MANAGED_NODE_RUNTIME_ARCHIVE_CHECKSUM_FAILED");
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, ".prepare-"));
  try {
    const extraction = path.join(staging, "extract");
    mkdirSync(extraction);
    if (artifact.file.endsWith(".zip")) {
      // Windows ships bsdtar; paths remain distinct argv, including spaces.
      execFileSync("tar.exe", ["-xf", archive, "-C", extraction], {
        windowsHide: true,
        stdio: "pipe",
      });
    } else {
      execFileSync("tar", ["-xzf", archive, "-C", extraction], { stdio: "pipe" });
    }
    const source = path.join(extraction, artifact.file.replace(/\.(?:zip|tar\.gz)$/u, ""));
    const output = path.join(staging, "ready");
    const files = path.join(output, "files");
    mkdirSync(files, { recursive: true });
    const npm = platform === "win32" ? "node_modules/npm" : "lib/node_modules/npm";
    const copy = (relative) => {
      const from = path.join(source, relative);
      const actual = realpathSync(from);
      if (!actual.startsWith(`${realpathSync(source)}${path.sep}`))
        throw new Error("MANAGED_NODE_RUNTIME_ARCHIVE_ESCAPE");
      mkdirSync(path.dirname(path.join(files, relative)), { recursive: true });
      cpSync(actual, path.join(files, relative), {
        recursive: true,
        dereference: true,
        errorOnExist: true,
      });
    };
    copy(platform === "win32" ? "node.exe" : "bin/node");
    copy(npm);
    copy("LICENSE");
    if (platform === "win32") {
      for (const launcher of ["npm", "npm.cmd", "npx", "npx.cmd"]) copy(launcher);
    } else {
      for (const tool of ["npm", "npx"]) {
        writeFileSync(
          path.join(files, "bin", tool),
          `#!/usr/bin/env node\nrequire("../lib/node_modules/npm/bin/${tool}-cli.js");\n`,
          { mode: 0o755 },
        );
      }
    }
    writeFileSync(path.join(files, "npmrc"), "# Application-controlled empty npm configuration.\n");
    writeFileSync(
      path.join(files, "npmrc-global"),
      "# Application-controlled empty global npm configuration.\n",
    );
    const components = [
      {
        name: "node",
        version: runtimeLock.nodeVersion,
        license: "MIT AND bundled third-party licenses",
        licenseFiles: ["LICENSE"],
      },
    ];
    for (const file of filesIn(path.join(files, npm))) {
      if (path.basename(file.path) !== "package.json") continue;
      const pkg = JSON.parse(readFileSync(path.join(files, npm, file.path), "utf8"));
      if (typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
      const relative = path.posix.dirname(`${npm}/${file.path}`);
      const licenseFiles = readdirSync(path.join(files, relative))
        .filter((name) => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/iu.test(name))
        .map((name) => `${relative}/${name}`);
      components.push({
        name: pkg.name,
        version: pkg.version,
        license: typeof pkg.license === "string" ? pkg.license : "See accompanying distribution",
        licenseFiles,
      });
    }
    writeFileSync(
      path.join(files, "third-party-notices.json"),
      `${JSON.stringify({ source: runtimeLock.source + artifact.file, archiveSha256: artifact.sha256, components }, null, 2)}\n`,
    );
    writeFileSync(
      path.join(files, "NOTICE.txt"),
      `Node.js ${runtimeLock.nodeVersion} with npm ${runtimeLock.npmVersion}\nOfficial distribution: ${runtimeLock.source}${artifact.file}\nArchive SHA256: ${artifact.sha256}\nNode.js and its bundled third-party notices: LICENSE\nnpm and dependency licenses: ${npm}/LICENSE and the accompanying complete npm tree.\nNo npm dependencies are installed or altered while preparing this runtime.\n`,
    );
    const manifest = {
      schemaVersion: 1,
      nodeVersion: runtimeLock.nodeVersion,
      npmVersion: runtimeLock.npmVersion,
      platform,
      architecture,
      archive: artifact.file,
      archiveSha256: artifact.sha256,
      files: filesIn(files),
    };
    writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    verifyPreparedNodeRuntime(output, platform, architecture);
    try {
      renameSync(output, destination);
    } catch (error) {
      if (!existsSync(destination)) throw error;
      verifyPreparedNodeRuntime(destination, platform, architecture);
    }
    return destination;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
export async function copyNodeRuntime(buildPath, platform, architecture, signExecutable) {
  const source = await prepareNodeRuntime({
    platform,
    architecture,
    offline: process.env.OPENERX_RUNTIME_OFFLINE === "1",
  });
  const destination = path.join(buildPath, "runtime", "node");
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  if (signExecutable) {
    const manifest = verifyPreparedNodeRuntime(destination, platform, architecture);
    const executable = path.join(
      destination,
      "files",
      platform === "win32" ? "node.exe" : "bin/node",
    );
    signExecutable(executable);
    manifest.files = filesIn(path.join(destination, "files"));
    writeFileSync(
      path.join(destination, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  verifyPreparedNodeRuntime(destination, platform, architecture);
  return destination;
}
