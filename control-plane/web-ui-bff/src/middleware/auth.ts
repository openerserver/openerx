import { createMiddleware } from "hono/factory";
import * as jose from "jose";

export interface JWTPayload {
  sub: string;
  org: string;
  projects: Array<{ id: string; role: string }>;
  role: string;
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

export const authMiddleware = createMiddleware(async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authorization.slice(7);
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    c.set("user", payload as unknown as JWTPayload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});
