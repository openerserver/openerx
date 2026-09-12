import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";
import type { ModelUsageAggregate, ModelUsageRecord } from "./model-usage";

export const thinkingLevelValues = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const thinkingLevelSchema = z.enum(thinkingLevelValues);
export const defaultThinkingLevel = "medium" as const;

const supportedThinkingLevelsSchema = z
  .array(thinkingLevelSchema)
  .min(1)
  .max(thinkingLevelValues.length)
  .refine((levels) => new Set(levels).size === levels.length, {
    message: "Thinking levels must be unique",
  });

export const modelCapabilitiesSchema = z
  .object({
    textInput: z.boolean(),
    imageInput: z.boolean(),
    fileInput: z.boolean(),
    functionCalling: z.boolean(),
    structuredOutput: z.boolean(),
  })
  .strict();

export const toolSystemPermissionSchema = z.enum(["screen_capture", "accessibility"]);

export const hostToolAvailabilitySchema = z
  .object({
    availableToolNames: z.array(z.string().min(1).max(200)).max(2_000),
    unavailableReasons: z.record(z.string(), z.string().min(1).max(1_000)),
    missingPermissions: z.record(z.string(), z.array(toolSystemPermissionSchema).max(2)).optional(),
  })
  .strict();

export const modelCatalogEntrySchema = z
  .object({
    modelRef: z.string().regex(/^platform\/[a-z0-9][a-z0-9._-]*$/),
    displayName: z.string().trim().min(1).max(120),
    version: z.string().min(1),
    capabilities: modelCapabilitiesSchema,
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    status: z.enum(["available", "degraded", "unavailable"]),
    priceRef: z.string().min(1),
    priceSummary: z.string().min(1),
    free: z.boolean(),
    thinkingLevels: supportedThinkingLevelsSchema.optional(),
  })
  .strict();

export const nullableTokenCountSchema = z.number().int().nonnegative().nullable();

export const usageRecordSchema = z
  .object({
    usageId: entityIdSchema,
    accountId: entityIdSchema,
    conversationId: entityIdSchema,
    messageId: entityIdSchema,
    runId: entityIdSchema.nullable(),
    toolCallId: entityIdSchema.nullable(),
    selectedModelRef: z.string().min(1),
    effectiveModelRef: z.string().min(1),
    fallbackReason: z.string().min(1).nullable().optional(),
    inputTokens: nullableTokenCountSchema,
    cachedInputTokens: nullableTokenCountSchema,
    outputTokens: nullableTokenCountSchema,
    reasoningTokens: nullableTokenCountSchema,
    totalTokens: nullableTokenCountSchema,
    providerReported: z.boolean(),
    missingReasons: z.record(z.string(), z.string().min(1)),
    dedupeKey: z.string().min(8).max(240),
    recordedAt: timestampSchema,
  })
  .strict();

export const tokenAggregateFieldSchema = z
  .object({
    known: z.number().int().nonnegative(),
    unknownRecords: z.number().int().nonnegative(),
  })
  .strict();

export const usageAggregateSchema = z
  .object({
    accountId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
    messageId: entityIdSchema.nullable(),
    records: z.number().int().nonnegative(),
    inputTokens: tokenAggregateFieldSchema,
    cachedInputTokens: tokenAggregateFieldSchema,
    outputTokens: tokenAggregateFieldSchema,
    reasoningTokens: tokenAggregateFieldSchema,
    totalTokens: tokenAggregateFieldSchema,
  })
  .strict();

export const modelRequirementSchema = z
  .object({
    imageInput: z.boolean().optional(),
    fileInput: z.boolean().optional(),
    functionCalling: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
  })
  .strict();

export const modelSelectionCheckSchema = z.discriminatedUnion("supported", [
  z.object({ supported: z.literal(true) }).strict(),
  z
    .object({
      supported: z.literal(false),
      modelRef: z.string().min(1),
      missingCapabilities: z.array(z.string().min(1)).min(1),
      suggestedModelRefs: z.array(z.string().min(1)),
    })
    .strict(),
]);

export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type UsageAggregate = z.infer<typeof usageAggregateSchema>;
export type TokenAggregateField = z.infer<typeof tokenAggregateFieldSchema>;
export type ModelRequirement = z.infer<typeof modelRequirementSchema>;
export type ModelSelectionCheck = z.infer<typeof modelSelectionCheckSchema>;
export type HostToolAvailability = z.infer<typeof hostToolAvailabilitySchema>;

export interface ModelGatewayRequest {
  accountId: string;
  conversationId: string;
  messageId: string;
  selectedModelRef: string;
  thinkingLevel?: ThinkingLevel;
  requestDedupeKey: string;
  context: unknown;
}

export const modelGatewayRequestSchema = z
  .object({
    accountId: entityIdSchema,
    conversationId: entityIdSchema,
    messageId: entityIdSchema,
    selectedModelRef: z.string().min(1),
    approvedFallbackModelRef: z.string().min(1).nullable(),
    thinkingLevel: thinkingLevelSchema.optional(),
    requestDedupeKey: z.string().min(8).max(240),
    requirements: modelRequirementSchema,
    context: z.unknown(),
  })
  .strict();

export const modelGatewayToolCallSchema = z
  .object({
    id: z.string().min(1).max(240),
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export const modelGatewayResponseSchema = z
  .object({
    text: z.string(),
    toolCalls: z.array(modelGatewayToolCallSchema).max(128).optional(),
    effectiveModelRef: z.string().min(1),
    fallbackReason: z.string().min(1).nullable(),
    finishReason: z.string().min(1).max(80).nullable().optional(),
    usage: usageRecordSchema,
  })
  .strict();

export const modelGatewayStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("delta"),
      delta: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("completed"),
      response: modelGatewayResponseSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      errorCode: z.string().min(1).max(500),
    })
    .strict(),
]);

export type ModelGatewayRequestDto = z.infer<typeof modelGatewayRequestSchema>;
export type ModelGatewayToolCall = z.infer<typeof modelGatewayToolCallSchema>;
export type ModelGatewayResponse = z.infer<typeof modelGatewayResponseSchema>;
export type ModelGatewayStreamEvent = z.infer<typeof modelGatewayStreamEventSchema>;

export const usageQueryInputSchema = z
  .object({
    conversationId: entityIdSchema.optional(),
    messageId: entityIdSchema.optional(),
  })
  .strict();

export const automaticModelRef = "platform/auto" as const;

export interface ModelUsageBridge {
  listModels(): Promise<ModelCatalogEntry[]>;
  getUsage(input?: z.input<typeof usageQueryInputSchema>): Promise<ModelUsageAggregate>;
  getUsageRecords(input?: z.input<typeof usageQueryInputSchema>): Promise<ModelUsageRecord[]>;
}
