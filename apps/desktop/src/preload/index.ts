import {
  acceptBillingTermsInputSchema,
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountStateSchema,
  accountVerifyCodeInputSchema,
  artifactExportResultSchema,
  artifactGetInputSchema,
  artifactPreviewInputSchema,
  billingOverviewSchema,
  billingStatementExportSchema,
  billingStatementRequestSchema,
  billingTermsAcceptanceSchema,
  billingTermsStateSchema,
  type ChatCommandEnvelope,
  type ChatCommandResultMap,
  chargeRecordSchema,
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
  createRechargeOrderInputSchema,
  type DesktopBridge,
  desktopEnvironmentSchema,
  desktopMcpServerSaveInputSchema,
  deviceSessionSchema,
  emailChallengeSchema,
  fileAttachInputSchema,
  fileChooseInputSchema,
  fileListInputSchema,
  filePreviewInputSchema,
  fileRevokeScopeInputSchema,
  fileSearchInputSchema,
  ipcChannels,
  ledgerTransactionSchema,
  mcpServerConfigSchema,
  mcpServerRemoveInputSchema,
  mcpServerRemoveResultSchema,
  modelCatalogEntrySchema,
  parseChatCommandResult,
  permissionListInputSchema,
  permissionResolveInputSchema,
  rechargeOrderSchema,
  refundOrderSchema,
  remoteDesktopEnableInputSchema,
  remoteDesktopRevokeInputSchema,
  remoteDesktopStateSchema,
  remoteDevicePairingSchema,
  remotePairingChallengeSchema,
  syncResolveConflictInputSchema,
  toolListInputSchema,
  toolScopeRevokeInputSchema,
  usageAggregateSchema,
  usageQueryInputSchema,
  usageRecordSchema,
  workItemGetInputSchema,
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
  getRemoteState: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.remoteState);
    return remoteDesktopStateSchema.parse(result);
  },
  setRemoteEnabled: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.remoteEnable,
      remoteDesktopEnableInputSchema.parse(input),
    );
    return remoteDesktopStateSchema.parse(result);
  },
  createRemotePairingChallenge: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.remotePairingChallenge);
    return remotePairingChallengeSchema.parse(result);
  },
  revokeRemotePairing: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.remotePairingRevoke,
      remoteDesktopRevokeInputSchema.parse(input),
    );
    return remoteDevicePairingSchema.parse(result);
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
  getBillingTerms: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.billingTerms);
    return billingTermsStateSchema.parse(result);
  },
  acceptBillingTerms: async (version) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.billingAcceptTerms,
      acceptBillingTermsInputSchema.parse({ version }),
    );
    return billingTermsAcceptanceSchema.parse(result);
  },
  getBillingOverview: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.billingOverview);
    return billingOverviewSchema.parse(result);
  },
  listCharges: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.billingCharges);
    return chargeRecordSchema.array().parse(result);
  },
  listLedger: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.billingLedger);
    return ledgerTransactionSchema.array().parse(result);
  },
  createRechargeOrder: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.billingRechargeCreate,
      createRechargeOrderInputSchema.parse(input),
    );
    return rechargeOrderSchema.parse(result);
  },
  listRechargeOrders: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.billingRechargeList);
    return rechargeOrderSchema.array().parse(result);
  },
  listRefunds: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.billingRefundList);
    return refundOrderSchema.array().parse(result);
  },
  exportBillingStatement: async (month) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.billingStatementExport,
      billingStatementRequestSchema.parse({ month }),
    );
    return billingStatementExportSchema.parse(result);
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
  chooseFiles: async (input = {}) =>
    invokeChat(ipcChannels.fileChoose, "file.import", fileChooseInputSchema.parse(input)),
  chooseDirectory: async (input = {}) =>
    invokeChat(ipcChannels.directoryChoose, "file.import", fileChooseInputSchema.parse(input)),
  listFiles: async (input = {}) =>
    invokeChat(ipcChannels.fileList, "file.list", fileListInputSchema.parse(input)),
  searchFiles: async (input) =>
    invokeChat(ipcChannels.fileSearch, "file.search", fileSearchInputSchema.parse(input)),
  previewFile: async (input) =>
    invokeChat(ipcChannels.filePreview, "file.preview", filePreviewInputSchema.parse(input)),
  revokeFileScope: async (input) =>
    invokeChat(
      ipcChannels.fileScopeRevoke,
      "file.scope.revoke",
      fileRevokeScopeInputSchema.parse(input),
    ),
  attachFile: async (input) =>
    invokeChat(ipcChannels.fileAttach, "file.attach", fileAttachInputSchema.parse(input)),
  listArtifacts: async () => invokeChat(ipcChannels.artifactList, "artifact.list", {}),
  getArtifact: async (input) =>
    invokeChat(ipcChannels.artifactGet, "artifact.get", artifactGetInputSchema.parse(input)),
  previewArtifact: async (input) =>
    invokeChat(
      ipcChannels.artifactPreview,
      "artifact.preview",
      artifactPreviewInputSchema.parse(input),
    ),
  saveArtifact: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.artifactSave,
      artifactGetInputSchema.parse(input),
    );
    return result === null ? null : artifactExportResultSchema.parse(result);
  },
  listWorkItems: async (input = {}) =>
    invokeChat(
      ipcChannels.toolWorkItemsList,
      "tool.workItems.list",
      toolListInputSchema.parse(input),
    ),
  getWorkItem: async (input) =>
    invokeChat(
      ipcChannels.toolWorkItemGet,
      "tool.workItem.get",
      workItemGetInputSchema.parse(input),
    ),
  listPermissionRequests: async (input = {}) =>
    invokeChat(
      ipcChannels.toolPermissionsList,
      "tool.permissions.list",
      permissionListInputSchema.parse(input),
    ),
  resolvePermission: async (input) =>
    invokeChat(
      ipcChannels.toolPermissionResolve,
      "tool.permission.resolve",
      permissionResolveInputSchema.parse(input),
    ),
  listCapabilityScopes: async () => invokeChat(ipcChannels.toolScopesList, "tool.scopes.list", {}),
  revokeCapabilityScope: async (input) =>
    invokeChat(
      ipcChannels.toolScopeRevoke,
      "tool.scope.revoke",
      toolScopeRevokeInputSchema.parse(input),
    ),
  listMcpServers: async () => {
    const value: unknown = await ipcRenderer.invoke(ipcChannels.mcpServersList, {});
    return mcpServerConfigSchema.array().parse(value);
  },
  saveMcpServer: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.mcpServerSave,
      desktopMcpServerSaveInputSchema.parse(input),
    );
    return mcpServerConfigSchema.parse(value);
  },
  removeMcpServer: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.mcpServerRemove,
      mcpServerRemoveInputSchema.parse(input),
    );
    return mcpServerRemoveResultSchema.parse(value);
  },
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
