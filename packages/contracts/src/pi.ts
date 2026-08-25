import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./chat";
import { usageRecordSchema } from "./model";
import { processNonceSchema } from "./process";

export const piHostContractVersion = 1 as const;

export const piHostBootstrapSchema = z
  .object({
    kind: z.literal("pi-host.bootstrap"),
    contractVersion: z.literal(piHostContractVersion),
    nonce: processNonceSchema,
    profileDirectory: z.string().min(1),
  })
  .strict();

export const piHostReadyFrameSchema = z
  .object({
    kind: z.literal("pi-host.ready"),
    contractVersion: z.literal(piHostContractVersion),
    nonce: processNonceSchema,
  })
  .strict();

export const piHistoryMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    text: z.string(),
  })
  .strict();

export const piPromptFrameSchema = z
  .object({
    kind: z.literal("pi.session.prompt"),
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    history: z.array(piHistoryMessageSchema).min(1),
    platform: z
      .object({
        accountId: entityIdSchema,
        accessToken: z.string().min(32),
        platformBaseUrl: z.url(),
        selectedModelRef: z.string().min(1),
        approvedFallbackModelRef: z.string().min(1).nullable(),
        requestDedupeKey: z.string().min(8).max(240),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.history.at(-1)?.role !== "user") {
      context.addIssue({
        code: "custom",
        message: "Pi prompt history must end with a user message",
        path: ["history"],
      });
    }
  });

export const piAbortFrameSchema = z
  .object({
    kind: z.literal("pi.session.abort"),
    generationId: entityIdSchema,
  })
  .strict();

export const piHostRequestFrameSchema = z.union([piPromptFrameSchema, piAbortFrameSchema]);

export const piHostEventFrameSchema = z
  .object({
    kind: z.literal("pi.product-event"),
    generationId: entityIdSchema,
    eventId: entityIdSchema,
    sequence: z.number().int().positive(),
    occurredAt: timestampSchema,
    type: z.enum(["delta", "completed", "stopped", "failed"]),
    delta: z.string().optional(),
    errorCode: z.string().min(1).optional(),
    usage: usageRecordSchema.optional(),
  })
  .strict();

export const piHostPortFrameSchema = z.union([
  piHostReadyFrameSchema,
  piHostRequestFrameSchema,
  piHostEventFrameSchema,
]);

export type PiHistoryMessage = z.infer<typeof piHistoryMessageSchema>;
export type PiPromptFrame = z.infer<typeof piPromptFrameSchema>;
export type PiHostEventFrame = z.infer<typeof piHostEventFrameSchema>;
