import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const workbenchRoutes = new Hono();

// GET /api/workbench/layout
workbenchRoutes.get("/layout", async (c) => {
  const result = await cpFetch<{ data: Record<string, unknown> }>("/api/workbench/layout", {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

// PUT /api/workbench/layout
workbenchRoutes.put("/layout", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<{ ok: boolean }>("/api/workbench/layout", {
    method: "PUT",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 502));
});
