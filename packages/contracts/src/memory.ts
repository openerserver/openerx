import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const memoryKindSchema = z.enum(["profile", "preference", "workflow", "ongoing_context"]);

export const memoryOriginSchema = z.enum(["explicit", "automatic", "consolidated"]);
export const memoryStatusSchema = z.enum(["active", "superseded", "deleted"]);

export const memoryEntrySchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    scope: z.literal("personal"),
    kind: memoryKindSchema,
    content: z.string().trim().min(1).max(2_000),
    retrievalKeys: z.array(z.string().trim().min(1).max(120)).max(50),
    canonicalKey: z.string().trim().min(1).max(240).nullable(),
    origin: memoryOriginSchema,
    confidence: z.number().min(0).max(1),
    status: memoryStatusSchema,
    sourceConversationId: entityIdSchema.nullable(),
    sourceMessageId: entityIdSchema.nullable(),
    supersedesMemoryId: entityIdSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const memorySettingsSchema = z
  .object({
    ownerProfileId: z.string().min(1),
    memoriesEnabled: z.boolean(),
    useMemories: z.boolean(),
    generateMemories: z.boolean(),
    syncMemories: z.boolean(),
    disableOnExternalContext: z.boolean().default(true),
    idleDelayMinutes: z.number().int().min(1).max(1_440).default(30),
    minRateLimitRemainingPercent: z.number().int().min(0).max(100).default(20),
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const memorySettingsUpdateInputSchema = z
  .object({
    memoriesEnabled: z.boolean().optional(),
    useMemories: z.boolean().optional(),
    generateMemories: z.boolean().optional(),
    syncMemories: z.boolean().optional(),
    disableOnExternalContext: z.boolean().optional(),
    idleDelayMinutes: z.number().int().min(1).max(1_440).optional(),
    minRateLimitRemainingPercent: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "At least one memory setting is required",
  });

export const conversationMemorySettingsSchema = z
  .object({
    conversationId: entityIdSchema,
    ownerProfileId: z.string().min(1),
    useMemories: z.boolean().nullable(),
    generateMemories: z.boolean().nullable(),
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const conversationMemorySettingsGetInputSchema = z
  .object({ conversationId: entityIdSchema })
  .strict();

export const conversationMemorySettingsUpdateInputSchema = z
  .object({
    conversationId: entityIdSchema,
    useMemories: z.boolean().nullable().optional(),
    generateMemories: z.boolean().nullable().optional(),
  })
  .strict()
  .refine((input) => input.useMemories !== undefined || input.generateMemories !== undefined, {
    message: "At least one conversation memory setting is required",
  });

export const memoryListInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500).optional(),
    kind: memoryKindSchema.optional(),
    status: memoryStatusSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const memoryUpsertInputSchema = z
  .object({
    id: entityIdSchema.optional(),
    kind: memoryKindSchema,
    content: z.string().trim().min(1).max(2_000),
    retrievalKeys: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    canonicalKey: z.string().trim().min(1).max(240).nullable().optional(),
    sourceConversationId: entityIdSchema.nullable().optional(),
    sourceMessageId: entityIdSchema.nullable().optional(),
    expiresAt: timestampSchema.nullable().optional(),
    idempotencyKey: z.string().min(8).max(240),
  })
  .strict();

export const memoryDeleteInputSchema = z
  .object({
    memoryId: entityIdSchema,
    idempotencyKey: z.string().min(8).max(240),
  })
  .strict();

export const memoryClearInputSchema = z
  .object({
    kind: memoryKindSchema.optional(),
    idempotencyKey: z.string().min(8).max(240),
  })
  .strict();

export const memoryClearResultSchema = z
  .object({
    deleted: z.number().int().nonnegative(),
    clearedAt: timestampSchema,
  })
  .strict();

export const automaticMemoryCandidateSchema = z
  .object({
    kind: memoryKindSchema,
    content: z.string().trim().min(1).max(500),
    retrievalKeys: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    confidence: z.number().min(0).max(1),
    sourceMessageId: entityIdSchema,
  })
  .strict();

export const automaticMemoryExtractionOutputSchema = z
  .object({ candidates: z.array(automaticMemoryCandidateSchema).max(8) })
  .strict();

export const memoryExtractionJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
]);

export const memoryExtractionSkipReasonSchema = z.enum([
  "memory_disabled",
  "generation_disabled",
  "conversation_disabled",
  "conversation_deleted",
  "conversation_active",
  "conversation_too_short",
  "external_context",
  "rate_limit_low",
  "execution_context_unavailable",
]);

export const memoryExtractionJobSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    conversationId: entityIdSchema,
    sourceAssistantMessageId: entityIdSchema,
    status: memoryExtractionJobStatusSchema,
    eligibleAt: timestampSchema,
    attempt: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    skipReason: memoryExtractionSkipReasonSchema.nullable(),
    lastErrorCode: z.string().min(1).max(200).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict();

export const recalledMemorySchema = z
  .object({
    id: entityIdSchema,
    kind: memoryKindSchema,
    content: z.string().min(1).max(2_000),
    score: z.number().min(0).max(1),
    updatedAt: timestampSchema,
  })
  .strict();

export type MemoryKind = z.infer<typeof memoryKindSchema>;
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
export type MemorySettingsUpdateInput = z.infer<typeof memorySettingsUpdateInputSchema>;
export type ConversationMemorySettings = z.infer<typeof conversationMemorySettingsSchema>;
export type ConversationMemorySettingsUpdateInput = z.infer<
  typeof conversationMemorySettingsUpdateInputSchema
>;
export type MemoryListInput = z.infer<typeof memoryListInputSchema>;
export type MemoryUpsertInput = z.infer<typeof memoryUpsertInputSchema>;
export type MemoryDeleteInput = z.infer<typeof memoryDeleteInputSchema>;
export type MemoryClearResult = z.infer<typeof memoryClearResultSchema>;
export type RecalledMemory = z.infer<typeof recalledMemorySchema>;
export type AutomaticMemoryCandidate = z.infer<typeof automaticMemoryCandidateSchema>;
export type AutomaticMemoryExtractionOutput = z.infer<typeof automaticMemoryExtractionOutputSchema>;
export type MemoryExtractionJob = z.infer<typeof memoryExtractionJobSchema>;
export type MemoryExtractionSkipReason = z.infer<typeof memoryExtractionSkipReasonSchema>;
