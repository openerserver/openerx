import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./chat";
import { processNonceSchema } from "./process";

export const runtimeContractVersion = 1 as const;

export const runtimeBootstrapSchema = z
  .object({
    kind: z.literal("runtime.bootstrap"),
    contractVersion: z.literal(runtimeContractVersion),
    nonce: processNonceSchema,
  })
  .strict();

export const runtimeReadyFrameSchema = z
  .object({
    kind: z.literal("runtime.ready"),
    contractVersion: z.literal(runtimeContractVersion),
    nonce: processNonceSchema,
  })
  .strict();

export const runtimeHistoryMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    text: z.string(),
  })
  .strict();

export const runtimeStartFrameSchema = z
  .object({
    kind: z.literal("runtime.start"),
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    history: z.array(runtimeHistoryMessageSchema).min(1),
  })
  .strict();

export const runtimeStopFrameSchema = z
  .object({
    kind: z.literal("runtime.stop"),
    generationId: entityIdSchema,
  })
  .strict();

export const runtimeRequestFrameSchema = z.union([runtimeStartFrameSchema, runtimeStopFrameSchema]);

export const runtimeEventFrameSchema = z
  .object({
    kind: z.literal("runtime.event"),
    generationId: entityIdSchema,
    eventId: entityIdSchema,
    sequence: z.number().int().positive(),
    occurredAt: timestampSchema,
    type: z.enum(["delta", "completed", "stopped", "failed"]),
    delta: z.string().optional(),
    errorCode: z.string().min(1).optional(),
  })
  .strict();

export const runtimePortFrameSchema = z.union([
  runtimeReadyFrameSchema,
  runtimeRequestFrameSchema,
  runtimeEventFrameSchema,
]);

export type RuntimeHistoryMessage = z.infer<typeof runtimeHistoryMessageSchema>;
export type RuntimeStartFrame = z.infer<typeof runtimeStartFrameSchema>;
export type RuntimeEventFrame = z.infer<typeof runtimeEventFrameSchema>;
