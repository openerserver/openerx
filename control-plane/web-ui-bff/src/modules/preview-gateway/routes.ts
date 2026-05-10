import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const previewGatewayRoutes = new Hono();

type PreviewGatewayStatus = 200 | 202 | 400 | 401 | 403 | 404 | 409 | 410 | 500 | 502;

interface CommitRuntimeRecord {
  id?: string;
  taskId?: string;
  commitStepId?: string | null;
  commitSha?: string;
  runtimeLevel?: number;
  provider?: string;
  status?: string;
  previewUrl?: string | null;
  targetUrl?: string | null;
  logsUrl?: string | null;
  ttlSeconds?: number;
  expiresAt?: string | null;
}

interface CommitRuntimePayload {
  data?: CommitRuntimeRecord;
  error?: string;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function normalizeRuntime(payload: unknown): CommitRuntimeRecord | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const maybe = payload as CommitRuntimePayload;
  if (maybe.data && typeof maybe.data === "object") return maybe.data;
  return undefined;
}

function isExpired(runtime: CommitRuntimeRecord, now = Date.now()) {
  if (!runtime.expiresAt) return false;
  const expiresAt = Date.parse(runtime.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function statusFrom(status: number): PreviewGatewayStatus {
  if ([200, 202, 400, 401, 403, 404, 409, 410, 500, 502].includes(status)) {
    return status as PreviewGatewayStatus;
  }
  return 502;
}

function previewTargetPath(fullPath: string, commitSha: string) {
  const prefix = `/preview/commits/${commitSha}`;
  const suffix = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : "";
  return suffix || "/";
}

function isAllowedPreviewTargetUrl(raw: string) {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname;
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (host === "localhost" || host === "127.0.0.1" || host === "::1")
    );
  } catch {
    return false;
  }
}

function joinPath(basePath: string, targetPath: string) {
  const normalizedBase = basePath.replace(/\/+$/, "");
  const normalizedTarget = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  return `${normalizedBase}${normalizedTarget}` || "/";
}

function buildProxyTargetUrl(targetUrl: string, targetPath: string, requestUrl: string) {
  const target = new URL(targetUrl);
  const request = new URL(requestUrl);
  target.pathname = joinPath(target.pathname, targetPath);
  target.search = request.search;
  return target;
}

function proxyRequestHeaders(source: Headers) {
  const headers = new Headers();
  for (const name of ["accept", "accept-language", "user-agent"]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function proxyResponseHeaders(source: Headers, targetUrl: URL, commitSha: string) {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  const location = headers.get("location");
  if (location) {
    try {
      const resolved = new URL(location, targetUrl);
      if (resolved.origin === targetUrl.origin) {
        headers.set("location", `/preview/commits/${commitSha}${resolved.pathname}${resolved.search}`);
      }
    } catch {
      // Keep an invalid upstream Location header unchanged.
    }
  }
  return headers;
}

async function proxyPreview(c: {
  req: {
    header: (name: string) => string | undefined;
    path: string;
    raw: Request;
    url: string;
  };
}, runtime: CommitRuntimeRecord, commitSha: string) {
  if (c.req.raw.method !== "GET" && c.req.raw.method !== "HEAD") {
    return new Response("Preview Gateway only supports GET and HEAD", { status: 405 });
  }
  if (!runtime.targetUrl || !isAllowedPreviewTargetUrl(runtime.targetUrl)) {
    return Response.json(
      {
        error: "Preview runtime targetUrl is not allowed",
        status: "target_not_allowed",
      },
      { status: 403 },
    );
  }
  const targetPath = previewTargetPath(c.req.path, commitSha);
  const targetUrl = buildProxyTargetUrl(runtime.targetUrl, targetPath, c.req.url);
  try {
    const upstream = await fetch(targetUrl, {
      method: c.req.raw.method,
      headers: proxyRequestHeaders(c.req.raw.headers),
      redirect: "manual",
    });
    return new Response(c.req.raw.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: proxyResponseHeaders(upstream.headers, targetUrl, commitSha),
    });
  } catch (error) {
    return Response.json(
      {
        error: `Preview runtime unreachable: ${error}`,
        status: "target_unreachable",
      },
      { status: 502 },
    );
  }
}

async function wakeRuntime(c: {
  req: { header: (name: string) => string | undefined };
  json: (data: unknown, status?: PreviewGatewayStatus) => Response | Promise<Response>;
}, runtime: CommitRuntimeRecord) {
  const result = await cpFetch<CommitRuntimePayload>("/api/runtime-scheduler/start", {
    method: "POST",
    authorization: authHeader(c),
    body: {
      commitSha: runtime.commitSha,
      taskId: runtime.taskId,
      commitStepId: runtime.commitStepId,
      runtimeLevel: runtime.runtimeLevel || 1,
      provider: runtime.provider || "local-registered",
      targetUrl: runtime.targetUrl,
      previewUrl: runtime.previewUrl,
      logsUrl: runtime.logsUrl,
      ttlSeconds: runtime.ttlSeconds,
    },
  });
  if (!result.ok) {
    return c.json(
      {
        error: "Preview runtime is not running and scheduler wake-up failed",
        status: runtime.status || "unknown",
        scheduler: result.data,
      },
      statusFrom(result.status),
    );
  }
  return c.json(
    {
      data: {
        status: "starting",
        runtime: normalizeRuntime(result.data),
      },
    },
    202,
  );
}

async function handlePreview(c: {
  req: {
    header: (name: string) => string | undefined;
    param: (name: string) => string;
    path: string;
    raw: Request;
    url: string;
  };
  json: (data: unknown, status?: PreviewGatewayStatus) => Response | Promise<Response>;
}) {
  const commitSha = c.req.param("commitSha");
  const result = await cpFetch<CommitRuntimePayload>(`/api/commit-runtimes/${commitSha}`, {
    authorization: authHeader(c),
  });
  if (result.status === 404) {
    return c.json({ error: "Preview runtime not found", status: "missing", commitSha }, 404);
  }
  if (!result.ok) {
    return c.json(result.data, statusFrom(result.status));
  }

  const runtime = normalizeRuntime(result.data);
  if (!runtime) {
    return c.json({ error: "Preview runtime response is invalid", status: "invalid" }, 502);
  }

  const expired = isExpired(runtime);
  const status = expired ? "expired" : runtime.status || "unknown";
  if (status === "starting") {
    return c.json({ data: { status, runtime } }, 202);
  }

  if (status !== "running") {
    if (runtime.targetUrl) {
      return wakeRuntime(c, runtime);
    }
    return c.json(
      {
        error: "Preview runtime is not running",
        status,
        action: "start_runtime_required",
      },
      expired ? 410 : 409,
    );
  }

  if (!runtime.targetUrl) {
    return c.json(
      {
        error: "Preview runtime is running but targetUrl is missing",
        status: "target_missing",
        action: "register_runtime_target",
      },
      409,
    );
  }

  return proxyPreview(c, runtime, commitSha);
}

previewGatewayRoutes.get("/commits/:commitSha", handlePreview);
previewGatewayRoutes.get("/commits/:commitSha/*", handlePreview);
