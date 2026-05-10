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

  return c.json({
    data: {
      status: "ready",
      commitSha,
      runtimeId: runtime.id,
      targetPath: previewTargetPath(c.req.path, commitSha),
      proxyReady: false,
    },
  });
}

previewGatewayRoutes.get("/commits/:commitSha", handlePreview);
previewGatewayRoutes.get("/commits/:commitSha/*", handlePreview);
