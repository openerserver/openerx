import { spawnSync } from "node:child_process";

// A Developer ID designated requirement survives normal app updates. Ad-hoc
// signatures identify one build only, so macOS privacy grants may not carry over.
export function resolveMacSigningIdentity(
  env = process.env,
  lookup = () =>
    spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      timeout: 10000,
    }),
) {
  const configured = env.OPENERX_MAC_SIGN_IDENTITY?.trim();
  if (configured) return configured;
  // Distribution jobs must continue to select their intended signing identity.
  if (env.OPENERX_RELEASE_MODE === "1" || env.OPENERX_REQUIRE_SIGNED_MACOS === "1")
    throw new Error("RELEASE_ENV_REQUIRED:OPENERX_MAC_SIGN_IDENTITY");
  const result = lookup();
  if (result.error || result.status !== 0) throw new Error("MAC_SIGNING_IDENTITY_LOOKUP_FAILED");
  const identities = new Map();
  for (const match of (result.stdout ?? "").matchAll(
    /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application:[^"\r\n]+)"\s*$/gm,
  ))
    identities.set(match[1].toUpperCase(), match[2]);
  if (identities.size > 1)
    throw new Error("MAC_SIGNING_IDENTITY_AMBIGUOUS: set OPENERX_MAC_SIGN_IDENTITY");
  return identities.values().next().value ?? null;
}
