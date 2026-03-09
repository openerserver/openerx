import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { environments, projects } from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";

export const envRoutes = new Hono<AppEnv>();

envRoutes.use("*", authMiddleware);

const createEnvSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(50),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  requiresApproval: z.boolean().default(false),
});

const updateEnvSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  requiresApproval: z.boolean().optional(),
});

type ProjectRole = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

function hasProjectAccess(user: JWTPayload, projectId: string, minRole: ProjectRole) {
  const globalLevel = ROLE_HIERARCHY[user.role as ProjectRole] ?? 0;
  if (globalLevel >= ROLE_HIERARCHY.org_admin) {
    return true;
  }

  const projectRole = user.projects?.find((item) => item.id === projectId)?.role as
    | ProjectRole
    | undefined;
  const projectLevel = projectRole ? ROLE_HIERARCHY[projectRole] : 0;
  return projectLevel >= ROLE_HIERARCHY[minRole];
}

// GET /api/envs?projectId=
envRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  const user = c.get("user") as JWTPayload;
  if (!hasProjectAccess(user, projectId, "viewer")) {
    return c.json({ error: "No access to this project" }, 403);
  }

  const result = await db.query.environments.findMany({
    where: eq(environments.projectId, projectId),
  });
  return c.json(result);
});

// POST /api/envs
envRoutes.post("/", zValidator("json", createEnvSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user") as JWTPayload;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Verify project exists
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, body.projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  if (!hasProjectAccess(user, body.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db.insert(environments).values({
    id,
    projectId: body.projectId,
    name: body.name,
    riskLevel: body.riskLevel,
    requiresApproval: body.requiresApproval,
    createdAt,
  });

  return c.json({ id, ...body, createdAt }, 201);
});

// PATCH /api/envs/:envId
envRoutes.patch("/:envId", zValidator("json", updateEnvSchema), async (c) => {
  const envId = c.req.param("envId");
  const body = c.req.valid("json");
  const user = c.get("user") as JWTPayload;

  const existing = await db.query.environments.findFirst({
    where: eq(environments.id, envId),
  });
  if (!existing) return c.json({ error: "Environment not found" }, 404);

  if (!hasProjectAccess(user, existing.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db
    .update(environments)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.riskLevel !== undefined ? { riskLevel: body.riskLevel } : {}),
      ...(body.requiresApproval !== undefined ? { requiresApproval: body.requiresApproval } : {}),
    })
    .where(eq(environments.id, envId));

  return c.json({
    id: envId,
    projectId: existing.projectId,
    name: body.name ?? existing.name,
    riskLevel: body.riskLevel ?? existing.riskLevel,
    requiresApproval: body.requiresApproval ?? existing.requiresApproval,
  });
});

// DELETE /api/envs/:envId
envRoutes.delete("/:envId", async (c) => {
  const envId = c.req.param("envId");
  const user = c.get("user") as JWTPayload;

  const existing = await db.query.environments.findFirst({
    where: eq(environments.id, envId),
  });
  if (!existing) return c.json({ error: "Environment not found" }, 404);

  if (!hasProjectAccess(user, existing.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db.delete(environments).where(eq(environments.id, envId));

  return c.json({ ok: true });
});
