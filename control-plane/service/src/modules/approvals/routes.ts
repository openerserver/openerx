import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { approvalTickets } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";

export const approvalRoutes = new Hono<AppEnv>();

function toAuditRiskLevel(
  value: string | null | undefined,
): "low" | "medium" | "high" | "critical" | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }

  return undefined;
}

approvalRoutes.use("*", authMiddleware);

const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
// GET /api/approvals?status=pending
approvalRoutes.get("/", requireRole("developer"), async (c) => {
  const status = c.req.query("status");
  const parsedStatus = status ? approvalStatusSchema.safeParse(status) : null;
  if (status && !parsedStatus?.success) {
    return c.json({ error: "Invalid approval status" }, 400);
  }

  const result = await db.query.approvalTickets.findMany({
    ...(parsedStatus?.success ? { where: eq(approvalTickets.status, parsedStatus.data) } : {}),
  });
  return c.json(result);
});

// GET /api/approvals/:ticketId
approvalRoutes.get("/:ticketId", requireRole("developer"), async (c) => {
  const ticketId = c.req.param("ticketId");
  const ticket = await db.query.approvalTickets.findFirst({
    where: eq(approvalTickets.id, ticketId),
  });
  if (!ticket) return c.json({ error: "Approval ticket not found" }, 404);
  return c.json(ticket);
});

// POST /api/approvals/:ticketId/resolve
const resolveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(500).optional(),
});

approvalRoutes.post(
  "/:ticketId/resolve",
  requireRole("project_admin"),
  zValidator("json", resolveSchema),
  async (c) => {
    const ticketId = c.req.param("ticketId");
    const { action, comment } = c.req.valid("json");
    const user = c.get("user");

    const ticket = await db.query.approvalTickets.findFirst({
      where: eq(approvalTickets.id, ticketId),
    });
    if (!ticket) return c.json({ error: "Approval ticket not found" }, 404);

    if (ticket.status !== "pending") {
      return c.json({ error: `Ticket already ${ticket.status}` }, 409);
    }

    // Check if expired
    if (new Date(ticket.expiresAt) < new Date()) {
      await db
        .update(approvalTickets)
        .set({ status: "expired", resolvedAt: new Date().toISOString() })
        .where(eq(approvalTickets.id, ticketId));
      return c.json({ error: "Ticket has expired" }, 410);
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    await db
      .update(approvalTickets)
      .set({
        status: newStatus,
        approver: user.sub,
        comment,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(approvalTickets.id, ticketId));

    // Record audit event
    await recordAuditEvent({
      userId: user.sub,
      taskId: ticket.taskId,
      agentRunId: ticket.agentRunId || undefined,
      eventType: "approval",
      action: newStatus,
      target: ticketId,
      detail: { comment, actionType: ticket.actionType, riskLevel: ticket.riskLevel },
      riskLevel: toAuditRiskLevel(ticket.riskLevel),
    });

    return c.json({ id: ticketId, status: newStatus, approver: user.sub, comment });
  },
);

/**
 * Utility: create an approval ticket (called from orchestration layer).
 */
export async function createApprovalTicket(ticket: {
  taskId: string;
  agentRunId?: string;
  actionType:
    | "production_write"
    | "level3_command"
    | "budget_exceed"
    | "batch_edit"
    | "external_api";
  riskLevel: "medium" | "high" | "critical";
  requestDetail: Record<string, unknown>;
}) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4h

  await db.insert(approvalTickets).values({
    id,
    taskId: ticket.taskId,
    agentRunId: ticket.agentRunId,
    actionType: ticket.actionType,
    riskLevel: ticket.riskLevel,
    requestDetail: ticket.requestDetail,
    expiresAt,
  });

  return { id, expiresAt };
}
