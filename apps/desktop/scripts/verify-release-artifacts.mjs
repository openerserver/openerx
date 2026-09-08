import { createHash } from "node:crypto";
import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(desktopRoot, "../..");
const outRoot = process.env.OPENERX_PACKAGE_OUT_DIR
  ? path.resolve(process.env.OPENERX_PACKAGE_OUT_DIR)
  : path.join(desktopRoot, "out");
const releaseMode = process.env.OPENERX_RELEASE_MODE === "1";
const windowsStoreBuild = process.env.OPENERX_DISTRIBUTION === "ms-store";
const expectedVersion = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
).version;

function find(directory, name) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return find(absolute, name);
    return entry.isFile() && entry.name === name ? [absolute] : [];
  });
}

const target = process.env.OPENERX_RELEASE_TARGET ?? `${process.platform}-${process.arch}`;
const packages = find(outRoot, "app.asar").filter((archive) =>
  archive.includes(`${path.sep}OpenERX-${target}${path.sep}`),
);
if (packages.length === 0) throw new Error("RELEASE_ASAR_NOT_FOUND");

for (const archive of packages) {
  const relative = path.relative(desktopRoot, archive);
  const listedEntries = listPackage(archive);
  const originalEntryByNormalized = new Map(
    listedEntries.map((entry) => [entry.replaceAll("\\", "/"), entry]),
  );
  const entries = [...originalEntryByNormalized.keys()];
  if (target === "win32-x64") {
    const manifestEntry = originalEntryByNormalized.get(
      "/native/windows-desktop-control/manifest.json",
    );
    if (!manifestEntry) throw new Error("RELEASE_WINDOWS_DESKTOP_MANIFEST_MISSING");
    const manifest = JSON.parse(
      extractFile(archive, manifestEntry.replace(/^[/\\]/u, "")).toString("utf8"),
    );
    const executable = path.join(
      `${archive}.unpacked`,
      "native",
      "windows-desktop-control",
      "openerx-desktop-helper.exe",
    );
    if (
      manifest.contractVersion !== "desktop_control_v2" ||
      manifest.architecture !== "x64" ||
      createHash("sha256").update(readFileSync(executable)).digest("hex") !== manifest.sha256
    )
      throw new Error("RELEASE_WINDOWS_DESKTOP_INTEGRITY_FAILED");
  }
  if (target.startsWith("darwin-") || target.startsWith("mas-")) {
    const browserHelper = path.join(
      `${archive}.unpacked`,
      "native",
      "openerx-browser-accessibility",
    );
    try {
      accessSync(browserHelper, constants.X_OK);
    } catch {
      throw new Error("RELEASE_MAC_BROWSER_HELPER_MISSING");
    }
  }
  for (const required of [
    "/package.json",
    "/.vite/build/main.js",
    "/.vite/build/preload.js",
    "/.vite/build/app-service.js",
    "/.vite/build/pi-host.js",
    "/.vite/build/remote-host.js",
    "/release/update-config.json",
    "/legal/LICENSE",
    "/legal/NOTICE",
    "/legal/THIRD_PARTY_NOTICES.md",
    "/legal/THIRD_PARTY_LICENSES.txt",
    "/legal/third-party/notices.json",
  ]) {
    if (!entries.includes(required)) throw new Error(`RELEASE_ASAR_ENTRY_MISSING:${required}`);
  }
  const forbidden = entries.filter((entry) =>
    /(?:^|\/)(?:v1-backup|\.env(?:\.|$)|pi-host-test\.js|platform-alpha-test\.mjs|remote-e2e\.mjs)(?:\/|$)/u.test(
      entry,
    ),
  );
  if (forbidden.length > 0) throw new Error(`RELEASE_ASAR_FORBIDDEN_ENTRY:${forbidden[0]}`);
  if (releaseMode) {
    const sourceMap = entries.find((entry) => entry.endsWith(".map"));
    if (sourceMap) throw new Error(`RELEASE_ASAR_SOURCE_MAP:${sourceMap}`);
  }

  const packageJson = JSON.parse(extractFile(archive, "package.json").toString("utf8"));
  if (packageJson.version !== expectedVersion) throw new Error("RELEASE_PACKAGE_VERSION_MISMATCH");
  const updateConfig = JSON.parse(
    extractFile(archive, "release/update-config.json").toString("utf8"),
  );
  if (releaseMode && !windowsStoreBuild && updateConfig.enabled !== true)
    throw new Error("RELEASE_UPDATE_CONFIG_DISABLED");
  if ((!releaseMode || windowsStoreBuild) && updateConfig.enabled !== false) {
    throw new Error("DEVELOPMENT_UPDATE_CONFIG_ENABLED");
  }

  const rendererScripts = entries.filter(
    (entry) => entry.includes("/.vite/renderer/") && entry.endsWith(".js"),
  );
  const updateBoundaryValues = [
    updateConfig.manifestUrl,
    updateConfig.publicKeyPem,
    updateConfig.keyId,
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const entry of rendererScripts) {
    const originalEntry = originalEntryByNormalized.get(entry) ?? entry;
    const source = extractFile(archive, originalEntry.replace(/^[\\/]/u, "")).toString("utf8");
    if (updateBoundaryValues.some((value) => source.includes(value))) {
      throw new Error(`RELEASE_RENDERER_UPDATE_SECRET_BOUNDARY:${entry}`);
    }
  }
  console.log(
    `[m9-release-artifact] OK: ${relative}; version=${packageJson.version}; update=${updateConfig.enabled ? updateConfig.channel : "disabled"}`,
  );
}
