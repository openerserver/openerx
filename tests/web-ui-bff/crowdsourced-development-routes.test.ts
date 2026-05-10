import { afterEach, describe, expect, test } from "bun:test";
import { createBffApp } from "../../control-plane/web-ui-bff/src/app";
import {
  createInternalAuthorization,
  setControlPlaneFetchHandler,
} from "../../control-plane/web-ui-bff/src/lib/control-plane-client";

async function request(path: string, init: RequestInit = {}) {
  const app = createBffApp("test-bff");
  const authorization = await createInternalAuthorization();
  return app.request(path, {
    ...init,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  setControlPlaneFetchHandler(null);
  globalThis.fetch = originalFetch;
});

describe("crowdsourced development BFF routes", () => {
  test("proxies contributor profile requests to the Go Control Plane", async () => {
    const seen: string[] = [];
    setControlPlaneFetchHandler(async (req) => {
      const url = new URL(req.url);
      seen.push(`${req.method} ${url.pathname}${url.search}`);
      return Response.json({ data: { userId: "u1", level: "L2" } });
    });

    const res = await request("/api/contributors/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { userId: "u1", level: "L2" } });
    expect(seen).toEqual(["GET /api/contributors/me"]);
  });

  test("proxies task boundary updates before the legacy task catch-all", async () => {
    const seen: Array<{ path: string; body: unknown }> = [];
    setControlPlaneFetchHandler(async (req) => {
      const url = new URL(req.url);
      seen.push({ path: `${req.method} ${url.pathname}`, body: await req.json() });
      return Response.json({ data: { taskId: "task-1", runtimeLevel: 2 } });
    });

    const res = await request("/api/tasks/task-1/boundary", {
      method: "PUT",
      body: JSON.stringify({
        allowedPaths: ["apps/web/**"],
        blockedPaths: ["infra/**"],
        runtimeLevel: 2,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { taskId: "task-1", runtimeLevel: 2 } });
    expect(seen).toEqual([
      {
        path: "PUT /api/tasks/task-1/boundary",
        body: {
          allowedPaths: ["apps/web/**"],
          blockedPaths: ["infra/**"],
          runtimeLevel: 2,
        },
      },
    ]);
  });

  test("proxies marketplace listing before task id catch-all routes", async () => {
    const seen: string[] = [];
    setControlPlaneFetchHandler(async (req) => {
      const url = new URL(req.url);
      seen.push(`${req.method} ${url.pathname}${url.search}`);
      return Response.json({
        data: [{ id: "task-1", title: "Fix checkout", eligible: true }],
      });
    });

    const res = await request("/api/tasks/marketplace?projectId=p1&limit=20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [{ id: "task-1", title: "Fix checkout", eligible: true }],
    });
    expect(seen).toEqual(["GET /api/tasks/marketplace?projectId=p1&limit=20"]);
  });

  test("proxies code owner resolution and commit runtime preview routes", async () => {
    const seen: string[] = [];
    setControlPlaneFetchHandler(async (req) => {
      const url = new URL(req.url);
      seen.push(`${req.method} ${url.pathname}`);
      if (url.pathname.includes("preview-url")) {
        return Response.json({ data: { previewUrl: "/preview/commits/abc" } });
      }
      return Response.json({ data: [], overallRisk: "high", approvalRequired: true });
    });

    const ownerRes = await request("/api/code-owners/resolve", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1", paths: ["services/payments/a.ts"] }),
    });
    expect(ownerRes.status).toBe(200);
    expect(await ownerRes.json()).toEqual({
      data: [],
      overallRisk: "high",
      approvalRequired: true,
    });

    const previewRes = await request("/api/commit-runtimes/abc/preview-url");
    expect(previewRes.status).toBe(200);
    expect(await previewRes.json()).toEqual({ data: { previewUrl: "/preview/commits/abc" } });
    expect(seen).toEqual([
      "POST /api/code-owners/resolve",
      "GET /api/commit-runtimes/abc/preview-url",
    ]);
  });

  test("preview gateway proxies a running runtime target", async () => {
    const seen: string[] = [];
    const proxied: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      proxied.push(input.toString());
      return new Response("console.log('preview')", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      });
    }) as typeof fetch;
    setControlPlaneFetchHandler(async (req) => {
      const url = new URL(req.url);
      seen.push(`${req.method} ${url.pathname}`);
      return Response.json({
        data: {
          id: "rt-1",
          commitSha: "abc",
          status: "running",
          targetUrl: "http://127.0.0.1:5173",
          expiresAt: "2999-01-01T00:00:00Z",
        },
      });
    });

    const res = await request("/preview/commits/abc/assets/app.js?v=1", {
      headers: { Accept: "application/javascript" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/javascript");
    expect(await res.text()).toBe("console.log('preview')");
    expect(seen).toEqual(["GET /api/commit-runtimes/abc"]);
    expect(proxied).toEqual(["http://127.0.0.1:5173/assets/app.js?v=1"]);
  });

  test("preview gateway wakes a stopped runtime when a target is registered", async () => {
    const seen: Array<{ path: string; body?: unknown }> = [];
    setControlPlaneFetchHandler(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/runtime-scheduler/start") {
        seen.push({ path: `${req.method} ${url.pathname}`, body: await req.json() });
        return Response.json({
          data: {
            id: "rt-1",
            commitSha: "abc",
            status: "running",
            targetUrl: "http://127.0.0.1:5173",
          },
        });
      }
      seen.push({ path: `${req.method} ${url.pathname}` });
      return Response.json({
        data: {
          id: "rt-1",
          taskId: "task-1",
          commitStepId: "step-1",
          commitSha: "abc",
          runtimeLevel: 1,
          provider: "local-registered",
          status: "stopped",
          targetUrl: "http://127.0.0.1:5173",
          previewUrl: "/preview/commits/abc",
          ttlSeconds: 1800,
        },
      });
    });

    const res = await request("/preview/commits/abc");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      data: {
        status: "starting",
        runtime: {
          id: "rt-1",
          commitSha: "abc",
          status: "running",
          targetUrl: "http://127.0.0.1:5173",
        },
      },
    });
    expect(seen).toEqual([
      { path: "GET /api/commit-runtimes/abc" },
      {
        path: "POST /api/runtime-scheduler/start",
        body: {
          commitSha: "abc",
          taskId: "task-1",
          commitStepId: "step-1",
          runtimeLevel: 1,
          provider: "local-registered",
          targetUrl: "http://127.0.0.1:5173",
          previewUrl: "/preview/commits/abc",
          ttlSeconds: 1800,
        },
      },
    ]);
  });
});
