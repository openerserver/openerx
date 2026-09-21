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
    proposalMemoryId: entityIdSchema.nullable(),
    proposalRevision: z.number().int().positive().nullable(),
    proposedContent: z.string().trim().min(1).max(2_000),
    proposedRetrievalKeys: z.array(z.string().trim().min(1).max(120)).max(20),
    proposedConflictKey: memoryConflictKeySchema.nullable(),
    confidence: z.number().min(0).max(1),
    sourceConversationId: entityIdSchema.nullable(),
    sourceMessageId: entityIdSchema.nullable(),
    status: memoryMergeReviewStatusSchema,
    resultMemoryId: entityIdSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((review, context) => {
    if ((review.proposalMemoryId === null) !== (review.proposalRevision === null)) {
      context.addIssue({
        code: "custom",
        path: ["proposalRevision"],
        message: "Proposal memory ID and revision must both be present or both be null",
      });
    }
    if (review.proposalMemoryId === null && review.sourceConversationId === null) {
      context.addIssue({
        code: "custom",
        path: ["sourceConversationId"],
        message: "A new-candidate review must retain its source conversation",
      });
    }
  });

export const memorySemanticClusterProposalSchema = z
  .object({
    relation: memorySemanticRelationSchema.exclude(["none"]),
    leftMemoryId: entityIdSchema,
    rightMemoryId: entityIdSchema,
    confidence: z.number().min(0.85).max(1),
  })
  .strict()
  .refine((proposal) => proposal.leftMemoryId !== proposal.rightMemoryId, {
    message: "A semantic cluster proposal must reference two different memories",
  });

export const memorySemanticClusterOutputSchema = z
  .object({ proposals: z.array(memorySemanticClusterProposalSchema).max(20) })
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

const automaticMemoryDoNotStorePatterns: readonly RegExp[] = [
  /(?:不要|别|请勿|无需|不用)(?:把|将)?[^。！？\n]{0,32}(?:记住|记录|保存|存储|写入(?:长期)?记忆)/u,
  /\b(?:do not|don't|never)\s+(?:remember|record|save|store)\b/iu,
];

const automaticMemoryDenialPatterns: readonly RegExp[] = [
  /(?:这|那|它|上述|以上)?(?:不|并不)(?:是|属于)?(?:我的|关于我的)[^。！？\n]{0,24}(?:偏好|习惯|资料|信息|事实|经历|流程|工作流|内容|说法)/u,
  /\b(?:(?:that|this|it)\s+)?(?:is not|isn't|was not|wasn't)\s+(?:my|about me)\b/iu,
  /\bnot\s+(?:my|about me)\s+(?:preference|profile|information|fact|workflow)\b/iu,
];

const automaticMemoryTemporaryPatterns: readonly RegExp[] = [
  /(?:只|仅)(?:用于|处理|适用于|做)?[^。！？\n]{0,12}(?:当前|本次|这次|这一条|这条消息|这一轮)/u,
  /(?:临时|一次性)[^。！？\n]{0,20}(?:请求|任务|处理|翻译|检查|设置|回复)/u,
  /\b(?:only for|just for)\s+(?:this|the current)\s+(?:message|request|turn|task|time)\b/iu,
  /\btemporary\s+(?:request|task|translation|setting|preference)\b/iu,
];

const automaticMemoryQuotedExternalPatterns: readonly RegExp[] = [
  /(?:下面|以下|上面|上述)[^。！？\n]{0,24}(?:网页|文档|邮件|聊天|同事|别人|第三方)[^。！？\n]{0,16}(?:原文|内容|写着|说法|说过|文字|话)/u,
  /\b(?:quoted|pasted|external|third-party)\s+(?:text|content|note|message)\b/iu,
];

const automaticMemoryBackwardReferencePattern =
  /(?:刚才|之前|前面|上面|上一条|前一条|我说的)|\b(?:previous|above|earlier|what i just (?:said|wrote))\b/iu;
const automaticMemoryConversationScopePattern =
  /(?:这次|本次|当前)(?:对话|聊天)|\bthis (?:conversation|chat)\b/iu;

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function isAutomaticMemorySourceIneligible(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  return (
    matchesAny(normalized, automaticMemoryDoNotStorePatterns) ||
    matchesAny(normalized, automaticMemoryDenialPatterns) ||
    matchesAny(normalized, automaticMemoryTemporaryPatterns) ||
    matchesAny(normalized, automaticMemoryQuotedExternalPatterns)
  );
}

export function automaticMemoryBlockedSourceIds(
  messages: readonly { messageId: string; text: string }[],
): Set<string> {
  const blocked = new Set<string>();
  for (const [index, message] of messages.entries()) {
    const normalized = message.text.normalize("NFKC").trim();
    if (isAutomaticMemorySourceIneligible(normalized)) blocked.add(message.messageId);
    if (!matchesAny(normalized, automaticMemoryDoNotStorePatterns)) continue;
    if (automaticMemoryConversationScopePattern.test(normalized)) {
      for (const candidate of messages) blocked.add(candidate.messageId);
      continue;
    }
    if (automaticMemoryBackwardReferencePattern.test(normalized)) {
      const previous = messages[index - 1];
      if (previous) blocked.add(previous.messageId);
    }
  }
  return blocked;
}

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
export type MemorySemanticClusterProposal = z.infer<typeof memorySemanticClusterProposalSchema>;
export type MemorySemanticClusterOutput = z.infer<typeof memorySemanticClusterOutputSchema>;
export type RecalledMemory = z.infer<typeof recalledMemorySchema>;
export type AutomaticMemoryCandidate = z.infer<typeof automaticMemoryCandidateSchema>;
export type AutomaticMemoryExtractionOutput = z.infer<typeof automaticMemoryExtractionOutputSchema>;
export type MemoryExtractionJob = z.infer<typeof memoryExtractionJobSchema>;
export type MemoryExtractionSkipReason = z.infer<typeof memoryExtractionSkipReasonSchema>;
export type MemoryConsolidationReason = z.infer<typeof memoryConsolidationReasonSchema>;
export type MemoryConsolidationRun = z.infer<typeof memoryConsolidationRunSchema>;
export type AutomaticMemoryCreatedEvent = z.infer<typeof automaticMemoryCreatedEventSchema>;
