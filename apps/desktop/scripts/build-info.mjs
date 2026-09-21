import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function createBuildInfo(root, now = new Date()) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/u.test(version) || version === "0.0.0")
    throw new Error("PRODUCT_VERSION_REQUIRED");
  const builtAt = now.toISOString();
  const minutes = Math.floor((now.getTime() - Date.UTC(2020, 0, 1)) / 60000);
  const days = Math.floor(minutes / 1440);
  if (days < 1 || days > 9999) throw new Error("BUILD_DATE_OUT_OF_RANGE");
  let revision = "unknown",
    dirty = false;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    dirty = Boolean(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    if (process.env.OPENERX_RELEASE_MODE === "1") throw new Error("RELEASE_REVISION_REQUIRED");
  }
  return {
    version,
    builtAt,
    revision,
    dirty,
    buildId: builtAt.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z"),
    nativeBuildNumber: `${days}.${now.getUTCHours()}.${now.getUTCMinutes()}`,
    androidVersionCode: minutes + 1,
  };
}

// Forge, its Vite workers and native packaging share the same immutable stamp.
// Only a new build creates a new stamp; renderer hot reload keeps its identity.
export function getBuildInfo(root) {
  if (!process.env.OPENERX_BUILD_INFO) {
    process.env.OPENERX_BUILD_INFO = JSON.stringify(createBuildInfo(root));
  }
  const info = JSON.parse(process.env.OPENERX_BUILD_INFO);
  const expected = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  if (
    info.version !== expected ||
    !/^\d{8}T\d{6}Z$/u.test(info.buildId) ||
    !/^\d{1,4}\.\d{1,2}\.\d{1,2}$/u.test(info.nativeBuildNumber) ||
    !Number.isSafeInteger(info.androidVersionCode) ||
    info.androidVersionCode < 1 ||
    info.androidVersionCode > 2100000000 ||
    !Number.isFinite(Date.parse(info.builtAt)) ||
    !/^(?:[a-f0-9]{40,64}|unknown)$/u.test(info.revision) ||
    typeof info.dirty !== "boolean"
  )
    throw new Error("BUILD_INFO_INVALID");
  return Object.freeze(info);
}
