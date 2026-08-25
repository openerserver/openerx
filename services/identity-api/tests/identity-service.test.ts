import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityService } from "../src/identity-service";

const services: IdentityService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
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

function device(name: string, platform: "darwin" | "win32" = "darwin") {
  return {
    deviceId: randomUUID(),
    name,
    platform,
    arch: platform === "darwin" ? ("arm64" as const) : ("x64" as const),
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
});
