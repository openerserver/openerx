import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { roleAgentBindings, roleAgents } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const roleAgentRoutes = new Hono<AppEnv>();

roleAgentRoutes.use("*", authMiddleware);
roleAgentRoutes.use("*", requireRole("org_admin"));

const roleAgentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.enum(["system", "project"]).default("system"),
  permissionProfile: z.string().min(1),
  toolProfile: z.string().min(1),
  defaultExecutionMode: z.enum(["single", "parallel-review", "round-robin"]),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]).optional(),
  maxActiveBindings: z.number().int().positive().optional(),
  requireConsensus: z.boolean().optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  requiresApprovalForWrite: z.boolean().optional(),
  outputSchemaId: z.string().optional(),
  ownerTeam: z.string().optional(),
  tagsJson: z.array(z.string()).optional(),
});

const roleAgentPatchSchema = roleAgentSchema.partial().omit({ id: true });

const roleAgentBindingSchema = z.object({
  bindingKey: z.string().min(1),
  runtimeAgent: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1),
  model: z.string().optional(),
  tagsJson: z.array(z.string()).optional(),
});

const roleAgentBindingPatchSchema = roleAgentBindingSchema.partial();

roleAgentRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const scope = c.req.query("scope");
  const status = c.req.query("status");

  const conditions = [];
  if (projectId) conditions.push(eq(roleAgents.projectId, projectId));
  if (scope) conditions.push(eq(roleAgents.scope, scope as "system" | "project"));
  if (status) {
    conditions.push(eq(roleAgents.status, status as "active" | "disabled" | "deprecated"));
  }

  const rows = await db
    .select()
    .from(roleAgents)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return c.json({ data: rows });
});

roleAgentRoutes.post("/", zValidator("json", roleAgentSchema), async (c) => {
  const body = c.req.valid("json");
  const now = new Date().toISOString();
  await db.insert(roleAgents).values({
    id: body.id,
    projectId: body.projectId ?? null,
    name: body.name,
    description: body.description ?? null,
    scope: body.scope,
    status: "active",
    ownerTeam: body.ownerTeam ?? null,
    permissionProfile: body.permissionProfile,
    toolProfile: body.toolProfile,
    defaultExecutionMode: body.defaultExecutionMode,
    aggregationStrategy: body.aggregationStrategy ?? null,
    maxActiveBindings: body.maxActiveBindings ?? null,
    requireConsensus: body.requireConsensus ?? false,
    riskLevel: body.riskLevel ?? "low",
    requiresApprovalForWrite: body.requiresApprovalForWrite ?? false,
    outputSchemaId: body.outputSchemaId ?? null,
    tagsJson: body.tagsJson ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, body.id) });
  return c.json(created, 201);
});

roleAgentRoutes.patch("/:roleAgentId", zValidator("json", roleAgentPatchSchema), async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const body = c.req.valid("json");
  await db
    .update(roleAgents)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(roleAgents.id, roleAgentId));

  const updated = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
  if (!updated) return c.json({ error: "Role agent not found" }, 404);
  return c.json(updated);
});

roleAgentRoutes.get("/:roleAgentId/bindings", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const rows = await db
    .select()
    .from(roleAgentBindings)
    .where(eq(roleAgentBindings.roleAgentId, roleAgentId));
  return c.json({ data: rows });
});

roleAgentRoutes.post("/:roleAgentId/bindings", zValidator("json", roleAgentBindingSchema), async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const body = c.req.valid("json");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(roleAgentBindings).values({
    id,
    roleAgentId,
    bindingKey: body.bindingKey,
    runtimeAgent: body.runtimeAgent,
    label: body.label,
    enabled: body.enabled ?? true,
    priority: body.priority,
    model: body.model ?? null,
    tagsJson: body.tagsJson ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.roleAgentBindings.findFirst({
    where: eq(roleAgentBindings.id, id),
  });
  return c.json(created, 201);
});

roleAgentRoutes.patch(
  "/:roleAgentId/bindings/:bindingId",
  zValidator("json", roleAgentBindingPatchSchema),
  async (c) => {
    const roleAgentId = c.req.param("roleAgentId");
    const bindingId = c.req.param("bindingId");
    const body = c.req.valid("json");

    await db
      .update(roleAgentBindings)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(and(eq(roleAgentBindings.id, bindingId), eq(roleAgentBindings.roleAgentId, roleAgentId)));

    const updated = await db.query.roleAgentBindings.findFirst({
      where: eq(roleAgentBindings.id, bindingId),
    });
    if (!updated) return c.json({ error: "Role agent binding not found" }, 404);
    return c.json(updated);
  },
);