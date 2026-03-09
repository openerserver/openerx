// ── Control Plane Client ────────────────────────────────────────────
// Unified fetch helper for BFF → Control Plane Service calls.

import * as jose from "jose";
import type { JWTPayload } from "../middleware/auth";

const CONTROL_PLANE_URL =
  process.env.CONTROL_PLANE_URL || "http://localhost:4097";
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

export interface UpstreamResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

/**
 * Forward a request to the Control Plane service.
 * Automatically propagates the Authorization header.
 */
export async function cpFetch<T = unknown>(
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    authorization?: string;
  } = {},
): Promise<UpstreamResponse<T>> {
  const { method = "GET", body, authorization } = opts;
  const requestId = crypto.randomUUID();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  };
  if (authorization) {
    headers.Authorization = authorization;
  }

  const start = performance.now();
  try {
    const response = await fetch(`${CONTROL_PLANE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json()) as T;
    const ms = (performance.now() - start).toFixed(1);
    console.log(`[cp] ${method} ${path} → ${response.status} (${ms}ms) rid=${requestId}`);
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    const ms = (performance.now() - start).toFixed(1);
    console.error(`[cp] ${method} ${path} → 502 (${ms}ms) rid=${requestId} err=${e}`);
    return {
      ok: false,
      status: 502,
      data: { error: `Control plane unreachable: ${e}` } as T,
    };
  }
}

export async function createInternalAuthorization(): Promise<string> {
  const payload: JWTPayload = {
    sub: process.env.INTERNAL_SERVICE_USER_ID || "system:bff",
    org: process.env.INTERNAL_SERVICE_ORG_ID || "system",
    projects: [],
    role: "platform_admin",
  };

  const token = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(JWT_SECRET);

  return `Bearer ${token}`;
}

/**
 * Shorthand: extract Authorization header from Hono context and forward.
 */
export function authHeader(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("Authorization") || "";
}
