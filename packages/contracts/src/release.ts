import { z } from "zod";

export const releaseVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  )
  .refine((version) => {
    const withoutBuild = version.includes("+") ? version.slice(0, version.indexOf("+")) : version;
    const prereleaseIndex = withoutBuild.indexOf("-");
    if (prereleaseIndex < 0) return true;
    return withoutBuild
      .slice(prereleaseIndex + 1)
      .split(".")
      .every((identifier) => !/^0\d+$/u.test(identifier));
  }, "Numeric prerelease identifiers must not contain leading zeroes");
export const releaseChannelSchema = z.enum(["internal", "preview", "stable"]);
export const releasePlatformSchema = z.enum(["darwin", "win32"]);
export const releaseArchSchema = z.enum(["arm64", "x64"]);

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Release URLs must use HTTPS",
  });

export const releaseArtifactSchema = z
  .object({
    platform: releasePlatformSchema,
    arch: releaseArchSchema,
    kind: z.enum(["dmg", "zip", "squirrel"]),
    downloadUrl: httpsUrlSchema,
    feedUrl: httpsUrlSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const releaseManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    product: z.string().trim().min(1).max(80),
    keyId: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/u),
    version: releaseVersionSchema,
    channel: releaseChannelSchema,
    publishedAt: z.string().datetime({ offset: true }),
    minimumVersion: releaseVersionSchema.nullable(),
    rolloutPercentage: z.number().int().min(0).max(100),
    releaseNotesUrl: httpsUrlSchema,
    artifacts: z.array(releaseArtifactSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const targets = new Set<string>();
    for (const artifact of manifest.artifacts) {
      const target = `${artifact.platform}:${artifact.arch}:${artifact.kind}`;
      if (targets.has(target)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate release artifact target: ${target}`,
          path: ["artifacts"],
        });
      }
      targets.add(target);
    }
  });

export const signedReleaseManifestSchema = z
  .object({
    algorithm: z.literal("ed25519"),
    payload: releaseManifestSchema,
    signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  })
  .strict();

export const releaseUpdateConfigurationSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(false),
      channel: releaseChannelSchema,
      manifestUrl: z.null(),
      keyId: z.null(),
      publicKeyPem: z.null(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(true),
      channel: releaseChannelSchema,
      manifestUrl: httpsUrlSchema,
      keyId: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/u),
      publicKeyPem: z.string().min(80).max(8_192),
    })
    .strict(),
]);

export const releaseUpdateStateSchema = z
  .object({
    status: z.enum([
      "disabled",
      "idle",
      "checking",
      "available",
      "downloading",
      "downloaded",
      "up_to_date",
      "error",
    ]),
    channel: releaseChannelSchema,
    currentVersion: releaseVersionSchema,
    availableVersion: releaseVersionSchema.nullable(),
    progressPercentage: z.number().min(0).max(100).nullable(),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
    reason: z
      .string()
      .regex(/^[A-Z0-9_]{2,80}$/u)
      .nullable(),
  })
  .strict();

export type ReleaseVersion = z.infer<typeof releaseVersionSchema>;
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;
export type ReleasePlatform = z.infer<typeof releasePlatformSchema>;
export type ReleaseArch = z.infer<typeof releaseArchSchema>;
export type ReleaseArtifact = z.infer<typeof releaseArtifactSchema>;
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type SignedReleaseManifest = z.infer<typeof signedReleaseManifestSchema>;
export type ReleaseUpdateConfiguration = z.infer<typeof releaseUpdateConfigurationSchema>;
export type ReleaseUpdateState = z.infer<typeof releaseUpdateStateSchema>;

export interface ReleaseUpdateBridge {
  getReleaseUpdateState(): Promise<ReleaseUpdateState>;
  checkForReleaseUpdate(): Promise<ReleaseUpdateState>;
  installReleaseUpdate(): Promise<ReleaseUpdateState>;
  onReleaseUpdateState(listener: (state: ReleaseUpdateState) => void): () => void;
}
