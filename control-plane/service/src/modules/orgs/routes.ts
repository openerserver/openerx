import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { organizations, projectRoles, projects } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { normalizeApiTimestampFields } from "../shared/api-timestamp";

export const orgRoutes = new Hono<AppEnv>();

orgRoutes.use("*", authMiddleware);

function normalizeOrganizationRecord<T extends { createdAt?: string | null }>(org: T) {
  return normalizeApiTimestampFields(org, ["createdAt"] as const);
}

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
});

// GET /api/orgs
orgRoutes.get("/", async (c) => {
  const user = c.get("user");
  const isGlobalAdmin = user.role === "platform_admin" || user.role === "org_admin";

  if (isGlobalAdmin) {
    const orgs = await db.query.organizations.findMany();
    return c.json(orgs.map((org) => normalizeOrganizationRecord(org)));
  }

  const memberships = await db.query.projectRoles.findMany({
    where: eq(projectRoles.userId, user.sub),
  });
  const projectIds = memberships.map((membership) => membership.projectId);

  if (projectIds.length === 0) {
    return c.json([]);
  }

  const visibleProjects = await db.query.projects.findMany({
    where: inArray(projects.id, projectIds),
  });
  const orgIds = [...new Set(visibleProjects.map((project) => project.orgId))];

  if (orgIds.length === 0) {
    return c.json([]);
  }

  const orgs = await db.query.organizations.findMany({
    where: inArray(organizations.id, orgIds),
  });
  return c.json(orgs.map((org) => normalizeOrganizationRecord(org)));
});

// POST /api/orgs
orgRoutes.post("/", requireRole("org_admin"), zValidator("json", createOrgSchema), async (c) => {
  const { name, slug } = c.req.valid("json");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.insert(organizations).values({ id, name, slug, createdAt });

  return c.json(normalizeOrganizationRecord({ id, name, slug, createdAt }), 201);
});

// GET /api/orgs/:orgId
orgRoutes.get("/:orgId", async (c) => {
  const orgId = c.req.param("orgId");
  const user = c.get("user");

  if (user.role !== "platform_admin" && user.role !== "org_admin") {
    const membership = await db
      .select({ orgId: projects.orgId })
      .from(projectRoles)
      .innerJoin(projects, eq(projectRoles.projectId, projects.id))
      .where(and(eq(projectRoles.userId, user.sub), eq(projects.orgId, orgId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!membership) {
      return c.json({ error: "Organization not found or access denied" }, 404);
    }
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) return c.json({ error: "Organization not found" }, 404);
  return c.json(normalizeOrganizationRecord(org));
});
