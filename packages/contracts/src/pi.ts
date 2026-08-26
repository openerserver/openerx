import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./chat";
import { supportedFileFormatSchema } from "./file";
import { usageRecordSchema } from "./model";
import { processNonceSchema } from "./process";
import { piSkillMountSchema } from "./skill";
import { piActivityEventSchema, piToolRequestFrameSchema, piToolResponseFrameSchema } from "./tool";

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

export const piImageInputSchema = z
  .object({
    personalFileId: entityIdSchema,
    displayName: z.string().trim().min(1),
    data: z.string().min(4).max(44_739_244),
    mimeType: z.enum(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  })
  .strict()
  .superRefine((image, context) => {
    if (image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(image.data)) {
      context.addIssue({
        code: "custom",
        message: "Pi image data must be canonical base64",
        path: ["data"],
      });
    }
  });

export const piPromptFrameSchema = z
  .object({
    kind: z.literal("pi.session.prompt"),
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    history: z.array(piHistoryMessageSchema).min(1),
    files: z
      .array(
        z
          .object({
            personalFileId: entityIdSchema,
            displayName: z.string().min(1),
            format: supportedFileFormatSchema,
          })
          .strict(),
      )
      .optional(),
    images: z.array(piImageInputSchema).max(100).optional(),
    skills: z.array(piSkillMountSchema).max(500).optional(),
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

export const piSessionControlFrameSchema = z
  .object({
    kind: z.literal("pi.session.control"),
    requestId: entityIdSchema,
    generationId: entityIdSchema,
    action: z.enum(["steer", "follow_up", "abort"]),
    text: z.string().trim().min(1).max(100_000).optional(),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.action === "abort" && frame.text !== undefined) {
      context.addIssue({ code: "custom", path: ["text"], message: "Abort has no text" });
    }
    if (frame.action !== "abort" && frame.text === undefined) {
      context.addIssue({ code: "custom", path: ["text"], message: "Control text required" });
    }
  });

export const piSessionControlResultFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("pi.session.control-result"),
      requestId: entityIdSchema,
      ok: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pi.session.control-result"),
      requestId: entityIdSchema,
      ok: z.literal(false),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    })
    .strict(),
]);

const piFileToolOperationSchema = z.discriminatedUnion("operation", [
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
          format: z.enum(["text", "markdown", "code", "json", "yaml", "csv", "html"]),
          mediaType: z.string().min(1).max(200),
          content: z.string().max(5_000_000),
        })
        .strict(),
    })
    .strict(),
]);

export const piFileToolRequestFrameSchema = z
  .object({
    kind: z.literal("pi.file-tool.request"),
    requestId: entityIdSchema,
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    request: piFileToolOperationSchema,
  })
  .strict();

export const piFileToolResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("pi.file-tool.response"),
      requestId: entityIdSchema,
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pi.file-tool.response"),
      requestId: entityIdSchema,
      ok: z.literal(false),
      errorCode: z.string().min(1),
    })
    .strict(),
]);

export const piHostRequestFrameSchema = z.union([
  piPromptFrameSchema,
  piAbortFrameSchema,
  piSessionControlFrameSchema,
  piFileToolResponseFrameSchema,
  piToolResponseFrameSchema,
]);

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
  piSessionControlResultFrameSchema,
  piFileToolRequestFrameSchema,
  piFileToolResponseFrameSchema,
  piToolRequestFrameSchema,
  piToolResponseFrameSchema,
  piActivityEventSchema,
]);

export type PiHistoryMessage = z.infer<typeof piHistoryMessageSchema>;
export type PiImageInput = z.infer<typeof piImageInputSchema>;
export type PiPromptFrame = z.infer<typeof piPromptFrameSchema>;
export type PiHostEventFrame = z.infer<typeof piHostEventFrameSchema>;
export type PiSessionControlFrame = z.infer<typeof piSessionControlFrameSchema>;
export type PiSessionControlResultFrame = z.infer<typeof piSessionControlResultFrameSchema>;
export type PiFileToolRequestFrame = z.infer<typeof piFileToolRequestFrameSchema>;
export type PiFileToolResponseFrame = z.infer<typeof piFileToolResponseFrameSchema>;
