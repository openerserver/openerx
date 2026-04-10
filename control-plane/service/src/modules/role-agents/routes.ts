import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { roleAgentBindings, roleAgentProjectOverrides, roleAgents } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { normalizeApiTimestampFields } from "../shared/api-timestamp";
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
  aggregationStrategy: z
    .enum(["first-pass", "majority", "merge-summary", "human-review"])
    .optional(),
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
  aggregationStrategy: z
    .enum(["first-pass", "majority", "merge-summary", "human-review"])
    .optional(),
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

function toRoleScope(value: string | null | undefined): "system" | "project" {
  return value === "project" ? "project" : "system";
}

function parseBooleanQuery(value: string | undefined) {
  return value === "true" || value === "1";
}

function roleCanWriteCode(roleId: string, permissionProfile: string, toolProfile: string) {
  if (roleId === "role.developer") {
    return false;
  }

  return permissionProfile === "perm.code-implementation" || toolProfile.includes("write");
}

function normalizeRoleAgentRecord<
  T extends { createdAt?: string | null; updatedAt?: string | null } & Record<string, unknown>,
>(roleAgent: T) {
  return normalizeApiTimestampFields(roleAgent, ["createdAt", "updatedAt"] as const);
}

function normalizeRoleAgentBindingRecord<
  T extends { createdAt?: string | null; updatedAt?: string | null } & Record<string, unknown>,
>(binding: T) {
  return normalizeApiTimestampFields(binding, ["createdAt", "updatedAt"] as const);
}

function normalizeProjectOverrideRecord<
  T extends { createdAt?: string | null; updatedAt?: string | null } & Record<string, unknown>,
>(override: T) {
  return normalizeApiTimestampFields(override, ["createdAt", "updatedAt"] as const);
}

function serializeRoleAgent(row: typeof roleAgents.$inferSelect) {
  return {
    ...normalizeRoleAgentRecord(row),
    allowedStages: row.allowedStagesJson ?? [],
  };
}

function serializeProjectOverride(row: typeof roleAgentProjectOverrides.$inferSelect) {
  return {
    ...normalizeProjectOverrideRecord(row),
    allowedStages: row.allowedStagesJson ?? [],
  };
}

function serializeRoleAgentBinding(row: typeof roleAgentBindings.$inferSelect) {
  return normalizeRoleAgentBindingRecord(row);
}

function isSameBindingScope(
  existing: Pick<typeof roleAgentBindings.$inferSelect, "projectId" | "bindingKey">,
  body: Pick<z.infer<typeof roleAgentBindingSchema>, "projectId" | "bindingKey">,
) {
  return (
    (existing.projectId ?? null) === (body.projectId ?? null) &&
    existing.bindingKey === body.bindingKey
  );
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
      error:
        "non-developer role cannot use code implementation permission or write-capable tool profile",
      status: 400 as const,
    };
  }

  return null;
}

function buildRoleAgentListWhere(
  projectId: string | undefined,
  scope: string | undefined,
  status: string | undefined,
) {
  const conditions = [];
  if (projectId) conditions.push(eq(roleAgents.projectId, projectId));
  if (scope) conditions.push(eq(roleAgents.scope, scope as "system" | "project"));
  if (status) {
    conditions.push(eq(roleAgents.status, status as "active" | "disabled" | "deprecated"));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function shouldIncludeBindingInList(
  binding: typeof roleAgentBindings.$inferSelect,
  projectId: string | undefined,
  includeDisabledBindings: boolean,
) {
  if (projectId) {
    if (binding.projectId && binding.projectId !== projectId) {
      return false;
    }
  } else if (binding.projectId) {
    return false;
  }

  return includeDisabledBindings || binding.enabled;
}

function buildRoleAgentBindingMap(
  bindings: Array<typeof roleAgentBindings.$inferSelect>,
  projectId: string | undefined,
  includeDisabledBindings: boolean,
) {
  const bindingMap = new Map<string, Array<typeof roleAgentBindings.$inferSelect>>();
  for (const binding of bindings) {
    if (!shouldIncludeBindingInList(binding, projectId, includeDisabledBindings)) {
      continue;
    }
    const group = bindingMap.get(binding.roleAgentId) ?? [];
    group.push(binding);
    bindingMap.set(binding.roleAgentId, group);
  }
  return bindingMap;
}

function buildRoleAgentValidationInput(
  existing: typeof roleAgents.$inferSelect,
  body: z.infer<typeof roleAgentPatchSchema>,
) {
  return {
    scope: body.scope ?? toRoleScope(existing.scope),
    projectId: body.projectId ?? existing.projectId ?? undefined,
    permissionProfile: body.permissionProfile ?? existing.permissionProfile,
    toolProfile: body.toolProfile ?? existing.toolProfile,
    allowedStages: body.allowedStages ?? existing.allowedStagesJson ?? [],
  };
}

async function hasBindingScopeConflict(
  roleAgentId: string,
  bindingId: string,
  bindingKey: string,
  projectId: string | undefined,
) {
  const siblings = await db
    .select()
    .from(roleAgentBindings)
    .where(eq(roleAgentBindings.roleAgentId, roleAgentId));
  return siblings.some(
    (binding) => binding.id !== bindingId && isSameBindingScope(binding, { bindingKey, projectId }),
  );
}

function buildBindingIdentityUpdates(body: z.infer<typeof roleAgentBindingPatchSchema>) {
  return {
    ...(body.projectId !== undefined ? { projectId: body.projectId ?? null } : {}),
    ...(body.bindingKey !== undefined ? { bindingKey: body.bindingKey } : {}),
    ...(body.runtimeAgent !== undefined ? { runtimeAgent: body.runtimeAgent } : {}),
    ...(body.label !== undefined ? { label: body.label } : {}),
  } satisfies Partial<typeof roleAgentBindings.$inferInsert>;
}

function buildBindingExecutionUpdates(body: z.infer<typeof roleAgentBindingPatchSchema>) {
  return {
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.model !== undefined ? { model: body.model ?? null } : {}),
    ...(body.tagsJson !== undefined ? { tagsJson: body.tagsJson ?? null } : {}),
  } satisfies Partial<typeof roleAgentBindings.$inferInsert>;
}

function buildBindingUpdates(body: z.infer<typeof roleAgentBindingPatchSchema>) {
  return {
    updatedAt: new Date().toISOString(),
    ...buildBindingIdentityUpdates(body),
    ...buildBindingExecutionUpdates(body),
  } satisfies Partial<typeof roleAgentBindings.$inferInsert>;
}

function buildOverrideValidationInput(
  roleAgent: typeof roleAgents.$inferSelect,
  projectId: string,
  body:
    | z.infer<typeof roleAgentProjectOverrideSchema>
    | z.infer<typeof roleAgentProjectOverridePatchSchema>,
  existing?: typeof roleAgentProjectOverrides.$inferSelect,
) {
  return {
    scope: toRoleScope(roleAgent.scope),
    projectId,
    permissionProfile:
      body.permissionProfile ?? existing?.permissionProfile ?? roleAgent.permissionProfile,
    toolProfile: body.toolProfile ?? existing?.toolProfile ?? roleAgent.toolProfile,
    allowedStages:
      body.allowedStages ?? existing?.allowedStagesJson ?? roleAgent.allowedStagesJson ?? [],
  };
}

function buildRoleAgentIdentityUpdates(body: z.infer<typeof roleAgentPatchSchema>) {
  return {
    ...(body.projectId !== undefined ? { projectId: body.projectId ?? null } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.scope !== undefined ? { scope: body.scope } : {}),
    ...(body.ownerTeam !== undefined ? { ownerTeam: body.ownerTeam ?? null } : {}),
    ...(body.tagsJson !== undefined ? { tagsJson: body.tagsJson ?? null } : {}),
  } satisfies Partial<typeof roleAgents.$inferInsert>;
}

function buildRoleAgentExecutionUpdates(body: z.infer<typeof roleAgentPatchSchema>) {
  return {
    ...(body.permissionProfile !== undefined ? { permissionProfile: body.permissionProfile } : {}),
    ...(body.toolProfile !== undefined ? { toolProfile: body.toolProfile } : {}),
    ...(body.defaultExecutionMode !== undefined
      ? { defaultExecutionMode: body.defaultExecutionMode }
      : {}),
    ...(body.aggregationStrategy !== undefined
      ? { aggregationStrategy: body.aggregationStrategy ?? null }
      : {}),
    ...(body.maxActiveBindings !== undefined
      ? { maxActiveBindings: body.maxActiveBindings ?? null }
      : {}),
    ...(body.requireConsensus !== undefined ? { requireConsensus: body.requireConsensus } : {}),
    ...(body.riskLevel !== undefined ? { riskLevel: body.riskLevel } : {}),
    ...(body.requiresApprovalForWrite !== undefined
      ? { requiresApprovalForWrite: body.requiresApprovalForWrite }
      : {}),
    ...(body.allowedStages !== undefined ? { allowedStagesJson: body.allowedStages } : {}),
    ...(body.outputSchemaId !== undefined ? { outputSchemaId: body.outputSchemaId ?? null } : {}),
  } satisfies Partial<typeof roleAgents.$inferInsert>;
}

function buildProjectOverridePayload(
  roleAgentId: string,
  projectId: string,
  body: z.infer<typeof roleAgentProjectOverrideSchema>,
  existing: typeof roleAgentProjectOverrides.$inferSelect | null,
  now: string,
) {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    roleAgentId,
    projectId,
    ...buildProjectOverrideRecord(body),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } satisfies typeof roleAgentProjectOverrides.$inferInsert;
}

function buildProjectOverrideIdentityOverrides(
  body:
    | z.infer<typeof roleAgentProjectOverrideSchema>
    | z.infer<typeof roleAgentProjectOverridePatchSchema>,
) {
  return {
    ...(body.name !== undefined ? { name: body.name ?? null } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.status !== undefined ? { status: body.status ?? null } : {}),
    ...(body.ownerTeam !== undefined ? { ownerTeam: body.ownerTeam ?? null } : {}),
  } satisfies Partial<typeof roleAgentProjectOverrides.$inferInsert>;
}

function buildProjectOverrideConfigOverrides(
  body:
    | z.infer<typeof roleAgentProjectOverrideSchema>
    | z.infer<typeof roleAgentProjectOverridePatchSchema>,
) {
  return {
    ...(body.permissionProfile !== undefined
      ? { permissionProfile: body.permissionProfile ?? null }
      : {}),
    ...(body.toolProfile !== undefined ? { toolProfile: body.toolProfile ?? null } : {}),
    ...(body.outputSchemaId !== undefined ? { outputSchemaId: body.outputSchemaId ?? null } : {}),
    ...(body.tagsJson !== undefined ? { tagsJson: body.tagsJson ?? null } : {}),
  } satisfies Partial<typeof roleAgentProjectOverrides.$inferInsert>;
}

function buildProjectOverrideExecutionRecord(
  body:
    | z.infer<typeof roleAgentProjectOverrideSchema>
    | z.infer<typeof roleAgentProjectOverridePatchSchema>,
) {
  return {
    ...(body.defaultExecutionMode !== undefined
      ? { defaultExecutionMode: body.defaultExecutionMode ?? null }
      : {}),
    ...(body.aggregationStrategy !== undefined
      ? { aggregationStrategy: body.aggregationStrategy ?? null }
      : {}),
    ...(body.maxActiveBindings !== undefined
      ? { maxActiveBindings: body.maxActiveBindings ?? null }
      : {}),
    ...(body.requireConsensus !== undefined
      ? { requireConsensus: body.requireConsensus ?? null }
      : {}),
    ...(body.riskLevel !== undefined ? { riskLevel: body.riskLevel ?? null } : {}),
    ...(body.requiresApprovalForWrite !== undefined
      ? { requiresApprovalForWrite: body.requiresApprovalForWrite ?? null }
      : {}),
    ...(body.allowedStages !== undefined ? { allowedStagesJson: body.allowedStages ?? null } : {}),
    ...(body.bindingsMode !== undefined ? { bindingsMode: body.bindingsMode } : {}),
  } satisfies Partial<typeof roleAgentProjectOverrides.$inferInsert>;
}

function buildProjectOverrideRecord(
  body:
    | z.infer<typeof roleAgentProjectOverrideSchema>
    | z.infer<typeof roleAgentProjectOverridePatchSchema>,
) {
  return {
    name: body.name ?? null,
    description: body.description ?? null,
    status: body.status ?? null,
    ownerTeam: body.ownerTeam ?? null,
    ...buildProjectOverrideConfigRecord(body),
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
  } satisfies Partial<typeof roleAgentProjectOverrides.$inferInsert>;
}

function buildProjectOverrideUpdates(body: z.infer<typeof roleAgentProjectOverridePatchSchema>) {
  return {
    updatedAt: new Date().toISOString(),
    ...buildProjectOverrideIdentityOverrides(body),
    ...buildProjectOverrideConfigOverrides(body),
    ...buildProjectOverrideExecutionRecord(body),
  } satisfies Partial<typeof roleAgentProjectOverrides.$inferInsert>;
}

function buildProjectOverrideConfigRecord(body: z.infer<typeof roleAgentProjectOverrideSchema>) {
  return {
    permissionProfile: body.permissionProfile ?? null,
    toolProfile: body.toolProfile ?? null,
    outputSchemaId: body.outputSchemaId ?? null,
    tagsJson: body.tagsJson ?? null,
  } satisfies Partial<typeof roleAgentProjectOverrides.$inferInsert>;
}

roleAgentRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const scope = c.req.query("scope");
  const status = c.req.query("status");
  const includeBindings = parseBooleanQuery(c.req.query("includeBindings"));
  const includeDisabledBindings = parseBooleanQuery(c.req.query("includeDisabledBindings"));

  const rows = await db
    .select()
    .from(roleAgents)
    .where(buildRoleAgentListWhere(projectId, scope, status));

  if (!includeBindings) {
    return c.json({ data: rows.map(serializeRoleAgent) });
  }

  const bindings = await db.select().from(roleAgentBindings);
  const bindingMap = buildRoleAgentBindingMap(bindings, projectId, includeDisabledBindings);

  return c.json({
    data: rows.map((row) => ({
      ...serializeRoleAgent(row),
      bindings: (bindingMap.get(row.id) ?? []).sort(
        (left, right) => left.priority - right.priority,
      ).map((binding) => serializeRoleAgentBinding(binding)),
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

  const validationError = assertRoleShape(
    roleAgentId,
    buildRoleAgentValidationInput(existing, body),
  );
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status);
  }

  await db
    .update(roleAgents)
    .set({
      updatedAt: new Date().toISOString(),
      ...buildRoleAgentIdentityUpdates(body),
      ...buildRoleAgentExecutionUpdates(body),
    })
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
  return c.json({
    data: filteredRows
      .sort((left, right) => left.priority - right.priority)
      .map((binding) => serializeRoleAgentBinding(binding)),
  });
});

roleAgentRoutes.post(
  "/:roleAgentId/bindings",
  zValidator("json", roleAgentBindingSchema),
  async (c) => {
    const roleAgentId = c.req.param("roleAgentId");
    const body = c.req.valid("json");
    const roleAgent = await db.query.roleAgents.findFirst({
      where: eq(roleAgents.id, roleAgentId),
    });
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
    return c.json(created ? serializeRoleAgentBinding(created) : created, 201);
  },
);

roleAgentRoutes.patch(
  "/:roleAgentId/bindings/:bindingId",
  zValidator("json", roleAgentBindingPatchSchema),
  async (c) => {
    const roleAgentId = c.req.param("roleAgentId");
    const bindingId = c.req.param("bindingId");
    const body = c.req.valid("json");
    const existing = await db.query.roleAgentBindings.findFirst({
      where: and(
        eq(roleAgentBindings.id, bindingId),
        eq(roleAgentBindings.roleAgentId, roleAgentId),
      ),
    });
    if (!existing) return c.json({ error: "Role agent binding not found" }, 404);

    if (
      body.bindingKey &&
      body.bindingKey !== existing.bindingKey &&
      (await hasBindingScopeConflict(
        roleAgentId,
        bindingId,
        body.bindingKey,
        body.projectId ?? existing.projectId ?? undefined,
      ))
    ) {
      return c.json({ error: "Role agent binding already exists" }, 409);
    }

    await db
      .update(roleAgentBindings)
      .set(buildBindingUpdates(body))
      .where(
        and(eq(roleAgentBindings.id, bindingId), eq(roleAgentBindings.roleAgentId, roleAgentId)),
      );

    const updated = await db.query.roleAgentBindings.findFirst({
      where: eq(roleAgentBindings.id, bindingId),
    });
    if (!updated) return c.json({ error: "Role agent binding not found" }, 404);
    return c.json(serializeRoleAgentBinding(updated));
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
    const roleAgent = await db.query.roleAgents.findFirst({
      where: eq(roleAgents.id, roleAgentId),
    });
    if (!roleAgent) {
      return c.json({ error: "Role agent not found" }, 404);
    }

    const validationError = assertRoleShape(
      roleAgentId,
      buildOverrideValidationInput(roleAgent, projectId, body),
    );
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

    const payload = buildProjectOverridePayload(
      roleAgentId,
      projectId,
      body,
      existing ?? null,
      now,
    );

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
    const roleAgent = await db.query.roleAgents.findFirst({
      where: eq(roleAgents.id, roleAgentId),
    });
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

    const validationError = assertRoleShape(
      roleAgentId,
      buildOverrideValidationInput(roleAgent, projectId, body, existing),
    );
    if (validationError) {
      return c.json({ error: validationError.error }, validationError.status);
    }

    await db
      .update(roleAgentProjectOverrides)
      .set(buildProjectOverrideUpdates(body))
      .where(eq(roleAgentProjectOverrides.id, existing.id));

    const updated = await db.query.roleAgentProjectOverrides.findFirst({
      where: eq(roleAgentProjectOverrides.id, existing.id),
    });
    return c.json({ data: updated ? serializeProjectOverride(updated) : null });
  },
);
