import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  type ReleaseArch,
  type ReleaseArtifact,
  type ReleaseChannel,
  type ReleaseManifest,
  type ReleasePlatform,
  releaseManifestSchema,
  releaseVersionSchema,
  type SignedReleaseManifest,
  signedReleaseManifestSchema,
} from "@openerx/contracts";

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("RELEASE_MANIFEST_NONFINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`)
      .join(",")}}`;
  }
  throw new Error("RELEASE_MANIFEST_VALUE_INVALID");
}

export function canonicalReleaseManifest(input: ReleaseManifest): string {
  return canonicalValue(releaseManifestSchema.parse(input));
}

function assertEd25519Key(key: ReturnType<typeof createPrivateKey | typeof createPublicKey>): void {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("RELEASE_MANIFEST_KEY_NOT_ED25519");
}

export function signReleaseManifest(
  input: ReleaseManifest,
  privateKeyPem: string,
): SignedReleaseManifest {
  const payload = releaseManifestSchema.parse(input);
  const privateKey = createPrivateKey(privateKeyPem);
  assertEd25519Key(privateKey);
  return signedReleaseManifestSchema.parse({
    algorithm: "ed25519",
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalReleaseManifest(payload), "utf8"),
      privateKey,
    ).toString("base64"),
  });
}

export function verifySignedReleaseManifest(
  input: SignedReleaseManifest,
  expectedKeyId: string,
  publicKeyPem: string,
): ReleaseManifest {
  const envelope = signedReleaseManifestSchema.parse(input);
  if (envelope.payload.keyId !== expectedKeyId) throw new Error("RELEASE_MANIFEST_KEY_ID_MISMATCH");
  const publicKey = createPublicKey(publicKeyPem);
  assertEd25519Key(publicKey);
  const valid = verify(
    null,
    Buffer.from(canonicalReleaseManifest(envelope.payload), "utf8"),
    publicKey,
    Buffer.from(envelope.signature, "base64"),
  );
  if (!valid) throw new Error("RELEASE_MANIFEST_SIGNATURE_INVALID");
  return envelope.payload;
}

export function selectReleaseArtifact(
  manifest: ReleaseManifest,
  platform: ReleasePlatform,
  arch: ReleaseArch,
): ReleaseArtifact {
  const candidates = manifest.artifacts.filter(
    (artifact) => artifact.platform === platform && artifact.arch === arch,
  );
  const preferredKind = platform === "win32" ? "squirrel" : "zip";
  const selected = candidates.find(({ kind }) => kind === preferredKind) ?? candidates[0];
  if (!selected)
    throw new Error(`RELEASE_ARTIFACT_NOT_FOUND_${platform.toUpperCase()}_${arch.toUpperCase()}`);
  return selected;
}

interface ParsedVersion {
  core: [string, string, string];
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion {
  const version = releaseVersionSchema.parse(value);
  const withoutBuild = version.includes("+") ? version.slice(0, version.indexOf("+")) : version;
  const prereleaseIndex = withoutBuild.indexOf("-");
  const coreValue = prereleaseIndex < 0 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex);
  const prereleaseValue = prereleaseIndex < 0 ? "" : withoutBuild.slice(prereleaseIndex + 1);
  const core = coreValue.split(".");
  return {
    core: [core[0] ?? "0", core[1] ?? "0", core[2] ?? "0"],
    prerelease: prereleaseValue ? prereleaseValue.split(".") : [],
  };
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return compareNumericIdentifier(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareReleaseVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const difference = compareNumericIdentifier(
      parsedLeft.core[index] ?? "0",
      parsedRight.core[index] ?? "0",
    );
    if (difference !== 0) return Math.sign(difference);
  }
  if (parsedLeft.prerelease.length === 0 || parsedRight.prerelease.length === 0) {
    return parsedLeft.prerelease.length === parsedRight.prerelease.length
      ? 0
      : parsedLeft.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = parsedLeft.prerelease[index];
    const rightPart = parsedRight.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    const difference = compareIdentifier(leftPart, rightPart);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function isReleaseNewer(candidate: string, current: string): boolean {
  return compareReleaseVersions(candidate, current) > 0;
}

export function releaseRolloutBucket(manifest: ReleaseManifest, cohortId: string): number {
  if (!cohortId.trim()) throw new Error("RELEASE_COHORT_ID_REQUIRED");
  return (
    createHash("sha256")
      .update(`${manifest.keyId}\0${manifest.version}\0${cohortId}`, "utf8")
      .digest()
      .readUInt32BE(0) % 100
  );
}

export function isReleaseEligible(
  manifest: ReleaseManifest,
  currentVersion: string,
  cohortId: string,
): boolean {
  if (!isReleaseNewer(manifest.version, currentVersion)) return false;
  if (
    manifest.minimumVersion !== null &&
    compareReleaseVersions(currentVersion, manifest.minimumVersion) < 0
  ) {
    return true;
  }
  return releaseRolloutBucket(manifest, cohortId) < manifest.rolloutPercentage;
}

export function assertReleaseChannel(actual: ReleaseChannel, expected: ReleaseChannel): void {
  if (actual !== expected) throw new Error("RELEASE_MANIFEST_CHANNEL_MISMATCH");
}
