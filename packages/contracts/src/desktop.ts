import { z } from "zod";
import type { AccountBridge } from "./account";
import type { BillingBridge } from "./billing";
import type { RemoteDesktopBridge } from "./desktop-remote";
import type { FileBridge } from "./file";
import type { ModelUsageBridge } from "./model";
import type { SkillBridge } from "./skill";
import type { SyncBridge } from "./sync";
import type { ToolBridge } from "./tool";

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
  chatSearch: "chat:search",
  chatActivateBranch: "chat:branch:activate",
  chatEvents: "chat:events:list",
  chatEvent: "chat:event",
  fileChoose: "file:choose",
  directoryChoose: "file:directory:choose",
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
  mcpServersList: "mcp:servers:list",
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
});

export const desktopEnvironmentSchema = z
  .object({
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    appVersion: z.string().min(1),
  })
  .strict();

export type DesktopEnvironment = z.infer<typeof desktopEnvironmentSchema>;

export interface DesktopBridge
  extends ChatBridge,
    AccountBridge,
    ModelUsageBridge,
    SyncBridge,
    BillingBridge,
    FileBridge,
    ToolBridge,
    SkillBridge,
    RemoteDesktopBridge {
  getEnvironment(): Promise<DesktopEnvironment>;
}

import type { ChatBridge } from "./chat";
