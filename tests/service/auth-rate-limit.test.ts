import { describe, expect, test } from "bun:test";
import {
  FixedWindowRateLimiter,
  checkAuthRateLimit,
  resetAuthRateLimitForTests,
} from "../../control-plane/service/src/modules/auth/rate-limit";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}

describe("auth rate limit", () => {
  test("blocks after the fixed window quota is exhausted", () => {
    const limiter = new FixedWindowRateLimiter();
    const policy = { maxAttempts: 2, windowMs: 60_000 };

    expect(limiter.check("login:ip:127.0.0.1", policy, 1_000)).toEqual({ allowed: true });
    expect(limiter.check("login:ip:127.0.0.1", policy, 2_000)).toEqual({ allowed: true });

    const blocked = limiter.check("login:ip:127.0.0.1", policy, 3_000);
    expect(blocked).toMatchObject({
      allowed: false,
      retryAfterSeconds: 58,
      scope: "ip",
      maxAttempts: 2,
      windowMs: 60_000,
    });
  });

  test("resets buckets after the window expires", () => {
    const limiter = new FixedWindowRateLimiter();
    const policy = { maxAttempts: 1, windowMs: 10_000 };

    expect(limiter.check("register:identifier:+8613800000000", policy, 1_000)).toEqual({
      allowed: true,
    });
    expect(limiter.check("register:identifier:+8613800000000", policy, 2_000).allowed).toBe(false);
    expect(limiter.check("register:identifier:+8613800000000", policy, 11_000)).toEqual({
      allowed: true,
    });
  });

  test("checks IP before identifier for auth actions", () => {
    resetAuthRateLimitForTests();
    const originalIpMax = process.env.AUTH_RATE_LIMIT_LOGIN_IP_MAX;
    const originalIdentifierMax = process.env.AUTH_RATE_LIMIT_LOGIN_IDENTIFIER_MAX;
    process.env.AUTH_RATE_LIMIT_LOGIN_IP_MAX = "1";
    process.env.AUTH_RATE_LIMIT_LOGIN_IDENTIFIER_MAX = "10";

    try {
      expect(
        checkAuthRateLimit({
          action: "login",
          clientIp: "203.0.113.1",
          identifier: "admin",
          now: 1_000,
        }),
      ).toEqual({ allowed: true });

      expect(
        checkAuthRateLimit({
          action: "login",
          clientIp: "203.0.113.1",
          identifier: "other",
          now: 2_000,
        }),
      ).toMatchObject({ allowed: false, scope: "ip" });
    } finally {
      restoreEnv("AUTH_RATE_LIMIT_LOGIN_IP_MAX", originalIpMax);
      restoreEnv("AUTH_RATE_LIMIT_LOGIN_IDENTIFIER_MAX", originalIdentifierMax);
      resetAuthRateLimitForTests();
    }
  });
});
