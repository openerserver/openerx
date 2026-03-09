import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const orgRoutes = new Hono();

// GET /api/orgs
orgRoutes.get("/", async (c) => {
  const result = await cpFetch<Array<Record<string, unknown>>>("/api/orgs", {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});
