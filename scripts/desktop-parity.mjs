import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Track executable desktop code, its packages and the common remote gateway.
// Mobile apps and edition services have their own contracts and regressions.
export function inScope(file) {
  return (
    /^(?:apps\/desktop\/(?:src|native|scripts|tests|browser-extension)\/|packages\/|services\/(?:platform-alpha|remote-control-gateway)\/)/u.test(
      file,
    ) ||
    /^apps\/desktop\/(?:package\.json|tsconfig\.json|forge\.config\.ts|vite\.[^/]+\.(?:mts|ts))$/u.test(
      file,
    ) ||
    /^tests\/v2\/remote-[^/]+\.test\.ts$/u.test(file) ||
    file === "tests/v2/fixtures/platform-alpha.ts" ||
    [
      "scripts/desktop-parity.mjs",
      "scripts/test-desktop-common.mjs",
      "tests/desktop-parity.test.mjs",
    ].includes(file)
  );
}

export function inventory(root) {
  root = realpathSync(root);
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  )
    .toString()
    .split("\0")
    .filter(inScope);
  const result = {};
  for (const file of [...new Set(paths)].sort()) {
    const absolute = path.resolve(root, file);
    let resolved;
    try {
      resolved = realpathSync(absolute);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!resolved.startsWith(`${root}${path.sep}`))
      throw new Error(`PARITY_PATH_OUTSIDE_ROOT: ${file}`);
    // Git may check out CRLF on Windows. Compare content, independent of EOL.
    const bytes = readFileSync(absolute);
    let content = bytes;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
    } catch {
      /* Binary resources retain their exact bytes. */
    }
    result[file] = createHash("sha256").update(content).digest("hex");
  }
  return result;
}

export function createBaseline(source, core, sourceRevision, reasons) {
  if (!/^[a-f0-9]{40}$/u.test(sourceRevision)) throw new Error("PARITY_SOURCE_REVISION_INVALID");
  const files = {};
  for (const file of [...new Set([...Object.keys(source), ...Object.keys(core)])].sort()) {
    const a = source[file] ?? null,
      b = core[file] ?? null;
    if (a !== b && !reasons[file]?.trim())
      throw new Error(`PARITY_OVERLAY_REASON_REQUIRED: ${file}`);
    if (a === b && reasons[file]) throw new Error(`PARITY_OBSOLETE_OVERLAY: ${file}`);
    files[file] = a === b ? { sha256: a } : { source: a, core: b, reason: reasons[file] };
  }
  for (const file of Object.keys(reasons))
    if (!files[file]) throw new Error(`PARITY_UNKNOWN_OVERLAY: ${file}`);
  return { version: 1, sourceRevision, files };
}

export function compareBaseline(manifest, actual, side) {
  if (
    manifest.version !== 1 ||
    !manifest.files ||
    !["source", "core"].includes(side) ||
    !/^[a-f0-9]{40}$/u.test(manifest.sourceRevision)
  )
    throw new Error("PARITY_MANIFEST_INVALID");
  const errors = [];
  for (const file of new Set([...Object.keys(manifest.files), ...Object.keys(actual)])) {
    const entry = manifest.files[file];
    if (!entry) {
      errors.push(`${side}: unreviewed addition ${file}`);
      continue;
    }
    const expected = entry.sha256 ?? entry[side];
    if (
      !inScope(file) ||
      (expected !== null && !/^[a-f0-9]{64}$/u.test(expected ?? "")) ||
      (!entry.sha256 && (!entry.reason?.trim() || entry.source === entry.core))
    )
      throw new Error(`PARITY_ENTRY_INVALID: ${file}`);
    if ((actual[file] ?? null) !== expected) errors.push(`${side}: changed or missing ${file}`);
  }
  return errors;
}

export function checkParity({ manifestPath, coreRoot, sourceRoot }) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const errors = compareBaseline(manifest, inventory(coreRoot), "core");
  if (sourceRoot) errors.push(...compareBaseline(manifest, inventory(sourceRoot), "source"));
  if (errors.length)
    throw new Error(
      `DESKTOP_PARITY_DRIFT\n${errors.join("\n")}\nReview the source delta and edition overlays, run the common regressions, then record a new baseline.`,
    );
  const entries = Object.values(manifest.files);
  return {
    sourceRevision: manifest.sourceRevision,
    sharedFiles: entries.filter((e) => e.sha256).length,
    editionOverlays: entries.filter((e) => !e.sha256).length,
    sourceChecked: Boolean(sourceRoot),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {};
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === "--record") options.record = true;
      else if (
        ["--manifest", "--core-root", "--source-root", "--overlays"].includes(flag) &&
        args[i + 1]
      )
        options[flag.slice(2)] = path.resolve(args[++i]);
      else throw new Error(`PARITY_ARGUMENT_INVALID: ${flag}`);
    }
    if (!options.manifest || !options["core-root"])
      throw new Error("PARITY_MANIFEST_AND_CORE_REQUIRED");
    if (options.record) {
      if (!options["source-root"] || !options.overlays)
        throw new Error("PARITY_RECORD_REQUIRES_SOURCE_AND_REVIEWED_OVERLAYS");
      const sourceRoot = options["source-root"];
      const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: sourceRoot }).toString();
      if (dirty.trim()) throw new Error("PARITY_COMMIT_SOURCE_BEFORE_RECORDING");
      const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })
        .toString()
        .trim();
      const baseline = createBaseline(
        inventory(sourceRoot),
        inventory(options["core-root"]),
        revision,
        JSON.parse(readFileSync(options.overlays, "utf8")),
      );
      writeFileSync(options.manifest, `${JSON.stringify(baseline, null, 2)}\n`);
    }
    console.log(
      JSON.stringify(
        checkParity({
          manifestPath: options.manifest,
          coreRoot: options["core-root"],
          sourceRoot: options["source-root"],
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
