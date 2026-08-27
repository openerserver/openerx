import { z } from "zod";
import type { AccountBridge } from "./account";
import type { BillingBridge } from "./billing";
import type { RemoteDesktopBridge } from "./desktop-remote";
import type { DiagnosticsBridge } from "./diagnostics";
import type { FileBridge } from "./file";
import type { ModelUsageBridge } from "./model";
import type { ReleaseUpdateBridge } from "./release";
import type { SkillBridge } from "./skill";
import type { SyncBridge } from "./sync";
import type { ToolBridge } from "./tool";
import type { WorkspaceBridge } from "./workspace";

export const ipcChannels = Object.freeze({
  environmentGet: "desktop:environment:get",
  accountState: "account:state:get",
  accountDevices: "account:devices:list",
  accountRequestCode: "account:email-code:request",
  accountVerifyCode: "account:email-code:verify",
  accountSignOut: "account:device:sign-out",
  accountSignOutAll: "account:devices:sign-out-all",
  accountRevokeDevice: "account:device:revoke",
  modelList: "model:catalog:list",
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
  fileChoose: "file:choose",
  directoryChoose: "file:directory:choose",
  workspaceChoose: "workspace:choose",
  workspaceList: "workspace:list",
  workspaceRevoke: "workspace:revoke",
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
  toolScopesList: "tool:scopes:list",
  toolScopeRevoke: "tool:scope:revoke",
  toolRuntimeReadiness: "tool:runtime:readiness",
  desktopNativePermissionRequest: "desktop:native-permission:request",
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
    AccountBridge,
    ModelUsageBridge,
    SyncBridge,
    BillingBridge,
    DiagnosticsBridge,
    FileBridge,
    ToolBridge,
    WorkspaceBridge,
    SkillBridge,
    RemoteDesktopBridge,
    ReleaseUpdateBridge {
  getEnvironment(): Promise<DesktopEnvironment>;
  requestDesktopNativePermission(
    input: DesktopNativePermissionRequest,
  ): Promise<DesktopNativePermissionResult>;
}

import type { ChatBridge } from "./chat";
