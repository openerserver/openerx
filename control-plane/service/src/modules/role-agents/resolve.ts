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

function mergeStringArray(value: string[] | null | undefined, fallback: string[] | null | undefined) {
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

  return role.permissionProfile === "perm.code-implementation" || role.toolProfile.includes("write");
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

export async function resolveRoleAgentForExecution(
  input: ResolveRoleAgentInput,
): Promise<ResolvedRoleAgentResult | null> {
  const role = await db.query.roleAgents.findFirst({ where: eq(roleAgents.id, input.roleAgentId) });
  if (!role) {
    return null;
  }

  const projectOverride = input.projectId
    ? await db.query.roleAgentProjectOverrides.findFirst({
        where: and(
          eq(roleAgentProjectOverrides.roleAgentId, role.id),
          eq(roleAgentProjectOverrides.projectId, input.projectId),
        ),
      })
    : null;

  const bindings = await db
    .select()
    .from(roleAgentBindings)
    .where(
      input.projectId
        ? and(
            eq(roleAgentBindings.roleAgentId, role.id),
            or(eq(roleAgentBindings.projectId, input.projectId), isNull(roleAgentBindings.projectId)),
          )
        : and(eq(roleAgentBindings.roleAgentId, role.id), isNull(roleAgentBindings.projectId)),
    );

  const mergedRole = {
    ...role,
    projectId: input.projectId ?? role.projectId ?? null,
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

  let policySource: "role-default" | "template-stage" = "role-default";
  let executionMode = mergedRole.defaultExecutionMode;
  let aggregationStrategy = mergedRole.aggregationStrategy ?? undefined;
  let maxActiveBindings = mergedRole.maxActiveBindings ?? undefined;

  if (input.templateId && input.stage) {
    const stage = await db.query.workflowTemplateStages.findFirst({
      where: and(
        eq(workflowTemplateStages.templateId, input.templateId),
        eq(workflowTemplateStages.stageKey, input.stage),
      ),
    });

    const policy = parseTemplatePolicy(stage?.roleExecutionPoliciesJson, input.roleAgentId);
    if (policy) {
      policySource = "template-stage";
      executionMode = policy.executionMode ?? executionMode;
      aggregationStrategy = policy.aggregationStrategy ?? aggregationStrategy;
      maxActiveBindings = policy.maxBindings ?? maxActiveBindings;
    }
  }

  const bindingsMode = projectOverride?.bindingsMode ?? "inherit";
  const projectScopedBindings = bindings.filter((binding) => binding.projectId === input.projectId);
  const selectedBindings =
    input.projectId && bindingsMode === "replace" ? projectScopedBindings : bindings;

  const dedupedBindings = Array.from(
    selectedBindings.reduce((map, binding) => {
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

  const allowedStages = mergedRole.allowedStagesJson ?? [];
  const enabledBindings = dedupedBindings
    .filter((binding) => binding.enabled)
    .sort((left, right) => left.priority - right.priority)
    .slice(
      0,
      maxActiveBindings && maxActiveBindings > 0 ? maxActiveBindings : dedupedBindings.length,
    )
    .map((binding) => ({
      bindingId: binding.id,
      runtimeAgent: binding.runtimeAgent,
      label: binding.label,
      enabled: binding.enabled,
      priority: binding.priority,
      model: binding.model ?? null,
      tags: binding.tagsJson ?? null,
    }));

  const reasons: string[] = [];
  if (mergedRole.status !== "active") {
    reasons.push(`role status is ${mergedRole.status}`);
  }
  if (input.stage && !allowedStages.includes(input.stage)) {
    reasons.push(`stage ${input.stage} is not allowed`);
  }
  if (enabledBindings.length === 0) {
    reasons.push("no enabled bindings available");
  }
  if (isWriteCapableNonDeveloperRole({
    id: role.id,
    permissionProfile: mergedRole.permissionProfile,
    toolProfile: mergedRole.toolProfile,
  })) {
    reasons.push("non-developer role cannot hold code write capability");
  }

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