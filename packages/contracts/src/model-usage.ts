import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";
import { nullableTokenCountSchema, usageAggregateSchema, usageRecordSchema } from "./model";
import { modelFailureSchema } from "./model-error";

/** Local observations only. This schema is deliberately rejected by the platform billing schema. */
export const byokUsageRecordSchema = usageRecordSchema
  .extend({
    source: z.literal("byok"),
    accountId: z.null(),
    conversationId: entityIdSchema.nullable(),
    messageId: entityIdSchema.nullable(),
    operation: z.enum(["chat", "memory_extraction", "memory_clustering"]),
    operationId: entityIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    failure: modelFailureSchema.nullable(),
    promptTokens: nullableTokenCountSchema,
    startedAt: timestampSchema,
  })
  .strict();
export type ByokUsageRecord = z.infer<typeof byokUsageRecordSchema>;
export const modelUsageRecordSchema = z.union([usageRecordSchema, byokUsageRecordSchema]);
export type ModelUsageRecord = z.infer<typeof modelUsageRecordSchema>;
export const modelUsageAggregateSchema = z.union([
  usageAggregateSchema,
  usageAggregateSchema.extend({ accountId: z.null(), source: z.literal("byok") }).strict(),
]);
export type ModelUsageAggregate = z.infer<typeof modelUsageAggregateSchema>;
export const byokUsageQueryResultSchema = z
  .object({
    selectedModelRef: z.string().nullable(),
    records: z.array(byokUsageRecordSchema),
  })
  .strict();

export function aggregateByokUsage(
  records: ByokUsageRecord[],
  query: { conversationId?: string; messageId?: string } = {},
): ModelUsageAggregate {
  const field = (
    name: "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "totalTokens",
  ) => ({
    known: records.reduce((total, record) => total + (record[name] ?? 0), 0),
    unknownRecords: records.filter((record) => record[name] === null).length,
  });
  return {
    source: "byok",
    accountId: null,
    conversationId: query.conversationId ?? null,
    messageId: query.messageId ?? null,
    records: records.length,
    inputTokens: field("inputTokens"),
    cachedInputTokens: field("cachedInputTokens"),
    outputTokens: field("outputTokens"),
    reasoningTokens: field("reasoningTokens"),
    totalTokens: field("totalTokens"),
  };
}
