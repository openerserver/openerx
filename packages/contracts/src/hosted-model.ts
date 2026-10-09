import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";
import { modelCatalogEntrySchema, usageAggregateSchema, usageRecordSchema } from "./model";

export const modelAuthorizationSchema = z
  .object({
    accountId: entityIdSchema,
    accessToken: z.string().min(32).max(512),
    accessTokenExpiresAt: timestampSchema,
    platformBaseUrl: z.url(),
    modelApiVersion: z.literal("v3").optional(),
  })
  .strict();

export const modelAuthorizationRequestSchema = z
  .object({
    kind: z.literal("model.authorization.request"),
    requestId: z.uuid(),
    accountId: entityIdSchema,
    rejectedAccessToken: z.string().min(32).max(512).optional(),
  })
  .strict();

export const modelAuthorizationResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("model.authorization.response"),
      requestId: z.uuid(),
      ok: z.literal(true),
      authorization: modelAuthorizationSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("model.authorization.response"),
      requestId: z.uuid(),
      ok: z.literal(false),
      errorCode: z.string().min(1).max(120),
    })
    .strict(),
]);

export const hostedModelCatalogSchema = z
  .object({
    defaultModelRef: z.string().nullable(),
    catalogVersion: z.string().min(1),
    models: modelCatalogEntrySchema.array().max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.models.map((model) => model.modelRef)).size === value.models.length &&
      (value.defaultModelRef === null ||
        value.models.some(
          (model) => model.modelRef === value.defaultModelRef && model.status === "available",
        )),
    "Invalid hosted model default or duplicate model",
  );

export const hostedModelUsageSchema = z
  .object({
    period: z.string(),
    resetAt: timestampSchema,
    limitTokens: z.number().int().nonnegative(),
    usedTokens: z.number().int().nonnegative(),
    reservedTokens: z.number().int().nonnegative(),
    remainingTokens: z.number().int().nonnegative(),
    records: usageRecordSchema.array().max(500),
    recordsTruncated: z.boolean(),
    aggregate: usageAggregateSchema,
  })
  .strict();

export type HostedModelUsage = z.infer<typeof hostedModelUsageSchema>;

export type ModelAuthorization = z.infer<typeof modelAuthorizationSchema>;
export type ModelAuthorizationRequest = z.infer<typeof modelAuthorizationRequestSchema>;
export type ModelAuthorizationResponse = z.infer<typeof modelAuthorizationResponseSchema>;

/** Compiled distributor integration, never exposed to the renderer or a model tool. */
export interface HostedModelAccountProvider {
  accountId(): string | null;
  authorize(
    accountId: string,
    signal: AbortSignal,
    rejectedAccessToken?: string,
  ): Promise<ModelAuthorization>;
}

export const modelAccountChangedSchema = z
  .object({ kind: z.literal("model.account.changed"), accountId: entityIdSchema.nullable() })
  .strict();
