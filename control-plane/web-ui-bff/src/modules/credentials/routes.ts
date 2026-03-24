import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const credentialRoutes = new Hono();

function readProjectId(c: {
  req: { query: (name: string) => string | undefined; param: (name: string) => string | undefined };
}) {
  return c.req.query("projectId") || c.req.param("projectId");
}

// ── List Credentials ───────────────────────────────────────────────

credentialRoutes.get("/", async (c) => {
  const projectId = readProjectId(c);
  if (!projectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }
  const repoId = c.req.query("repoId");
  const params = new URLSearchParams();
  if (repoId) params.set("repoId", repoId);

  const result = await cpFetch<{ data: unknown[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials${params.toString() ? `?${params.toString()}` : ""}`,
    { authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

// ── Get Single Credential ──────────────────────────────────────────

credentialRoutes.get("/:credentialId", async (c) => {
  const credentialId = c.req.param("credentialId");
  const projectId = readProjectId(c);
  if (!projectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`,
    { authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// ── Create Credential ──────────────────────────────────────────────

const createCredSchema = z.object({
  projectId: z.string().min(1).optional(),
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

credentialRoutes.post("/", zValidator("json", createCredSchema), async (c) => {
  const body = c.req.valid("json");
  const projectId = readProjectId(c) || body.projectId;

  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const { projectId: _projectId, ...credData } = body;

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials`,
    { method: "POST", body: credData, authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// ── Update Credential ──────────────────────────────────────────────

const updateCredSchema = z.object({
  projectId: z.string().min(1).optional(),
  label: z.string().min(1).max(200).optional(),
  secretRef: z.string().min(1).max(500).optional(),
  gitAuthorName: z.string().max(200).nullable().optional(),
  gitAuthorEmail: z.string().email().max(200).nullable().optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["active", "revoked", "expired"]).optional(),
});

credentialRoutes.patch("/:credentialId", zValidator("json", updateCredSchema), async (c) => {
  const credentialId = c.req.param("credentialId");
  const body = c.req.valid("json");
  const projectId = readProjectId(c) || body.projectId;

  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  const { projectId: _projectId, ...credData } = body;

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: "PATCH", body: credData, authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// ── Revoke (Delete) Credential ─────────────────────────────────────

credentialRoutes.delete("/:credentialId", async (c) => {
  const credentialId = c.req.param("credentialId");
  const projectId = readProjectId(c);
  if (!projectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  const result = await cpFetch<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: "DELETE", authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

credentialRoutes.get("/projects/:projectId/credentials", async (c) => {
  const repoId = c.req.query("repoId");
  const params = new URLSearchParams();
  if (repoId) params.set("repoId", repoId);

  const result = await cpFetch<{ data: unknown[] }>(
    `/api/projects/${encodeURIComponent(c.req.param("projectId"))}/credentials${params.toString() ? `?${params.toString()}` : ""}`,
    { authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

credentialRoutes.post(
  "/projects/:projectId/credentials",
  zValidator("json", createCredSchema.omit({ projectId: true })),
  async (c) => {
    const result = await cpFetch<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(c.req.param("projectId"))}/credentials`,
      { method: "POST", body: c.req.valid("json"), authorization: authHeader(c) },
    );

    return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 502));
  },
);

credentialRoutes.get("/projects/:projectId/credentials/:credentialId", async (c) => {
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(c.req.param("projectId"))}/credentials/${encodeURIComponent(c.req.param("credentialId"))}`,
    { authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

credentialRoutes.patch(
  "/projects/:projectId/credentials/:credentialId",
  zValidator("json", updateCredSchema.omit({ projectId: true })),
  async (c) => {
    const result = await cpFetch<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(c.req.param("projectId"))}/credentials/${encodeURIComponent(c.req.param("credentialId"))}`,
      { method: "PATCH", body: c.req.valid("json"), authorization: authHeader(c) },
    );

    return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
  },
);

credentialRoutes.delete("/projects/:projectId/credentials/:credentialId", async (c) => {
  const result = await cpFetch<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(c.req.param("projectId"))}/credentials/${encodeURIComponent(c.req.param("credentialId"))}`,
    { method: "DELETE", authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});
