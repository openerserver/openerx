import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { projects, repositories } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireProjectRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";

type RepoEnv = AppEnv & { Variables: AppEnv["Variables"] };

export const repositoryRoutes = new Hono<RepoEnv>();

function getProjectId(c: { req: { param: (name: string) => string | undefined } }): string {
  const id = c.req.param("projectId");
  if (!id) throw new Error("projectId is required");
  return id;
}

repositoryRoutes.use("*", authMiddleware);
repositoryRoutes.use("*", requireProjectRole("projectId", "developer"));

// ── Validation Schemas ─────────────────────────────────────────────

const providerEnum = z.enum(["github", "gitlab", "gitea", "local"]);

const createRepoSchema = z.object({
  name: z.string().min(1).max(200),
  provider: providerEnum,
  remoteUrl: z
    .string()
    .min(1)
    .max(2000)
    .refine(
      (url) =>
        /^(https?:\/\/.+|git@.+:.+|ssh:\/\/.+)$/.test(url) ||
        (url.startsWith("/") && url.length > 1),
      { message: "Invalid repository URL format" },
    ),
  defaultBranch: z.string().min(1).max(100).default("main"),
  description: z.string().max(1000).optional(),
});

const updateRepoSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  provider: providerEnum.optional(),
  remoteUrl: z
    .string()
    .min(1)
    .max(2000)
    .refine(
      (url) =>
        /^(https?:\/\/.+|git@.+:.+|ssh:\/\/.+)$/.test(url) ||
        (url.startsWith("/") && url.length > 1),
      { message: "Invalid repository URL format" },
    )
    .optional(),
  defaultBranch: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(["active", "archived", "error"]).optional(),
});

// ── List Repositories for Project ──────────────────────────────────

repositoryRoutes.get("/", async (c) => {
  const projectId = getProjectId(c);

  const result = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.projectId, projectId), eq(repositories.status, "active")));

  return c.json({ data: result });
});

// ── List All Repositories for Project (including archived) ─────────

repositoryRoutes.get("/all", async (c) => {
  const projectId = getProjectId(c);

  const result = await db.select().from(repositories).where(eq(repositories.projectId, projectId));

  return c.json({ data: result });
});

// ── Get Single Repository ──────────────────────────────────────────

repositoryRoutes.get("/:repoId", async (c) => {
  const projectId = getProjectId(c);
  const repoId = c.req.param("repoId");

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.projectId, projectId)),
  });

  if (!repo) return c.json({ error: "Repository not found" }, 404);
  return c.json(repo);
});

// ── Create Repository ──────────────────────────────────────────────

repositoryRoutes.post("/", zValidator("json", createRepoSchema), async (c) => {
  const projectId = getProjectId(c);
  const user = c.get("user");
  const body = c.req.valid("json");

  // Verify project exists
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  // Check duplicate name
  const existingByName = await db.query.repositories.findFirst({
    where: and(eq(repositories.projectId, projectId), eq(repositories.name, body.name)),
  });
  if (existingByName) {
    return c.json({ error: "A repository with this name already exists in the project" }, 409);
  }

  // Check duplicate URL
  const existingByUrl = await db.query.repositories.findFirst({
    where: and(eq(repositories.projectId, projectId), eq(repositories.remoteUrl, body.remoteUrl)),
  });
  if (existingByUrl) {
    return c.json({ error: "A repository with this URL already exists in the project" }, 409);
  }

  const repoId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(repositories).values({
    id: repoId,
    projectId,
    name: body.name,
    provider: body.provider,
    remoteUrl: body.remoteUrl,
    defaultBranch: body.defaultBranch,
    description: body.description ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    eventType: "repository.created",
    action: "create_repository",
    target: body.name,
    detail: { repoId, provider: body.provider, remoteUrl: body.remoteUrl },
  });

  const created = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  return c.json(created, 201);
});

// ── Update Repository ──────────────────────────────────────────────

repositoryRoutes.patch("/:repoId", zValidator("json", updateRepoSchema), async (c) => {
  const projectId = getProjectId(c);
  const repoId = c.req.param("repoId");
  const user = c.get("user");
  const body = c.req.valid("json");

  const existing = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.projectId, projectId)),
  });
  if (!existing) return c.json({ error: "Repository not found" }, 404);

  // Check duplicate name if changing name
  if (body.name && body.name !== existing.name) {
    const dup = await db.query.repositories.findFirst({
      where: and(eq(repositories.projectId, projectId), eq(repositories.name, body.name)),
    });
    if (dup) {
      return c.json({ error: "A repository with this name already exists in the project" }, 409);
    }
  }

  // Check duplicate URL if changing URL
  if (body.remoteUrl && body.remoteUrl !== existing.remoteUrl) {
    const dup = await db.query.repositories.findFirst({
      where: and(eq(repositories.projectId, projectId), eq(repositories.remoteUrl, body.remoteUrl)),
    });
    if (dup) {
      return c.json({ error: "A repository with this URL already exists in the project" }, 409);
    }
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.name !== undefined) updates.name = body.name;
  if (body.provider !== undefined) updates.provider = body.provider;
  if (body.remoteUrl !== undefined) updates.remoteUrl = body.remoteUrl;
  if (body.defaultBranch !== undefined) updates.defaultBranch = body.defaultBranch;
  if (body.description !== undefined) updates.description = body.description;
  if (body.status !== undefined) updates.status = body.status;

  await db.update(repositories).set(updates).where(eq(repositories.id, repoId));

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    eventType: "repository.updated",
    action: "update_repository",
    target: existing.name,
    detail: { repoId, changes: Object.keys(body) },
  });

  const updated = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });

  return c.json(updated);
});

// ── Delete (Archive) Repository ────────────────────────────────────

repositoryRoutes.delete("/:repoId", async (c) => {
  const projectId = getProjectId(c);
  const repoId = c.req.param("repoId");
  const user = c.get("user");

  const existing = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.projectId, projectId)),
  });
  if (!existing) return c.json({ error: "Repository not found" }, 404);

  // Soft delete: archive instead of physical delete
  await db
    .update(repositories)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(eq(repositories.id, repoId));

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    eventType: "repository.archived",
    action: "archive_repository",
    target: existing.name,
    detail: { repoId },
  });

  return c.json({ ok: true });
});
