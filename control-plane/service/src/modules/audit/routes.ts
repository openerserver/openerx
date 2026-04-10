import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { auditEvents } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { normalizeApiTimestampFields } from "../shared/api-timestamp";

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.use("*", authMiddleware);
auditRoutes.use("*", requireRole("developer"));

function normalizeAuditEventRecord<T extends { ts?: string | null } & Record<string, unknown>>(
  event: T,
) {
  return normalizeApiTimestampFields(event, ["ts"] as const);
}

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

  return c.json({ data: result.map((event) => normalizeAuditEventRecord(event)), limit, offset });
});

// GET /api/audit/:eventId
auditRoutes.get("/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  const event = await db.query.auditEvents.findFirst({
    where: eq(auditEvents.id, eventId),
  });

  if (!event) return c.json({ error: "Audit event not found" }, 404);
  return c.json(normalizeAuditEventRecord(event));
});

// GET /api/audit/trace/:traceId
auditRoutes.get("/trace/:traceId", async (c) => {
  const traceId = c.req.param("traceId");
  const result = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.traceId, traceId))
    .orderBy(auditEvents.ts);

  return c.json(result.map((event) => normalizeAuditEventRecord(event)));
});

const createAuditEventSchema = z.object({
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  agentRunId: z.string().min(1).optional(),
  eventType: z.string().min(1).max(100),
  action: z.string().min(1).max(100),
  target: z.string().max(500).optional(),
  detail: z.record(z.unknown()).optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  traceId: z.string().min(1).max(200).optional(),
});

// POST /api/audit
auditRoutes.post("/", zValidator("json", createAuditEventSchema), async (c) => {
  const user = c.get("user");
  if (user.role !== "platform_admin" && user.role !== "org_admin" && user.role !== "admin") {
    return c.json({ error: "Requires org_admin role" }, 403);
  }

  const body = c.req.valid("json");
  await recordAuditEvent({
    userId: user.sub,
    projectId: body.projectId,
    sessionId: body.sessionId,
    taskId: body.taskId,
    agentRunId: body.agentRunId,
    eventType: body.eventType,
    action: body.action,
    target: body.target,
    detail: body.detail,
    riskLevel: body.riskLevel,
    traceId: body.traceId,
  });

  return c.json({ ok: true }, 201);
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
