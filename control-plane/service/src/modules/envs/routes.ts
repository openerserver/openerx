import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { environments, projects } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const envRoutes = new Hono();

envRoutes.use("*", authMiddleware);

const createEnvSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(50),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  requiresApproval: z.boolean().default(false),
});

// GET /api/envs?projectId=
envRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  const result = await db.query.environments.findMany({
    where: eq(environments.projectId, projectId),
  });
  return c.json(result);
});

// POST /api/envs
envRoutes.post(
  "/",
  requireRole("project_admin"),
  zValidator("json", createEnvSchema),
  async (c) => {
    const body = c.req.valid("json");
    const id = crypto.randomUUID();

    // Verify project exists
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, body.projectId),
    });
    if (!project) return c.json({ error: "Project not found" }, 404);

    await db.insert(environments).values({
      id,
      projectId: body.projectId,
      name: body.name,
      riskLevel: body.riskLevel,
      requiresApproval: body.requiresApproval,
    });

    return c.json({ id, ...body }, 201);
  },
);
