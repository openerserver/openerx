import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const costRoutes = new Hono();

costRoutes.get("/budget", async (c) => {
  const projectId = c.req.query("projectId") || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);

  const query = params.toString();
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/cost/budget${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

costRoutes.post("/budget", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/cost/budget", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 502));
});

costRoutes.patch("/budget/:budgetId", async (c) => {
  const budgetId = c.req.param("budgetId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/cost/budget/${budgetId}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});
