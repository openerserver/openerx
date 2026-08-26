import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(desktopRoot, "out");
const requireSigned = process.env.OPENERX_RELEASE_MODE === "1";

function find(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) return [absolute];
    if (entry.isDirectory()) return find(absolute);
    return entry.isFile() && entry.name.toLowerCase() === "openerx.exe" ? [absolute] : [];
  });
}

const targets = find(outRoot);
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
    if (!/Authority=Developer ID Application:/u.test(output) || /Signature=adhoc/u.test(output)) {
      throw new Error(`MAC_DEVELOPER_ID_MISSING:${relative}`);
    }
    const staple = spawnSync("xcrun", ["stapler", "validate", target], { encoding: "utf8" });
    if (staple.status !== 0) throw new Error(`MAC_NOTARIZATION_TICKET_INVALID:${relative}`);
  } else {
    if (process.platform !== "win32") throw new Error("WINDOWS_SIGNATURE_REQUIRES_WINDOWS_RUNNER");
    const escaped = target.replaceAll("'", "''");
    const signature = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($s.Status -ne 'Valid') { exit 1 }`,
      ],
      { encoding: "utf8" },
    );
    if (signature.status !== 0) throw new Error(`WINDOWS_AUTHENTICODE_INVALID:${relative}`);
  }
  console.log(`[m9-native-signature] SIGNED OK: ${relative}`);
}
