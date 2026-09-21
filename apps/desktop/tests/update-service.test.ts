import { generateKeyPairSync } from "node:crypto";
import type {
  ReleaseManifest,
  ReleaseUpdateConfiguration,
  SignedReleaseManifest,
} from "@openerx/contracts";
import { signReleaseManifest } from "@openerx/release";
import { describe, expect, it, vi } from "vitest";
import { type DesktopAutoUpdater, DesktopUpdateService } from "../src/main/update-service";

function fixture(): {
  configuration: ReleaseUpdateConfiguration;
  envelope: SignedReleaseManifest;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload: ReleaseManifest = {
    schemaVersion: 1,
    product: "openerx",
    keyId: "desktop-release-key",
    version: "2.0.0",
    channel: "stable",
    publishedAt: "2026-08-26T09:00:00.000Z",
    minimumVersion: "2.0.0-alpha.0",
    rolloutPercentage: 100,
    releaseNotesUrl: "https://releases.openerx.example/2.0.0/notes",
    artifacts: [
      {
        platform: "darwin",
        arch: "arm64",
        kind: "zip",
        downloadUrl: "https://releases.openerx.example/2.0.0/openerx-arm64.zip",
        feedUrl: "https://releases.openerx.example/stable/darwin/arm64",
        sha256: "a".repeat(64),
        sizeBytes: 1024,
      },
    ],
  };
  return {
    configuration: {
      enabled: true,
      channel: "stable",
      manifestUrl: "https://releases.openerx.example/stable/manifest.json",
      keyId: payload.keyId,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    envelope: signReleaseManifest(
      payload,
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ),
  };
}

function updater() {
  const listeners = new Map<string, (...arguments_: unknown[]) => void>();
  const adapter: DesktopAutoUpdater = {
    on: vi.fn((event, listener) => {
      listeners.set(event, listener);
    }),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  };
  return {
    adapter,
    emit: (event: string, ...arguments_: unknown[]) => listeners.get(event)?.(...arguments_),
  };
}

describe("DesktopUpdateService", () => {
  it("verifies the manifest before handing an exact feed to the native updater", async () => {
    const release = fixture();
    const native = updater();
    const service = new DesktopUpdateService({
      configuration: release.configuration,
      currentVersion: "2.0.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      cohortId: "device-1",
      updater: native.adapter,
      fetch: vi.fn(async () => Response.json(release.envelope)),
      now: () => new Date("2026-08-26T09:01:00.000Z"),
    });
    expect(await service.check()).toMatchObject({
      status: "available",
      availableVersion: "2.0.0",
      reason: null,
    });
    expect(native.adapter.setFeedURL).toHaveBeenCalledWith({
      url: "https://releases.openerx.example/stable/darwin/arm64",
      headers: { "X-OpenerX-Manifest-Key": "desktop-release-key" },
    });
    native.emit("download-progress", { percent: 42.5 });
    expect(service.state()).toMatchObject({ status: "downloading", progressPercentage: 42.5 });
    native.emit("update-downloaded");
    service.install();
    expect(native.adapter.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("rejects a correctly signed manifest for a different product", async () => {
    const release = fixture();
    const native = updater();
    const service = new DesktopUpdateService({
      expectedProduct: "AnotherProduct",
      configuration: release.configuration,
      currentVersion: "2.0.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      cohortId: "device-1",
      updater: native.adapter,
      fetch: vi.fn(async () => Response.json(release.envelope)),
    });
    expect(await service.check()).toMatchObject({
      status: "error",
      reason: "RELEASE_PRODUCT_MISMATCH",
    });
    expect(native.adapter.setFeedURL).not.toHaveBeenCalled();
    expect(native.adapter.checkForUpdates).not.toHaveBeenCalled();
  });

  it("cancels an oversized streamed manifest before handing it to the native updater", async () => {
    const release = fixture();
    const native = updater();
    const cancelled = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(262_144));
            },
            cancel: cancelled,
          }),
        ),
    );
    const service = new DesktopUpdateService({
      configuration: release.configuration,
      currentVersion: "2.0.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      cohortId: "device-1",
      updater: native.adapter,
      fetch: fetcher,
    });
    expect(await service.check()).toMatchObject({
      status: "error",
      reason: "RELEASE_MANIFEST_TOO_LARGE",
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      release.configuration.manifestUrl,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
    expect(native.adapter.setFeedURL).not.toHaveBeenCalled();
  });

  it("rejects tampered manifests without exposing their URL or signature", async () => {
    const release = fixture();
    release.envelope.payload.version = "2.0.1";
    const native = updater();
    const service = new DesktopUpdateService({
      configuration: release.configuration,
      currentVersion: "2.0.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      cohortId: "device-1",
      updater: native.adapter,
      fetch: vi.fn(async () => Response.json(release.envelope)),
      now: () => new Date("2026-08-26T09:01:00.000Z"),
    });
    expect(await service.check()).toMatchObject({
      status: "error",
      reason: "RELEASE_MANIFEST_SIGNATURE_INVALID",
    });
    expect(native.adapter.setFeedURL).not.toHaveBeenCalled();
  });
});
