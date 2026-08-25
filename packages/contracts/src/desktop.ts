import { z } from "zod";
import type { AccountBridge } from "./account";
import type { ModelUsageBridge } from "./model";
import type { SyncBridge } from "./sync";

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
});

export const desktopEnvironmentSchema = z
  .object({
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    appVersion: z.string().min(1),
  })
  .strict();

export type DesktopEnvironment = z.infer<typeof desktopEnvironmentSchema>;

export interface DesktopBridge extends ChatBridge, AccountBridge, ModelUsageBridge, SyncBridge {
  getEnvironment(): Promise<DesktopEnvironment>;
}

import type { ChatBridge } from "./chat";
