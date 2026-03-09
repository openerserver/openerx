import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const projectRoutes = new Hono();

// GET /api/projects?orgId=
projectRoutes.get("/", async (c) => {
  const orgId = c.req.query("orgId") || "";
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);

  const query = params.toString();
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/projects${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// POST /api/projects
projectRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/projects", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 404 | 502));
});

// GET /api/projects/:projectId/members
projectRoutes.get("/:projectId/members", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/projects/${projectId}/members`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// GET /api/projects/:projectId/members/candidates
projectRoutes.get("/:projectId/members/candidates", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/projects/${projectId}/members/candidates`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// POST /api/projects/:projectId/members
projectRoutes.post("/:projectId/members", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}/members`, {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

// PATCH /api/projects/:projectId/members/:userId
projectRoutes.patch("/:projectId/members/:userId", async (c) => {
  const projectId = c.req.param("projectId");
  const userId = c.req.param("userId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/members/${userId}`,
    {
      method: "PATCH",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// DELETE /api/projects/:projectId/members/:userId
projectRoutes.delete("/:projectId/members/:userId", async (c) => {
  const projectId = c.req.param("projectId");
  const userId = c.req.param("userId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/members/${userId}`,
    {
      method: "DELETE",
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// GET /api/projects/:projectId
projectRoutes.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// PATCH /api/projects/:projectId
projectRoutes.patch("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 502));
});
