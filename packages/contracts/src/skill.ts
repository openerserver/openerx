import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const skillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const skillVersionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
export const skillScopeSchema = z.enum(["builtin", "personal", "workspace"]);
export const skillSourceKindSchema = z.enum([
  "built_in",
  "local_directory",
  "archive",
  "platform_catalog",
]);
export const skillTrustSchema = z.enum(["bundled", "signed", "unverified"]);
export const skillPackageStateSchema = z.enum(["installed", "missing", "damaged"]);
export const skillPlatformSchema = z.enum(["darwin", "win32"]);

export const skillPermissionDeclarationSchema = z
  .object({
    capability: z.enum(["file", "network", "shell", "browser", "desktop", "mcp"]),
    actions: z.array(z.string().min(1).max(100)).min(1).max(50),
    targets: z.array(z.string().min(1).max(2_048)).max(100).default([]),
    reason: z.string().min(1).max(1_000),
  })
  .strict();

const skillInstallationBaseSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    name: skillNameSchema,
    displayName: z.string().min(1).max(120),
    description: z.string().min(1).max(1_024),
    version: skillVersionSchema,
    publisher: z.string().min(1).max(200),
    scope: skillScopeSchema,
    workspaceId: z.string().min(1).max(500).nullable(),
    sourceKind: skillSourceKindSchema,
    sourceLabel: z.string().min(1).max(500),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    trust: skillTrustSchema,
    enabled: z.boolean(),
    autoInvoke: z.boolean(),
    packageState: skillPackageStateSchema,
    permissionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    approvedPermissionDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    declaredTools: z.array(z.string().min(1).max(200)).max(200),
    declaredMcpServers: z.array(z.string().min(1).max(200)).max(200),
    permissions: z.array(skillPermissionDeclarationSchema).max(100),
    platforms: z.array(skillPlatformSchema).min(1),
    rollbackVersions: z.array(skillVersionSchema),
    installedAt: timestampSchema,
    updatedAt: timestampSchema,
    lastUsedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

function validateSkillScope(
  skill: { scope: "builtin" | "personal" | "workspace"; workspaceId: string | null },
  context: z.RefinementCtx,
): void {
  if (skill.scope === "workspace" && !skill.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "Workspace required" });
  }
  if (skill.scope !== "workspace" && skill.workspaceId !== null) {
    context.addIssue({
      code: "custom",
      path: ["workspaceId"],
      message: "Workspace only applies to workspace scope",
    });
  }
}

export const skillInstallationSchema = skillInstallationBaseSchema.superRefine(validateSkillScope);

export const skillInstallationSyncSchema = skillInstallationBaseSchema
  .pick({
    id: true,
    ownerProfileId: true,
    name: true,
    displayName: true,
    description: true,
    version: true,
    publisher: true,
    scope: true,
    workspaceId: true,
    sourceKind: true,
    sourceLabel: true,
    checksumSha256: true,
    trust: true,
    enabled: true,
    autoInvoke: true,
    permissionDigest: true,
    declaredTools: true,
    declaredMcpServers: true,
    permissions: true,
    platforms: true,
    installedAt: true,
    updatedAt: true,
    revision: true,
  })
  .strict()
  .superRefine(validateSkillScope);

export const skillInvocationSchema = z
  .object({
    id: entityIdSchema,
    installationId: entityIdSchema,
    generationId: entityIdSchema,
    conversationId: entityIdSchema,
    trigger: z.enum(["explicit", "automatic"]),
    status: z.enum(["selected", "loaded", "completed", "failed", "cancelled"]),
    reason: z.string().max(1_000),
    startedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    errorCode: z.string().min(1).nullable(),
  })
  .strict();

export const skillPackageManifestSchema = z
  .object({
    version: skillVersionSchema,
    display_name: z.string().min(1).max(120).optional(),
    publisher: z.string().min(1).max(200),
    tools: z.array(z.string().min(1).max(200)).max(200).default([]),
    mcp_servers: z.array(z.string().min(1).max(200)).max(200).default([]),
    permissions: z.array(skillPermissionDeclarationSchema).max(100).default([]),
    platforms: z.array(skillPlatformSchema).min(1).default(["darwin", "win32"]),
    scripts: z.array(z.string().min(1).max(500)).max(200).default([]),
    signature: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const skillListInputSchema = z
  .object({
    scope: skillScopeSchema.optional(),
    workspaceId: z.string().min(1).max(500).optional(),
  })
  .strict();
export const skillGetInputSchema = z.object({ installationId: entityIdSchema }).strict();
const skillInstallPrivilegedInputBaseSchema = z
  .object({
    sourcePath: z.string().min(1).max(4_096),
    sourceKind: z.enum(["local_directory", "archive"]),
    scope: z.enum(["personal", "workspace"]),
    workspaceId: z.string().min(1).max(500).nullable().default(null),
  })
  .strict();

function validateInstallScope(
  input: { scope: "personal" | "workspace"; workspaceId: string | null },
  context: z.RefinementCtx,
): void {
  if (input.scope === "workspace" && !input.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "Workspace required" });
  }
  if (input.scope === "personal" && input.workspaceId !== null) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "Unexpected workspace" });
  }
}

export const skillInstallPrivilegedInputSchema =
  skillInstallPrivilegedInputBaseSchema.superRefine(validateInstallScope);
export const skillChooseInstallInputSchema = skillInstallPrivilegedInputBaseSchema
  .omit({ sourcePath: true, sourceKind: true })
  .superRefine(validateInstallScope);
export const skillUpdatePrivilegedInputSchema = z
  .object({
    installationId: entityIdSchema,
    sourcePath: z.string().min(1).max(4_096),
    sourceKind: z.enum(["local_directory", "archive"]),
  })
  .strict();
export const skillChooseUpdateInputSchema = z.object({ installationId: entityIdSchema }).strict();
export const skillEnableInputSchema = z
  .object({ installationId: entityIdSchema, enabled: z.boolean() })
  .strict();
export const skillAutoInvokeInputSchema = z
  .object({ installationId: entityIdSchema, autoInvoke: z.boolean() })
  .strict();
export const skillApprovePermissionsInputSchema = z
  .object({ installationId: entityIdSchema, permissionDigest: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const skillResetPermissionsInputSchema = z
  .object({ installationId: entityIdSchema })
  .strict();
export const skillRollbackInputSchema = z
  .object({ installationId: entityIdSchema, version: skillVersionSchema })
  .strict();
export const skillUninstallInputSchema = z.object({ installationId: entityIdSchema }).strict();
export const skillUninstallResultSchema = z
  .object({ installationId: entityIdSchema, removed: z.boolean() })
  .strict();
export const skillInvocationListInputSchema = z
  .object({
    conversationId: entityIdSchema.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();

export const piSkillMountSchema = z
  .object({
    installationId: entityIdSchema,
    name: skillNameSchema,
    baseDir: z.string().min(1).max(4_096),
    autoInvoke: z.boolean(),
  })
  .strict();

export type SkillInstallation = z.infer<typeof skillInstallationSchema>;
export type SkillInstallationSync = z.infer<typeof skillInstallationSyncSchema>;
export type SkillInvocation = z.infer<typeof skillInvocationSchema>;
export type SkillPackageManifest = z.infer<typeof skillPackageManifestSchema>;
export type PiSkillMount = z.infer<typeof piSkillMountSchema>;

export interface SkillBridge {
  listSkills(input?: z.input<typeof skillListInputSchema>): Promise<SkillInstallation[]>;
  getSkill(input: z.input<typeof skillGetInputSchema>): Promise<SkillInstallation>;
  chooseAndInstallSkill(
    input: z.input<typeof skillChooseInstallInputSchema>,
  ): Promise<SkillInstallation | null>;
  chooseAndUpdateSkill(
    input: z.input<typeof skillChooseUpdateInputSchema>,
  ): Promise<SkillInstallation | null>;
  setSkillEnabled(input: z.input<typeof skillEnableInputSchema>): Promise<SkillInstallation>;
  setSkillAutoInvoke(input: z.input<typeof skillAutoInvokeInputSchema>): Promise<SkillInstallation>;
  approveSkillPermissions(
    input: z.input<typeof skillApprovePermissionsInputSchema>,
  ): Promise<SkillInstallation>;
  resetSkillPermissions(
    input: z.input<typeof skillResetPermissionsInputSchema>,
  ): Promise<SkillInstallation>;
  rollbackSkill(input: z.input<typeof skillRollbackInputSchema>): Promise<SkillInstallation>;
  uninstallSkill(
    input: z.input<typeof skillUninstallInputSchema>,
  ): Promise<z.infer<typeof skillUninstallResultSchema>>;
  listSkillInvocations(
    input?: z.input<typeof skillInvocationListInputSchema>,
  ): Promise<SkillInvocation[]>;
}
