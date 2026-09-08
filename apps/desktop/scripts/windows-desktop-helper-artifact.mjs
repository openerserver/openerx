import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export function requiresHelperSigning(env = process.env) {
  return (
    (env.OPENERX_RELEASE_MODE === "1" && env.OPENERX_DISTRIBUTION !== "ms-store") ||
    env.OPENERX_REQUIRE_SIGNED_WINDOWS === "1" ||
    Boolean(env.WINDOWS_CERTIFICATE_FILE || env.OPENERX_WINDOWS_SIGN_THUMBPRINT)
  );
}

export function finalizeHelperArtifact(directory, architecture, sign) {
  const executable = path.join(directory, "openerx-desktop-helper.exe");
  const manifest = path.join(directory, "manifest.json");
  // A failed sign must not leave a seemingly valid manifest from a prior build.
  rmSync(manifest, { force: true });
  sign?.(executable);
  const value = {
    contractVersion: "desktop_control_v2",
    architecture,
    sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
  };
  writeFileSync(manifest, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
