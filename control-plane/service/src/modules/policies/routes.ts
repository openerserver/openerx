import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { policyTemplates, projects } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const policyRoutes = new Hono();

policyRoutes.use("*", authMiddleware);

const createPolicySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum(["tool_whitelist", "path_whitelist", "command_level", "concurrency", "model"]),
  rules: z.record(z.unknown()),
  appliesTo: z.enum(["all", "environment", "agent"]).default("all"),
});

const updatePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rules: z.record(z.unknown()).optional(),
  appliesTo: z.enum(["all", "environment", "agent"]).optional(),
});

// GET /api/policies?projectId=
policyRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  const result = await db.query.policyTemplates.findMany({
    where: eq(policyTemplates.projectId, projectId),
  });
  return c.json(result);
});

// POST /api/policies
policyRoutes.post(
  "/",
  requireRole("project_admin"),
  zValidator("json", createPolicySchema),
  async (c) => {
    const body = c.req.valid("json");
    const id = crypto.randomUUID();

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, body.projectId),
    });
    if (!project) return c.json({ error: "Project not found" }, 404);

    await db.insert(policyTemplates).values({
      id,
      projectId: body.projectId,
      name: body.name,
      type: body.type,
      rules: body.rules,
      appliesTo: body.appliesTo,
    });

    return c.json({ id, ...body }, 201);
  },
);

// PATCH /api/policies/:policyId
policyRoutes.patch(
  "/:policyId",
  requireRole("project_admin"),
  zValidator("json", updatePolicySchema),
  async (c) => {
    const policyId = c.req.param("policyId");
    const body = c.req.valid("json");

    const existing = await db.query.policyTemplates.findFirst({
      where: eq(policyTemplates.id, policyId),
    });
    if (!existing) return c.json({ error: "Policy not found" }, 404);

    await db
      .update(policyTemplates)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.rules && { rules: body.rules }),
        ...(body.appliesTo && { appliesTo: body.appliesTo }),
      })
      .where(eq(policyTemplates.id, policyId));

    return c.json({ id: policyId, ...body });
  },
);
