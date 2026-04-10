import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { plugins } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { normalizeApiTimestampFields } from "../shared/api-timestamp";

export const pluginRoutes = new Hono<AppEnv>();

pluginRoutes.use("*", authMiddleware);
pluginRoutes.use("*", requireRole("developer"));

function normalizePluginRecord<
  T extends {
    id?: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    lastVerifiedAt?: string | null;
  },
>(plugin: T) {
  return normalizeApiTimestampFields(plugin, ["createdAt", "updatedAt", "lastVerifiedAt"] as const);
}

// ── List Plugins ───────────────────────────────────────────────────

pluginRoutes.get("/", async (c) => {
  const result = await db.select().from(plugins).orderBy(desc(plugins.createdAt));

  return c.json({ data: result.map((plugin) => normalizePluginRecord(plugin)) });
});

// ── Get Plugin ─────────────────────────────────────────────────────

pluginRoutes.get("/:pluginId", async (c) => {
  const pluginId = c.req.param("pluginId");
  const plugin = await db.query.plugins.findFirst({
    where: eq(plugins.id, pluginId),
  });

  if (!plugin) return c.json({ error: "Plugin not found" }, 404);
  return c.json(normalizePluginRecord(plugin));
});

// ── Register Plugin ────────────────────────────────────────────────

const createPluginSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  pluginPath: z.string().min(1),
  version: z.string().optional(),
  source: z.enum(["builtin", "local", "registry"]).optional(),
  description: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

pluginRoutes.post("/", zValidator("json", createPluginSchema), async (c) => {
  const body = c.req.valid("json");

  const pluginId = crypto.randomUUID();
  await db.insert(plugins).values({
    id: pluginId,
    name: body.name,
    displayName: body.displayName,
    pluginPath: body.pluginPath,
    version: body.version ?? null,
    source: body.source ?? "local",
    status: "enabled",
    description: body.description ?? null,
    capabilities: body.capabilities ?? null,
  });

  return c.json({ id: pluginId, name: body.name, status: "enabled" }, 201);
});

// ── Update Plugin Status ───────────────────────────────────────────

const updatePluginSchema = z.object({
  status: z.enum(["enabled", "disabled", "error", "not_installed"]).optional(),
  version: z.string().optional(),
  errorDetail: z.string().nullable().optional(),
  lastVerifiedAt: z.string().optional(),
});

pluginRoutes.patch("/:pluginId", zValidator("json", updatePluginSchema), async (c) => {
  const pluginId = c.req.param("pluginId");
  const body = c.req.valid("json");

  const existing = await db.query.plugins.findFirst({ where: eq(plugins.id, pluginId) });
  if (!existing) return c.json({ error: "Plugin not found" }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.status) updates.status = body.status;
  if (body.version) updates.version = body.version;
  if (body.errorDetail !== undefined) updates.errorDetail = body.errorDetail;
  if (body.lastVerifiedAt) updates.lastVerifiedAt = body.lastVerifiedAt;

  await db.update(plugins).set(updates).where(eq(plugins.id, pluginId));

  return c.json(normalizePluginRecord({ id: pluginId, ...updates }));
});
