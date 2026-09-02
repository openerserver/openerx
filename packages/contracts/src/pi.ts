import { z } from "zod";
import { brokeredBashExecutionContextSchema } from "./brokered-bash";
import { entityIdSchema, timestampSchema } from "./chat";
import { supportedFileFormatSchema } from "./file";
import {
  automaticMemoryExtractionOutputSchema,
  memorySemanticClusterOutputSchema,
  recalledMemorySchema,
} from "./memory";
import { thinkingLevelSchema, usageRecordSchema } from "./model";
import { processNonceSchema } from "./process";
import { piSkillMountSchema } from "./skill";
import {
  mcpToolDescriptorSchema,
  piActivityEventSchema,
  piFileToolOperationSchema,
  piToolCancelFrameSchema,
  piToolProgressFrameSchema,
  piToolRequestFrameSchema,
  piToolResponseFrameSchema,
} from "./tool";
import { workspaceInstructionSourceSchema } from "./workspace";

export const piHostContractVersion = 10 as const;

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
    messageId: entityIdSchema.optional(),
    role: z.enum(["user", "assistant", "system"]),
    text: z.string(),
    images: z
      .array(z.lazy(() => piImageInputSchema))
      .max(100)
      .optional(),
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
    branchId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    thinkingLevel: thinkingLevelSchema.optional(),
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
    selectedSkillInstallationId: entityIdSchema.optional(),
    workspace: z
      .object({
        grants: z
          .array(
            z
              .object({
                id: entityIdSchema,
                displayName: z.string().min(1).max(240),
                access: z.enum(["read_only", "read_write"]),
                allowNetwork: z.boolean(),
                expiresAt: timestampSchema.nullable(),
              })
              .strict(),
          )
          .max(100),
        instructionSources: z.array(workspaceInstructionSourceSchema).max(500),
        execution: brokeredBashExecutionContextSchema.optional(),
      })
      .strict()
      .optional(),
    mcpTools: z.array(mcpToolDescriptorSchema).max(2_000).optional(),
    initialToolNames: z.array(z.string().min(1).max(200)).max(1_000).optional(),
    availableToolNames: z.array(z.string().min(1).max(200)).max(2_000).optional(),
    memoryEnabled: z.boolean().optional(),
    memories: z.array(recalledMemorySchema).max(8).optional(),
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
    byok: z
      .object({
        apiKey: z.string().min(1).max(20_000),
        baseUrl: z.url(),
        modelId: z.string().min(1).max(200),
        displayName: z.string().min(1).max(120),
        contextWindow: z.number().int().positive(),
        maxOutputTokens: z.number().int().positive(),
        capabilities: z
          .object({
            imageInput: z.boolean(),
            functionCalling: z.boolean(),
            reasoning: z.boolean(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.platform && frame.byok) {
      context.addIssue({ code: "custom", message: "Platform and BYOK are mutually exclusive" });
    }
    if (frame.history.at(-1)?.role !== "user") {
      context.addIssue({
        code: "custom",
        message: "Pi prompt history must end with a user message",
        path: ["history"],
      });
    }
    const workspace = frame.workspace;
    const execution = workspace?.execution;
    if (!workspace || !execution) return;
    const grants = new Map(workspace.grants.map((grant) => [grant.id, grant]));
    const active = grants.get(execution.activeExecutionGrantId);
    if (!active) {
      context.addIssue({
        code: "custom",
        message: "Active execution grant must be present in the prompt workspace",
        path: ["workspace", "execution", "activeExecutionGrantId"],
      });
    }
    for (const grantId of execution.additionalExecutionGrantIds) {
      if (grants.has(grantId)) continue;
      context.addIssue({
        code: "custom",
        message: "Additional execution grant must be present in the prompt workspace",
        path: ["workspace", "execution", "additionalExecutionGrantIds"],
      });
    }
    if (execution.executionProfile === "workspace_write" && active?.access !== "read_write") {
      context.addIssue({
        code: "custom",
        message: "workspace_write requires a read_write active grant",
        path: ["workspace", "execution", "executionProfile"],
      });
    }
  });

export const piAbortFrameSchema = z
  .object({
    kind: z.literal("pi.session.abort"),
    generationId: entityIdSchema,
  })
  .strict();

const piBackgroundPlatformSchema = z
  .object({
    accountId: entityIdSchema,
    accessToken: z.string().min(32),
    platformBaseUrl: z.url(),
    selectedModelRef: z.string().min(1),
    approvedFallbackModelRef: z.string().min(1).nullable(),
    requestDedupeKey: z.string().min(8).max(240),
  })
  .strict();

const piBackgroundByokSchema = z
  .object({
    apiKey: z.string().min(1).max(20_000),
    baseUrl: z.url(),
    modelId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(120),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    capabilities: z
      .object({
        imageInput: z.boolean(),
        functionCalling: z.boolean(),
        reasoning: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const piMemoryExtractFrameSchema = z
  .object({
    kind: z.literal("pi.memory.extract"),
    requestId: entityIdSchema,
    jobId: entityIdSchema,
    conversationId: entityIdSchema,
    sourceAssistantMessageId: entityIdSchema,
    thinkingLevel: thinkingLevelSchema.optional(),
    messages: z
      .array(
        z
          .object({
            messageId: entityIdSchema,
            text: z.string().trim().min(1).max(100_000),
          })
          .strict(),
      )
      .min(2)
      .max(200),
    existingMemories: z
      .array(
        z
          .object({
            id: entityIdSchema,
            kind: z.enum(["profile", "preference", "workflow", "ongoing_context"]),
            content: z.string().trim().min(1).max(500),
            conflictKey: z.string().trim().min(3).max(120).nullable(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    platform: piBackgroundPlatformSchema.optional(),
    byok: piBackgroundByokSchema.optional(),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.platform && frame.byok) {
      context.addIssue({ code: "custom", message: "Platform and BYOK are mutually exclusive" });
    }
  });

export const piMemoryExtractResultFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("pi.memory.extract-result"),
      requestId: entityIdSchema,
      ok: z.literal(true),
      output: automaticMemoryExtractionOutputSchema,
      usageRecords: z.array(usageRecordSchema).max(128).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pi.memory.extract-result"),
      requestId: entityIdSchema,
      ok: z.literal(false),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    })
    .strict(),
]);

const piMemoryClusterItemSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(["profile", "preference", "workflow", "ongoing_context"]),
    content: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const piMemoryClusterFrameSchema = z
  .object({
    kind: z.literal("pi.memory.cluster"),
    requestId: entityIdSchema,
    runId: entityIdSchema,
    thinkingLevel: thinkingLevelSchema.optional(),
    memories: z.array(piMemoryClusterItemSchema).min(2).max(40),
    platform: piBackgroundPlatformSchema.optional(),
    byok: piBackgroundByokSchema.optional(),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.platform && frame.byok) {
      context.addIssue({ code: "custom", message: "Platform and BYOK are mutually exclusive" });
    }
  });

export const piMemoryClusterResultFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("pi.memory.cluster-result"),
      requestId: entityIdSchema,
      ok: z.literal(true),
      output: memorySemanticClusterOutputSchema,
      usageRecords: z.array(usageRecordSchema).max(128).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pi.memory.cluster-result"),
      requestId: entityIdSchema,
      ok: z.literal(false),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    })
    .strict(),
]);

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

export const piFileToolRequestFrameSchema = z
  .object({
    kind: z.literal("pi.file-tool.request"),
    requestId: entityIdSchema,
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    branchId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    piToolCallId: z.string().min(1).max(500),
    toolName: z.string().min(1).max(200),
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
  piMemoryExtractFrameSchema,
  piMemoryClusterFrameSchema,
  piAbortFrameSchema,
  piSessionControlFrameSchema,
  piFileToolResponseFrameSchema,
  piToolResponseFrameSchema,
  piToolProgressFrameSchema,
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
    startsNewPart: z.boolean().optional(),
    errorCode: z.string().min(1).optional(),
    usageRecords: z.array(usageRecordSchema).max(128).optional(),
  })
  .strict();

export const piHostPortFrameSchema = z.union([
  piHostReadyFrameSchema,
  piHostRequestFrameSchema,
  piHostEventFrameSchema,
  piMemoryExtractResultFrameSchema,
  piMemoryClusterResultFrameSchema,
  piSessionControlResultFrameSchema,
  piFileToolRequestFrameSchema,
  piFileToolResponseFrameSchema,
  piToolRequestFrameSchema,
  piToolResponseFrameSchema,
  piToolProgressFrameSchema,
  piToolCancelFrameSchema,
  piActivityEventSchema,
]);

export type PiHistoryMessage = z.infer<typeof piHistoryMessageSchema>;
export type PiImageInput = z.infer<typeof piImageInputSchema>;
export type PiPromptFrame = z.infer<typeof piPromptFrameSchema>;
export type PiMemoryExtractFrame = z.infer<typeof piMemoryExtractFrameSchema>;
export type PiMemoryExtractResultFrame = z.infer<typeof piMemoryExtractResultFrameSchema>;
export type PiMemoryClusterFrame = z.infer<typeof piMemoryClusterFrameSchema>;
export type PiMemoryClusterResultFrame = z.infer<typeof piMemoryClusterResultFrameSchema>;
export type PiHostEventFrame = z.infer<typeof piHostEventFrameSchema>;
export type PiSessionControlFrame = z.infer<typeof piSessionControlFrameSchema>;
export type PiSessionControlResultFrame = z.infer<typeof piSessionControlResultFrameSchema>;
export type PiFileToolRequestFrame = z.infer<typeof piFileToolRequestFrameSchema>;
export type PiFileToolResponseFrame = z.infer<typeof piFileToolResponseFrameSchema>;
