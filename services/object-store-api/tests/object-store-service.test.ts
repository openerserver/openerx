import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SyncPrincipal } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ObjectStoreService } from "../src";

const temporaryDirectories: string[] = [];
const services: ObjectStoreService[] = [];

function setup(options: { now?: () => Date; intentTtlMs?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-object-store-"));
  temporaryDirectories.push(root);
  const service = new ObjectStoreService(
    path.join(root, "objects.sqlite"),
    path.join(root, "bytes"),
    options,
  );
  services.push(service);
  return service;
}

function principal(accountId: string = randomUUID()): SyncPrincipal {
  return { accountId, sessionId: randomUUID(), deviceId: randomUUID() };
}

afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("account-scoped object transfers", () => {
  it("uploads once and downloads from a second device on the same account", () => {
    const service = setup();
    const first = principal();
    const second = principal(first.accountId);
    const bytes = Buffer.from("cross-device artifact");
    const input = {
      objectId: randomUUID(),
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      mediaType: "text/plain",
    };
    const upload = service.createUploadIntent(first, input);
    const descriptor = service.upload(first, upload.token, bytes);
    expect(descriptor).toMatchObject(input);
    expect(() => service.upload(first, upload.token, bytes)).toThrow("OBJECT_INTENT_CONSUMED");

    const download = service.createDownloadIntent(second, input.objectId);
    expect(Buffer.from(service.download(second, download.token).bytes).toString()).toBe(
      "cross-device artifact",
    );
  });

  it("separates accounts and binds each intent to its authenticated session", () => {
    const service = setup();
    const owner = principal();
    const stranger = principal();
    const bytes = Buffer.from("private");
    const input = {
      objectId: randomUUID(),
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      mediaType: "text/plain",
    };
    const upload = service.createUploadIntent(owner, input);
    expect(() => service.upload(stranger, upload.token, bytes)).toThrow(
      "OBJECT_INTENT_SCOPE_VIOLATION",
    );
    service.upload(owner, upload.token, bytes);
    expect(() => service.createDownloadIntent(stranger, input.objectId)).toThrow(
      "OBJECT_NOT_FOUND",
    );
  });

  it("rejects checksum mismatch, expiry and revoked sessions", () => {
    let now = Date.parse("2026-08-25T10:00:00.000Z");
    const service = setup({ now: () => new Date(now), intentTtlMs: 1_000 });
    const actor = principal();
    const expected = Buffer.from("expected");
    const input = {
      objectId: randomUUID(),
      checksumSha256: createHash("sha256").update(expected).digest("hex"),
      sizeBytes: expected.byteLength,
      mediaType: "text/plain",
    };
    const mismatch = service.createUploadIntent(actor, input);
    expect(() => service.upload(actor, mismatch.token, Buffer.from("different"))).toThrow(
      "OBJECT_SIZE_MISMATCH",
    );
    const expired = service.createUploadIntent(actor, input);
    now += 1_001;
    expect(() => service.upload(actor, expired.token, expected)).toThrow("OBJECT_INTENT_EXPIRED");
    const revokedActor = principal();
    service.revokeSession(revokedActor.sessionId);
    expect(() => service.createUploadIntent(revokedActor, input)).toThrow("DEVICE_SESSION_REVOKED");
  });

  it("deletes only the authenticated account object set", () => {
    const service = setup();
    const owner = principal();
    const stranger = principal();
    for (const actor of [owner, stranger]) {
      const bytes = Buffer.from(actor.accountId);
      const input = {
        objectId: randomUUID(),
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
        mediaType: "text/plain",
      };
      const ticket = service.createUploadIntent(actor, input);
      service.upload(actor, ticket.token, bytes);
    }
    expect(service.deleteAccountData(owner)).toBe(1);
    expect(service.deleteAccountData(stranger)).toBe(1);
  });
});
