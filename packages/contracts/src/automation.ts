import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";
import { defaultThinkingLevel, thinkingLevelSchema } from "./model";

export const automationKindSchema = z.enum(["heartbeat", "standalone"]);
export const automationStatusSchema = z.enum(["active", "paused", "disabled_by_system", "deleted"]);
export const automationScheduleSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("once"),
      expression: timestampSchema,
      timezone: z.string().trim().min(1).max(120),
      startAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("rrule"),
      expression: z.string().trim().min(1).max(500),
      timezone: z.string().trim().min(1).max(120),
      startAt: timestampSchema,
    })
    .strict(),
]);

export const automationDefinitionSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(100_000),
    kind: automationKindSchema,
    status: automationStatusSchema,
    schedule: automationScheduleSchema,
    target: z
      .object({
        conversationId: entityIdSchema.nullable(),
        branchId: entityIdSchema.nullable(),
        workspaceGrantIds: z.array(entityIdSchema).max(100),
      })
      .strict(),
    execution: z
      .object({
        modelRef: z.string().regex(/^platform\/[a-z0-9][a-z0-9._-]*$/),
        thinkingLevel: thinkingLevelSchema.default(defaultThinkingLevel),
        skillInstallationId: entityIdSchema.nullable(),
        maxConcurrentRuns: z.literal(1),
        catchUpPolicy: z.enum(["skip", "latest_once"]),
        retryPolicy: z.enum(["transient_3", "none"]),
      })
      .strict(),
    nextRunAt: timestampSchema.nullable(),
    lastRunAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const automationRunStatusSchema = z.enum([
  "scheduled",
  "claimed",
  "starting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "missed",
  "needs_attention",
  "interrupted",
  "retry_scheduled",
  "skipped_overlap",
]);

export const automationRunSchema = z
  .object({
    id: entityIdSchema,
    automationId: entityIdSchema,
    scheduledFor: timestampSchema,
    trigger: z.enum(["schedule", "manual", "catch_up", "retry"]),
    status: automationRunStatusSchema,
    conversationId: entityIdSchema.nullable(),
    branchId: entityIdSchema.nullable(),
    assistantMessageId: entityIdSchema.nullable(),
    generationId: entityIdSchema.nullable(),
    executionRunId: entityIdSchema.nullable(),
    attempt: z.number().int().positive(),
    claimedByHostId: z.string().min(1).nullable(),
    leaseExpiresAt: timestampSchema.nullable(),
    promptSnapshot: z.string().min(1).max(100_000),
    configSnapshot: z.record(z.string(), z.unknown()),
    failureCode: z.string().min(1).nullable(),
    actionRequired: z.boolean(),
    createdAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable(),
  })
  .strict();

export const automationCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(100_000),
    kind: automationKindSchema,
    schedule: automationScheduleSchema,
    target: automationDefinitionSchema.shape.target.optional(),
    execution: automationDefinitionSchema.shape.execution.partial().optional(),
  })
  .strict();

export const automationUpdateInputSchema = z
  .object({
    automationId: entityIdSchema,
    revision: z.number().int().positive(),
    changes: z
      .object({
        name: automationCreateInputSchema.shape.name.optional(),
        prompt: automationCreateInputSchema.shape.prompt.optional(),
        kind: automationKindSchema.optional(),
        schedule: automationScheduleSchema.optional(),
        target: automationDefinitionSchema.shape.target.partial().optional(),
        execution: automationDefinitionSchema.shape.execution.partial().optional(),
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0, "AUTOMATION_UPDATE_EMPTY"),
  })
  .strict();

export const automationSchedulePreviewInputSchema = z
  .object({
    schedule: automationScheduleSchema,
    count: z.number().int().min(1).max(20).default(5),
    after: timestampSchema.optional(),
  })
  .strict();

export const automationSchedulePreviewSchema = z
  .object({ occurrences: z.array(timestampSchema).max(20) })
  .strict();

export const automationListInputSchema = z
  .object({ includeDeleted: z.boolean().optional() })
  .strict();
export const automationGetInputSchema = z.object({ automationId: entityIdSchema }).strict();
export const automationSetStatusInputSchema = z
  .object({ automationId: entityIdSchema, revision: z.number().int().positive() })
  .strict();
export const automationRunNowInputSchema = z.object({ automationId: entityIdSchema }).strict();
export const automationRunsListInputSchema = z
  .object({ automationId: entityIdSchema, limit: z.number().int().min(1).max(200).default(50) })
  .strict();

export const automationCommandEnvelopeSchema = z.discriminatedUnion("command", [
  z
    .object({ command: z.literal("automation.create"), input: automationCreateInputSchema })
    .strict(),
  z.object({ command: z.literal("automation.list"), input: automationListInputSchema }).strict(),
  z.object({ command: z.literal("automation.get"), input: automationGetInputSchema }).strict(),
  z
    .object({ command: z.literal("automation.update"), input: automationUpdateInputSchema })
    .strict(),
  z
    .object({ command: z.literal("automation.pause"), input: automationSetStatusInputSchema })
    .strict(),
  z
    .object({ command: z.literal("automation.resume"), input: automationSetStatusInputSchema })
    .strict(),
  z
    .object({ command: z.literal("automation.delete"), input: automationSetStatusInputSchema })
    .strict(),
  z
    .object({ command: z.literal("automation.runNow"), input: automationRunNowInputSchema })
    .strict(),
  z
    .object({ command: z.literal("automation.runs.list"), input: automationRunsListInputSchema })
    .strict(),
  z
    .object({
      command: z.literal("automation.schedule.preview"),
      input: automationSchedulePreviewInputSchema,
    })
    .strict(),
]);

export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type AutomationCreateInput = z.infer<typeof automationCreateInputSchema>;
export type AutomationUpdateInput = z.infer<typeof automationUpdateInputSchema>;
export type AutomationSchedulePreviewInput = z.input<typeof automationSchedulePreviewInputSchema>;
export type AutomationSchedulePreview = z.infer<typeof automationSchedulePreviewSchema>;
export type AutomationCommandEnvelope = z.infer<typeof automationCommandEnvelopeSchema>;

export interface AutomationBridge {
  createAutomation(input: AutomationCreateInput): Promise<AutomationDefinition>;
  listAutomations(
    input?: z.input<typeof automationListInputSchema>,
  ): Promise<AutomationDefinition[]>;
  getAutomation(input: z.input<typeof automationGetInputSchema>): Promise<AutomationDefinition>;
  updateAutomation(input: AutomationUpdateInput): Promise<AutomationDefinition>;
  pauseAutomation(
    input: z.input<typeof automationSetStatusInputSchema>,
  ): Promise<AutomationDefinition>;
  resumeAutomation(
    input: z.input<typeof automationSetStatusInputSchema>,
  ): Promise<AutomationDefinition>;
  deleteAutomation(
    input: z.input<typeof automationSetStatusInputSchema>,
  ): Promise<AutomationDefinition>;
  runAutomationNow(input: z.input<typeof automationRunNowInputSchema>): Promise<AutomationRun>;
  listAutomationRuns(
    input: z.input<typeof automationRunsListInputSchema>,
  ): Promise<AutomationRun[]>;
  previewAutomationSchedule(
    input: z.input<typeof automationSchedulePreviewInputSchema>,
  ): Promise<AutomationSchedulePreview>;
  onAutomationRun(listener: (run: AutomationRun) => void): () => void;
  onAutomationNavigate(listener: (automationId: string) => void): () => void;
}

export function parseAutomationCommandResult(
  command: AutomationCommandEnvelope["command"],
  value: unknown,
):
  | AutomationDefinition
  | AutomationDefinition[]
  | AutomationRun
  | AutomationRun[]
  | AutomationSchedulePreview {
  switch (command) {
    case "automation.create":
    case "automation.get":
    case "automation.update":
    case "automation.pause":
    case "automation.resume":
    case "automation.delete":
      return automationDefinitionSchema.parse(value);
    case "automation.list":
      return z.array(automationDefinitionSchema).parse(value);
    case "automation.runNow":
      return automationRunSchema.parse(value);
    case "automation.runs.list":
      return z.array(automationRunSchema).parse(value);
    case "automation.schedule.preview":
      return automationSchedulePreviewSchema.parse(value);
  }
}
