import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const memoryKindSchema = z.enum(["profile", "preference", "workflow", "ongoing_context"]);

export const memoryOriginSchema = z.enum(["explicit", "automatic", "consolidated"]);
export const memoryStatusSchema = z.enum(["active", "superseded", "deleted"]);
export const memoryConflictKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u);

export const memoryEntrySchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    scope: z.literal("personal"),
    kind: memoryKindSchema,
    content: z.string().trim().min(1).max(2_000),
    retrievalKeys: z.array(z.string().trim().min(1).max(120)).max(50),
    canonicalKey: z.string().trim().min(1).max(240).nullable(),
    conflictKey: memoryConflictKeySchema.nullable().default(null),
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
    conflictKey: memoryConflictKeySchema.nullable().optional(),
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

export const memorySourcesListInputSchema = z.object({ memoryId: entityIdSchema }).strict();

export const memorySourceLinkSchema = z
  .object({
    memoryId: entityIdSchema,
    ownerProfileId: z.string().min(1),
    conversationId: entityIdSchema,
    messageId: entityIdSchema.nullable(),
    origin: memoryOriginSchema,
    confidence: z.number().min(0).max(1),
    conversationTitle: z.string().min(1).max(500).nullable(),
    conversationDeletedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const memorySemanticRelationSchema = z.enum(["none", "duplicate", "conflict"]);

export const memoryMergeReviewStatusSchema = z.enum(["pending", "accepted", "dismissed"]);

export const memoryMergeReviewSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    kind: memoryKindSchema,
    relation: memorySemanticRelationSchema.exclude(["none"]),
    targetMemoryId: entityIdSchema,
    targetContent: z.string().trim().min(1).max(2_000),
    targetRevision: z.number().int().positive(),
    proposedContent: z.string().trim().min(1).max(500),
    proposedRetrievalKeys: z.array(z.string().trim().min(1).max(120)).max(20),
    proposedConflictKey: memoryConflictKeySchema.nullable(),
    confidence: z.number().min(0).max(1),
    sourceConversationId: entityIdSchema,
    sourceMessageId: entityIdSchema,
    status: memoryMergeReviewStatusSchema,
    resultMemoryId: entityIdSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict();

export const memoryMergeReviewListInputSchema = z
  .object({
    status: memoryMergeReviewStatusSchema.optional().default("pending"),
    limit: z.number().int().min(1).max(100).optional().default(50),
  })
  .strict();

export const memoryMergeReviewResolveInputSchema = z
  .object({
    reviewId: entityIdSchema,
    resolution: z.enum(["accept", "dismiss"]),
    idempotencyKey: z.string().min(8).max(240),
  })
  .strict();

export const automaticMemoryCandidateSchema = z
  .object({
    kind: memoryKindSchema,
    content: z.string().trim().min(1).max(500),
    retrievalKeys: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    conflictKey: memoryConflictKeySchema.nullable().default(null),
    confidence: z.number().min(0).max(1),
    sourceMessageId: entityIdSchema,
    semanticRelation: memorySemanticRelationSchema.optional(),
    relatedMemoryId: entityIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((candidate, context) => {
    const relation = candidate.semanticRelation ?? "none";
    if (relation === "none" && candidate.relatedMemoryId) {
      context.addIssue({
        code: "custom",
        path: ["relatedMemoryId"],
        message: "Unrelated memory candidates cannot reference an existing memory",
      });
    }
    if (relation !== "none" && !candidate.relatedMemoryId) {
      context.addIssue({
        code: "custom",
        path: ["relatedMemoryId"],
        message: "Related memory candidates must reference an existing memory",
      });
    }
  });

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

export const memoryConsolidationReasonSchema = z.enum(["daily", "active_limit"]);
export const memoryConsolidationRunStatusSchema = z.enum(["running", "completed", "failed"]);

export const memoryConsolidationRunSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    reason: memoryConsolidationReasonSchema,
    status: memoryConsolidationRunStatusSchema,
    activeCount: z.number().int().nonnegative(),
    expiredCount: z.number().int().nonnegative(),
    repairedCount: z.number().int().nonnegative(),
    lastErrorCode: z.string().min(1).max(200).nullable(),
    startedAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict();

export const automaticMemoryCreatedEventSchema = z
  .object({
    eventId: entityIdSchema,
    jobId: entityIdSchema,
    conversationId: entityIdSchema,
    memories: z.array(memoryEntrySchema).min(1).max(8),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((event, context) => {
    for (const [index, memory] of event.memories.entries()) {
      if (memory.origin !== "automatic" || memory.status !== "active") {
        context.addIssue({
          code: "custom",
          path: ["memories", index],
          message: "Created-memory events may contain only active automatic memories",
        });
      }
      if (memory.sourceConversationId !== event.conversationId) {
        context.addIssue({
          code: "custom",
          path: ["memories", index, "sourceConversationId"],
          message: "Created-memory event source conversation mismatch",
        });
      }
    }
  });

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
export type MemorySourceLink = z.infer<typeof memorySourceLinkSchema>;
export type MemorySemanticRelation = z.infer<typeof memorySemanticRelationSchema>;
export type MemoryMergeReview = z.infer<typeof memoryMergeReviewSchema>;
export type MemoryMergeReviewStatus = z.infer<typeof memoryMergeReviewStatusSchema>;
export type MemoryMergeReviewListInput = z.infer<typeof memoryMergeReviewListInputSchema>;
export type MemoryMergeReviewResolveInput = z.infer<typeof memoryMergeReviewResolveInputSchema>;
export type RecalledMemory = z.infer<typeof recalledMemorySchema>;
export type AutomaticMemoryCandidate = z.infer<typeof automaticMemoryCandidateSchema>;
export type AutomaticMemoryExtractionOutput = z.infer<typeof automaticMemoryExtractionOutputSchema>;
export type MemoryExtractionJob = z.infer<typeof memoryExtractionJobSchema>;
export type MemoryExtractionSkipReason = z.infer<typeof memoryExtractionSkipReasonSchema>;
export type MemoryConsolidationReason = z.infer<typeof memoryConsolidationReasonSchema>;
export type MemoryConsolidationRun = z.infer<typeof memoryConsolidationRunSchema>;
export type AutomaticMemoryCreatedEvent = z.infer<typeof automaticMemoryCreatedEventSchema>;
