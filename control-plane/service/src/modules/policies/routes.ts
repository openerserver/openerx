import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { policyTemplates, projects } from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";

export const policyRoutes = new Hono<AppEnv>();

policyRoutes.use("*", authMiddleware);

const createPolicySchema = z.object({
  projectId: z.string().min(1),
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

// GET /api/policies?projectId=
policyRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  const user = c.get("user") as JWTPayload;
  if (!hasProjectAccess(user, projectId, "viewer")) {
    return c.json({ error: "No access to this project" }, 403);
  }

  const result = await db.query.policyTemplates.findMany({
    where: eq(policyTemplates.projectId, projectId),
  });
  return c.json(result);
});

// POST /api/policies
policyRoutes.post("/", zValidator("json", createPolicySchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user") as JWTPayload;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, body.projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  if (!hasProjectAccess(user, body.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db.insert(policyTemplates).values({
    id,
    projectId: body.projectId,
    name: body.name,
    type: body.type,
    rules: body.rules,
    appliesTo: body.appliesTo,
    createdAt,
  });

  return c.json({ id, ...body, createdAt }, 201);
});

// PATCH /api/policies/:policyId
policyRoutes.patch("/:policyId", zValidator("json", updatePolicySchema), async (c) => {
  const policyId = c.req.param("policyId");
  const body = c.req.valid("json");
  const user = c.get("user") as JWTPayload;

  const existing = await db.query.policyTemplates.findFirst({
    where: eq(policyTemplates.id, policyId),
  });
  if (!existing) return c.json({ error: "Policy not found" }, 404);

  if (!hasProjectAccess(user, existing.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db
    .update(policyTemplates)
    .set({
      ...(body.name && { name: body.name }),
      ...(body.rules && { rules: body.rules }),
      ...(body.appliesTo && { appliesTo: body.appliesTo }),
    })
    .where(eq(policyTemplates.id, policyId));

  return c.json({ id: policyId, ...body });
});
