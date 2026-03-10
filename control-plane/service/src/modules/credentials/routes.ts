import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { projects, repositories, repositoryCredentials } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireProjectRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";

export const credentialRoutes = new Hono<AppEnv>();

credentialRoutes.use("*", authMiddleware);

function getProjectId(c: { req: { param: (name: string) => string | undefined } }): string {
  const id = c.req.param("projectId");
  if (!id) throw new Error("projectId is required");
  return id;
}

// All credential routes require project-level developer role
credentialRoutes.use("*", requireProjectRole("projectId", "developer"));

// ── Validation Schemas ─────────────────────────────────────────────

const createSchema = z.object({
  repoId: z.string().min(1).optional(),
  label: z.string().min(1).max(200),
  provider: z.enum(["github", "gitlab", "gitea", "local"]),
  credentialType: z.enum(["pat", "oauth_token", "ssh_key_ref", "app_installation"]),
  secretRef: z.string().min(1).max(500),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  scope: z.enum(["project", "shared"]).default("project"),
  isDefault: z.boolean().default(false),
});

const updateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  secretRef: z.string().min(1).max(500).optional(),
  gitAuthorName: z.string().max(200).nullable().optional(),
  gitAuthorEmail: z.string().email().max(200).nullable().optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["active", "revoked", "expired"]).optional(),
});

// ── List Credentials for Project ───────────────────────────────────

credentialRoutes.get("/", async (c) => {
  const projectId = getProjectId(c);
  const repoId = c.req.query("repoId");

  const conditions = [eq(repositoryCredentials.projectId, projectId)];
  if (repoId) conditions.push(eq(repositoryCredentials.repoId, repoId));

  const result = await db
    .select({
      id: repositoryCredentials.id,
      projectId: repositoryCredentials.projectId,
      repoId: repositoryCredentials.repoId,
      label: repositoryCredentials.label,
      provider: repositoryCredentials.provider,
      credentialType: repositoryCredentials.credentialType,
      gitAuthorName: repositoryCredentials.gitAuthorName,
      gitAuthorEmail: repositoryCredentials.gitAuthorEmail,
      scope: repositoryCredentials.scope,
      isDefault: repositoryCredentials.isDefault,
      status: repositoryCredentials.status,
      createdAt: repositoryCredentials.createdAt,
      updatedAt: repositoryCredentials.updatedAt,
    })
    .from(repositoryCredentials)
    .where(and(...conditions));

  return c.json({ data: result });
});

// ── Get Single Credential ──────────────────────────────────────────

credentialRoutes.get("/:credentialId", async (c) => {
  const projectId = getProjectId(c);
  const credentialId = c.req.param("credentialId");

  const cred = await db.query.repositoryCredentials.findFirst({
    where: and(
      eq(repositoryCredentials.id, credentialId),
      eq(repositoryCredentials.projectId, projectId),
    ),
  });

  if (!cred) return c.json({ error: "Credential not found" }, 404);

  // Never expose secretRef in GET responses — return masked reference
  const { secretRef: _secret, ...safe } = cred;
  return c.json({ ...safe, secretRefMasked: "***" });
});

// ── Create Credential ──────────────────────────────────────────────

credentialRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const projectId = getProjectId(c);
  const user = c.get("user");
  const body = c.req.valid("json");

  // Verify project exists
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  // If repoId given, verify it belongs to project
  if (body.repoId) {
    const repo = await db.query.repositories.findFirst({
      where: and(eq(repositories.id, body.repoId), eq(repositories.projectId, projectId)),
    });
    if (!repo) return c.json({ error: "Repository not found in this project" }, 400);
  }

  const credId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(repositoryCredentials).values({
    id: credId,
    projectId,
    repoId: body.repoId ?? null,
    label: body.label,
    provider: body.provider,
    credentialType: body.credentialType,
    secretRef: body.secretRef,
    gitAuthorName: body.gitAuthorName ?? null,
    gitAuthorEmail: body.gitAuthorEmail ?? null,
    scope: body.scope,
    isDefault: body.isDefault,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    eventType: "credential.created",
    action: "create_credential",
    target: body.label,
    detail: { credentialId: credId, provider: body.provider, scope: body.scope },
  });

  return c.json({ id: credId, label: body.label, status: "active" }, 201);
});

// ── Update Credential ──────────────────────────────────────────────

credentialRoutes.patch("/:credentialId", zValidator("json", updateSchema), async (c) => {
  const projectId = getProjectId(c);
  const credentialId = c.req.param("credentialId");
  const user = c.get("user");
  const body = c.req.valid("json");

  const existing = await db.query.repositoryCredentials.findFirst({
    where: and(
      eq(repositoryCredentials.id, credentialId),
      eq(repositoryCredentials.projectId, projectId),
    ),
  });
  if (!existing) return c.json({ error: "Credential not found" }, 404);

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.label !== undefined) updates.label = body.label;
  if (body.secretRef !== undefined) updates.secretRef = body.secretRef;
  if (body.gitAuthorName !== undefined) updates.gitAuthorName = body.gitAuthorName;
  if (body.gitAuthorEmail !== undefined) updates.gitAuthorEmail = body.gitAuthorEmail;
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault;
  if (body.status !== undefined) updates.status = body.status;

  await db
    .update(repositoryCredentials)
    .set(updates)
    .where(eq(repositoryCredentials.id, credentialId));

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    eventType: "credential.updated",
    action: "update_credential",
    target: existing.label,
    detail: { credentialId, changes: Object.keys(body) },
  });

  return c.json({ id: credentialId, ...updates });
});

// ── Revoke (soft-delete) Credential ────────────────────────────────

credentialRoutes.delete("/:credentialId", async (c) => {
  const projectId = getProjectId(c);
  const credentialId = c.req.param("credentialId");
  const user = c.get("user");

  const existing = await db.query.repositoryCredentials.findFirst({
    where: and(
      eq(repositoryCredentials.id, credentialId),
      eq(repositoryCredentials.projectId, projectId),
    ),
  });
  if (!existing) return c.json({ error: "Credential not found" }, 404);

  await db
    .update(repositoryCredentials)
    .set({ status: "revoked", updatedAt: new Date().toISOString() })
    .where(eq(repositoryCredentials.id, credentialId));

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    eventType: "credential.revoked",
    action: "revoke_credential",
    target: existing.label,
    detail: { credentialId },
    riskLevel: "medium",
  });

  return c.json({ ok: true });
});
