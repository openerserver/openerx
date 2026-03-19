import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlPlaneApp } from "../../service/src/app";
import { createBffServer } from "../../web-ui-bff/src/app";
import { setControlPlaneFetchHandler } from "../../web-ui-bff/src/lib/control-plane-client";

type ServerUpgrade = { upgrade: (req: Request, opts?: unknown) => boolean };

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const UI_DIST_DIR = resolve(APP_DIR, "../../web-ui/dist");
const UI_DEV_SERVER_URL = process.env.UI_DEV_SERVER_URL;
const OPENCODE_URL =
  process.env.OPENCODE_URL || process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096";

const controlPlaneApp = createControlPlaneApp();
setControlPlaneFetchHandler((request) => controlPlaneApp.fetch(request));

const bffServer = createBffServer({
  startBackgroundJobs: true,
  serviceName: "opener-x-app",
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function checkRuntimeDependency() {
  try {
    const response = await fetch(`${OPENCODE_URL.replace(/\/+$/, "")}/session`);
    return {
      ok: response.ok,
      status: response.status,
      target: OPENCODE_URL,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      target: OPENCODE_URL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function serveUi(req: Request) {
  const url = new URL(req.url);

  if (UI_DEV_SERVER_URL) {
    const proxiedUrl = new URL(url.pathname + url.search, UI_DEV_SERVER_URL).toString();
    return fetch(new Request(proxiedUrl, req));
  }

  if (!existsSync(UI_DIST_DIR)) {
    return new Response(
      "Web UI assets not found. Run bun run build:ui or set UI_DEV_SERVER_URL for Vite proxy mode.",
      { status: 503 },
    );
  }

  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const assetPath = resolve(UI_DIST_DIR, relativePath);
  if (assetPath.startsWith(UI_DIST_DIR) && existsSync(assetPath)) {
    return new Response(Bun.file(assetPath));
  }

  return new Response(Bun.file(resolve(UI_DIST_DIR, "index.html")));
}

const port = Number(process.env.APP_PORT || process.env.PORT || process.env.BFF_PORT) || 4098;

export default {
  port,
  idleTimeout: 255,
  async fetch(req: Request, server: ServerUpgrade) {
    const url = new URL(req.url);

    if (url.pathname === "/health" || url.pathname === "/health/live") {
      return jsonResponse({ status: "ok", service: "opener-x-app" });
    }

    if (url.pathname === "/health/ready") {
      const controlPlaneHealth = await controlPlaneApp.fetch(
        new Request("http://internal-control-plane/health"),
      );
      return jsonResponse({
        status: controlPlaneHealth.ok ? "ok" : "degraded",
        controlPlane: controlPlaneHealth.ok ? "ok" : "error",
      });
    }

    if (url.pathname === "/health/deps") {
      const runtime = await checkRuntimeDependency();
      return jsonResponse(
        {
          status: runtime.ok ? "ok" : "degraded",
          runtime,
        },
        runtime.ok ? 200 : 503,
      );
    }

    if (url.pathname === "/ws" || url.pathname.startsWith("/api/")) {
      return bffServer.fetch(req, server);
    }

    return serveUi(req);
  },
  websocket: bffServer.websocket,
};

console.log(`Opener-X App running on http://localhost:${port}`);
