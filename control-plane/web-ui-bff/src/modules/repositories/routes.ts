import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const repositoryRoutes = new Hono();

// ── List Repositories ──────────────────────────────────────────────

repositoryRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  const result = await cpFetch<{ data: unknown[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/repositories`,
    { authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

// ── Get Single Repository ──────────────────────────────────────────

repositoryRoutes.get("/:repoId", async (c) => {
  const repoId = c.req.param("repoId");
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`,
    { authorization: authHeader(c) },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// ── Create Repository ──────────────────────────────────────────────

const createRepoSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  provider: z.enum(["github", "gitlab", "gitea", "local"]),
  remoteUrl: z.string().min(1).max(2000),
  defaultBranch: z.string().min(1).max(100).default("main"),
  description: z.string().max(1000).optional(),
});

repositoryRoutes.post("/", zValidator("json", createRepoSchema), async (c) => {
  const body = c.req.valid("json");
  const { projectId, ...repoData } = body;

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/repositories`,
    {
      method: "POST",
      body: repoData,
      authorization: authHeader(c),
    },
  );

  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

// ── Update Repository ──────────────────────────────────────────────

const updateRepoSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  provider: z.enum(["github", "gitlab", "gitea", "local"]).optional(),
  remoteUrl: z.string().min(1).max(2000).optional(),
  defaultBranch: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(["active", "archived", "error"]).optional(),
});

repositoryRoutes.patch("/:repoId", zValidator("json", updateRepoSchema), async (c) => {
  const repoId = c.req.param("repoId");
  const body = c.req.valid("json");
  const { projectId, ...repoData } = body;

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`,
    {
      method: "PATCH",
      body: repoData,
      authorization: authHeader(c),
    },
  );

  return c.json(
    result.data,
    result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

// ── Delete (Archive) Repository ────────────────────────────────────

repositoryRoutes.delete("/:repoId", async (c) => {
  const repoId = c.req.param("repoId");
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`,
    {
      method: "DELETE",
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});
