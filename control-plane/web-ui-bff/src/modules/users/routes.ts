import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const userRoutes = new Hono();

// GET /api/users
userRoutes.get("/", async (c) => {
  const result = await cpFetch<Array<Record<string, unknown>>>("/api/users", {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

// POST /api/users
userRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/users", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 409 | 502));
});

// PATCH /api/users/:userId
userRoutes.patch("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/users/${userId}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// PUT /api/users/:userId/role
userRoutes.put("/:userId/role", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/users/${userId}/role`, {
    method: "PUT",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// PUT /api/users/:userId/status
userRoutes.put("/:userId/status", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/users/${userId}/status`, {
    method: "PUT",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});
