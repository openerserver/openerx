import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const toolRiskSchema = z.enum(["L0", "L1", "L2", "L3", "L4", "L5"]);
export const toolCapabilitySchema = z.enum([
  "builtin.compute",
  "builtin.structured_data",
  "file",
  "web.search",
  "browser",
  "shell",
  "desktop",
  "mcp",
]);

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
    resourceType: z.enum(["builtin", "workspace", "path", "domain", "application", "server"]),
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
  "waiting_for_user",
  "waiting_for_permission",
  "completed",
  "failed",
  "cancelled",
]);
export const executionRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_user",
  "waiting_for_permission",
  "completed",
  "failed",
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
    piSessionRef: z.string().min(1).nullable(),
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

export const toolCallSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    stepId: entityIdSchema,
    piCallRef: z.string().min(1),
    toolName: z.string().min(1).max(200),
    source: z.enum(["builtin", "openerx", "mcp"]),
    status: toolCallStatusSchema,
    risk: toolRiskSchema,
    idempotencyKey: z.string().min(8).max(240),
    inputSummary: z.string().max(2_000),
    targetSummary: z.string().max(2_000),
    resultSummary: z.string().max(4_000).nullable(),
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
    resolution: z.enum(["once", "session", "persistent", "deny"]).nullable(),
    scopeId: entityIdSchema.nullable(),
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

export const normalizedToolResultSchema = z
  .object({
    summary: z.string().max(8_000),
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
      cwd: z.string().min(1).max(4_096),
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
      x: z.number().int().nonnegative().optional(),
      y: z.number().int().nonnegative().optional(),
      text: z.string().max(100_000).optional(),
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
]);

export const piToolRequestFrameSchema = z
  .object({
    kind: z.literal("pi.tool.request"),
    requestId: entityIdSchema,
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    piToolCallId: z.string().min(1).max(500),
    toolName: z.string().min(1).max(200),
    operation: toolOperationSchema,
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
      "run.compacting",
      "run.compacted",
      "run.retrying",
      "run.retry_completed",
    ]),
    piToolCallId: z.string().min(1).max(500).optional(),
    toolName: z.string().min(1).max(200).optional(),
    inputSummary: z.string().max(2_000).optional(),
    resultSummary: z.string().max(4_000).optional(),
    errorCode: z.string().min(1).optional(),
  })
  .strict();

export const permissionResolveInputSchema = z
  .object({
    permissionRequestId: entityIdSchema,
    decision: z.enum(["once", "session", "persistent", "deny"]),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const mcpServerUpsertInputSchema = z.object({ config: mcpServerConfigSchema }).strict();
export const mcpServerRemoveInputSchema = z.object({ serverId: entityIdSchema }).strict();
export const mcpServerRemoveResultSchema = z
  .object({ serverId: entityIdSchema, removed: z.boolean() })
  .strict();
export const desktopMcpServerSaveInputSchema = z
  .object({
    config: mcpServerConfigSchema,
    bearerToken: z.string().min(1).max(20_000).optional(),
    oauthClientId: z.string().min(1).max(2_000).optional(),
    oauthClientSecret: z.string().min(1).max(20_000).optional(),
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
export const workItemGetInputSchema = z.object({ workItemId: entityIdSchema }).strict();
export const permissionListInputSchema = z
  .object({ status: permissionRequestSchema.shape.status.optional() })
  .strict();

export const workItemDetailSchema = z
  .object({
    workItem: workItemSchema,
    run: executionRunSchema,
    steps: z.array(runStepSchema),
    toolCalls: z.array(toolCallSchema),
    permissions: z.array(permissionRequestSchema),
  })
  .strict();

export type ToolRisk = z.infer<typeof toolRiskSchema>;
export type ToolCapability = z.infer<typeof toolCapabilitySchema>;
export type CapabilityAction = z.infer<typeof capabilityActionSchema>;
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type ExecutionRun = z.infer<typeof executionRunSchema>;
export type RunStep = z.infer<typeof runStepSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export type NormalizedToolResult = z.infer<typeof normalizedToolResultSchema>;
export type ToolOperation = z.infer<typeof toolOperationSchema>;
export type PiToolRequestFrame = z.infer<typeof piToolRequestFrameSchema>;
export type PiToolResponseFrame = z.infer<typeof piToolResponseFrameSchema>;
export type PiActivityEvent = z.infer<typeof piActivityEventSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type WorkItemDetail = z.infer<typeof workItemDetailSchema>;

export interface ToolBridge {
  listWorkItems(input?: z.input<typeof toolListInputSchema>): Promise<WorkItem[]>;
  getWorkItem(input: z.input<typeof workItemGetInputSchema>): Promise<WorkItemDetail>;
  listPermissionRequests(
    input?: z.input<typeof permissionListInputSchema>,
  ): Promise<PermissionRequest[]>;
  resolvePermission(
    input: z.input<typeof permissionResolveInputSchema>,
  ): Promise<PermissionRequest>;
  listCapabilityScopes(): Promise<CapabilityScope[]>;
  revokeCapabilityScope(
    input: z.input<typeof toolScopeRevokeInputSchema>,
  ): Promise<CapabilityScope>;
  listMcpServers(): Promise<McpServerConfig[]>;
  saveMcpServer(input: z.input<typeof desktopMcpServerSaveInputSchema>): Promise<McpServerConfig>;
  removeMcpServer(
    input: z.input<typeof mcpServerRemoveInputSchema>,
  ): Promise<z.infer<typeof mcpServerRemoveResultSchema>>;
}
