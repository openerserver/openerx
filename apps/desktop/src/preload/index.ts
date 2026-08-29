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
  browserComputerUseSessionControlInputSchema,
  browserSessionDescriptorSchema,
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
  chatSelectThinkingLevelInputSchema,
  chatSendInputSchema,
  chatStopInputSchema,
  cloudDataDeletionResultSchema,
  createRechargeOrderInputSchema,
  type DesktopBridge,
  desktopEnvironmentSchema,
  desktopMcpServerSaveInputSchema,
  desktopNativePermissionRequestSchema,
  desktopNativePermissionResultSchema,
  deviceSessionSchema,
  diagnosticsPreviewSchema,
  emailChallengeSchema,
  fileAttachInputSchema,
  fileChooseInputSchema,
  fileListInputSchema,
  filePreviewInputSchema,
  fileRevokeScopeInputSchema,
  fileSearchInputSchema,
  ipcChannels,
  ledgerTransactionSchema,
  localExportResultSchema,
  localWebSearchRuntimeResetInputSchema,
  localWebSearchSettingsSelectionSchema,
  mcpServerAuthorizationStateSchema,
  mcpServerAuthorizeInputSchema,
  mcpServerConfigSchema,
  mcpServerRemoveInputSchema,
  mcpServerRemoveResultSchema,
  modelCatalogEntrySchema,
  parseChatCommandResult,
  permissionListInputSchema,
  permissionResolveInputSchema,
  personalDataSummarySchema,
  rechargeOrderSchema,
  refundOrderSchema,
  releaseUpdateStateSchema,
  remoteDesktopEnableInputSchema,
  remoteDesktopRevokeInputSchema,
  remoteDesktopStateSchema,
  remoteDevicePairingSchema,
  remotePairingChallengeSchema,
  skillApprovePermissionsInputSchema,
  skillAutoInvokeInputSchema,
  skillChooseInstallInputSchema,
  skillChooseUpdateInputSchema,
  skillEnableInputSchema,
  skillGetInputSchema,
  skillInstallationSchema,
  skillInvocationListInputSchema,
  skillInvocationSchema,
  skillListInputSchema,
  skillResetPermissionsInputSchema,
  skillRollbackInputSchema,
  skillUninstallInputSchema,
  skillUninstallResultSchema,
  syncResolveConflictInputSchema,
  toolListInputSchema,
  toolScopeRevokeInputSchema,
  usageAggregateSchema,
  usageQueryInputSchema,
  usageRecordSchema,
  workItemGetInputSchema,
  workspaceChooseInputSchema,
  workspaceGrantSchema,
  workspaceListInputSchema,
  workspaceRevokeInputSchema,
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
  requestDesktopNativePermission: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.desktopNativePermissionRequest,
      desktopNativePermissionRequestSchema.parse(input),
    );
    return desktopNativePermissionResultSchema.parse(result);
  },
  listBrowserComputerUseSessions: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.browserComputerUseSessions);
    return browserSessionDescriptorSchema.array().parse(result);
  },
  pauseBrowserComputerUseSession: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.browserComputerUsePause,
      browserComputerUseSessionControlInputSchema.parse(input),
    );
    return browserSessionDescriptorSchema.parse(result);
  },
  resumeBrowserComputerUseSession: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.browserComputerUseResume,
      browserComputerUseSessionControlInputSchema.parse(input),
    );
    return browserSessionDescriptorSchema.parse(result);
  },
  getReleaseUpdateState: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.releaseUpdateState);
    return releaseUpdateStateSchema.parse(result);
  },
  checkForReleaseUpdate: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.releaseUpdateCheck);
    return releaseUpdateStateSchema.parse(result);
  },
  installReleaseUpdate: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.releaseUpdateInstall);
    return releaseUpdateStateSchema.parse(result);
  },
  onReleaseUpdateState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = releaseUpdateStateSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(ipcChannels.releaseUpdateEvent, wrapped);
    return () => ipcRenderer.removeListener(ipcChannels.releaseUpdateEvent, wrapped);
  },
  getDiagnosticsPreview: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.diagnosticsPreview);
    return diagnosticsPreviewSchema.parse(result);
  },
  exportDiagnostics: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.diagnosticsExport);
    return result === null ? null : localExportResultSchema.parse(result);
  },
  getPersonalDataSummary: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.personalDataSummary);
    return personalDataSummarySchema.parse(result);
  },
  exportPersonalData: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.personalDataExport);
    return result === null ? null : localExportResultSchema.parse(result);
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
  selectConversationThinkingLevel: async (input) =>
    invokeChat(
      ipcChannels.chatSelectThinkingLevel,
      "chat.selectThinkingLevel",
      chatSelectThinkingLevelInputSchema.parse(input),
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
  chooseWorkspace: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.workspaceChoose,
      workspaceChooseInputSchema.parse(input),
    );
    return value === null ? null : workspaceGrantSchema.parse(value);
  },
  listWorkspaces: async (input = {}) =>
    invokeChat(ipcChannels.workspaceList, "workspace.list", workspaceListInputSchema.parse(input)),
  revokeWorkspace: async (input) =>
    invokeChat(
      ipcChannels.workspaceRevoke,
      "workspace.revoke",
      workspaceRevokeInputSchema.parse(input),
    ),
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
  listToolRuntimeReadiness: async () =>
    invokeChat(ipcChannels.toolRuntimeReadiness, "tool.runtime.readiness", {}),
  getLocalWebSearchSettings: async () =>
    invokeChat(ipcChannels.localWebSearchSettingsGet, "tool.webSearch.settings.get", {}),
  updateLocalWebSearchSettings: async (input) =>
    invokeChat(
      ipcChannels.localWebSearchSettingsUpdate,
      "tool.webSearch.settings.update",
      localWebSearchSettingsSelectionSchema.parse(input),
    ),
  resetLocalWebSearchRuntime: async (input = {}) =>
    invokeChat(
      ipcChannels.localWebSearchRuntimeReset,
      "tool.webSearch.runtime.reset",
      localWebSearchRuntimeResetInputSchema.parse(input),
    ),
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
  listMcpServerAuthorizationStates: async () => {
    const value: unknown = await ipcRenderer.invoke(ipcChannels.mcpServersAuthorization, {});
    return mcpServerAuthorizationStateSchema.array().parse(value);
  },
  authorizeMcpServer: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.mcpServerAuthorize,
      mcpServerAuthorizeInputSchema.parse(input),
    );
    return mcpServerAuthorizationStateSchema.parse(value);
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
  listSkills: async (input = {}) =>
    invokeChat(ipcChannels.skillList, "skill.list", skillListInputSchema.parse(input)),
  getSkill: async (input) =>
    invokeChat(ipcChannels.skillGet, "skill.get", skillGetInputSchema.parse(input)),
  chooseAndInstallSkill: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.skillChooseInstall,
      skillChooseInstallInputSchema.parse(input),
    );
    return value === null ? null : skillInstallationSchema.parse(value);
  },
  chooseAndUpdateSkill: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.skillChooseUpdate,
      skillChooseUpdateInputSchema.parse(input),
    );
    return value === null ? null : skillInstallationSchema.parse(value);
  },
  setSkillEnabled: async (input) =>
    invokeChat(ipcChannels.skillEnable, "skill.enable", skillEnableInputSchema.parse(input)),
  setSkillAutoInvoke: async (input) =>
    invokeChat(
      ipcChannels.skillAutoInvoke,
      "skill.autoInvoke",
      skillAutoInvokeInputSchema.parse(input),
    ),
  approveSkillPermissions: async (input) =>
    invokeChat(
      ipcChannels.skillPermissionsApprove,
      "skill.permissions.approve",
      skillApprovePermissionsInputSchema.parse(input),
    ),
  resetSkillPermissions: async (input) =>
    invokeChat(
      ipcChannels.skillPermissionsReset,
      "skill.permissions.reset",
      skillResetPermissionsInputSchema.parse(input),
    ),
  rollbackSkill: async (input) =>
    invokeChat(ipcChannels.skillRollback, "skill.rollback", skillRollbackInputSchema.parse(input)),
  uninstallSkill: async (input) =>
    invokeChat(
      ipcChannels.skillUninstall,
      "skill.uninstall",
      skillUninstallInputSchema.parse(input),
    ).then((value) => skillUninstallResultSchema.parse(value)),
  listSkillInvocations: async (input = {}) =>
    invokeChat(
      ipcChannels.skillInvocationsList,
      "skill.invocations.list",
      skillInvocationListInputSchema.parse(input),
    ).then((value) => skillInvocationSchema.array().parse(value)),
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
