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

afterEach(() => {
  setControlPlaneFetchHandler(null);
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
});
