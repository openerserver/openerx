import { z } from "zod";
import { type Conversation, conversationSchema } from "./chat";
import { entityIdSchema, timestampSchema } from "./common";

export const projectNameSchema = z.string().trim().min(1).max(80);
export const projectInstructionsSchema = z.string().max(20_000);
export const projectDirectoryRoleSchema = z.enum(["primary", "additional"]);
export const projectDirectoryConnectionStateSchema = z.enum(["connected", "reconnect_required"]);

export const projectSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    name: projectNameSchema,
    instructions: projectInstructionsSchema,
    pinnedRank: z.number().int().nonnegative().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    archivedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const projectDirectorySchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    projectId: entityIdSchema,
    displayName: z.string().trim().min(1).max(240),
    role: projectDirectoryRoleSchema,
    desiredAccess: z.enum(["read_only", "read_write"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const projectSyncPayloadSchema = projectSchema;

export const projectDirectorySyncPayloadSchema = projectDirectorySchema
  .extend({ deletedAt: z.null() })
  .strict();

export const projectDirectoryBindingSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    projectDirectoryId: entityIdSchema,
    deviceId: entityIdSchema,
    workspaceGrantId: entityIdSchema,
    lastValidatedAt: timestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revokedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const projectDirectoryStateSchema = z
  .object({
    directory: projectDirectorySchema,
    binding: projectDirectoryBindingSchema.nullable(),
    connectionState: projectDirectoryConnectionStateSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (state.connectionState === "connected" && state.binding === null) {
      context.addIssue({ code: "custom", message: "Connected directories require a binding" });
    }
    if (state.connectionState === "reconnect_required" && state.binding !== null) {
      context.addIssue({
        code: "custom",
        message: "Reconnect-required directories cannot expose an active binding",
      });
    }
  });

export const projectDetailSchema = z
  .object({
    project: projectSchema,
    directories: z.array(projectDirectoryStateSchema).max(100),
  })
  .strict();

export const projectSummarySchema = projectSchema.extend({
  conversationCount: z.number().int().nonnegative(),
  directoryCount: z.number().int().nonnegative(),
  connectedDirectoryCount: z.number().int().nonnegative(),
  reconnectRequiredCount: z.number().int().nonnegative(),
});

export const projectListInputSchema = z
  .object({ includeArchived: z.boolean().optional() })
  .strict();

export const projectGetInputSchema = z.object({ projectId: entityIdSchema }).strict();

export const projectCreateInputSchema = z
  .object({
    operationId: entityIdSchema,
    name: projectNameSchema,
    instructions: projectInstructionsSchema.default(""),
  })
  .strict();

export const projectUpdateInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectId: entityIdSchema,
    expectedRevision: z.number().int().positive(),
    name: projectNameSchema.optional(),
    instructions: projectInstructionsSchema.optional(),
    pinnedRank: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.instructions !== undefined ||
      input.pinnedRank !== undefined,
    { message: "Project update requires at least one field" },
  );

export const projectArchiveInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectId: entityIdSchema,
    expectedRevision: z.number().int().positive(),
    archived: z.boolean(),
  })
  .strict();

export const projectArchiveCommandInputSchema = projectArchiveInputSchema
  .omit({ archived: true })
  .strict();

export const projectDirectoryCreateInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectId: entityIdSchema,
    expectedProjectRevision: z.number().int().positive(),
    workspaceGrantId: entityIdSchema,
    displayName: z.string().trim().min(1).max(240),
    desiredAccess: z.enum(["read_only", "read_write"]).default("read_write"),
  })
  .strict();

export const projectDirectoryChooseInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectId: entityIdSchema,
    projectDirectoryId: entityIdSchema.nullable().default(null),
    expectedProjectRevision: z.number().int().positive(),
    desiredAccess: z.enum(["read_only", "read_write"]).default("read_write"),
  })
  .strict();

export const projectDirectoryChoosePrivilegedInputSchema = projectDirectoryChooseInputSchema
  .extend({ rootPath: z.string().min(1).max(4_096) })
  .strict();

export const projectDirectoryConnectInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectDirectoryId: entityIdSchema,
    expectedProjectRevision: z.number().int().positive(),
    workspaceGrantId: entityIdSchema,
  })
  .strict();

export const projectDirectorySetPrimaryInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectId: entityIdSchema,
    projectDirectoryId: entityIdSchema,
    expectedProjectRevision: z.number().int().positive(),
  })
  .strict();

export const projectDirectoryDisconnectInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectDirectoryId: entityIdSchema,
    expectedProjectRevision: z.number().int().positive(),
  })
  .strict();

export const projectDirectoryRemoveInputSchema = z
  .object({
    operationId: entityIdSchema,
    projectId: entityIdSchema,
    projectDirectoryId: entityIdSchema,
    replacementPrimaryDirectoryId: entityIdSchema.nullable().default(null),
    expectedProjectRevision: z.number().int().positive(),
  })
  .strict();

export const conversationMoveToProjectInputSchema = z
  .object({
    operationId: entityIdSchema,
    conversationId: entityIdSchema,
    projectId: entityIdSchema.nullable(),
    expectedConversationRevision: z.number().int().positive(),
  })
  .strict();

export const projectCommandEnvelopeSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("project.list"), input: projectListInputSchema }).strict(),
  z.object({ command: z.literal("project.get"), input: projectGetInputSchema }).strict(),
  z.object({ command: z.literal("project.create"), input: projectCreateInputSchema }).strict(),
  z.object({ command: z.literal("project.update"), input: projectUpdateInputSchema }).strict(),
  z
    .object({ command: z.literal("project.archive"), input: projectArchiveCommandInputSchema })
    .strict(),
  z
    .object({ command: z.literal("project.restore"), input: projectArchiveCommandInputSchema })
    .strict(),
  z
    .object({
      command: z.literal("project.directory.choose"),
      input: projectDirectoryChoosePrivilegedInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("project.directory.create"),
      input: projectDirectoryCreateInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("project.directory.connect"),
      input: projectDirectoryConnectInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("project.directory.setPrimary"),
      input: projectDirectorySetPrimaryInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("project.directory.disconnect"),
      input: projectDirectoryDisconnectInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("project.directory.remove"),
      input: projectDirectoryRemoveInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("conversation.moveToProject"),
      input: conversationMoveToProjectInputSchema,
    })
    .strict(),
]);

export type Project = z.infer<typeof projectSchema>;
export type ProjectDirectory = z.infer<typeof projectDirectorySchema>;
export type ProjectSyncPayload = z.infer<typeof projectSyncPayloadSchema>;
export type ProjectDirectorySyncPayload = z.infer<typeof projectDirectorySyncPayloadSchema>;
export type ProjectDirectoryBinding = z.infer<typeof projectDirectoryBindingSchema>;
export type ProjectDirectoryState = z.infer<typeof projectDirectoryStateSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectCreateInput = z.input<typeof projectCreateInputSchema>;
export type ProjectUpdateInput = z.input<typeof projectUpdateInputSchema>;
export type ProjectArchiveInput = z.input<typeof projectArchiveInputSchema>;
export type ProjectDirectoryCreateInput = z.input<typeof projectDirectoryCreateInputSchema>;
export type ProjectDirectoryChooseInput = z.input<typeof projectDirectoryChooseInputSchema>;
export type ProjectDirectoryChoosePrivilegedInput = z.input<
  typeof projectDirectoryChoosePrivilegedInputSchema
>;
export type ProjectDirectoryConnectInput = z.input<typeof projectDirectoryConnectInputSchema>;
export type ProjectDirectorySetPrimaryInput = z.input<typeof projectDirectorySetPrimaryInputSchema>;
export type ProjectDirectoryDisconnectInput = z.input<typeof projectDirectoryDisconnectInputSchema>;
export type ProjectDirectoryRemoveInput = z.input<typeof projectDirectoryRemoveInputSchema>;
export type ConversationMoveToProjectInput = z.input<typeof conversationMoveToProjectInputSchema>;
export type ProjectCommandEnvelope = z.infer<typeof projectCommandEnvelopeSchema>;

export interface ProjectCommandResultMap {
  "project.list": ProjectSummary[];
  "project.get": ProjectDetail;
  "project.create": Project;
  "project.update": Project;
  "project.archive": Project;
  "project.restore": Project;
  "project.directory.choose": ProjectDirectoryState;
  "project.directory.create": ProjectDirectoryState;
  "project.directory.connect": ProjectDirectoryState;
  "project.directory.setPrimary": ProjectDetail;
  "project.directory.disconnect": ProjectDirectoryState;
  "project.directory.remove": ProjectDetail;
  "conversation.moveToProject": Conversation;
}

export function parseProjectCommandResult<C extends keyof ProjectCommandResultMap>(
  command: C,
  value: unknown,
): ProjectCommandResultMap[C] {
  let parsed: unknown;
  switch (command) {
    case "project.list":
      parsed = z.array(projectSummarySchema).parse(value);
      break;
    case "project.get":
    case "project.directory.setPrimary":
    case "project.directory.remove":
      parsed = projectDetailSchema.parse(value);
      break;
    case "project.create":
    case "project.update":
    case "project.archive":
    case "project.restore":
      parsed = projectSchema.parse(value);
      break;
    case "project.directory.choose":
    case "project.directory.create":
    case "project.directory.connect":
    case "project.directory.disconnect":
      parsed = projectDirectoryStateSchema.parse(value);
      break;
    case "conversation.moveToProject":
      parsed = conversationSchema.parse(value);
      break;
  }
  return parsed as ProjectCommandResultMap[C];
}

export interface ProjectBridge {
  listProjects(input?: z.input<typeof projectListInputSchema>): Promise<ProjectSummary[]>;
  getProject(input: z.input<typeof projectGetInputSchema>): Promise<ProjectDetail>;
  createProject(input: z.input<typeof projectCreateInputSchema>): Promise<Project>;
  updateProject(input: z.input<typeof projectUpdateInputSchema>): Promise<Project>;
  archiveProject(input: z.input<typeof projectArchiveCommandInputSchema>): Promise<Project>;
  restoreProject(input: z.input<typeof projectArchiveCommandInputSchema>): Promise<Project>;
  chooseProjectDirectory(
    input: z.input<typeof projectDirectoryChooseInputSchema>,
  ): Promise<ProjectDirectoryState | null>;
  setPrimaryProjectDirectory(
    input: z.input<typeof projectDirectorySetPrimaryInputSchema>,
  ): Promise<ProjectDetail>;
  disconnectProjectDirectory(
    input: z.input<typeof projectDirectoryDisconnectInputSchema>,
  ): Promise<ProjectDirectoryState>;
  removeProjectDirectory(
    input: z.input<typeof projectDirectoryRemoveInputSchema>,
  ): Promise<ProjectDetail>;
  moveConversationToProject(
    input: z.input<typeof conversationMoveToProjectInputSchema>,
  ): Promise<Conversation>;
}
