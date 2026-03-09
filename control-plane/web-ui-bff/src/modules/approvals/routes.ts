import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { cpFetch, authHeader } from "../../lib/control-plane-client";

// ── Approval Routes (BFF) ──────────────────────────────────────────
// Proxies approval operations to the Control Plane and broadcasts events.

export const approvalRoutes = new Hono();

// GET /api/approvals?status=pending
approvalRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await cpFetch(`/api/approvals${query}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 502));
});

// POST /api/approvals/:ticketId/resolve
const resolveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(500).optional(),
});

approvalRoutes.post(
  "/:ticketId/resolve",
  zValidator("json", resolveSchema),
  async (c) => {
    const ticketId = c.req.param("ticketId");
    const body = c.req.valid("json");
    const result = await cpFetch(`/api/approvals/${ticketId}/resolve`, {
      method: "POST",
      body,
      authorization: authHeader(c),
    });
    return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 410 | 500));
  },
);
