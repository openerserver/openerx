import {
  acceptBillingTermsInputSchema,
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountStateSchema,
  accountVerifyCodeInputSchema,
  artifactExportResultSchema,
  artifactGetInputSchema,
  artifactListInputSchema,
  artifactPreviewInputSchema,
  automaticMemoryCreatedEventSchema,
  automationCreateInputSchema,
  automationDefinitionSchema,
  automationGetInputSchema,
  automationListInputSchema,
  automationRunNowInputSchema,
  automationRunSchema,
  automationRunsListInputSchema,
  automationSchedulePreviewInputSchema,
  automationSchedulePreviewSchema,
  automationSetStatusInputSchema,
  automationUpdateInputSchema,
  billingOverviewSchema,
  billingStatementExportSchema,
  billingStatementRequestSchema,
  billingTermsAcceptanceSchema,
  billingTermsStateSchema,
  browserComputerUseSessionControlInputSchema,
  browserSessionDescriptorSchema,
  byokConnectionTestResultSchema,
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
  conversationMemorySettingsGetInputSchema,
  conversationMemorySettingsUpdateInputSchema,
  conversationMoveToProjectInputSchema,
  createRechargeOrderInputSchema,
  type DesktopBridge,
  desktopControlCommandSchema,
  desktopControlSessionSchema,
  desktopEnvironmentSchema,
  desktopLoginStartupSettingsSchema,
  desktopLoginStartupSettingsUpdateSchema,
  desktopMcpServerSaveInputSchema,
  desktopNativePermissionRequestSchema,
  desktopNativePermissionResultSchema,
  deviceSessionSchema,
  diagnosticsPreviewSchema,
  emailChallengeSchema,
  entityIdSchema,
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
  memoryClearInputSchema,
  memoryDeleteInputSchema,
  memoryListInputSchema,
  memoryMergeReviewListInputSchema,
  memoryMergeReviewResolveInputSchema,
  memorySettingsUpdateInputSchema,
  memorySourcesListInputSchema,
  memoryUpsertInputSchema,
  modelCatalogEntrySchema,
  modelServiceSettingsSchema,
  modelServiceSettingsUpdateSchema,
  type ProjectCommandEnvelope,
  type ProjectCommandResultMap,
  parseChatCommandResult,
  parseProjectCommandResult,
  permissionListInputSchema,
  permissionResolveInputSchema,
  personalDataSummarySchema,
  projectArchiveCommandInputSchema,
  projectCreateInputSchema,
  projectDirectoryChooseInputSchema,
  projectDirectoryDisconnectInputSchema,
  projectDirectoryRemoveInputSchema,
  projectDirectorySetPrimaryInputSchema,
  projectDirectoryStateSchema,
  projectGetInputSchema,
  projectListInputSchema,
  projectUpdateInputSchema,
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
  toolPermissionModeGetInputSchema,
  toolPermissionModeSetInputSchema,
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

async function invokeProject<C extends keyof ProjectCommandResultMap>(
  channel: string,
  command: C & ProjectCommandEnvelope["command"],
  input: unknown,
): Promise<ProjectCommandResultMap[C]> {
  const result: unknown = await ipcRenderer.invoke(channel, input);
  return parseProjectCommandResult(command, result);
}

const bridge: DesktopBridge = {
  getEnvironment: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.environmentGet);
    return desktopEnvironmentSchema.parse(result);
  },
  getLoginStartupSettings: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.loginStartupSettingsGet);
    return desktopLoginStartupSettingsSchema.parse(result);
  },
  updateLoginStartupSettings: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.loginStartupSettingsUpdate,
      desktopLoginStartupSettingsUpdateSchema.parse(input),
    );
    return desktopLoginStartupSettingsSchema.parse(result);
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
  listDesktopControlSessions: async () =>
    desktopControlSessionSchema
      .array()
      .parse(await ipcRenderer.invoke(ipcChannels.desktopControlSessions)),
  controlDesktopSession: async (input) =>
    desktopControlSessionSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.desktopControlCommand,
        desktopControlCommandSchema.parse(input),
      ),
    ),
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
  getModelServiceSettings: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.modelServiceSettingsGet);
    return modelServiceSettingsSchema.parse(result);
  },
  updateModelServiceSettings: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.modelServiceSettingsUpdate,
      modelServiceSettingsUpdateSchema.parse(input),
    );
    return modelServiceSettingsSchema.parse(result);
  },
  testByokConnection: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.modelServiceConnectionTest,
      modelServiceSettingsUpdateSchema.parse(input),
    );
    return byokConnectionTestResultSchema.parse(result);
  },
  clearByokApiKey: async (providerId) => {
    const result: unknown = await ipcRenderer.invoke(
      ipcChannels.modelServiceApiKeyClear,
      providerId,
    );
    return modelServiceSettingsSchema.parse(result);
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
  getMemorySettings: async () =>
    invokeChat(ipcChannels.memorySettingsGet, "memory.settings.get", {}),
  updateMemorySettings: async (input) =>
    invokeChat(
      ipcChannels.memorySettingsUpdate,
      "memory.settings.update",
      memorySettingsUpdateInputSchema.parse(input),
    ),
  getConversationMemorySettings: async (input) =>
    invokeChat(
      ipcChannels.memoryConversationSettingsGet,
      "memory.conversation.settings.get",
      conversationMemorySettingsGetInputSchema.parse(input),
    ),
  updateConversationMemorySettings: async (input) =>
    invokeChat(
      ipcChannels.memoryConversationSettingsUpdate,
      "memory.conversation.settings.update",
      conversationMemorySettingsUpdateInputSchema.parse(input),
    ),
  listMemories: async (input = {}) =>
    invokeChat(ipcChannels.memoryList, "memory.list", memoryListInputSchema.parse(input)),
  listMemoryMergeReviews: async (input = {}) =>
    invokeChat(
      ipcChannels.memoryMergeReviewsList,
      "memory.merge-reviews.list",
      memoryMergeReviewListInputSchema.parse(input),
    ),
  resolveMemoryMergeReview: async (input) =>
    invokeChat(
      ipcChannels.memoryMergeReviewResolve,
      "memory.merge-reviews.resolve",
      memoryMergeReviewResolveInputSchema.parse(input),
    ),
  listMemorySources: async (input) =>
    invokeChat(
      ipcChannels.memorySourcesList,
      "memory.sources.list",
      memorySourcesListInputSchema.parse(input),
    ),
  upsertMemory: async (input) =>
    invokeChat(ipcChannels.memoryUpsert, "memory.upsert", memoryUpsertInputSchema.parse(input)),
  deleteMemory: async (input) =>
    invokeChat(ipcChannels.memoryDelete, "memory.delete", memoryDeleteInputSchema.parse(input)),
  clearMemories: async (input) =>
    invokeChat(ipcChannels.memoryClear, "memory.clear", memoryClearInputSchema.parse(input)),
  onAutomaticMemoryCreated: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = automaticMemoryCreatedEventSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(ipcChannels.memoryCreatedEvent, wrapped);
    return () => ipcRenderer.removeListener(ipcChannels.memoryCreatedEvent, wrapped);
  },
  onMemoryNavigate: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = entityIdSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(ipcChannels.memoryNavigate, wrapped);
    return () => ipcRenderer.removeListener(ipcChannels.memoryNavigate, wrapped);
  },
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
  createAutomation: async (input) =>
    automationDefinitionSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationCreate,
        automationCreateInputSchema.parse(input),
      ),
    ),
  listAutomations: async (input = {}) =>
    automationDefinitionSchema
      .array()
      .parse(
        await ipcRenderer.invoke(
          ipcChannels.automationList,
          automationListInputSchema.parse(input),
        ),
      ),
  getAutomation: async (input) =>
    automationDefinitionSchema.parse(
      await ipcRenderer.invoke(ipcChannels.automationGet, automationGetInputSchema.parse(input)),
    ),
  updateAutomation: async (input) =>
    automationDefinitionSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationUpdate,
        automationUpdateInputSchema.parse(input),
      ),
    ),
  pauseAutomation: async (input) =>
    automationDefinitionSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationPause,
        automationSetStatusInputSchema.parse(input),
      ),
    ),
  resumeAutomation: async (input) =>
    automationDefinitionSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationResume,
        automationSetStatusInputSchema.parse(input),
      ),
    ),
  deleteAutomation: async (input) =>
    automationDefinitionSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationDelete,
        automationSetStatusInputSchema.parse(input),
      ),
    ),
  runAutomationNow: async (input) =>
    automationRunSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationRunNow,
        automationRunNowInputSchema.parse(input),
      ),
    ),
  listAutomationRuns: async (input) =>
    automationRunSchema
      .array()
      .parse(
        await ipcRenderer.invoke(
          ipcChannels.automationRunsList,
          automationRunsListInputSchema.parse(input),
        ),
      ),
  previewAutomationSchedule: async (input) =>
    automationSchedulePreviewSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.automationSchedulePreview,
        automationSchedulePreviewInputSchema.parse(input),
      ),
    ),
  onAutomationRun: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = automationRunSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(ipcChannels.automationRunEvent, wrapped);
    return () => ipcRenderer.removeListener(ipcChannels.automationRunEvent, wrapped);
  },
  onAutomationNavigate: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = automationGetInputSchema.safeParse({ automationId: value });
      if (parsed.success) listener(parsed.data.automationId);
    };
    ipcRenderer.on(ipcChannels.automationNavigate, wrapped);
    return () => ipcRenderer.removeListener(ipcChannels.automationNavigate, wrapped);
  },
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
  listProjects: async (input = {}) =>
    invokeProject(ipcChannels.projectList, "project.list", projectListInputSchema.parse(input)),
  getProject: async (input) =>
    invokeProject(ipcChannels.projectGet, "project.get", projectGetInputSchema.parse(input)),
  createProject: async (input) =>
    invokeProject(
      ipcChannels.projectCreate,
      "project.create",
      projectCreateInputSchema.parse(input),
    ),
  updateProject: async (input) =>
    invokeProject(
      ipcChannels.projectUpdate,
      "project.update",
      projectUpdateInputSchema.parse(input),
    ),
  archiveProject: async (input) =>
    invokeProject(
      ipcChannels.projectArchive,
      "project.archive",
      projectArchiveCommandInputSchema.parse(input),
    ),
  restoreProject: async (input) =>
    invokeProject(
      ipcChannels.projectRestore,
      "project.restore",
      projectArchiveCommandInputSchema.parse(input),
    ),
  chooseProjectDirectory: async (input) => {
    const value: unknown = await ipcRenderer.invoke(
      ipcChannels.projectDirectoryChoose,
      projectDirectoryChooseInputSchema.parse(input),
    );
    return value === null ? null : projectDirectoryStateSchema.parse(value);
  },
  setPrimaryProjectDirectory: async (input) =>
    invokeProject(
      ipcChannels.projectDirectorySetPrimary,
      "project.directory.setPrimary",
      projectDirectorySetPrimaryInputSchema.parse(input),
    ),
  disconnectProjectDirectory: async (input) =>
    invokeProject(
      ipcChannels.projectDirectoryDisconnect,
      "project.directory.disconnect",
      projectDirectoryDisconnectInputSchema.parse(input),
    ),
  removeProjectDirectory: async (input) =>
    invokeProject(
      ipcChannels.projectDirectoryRemove,
      "project.directory.remove",
      projectDirectoryRemoveInputSchema.parse(input),
    ),
  moveConversationToProject: async (input) =>
    invokeProject(
      ipcChannels.conversationMoveToProject,
      "conversation.moveToProject",
      conversationMoveToProjectInputSchema.parse(input),
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
  listArtifacts: async (input = {}) =>
    invokeChat(ipcChannels.artifactList, "artifact.list", artifactListInputSchema.parse(input)),
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
  getToolPermissionMode: async (input) =>
    invokeChat(
      ipcChannels.toolPermissionModeGet,
      "tool.permissionMode.get",
      toolPermissionModeGetInputSchema.parse(input),
    ),
  setToolPermissionMode: async (input) =>
    invokeChat(
      ipcChannels.toolPermissionModeSet,
      "tool.permissionMode.set",
      toolPermissionModeSetInputSchema.parse(input),
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
