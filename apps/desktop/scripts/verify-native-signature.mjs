import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopArtifactIdentity } from "./desktop-artifact-identity.mjs";
import { verifyWindowsFile } from "./windows-signing.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const product = desktopArtifactIdentity(desktopRoot);
const outRoot = process.env.OPENERX_PACKAGE_OUT_DIR
  ? path.resolve(process.env.OPENERX_PACKAGE_OUT_DIR)
  : path.join(desktopRoot, "out");
const releaseMode = process.env.OPENERX_RELEASE_MODE === "1";
const requireSigned =
  releaseMode ||
  process.env.OPENERX_REQUIRE_SIGNED_MACOS === "1" ||
  process.env.OPENERX_REQUIRE_SIGNED_WINDOWS === "1";
const requireNotarized = releaseMode || process.env.OPENERX_REQUIRE_NOTARIZED_MACOS === "1";
const brandManifestPath = process.env.OPENERX_BRAND_MANIFEST;
const executableName = brandManifestPath
  ? JSON.parse(readFileSync(path.resolve(brandManifestPath), "utf8")).executableName
  : "OpenERX";
const selectedTarget =
  process.env.OPENERX_RELEASE_TARGET ??
  (process.env.OPENERX_REQUIRE_SIGNED_MACOS === "1" ? `${process.platform}-${process.arch}` : null);

function find(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) return [absolute];
    if (entry.isDirectory()) return find(absolute);
    return entry.isFile() && entry.name === `${executableName}.exe` ? [absolute] : [];
  });
}

const targets = find(outRoot).filter(
  (target) =>
    !selectedTarget ||
    target.includes(`${path.sep}${product.productName}-${selectedTarget}${path.sep}`),
);
if (targets.length === 0) throw new Error("RELEASE_NATIVE_TARGET_NOT_FOUND");

for (const target of targets) {
  const relative = path.relative(desktopRoot, target);
  if (!requireSigned) {
    console.log(`[m9-native-signature] LOCAL UNSIGNED: ${relative}`);
    continue;
  }
  if (target.endsWith(".app")) {
    if (process.platform !== "darwin") throw new Error("MAC_SIGNATURE_REQUIRES_MACOS_RUNNER");
    const verify = spawnSync(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", target],
      {
        encoding: "utf8",
      },
    );
    if (verify.status !== 0) throw new Error(`MAC_CODE_SIGNATURE_INVALID:${relative}`);
    const details = spawnSync("codesign", ["-dv", "--verbose=4", target], { encoding: "utf8" });
    const output = `${details.stdout}${details.stderr}`;
    if (
      !/Authority=Developer ID Application:/u.test(output) ||
      /Signature=adhoc/u.test(output) ||
      !/TeamIdentifier=[A-Z0-9]{10}/u.test(output) ||
      !/(?:flags=0x[0-9a-f]+\(runtime\)|Runtime Version=)/u.test(output)
    ) {
      throw new Error(`MAC_DEVELOPER_ID_MISSING:${relative}`);
    }
    const identifier = spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleIdentifier", path.join(target, "Contents", "Info.plist")],
      { encoding: "utf8" },
    );
    if (identifier.status !== 0 || identifier.stdout.trim() !== "com.openerx.desktop") {
      throw new Error(`MAC_BUNDLE_IDENTIFIER_INVALID:${relative}`);
    }
    const usage = spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :NSAppleEventsUsageDescription", path.join(target, "Contents", "Info.plist")],
      { encoding: "utf8" },
    );
    if (usage.status !== 0 || usage.stdout.trim().length < 20) {
      throw new Error(`MAC_APPLE_EVENTS_USAGE_DESCRIPTION_MISSING:${relative}`);
    }
    const entitlements = spawnSync("codesign", ["-d", "--entitlements", ":-", target], {
      encoding: "utf8",
    });
    const entitlementOutput = `${entitlements.stdout}${entitlements.stderr}`;
    if (
      entitlements.status !== 0 ||
      !/<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\s*\/>/u.test(
        entitlementOutput,
      ) ||
      !/<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/u.test(entitlementOutput)
    ) {
      throw new Error(`MAC_DESKTOP_ENTITLEMENTS_INVALID:${relative}`);
    }
    const requirement = spawnSync("codesign", ["-dr", "-", target], { encoding: "utf8" });
    const requirementOutput = `${requirement.stdout}${requirement.stderr}`;
    if (
      requirement.status !== 0 ||
      !/identifier "com\.openerx\.desktop"/u.test(requirementOutput) ||
      !/anchor apple generic/u.test(requirementOutput)
    ) {
      throw new Error(`MAC_DESIGNATED_REQUIREMENT_INVALID:${relative}`);
    }
    if (requireNotarized) {
      const staple = spawnSync("xcrun", ["stapler", "validate", target], { encoding: "utf8" });
      if (staple.status !== 0) throw new Error(`MAC_NOTARIZATION_TICKET_INVALID:${relative}`);
    }
  } else {
    if (process.platform !== "win32") throw new Error("WINDOWS_SIGNATURE_REQUIRES_WINDOWS_RUNNER");
    verifyWindowsFile(target);
    const helper = path.join(
      path.dirname(target),
      "resources",
      "app.asar.unpacked",
      "native",
      "windows-desktop-control",
      "openerx-desktop-helper.exe",
    );
    if (existsSync(helper)) {
      verifyWindowsFile(helper, process.env, undefined, true);
    }
  }
  console.log(
    `[m9-native-signature] SIGNED OK: ${relative}; notarization=${requireNotarized ? "valid" : "not-required"}`,
  );
}
