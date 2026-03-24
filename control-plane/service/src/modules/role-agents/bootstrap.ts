import { eq } from "drizzle-orm";
import type { DB } from "../../db";
import { roleAgentBindings, roleAgents } from "../../db/schema";
import { DEFAULT_ROLE_AGENT_DEFINITIONS } from "./defaults";

export interface BootstrapDefaultRoleAgentsOptions {
  applyBindings?: boolean;
  overwriteUnmodifiedRecords?: boolean;
}

export interface BootstrapDefaultRoleAgentsResult {
  createdRoles: string[];
  updatedRoles: string[];
  skippedRoles: string[];
  createdBindings: string[];
  updatedBindings: string[];
  skippedBindings: string[];
}

function isMissingValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function assignRolePatchValue<K extends keyof typeof roleAgents.$inferInsert>(
  patch: Partial<typeof roleAgents.$inferInsert>,
  key: K,
  current: (typeof roleAgents.$inferSelect)[K],
  next: (typeof roleAgents.$inferInsert)[K],
  overwrite: boolean,
) {
  if (overwrite) {
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      patch[key] = next;
    }
    return;
  }

  if (isMissingValue(current) && !isMissingValue(next)) {
    patch[key] = next;
  }
}

function buildRolePatch(
  existing: typeof roleAgents.$inferSelect,
  desired: typeof roleAgents.$inferInsert,
  overwrite: boolean,
) {
  const patch: Partial<typeof roleAgents.$inferInsert> = {};
  assignRolePatchValue(patch, "name", existing.name, desired.name, overwrite);
  assignRolePatchValue(patch, "description", existing.description, desired.description, overwrite);
  assignRolePatchValue(patch, "scope", existing.scope, desired.scope, overwrite);
  assignRolePatchValue(patch, "status", existing.status, desired.status, overwrite);
  assignRolePatchValue(patch, "ownerTeam", existing.ownerTeam, desired.ownerTeam, overwrite);
  assignRolePatchValue(
    patch,
    "permissionProfile",
    existing.permissionProfile,
    desired.permissionProfile,
    overwrite,
  );
  assignRolePatchValue(patch, "toolProfile", existing.toolProfile, desired.toolProfile, overwrite);
  assignRolePatchValue(
    patch,
    "defaultExecutionMode",
    existing.defaultExecutionMode,
    desired.defaultExecutionMode,
    overwrite,
  );
  assignRolePatchValue(
    patch,
    "aggregationStrategy",
    existing.aggregationStrategy,
    desired.aggregationStrategy,
    overwrite,
  );
  assignRolePatchValue(
    patch,
    "maxActiveBindings",
    existing.maxActiveBindings,
    desired.maxActiveBindings,
    overwrite,
  );
  assignRolePatchValue(
    patch,
    "requireConsensus",
    existing.requireConsensus,
    desired.requireConsensus,
    overwrite,
  );
  assignRolePatchValue(patch, "riskLevel", existing.riskLevel, desired.riskLevel, overwrite);
  assignRolePatchValue(
    patch,
    "requiresApprovalForWrite",
    existing.requiresApprovalForWrite,
    desired.requiresApprovalForWrite,
    overwrite,
  );
  assignRolePatchValue(
    patch,
    "allowedStagesJson",
    existing.allowedStagesJson,
    desired.allowedStagesJson,
    overwrite,
  );
  assignRolePatchValue(
    patch,
    "outputSchemaId",
    existing.outputSchemaId,
    desired.outputSchemaId,
    overwrite,
  );
  assignRolePatchValue(patch, "tagsJson", existing.tagsJson, desired.tagsJson, overwrite);

  return patch;
}

function assignBindingPatchValue<K extends keyof typeof roleAgentBindings.$inferInsert>(
  patch: Partial<typeof roleAgentBindings.$inferInsert>,
  key: K,
  current: (typeof roleAgentBindings.$inferSelect)[K],
  next: (typeof roleAgentBindings.$inferInsert)[K],
  overwrite: boolean,
) {
  if (overwrite) {
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      patch[key] = next;
    }
    return;
  }

  if (isMissingValue(current) && !isMissingValue(next)) {
    patch[key] = next;
  }
}

function buildBindingPatch(
  existing: typeof roleAgentBindings.$inferSelect,
  desired: typeof roleAgentBindings.$inferInsert,
  overwrite: boolean,
) {
  const patch: Partial<typeof roleAgentBindings.$inferInsert> = {};
  assignBindingPatchValue(
    patch,
    "runtimeAgent",
    existing.runtimeAgent,
    desired.runtimeAgent,
    overwrite,
  );
  assignBindingPatchValue(patch, "label", existing.label, desired.label, overwrite);
  assignBindingPatchValue(patch, "enabled", existing.enabled, desired.enabled, overwrite);
  assignBindingPatchValue(patch, "priority", existing.priority, desired.priority, overwrite);
  assignBindingPatchValue(patch, "model", existing.model, desired.model, overwrite);
  assignBindingPatchValue(patch, "tagsJson", existing.tagsJson, desired.tagsJson, overwrite);

  return patch;
}

function buildDesiredRole(
  definition: (typeof DEFAULT_ROLE_AGENT_DEFINITIONS)[number],
  now: string,
) {
  return {
    id: definition.role.id,
    projectId: null,
    name: definition.role.name,
    description: definition.role.description,
    scope: definition.role.scope,
    status: "active" as const,
    ownerTeam: definition.role.ownerTeam ?? null,
    permissionProfile: definition.role.permissionProfile,
    toolProfile: definition.role.toolProfile,
    defaultExecutionMode: definition.role.defaultExecutionMode,
    aggregationStrategy: definition.role.aggregationStrategy ?? null,
    maxActiveBindings: definition.role.maxActiveBindings ?? null,
    requireConsensus: definition.role.requireConsensus ?? false,
    riskLevel: definition.role.riskLevel ?? "low",
    requiresApprovalForWrite: definition.role.requiresApprovalForWrite ?? false,
    allowedStagesJson: definition.role.allowedStages,
    outputSchemaId: definition.role.outputSchemaId ?? null,
    tagsJson: definition.role.tags ?? null,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof roleAgents.$inferInsert;
}

async function syncDefaultRole(
  database: DB,
  definition: (typeof DEFAULT_ROLE_AGENT_DEFINITIONS)[number],
  desiredRole: typeof roleAgents.$inferInsert,
  overwrite: boolean,
  result: BootstrapDefaultRoleAgentsResult,
) {
  const existingRole = await database.query.roleAgents.findFirst({
    where: eq(roleAgents.id, definition.role.id),
  });

  if (!existingRole) {
    await database.insert(roleAgents).values(desiredRole);
    result.createdRoles.push(definition.role.id);
    return;
  }

  const patch = buildRolePatch(existingRole, desiredRole, overwrite);
  if (Object.keys(patch).length === 0) {
    result.skippedRoles.push(definition.role.id);
    return;
  }

  await database
    .update(roleAgents)
    .set({ ...patch, updatedAt: desiredRole.updatedAt })
    .where(eq(roleAgents.id, definition.role.id));
  result.updatedRoles.push(definition.role.id);
}

function buildDesiredBinding(
  roleId: string,
  binding: (typeof DEFAULT_ROLE_AGENT_DEFINITIONS)[number]["bindings"][number],
  now: string,
) {
  return {
    id: crypto.randomUUID(),
    roleAgentId: roleId,
    bindingKey: binding.bindingKey,
    runtimeAgent: binding.runtimeAgent,
    label: binding.label,
    enabled: binding.enabled ?? true,
    priority: binding.priority,
    model: binding.model ?? null,
    tagsJson: binding.tags ?? null,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof roleAgentBindings.$inferInsert;
}

async function syncDefaultBindings(
  database: DB,
  definition: (typeof DEFAULT_ROLE_AGENT_DEFINITIONS)[number],
  overwrite: boolean,
  result: BootstrapDefaultRoleAgentsResult,
) {
  const existingBindings = await database
    .select()
    .from(roleAgentBindings)
    .where(eq(roleAgentBindings.roleAgentId, definition.role.id));

  for (const binding of definition.bindings) {
    const now = new Date().toISOString();
    const desiredBinding = buildDesiredBinding(definition.role.id, binding, now);
    const existingBinding = existingBindings.find((item) => item.bindingKey === binding.bindingKey);

    if (!existingBinding) {
      await database.insert(roleAgentBindings).values(desiredBinding);
      result.createdBindings.push(`${definition.role.id}:${binding.bindingKey}`);
      continue;
    }

    const patch = buildBindingPatch(existingBinding, desiredBinding, overwrite);
    if (Object.keys(patch).length === 0) {
      result.skippedBindings.push(`${definition.role.id}:${binding.bindingKey}`);
      continue;
    }

    await database
      .update(roleAgentBindings)
      .set({ ...patch, updatedAt: now })
      .where(eq(roleAgentBindings.id, existingBinding.id));
    result.updatedBindings.push(`${definition.role.id}:${binding.bindingKey}`);
  }
}

export async function bootstrapDefaultRoleAgents(
  database: DB,
  options: BootstrapDefaultRoleAgentsOptions = {},
): Promise<BootstrapDefaultRoleAgentsResult> {
  const result: BootstrapDefaultRoleAgentsResult = {
    createdRoles: [],
    updatedRoles: [],
    skippedRoles: [],
    createdBindings: [],
    updatedBindings: [],
    skippedBindings: [],
  };
  const applyBindings = options.applyBindings ?? true;
  const overwrite = options.overwriteUnmodifiedRecords ?? false;

  for (const definition of DEFAULT_ROLE_AGENT_DEFINITIONS) {
    const now = new Date().toISOString();
    const desiredRole = buildDesiredRole(definition, now);
    await syncDefaultRole(database, definition, desiredRole, overwrite, result);

    if (!applyBindings) {
      continue;
    }

    await syncDefaultBindings(database, definition, overwrite, result);
  }

  return result;
}
