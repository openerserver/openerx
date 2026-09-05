import { generateKeyPairSync } from "node:crypto";
import type { ReleaseManifest } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  isReleaseEligible,
  selectReleaseArtifact,
  signReleaseManifest,
  verifySignedReleaseManifest,
} from "../src/manifest";

const manifest: ReleaseManifest = {
  schemaVersion: 1,
  product: "OpenERX",
  keyId: "release-key-2026-01",
  version: "2.0.0",
  channel: "stable",
  publishedAt: "2026-08-26T09:00:00.000Z",
  minimumVersion: "1.9.0",
  rolloutPercentage: 10,
  releaseNotesUrl: "https://releases.openerx.example/2.0.0/notes",
  artifacts: [
    {
      platform: "darwin",
      arch: "arm64",
      kind: "zip",
      downloadUrl: "https://releases.openerx.example/2.0.0/OpenERX-arm64.zip",
      feedUrl: "https://releases.openerx.example/stable/darwin/arm64",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
    },
  ],
};

describe("signed release manifest", () => {
  it("verifies Ed25519 signatures and selects an exact native target", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const envelope = signReleaseManifest(
      manifest,
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const verified = verifySignedReleaseManifest(
      envelope,
      manifest.keyId,
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    expect(verified).toEqual(manifest);
    expect(selectReleaseArtifact(verified, "darwin", "arm64").kind).toBe("zip");

    envelope.payload.rolloutPercentage = 100;
    expect(() =>
      verifySignedReleaseManifest(
        envelope,
        manifest.keyId,
        publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toThrow("RELEASE_MANIFEST_SIGNATURE_INVALID");
  });

  it("orders stable and prerelease versions without accepting downgrade", () => {
    expect(compareReleaseVersions("2.0.0", "2.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareReleaseVersions("2.0.0-rc.10", "2.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareReleaseVersions("2.0.0-alpha-beta.2", "2.0.0-alpha-beta.1")).toBeGreaterThan(0);
    expect(
      compareReleaseVersions("999999999999999999999.0.0", "999999999999999999998.0.0"),
    ).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.9.9", "2.0.0-alpha.0")).toBeLessThan(0);
    expect(() => compareReleaseVersions("2.0.0-rc.01", "2.0.0-rc.1")).toThrow();
    expect(isReleaseEligible({ ...manifest, rolloutPercentage: 0 }, "1.8.0", "device-a")).toBe(
      true,
    );
    expect(isReleaseEligible({ ...manifest, rolloutPercentage: 0 }, "1.9.0", "device-a")).toBe(
      false,
    );
  });
});
