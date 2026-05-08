export type AuthRateLimitAction = "login" | "register";

type RateLimitPolicy = {
  maxAttempts: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type AuthRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
      scope: "ip" | "identifier";
      maxAttempts: number;
      windowMs: number;
    };

const DEFAULT_POLICIES: Record<
  AuthRateLimitAction,
  { ip: RateLimitPolicy; identifier: RateLimitPolicy }
> = {
  login: {
    ip: { maxAttempts: 30, windowMs: 5 * 60 * 1000 },
    identifier: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  },
  register: {
    ip: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
    identifier: { maxAttempts: 3, windowMs: 60 * 60 * 1000 },
  },
};

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function resolvePolicy(action: AuthRateLimitAction, scope: "ip" | "identifier"): RateLimitPolicy {
  const defaults = DEFAULT_POLICIES[action][scope];
  const prefix = `AUTH_RATE_LIMIT_${action.toUpperCase()}_${scope.toUpperCase()}`;
  return {
    maxAttempts: readPositiveIntEnv(`${prefix}_MAX`, defaults.maxAttempts),
    windowMs: readPositiveIntEnv(`${prefix}_WINDOW_MS`, defaults.windowMs),
  };
}

export class FixedWindowRateLimiter {
  private buckets = new Map<string, RateLimitBucket>();

  check(key: string, policy: RateLimitPolicy, now = Date.now()): AuthRateLimitDecision {
    const existing = this.buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
      return { allowed: true };
    }

    if (existing.count >= policy.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        scope: key.includes(":ip:") ? "ip" : "identifier",
        maxAttempts: policy.maxAttempts,
        windowMs: policy.windowMs,
      };
    }

    existing.count += 1;
    return { allowed: true };
  }

  reset() {
    this.buckets.clear();
  }
}

const limiter = new FixedWindowRateLimiter();

export function resetAuthRateLimitForTests() {
  limiter.reset();
}

export function checkAuthRateLimit(args: {
  action: AuthRateLimitAction;
  clientIp: string;
  identifier: string;
  now?: number;
}): AuthRateLimitDecision {
  if (process.env.AUTH_RATE_LIMIT_DISABLED === "1") {
    return { allowed: true };
  }

  const clientIp = args.clientIp.trim() || "unknown";
  const identifier = args.identifier.trim().toLowerCase() || "unknown";
  const ipPolicy = resolvePolicy(args.action, "ip");
  const identifierPolicy = resolvePolicy(args.action, "identifier");

  const ipDecision = limiter.check(`${args.action}:ip:${clientIp}`, ipPolicy, args.now);
  if (!ipDecision.allowed) return ipDecision;

  return limiter.check(`${args.action}:identifier:${identifier}`, identifierPolicy, args.now);
}
