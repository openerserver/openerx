import {
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountStateSchema,
  accountVerifyCodeInputSchema,
  type ChatCommandEnvelope,
  type ChatCommandResultMap,
  chatActivateBranchInputSchema,
  chatArchiveInputSchema,
  chatDeleteInputSchema,
  chatEditInputSchema,
  chatEventSchema,
  chatEventsInputSchema,
  chatGetInputSchema,
  chatListInputSchema,
  chatRegenerateInputSchema,
  chatRenameInputSchema,
  chatSearchInputSchema,
  chatSelectModelInputSchema,
  chatSendInputSchema,
  chatStopInputSchema,
  cloudDataDeletionResultSchema,
  type DesktopBridge,
  desktopEnvironmentSchema,
  deviceSessionSchema,
  emailChallengeSchema,
  ipcChannels,
  modelCatalogEntrySchema,
  parseChatCommandResult,
  syncResolveConflictInputSchema,
  usageAggregateSchema,
  usageQueryInputSchema,
  usageRecordSchema,
} from "@openerx/contracts";
import { contextBridge, ipcRenderer } from "electron";

async function invokeChat<C extends keyof ChatCommandResultMap>(
  channel: string,
  command: C & ChatCommandEnvelope["command"],
  input: unknown,
): Promise<ChatCommandResultMap[C]> {
  const result: unknown = await ipcRenderer.invoke(channel, input);
  return parseChatCommandResult(command, result);
}

const bridge: DesktopBridge = {
  getEnvironment: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.environmentGet);
    return desktopEnvironmentSchema.parse(result);
  },
  getAccountState: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.accountState);
    return accountStateSchema.parse(result);
  },
  listDevices: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.accountDevices);
    return deviceSessionSchema.array().parse(result);
  },
  requestEmailCode: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.accountRequestCode,
      accountRequestCodeInputSchema.parse(input),
    );
    return emailChallengeSchema.parse(result);
  },
  verifyEmailCode: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.accountVerifyCode,
      accountVerifyCodeInputSchema.parse(input),
    );
    return accountStateSchema.parse(result);
  },
  signOut: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.accountSignOut);
    return accountStateSchema.parse(result);
  },
  signOutAll: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.accountSignOutAll);
    return accountStateSchema.parse(result);
  },
  revokeDevice: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.accountRevokeDevice,
      accountRevokeDeviceInputSchema.parse(input),
    );
    return accountStateSchema.parse(result);
  },
  listModels: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.modelList);
    return modelCatalogEntrySchema.array().parse(result);
  },
  getUsage: async (input = {}) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.usageGet,
      usageQueryInputSchema.parse(input),
    );
    return usageAggregateSchema.parse(result);
  },
  getUsageRecords: async (input = {}) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.usageRecords,
      usageQueryInputSchema.parse(input),
    );
    return usageRecordSchema.array().parse(result);
  },
  syncNow: async () => invokeChat(ipcChannels.syncNow, "sync.now", {}),
  listSyncConflicts: async () => invokeChat(ipcChannels.syncConflicts, "sync.conflicts", {}),
  resolveSyncConflict: async (input) =>
    invokeChat(
      ipcChannels.syncResolveConflict,
      "sync.resolve",
      syncResolveConflictInputSchema.parse(input),
    ),
  clearLocalCache: async () => invokeChat(ipcChannels.localCacheClear, "cache.clear", {}),
  deleteCloudData: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.cloudDataDelete);
    return cloudDataDeletionResultSchema.parse(result);
  },
  listConversations: async (input = {}) =>
    invokeChat(ipcChannels.chatList, "chat.list", chatListInputSchema.parse(input)),
  getConversation: async (input) =>
    invokeChat(ipcChannels.chatGet, "chat.get", chatGetInputSchema.parse(input)),
  sendMessage: async (input) =>
    invokeChat(ipcChannels.chatSend, "chat.send", chatSendInputSchema.parse(input)),
  stopGeneration: async (input) =>
    invokeChat(ipcChannels.chatStop, "chat.stop", chatStopInputSchema.parse(input)),
  regenerateMessage: async (input) =>
    invokeChat(
      ipcChannels.chatRegenerate,
      "chat.regenerate",
      chatRegenerateInputSchema.parse(input),
    ),
  editMessage: async (input) =>
    invokeChat(ipcChannels.chatEdit, "chat.edit", chatEditInputSchema.parse(input)),
  renameConversation: async (input) =>
    invokeChat(ipcChannels.chatRename, "chat.rename", chatRenameInputSchema.parse(input)),
  setConversationArchived: async (input) =>
    invokeChat(ipcChannels.chatArchive, "chat.archive", chatArchiveInputSchema.parse(input)),
  deleteConversation: async (input) =>
    invokeChat(ipcChannels.chatDelete, "chat.delete", chatDeleteInputSchema.parse(input)),
  selectConversationModel: async (input) =>
    invokeChat(
      ipcChannels.chatSelectModel,
      "chat.selectModel",
      chatSelectModelInputSchema.parse(input),
    ),
  search: async (input) =>
    invokeChat(ipcChannels.chatSearch, "chat.search", chatSearchInputSchema.parse(input)),
  activateBranch: async (input) =>
    invokeChat(
      ipcChannels.chatActivateBranch,
      "chat.activateBranch",
      chatActivateBranchInputSchema.parse(input),
    ),
  getChatEvents: async (input) =>
    invokeChat(ipcChannels.chatEvents, "chat.events", chatEventsInputSchema.parse(input)),
  onChatEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = chatEventSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(ipcChannels.chatEvent, wrapped);
    return () => {
      ipcRenderer.removeListener(ipcChannels.chatEvent, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("openerx", Object.freeze(bridge));
