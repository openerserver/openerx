import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import {
  roleAgentBindings,
  roleAgentProjectOverrides,
  roleAgents,
  workflowTemplateStages,
} from "../../db/schema";

export interface ResolveRoleAgentInput {
  roleAgentId: string;
  projectId?: string;
  stage?: string;
  templateId?: string;
}

export interface ResolvedRoleAgentResult {
  role: {
    id: string;
    projectId?: string | null;
    name: string;
    scope: "system" | "project";
    status: "active" | "disabled" | "deprecated";
    riskLevel: "low" | "medium" | "high" | "critical";
    allowedStages: string[];
    permissionProfile: string;
    toolProfile: string;
    defaultExecutionMode: "single" | "parallel-review" | "round-robin";
    aggregationPolicy?: {
      strategy: "first-pass" | "majority" | "merge-summary" | "human-review";
      maxActiveBindings?: number;
      requireConsensus?: boolean;
    };
    requiresApprovalForWrite: boolean;
    outputSchemaId?: string | null;
    bindings: Array<{
      bindingId: string;
      runtimeAgent: string;
      label: string;
      enabled: boolean;
      priority: number;
      model?: string | null;
      tags?: string[] | null;
    }>;
  };
  source: {
    baseScope: "system" | "project";
    overrideApplied: boolean;
    policySource: "role-default" | "template-stage";
  };
  validation: {
    executable: boolean;
    reasons: string[];
  };
}

interface TemplateRoleExecutionPolicy {
  roleAgentId: string;
  executionMode?: "single" | "parallel-review" | "round-robin";
  maxBindings?: number;
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review";
}

function mergeStringArray(
  value: string[] | null | undefined,
  fallback: string[] | null | undefined,
) {
  return value ?? fallback ?? [];
}

function isWriteCapableNonDeveloperRole(role: {
  id: string;
  permissionProfile: string;
  toolProfile: string;
}) {
  if (role.id === "role.developer") {
    return false;
  }

  return (
    role.permissionProfile === "perm.code-implementation" || role.toolProfile.includes("write")
  );
}

function parseTemplatePolicy(raw: unknown, roleAgentId: string) {
  if (!Array.isArray(raw)) {
    return null;
  }

  const match = raw.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as TemplateRoleExecutionPolicy).roleAgentId === roleAgentId;
  });

  return (match as TemplateRoleExecutionPolicy | undefined) ?? null;
}

async function loadProjectOverride(roleAgentId: string, projectId?: string) {
  if (!projectId) {
    return null;
  }

  return db.query.roleAgentProjectOverrides.findFirst({
    where: and(
      eq(roleAgentProjectOverrides.roleAgentId, roleAgentId),
      eq(roleAgentProjectOverrides.projectId, projectId),
    ),
  });
}

async function loadBindings(roleAgentId: string, projectId?: string) {
  return db
    .select()
    .from(roleAgentBindings)
    .where(
      projectId
        ? and(
            eq(roleAgentBindings.roleAgentId, roleAgentId),
            or(eq(roleAgentBindings.projectId, projectId), isNull(roleAgentBindings.projectId)),
          )
        : and(eq(roleAgentBindings.roleAgentId, roleAgentId), isNull(roleAgentBindings.projectId)),
    );
}

function mergeResolvedRole(
  role: NonNullable<Awaited<ReturnType<typeof db.query.roleAgents.findFirst>>>,
  projectOverride: Awaited<ReturnType<typeof loadProjectOverride>>,
  projectId?: string,
) {
  return {
    ...role,
    projectId: projectId ?? role.projectId ?? null,
    name: projectOverride?.name ?? role.name,
    description: projectOverride?.description ?? role.description,
    status: projectOverride?.status ?? role.status,
    ownerTeam: projectOverride?.ownerTeam ?? role.ownerTeam,
    permissionProfile: projectOverride?.permissionProfile ?? role.permissionProfile,
    toolProfile: projectOverride?.toolProfile ?? role.toolProfile,
    defaultExecutionMode: projectOverride?.defaultExecutionMode ?? role.defaultExecutionMode,
    aggregationStrategy: projectOverride?.aggregationStrategy ?? role.aggregationStrategy,
    maxActiveBindings: projectOverride?.maxActiveBindings ?? role.maxActiveBindings,
    requireConsensus: projectOverride?.requireConsensus ?? role.requireConsensus,
    riskLevel: projectOverride?.riskLevel ?? role.riskLevel,
    requiresApprovalForWrite:
      projectOverride?.requiresApprovalForWrite ?? role.requiresApprovalForWrite,
    allowedStagesJson: mergeStringArray(projectOverride?.allowedStagesJson, role.allowedStagesJson),
    outputSchemaId: projectOverride?.outputSchemaId ?? role.outputSchemaId,
    tagsJson: projectOverride?.tagsJson ?? role.tagsJson,
  };
}

async function resolveTemplateExecutionPolicy(
  templateId: string | undefined,
  stage: string | undefined,
  roleAgentId: string,
  defaults: {
    executionMode: NonNullable<ResolvedRoleAgentResult["role"]["defaultExecutionMode"]>;
    aggregationStrategy?: ResolvedRoleAgentResult["role"]["aggregationPolicy"] extends infer T
      ? T extends { strategy: infer S }
        ? S
        : never
      : never;
    maxActiveBindings?: number;
  },
) {
  if (!templateId || !stage) {
    return {
      policySource: "role-default" as const,
      executionMode: defaults.executionMode,
      aggregationStrategy: defaults.aggregationStrategy,
      maxActiveBindings: defaults.maxActiveBindings,
    };
  }

  const stageRow = await db.query.workflowTemplateStages.findFirst({
    where: and(
      eq(workflowTemplateStages.templateId, templateId),
      eq(workflowTemplateStages.stageKey, stage),
    ),
  });
  const policy = parseTemplatePolicy(stageRow?.roleExecutionPoliciesJson, roleAgentId);
  if (!policy) {
    return {
      policySource: "role-default" as const,
      executionMode: defaults.executionMode,
      aggregationStrategy: defaults.aggregationStrategy,
      maxActiveBindings: defaults.maxActiveBindings,
    };
  }

  return {
    policySource: "template-stage" as const,
    executionMode: policy.executionMode ?? defaults.executionMode,
    aggregationStrategy: policy.aggregationStrategy ?? defaults.aggregationStrategy,
    maxActiveBindings: policy.maxBindings ?? defaults.maxActiveBindings,
  };
}

function dedupeBindings(bindings: Array<typeof roleAgentBindings.$inferSelect>) {
  return Array.from(
    bindings
      .reduce((map, binding) => {
        const previous = map.get(binding.bindingKey);
        if (!previous) {
          map.set(binding.bindingKey, binding);
          return map;
        }

        const previousSpecificity = previous.projectId ? 1 : 0;
        const currentSpecificity = binding.projectId ? 1 : 0;
        if (
          currentSpecificity > previousSpecificity ||
          (currentSpecificity === previousSpecificity && binding.priority < previous.priority)
        ) {
          map.set(binding.bindingKey, binding);
        }

        return map;
      }, new Map<string, (typeof bindings)[number]>())
      .values(),
  );
}

function selectBindingsForExecution(
  bindings: Array<typeof roleAgentBindings.$inferSelect>,
  projectId: string | undefined,
  bindingsMode: string,
) {
  const projectScopedBindings = bindings.filter((binding) => binding.projectId === projectId);
  const selected = projectId && bindingsMode === "replace" ? projectScopedBindings : bindings;
  return dedupeBindings(selected);
}

function buildEnabledBindings(
  bindings: Array<typeof roleAgentBindings.$inferSelect>,
  maxActiveBindings: number | undefined,
) {
  return bindings
    .filter((binding) => binding.enabled)
    .sort((left, right) => left.priority - right.priority)
    .slice(0, maxActiveBindings && maxActiveBindings > 0 ? maxActiveBindings : bindings.length)
    .map((binding) => ({
      bindingId: binding.id,
      runtimeAgent: binding.runtimeAgent,
      label: binding.label,
      enabled: binding.enabled,
      priority: binding.priority,
      model: binding.model ?? null,
      tags: binding.tagsJson ?? null,
    }));
}

function collectResolutionReasons(
  role: {
    id: string;
    status: string;
    permissionProfile: string;
    toolProfile: string;
  },
  stage: string | undefined,
  allowedStages: string[],
  enabledBindings: ResolvedRoleAgentResult["role"]["bindings"],
) {
  const reasons: string[] = [];
  if (role.status !== "active") {
    reasons.push(`role status is ${role.status}`);
  }
  if (stage && !allowedStages.includes(stage)) {
    reasons.push(`stage ${stage} is not allowed`);
  }
  if (enabledBindings.length === 0) {
    reasons.push("no enabled bindings available");
  }
  if (isWriteCapableNonDeveloperRole(role)) {
    reasons.push("non-developer role cannot hold code write capability");
  }
  return reasons;
}

export async function resolveRoleAgentForExecution(
  input: ResolveRoleAgentInput,
): Promise<ResolvedRoleAgentResult | null> {
  const role = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, input.roleAgentId) });
  if (!role) {
    return null;
  }

  const [projectOverride, bindings] = await Promise.all([
    loadProjectOverride(role.id, input.projectId),
    loadBindings(role.id, input.projectId),
  ]);
  const mergedRole = mergeResolvedRole(role, projectOverride, input.projectId);
  const { policySource, executionMode, aggregationStrategy, maxActiveBindings } =
    await resolveTemplateExecutionPolicy(input.templateId, input.stage, input.roleAgentId, {
      executionMode: mergedRole.defaultExecutionMode,
      aggregationStrategy: mergedRole.aggregationStrategy ?? undefined,
      maxActiveBindings: mergedRole.maxActiveBindings ?? undefined,
    });

  const bindingsMode = projectOverride?.bindingsMode ?? "inherit";
  const dedupedBindings = selectBindingsForExecution(bindings, input.projectId, bindingsMode);

  const allowedStages = mergedRole.allowedStagesJson ?? [];
  const enabledBindings = buildEnabledBindings(dedupedBindings, maxActiveBindings);
  const reasons = collectResolutionReasons(
    {
      id: role.id,
      status: mergedRole.status,
      permissionProfile: mergedRole.permissionProfile,
      toolProfile: mergedRole.toolProfile,
    },
    input.stage,
    allowedStages,
    enabledBindings,
  );

  return {
    role: {
      id: role.id,
      projectId: mergedRole.projectId,
      name: mergedRole.name,
      scope: role.scope,
      status: mergedRole.status,
      riskLevel: mergedRole.riskLevel,
      allowedStages,
      permissionProfile: mergedRole.permissionProfile,
      toolProfile: mergedRole.toolProfile,
      defaultExecutionMode: executionMode,
      aggregationPolicy: aggregationStrategy
        ? {
            strategy: aggregationStrategy,
            maxActiveBindings,
            requireConsensus: mergedRole.requireConsensus,
          }
        : undefined,
      requiresApprovalForWrite: mergedRole.requiresApprovalForWrite,
      outputSchemaId: mergedRole.outputSchemaId ?? null,
      bindings: enabledBindings,
    },
    source: {
      baseScope: role.scope,
      overrideApplied: Boolean(projectOverride),
      policySource,
    },
    validation: {
      executable: reasons.length === 0,
      reasons,
    },
  };
}
