import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const dashboardRoutes = new Hono();

function buildForwardedQuery(c: { req: { query: (name: string) => string | undefined } }, keys: string[]) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = c.req.query(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

dashboardRoutes.get("/provider-tokens", async (c) => {
  const query = buildForwardedQuery(c, ["projectId", "range"]);
  const result = await cpFetch(`/api/dashboard/provider-tokens${query}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.status as 200 | 400 | 401 | 403 | 500 | 502);
});