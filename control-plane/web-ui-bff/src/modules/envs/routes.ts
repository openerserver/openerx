import { Hono } from "hono";
import { cpFetch, authHeader } from "../../lib/control-plane-client";

export const envRoutes = new Hono();

// GET /api/envs?projectId=
envRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId") || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);

  const query = params.toString();
  const result = await cpFetch<Array<Record<string, unknown>>>(`/api/envs${query ? `?${query}` : ""}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// POST /api/envs
envRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/envs", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// PATCH /api/envs/:envId
envRoutes.patch("/:envId", async (c) => {
  const envId = c.req.param("envId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/envs/${envId}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// DELETE /api/envs/:envId
envRoutes.delete("/:envId", async (c) => {
  const envId = c.req.param("envId");
  const result = await cpFetch<Record<string, unknown>>(`/api/envs/${envId}`, {
    method: "DELETE",
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});