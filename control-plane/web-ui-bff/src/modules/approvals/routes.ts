import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

// ── Approval Routes (BFF) ──────────────────────────────────────────
// Proxies approval operations to the Control Plane and broadcasts events.

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || "http://localhost:4097";

export const approvalRoutes = new Hono();

// GET /api/approvals?status=pending
approvalRoutes.get("/", async (c) => {
  const status = c.req.query("status") || "pending";
  try {
    const response = await fetch(`${CONTROL_PLANE_URL}/api/approvals?status=${status}`, {
      headers: { Authorization: c.req.header("Authorization") || "" },
    });
    const data = await response.json();
    return c.json(data);
  } catch (e) {
    return c.json({ error: `Failed to fetch approvals: ${e}` }, 502);
  }
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

    try {
      const response = await fetch(`${CONTROL_PLANE_URL}/api/approvals/${ticketId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: c.req.header("Authorization") || "",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return c.json(data, response.ok ? 200 : response.status);
    } catch (e) {
      return c.json({ error: `Failed to resolve approval: ${e}` }, 502);
    }
  },
);
