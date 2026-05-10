import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const crowdsourcedTaskRoutes = new Hono();
export const contributorRoutes = new Hono();
export const codeOwnerRoutes = new Hono();
export const commitRuntimeRoutes = new Hono();

type BffStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 500 | 502;

function statusFrom(result: { ok: boolean; status: number }, success: 200 | 201 = 200): BffStatus {
  return result.ok ? success : (result.status as BffStatus);
}

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  return c.req.json();
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

// Task boundary, assignment, workspace and commit-step routes.

crowdsourcedTaskRoutes.get("/:taskId/boundary", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/boundary`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

crowdsourcedTaskRoutes.put("/:taskId/boundary", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/boundary`, {
    method: "PUT",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

crowdsourcedTaskRoutes.post("/:taskId/assignments", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/assignments`, {
    method: "POST",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result, 201));
});

crowdsourcedTaskRoutes.get("/:taskId/assignments/current", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/assignments/current`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

crowdsourcedTaskRoutes.delete("/:taskId/assignments/current", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/assignments/current`, {
    method: "DELETE",
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

crowdsourcedTaskRoutes.post("/:taskId/workspaces", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/workspaces`, {
    method: "POST",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result, 201));
});

crowdsourcedTaskRoutes.get("/:taskId/workspaces/current", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/workspaces/current`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

crowdsourcedTaskRoutes.post("/:taskId/commit-steps", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/commit-steps`, {
    method: "POST",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result, 201));
});

crowdsourcedTaskRoutes.get("/:taskId/commit-steps", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${taskId}/commit-steps`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

crowdsourcedTaskRoutes.get("/:taskId/commit-steps/:stepId/files", async (c) => {
  const taskId = c.req.param("taskId");
  const stepId = c.req.param("stepId");
  const result = await cpFetch(`/api/tasks/${taskId}/commit-steps/${stepId}/files`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

// Contributor profile routes.

contributorRoutes.get("/me", async (c) => {
  const result = await cpFetch("/api/contributors/me", {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

contributorRoutes.get("/", async (c) => {
  const path = withQuery("/api/contributors", {
    level: c.req.query("level"),
    status: c.req.query("status"),
  });
  const result = await cpFetch(path, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

contributorRoutes.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const result = await cpFetch(`/api/contributors/${userId}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

contributorRoutes.put("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const result = await cpFetch(`/api/contributors/${userId}`, {
    method: "PUT",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

// Code ownership routes.

codeOwnerRoutes.get("/", async (c) => {
  const result = await cpFetch(withQuery("/api/code-owners", { projectId: c.req.query("projectId") }), {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

codeOwnerRoutes.post("/", async (c) => {
  const result = await cpFetch("/api/code-owners", {
    method: "POST",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result, 201));
});

codeOwnerRoutes.post("/resolve", async (c) => {
  const result = await cpFetch("/api/code-owners/resolve", {
    method: "POST",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

codeOwnerRoutes.patch("/:ownerId", async (c) => {
  const ownerId = c.req.param("ownerId");
  const result = await cpFetch(`/api/code-owners/${ownerId}`, {
    method: "PATCH",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

codeOwnerRoutes.delete("/:ownerId", async (c) => {
  const ownerId = c.req.param("ownerId");
  const result = await cpFetch(`/api/code-owners/${ownerId}`, {
    method: "DELETE",
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

// Commit runtime preview records.

commitRuntimeRoutes.post("/:commitSha/start", async (c) => {
  const commitSha = c.req.param("commitSha");
  const result = await cpFetch(`/api/commit-runtimes/${commitSha}/start`, {
    method: "POST",
    body: await readJson(c),
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

commitRuntimeRoutes.get("/:commitSha", async (c) => {
  const commitSha = c.req.param("commitSha");
  const result = await cpFetch(`/api/commit-runtimes/${commitSha}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});

commitRuntimeRoutes.get("/:commitSha/preview-url", async (c) => {
  const commitSha = c.req.param("commitSha");
  const result = await cpFetch(`/api/commit-runtimes/${commitSha}/preview-url`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, statusFrom(result));
});
