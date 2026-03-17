// ── Control Plane Client ────────────────────────────────────────────
// Unified fetch helper for BFF → Control Plane Service calls.

import * as jose from "jose";
import type { JWTPayload } from "../middleware/auth";

const CONTROL_PLANE_URL =
  process.env.TEST_CP_URL ||
  process.env.TEST_APP_URL ||
  process.env.CONTROL_PLANE_URL ||
  "http://localhost:4097";
const INTERNAL_CONTROL_PLANE_ORIGIN = "http://internal-control-plane";
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

type InternalControlPlaneFetch = (request: Request) => Promise<Response> | Response;

let internalControlPlaneFetch: InternalControlPlaneFetch | null = null;

export interface UpstreamResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export function setControlPlaneFetchHandler(fetchHandler: InternalControlPlaneFetch | null) {
  internalControlPlaneFetch = fetchHandler;
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
    timeoutMs?: number;
  } = {},
): Promise<UpstreamResponse<T>> {
  const { method = "GET", body, authorization } = opts;
  const requestId = crypto.randomUUID();
  const targetUrl = internalControlPlaneFetch
    ? `${INTERNAL_CONTROL_PLANE_ORIGIN}${path}`
    : `${CONTROL_PLANE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  };
  if (authorization) {
    headers.Authorization = authorization;
  }

  const start = performance.now();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const request = new Request(targetUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const response = internalControlPlaneFetch
      ? await internalControlPlaneFetch(request)
      : await fetch(request);
    const text = await response.text();
    let data: T;

    if (!text) {
      data = {} as T;
    } else {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = { error: text } as T;
      }
    }

    const ms = (performance.now() - start).toFixed(1);
    const mode = internalControlPlaneFetch ? "internal" : "http";
    console.log(`[cp:${mode}] ${method} ${path} → ${response.status} (${ms}ms) rid=${requestId}`);
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    const ms = (performance.now() - start).toFixed(1);
    const mode = internalControlPlaneFetch ? "internal" : "http";
    console.error(`[cp:${mode}] ${method} ${path} → 502 (${ms}ms) rid=${requestId} err=${e}`);
    return {
      ok: false,
      status: 502,
      data: { error: `Control plane unreachable: ${e}` } as T,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
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
