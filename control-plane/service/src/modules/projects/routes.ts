import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { projects, organizations } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const projectRoutes = new Hono();

projectRoutes.use("*", authMiddleware);

const createProjectSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  settings: z
    .object({
      defaultModel: z.string().optional(),
      maxConcurrency: z.number().int().min(1).max(100).optional(),
      budgetMonthly: z.number().min(0).optional(),
    })
    .optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  settings: z
    .object({
      defaultModel: z.string().optional(),
      maxConcurrency: z.number().int().min(1).max(100).optional(),
      budgetMonthly: z.number().min(0).optional(),
    })
    .optional(),
});

// GET /api/projects?orgId=
projectRoutes.get("/", async (c) => {
  const orgId = c.req.query("orgId");
  if (orgId) {
    const result = await db.query.projects.findMany({
      where: eq(projects.orgId, orgId),
    });
    return c.json(result);
  }
  const result = await db.query.projects.findMany();
  return c.json(result);
});

// POST /api/projects
projectRoutes.post(
  "/",
  requireRole("project_admin"),
  zValidator("json", createProjectSchema),
  async (c) => {
    const body = c.req.valid("json");
    const id = crypto.randomUUID();

    // Verify org exists
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, body.orgId),
    });
    if (!org) return c.json({ error: "Organization not found" }, 404);

    await db.insert(projects).values({
      id,
      orgId: body.orgId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      settings: body.settings,
    });

    return c.json({ id, ...body }, 201);
  },
);

// GET /api/projects/:projectId
projectRoutes.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json(project);
});

// PATCH /api/projects/:projectId
projectRoutes.patch(
  "/:projectId",
  requireRole("project_admin"),
  zValidator("json", updateProjectSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!existing) return c.json({ error: "Project not found" }, 404);

    await db
      .update(projects)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.settings && { settings: { ...existing.settings, ...body.settings } }),
      })
      .where(eq(projects.id, projectId));

    return c.json({ id: projectId, ...body });
  },
);
