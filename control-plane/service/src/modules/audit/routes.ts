import { Hono } from "hono";
import { z } from "zod";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../../db";
import { auditEvents } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const auditRoutes = new Hono();

auditRoutes.use("*", authMiddleware);
auditRoutes.use("*", requireRole("developer"));

// GET /api/audit?projectId=&userId=&from=&to=&type=&limit=&offset=
auditRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const userId = c.req.query("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const eventType = c.req.query("type");
  const limit = Math.min(Number(c.req.query("limit") || 50), 500);
  const offset = Number(c.req.query("offset") || 0);

  // Build conditions
  const conditions = [];
  if (projectId) conditions.push(eq(auditEvents.projectId, projectId));
  if (userId) conditions.push(eq(auditEvents.userId, userId));
  if (from) conditions.push(gte(auditEvents.ts, from));
  if (to) conditions.push(lte(auditEvents.ts, to));
  if (eventType) conditions.push(eq(auditEvents.eventType, eventType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.ts))
    .limit(limit)
    .offset(offset);

  return c.json({ data: result, limit, offset });
});

// GET /api/audit/:eventId
auditRoutes.get("/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  const event = await db.query.auditEvents.findFirst({
    where: eq(auditEvents.id, eventId),
  });

  if (!event) return c.json({ error: "Audit event not found" }, 404);
  return c.json(event);
});

// GET /api/audit/trace/:traceId
auditRoutes.get("/trace/:traceId", async (c) => {
  const traceId = c.req.param("traceId");
  const result = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.traceId, traceId))
    .orderBy(auditEvents.ts);

  return c.json(result);
});

/**
 * Utility: record an audit event (called from other modules).
 */
export async function recordAuditEvent(event: {
  userId?: string;
  projectId?: string;
  sessionId?: string;
  taskId?: string;
  agentRunId?: string;
  eventType: string;
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
  riskLevel?: "low" | "medium" | "high" | "critical";
  traceId?: string;
}) {
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    ...event,
  });
}
