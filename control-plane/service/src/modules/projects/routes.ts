import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { organizations, projectRoles, projects, users, type ProjectSettings } from "../../db/schema";
import { authMiddleware, type AppEnv, type JWTPayload } from "../../middleware/auth";
import { requireProjectRole, requireRole } from "../../middleware/rbac";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.use("*", authMiddleware);

const approvalPolicyModeSchema = z.enum(["balanced", "strict", "manual"]);

const environmentApprovalPolicyBindingSchema = z.object({
  approvalPolicy: approvalPolicyModeSchema.optional(),
  policyTemplateId: z.string().min(1).optional(),
});

const projectSettingsSchema = z.object({
  defaultModel: z.string().min(1).optional(),
  defaultEnvironmentId: z.string().min(1).optional(),
  approvalPolicyTemplateId: z.string().min(1).optional(),
  approvalPolicy: approvalPolicyModeSchema.optional(),
  environmentApprovalPolicies: z.record(environmentApprovalPolicyBindingSchema).optional(),
  maxConcurrency: z.number().int().min(1).max(100).optional(),
  budgetMonthly: z.number().min(0).optional(),
  budgetConfigId: z.string().min(1).optional(),
  warnThreshold: z.number().min(0).max(1).optional(),
  throttleThreshold: z.number().min(0).max(1).optional(),
});

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

const createProjectSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  settings: projectSettingsSchema.optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  settings: projectSettingsSchema.optional(),
});

const projectMemberRoleSchema = z.enum(["project_admin", "developer", "viewer"]);

const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  role: projectMemberRoleSchema.default("developer"),
});

const updateProjectMemberSchema = z.object({
  role: projectMemberRoleSchema,
});

function normalizeProjectSettings(settings: unknown): ProjectSettings | null | undefined {
  if (settings == null) {
    return settings as null | undefined;
  }

  if (typeof settings === "string") {
    try {
      return JSON.parse(settings) as ProjectSettings;
    } catch {
      return undefined;
    }
  }

  return settings as ProjectSettings;
}

function normalizeProjectRecord<T extends { settings?: unknown }>(project: T): Omit<T, "settings"> & {
  settings?: ProjectSettings | null;
} {
  return {
    ...project,
    settings: normalizeProjectSettings(project.settings),
  };
}

async function getProjectOrNull(projectId: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
}

async function listProjectAdmins(projectId: string) {
  return db.query.projectRoles.findMany({
    where: eq(projectRoles.projectId, projectId),
  });
}

function hasGlobalProjectAccess(user: JWTPayload) {
  const level = ROLE_HIERARCHY[user.role as Role] ?? 0;
  return level >= ROLE_HIERARCHY.org_admin;
}

async function listVisibleProjects(user: JWTPayload, orgId?: string) {
  if (hasGlobalProjectAccess(user)) {
    return db.query.projects.findMany({
      ...(orgId ? { where: eq(projects.orgId, orgId) } : {}),
    });
  }

  const memberships = await db.query.projectRoles.findMany({
    where: eq(projectRoles.userId, user.sub),
  });
  const visibleProjectIds = memberships.map((membership) => membership.projectId);

  if (visibleProjectIds.length === 0) {
    return [];
  }

  return db.query.projects.findMany({
    where: orgId
      ? and(inArray(projects.id, visibleProjectIds), eq(projects.orgId, orgId))
      : inArray(projects.id, visibleProjectIds),
  });
}

async function getVisibleProjectOrNull(user: JWTPayload, projectId: string) {
  if (hasGlobalProjectAccess(user)) {
    return getProjectOrNull(projectId);
  }

  const membership = await db.query.projectRoles.findFirst({
    where: and(eq(projectRoles.userId, user.sub), eq(projectRoles.projectId, projectId)),
  });

  if (!membership) {
    return null;
  }

  return getProjectOrNull(projectId);
}

// GET /api/projects?orgId=
projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const orgId = c.req.query("orgId");
  const result = await listVisibleProjects(user, orgId || undefined);
  return c.json(result.map((project) => normalizeProjectRecord(project)));
});

// POST /api/projects
projectRoutes.post(
  "/",
  requireRole("org_admin"),
  zValidator("json", createProjectSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

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
      createdAt,
    });

    await db.insert(projectRoles).values({
      id: crypto.randomUUID(),
      projectId: id,
      userId: user.sub,
      role: "project_admin",
    });

    return c.json({ id, ...body, createdAt }, 201);
  },
);

// GET /api/projects/:projectId/members
projectRoutes.get("/:projectId/members", requireProjectRole("projectId", "viewer"), async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getProjectOrNull(projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const members = await db
    .select({
      userId: projectRoles.userId,
      projectId: projectRoles.projectId,
      role: projectRoles.role,
      username: users.username,
      displayName: users.displayName,
      globalRole: users.role,
      createdAt: users.createdAt,
    })
    .from(projectRoles)
    .innerJoin(users, eq(projectRoles.userId, users.id))
    .where(eq(projectRoles.projectId, projectId));

  return c.json(members);
});

// GET /api/projects/:projectId/members/candidates
projectRoutes.get(
  "/:projectId/members/candidates",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const project = await getProjectOrNull(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const existingMembers = await db.query.projectRoles.findMany({
      where: eq(projectRoles.projectId, projectId),
    });
    const existingUserIds = new Set(existingMembers.map((item) => item.userId));

    const allUsers = await db.query.users.findMany({
      columns: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true,
        passwordHash: false,
      },
    });

    return c.json(allUsers.filter((user) => !existingUserIds.has(user.id)));
  },
);

// POST /api/projects/:projectId/members
projectRoutes.post(
  "/:projectId/members",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", addProjectMemberSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const project = await getProjectOrNull(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const user = await db.query.users.findFirst({
      where: eq(users.id, body.userId),
      columns: { passwordHash: false },
    });
    if (!user) return c.json({ error: "User not found" }, 404);

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, body.userId)),
    });
    if (existing) return c.json({ error: "User is already a project member" }, 409);

    await db.insert(projectRoles).values({
      id: crypto.randomUUID(),
      projectId,
      userId: body.userId,
      role: body.role,
    });

    return c.json(
      {
        userId: user.id,
        projectId,
        role: body.role,
        username: user.username,
        displayName: user.displayName,
        globalRole: user.role,
        createdAt: user.createdAt,
      },
      201,
    );
  },
);

// PATCH /api/projects/:projectId/members/:userId
projectRoutes.patch(
  "/:projectId/members/:userId",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", updateProjectMemberSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");
    const body = c.req.valid("json");

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)),
    });
    if (!existing) return c.json({ error: "Project member not found" }, 404);

    if (existing.role === "project_admin" && body.role !== "project_admin") {
      const admins = await listProjectAdmins(projectId);
      const adminCount = admins.filter((item) => item.role === "project_admin").length;
      if (adminCount <= 1) {
        return c.json({ error: "Project must retain at least one project_admin" }, 400);
      }
    }

    await db
      .update(projectRoles)
      .set({ role: body.role })
      .where(and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)));

    return c.json({ userId, projectId, role: body.role });
  },
);

// DELETE /api/projects/:projectId/members/:userId
projectRoutes.delete(
  "/:projectId/members/:userId",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)),
    });
    if (!existing) return c.json({ error: "Project member not found" }, 404);

    if (existing.role === "project_admin") {
      const admins = await listProjectAdmins(projectId);
      const adminCount = admins.filter((item) => item.role === "project_admin").length;
      if (adminCount <= 1) {
        return c.json({ error: "Project must retain at least one project_admin" }, 400);
      }
    }

    await db
      .delete(projectRoles)
      .where(and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)));

    return c.json({ ok: true });
  },
);

// GET /api/projects/:projectId
projectRoutes.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }
  return c.json(normalizeProjectRecord(project));
});

// PATCH /api/projects/:projectId
projectRoutes.patch(
  "/:projectId",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", updateProjectSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!existing) return c.json({ error: "Project not found" }, 404);

    const existingSettings = normalizeProjectSettings(existing.settings) ?? {};
    const nextSettings = body.settings ? { ...existingSettings, ...body.settings } : existingSettings;

    await db
      .update(projects)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.settings && { settings: nextSettings }),
      })
      .where(eq(projects.id, projectId));

    return c.json(
      normalizeProjectRecord({
        ...existing,
        ...body,
        id: projectId,
        settings: body.settings ? nextSettings : existingSettings,
      }),
    );
  },
);
