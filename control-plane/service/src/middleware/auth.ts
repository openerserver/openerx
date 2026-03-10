import { eq } from "drizzle-orm";
import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import * as jose from "jose";
import { db } from "../db";
import { users } from "../db/schema";

export interface JWTPayload {
  sub: string;
  org: string;
  projects: Array<{ id: string; role: string }>;
  role: string;
  tv?: number; // tokenVersion for session invalidation
}

export interface AppEnv extends Env {
  Variables: {
    user: JWTPayload;
  };
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

export async function signJWT(payload: JWTPayload): Promise<string> {
  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("4h")
    .sign(JWT_SECRET);
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jose.jwtVerify(token, JWT_SECRET);
  return payload as unknown as JWTPayload;
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authorization.slice(7);
  try {
    const payload = await verifyJWT(token);

    if (!payload.sub.startsWith("system:")) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, payload.sub),
      });

      if (!user || user.accountStatus !== "active") {
        return c.json({ error: "Account is disabled or unavailable" }, 401);
      }

      // Validate tokenVersion — reject stale tokens after password change / disable
      if (payload.tv !== undefined && payload.tv !== (user.tokenVersion ?? 0)) {
        return c.json({ error: "Session expired, please login again" }, 401);
      }
    }

    c.set("user", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});
