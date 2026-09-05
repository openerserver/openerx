import { z } from "zod";
import { brokeredBashOperationSchema } from "./brokered-bash";
import { browserComputerUseOperationV2Schema } from "./browser-computer-use";
import { entityIdSchema, timestampSchema } from "./common";
import { officeArtifactWriteInputSchema } from "./file";
import type {
  LocalWebSearchSettingsSelection,
  LocalWebSearchSettingsState,
  SelectableLocalWebSearchProviderId,
} from "./local-web-search";
import { memoryConflictKeySchema, memoryKindSchema } from "./memory";
import { thinkingLevelSchema, usageRecordSchema } from "./model";
import { workspaceInstructionSourceSchema } from "./workspace";

export const toolRiskSchema = z.enum(["L0", "L1", "L2", "L3", "L4", "L5"]);
export const toolPermissionModeSchema = z.enum(["ask", "full_access"]);
export const toolCapabilitySchema = z.enum([
  "full_access",
  "builtin.compute",
  "builtin.structured_data",
  "file",
  "workspace",
  "web.search",
  "image.generate",
  "browser",
  "shell",
  "desktop",
  "mcp",
  "skill",
]);

export const toolRuntimeCapabilitySchema = z.enum([
  "builtin.compute",
  "builtin.structured_data",
  "file",
  "web.search",
  "image.generate",
  "browser",
  "shell",
  "desktop",
  "mcp",
]);

export const toolRuntimeStatusSchema = z.enum([
  "available",
  "degraded",
  "authorization_required",
  "unavailable",
]);

export const toolRuntimeReadinessInputSchema = z
  .object({
    authenticated: z.boolean(),
    platformConfigured: z.boolean(),
  })
  .strict();

export const toolRuntimeReadinessSchema = z
  .object({
    capability: toolRuntimeCapabilitySchema,
    status: toolRuntimeStatusSchema,
    reason: z.string().min(1).max(500).nullable(),
    availableToolNames: z.array(z.string().min(1).max(200)).max(2_000),
    details: z.array(z.string().min(1).max(200)).max(20).optional(),
    checkedAt: timestampSchema,
  })
  .strict();

export const capabilityActionSchema = z.enum([
  "read",
  "search",
  "create",
  "patch",
  "navigate",
  "interact",
  "capture",
  "upload",
  "download",
  "execute",
  "input",
  "stop",
  "connect",
  "invoke",
  "external_write",
  "high_impact",
]);

export const capabilityScopeSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    capability: toolCapabilitySchema,
    resourceType: z.enum([
      "builtin",
      "workspace",
      "path",
      "domain",
      "application",
      "server",
      "skill",
    ]),
    resource: z.string().min(1).max(2_048),
    actions: z.array(capabilityActionSchema).min(1),
    maxRisk: toolRiskSchema,
    conversationId: entityIdSchema.nullable(),
    sessionOnly: z.boolean(),
    expiresAt: timestampSchema.nullable(),
    revokedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const workItemStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "waiting_for_user",
  "waiting_for_permission",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export const executionRunStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "waiting_for_user",
  "waiting_for_permission",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export const runStepStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const toolCallStatusSchema = z.enum([
  "requested",
  "waiting_for_permission",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const workItemSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    conversationId: entityIdSchema,
    messageId: entityIdSchema,
    title: z.string().min(1).max(160),
    status: workItemStatusSchema,
    activeRunId: entityIdSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const executionRunSchema = z
  .object({
    id: entityIdSchema,
    workItemId: entityIdSchema,
    attempt: z.number().int().positive(),
    status: executionRunStatusSchema,
    piPackageVersion: z.string().min(1),
    piHostContractVersion: z.number().int().positive(),
    selectedModelRef: z.string().min(1),
    effectiveModelRef: z.string().min(1).nullable(),
    branchId: entityIdSchema.nullable(),
    thinkingLevel: thinkingLevelSchema,
    fallbackReason: z.string().min(1).max(2_000).nullable(),
    initialToolNames: z.array(z.string().min(1).max(200)).max(1_000),
    availableToolNames: z.array(z.string().min(1).max(200)).max(2_000),
    skillInstallationIds: z.array(entityIdSchema).max(500),
    instructionSources: z.array(workspaceInstructionSourceSchema).max(500),
    piSessionRef: z.string().min(1).nullable(),
    usageRecords: z.array(usageRecordSchema),
    cancellationRequestedAt: timestampSchema.nullable(),
    lastPiEventSequence: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    compactionCount: z.number().int().nonnegative(),
    errorCode: z.string().min(1).nullable(),
    createdAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

export const runStepSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    piStepRef: z.string().min(1),
    kind: z.enum(["tool", "compaction", "retry", "model"]),
    title: z.string().min(1).max(200),
    status: runStepStatusSchema,
    sequence: z.number().int().positive(),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    errorCode: z.string().min(1).nullable(),
  })
  .strict();

export const toolSourceSchema = z
  .object({
    title: z.string().min(1).max(500),
    url: z.url(),
    publishedAt: timestampSchema.nullable(),
    retrievedAt: timestampSchema,
    excerpt: z.string().max(2_000),
  })
  .strict();

export const toolResultContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(2_000_000) }).strict(),
  z
    .object({
      type: z.literal("image"),
      data: z.string().min(4).max(44_739_244),
      mimeType: z.string().regex(/^image\/[A-Za-z0-9.+-]+$/u),
    })
    .strict(),
  z
    .object({
      type: z.literal("file"),
      personalFileId: entityIdSchema,
      displayName: z.string().min(1).max(500),
      mediaType: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ type: z.literal("artifact"), artifactId: entityIdSchema }).strict(),
  z.object({ type: z.literal("source"), source: toolSourceSchema }).strict(),
  z
    .object({
      type: z.literal("diff"),
      workspaceChangeId: entityIdSchema,
      relativePath: z.string().min(1).max(2_048),
      patch: z.string().max(5_000_000),
    })
    .strict(),
]);

export const mcpServerConfigSchema = z.discriminatedUnion("transport", [
  z
    .object({
      id: entityIdSchema,
      name: z.string().min(1).max(200),
      transport: z.literal("stdio"),
      command: z.string().min(1).max(1_000),
      args: z.array(z.string().max(8_000)).max(200),
      cwd: z.string().min(1).max(4_096),
      enabled: z.boolean(),
      enabledTools: z.array(z.string().min(1).max(300)).max(1_000),
    })
    .strict(),
  z
    .object({
      id: entityIdSchema,
      name: z.string().min(1).max(200),
      transport: z.literal("streamable_http"),
      url: z.url(),
      auth: z.enum(["none", "bearer", "oauth"]),
      credentialRef: z.string().min(1).max(500).nullable(),
      enabled: z.boolean(),
      enabledTools: z.array(z.string().min(1).max(300)).max(1_000),
    })
    .strict(),
]);

export const mcpToolAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
    openWorldHint: z.boolean(),
  })
  .strict();

export const mcpToolDescriptorSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
    serverId: entityIdSchema,
    serverName: z.string().min(1).max(200),
    toolName: z.string().min(1).max(300),
    title: z.string().min(1).max(300),
    description: z.string().max(8_000),
    inputSchema: z.record(z.string(), z.unknown()),
    annotations: mcpToolAnnotationsSchema,
    descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const normalizedToolResultSchema = z
  .object({
    summary: z.string().max(8_000),
    content: z.array(toolResultContentSchema).max(256).default([]),
    data: z.unknown().optional(),
    sources: z.array(toolSourceSchema).default([]),
    artifacts: z.array(entityIdSchema).default([]),
    sideEffectCommitted: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const toolOperationBase = {
  idempotencyKey: z.string().min(8).max(240),
};

export const toolOperationSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("compute"),
      expression: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  brokeredBashOperationSchema,
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("structured_data"),
      action: z.enum(["sort", "select", "unique"]),
      rows: z.array(z.record(z.string(), z.unknown())).max(10_000),
      fields: z.array(z.string().min(1)).max(100),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("web_search"),
      query: z.string().trim().min(1).max(1_000),
      recencyDays: z.number().int().positive().max(3_650).optional(),
      domains: z.array(z.string().min(1).max(253)).max(20).optional(),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("image_generate"),
      prompt: z.string().trim().min(1).max(8_000),
      aspectRatio: z.enum(["1:1", "3:2", "2:3", "16:9", "9:16"]).default("1:1"),
      count: z.number().int().min(1).max(4).default(1),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("shell_execute"),
      cwd: z.string().min(1).max(4_096).optional(),
      workspaceGrantId: entityIdSchema.optional(),
      relativeCwd: z.string().max(2_048).optional(),
      command: z.string().min(1).max(500),
      args: z.array(z.string().max(8_000)).max(200),
      timeoutMs: z.number().int().min(100).max(1_800_000),
      background: z.boolean(),
      allowNetwork: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_list"),
      workspaceGrantId: entityIdSchema,
      relativePath: z.string().max(2_048).default("."),
      maxDepth: z.number().int().min(1).max(8).default(2),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_search"),
      workspaceGrantId: entityIdSchema,
      query: z.string().trim().min(1).max(500),
      relativePath: z.string().max(2_048).default("."),
      maxResults: z.number().int().min(1).max(500).default(100),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_read"),
      workspaceGrantId: entityIdSchema,
      relativePath: z.string().min(1).max(2_048),
      startLine: z.number().int().positive().default(1),
      maxLines: z.number().int().min(1).max(5_000).default(500),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_instructions"),
      workspaceGrantId: entityIdSchema,
      relativePath: z.string().max(2_048).default("."),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_apply_patch"),
      workspaceGrantId: entityIdSchema,
      relativePath: z.string().min(1).max(2_048),
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .nullable(),
      replacements: z
        .array(
          z
            .object({
              oldText: z.string().max(1_000_000),
              newText: z.string().max(1_000_000),
            })
            .strict(),
        )
        .min(1)
        .max(100),
      instructionDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(100),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_diff"),
      workspaceGrantId: entityIdSchema,
      workspaceChangeId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_changes"),
      workspaceGrantId: entityIdSchema,
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_undo"),
      workspaceGrantId: entityIdSchema,
      workspaceChangeId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_change_set_review"),
      workspaceGrantId: entityIdSchema,
      workspaceChangeSetId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_change_set_apply"),
      workspaceGrantId: entityIdSchema,
      workspaceChangeSetId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_change_set_discard"),
      workspaceGrantId: entityIdSchema,
      workspaceChangeSetId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("workspace_change_set_undo"),
      workspaceGrantId: entityIdSchema,
      workspaceChangeSetId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("shell_status"),
      processId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("shell_input"),
      processId: entityIdSchema,
      input: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("shell_stop"),
      processId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      // BCU-001: legacy_dom_v1 is retained for persisted calls and the current runtime only.
      // Do not add capabilities here; browser_computer_use_v2 is the replacement contract.
      operation: z.literal("browser"),
      sessionId: entityIdSchema.optional(),
      action: z.enum([
        "open",
        "navigate",
        "click",
        "type",
        "submit",
        "screenshot",
        "upload",
        "download",
        "close",
      ]),
      url: z.string().max(4_096).optional(),
      selector: z.string().max(2_000).optional(),
      text: z.string().max(100_000).optional(),
      fileId: entityIdSchema.optional(),
      path: z.string().max(4_096).optional(),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("browser_computer_use"),
      request: browserComputerUseOperationV2Schema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("desktop"),
      action: z.enum([
        "screenshot",
        "click",
        "type",
        "key",
        "submit",
        "send",
        "delete",
        "purchase",
      ]),
      application: z.string().min(1).max(300),
      bundleId: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/u)
        .optional(),
      captureId: entityIdSchema.optional(),
      x: z.number().int().nonnegative().optional(),
      y: z.number().int().nonnegative().optional(),
      text: z.string().max(10_000).optional(),
      key: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("mcp_connect"),
      serverId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("mcp_list_tools"),
      serverId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("mcp_call"),
      serverId: entityIdSchema,
      tool: z.string().min(1).max(300),
      arguments: z.record(z.string(), z.unknown()),
      annotations: mcpToolAnnotationsSchema,
      descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("mcp_disconnect"),
      serverId: entityIdSchema,
      clearCredentials: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("skill_read"),
      installationId: entityIdSchema,
      relativePath: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("skill_script_execute"),
      installationId: entityIdSchema,
      relativePath: z.string().min(1).max(1_000),
      args: z.array(z.string().max(8_000)).max(200),
      timeoutMs: z.number().int().min(100).max(1_800_000),
      allowNetwork: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("memory_search"),
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(8),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("memory_list"),
      kind: memoryKindSchema.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("memory_upsert"),
      memoryId: entityIdSchema.optional(),
      kind: memoryKindSchema,
      content: z.string().trim().min(1).max(2_000),
      retrievalKeys: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
      conflictKey: memoryConflictKeySchema.optional(),
    })
    .strict(),
  z
    .object({
      ...toolOperationBase,
      operation: z.literal("memory_forget"),
      memoryId: entityIdSchema,
    })
    .strict(),
]);

export const piFileToolOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list"), input: z.object({}).strict() }).strict(),
  z
    .object({
      operation: z.literal("search"),
      input: z.object({ query: z.string().trim().min(1).max(500) }).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("read"),
      input: z.object({ personalFileId: entityIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("artifact.write"),
      input: z
        .object({
          artifactId: entityIdSchema.optional(),
          displayName: z.string().trim().min(1).max(240),
          purpose: z.enum(["deliverable", "intermediate"]).optional(),
          format: z.enum(["text", "markdown", "code", "json", "yaml", "csv", "html"]),
          mediaType: z.string().min(1).max(200),
          content: z.string().max(5_000_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("artifact.office.write"),
      input: officeArtifactWriteInputSchema,
    })
    .strict(),
]);

export const toolInputSchema = z.union([toolOperationSchema, piFileToolOperationSchema]);

export const toolCallSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    stepId: entityIdSchema,
    piCallRef: z.string().min(1),
    toolName: z.string().min(1).max(200),
    source: z.enum(["builtin", "openerx", "mcp", "skill"]),
    status: toolCallStatusSchema,
    risk: toolRiskSchema,
    idempotencyKey: z.string().min(8).max(240),
    input: toolInputSchema.nullable(),
    inputSummary: z.string().max(2_000),
    targetSummary: z.string().max(2_000),
    resultSummary: z.string().max(8_000).nullable(),
    resultContent: z.array(toolResultContentSchema).max(256),
    errorCode: z.string().min(1).nullable(),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

export const permissionRequestSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    workItemId: entityIdSchema,
    runId: entityIdSchema,
    toolCallId: entityIdSchema,
    capability: toolCapabilitySchema,
    risk: toolRiskSchema,
    resourceType: capabilityScopeSchema.shape.resourceType,
    resource: z.string().min(1).max(2_048),
    actions: z.array(capabilityActionSchema).min(1),
    reason: z.string().min(1).max(2_000),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["pending", "approved", "denied", "expired", "cancelled"]),
    requestedAt: timestampSchema,
    expiresAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    resolution: z.enum(["once", "session", "persistent", "full_access", "deny"]).nullable(),
    scopeId: entityIdSchema.nullable(),
  })
  .strict();

export const planEntrySchema = z
  .object({
    text: z.string().trim().min(1).max(2_000),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict();

export const runItemStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const runItemContentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("model"),
      modelRef: z.string().min(1).max(500),
      summary: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning"),
      summary: z.string().min(1).max(2_000),
      reasoningTokens: z.number().int().nonnegative().nullable(),
      contentRedacted: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("plan"),
      explanation: z.string().max(4_000).nullable(),
      entries: z.array(planEntrySchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool"),
      toolCallId: entityIdSchema,
      toolName: z.string().min(1).max(200),
      input: toolInputSchema.nullable(),
      inputSummary: z.string().max(2_000),
      targetSummary: z.string().max(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("command"),
      toolCallId: entityIdSchema,
      command: z.string().min(1).max(500),
      args: z.array(z.string().max(8_000)).max(200),
      cwd: z.string().max(4_096).nullable(),
      processId: entityIdSchema.nullable(),
      exitCode: z.number().int().nullable(),
      output: z.string().max(2_000_000),
      outputTruncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("source"),
      toolCallId: entityIdSchema,
      source: toolSourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("diff"),
      toolCallId: entityIdSchema,
      workspaceChangeId: entityIdSchema,
      relativePath: z.string().min(1).max(2_048),
      patch: z.string().max(5_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval"),
      permissionRequestId: entityIdSchema,
      toolCallId: entityIdSchema,
      capability: toolCapabilitySchema,
      risk: toolRiskSchema,
      resource: z.string().min(1).max(2_048),
      reason: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("compaction"),
      reason: z.enum(["manual", "threshold", "overflow", "unknown"]),
      tokensBefore: z.number().int().nonnegative().nullable(),
      tokensAfter: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("retry"),
      attempt: z.number().int().positive(),
      maxAttempts: z.number().int().positive(),
      delayMs: z.number().int().nonnegative(),
      summary: z.string().max(2_000),
    })
    .strict(),
]);

export const runItemSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    sequence: z.number().int().positive(),
    piItemRef: z.string().min(1).max(500),
    status: runItemStatusSchema,
    content: runItemContentSchema,
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    errorCode: z.string().min(1).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const piToolRequestFrameSchema = z
  .object({
    kind: z.literal("pi.tool.request"),
    requestId: entityIdSchema,
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    branchId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    piToolCallId: z.string().min(1).max(500),
    toolName: z.string().min(1).max(200),
    operation: toolOperationSchema,
  })
  .strict();

export const piToolProgressFrameSchema = z
  .object({
    kind: z.literal("pi.tool.progress"),
    requestId: entityIdSchema,
    sequence: z.number().int().positive(),
    delta: z.string().max(16_384),
    truncated: z.boolean(),
  })
  .strict();

export const piToolCancelFrameSchema = z
  .object({
    kind: z.literal("pi.tool.cancel"),
    requestId: entityIdSchema,
    generationId: entityIdSchema,
  })
  .strict();

export const piToolResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("pi.tool.response"),
      requestId: entityIdSchema,
      ok: z.literal(true),
      data: normalizedToolResultSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("pi.tool.response"),
      requestId: entityIdSchema,
      ok: z.literal(false),
      errorCode: z.string().min(1),
      message: z.string().max(2_000),
    })
    .strict(),
]);

export const piActivityEventSchema = z
  .object({
    kind: z.literal("pi.activity-event"),
    generationId: entityIdSchema,
    eventId: entityIdSchema,
    sequence: z.number().int().positive(),
    occurredAt: timestampSchema,
    type: z.enum([
      "tool.requested",
      "tool.progressed",
      "tool.completed",
      "tool.failed",
      "model.started",
      "model.completed",
      "reasoning.started",
      "reasoning.completed",
      "plan.updated",
      "run.compacting",
      "run.compacted",
      "run.retrying",
      "run.retry_completed",
    ]),
    piItemRef: z.string().min(1).max(500).optional(),
    piToolCallId: z.string().min(1).max(500).optional(),
    toolName: z.string().min(1).max(200).optional(),
    inputSummary: z.string().max(2_000).optional(),
    resultSummary: z.string().max(4_000).optional(),
    errorCode: z.string().min(1).optional(),
    modelRef: z.string().min(1).max(500).optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    planEntries: z.array(planEntrySchema).min(1).max(100).optional(),
    explanation: z.string().max(4_000).optional(),
    compactionReason: z.enum(["manual", "threshold", "overflow"]).optional(),
    tokensBefore: z.number().int().nonnegative().optional(),
    tokensAfter: z.number().int().nonnegative().optional(),
    attempt: z.number().int().positive().optional(),
    maxAttempts: z.number().int().positive().optional(),
    delayMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const permissionResolveInputSchema = z
  .object({
    permissionRequestId: entityIdSchema,
    decision: z.enum(["once", "session", "persistent", "deny"]),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const toolPermissionModeGetInputSchema = z
  .object({ conversationId: entityIdSchema })
  .strict();
export const toolPermissionModeSetInputSchema = z
  .object({
    conversationId: entityIdSchema,
    mode: toolPermissionModeSchema,
  })
  .strict();
export const toolPermissionModeStateSchema = z
  .object({
    conversationId: entityIdSchema,
    mode: toolPermissionModeSchema,
    scopeId: entityIdSchema.nullable(),
  })
  .strict();
export const mcpServerUpsertInputSchema = z.object({ config: mcpServerConfigSchema }).strict();
export const mcpServerRemoveInputSchema = z.object({ serverId: entityIdSchema }).strict();
export const mcpServerRemoveResultSchema = z
  .object({ serverId: entityIdSchema, removed: z.boolean() })
  .strict();
export const mcpServerAuthorizeInputSchema = z.object({ serverId: entityIdSchema }).strict();
export const mcpServerAuthorizationStateSchema = z
  .object({
    serverId: entityIdSchema,
    status: z.enum(["not_required", "authorization_required", "authorized", "unavailable"]),
    connected: z.boolean(),
    connectedAt: timestampSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    reason: z.string().min(1).max(500).nullable(),
  })
  .strict();
export const desktopMcpServerSaveInputSchema = z
  .object({
    config: mcpServerConfigSchema,
    bearerToken: z.string().min(1).max(20_000).optional(),
    oauthClientId: z.string().min(1).max(2_000).optional(),
    oauthScope: z.string().max(4_000).optional(),
  })
  .strict();
export const toolListInputSchema = z
  .object({
    conversationId: entityIdSchema.optional(),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();
export const toolScopeRevokeInputSchema = z.object({ scopeId: entityIdSchema }).strict();
export const workItemGetInputSchema = z
  .object({ workItemId: entityIdSchema, runId: entityIdSchema.optional() })
  .strict();
export const permissionListInputSchema = z
  .object({ status: permissionRequestSchema.shape.status.optional() })
  .strict();

export const workItemDetailSchema = z
  .object({
    workItem: workItemSchema,
    runs: z.array(executionRunSchema),
    run: executionRunSchema,
    items: z.array(runItemSchema),
    steps: z.array(runStepSchema),
    toolCalls: z.array(toolCallSchema),
    permissions: z.array(permissionRequestSchema),
  })
  .strict();

export type ToolRisk = z.infer<typeof toolRiskSchema>;
export type ToolPermissionMode = z.infer<typeof toolPermissionModeSchema>;
export type ToolPermissionModeState = z.infer<typeof toolPermissionModeStateSchema>;
export type ToolCapability = z.infer<typeof toolCapabilitySchema>;
export type ToolRuntimeCapability = z.infer<typeof toolRuntimeCapabilitySchema>;
export type ToolRuntimeStatus = z.infer<typeof toolRuntimeStatusSchema>;
export type ToolRuntimeReadiness = z.infer<typeof toolRuntimeReadinessSchema>;
export type CapabilityAction = z.infer<typeof capabilityActionSchema>;
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type ExecutionRun = z.infer<typeof executionRunSchema>;
export type RunStep = z.infer<typeof runStepSchema>;
export type RunItem = z.infer<typeof runItemSchema>;
export type RunItemContent = z.infer<typeof runItemContentSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export type ToolResultContent = z.infer<typeof toolResultContentSchema>;
export type NormalizedToolResult = z.infer<typeof normalizedToolResultSchema>;
export type ToolOperation = z.infer<typeof toolOperationSchema>;
export type PiFileToolOperation = z.infer<typeof piFileToolOperationSchema>;
export type ToolInput = z.infer<typeof toolInputSchema>;
export type PiToolRequestFrame = z.infer<typeof piToolRequestFrameSchema>;
export type PiToolResponseFrame = z.infer<typeof piToolResponseFrameSchema>;
export type PiToolProgressFrame = z.infer<typeof piToolProgressFrameSchema>;
export type PiToolCancelFrame = z.infer<typeof piToolCancelFrameSchema>;
export type PiActivityEvent = z.infer<typeof piActivityEventSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type McpServerAuthorizationState = z.infer<typeof mcpServerAuthorizationStateSchema>;
export type McpToolAnnotations = z.infer<typeof mcpToolAnnotationsSchema>;
export type McpToolDescriptor = z.infer<typeof mcpToolDescriptorSchema>;
export type WorkItemDetail = z.infer<typeof workItemDetailSchema>;

export interface ToolBridge {
  listToolRuntimeReadiness(): Promise<ToolRuntimeReadiness[]>;
  getLocalWebSearchSettings(): Promise<LocalWebSearchSettingsState>;
  updateLocalWebSearchSettings(
    input: LocalWebSearchSettingsSelection,
  ): Promise<LocalWebSearchSettingsState>;
  resetLocalWebSearchRuntime(input?: {
    providerId?: SelectableLocalWebSearchProviderId;
  }): Promise<LocalWebSearchSettingsState>;
  listWorkItems(input?: z.input<typeof toolListInputSchema>): Promise<WorkItem[]>;
  getWorkItem(input: z.input<typeof workItemGetInputSchema>): Promise<WorkItemDetail>;
  listPermissionRequests(
    input?: z.input<typeof permissionListInputSchema>,
  ): Promise<PermissionRequest[]>;
  resolvePermission(
    input: z.input<typeof permissionResolveInputSchema>,
  ): Promise<PermissionRequest>;
  getToolPermissionMode(
    input: z.input<typeof toolPermissionModeGetInputSchema>,
  ): Promise<ToolPermissionModeState>;
  setToolPermissionMode(
    input: z.input<typeof toolPermissionModeSetInputSchema>,
  ): Promise<ToolPermissionModeState>;
  listCapabilityScopes(): Promise<CapabilityScope[]>;
  revokeCapabilityScope(
    input: z.input<typeof toolScopeRevokeInputSchema>,
  ): Promise<CapabilityScope>;
  listMcpServers(): Promise<McpServerConfig[]>;
  listMcpServerAuthorizationStates(): Promise<McpServerAuthorizationState[]>;
  authorizeMcpServer(
    input: z.input<typeof mcpServerAuthorizeInputSchema>,
  ): Promise<McpServerAuthorizationState>;
  saveMcpServer(input: z.input<typeof desktopMcpServerSaveInputSchema>): Promise<McpServerConfig>;
  removeMcpServer(
    input: z.input<typeof mcpServerRemoveInputSchema>,
  ): Promise<z.infer<typeof mcpServerRemoveResultSchema>>;
}
