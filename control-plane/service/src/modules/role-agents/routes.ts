import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { roleAgentBindings, roleAgentProjectOverrides, roleAgents } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { bootstrapDefaultRoleAgents } from "./bootstrap";
import { resolveRoleAgentForExecution } from "./resolve";

export const roleAgentRoutes = new Hono<AppEnv>();

roleAgentRoutes.use("*", authMiddleware);
roleAgentRoutes.use("*", requireRole("org_admin"));

const roleAgentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.enum(["system", "project"]).default("system"),
  permissionProfile: z.string().min(1),
  toolProfile: z.string().min(1),
  defaultExecutionMode: z.enum(["single", "parallel-review", "round-robin"]),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]).optional(),
  maxActiveBindings: z.number().int().positive().optional(),
  requireConsensus: z.boolean().optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  requiresApprovalForWrite: z.boolean().optional(),
  allowedStages: z.array(z.string().min(1)).min(1),
  outputSchemaId: z.string().optional(),
  ownerTeam: z.string().optional(),
  tagsJson: z.array(z.string()).optional(),
});

const roleAgentPatchSchema = roleAgentSchema.partial().omit({ id: true });

const roleAgentBindingSchema = z.object({
  projectId: z.string().optional(),
  bindingKey: z.string().min(1),
  runtimeAgent: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1),
  model: z.string().optional(),
  tagsJson: z.array(z.string()).optional(),
});

const roleAgentBindingPatchSchema = roleAgentBindingSchema.partial();

const roleAgentProjectOverrideSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["active", "disabled", "deprecated"]).optional(),
  ownerTeam: z.string().optional(),
  permissionProfile: z.string().min(1).optional(),
  toolProfile: z.string().min(1).optional(),
  defaultExecutionMode: z.enum(["single", "parallel-review", "round-robin"]).optional(),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]).optional(),
  maxActiveBindings: z.number().int().positive().optional(),
  requireConsensus: z.boolean().optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  requiresApprovalForWrite: z.boolean().optional(),
  allowedStages: z.array(z.string().min(1)).min(1).optional(),
  outputSchemaId: z.string().optional(),
  tagsJson: z.array(z.string()).optional(),
  bindingsMode: z.enum(["inherit", "replace"]).optional(),
});

const roleAgentProjectOverridePatchSchema = roleAgentProjectOverrideSchema.partial();

const bootstrapDefaultsSchema = z.object({
  applyBindings: z.boolean().default(true),
  overwriteUnmodifiedRecords: z.boolean().default(false),
});

function parseBooleanQuery(value: string | undefined) {
  return value === "true" || value === "1";
}

function roleCanWriteCode(roleId: string, permissionProfile: string, toolProfile: string) {
  if (roleId === "role.developer") {
    return false;
  }

  return permissionProfile === "perm.code-implementation" || toolProfile.includes("write");
}

function serializeRoleAgent(row: typeof roleAgents.$inferSelect) {
  return {
    ...row,
    allowedStages: row.allowedStagesJson ?? [],
  };
}

function serializeProjectOverride(row: typeof roleAgentProjectOverrides.$inferSelect) {
  return {
    ...row,
    allowedStages: row.allowedStagesJson ?? [],
  };
}

function isSameBindingScope(
  existing: Pick<typeof roleAgentBindings.$inferSelect, "projectId" | "bindingKey">,
  body: Pick<z.infer<typeof roleAgentBindingSchema>, "projectId" | "bindingKey">,
) {
  return (existing.projectId ?? null) === (body.projectId ?? null) && existing.bindingKey === body.bindingKey;
}

function assertRoleShape(
  roleId: string,
  body: Pick<
    z.infer<typeof roleAgentSchema>,
    "scope" | "projectId" | "permissionProfile" | "toolProfile" | "allowedStages"
  >,
) {
  if (body.scope === "project" && !body.projectId) {
    return { error: "projectId is required when scope is project", status: 400 as const };
  }

  if (body.allowedStages.length === 0) {
    return { error: "allowedStages must not be empty", status: 400 as const };
  }

  if (roleCanWriteCode(roleId, body.permissionProfile, body.toolProfile)) {
    return {
      error: "non-developer role cannot use code implementation permission or write-capable tool profile",
      status: 400 as const,
    };
  }

  return null;
}

roleAgentRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const scope = c.req.query("scope");
  const status = c.req.query("status");
  const includeBindings = parseBooleanQuery(c.req.query("includeBindings"));
  const includeDisabledBindings = parseBooleanQuery(c.req.query("includeDisabledBindings"));

  const conditions = [];
  if (projectId) conditions.push(eq(roleAgents.projectId, projectId));
  if (scope) conditions.push(eq(roleAgents.scope, scope as "system" | "project"));
  if (status) {
    conditions.push(eq(roleAgents.status, status as "active" | "disabled" | "deprecated"));
  }

  const rows = await db
    .select()
    .from(roleAgents)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  if (!includeBindings) {
    return c.json({ data: rows.map(serializeRoleAgent) });
  }

  const bindings = await db.select().from(roleAgentBindings);
  const bindingMap = new Map<string, typeof roleAgentBindings.$inferSelect[]>();
  for (const binding of bindings) {
    if (projectId) {
      if (binding.projectId && binding.projectId !== projectId) {
        continue;
      }
    } else if (binding.projectId) {
      continue;
    }
    if (!includeDisabledBindings && !binding.enabled) {
      continue;
    }
    const group = bindingMap.get(binding.roleAgentId) ?? [];
    group.push(binding);
    bindingMap.set(binding.roleAgentId, group);
  }

  return c.json({
    data: rows.map((row) => ({
      ...serializeRoleAgent(row),
      bindings: (bindingMap.get(row.id) ?? []).sort((left, right) => left.priority - right.priority),
    })),
  });
});

roleAgentRoutes.post("/", zValidator("json", roleAgentSchema), async (c) => {
  const body = c.req.valid("json");
  const validationError = assertRoleShape(body.id, body);
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status);
  }

  const existing = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, body.id) });
  if (existing) {
    return c.json({ error: "Role agent already exists" }, 409);
  }

  const now = new Date().toISOString();
  await db.insert(roleAgents).values({
    id: body.id,
    projectId: body.projectId ?? null,
    name: body.name,
    description: body.description ?? null,
    scope: body.scope,
    status: "active",
    ownerTeam: body.ownerTeam ?? null,
    permissionProfile: body.permissionProfile,
    toolProfile: body.toolProfile,
    defaultExecutionMode: body.defaultExecutionMode,
    aggregationStrategy: body.aggregationStrategy ?? null,
    maxActiveBindings: body.maxActiveBindings ?? null,
    requireConsensus: body.requireConsensus ?? false,
    riskLevel: body.riskLevel ?? "low",
    requiresApprovalForWrite: body.requiresApprovalForWrite ?? false,
    allowedStagesJson: body.allowedStages,
    outputSchemaId: body.outputSchemaId ?? null,
    tagsJson: body.tagsJson ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, body.id) });
  return c.json(created ? serializeRoleAgent(created) : null, 201);
});

roleAgentRoutes.get("/:roleAgentId", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const row = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
  if (!row) {
    return c.json({ error: "Role agent not found" }, 404);
  }

  return c.json({ data: serializeRoleAgent(row) });
});

roleAgentRoutes.patch("/:roleAgentId", zValidator("json", roleAgentPatchSchema), async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const body = c.req.valid("json");
  const existing = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
  if (!existing) return c.json({ error: "Role agent not found" }, 404);

  const merged = {
    scope: body.scope ?? existing.scope,
    projectId: body.projectId ?? existing.projectId ?? undefined,
    permissionProfile: body.permissionProfile ?? existing.permissionProfile,
    toolProfile: body.toolProfile ?? existing.toolProfile,
    allowedStages: body.allowedStages ?? existing.allowedStagesJson ?? [],
  };
  const validationError = assertRoleShape(roleAgentId, merged);
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status);
  }

  const updates: Partial<typeof roleAgents.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.projectId !== undefined) updates.projectId = body.projectId ?? null;
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description ?? null;
  if (body.scope !== undefined) updates.scope = body.scope;
  if (body.permissionProfile !== undefined) updates.permissionProfile = body.permissionProfile;
  if (body.toolProfile !== undefined) updates.toolProfile = body.toolProfile;
  if (body.defaultExecutionMode !== undefined) updates.defaultExecutionMode = body.defaultExecutionMode;
  if (body.aggregationStrategy !== undefined) updates.aggregationStrategy = body.aggregationStrategy ?? null;
  if (body.maxActiveBindings !== undefined) updates.maxActiveBindings = body.maxActiveBindings ?? null;
  if (body.requireConsensus !== undefined) updates.requireConsensus = body.requireConsensus;
  if (body.riskLevel !== undefined) updates.riskLevel = body.riskLevel;
  if (body.requiresApprovalForWrite !== undefined) {
    updates.requiresApprovalForWrite = body.requiresApprovalForWrite;
  }
  if (body.allowedStages !== undefined) updates.allowedStagesJson = body.allowedStages;
  if (body.outputSchemaId !== undefined) updates.outputSchemaId = body.outputSchemaId ?? null;
  if (body.ownerTeam !== undefined) updates.ownerTeam = body.ownerTeam ?? null;
  if (body.tagsJson !== undefined) updates.tagsJson = body.tagsJson ?? null;

  await db
    .update(roleAgents)
    .set(updates)
    .where(eq(roleAgents.id, roleAgentId));

  const updated = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
  if (!updated) return c.json({ error: "Role agent not found" }, 404);
  return c.json(serializeRoleAgent(updated));
});

roleAgentRoutes.get("/:roleAgentId/resolve", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const projectId = c.req.query("projectId") || undefined;
  const stage = c.req.query("stage") || undefined;
  const templateId = c.req.query("templateId") || undefined;

  const resolved = await resolveRoleAgentForExecution({
    roleAgentId,
    projectId,
    stage,
    templateId,
  });
  if (!resolved) {
    return c.json({ error: "Role agent not found" }, 404);
  }

  return c.json({ data: resolved });
});

roleAgentRoutes.post(
  "/bootstrap-defaults",
  zValidator("json", bootstrapDefaultsSchema),
  async (c) => {
    const body = c.req.valid("json");
    const result = await bootstrapDefaultRoleAgents(db, body);
    return c.json({ data: result }, 200);
  },
);

roleAgentRoutes.get("/:roleAgentId/bindings", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const projectId = c.req.query("projectId") || undefined;
  const roleAgent = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
  if (!roleAgent) {
    return c.json({ error: "Role agent not found" }, 404);
  }

  const rows = await db
    .select()
    .from(roleAgentBindings)
    .where(eq(roleAgentBindings.roleAgentId, roleAgentId));
  const filteredRows = projectId
    ? rows.filter((row) => row.projectId === projectId)
    : rows.filter((row) => !row.projectId);
  return c.json({ data: filteredRows.sort((left, right) => left.priority - right.priority) });
});

roleAgentRoutes.post("/:roleAgentId/bindings", zValidator("json", roleAgentBindingSchema), async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const body = c.req.valid("json");
  const roleAgent = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
  if (!roleAgent) {
    return c.json({ error: "Role agent not found" }, 404);
  }

  const existing = await db
    .select()
    .from(roleAgentBindings)
    .where(eq(roleAgentBindings.roleAgentId, roleAgentId));
  if (existing.some((binding) => isSameBindingScope(binding, body))) {
    return c.json({ error: "Role agent binding already exists" }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(roleAgentBindings).values({
    id,
    roleAgentId,
    projectId: body.projectId ?? null,
    bindingKey: body.bindingKey,
    runtimeAgent: body.runtimeAgent,
    label: body.label,
    enabled: body.enabled ?? true,
    priority: body.priority,
    model: body.model ?? null,
    tagsJson: body.tagsJson ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.roleAgentBindings.findFirst({
    where: eq(roleAgentBindings.id, id),
  });
  return c.json(created, 201);
});

roleAgentRoutes.patch(
  "/:roleAgentId/bindings/:bindingId",
  zValidator("json", roleAgentBindingPatchSchema),
  async (c) => {
    const roleAgentId = c.req.param("roleAgentId");
    const bindingId = c.req.param("bindingId");
    const body = c.req.valid("json");
    const existing = await db.query.roleAgentBindings.findFirst({
      where: and(eq(roleAgentBindings.id, bindingId), eq(roleAgentBindings.roleAgentId, roleAgentId)),
    });
    if (!existing) return c.json({ error: "Role agent binding not found" }, 404);

    if (body.bindingKey && body.bindingKey !== existing.bindingKey) {
      const nextBindingKey = body.bindingKey;
      const siblings = await db
        .select()
        .from(roleAgentBindings)
        .where(eq(roleAgentBindings.roleAgentId, roleAgentId));
      if (
        siblings.some(
          (binding) =>
            binding.id !== bindingId
            && isSameBindingScope(binding, {
              bindingKey: nextBindingKey,
              projectId: body.projectId ?? existing.projectId ?? undefined,
            }),
        )
      ) {
        return c.json({ error: "Role agent binding already exists" }, 409);
      }
    }

    const updates: Partial<typeof roleAgentBindings.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.projectId !== undefined) updates.projectId = body.projectId ?? null;
    if (body.bindingKey !== undefined) updates.bindingKey = body.bindingKey;
    if (body.runtimeAgent !== undefined) updates.runtimeAgent = body.runtimeAgent;
    if (body.label !== undefined) updates.label = body.label;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.model !== undefined) updates.model = body.model ?? null;
    if (body.tagsJson !== undefined) updates.tagsJson = body.tagsJson ?? null;

    await db
      .update(roleAgentBindings)
      .set(updates)
      .where(and(eq(roleAgentBindings.id, bindingId), eq(roleAgentBindings.roleAgentId, roleAgentId)));

    const updated = await db.query.roleAgentBindings.findFirst({
      where: eq(roleAgentBindings.id, bindingId),
    });
    if (!updated) return c.json({ error: "Role agent binding not found" }, 404);
    return c.json(updated);
  },
);

roleAgentRoutes.get("/:roleAgentId/projects/:projectId/override", async (c) => {
  const roleAgentId = c.req.param("roleAgentId");
  const projectId = c.req.param("projectId");

  const row = await db.query.roleAgentProjectOverrides.findFirst({
    where: and(
      eq(roleAgentProjectOverrides.roleAgentId, roleAgentId),
      eq(roleAgentProjectOverrides.projectId, projectId),
    ),
  });

  if (!row) {
    return c.json({ error: "Role agent project override not found" }, 404);
  }

  return c.json({ data: serializeProjectOverride(row) });
});

roleAgentRoutes.put(
  "/:roleAgentId/projects/:projectId/override",
  zValidator("json", roleAgentProjectOverrideSchema),
  async (c) => {
    const roleAgentId = c.req.param("roleAgentId");
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");
    const roleAgent = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
    if (!roleAgent) {
      return c.json({ error: "Role agent not found" }, 404);
    }

    const validationError = assertRoleShape(roleAgentId, {
      scope: roleAgent.scope,
      projectId,
      permissionProfile: body.permissionProfile ?? roleAgent.permissionProfile,
      toolProfile: body.toolProfile ?? roleAgent.toolProfile,
      allowedStages: body.allowedStages ?? roleAgent.allowedStagesJson ?? [],
    });
    if (validationError) {
      return c.json({ error: validationError.error }, validationError.status);
    }

    const now = new Date().toISOString();
    const existing = await db.query.roleAgentProjectOverrides.findFirst({
      where: and(
        eq(roleAgentProjectOverrides.roleAgentId, roleAgentId),
        eq(roleAgentProjectOverrides.projectId, projectId),
      ),
    });

    const payload: typeof roleAgentProjectOverrides.$inferInsert = {
      id: existing?.id ?? crypto.randomUUID(),
      roleAgentId,
      projectId,
      name: body.name ?? null,
      description: body.description ?? null,
      status: body.status ?? null,
      ownerTeam: body.ownerTeam ?? null,
      permissionProfile: body.permissionProfile ?? null,
      toolProfile: body.toolProfile ?? null,
      defaultExecutionMode: body.defaultExecutionMode ?? null,
      aggregationStrategy: body.aggregationStrategy ?? null,
      maxActiveBindings: body.maxActiveBindings ?? null,
      requireConsensus: body.requireConsensus ?? null,
      riskLevel: body.riskLevel ?? null,
      requiresApprovalForWrite: body.requiresApprovalForWrite ?? null,
      allowedStagesJson: body.allowedStages ?? null,
      outputSchemaId: body.outputSchemaId ?? null,
      tagsJson: body.tagsJson ?? null,
      bindingsMode: body.bindingsMode ?? "inherit",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      await db
        .update(roleAgentProjectOverrides)
        .set(payload)
        .where(eq(roleAgentProjectOverrides.id, existing.id));
    } else {
      await db.insert(roleAgentProjectOverrides).values(payload);
    }

    const saved = await db.query.roleAgentProjectOverrides.findFirst({
      where: and(
        eq(roleAgentProjectOverrides.roleAgentId, roleAgentId),
        eq(roleAgentProjectOverrides.projectId, projectId),
      ),
    });

    return c.json({ data: saved ? serializeProjectOverride(saved) : null });
  },
);

roleAgentRoutes.patch(
  "/:roleAgentId/projects/:projectId/override",
  zValidator("json", roleAgentProjectOverridePatchSchema),
  async (c) => {
    const roleAgentId = c.req.param("roleAgentId");
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");
    const roleAgent = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, roleAgentId) });
    if (!roleAgent) {
      return c.json({ error: "Role agent not found" }, 404);
    }

    const existing = await db.query.roleAgentProjectOverrides.findFirst({
      where: and(
        eq(roleAgentProjectOverrides.roleAgentId, roleAgentId),
        eq(roleAgentProjectOverrides.projectId, projectId),
      ),
    });
    if (!existing) {
      return c.json({ error: "Role agent project override not found" }, 404);
    }

    const validationError = assertRoleShape(roleAgentId, {
      scope: roleAgent.scope,
      projectId,
      permissionProfile: body.permissionProfile ?? existing.permissionProfile ?? roleAgent.permissionProfile,
      toolProfile: body.toolProfile ?? existing.toolProfile ?? roleAgent.toolProfile,
      allowedStages:
        body.allowedStages
        ?? existing.allowedStagesJson
        ?? roleAgent.allowedStagesJson
        ?? [],
    });
    if (validationError) {
      return c.json({ error: validationError.error }, validationError.status);
    }

    const updates: Partial<typeof roleAgentProjectOverrides.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.name !== undefined) updates.name = body.name ?? null;
    if (body.description !== undefined) updates.description = body.description ?? null;
    if (body.status !== undefined) updates.status = body.status ?? null;
    if (body.ownerTeam !== undefined) updates.ownerTeam = body.ownerTeam ?? null;
    if (body.permissionProfile !== undefined) updates.permissionProfile = body.permissionProfile ?? null;
    if (body.toolProfile !== undefined) updates.toolProfile = body.toolProfile ?? null;
    if (body.defaultExecutionMode !== undefined) updates.defaultExecutionMode = body.defaultExecutionMode ?? null;
    if (body.aggregationStrategy !== undefined) updates.aggregationStrategy = body.aggregationStrategy ?? null;
    if (body.maxActiveBindings !== undefined) updates.maxActiveBindings = body.maxActiveBindings ?? null;
    if (body.requireConsensus !== undefined) updates.requireConsensus = body.requireConsensus ?? null;
    if (body.riskLevel !== undefined) updates.riskLevel = body.riskLevel ?? null;
    if (body.requiresApprovalForWrite !== undefined) {
      updates.requiresApprovalForWrite = body.requiresApprovalForWrite ?? null;
    }
    if (body.allowedStages !== undefined) updates.allowedStagesJson = body.allowedStages ?? null;
    if (body.outputSchemaId !== undefined) updates.outputSchemaId = body.outputSchemaId ?? null;
    if (body.tagsJson !== undefined) updates.tagsJson = body.tagsJson ?? null;
    if (body.bindingsMode !== undefined) updates.bindingsMode = body.bindingsMode;

    await db
      .update(roleAgentProjectOverrides)
      .set(updates)
      .where(eq(roleAgentProjectOverrides.id, existing.id));

    const updated = await db.query.roleAgentProjectOverrides.findFirst({
      where: eq(roleAgentProjectOverrides.id, existing.id),
    });
    return c.json({ data: updated ? serializeProjectOverride(updated) : null });
  },
);