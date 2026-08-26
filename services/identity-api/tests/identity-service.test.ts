import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityService } from "../src/identity-service";

const services: IdentityService[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup(): {
  service: IdentityService;
  codes: Map<string, string>;
  advance(ms: number): void;
} {
  const codes = new Map<string, string>();
  let timestamp = Date.parse("2026-08-25T10:00:00.000Z");
  let token = 0;
  const service = new IdentityService(":memory:", {
    now: () => new Date(timestamp),
    challengeCooldownMs: 0,
    codeFactory: () => "123456",
    tokenFactory: () => `secret-${String(++token).padStart(32, "x")}`,
    mailer: {
      async deliver({ email, code }) {
        codes.set(email, code);
      },
    },
  });
  services.push(service);
  return { service, codes, advance: (ms) => (timestamp += ms) };
}

function device(name: string, platform: "darwin" | "win32" | "ios" | "android" = "darwin") {
  return {
    deviceId: randomUUID(),
    name,
    platform,
    arch: platform === "win32" ? ("x64" as const) : ("arm64" as const),
  };
}

describe("IdentityService", () => {
  it("verifies a single-use email challenge and rotates a device credential", async () => {
    const { service, codes } = setup();
    const challenge = await service.requestChallenge("User@Example.com");
    expect(codes.get("user@example.com")).toBe("123456");
    const first = service.verifyChallenge({
      challengeId: challenge.challengeId,
      code: "123456",
      device: device("MacBook"),
    });
    expect(first.account.email).toBe("user@example.com");
    expect(service.authenticate(first.accessToken).accountId).toBe(first.account.accountId);
    expect(() =>
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        code: "123456",
        device: device("Second Mac"),
      }),
    ).toThrow("CHALLENGE_CONSUMED");

    const rotated = service.refresh(first.session.sessionId, first.refreshCredential);
    expect(rotated.session.sessionVersion).toBe(2);
    expect(rotated.refreshCredential).not.toBe(first.refreshCredential);
    expect(() => service.authenticate(first.accessToken)).toThrow("ACCESS_TOKEN_INVALID");
    expect(service.authenticate(rotated.accessToken).sessionVersion).toBe(2);
  });

  it("revokes a session when a superseded refresh credential is replayed", async () => {
    const { service } = setup();
    const challenge = await service.requestChallenge("replay@example.com");
    const first = service.verifyChallenge({
      challengeId: challenge.challengeId,
      code: "123456",
      device: device("Windows", "win32"),
    });
    const second = service.refresh(first.session.sessionId, first.refreshCredential);
    expect(() => service.refresh(first.session.sessionId, first.refreshCredential)).toThrow(
      "REFRESH_REPLAY_REVOKED",
    );
    expect(() => service.authenticate(second.accessToken)).toThrow("ACCESS_TOKEN_INVALID");
  });

  it("enforces expiry, account isolation and device revocation", async () => {
    const { service, advance } = setup();
    const firstChallenge = await service.requestChallenge("one@example.com");
    const first = service.verifyChallenge({
      challengeId: firstChallenge.challengeId,
      code: "123456",
      device: device("One"),
    });
    const secondChallenge = await service.requestChallenge("two@example.com");
    const second = service.verifyChallenge({
      challengeId: secondChallenge.challengeId,
      code: "123456",
      device: device("Two"),
    });
    const firstPrincipal = service.authenticate(first.accessToken);
    expect(() => service.revokeDevice(firstPrincipal, second.session.sessionId)).toThrow(
      "ACCOUNT_SCOPE_VIOLATION",
    );
    service.revokeDevice(firstPrincipal, first.session.sessionId);
    expect(() => service.authenticate(first.accessToken)).toThrow("ACCESS_TOKEN_INVALID");

    advance(5 * 60_000 + 1);
    expect(() => service.authenticate(second.accessToken)).toThrow("ACCESS_TOKEN_EXPIRED");
  });

  it("lists account devices and revokes every active session", async () => {
    const { service } = setup();
    const firstChallenge = await service.requestChallenge("all@example.com");
    const first = service.verifyChallenge({
      challengeId: firstChallenge.challengeId,
      code: "123456",
      device: device("First"),
    });
    const secondChallenge = await service.requestChallenge("all@example.com");
    const second = service.verifyChallenge({
      challengeId: secondChallenge.challengeId,
      code: "123456",
      device: device("Second", "win32"),
    });
    const principal = service.authenticate(first.accessToken);
    expect(service.listDevices(principal)).toHaveLength(2);
    expect(service.revokeAllDevices(principal).every(({ revokedAt }) => revokedAt !== null)).toBe(
      true,
    );
    expect(() => service.authenticate(first.accessToken)).toThrow("DEVICE_SESSION_REVOKED");
    expect(() => service.authenticate(second.accessToken)).toThrow("DEVICE_SESSION_REVOKED");
  });

  it("creates iOS and Android controller sessions for Remote Companion", async () => {
    const { service } = setup();
    const iosChallenge = await service.requestChallenge("remote@example.com");
    const ios = service.verifyChallenge({
      challengeId: iosChallenge.challengeId,
      code: "123456",
      device: device("iPhone", "ios"),
    });
    const androidChallenge = await service.requestChallenge("remote@example.com");
    const android = service.verifyChallenge({
      challengeId: androidChallenge.challengeId,
      code: "123456",
      device: device("Pixel", "android"),
    });

    expect(ios.session.device.platform).toBe("ios");
    expect(android.session.device.platform).toBe("android");
    expect(service.listDevices(service.authenticate(ios.accessToken))).toHaveLength(2);
  });

  it("migrates the desktop-only device table before accepting a mobile controller", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-identity-mobile-migration-"));
    directories.push(directory);
    const databasePath = path.join(directory, "identity.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE device_sessions (
        session_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32')),
        arch TEXT NOT NULL CHECK (arch IN ('arm64', 'x64')),
        session_version INTEGER NOT NULL CHECK (session_version > 0),
        refresh_hash TEXT NOT NULL,
        previous_refresh_hash TEXT,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
    `);
    legacy.close();
    const service = new IdentityService(databasePath, {
      challengeCooldownMs: 0,
      codeFactory: () => "123456",
      mailer: { async deliver() {} },
    });
    services.push(service);
    const challenge = await service.requestChallenge("migration@example.com");
    const grant = service.verifyChallenge({
      challengeId: challenge.challengeId,
      code: "123456",
      device: device("Migrated iPhone", "ios"),
    });
    expect(grant.session.device.platform).toBe("ios");
  });
});
