import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const auditRoutes = new Hono();

const auditQueryKeys = ["projectId", "userId", "from", "to", "type", "limit", "offset"] as const;

function buildAuditQuery(params: Record<(typeof auditQueryKeys)[number], string>) {
  const searchParams = new URLSearchParams();

  for (const key of auditQueryKeys) {
    const value = params[key];
    if (value) {
      searchParams.set(key, value);
    }
  }

  return searchParams.toString();
}

function getAuditQueryParams(c: { req: { query: (key: string) => string | undefined } }) {
  return {
    projectId: c.req.query("projectId") || "",
    userId: c.req.query("userId") || "",
    from: c.req.query("from") || "",
    to: c.req.query("to") || "",
    type: c.req.query("type") || "",
    limit: c.req.query("limit") || "",
    offset: c.req.query("offset") || "",
  };
}

// GET /api/audit
auditRoutes.get("/", async (c) => {
  const query = buildAuditQuery(getAuditQueryParams(c));
  const result = await cpFetch(`/api/audit${query ? `?${query}` : ""}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});
