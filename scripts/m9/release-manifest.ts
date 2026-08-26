import { readFileSync, writeFileSync } from "node:fs";
import { releaseManifestSchema, signedReleaseManifestSchema } from "@openerx/contracts";
import { signReleaseManifest, verifySignedReleaseManifest } from "@openerx/release";

const [command, inputPath, outputPath] = process.argv.slice(2);
if (!command || !inputPath) throw new Error("RELEASE_MANIFEST_USAGE");

function decodedEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`RELEASE_ENV_REQUIRED:${name}`);
  return Buffer.from(value, "base64").toString("utf8");
}

if (command === "sign") {
  if (!outputPath) throw new Error("RELEASE_MANIFEST_OUTPUT_REQUIRED");
  const payload = releaseManifestSchema.parse(JSON.parse(readFileSync(inputPath, "utf8")));
  const envelope = signReleaseManifest(
    payload,
    decodedEnvironment("OPENERX_UPDATE_MANIFEST_PRIVATE_KEY_BASE64"),
  );
  writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(
    `[m9-release-manifest] SIGNED version=${payload.version} channel=${payload.channel} targets=${payload.artifacts.length}\n`,
  );
} else if (command === "verify") {
  const envelope = signedReleaseManifestSchema.parse(JSON.parse(readFileSync(inputPath, "utf8")));
  const keyId = process.env.OPENERX_UPDATE_KEY_ID?.trim();
  if (!keyId) throw new Error("RELEASE_ENV_REQUIRED:OPENERX_UPDATE_KEY_ID");
  const payload = verifySignedReleaseManifest(
    envelope,
    keyId,
    decodedEnvironment("OPENERX_UPDATE_PUBLIC_KEY_BASE64"),
  );
  process.stdout.write(
    `[m9-release-manifest] VERIFIED version=${payload.version} channel=${payload.channel} targets=${payload.artifacts.length}\n`,
  );
} else {
  throw new Error("RELEASE_MANIFEST_COMMAND_INVALID");
}
