import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const policyRoutes = new Hono();

policyRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId") || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);

  const query = params.toString();
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/policies${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

policyRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/policies", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 502));
});

policyRoutes.patch("/:policyId", async (c) => {
  const policyId = c.req.param("policyId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/policies/${policyId}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});
