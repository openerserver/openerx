import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const roleAgentRoutes = new Hono();

roleAgentRoutes.get("/", async (c) => {
  const params = new URLSearchParams();
  for (const key of [
    "projectId",
    "scope",
    "status",
    "includeBindings",
    "includeDisabledBindings",
  ]) {
    const value = c.req.query(key);
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

roleAgentRoutes.get("/:roleAgentId", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

roleAgentRoutes.get("/:roleAgentId/resolve", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const params = new URLSearchParams();
  for (const key of ["projectId", "stage", "templateId"]) {
    const value = c.req.query(key);
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/resolve${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

roleAgentRoutes.get("/:roleAgentId/bindings", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const params = new URLSearchParams();
  const projectId = c.req.query("projectId");
  if (projectId) {
    params.set("projectId", projectId);
  }

  const query = params.toString();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/bindings${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

roleAgentRoutes.post("/:roleAgentId/bindings", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/bindings`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

roleAgentRoutes.patch("/:roleAgentId/bindings/:bindingId", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const bindingId = c.req.param("bindingId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/bindings/${encodeURIComponent(bindingId)}`,
    {
      method: "PATCH",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(
    result.data,
    result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

roleAgentRoutes.get("/:roleAgentId/projects/:projectId/override", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/projects/${encodeURIComponent(projectId)}/override`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

roleAgentRoutes.put("/:roleAgentId/projects/:projectId/override", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/projects/${encodeURIComponent(projectId)}/override`,
    {
      method: "PUT",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});
