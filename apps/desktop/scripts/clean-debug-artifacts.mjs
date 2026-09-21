import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const platformSuffix = "(?:darwin|mas|win32|linux)-(?:arm64|x64|ia32|armv7l|universal)";
const packageName = new RegExp(`^openerx(?:-.+)?-${platformSuffix}$`, "iu");
const canonicalPackageName = new RegExp(`^openerx-${platformSuffix}$`, "iu");
const artifactName = new RegExp(`^.+-${platformSuffix}$`, "iu");
const licenseFiles = new Set(["LICENSE", "LICENSES.chromium.html", "version", ".DS_Store"]);
const windowsRuntimeFiles = new Set([
  "locales",
  "resources",
  "icudtl.dat",
  "vk_swiftshader_icd.json",
]);

function stat(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Inspect only real directories below the specified build root. In particular,
// a linked checkpoint/build directory must never redirect cleanup elsewhere.
function isDirectoryWithin(root, directory) {
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return false;
  let current = root;
  if (!stat(current)?.isDirectory()) return false;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!stat(current)?.isDirectory()) return false;
  }
  return true;
}

function directories(root) {
  if (!stat(root)?.isDirectory()) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

function isElectronOutput(directory) {
  const version = path.join(directory, "version");
  return (
    stat(path.join(directory, "LICENSE"))?.isFile() &&
    stat(path.join(directory, "LICENSES.chromium.html"))?.isFile() &&
    stat(version)?.isFile() &&
    /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(readFileSync(version, "utf8").trim())
  );
}

function allocatedBytes(file) {
  const info = lstatSync(file);
  const ownBytes = info.blocks === undefined ? info.size : info.blocks * 512;
  if (!info.isDirectory()) return ownBytes;
  return readdirSync(file).reduce(
    (total, entry) => total + allocatedBytes(path.join(file, entry)),
    ownBytes,
  );
}

export function planDebugArtifactCleanup(desktopDirectory, { legacyCheckpoints = false } = {}) {
  const desktop = path.resolve(desktopDirectory);
  const candidates = [];
  const add = (root, directory, reason) => {
    if (isDirectoryWithin(root, directory)) {
      candidates.push({ root, directory, reason, bytes: allocatedBytes(directory) });
    }
  };
  add(desktop, path.join(desktop, ".vite"), "development cache");

  for (const outputName of ["out", "out-codex"]) {
    const root = path.join(desktop, outputName);
    for (const directory of directories(root)) {
      const name = path.basename(directory);
      if (!artifactName.test(name) || !isElectronOutput(directory)) continue;
      const entries = readdirSync(directory);
      const onlyLicenses = entries.every((entry) => licenseFiles.has(entry));
      const missingWindowsExecutable =
        canonicalPackageName.test(name) &&
        /-win32-/iu.test(name) &&
        entries.every(
          (entry) =>
            licenseFiles.has(entry) ||
            windowsRuntimeFiles.has(entry) ||
            /\.(?:dll|pak|bin)$/iu.test(entry),
        );
      const incomplete = onlyLicenses || missingWindowsExecutable;
      if (
        incomplete ||
        (packageName.test(name) && (outputName === "out-codex" || !canonicalPackageName.test(name)))
      ) {
        add(root, directory, incomplete ? "incomplete package residue" : "extra debug package");
      }
    }
  }

  if (legacyCheckpoints) {
    const parent = path.resolve(desktop, "../../..");
    for (const rootName of ["openerx-checkpoints", ".openerx-checkpoints"]) {
      const root = path.join(parent, rootName);
      for (const checkpoint of directories(root)) {
        const build = path.join(checkpoint, "build");
        if (!isDirectoryWithin(root, build)) continue;
        for (const directory of directories(build)) {
          if (packageName.test(path.basename(directory)) && isElectronOutput(directory)) {
            add(root, directory, "legacy checkpoint debug package");
          }
        }
      }
    }
  }
  return candidates;
}

function runningCommands() {
  // If process inspection fails, the caller aborts before removing any files.
  if (process.platform === "win32") {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { $_.ExecutablePath; $_.CommandLine }",
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
  }
  return execFileSync("ps", ["-axo", "command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function cleanDebugArtifacts(
  candidates,
  { apply = false, processCommands = runningCommands() } = {},
) {
  const normalizedCommandPath = (value) => value.replaceAll("\\", "/").toLowerCase();
  const commands = normalizedCommandPath(processCommands);
  return candidates.map((candidate) => {
    if (!isDirectoryWithin(candidate.root, candidate.directory)) {
      return { ...candidate, status: "skipped-path-changed" };
    }
    // Forge can launch Electron with a relative app path. Conservatively retain
    // caches while a Forge/Vite dev server is running, even in another checkout.
    const devServerRunning = /(?:electron-forge|vite)(?:[\s/\\.-]|$)|npm run dev:desktop/u.test(
      commands,
    );
    const used =
      [candidate.directory, realpathSync(candidate.directory)].some((directory) =>
        commands.includes(`${normalizedCommandPath(directory)}/`),
      ) ||
      (candidate.reason === "development cache" && devServerRunning);
    if (used) return { ...candidate, status: "skipped-running" };
    if (apply) rmSync(candidate.directory, { recursive: true, force: true });
    return { ...candidate, status: apply ? "removed" : "would-remove" };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--apply", "--legacy-checkpoints"].includes(arg))) {
    throw new Error("Usage: clean-debug-artifacts.mjs [--apply] [--legacy-checkpoints]");
  }
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const apply = args.includes("--apply");
  const candidates = planDebugArtifactCleanup(desktop, {
    legacyCheckpoints: args.includes("--legacy-checkpoints"),
  });
  const results = cleanDebugArtifacts(candidates, { apply });
  for (const result of results) {
    console.log(
      `[${result.status}] ${(result.bytes / 1024 ** 2).toFixed(1)} MiB ${result.directory} (${result.reason})`,
    );
  }
  const selected = results.filter((result) => ["removed", "would-remove"].includes(result.status));
  const bytes = selected.reduce((total, result) => total + result.bytes, 0);
  console.log(
    `[desktop-clean] ${apply ? "Removed" : "Preview"}: ${selected.length} directories, ${(bytes / 1024 ** 2).toFixed(1)} MiB of build artifacts.${apply ? "" : " Use --apply to remove them."}`,
  );
}
