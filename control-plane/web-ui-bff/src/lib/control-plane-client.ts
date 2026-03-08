// ── Control Plane Client ────────────────────────────────────────────
// Unified fetch helper for BFF → Control Plane Service calls.

const CONTROL_PLANE_URL =
  process.env.CONTROL_PLANE_URL || "http://localhost:4097";

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

/**
 * Shorthand: extract Authorization header from Hono context and forward.
 */
export function authHeader(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("Authorization") || "";
}
