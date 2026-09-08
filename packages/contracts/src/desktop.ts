import { z } from "zod";
import type { AccountBridge } from "./account";
import type { AutomationBridge } from "./automation";
import type { BillingBridge } from "./billing";
import type {
  BrowserComputerUseSessionControlInput,
  BrowserSessionDescriptor,
} from "./browser-computer-use";
import type { DesktopControlCommand, DesktopControlSession } from "./desktop-control";
import type { RemoteDesktopBridge } from "./desktop-remote";
import type { DiagnosticsBridge } from "./diagnostics";
import type { FileBridge } from "./file";
import type { ModelUsageBridge } from "./model";
import type { ModelServiceBridge } from "./model-service";
import type { ProjectBridge } from "./project";
import type { ReleaseUpdateBridge } from "./release";
import type { SkillBridge } from "./skill";
import type { SyncBridge } from "./sync";
import type { ToolBridge } from "./tool";
import type { WorkspaceBridge } from "./workspace";

export const ipcChannels = Object.freeze({
  environmentGet: "desktop:environment:get",
  loginStartupSettingsGet: "desktop:login-startup:settings:get",
  loginStartupSettingsUpdate: "desktop:login-startup:settings:update",
  accountState: "account:state:get",
  accountDevices: "account:devices:list",
  accountRequestCode: "account:email-code:request",
  accountVerifyCode: "account:email-code:verify",
  accountSignOut: "account:device:sign-out",
  accountSignOutAll: "account:devices:sign-out-all",
  accountRevokeDevice: "account:device:revoke",
  modelList: "model:catalog:list",
  modelServiceSettingsGet: "model:service:settings:get",
  modelServiceSettingsUpdate: "model:service:settings:update",
  modelServiceConnectionTest: "model:service:connection:test",
  modelServiceApiKeyClear: "model:service:api-key:clear",
  usageGet: "usage:aggregate:get",
  usageRecords: "usage:records:list",
  billingTerms: "billing:terms:get",
  billingAcceptTerms: "billing:terms:accept",
  billingOverview: "billing:overview:get",
  billingCharges: "billing:charges:list",
  billingLedger: "billing:ledger:list",
  billingRechargeCreate: "billing:recharge:create",
  billingRechargeList: "billing:recharge:list",
  billingRefundList: "billing:refund:list",
  billingStatementExport: "billing:statement:export",
  diagnosticsPreview: "diagnostics:preview",
  diagnosticsExport: "diagnostics:export",
  personalDataSummary: "personal-data:summary",
  personalDataExport: "personal-data:export",
  syncNow: "sync:run",
  syncConflicts: "sync:conflicts:list",
  syncResolveConflict: "sync:conflict:resolve",
  localCacheClear: "cache:local:clear",
  memorySettingsGet: "memory:settings:get",
  memorySettingsUpdate: "memory:settings:update",
  memoryConversationSettingsGet: "memory:conversation-settings:get",
  memoryConversationSettingsUpdate: "memory:conversation-settings:update",
  memoryList: "memory:list",
  memoryMergeReviewsList: "memory:merge-reviews:list",
  memoryMergeReviewResolve: "memory:merge-review:resolve",
  memorySourcesList: "memory:sources:list",
  memoryUpsert: "memory:upsert",
  memoryDelete: "memory:delete",
  memoryClear: "memory:clear",
  memoryCreatedEvent: "memory:created:event",
  memoryNavigate: "memory:navigate",
  cloudDataDelete: "account:cloud-data:delete",
  chatList: "chat:conversations:list",
  chatGet: "chat:conversation:get",
  chatSend: "chat:message:send",
  chatStop: "chat:generation:stop",
  chatRegenerate: "chat:message:regenerate",
  chatEdit: "chat:message:edit",
  chatRename: "chat:conversation:rename",
  chatArchive: "chat:conversation:archive",
  chatDelete: "chat:conversation:delete",
  chatSelectModel: "chat:conversation:model:select",
  chatSelectThinkingLevel: "chat:conversation:thinking:select",
  chatSearch: "chat:search",
  chatActivateBranch: "chat:branch:activate",
  chatEvents: "chat:events:list",
  chatEvent: "chat:event",
  automationCreate: "automation:create",
  automationList: "automation:list",
  automationGet: "automation:get",
  automationUpdate: "automation:update",
  automationPause: "automation:pause",
  automationResume: "automation:resume",
  automationDelete: "automation:delete",
  automationRunNow: "automation:run-now",
  automationRunsList: "automation:runs:list",
  automationSchedulePreview: "automation:schedule:preview",
  automationRunEvent: "automation:run:event",
  automationNavigate: "automation:navigate",
  fileChoose: "file:choose",
  directoryChoose: "file:directory:choose",
  workspaceChoose: "workspace:choose",
  workspaceList: "workspace:list",
  workspaceRevoke: "workspace:revoke",
  projectList: "project:list",
  projectGet: "project:get",
  projectCreate: "project:create",
  projectUpdate: "project:update",
  projectArchive: "project:archive",
  projectRestore: "project:restore",
  projectDirectoryChoose: "project:directory:choose",
  projectDirectorySetPrimary: "project:directory:set-primary",
  projectDirectoryDisconnect: "project:directory:disconnect",
  projectDirectoryRemove: "project:directory:remove",
  conversationMoveToProject: "conversation:project:move",
  fileList: "file:list",
  fileSearch: "file:search",
  filePreview: "file:preview",
  fileScopeRevoke: "file:scope:revoke",
  fileAttach: "file:attach",
  artifactList: "artifact:list",
  artifactGet: "artifact:get",
  artifactPreview: "artifact:preview",
  artifactSave: "artifact:save",
  toolWorkItemsList: "tool:work-items:list",
  toolWorkItemGet: "tool:work-item:get",
  toolPermissionsList: "tool:permissions:list",
  toolPermissionResolve: "tool:permission:resolve",
  toolPermissionModeGet: "tool:permission-mode:get",
  toolPermissionModeSet: "tool:permission-mode:set",
  toolScopesList: "tool:scopes:list",
  toolScopeRevoke: "tool:scope:revoke",
  toolRuntimeReadiness: "tool:runtime:readiness",
  localWebSearchSettingsGet: "tool:web-search:settings:get",
  localWebSearchSettingsUpdate: "tool:web-search:settings:update",
  localWebSearchRuntimeReset: "tool:web-search:runtime:reset",
  desktopNativePermissionRequest: "desktop:native-permission:request",
  browserComputerUseSessions: "browser-computer-use:sessions:list",
  desktopControlSessions: "desktop-control:sessions:list",
  desktopControlCommand: "desktop-control:session:command",
  browserComputerUsePause: "browser-computer-use:session:pause",
  browserComputerUseResume: "browser-computer-use:session:resume",
  mcpServersList: "mcp:servers:list",
  mcpServersAuthorization: "mcp:servers:authorization",
  mcpServerAuthorize: "mcp:server:authorize",
  mcpServerSave: "mcp:server:save",
  mcpServerRemove: "mcp:server:remove",
  skillList: "skill:list",
  skillGet: "skill:get",
  skillChooseInstall: "skill:choose-install",
  skillChooseUpdate: "skill:choose-update",
  skillEnable: "skill:enable",
  skillAutoInvoke: "skill:auto-invoke",
  skillPermissionsApprove: "skill:permissions:approve",
  skillPermissionsReset: "skill:permissions:reset",
  skillRollback: "skill:rollback",
  skillUninstall: "skill:uninstall",
  skillInvocationsList: "skill:invocations:list",
  remoteState: "remote:state:get",
  remoteEnable: "remote:enabled:set",
  remotePairingChallenge: "remote:pairing-challenge:create",
  remotePairingRevoke: "remote:pairing:revoke",
  releaseUpdateState: "release:update:state",
  releaseUpdateCheck: "release:update:check",
  releaseUpdateInstall: "release:update:install",
  releaseUpdateEvent: "release:update:event",
});

export const desktopEnvironmentSchema = z
  .object({
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    appVersion: z.string().min(1),
  })
  .strict();

export type DesktopEnvironment = z.infer<typeof desktopEnvironmentSchema>;

export const desktopLoginStartupSettingsSchema = z
  .object({
    supported: z.boolean(),
    openAtLogin: z.boolean(),
    launchesInBackground: z.boolean(),
  })
  .strict();
export const desktopLoginStartupSettingsUpdateSchema = z
  .object({ openAtLogin: z.boolean() })
  .strict();

export type DesktopLoginStartupSettings = z.infer<typeof desktopLoginStartupSettingsSchema>;
export type DesktopLoginStartupSettingsUpdate = z.infer<
  typeof desktopLoginStartupSettingsUpdateSchema
>;

export const desktopNativePermissionSchema = z.enum(["screen_capture", "accessibility"]);
export const desktopNativePermissionRequestSchema = z
  .object({ permission: desktopNativePermissionSchema })
  .strict();
export const desktopNativePermissionResultSchema = z
  .object({
    permission: desktopNativePermissionSchema,
    status: z.enum(["granted", "authorization_required", "unavailable"]),
    reason: z
      .string()
      .regex(/^[A-Z0-9_]{2,80}$/u)
      .nullable(),
    settingsOpened: z.boolean(),
  })
  .strict();

export type DesktopNativePermission = z.infer<typeof desktopNativePermissionSchema>;
export type DesktopNativePermissionRequest = z.infer<typeof desktopNativePermissionRequestSchema>;
export type DesktopNativePermissionResult = z.infer<typeof desktopNativePermissionResultSchema>;

export interface DesktopBridge
  extends ChatBridge,
    AutomationBridge,
    AccountBridge,
    ModelUsageBridge,
    ModelServiceBridge,
    SyncBridge,
    BillingBridge,
    DiagnosticsBridge,
    FileBridge,
    ToolBridge,
    WorkspaceBridge,
    ProjectBridge,
    SkillBridge,
    RemoteDesktopBridge,
    ReleaseUpdateBridge {
  getEnvironment(): Promise<DesktopEnvironment>;
  getLoginStartupSettings(): Promise<DesktopLoginStartupSettings>;
  updateLoginStartupSettings(
    input: DesktopLoginStartupSettingsUpdate,
  ): Promise<DesktopLoginStartupSettings>;
  requestDesktopNativePermission(
    input: DesktopNativePermissionRequest,
  ): Promise<DesktopNativePermissionResult>;
  listBrowserComputerUseSessions(): Promise<BrowserSessionDescriptor[]>;
  listDesktopControlSessions?(): Promise<DesktopControlSession[]>;
  controlDesktopSession?(command: DesktopControlCommand): Promise<DesktopControlSession>;
  pauseBrowserComputerUseSession(
    input: BrowserComputerUseSessionControlInput,
  ): Promise<BrowserSessionDescriptor>;
  resumeBrowserComputerUseSession(
    input: BrowserComputerUseSessionControlInput,
  ): Promise<BrowserSessionDescriptor>;
}

import type { ChatBridge } from "./chat";
