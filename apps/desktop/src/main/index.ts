import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptBillingTermsInputSchema,
  accountRequestCodeInputSchema,
  accountRevokeDeviceInputSchema,
  accountStateSchema,
  accountVerifyCodeInputSchema,
  artifactGetInputSchema,
  artifactListInputSchema,
  artifactPreviewInputSchema,
  artifactSchema,
  automationCommandEnvelopeSchema,
  automationCreateInputSchema,
  automationGetInputSchema,
  automationListInputSchema,
  automationRunNowInputSchema,
  automationRunsListInputSchema,
  automationSchedulePreviewInputSchema,
  automationSetStatusInputSchema,
  automationUpdateInputSchema,
  billingStatementRequestSchema,
  browserComputerUseSessionControlInputSchema,
  browserSessionDescriptorSchema,
  byokModelRef,
  byokProviderIdSchema,
  byokProviderPresets,
  chatActivateBranchInputSchema,
  chatArchiveInputSchema,
  chatCommandEnvelopeSchema,
  chatDeleteInputSchema,
  chatEditInputSchema,
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
  conversationMemorySettingsGetInputSchema,
  conversationMemorySettingsUpdateInputSchema,
  conversationMoveToProjectInputSchema,
  conversationSnapshotSchema,
  createRechargeOrderInputSchema,
  desktopEnvironmentSchema,
  desktopLoginStartupSettingsSchema,
  desktopLoginStartupSettingsUpdateSchema,
  desktopMcpServerSaveInputSchema,
  desktopNativePermissionRequestSchema,
  desktopNativePermissionResultSchema,
  diagnosticsPreviewSchema,
  emptyInputSchema,
  fileAttachInputSchema,
  fileChooseInputSchema,
  fileListInputSchema,
  filePreviewInputSchema,
  fileRevokeScopeInputSchema,
  fileSearchInputSchema,
  ipcChannels,
  localExportResultSchema,
  localWebSearchRuntimeResetInputSchema,
  localWebSearchSettingsSelectionSchema,
  mcpServerAuthorizeInputSchema,
  mcpServerConfigSchema,
  mcpServerRemoveInputSchema,
  memoryClearInputSchema,
  memoryDeleteInputSchema,
  memoryListInputSchema,
  memoryMergeReviewListInputSchema,
  memoryMergeReviewResolveInputSchema,
  memorySettingsUpdateInputSchema,
  memorySourcesListInputSchema,
  memoryUpsertInputSchema,
  modelServiceSettingsUpdateSchema,
  permissionListInputSchema,
  permissionResolveInputSchema,
  personalDataSummarySchema,
  projectArchiveCommandInputSchema,
  projectCommandEnvelopeSchema,
  projectCreateInputSchema,
  projectDirectoryChooseInputSchema,
  projectDirectoryChoosePrivilegedInputSchema,
  projectDirectoryDisconnectInputSchema,
  projectDirectoryRemoveInputSchema,
  projectDirectorySetPrimaryInputSchema,
  projectGetInputSchema,
  projectListInputSchema,
  projectUpdateInputSchema,
  releaseUpdateStateSchema,
  remoteDesktopEnableInputSchema,
  remoteDesktopRevokeInputSchema,
  skillApprovePermissionsInputSchema,
  skillAutoInvokeInputSchema,
  skillChooseInstallInputSchema,
  skillChooseUpdateInputSchema,
  skillEnableInputSchema,
  skillGetInputSchema,
  skillInvocationListInputSchema,
  skillListInputSchema,
  skillResetPermissionsInputSchema,
  skillRollbackInputSchema,
  skillUninstallInputSchema,
  syncResolveConflictInputSchema,
  toolListInputSchema,
  toolPermissionModeGetInputSchema,
  toolPermissionModeSetInputSchema,
  toolScopeRevokeInputSchema,
  usageQueryInputSchema,
  usageRecordSchema,
  workItemGetInputSchema,
  workspaceChooseInputSchema,
  workspaceListInputSchema,
  workspaceRevokeInputSchema,
} from "@openerx/contracts";
import {
  DiagnosticsService,
  PerformanceBudgetTracker,
  PersonalDataExporter,
} from "@openerx/observability";
import { createMcpOAuthCredentialValue } from "@openerx/tool-sdk";
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import started from "electron-squirrel-startup";
import type { z } from "zod";
import { desktopBrand } from "../../../../packages/branding/src/index";
import { AccountSessionManager, HttpIdentityTransport } from "./account-session-manager";
import { AppServiceSupervisor } from "./app-service-supervisor";
import { automationNotificationContent } from "./automation-notification";
import {
  keepsAutomationRuntimeAliveAfterWindowClose,
  registerAutomationPowerReconciliation,
  shouldHideMainWindowOnClose,
} from "./background-lifecycle";
import { DeviceCredentialVault, ToolCredentialVault } from "./credential-vault";
import { initializeAccountSession } from "./development-account-bootstrap";
import { loadOrCreateDeviceDescriptor } from "./device-identity";
import { assertTrustedIpcSender } from "./ipc-security";
import { DesktopLoginStartupService, isBackgroundLoginStartup } from "./login-startup";
import { memoryNotificationContent } from "./memory-notification";
import { ModelServiceSettingsStore } from "./model-service-settings";
import { PlatformAccountClient } from "./platform-account-client";
import { RemoteDesktopController } from "./remote-desktop-controller";
import {
  recoverVisibleRenderersAfterWake,
  shouldReloadAfterRendererExit,
} from "./renderer-recovery";
import {
  appProtocol,
  createWindowOptions,
  isTrustedExternalUrl,
  resolveRendererAssetPath,
} from "./security";
import { ElectronToolCapabilityHost } from "./tool-capability-host";
import {
  type DesktopAutoUpdater,
  DesktopUpdateService,
  developmentUpdateConfiguration,
  loadPackagedUpdateConfiguration,
} from "./update-service";

const e2eApplicationName =
  process.env.OPENERX_E2E === "1" ? process.env.OPENERX_E2E_APPLICATION_NAME?.trim() : undefined;
if (e2eApplicationName && !/^[A-Za-z0-9 ._-]{1,96}$/u.test(e2eApplicationName)) {
  throw new Error("OPENERX_E2E_APPLICATION_NAME_INVALID");
}
app.name = e2eApplicationName || desktopBrand.productName;

function configureApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: desktopBrand.productName,
        submenu: [
          { role: "about", label: `关于 ${desktopBrand.productName}` },
          { type: "separator" },
          { role: "services", label: "服务" },
          { type: "separator" },
          { role: "hide", label: `隐藏 ${desktopBrand.productName}` },
          { role: "hideOthers", label: "隐藏其他" },
          { role: "unhide", label: "全部显示" },
          { type: "separator" },
          { role: "quit", label: `退出 ${desktopBrand.productName}` },
        ],
      },
      { role: "fileMenu", label: "文件" },
      { role: "editMenu", label: "编辑" },
      { role: "viewMenu", label: "显示" },
      { role: "windowMenu", label: "窗口" },
    ]),
  );
}

const processStartedAt = performance.now();
const performanceBudgets = new PerformanceBudgetTracker(processStartedAt);

protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

if (started) {
  app.quit();
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

const e2eProfileDirectory =
  process.env.OPENERX_E2E === "1" ? process.env.OPENERX_E2E_PROFILE_DIR : undefined;
if (e2eProfileDirectory) {
  app.setPath("userData", path.resolve(e2eProfileDirectory));
} else {
  // Keep existing installations on their original profile directory after the product rename.
  app.setPath("userData", path.join(app.getPath("appData"), "OpenerX"));
}

function registerIpcHandlers(
  supervisor: AppServiceSupervisor,
  accounts: AccountSessionManager,
  baseProfileDirectory: string,
  platformUrl: string | undefined,
  platformClient: PlatformAccountClient | null,
  remote: RemoteDesktopController,
  diagnostics: DiagnosticsService,
  updates: DesktopUpdateService,
  modelSettings: ModelServiceSettingsStore,
  loginStartup: DesktopLoginStartupService,
): void {
  ipcMain.handle(ipcChannels.environmentGet, (event) => {
    assertTrustedIpcSender(event);
    return desktopEnvironmentSchema.parse({
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
    });
  });
  ipcMain.handle(ipcChannels.loginStartupSettingsGet, (event) => {
    assertTrustedIpcSender(event);
    return desktopLoginStartupSettingsSchema.parse(loginStartup.state());
  });
  ipcMain.handle(ipcChannels.loginStartupSettingsUpdate, (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    return desktopLoginStartupSettingsSchema.parse(
      loginStartup.update(desktopLoginStartupSettingsUpdateSchema.parse(raw)),
    );
  });
  ipcMain.handle(ipcChannels.desktopNativePermissionRequest, async (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    const input = desktopNativePermissionRequestSchema.parse(raw);
    if (process.platform !== "darwin") {
      return desktopNativePermissionResultSchema.parse({
        permission: input.permission,
        status: "unavailable",
        reason: "DESKTOP_PLATFORM_UNSUPPORTED",
        settingsOpened: false,
      });
    }
    if (input.permission === "screen_capture") {
      if (systemPreferences.getMediaAccessStatus("screen") === "granted") {
        return desktopNativePermissionResultSchema.parse({
          permission: input.permission,
          status: "granted",
          reason: null,
          settingsOpened: false,
        });
      }
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      );
      return desktopNativePermissionResultSchema.parse({
        permission: input.permission,
        status: "authorization_required",
        reason: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
        settingsOpened: true,
      });
    }
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      );
    }
    return desktopNativePermissionResultSchema.parse({
      permission: input.permission,
      status: trusted ? "granted" : "authorization_required",
      reason: trusted ? null : "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
      settingsOpened: !trusted,
    });
  });
  ipcMain.handle(ipcChannels.browserComputerUseSessions, (event) => {
    assertTrustedIpcSender(event);
    return browserSessionDescriptorSchema
      .array()
      .parse(supervisor.listBrowserComputerUseSessions());
  });
  ipcMain.handle(ipcChannels.browserComputerUsePause, async (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    const input = browserComputerUseSessionControlInputSchema.parse(raw);
    return browserSessionDescriptorSchema.parse(
      await supervisor.pauseBrowserComputerUseSession(input.sessionId),
    );
  });
  ipcMain.handle(ipcChannels.browserComputerUseResume, async (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    const input = browserComputerUseSessionControlInputSchema.parse(raw);
    return browserSessionDescriptorSchema.parse(
      await supervisor.resumeBrowserComputerUseSession(input.sessionId),
    );
  });
  ipcMain.handle(ipcChannels.releaseUpdateState, (event) => {
    assertTrustedIpcSender(event);
    return releaseUpdateStateSchema.parse(updates.state());
  });
  ipcMain.handle(ipcChannels.releaseUpdateCheck, async (event) => {
    assertTrustedIpcSender(event);
    return releaseUpdateStateSchema.parse(await updates.check());
  });
  ipcMain.handle(ipcChannels.releaseUpdateInstall, (event) => {
    assertTrustedIpcSender(event);
    return releaseUpdateStateSchema.parse(updates.install());
  });

  const activeDatabasePath = (): string => {
    const accountId = accounts.state().account?.accountId;
    const directory = accountId
      ? path.join(baseProfileDirectory, "accounts", accountId)
      : baseProfileDirectory;
    return path.join(directory, "openerx-v2.sqlite");
  };
  ipcMain.handle(ipcChannels.diagnosticsPreview, (event) => {
    assertTrustedIpcSender(event);
    return diagnosticsPreviewSchema.parse(diagnostics.preview());
  });
  ipcMain.handle(ipcChannels.diagnosticsExport, async (event) => {
    assertTrustedIpcSender(event);
    const e2eDirectory = process.env.OPENERX_E2E_EXPORT_DIR;
    const e2ePath =
      process.env.OPENERX_E2E === "1" && e2eDirectory
        ? path.join(e2eDirectory, "openerx-diagnostics.json")
        : null;
    const selection = e2ePath
      ? { canceled: false, filePath: e2ePath }
      : await dialog.showSaveDialog({
          title: "导出脱敏诊断包",
          defaultPath: path.join(app.getPath("documents"), "openerx-diagnostics.json"),
          filters: [{ name: `${desktopBrand.productName} 诊断包`, extensions: ["json"] }],
        });
    if (selection.canceled || !selection.filePath) return null;
    diagnostics.record({ source: "desktop", level: "info", code: "diagnostics.exported" });
    return localExportResultSchema.parse(
      diagnostics.export(selection.filePath, {
        platform: process.platform,
        arch: process.arch,
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
      }),
    );
  });
  ipcMain.handle(ipcChannels.personalDataSummary, (event) => {
    assertTrustedIpcSender(event);
    return personalDataSummarySchema.parse(
      new PersonalDataExporter(activeDatabasePath()).summary(),
    );
  });
  ipcMain.handle(ipcChannels.personalDataExport, async (event) => {
    assertTrustedIpcSender(event);
    const e2eDirectory = process.env.OPENERX_E2E_EXPORT_DIR;
    const e2ePath =
      process.env.OPENERX_E2E === "1" && e2eDirectory
        ? path.join(e2eDirectory, "openerx-personal-data.zip")
        : null;
    const selection = e2ePath
      ? { canceled: false, filePath: e2ePath }
      : await dialog.showSaveDialog({
          title: "导出个人数据",
          defaultPath: path.join(app.getPath("documents"), "openerx-personal-data.zip"),
          filters: [{ name: `${desktopBrand.productName} 个人数据`, extensions: ["zip"] }],
        });
    if (selection.canceled || !selection.filePath) return null;
    diagnostics.record({ source: "desktop", level: "info", code: "personal_data.exported" });
    return localExportResultSchema.parse(
      new PersonalDataExporter(activeDatabasePath()).export(selection.filePath),
    );
  });

  ipcMain.handle(ipcChannels.accountState, (event) => {
    assertTrustedIpcSender(event);
    return accountStateSchema.parse(accounts.state());
  });
  ipcMain.handle(ipcChannels.accountDevices, async (event) => {
    assertTrustedIpcSender(event);
    return await accounts.listDevices();
  });
  ipcMain.handle(ipcChannels.accountRequestCode, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = accountRequestCodeInputSchema.parse(input);
    return await accounts.requestCode(parsed.email);
  });
  ipcMain.handle(ipcChannels.accountVerifyCode, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = accountVerifyCodeInputSchema.parse(input);
    const state = await accounts.verifyCode(parsed.challengeId, parsed.code);
    if (state.account) {
      await supervisor.switchProfile(
        path.join(baseProfileDirectory, "accounts", state.account.accountId),
        state.account.accountId,
      );
      await remote.resume();
    }
    return state;
  });
  ipcMain.handle(ipcChannels.accountSignOut, async (event) => {
    assertTrustedIpcSender(event);
    await remote.prepareSignOut();
    const state = await accounts.signOut();
    await supervisor.switchProfile(baseProfileDirectory, "local-default");
    return state;
  });
  ipcMain.handle(ipcChannels.accountSignOutAll, async (event) => {
    assertTrustedIpcSender(event);
    await remote.prepareSignOut();
    const state = await accounts.signOutAll();
    await supervisor.switchProfile(baseProfileDirectory, "local-default");
    return state;
  });
  ipcMain.handle(ipcChannels.accountRevokeDevice, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = accountRevokeDeviceInputSchema.parse(input);
    if (parsed.sessionId === accounts.state().session?.sessionId) await remote.prepareSignOut();
    const state = await accounts.revokeDevice(parsed.sessionId);
    if (state.status !== "signed_in") {
      await supervisor.switchProfile(baseProfileDirectory, "local-default");
    }
    return state;
  });

  ipcMain.handle(ipcChannels.remoteState, async (event) => {
    assertTrustedIpcSender(event);
    return await remote.state();
  });
  ipcMain.handle(ipcChannels.remoteEnable, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    return await remote.setEnabled(remoteDesktopEnableInputSchema.parse(input).enabled);
  });
  ipcMain.handle(ipcChannels.remotePairingChallenge, async (event) => {
    assertTrustedIpcSender(event);
    return await remote.createPairingChallenge();
  });
  ipcMain.handle(ipcChannels.remotePairingRevoke, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = remoteDesktopRevokeInputSchema.parse(input);
    return await remote.revokePairing(parsed.pairingId);
  });

  ipcMain.handle(ipcChannels.modelList, async (event) => {
    assertTrustedIpcSender(event);
    const settings = await modelSettings.state();
    const presetModels = byokProviderPresets.flatMap((provider) =>
      provider.models.map((model) => ({
        modelRef: byokModelRef(provider.id, model.id),
        displayName: `${provider.label} · ${model.label}`,
        version: model.configuration.modelId,
        capabilities: {
          textInput: true,
          imageInput: model.configuration.capabilities.imageInput,
          fileInput: false,
          functionCalling: model.configuration.capabilities.functionCalling,
          structuredOutput: false,
        },
        contextWindow: model.configuration.contextWindow,
        maxOutputTokens: model.configuration.maxOutputTokens,
        status: settings.providerCredentials[provider.id]
          ? ("available" as const)
          : ("unavailable" as const),
        priceRef: `byok/${provider.id}`,
        priceSummary: `${provider.label} 直接计费`,
        free: false,
        thinkingLevels: model.configuration.capabilities.reasoning
          ? (["off", "medium", "high"] as const)
          : (["off"] as const),
      })),
    );
    const customByokModel =
      settings.byok && settings.credentialConfigured
        ? {
            modelRef: "platform/byok" as const,
            displayName: settings.byok.displayName,
            version: "user-configured",
            capabilities: {
              textInput: true,
              imageInput: settings.byok.capabilities.imageInput,
              fileInput: false,
              functionCalling: settings.byok.capabilities.functionCalling,
              structuredOutput: false,
            },
            contextWindow: settings.byok.contextWindow,
            maxOutputTokens: settings.byok.maxOutputTokens,
            status: settings.credentialConfigured
              ? ("available" as const)
              : ("unavailable" as const),
            priceRef: "byok/user-provider",
            priceSummary: "由 API 提供商直接计费",
            free: false,
            thinkingLevels: settings.byok.capabilities.reasoning
              ? (["off", "medium", "high"] as const)
              : (["off"] as const),
          }
        : null;
    if (settings.mode === "byok") {
      return customByokModel ? [...presetModels, customByokModel] : presetModels;
    }
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    const hostedModels = await platformClient.listModels(await accounts.accessToken());
    return customByokModel ? [...hostedModels, customByokModel] : hostedModels;
  });
  ipcMain.handle(ipcChannels.modelServiceSettingsGet, async (event) => {
    assertTrustedIpcSender(event);
    return await modelSettings.state();
  });
  ipcMain.handle(ipcChannels.modelServiceSettingsUpdate, async (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    return await modelSettings.update(modelServiceSettingsUpdateSchema.parse(raw));
  });
  ipcMain.handle(ipcChannels.modelServiceConnectionTest, async (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    return await modelSettings.test(modelServiceSettingsUpdateSchema.parse(raw));
  });
  ipcMain.handle(ipcChannels.modelServiceApiKeyClear, async (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    return await modelSettings.clearApiKey(
      raw === undefined ? undefined : byokProviderIdSchema.parse(raw),
    );
  });
  ipcMain.handle(ipcChannels.usageGet, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.usage(
      await accounts.accessToken(),
      usageQueryInputSchema.parse(input ?? {}),
    );
  });
  ipcMain.handle(ipcChannels.usageRecords, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return usageRecordSchema
      .array()
      .parse(
        await platformClient.usageRecords(
          await accounts.accessToken(),
          usageQueryInputSchema.parse(input ?? {}),
        ),
      );
  });
  ipcMain.handle(ipcChannels.billingTerms, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.billingTerms(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.billingAcceptTerms, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    const parsed = acceptBillingTermsInputSchema.parse(input);
    return await platformClient.acceptBillingTerms(await accounts.accessToken(), parsed.version);
  });
  ipcMain.handle(ipcChannels.billingOverview, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.billingOverview(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.billingCharges, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.charges(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.billingLedger, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.ledger(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.billingRechargeCreate, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.createRechargeOrder(
      await accounts.accessToken(),
      createRechargeOrderInputSchema.parse(input),
    );
  });
  ipcMain.handle(ipcChannels.billingRechargeList, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.rechargeOrders(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.billingRefundList, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    return await platformClient.refunds(await accounts.accessToken());
  });
  ipcMain.handle(ipcChannels.billingStatementExport, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    const parsed = billingStatementRequestSchema.parse(input);
    return await platformClient.billingStatement(await accounts.accessToken(), parsed.month);
  });
  ipcMain.handle(ipcChannels.cloudDataDelete, async (event) => {
    assertTrustedIpcSender(event);
    if (!platformUrl || !platformClient) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    const accessToken = await accounts.accessToken();
    await supervisor.request(
      chatCommandEnvelopeSchema.parse({ command: "cache.clear", input: {} }),
    );
    return await platformClient.deleteCloudData(accessToken);
  });

  const registerChatHandler = <T>(
    channel: string,
    command: z.input<typeof chatCommandEnvelopeSchema>["command"],
    inputSchema: { parse: (value: unknown) => T },
    needsAuthorization = false,
    needsAccountAuthorization = false,
  ): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      assertTrustedIpcSender(event);
      const request = chatCommandEnvelopeSchema.parse({
        command,
        input: inputSchema.parse(input),
      });
      const modelService = needsAuthorization ? await modelSettings.state() : undefined;
      const launchesGeneration =
        request.command === "chat.send" ||
        request.command === "chat.regenerate" ||
        request.command === "chat.edit";
      let selectedModelRef: string | undefined;
      if (launchesGeneration) {
        if (request.command === "chat.send" && request.input.modelRef) {
          selectedModelRef = request.input.modelRef;
        } else {
          const conversationId = request.input.conversationId;
          if (conversationId) {
            const snapshot = conversationSnapshotSchema.parse(
              await supervisor.request(
                chatCommandEnvelopeSchema.parse({
                  command: "chat.get",
                  input: { conversationId },
                }),
              ),
            );
            selectedModelRef = snapshot.conversation.selectedModelRef;
          }
        }
      }
      const byok =
        modelService?.mode === "byok" && launchesGeneration
          ? await modelSettings.execution(selectedModelRef)
          : undefined;
      const authorization =
        (needsAccountAuthorization || (needsAuthorization && modelService?.mode !== "byok")) &&
        platformUrl &&
        accounts.state().status === "signed_in"
          ? await accounts.authorization(platformUrl)
          : undefined;
      return await supervisor.request(request, authorization, 15_000, byok);
    });
  };

  const registerAutomationHandler = <T>(
    channel: string,
    command: z.input<typeof automationCommandEnvelopeSchema>["command"],
    inputSchema: { parse: (value: unknown) => T },
  ): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      assertTrustedIpcSender(event);
      const request = automationCommandEnvelopeSchema.parse({
        command,
        input: inputSchema.parse(input),
      });
      const authorization =
        platformUrl && accounts.state().status === "signed_in"
          ? await accounts.authorization(platformUrl)
          : undefined;
      return await supervisor.request(request, authorization);
    });
  };

  const registerProjectHandler = <T>(
    channel: string,
    command: z.input<typeof projectCommandEnvelopeSchema>["command"],
    inputSchema: { parse: (value: unknown) => T },
  ): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      assertTrustedIpcSender(event);
      const request = projectCommandEnvelopeSchema.parse({
        command,
        input: inputSchema.parse(input),
      });
      const authorization =
        platformUrl && accounts.state().status === "signed_in"
          ? await accounts.authorization(platformUrl)
          : undefined;
      return await supervisor.request(request, authorization);
    });
  };

  ipcMain.handle(ipcChannels.toolRuntimeReadiness, async (event) => {
    assertTrustedIpcSender(event);
    const modelService = await modelSettings.state();
    const hosted = modelService.mode === "hosted";
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "tool.runtime.readiness",
        input: {
          authenticated: hosted && accounts.state().status === "signed_in",
          platformConfigured: hosted && Boolean(platformUrl),
        },
      }),
    );
  });

  registerChatHandler(ipcChannels.chatList, "chat.list", chatListInputSchema);
  registerChatHandler(ipcChannels.chatGet, "chat.get", chatGetInputSchema);
  registerChatHandler(ipcChannels.chatSend, "chat.send", chatSendInputSchema, true, true);
  registerChatHandler(ipcChannels.chatStop, "chat.stop", chatStopInputSchema, true);
  registerChatHandler(
    ipcChannels.chatRegenerate,
    "chat.regenerate",
    chatRegenerateInputSchema,
    true,
    true,
  );
  registerChatHandler(ipcChannels.chatEdit, "chat.edit", chatEditInputSchema, true, true);
  registerChatHandler(ipcChannels.chatRename, "chat.rename", chatRenameInputSchema, true);
  registerChatHandler(ipcChannels.chatArchive, "chat.archive", chatArchiveInputSchema, true);
  registerChatHandler(ipcChannels.chatDelete, "chat.delete", chatDeleteInputSchema, true, true);
  registerChatHandler(
    ipcChannels.chatSelectModel,
    "chat.selectModel",
    chatSelectModelInputSchema,
    true,
  );
  registerChatHandler(
    ipcChannels.chatSelectThinkingLevel,
    "chat.selectThinkingLevel",
    chatSelectThinkingLevelInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.chatSearch, "chat.search", chatSearchInputSchema);
  registerChatHandler(
    ipcChannels.chatActivateBranch,
    "chat.activateBranch",
    chatActivateBranchInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.chatEvents, "chat.events", chatEventsInputSchema);
  registerChatHandler(ipcChannels.syncNow, "sync.now", emptyInputSchema, true);
  registerChatHandler(ipcChannels.syncConflicts, "sync.conflicts", emptyInputSchema);
  registerChatHandler(
    ipcChannels.syncResolveConflict,
    "sync.resolve",
    syncResolveConflictInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.localCacheClear, "cache.clear", emptyInputSchema);
  registerChatHandler(ipcChannels.memorySettingsGet, "memory.settings.get", emptyInputSchema);
  registerChatHandler(
    ipcChannels.memorySettingsUpdate,
    "memory.settings.update",
    memorySettingsUpdateInputSchema,
    false,
    true,
  );
  registerChatHandler(
    ipcChannels.memoryConversationSettingsGet,
    "memory.conversation.settings.get",
    conversationMemorySettingsGetInputSchema,
  );
  registerChatHandler(
    ipcChannels.memoryConversationSettingsUpdate,
    "memory.conversation.settings.update",
    conversationMemorySettingsUpdateInputSchema,
    false,
    true,
  );
  registerChatHandler(ipcChannels.memoryList, "memory.list", memoryListInputSchema);
  registerChatHandler(
    ipcChannels.memoryMergeReviewsList,
    "memory.merge-reviews.list",
    memoryMergeReviewListInputSchema,
  );
  registerChatHandler(
    ipcChannels.memoryMergeReviewResolve,
    "memory.merge-reviews.resolve",
    memoryMergeReviewResolveInputSchema,
    false,
    true,
  );
  registerChatHandler(
    ipcChannels.memorySourcesList,
    "memory.sources.list",
    memorySourcesListInputSchema,
  );
  registerChatHandler(
    ipcChannels.memoryUpsert,
    "memory.upsert",
    memoryUpsertInputSchema,
    false,
    true,
  );
  registerChatHandler(
    ipcChannels.memoryDelete,
    "memory.delete",
    memoryDeleteInputSchema,
    false,
    true,
  );
  registerChatHandler(ipcChannels.memoryClear, "memory.clear", memoryClearInputSchema, false, true);
  registerAutomationHandler(
    ipcChannels.automationCreate,
    "automation.create",
    automationCreateInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationList,
    "automation.list",
    automationListInputSchema,
  );
  registerAutomationHandler(ipcChannels.automationGet, "automation.get", automationGetInputSchema);
  registerAutomationHandler(
    ipcChannels.automationUpdate,
    "automation.update",
    automationUpdateInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationPause,
    "automation.pause",
    automationSetStatusInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationResume,
    "automation.resume",
    automationSetStatusInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationDelete,
    "automation.delete",
    automationSetStatusInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationRunNow,
    "automation.runNow",
    automationRunNowInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationRunsList,
    "automation.runs.list",
    automationRunsListInputSchema,
  );
  registerAutomationHandler(
    ipcChannels.automationSchedulePreview,
    "automation.schedule.preview",
    automationSchedulePreviewInputSchema,
  );
  registerProjectHandler(ipcChannels.projectList, "project.list", projectListInputSchema);
  registerProjectHandler(ipcChannels.projectGet, "project.get", projectGetInputSchema);
  registerProjectHandler(ipcChannels.projectCreate, "project.create", projectCreateInputSchema);
  registerProjectHandler(ipcChannels.projectUpdate, "project.update", projectUpdateInputSchema);
  registerProjectHandler(
    ipcChannels.projectArchive,
    "project.archive",
    projectArchiveCommandInputSchema,
  );
  registerProjectHandler(
    ipcChannels.projectRestore,
    "project.restore",
    projectArchiveCommandInputSchema,
  );
  ipcMain.handle(ipcChannels.fileChoose, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = fileChooseInputSchema.parse(input ?? {});
    const selection = await dialog.showOpenDialog({
      title: "添加文件",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "支持的文件",
          extensions: [
            "pdf",
            "docx",
            "xlsx",
            "csv",
            "pptx",
            "txt",
            "md",
            "json",
            "yaml",
            "yml",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "html",
            "htm",
            "ts",
            "tsx",
            "js",
            "jsx",
            "py",
            "go",
            "rs",
          ],
        },
      ],
    });
    if (selection.canceled) return [];
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "file.import",
        input: { localPaths: selection.filePaths, conversationId: parsed.conversationId },
      }),
    );
  });
  ipcMain.handle(ipcChannels.directoryChoose, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = fileChooseInputSchema.parse(input ?? {});
    const selection = await dialog.showOpenDialog({
      title: "添加文件夹",
      properties: ["openDirectory"],
    });
    if (selection.canceled) return [];
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "file.import",
        input: { localPaths: selection.filePaths, conversationId: parsed.conversationId },
      }),
    );
  });
  ipcMain.handle(ipcChannels.workspaceChoose, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = workspaceChooseInputSchema.parse(input ?? {});
    const selection = await dialog.showOpenDialog({
      title: "授权项目工作区",
      properties: ["openDirectory"],
      message: `${desktopBrand.productName} 只能在你明确授权的目录内读取或修改文件`,
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "workspace.grant",
        input: { ...parsed, rootPath: selection.filePaths[0] },
      }),
    );
  });
  ipcMain.handle(ipcChannels.projectDirectoryChoose, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = projectDirectoryChooseInputSchema.parse(input ?? {});
    const selection = await dialog.showOpenDialog({
      title: parsed.projectDirectoryId ? "重新连接项目目录" : "添加项目目录",
      properties: ["openDirectory"],
      message: `${desktopBrand.productName} 只能在你明确授权的项目目录内读取或修改文件`,
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return await supervisor.request(
      projectCommandEnvelopeSchema.parse({
        command: "project.directory.choose",
        input: projectDirectoryChoosePrivilegedInputSchema.parse({
          ...parsed,
          rootPath: selection.filePaths[0],
        }),
      }),
    );
  });
  registerProjectHandler(
    ipcChannels.projectDirectorySetPrimary,
    "project.directory.setPrimary",
    projectDirectorySetPrimaryInputSchema,
  );
  registerProjectHandler(
    ipcChannels.projectDirectoryDisconnect,
    "project.directory.disconnect",
    projectDirectoryDisconnectInputSchema,
  );
  registerProjectHandler(
    ipcChannels.projectDirectoryRemove,
    "project.directory.remove",
    projectDirectoryRemoveInputSchema,
  );
  registerProjectHandler(
    ipcChannels.conversationMoveToProject,
    "conversation.moveToProject",
    conversationMoveToProjectInputSchema,
  );
  registerChatHandler(ipcChannels.workspaceList, "workspace.list", workspaceListInputSchema);
  registerChatHandler(ipcChannels.workspaceRevoke, "workspace.revoke", workspaceRevokeInputSchema);
  registerChatHandler(ipcChannels.fileList, "file.list", fileListInputSchema);
  registerChatHandler(ipcChannels.fileSearch, "file.search", fileSearchInputSchema);
  registerChatHandler(ipcChannels.filePreview, "file.preview", filePreviewInputSchema);
  registerChatHandler(ipcChannels.fileScopeRevoke, "file.scope.revoke", fileRevokeScopeInputSchema);
  registerChatHandler(ipcChannels.fileAttach, "file.attach", fileAttachInputSchema);
  registerChatHandler(ipcChannels.artifactList, "artifact.list", artifactListInputSchema);
  registerChatHandler(ipcChannels.artifactGet, "artifact.get", artifactGetInputSchema);
  registerChatHandler(ipcChannels.artifactPreview, "artifact.preview", artifactPreviewInputSchema);
  registerChatHandler(ipcChannels.toolWorkItemsList, "tool.workItems.list", toolListInputSchema);
  registerChatHandler(ipcChannels.toolWorkItemGet, "tool.workItem.get", workItemGetInputSchema);
  registerChatHandler(
    ipcChannels.localWebSearchSettingsGet,
    "tool.webSearch.settings.get",
    emptyInputSchema,
  );
  registerChatHandler(
    ipcChannels.localWebSearchSettingsUpdate,
    "tool.webSearch.settings.update",
    localWebSearchSettingsSelectionSchema,
  );
  registerChatHandler(
    ipcChannels.localWebSearchRuntimeReset,
    "tool.webSearch.runtime.reset",
    localWebSearchRuntimeResetInputSchema,
  );
  registerChatHandler(
    ipcChannels.toolPermissionsList,
    "tool.permissions.list",
    permissionListInputSchema,
  );
  registerChatHandler(
    ipcChannels.toolPermissionResolve,
    "tool.permission.resolve",
    permissionResolveInputSchema,
  );
  registerChatHandler(
    ipcChannels.toolPermissionModeGet,
    "tool.permissionMode.get",
    toolPermissionModeGetInputSchema,
  );
  registerChatHandler(
    ipcChannels.toolPermissionModeSet,
    "tool.permissionMode.set",
    toolPermissionModeSetInputSchema,
  );
  registerChatHandler(ipcChannels.toolScopesList, "tool.scopes.list", emptyInputSchema);
  registerChatHandler(ipcChannels.toolScopeRevoke, "tool.scope.revoke", toolScopeRevokeInputSchema);
  registerChatHandler(ipcChannels.mcpServersList, "mcp.servers.list", emptyInputSchema);
  registerChatHandler(
    ipcChannels.mcpServersAuthorization,
    "mcp.servers.authorization",
    emptyInputSchema,
  );
  registerChatHandler(ipcChannels.skillList, "skill.list", skillListInputSchema);
  registerChatHandler(ipcChannels.skillGet, "skill.get", skillGetInputSchema);
  registerChatHandler(ipcChannels.skillEnable, "skill.enable", skillEnableInputSchema, true);
  registerChatHandler(
    ipcChannels.skillAutoInvoke,
    "skill.autoInvoke",
    skillAutoInvokeInputSchema,
    true,
  );
  registerChatHandler(
    ipcChannels.skillPermissionsApprove,
    "skill.permissions.approve",
    skillApprovePermissionsInputSchema,
    true,
  );
  registerChatHandler(
    ipcChannels.skillPermissionsReset,
    "skill.permissions.reset",
    skillResetPermissionsInputSchema,
    true,
  );
  registerChatHandler(ipcChannels.skillRollback, "skill.rollback", skillRollbackInputSchema, true);
  registerChatHandler(
    ipcChannels.skillUninstall,
    "skill.uninstall",
    skillUninstallInputSchema,
    true,
  );
  registerChatHandler(
    ipcChannels.skillInvocationsList,
    "skill.invocations.list",
    skillInvocationListInputSchema,
  );
  const chooseSkillSource = async (
    title: string,
  ): Promise<{ sourcePath: string; sourceKind: "local_directory" | "archive" } | null> => {
    const choice = await dialog.showMessageBox({
      type: "question",
      title,
      message: "选择 Skill 包来源",
      detail: "目录应包含 SKILL.md；归档当前支持 ZIP。",
      buttons: ["选择目录", "选择 ZIP", "取消"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 2) return null;
    const sourceKind = choice.response === 0 ? "local_directory" : "archive";
    const selection = await dialog.showOpenDialog({
      title,
      properties: sourceKind === "local_directory" ? ["openDirectory"] : ["openFile"],
      ...(sourceKind === "archive"
        ? { filters: [{ name: "Skill ZIP", extensions: ["zip"] }] }
        : {}),
    });
    const sourcePath = selection.filePaths[0];
    return selection.canceled || !sourcePath ? null : { sourcePath, sourceKind };
  };
  ipcMain.handle(ipcChannels.skillChooseInstall, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = skillChooseInstallInputSchema.parse(input);
    const source = await chooseSkillSource("安装 Skill");
    if (!source) return null;
    const authorization = platformUrl ? await accounts.authorization(platformUrl) : undefined;
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "skill.install",
        input: { ...parsed, ...source },
      }),
      authorization,
    );
  });
  ipcMain.handle(ipcChannels.skillChooseUpdate, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = skillChooseUpdateInputSchema.parse(input);
    const source = await chooseSkillSource("更新 Skill");
    if (!source) return null;
    const authorization = platformUrl ? await accounts.authorization(platformUrl) : undefined;
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "skill.update",
        input: { ...parsed, ...source },
      }),
      authorization,
    );
  });
  ipcMain.handle(ipcChannels.mcpServerSave, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = desktopMcpServerSaveInputSchema.parse(input);
    let config = parsed.config;
    if (config.transport === "streamable_http") {
      let credentialRef = config.auth === "none" ? null : config.credentialRef;
      if (config.auth === "bearer" && parsed.bearerToken) {
        credentialRef = `mcp:${config.id}`;
        await supervisor.saveCapabilityCredential(credentialRef, parsed.bearerToken);
      }
      if (config.auth === "oauth") {
        credentialRef = `mcp:${config.id}`;
        await supervisor.saveCapabilityCredential(
          credentialRef,
          createMcpOAuthCredentialValue({
            ...(parsed.oauthClientId ? { clientId: parsed.oauthClientId } : {}),
            ...(parsed.oauthScope ? { scope: parsed.oauthScope } : {}),
          }),
        );
      }
      if (config.auth !== "none" && !credentialRef) throw new Error("MCP_CREDENTIAL_REQUIRED");
      config = mcpServerConfigSchema.parse({ ...config, credentialRef });
    }
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({ command: "mcp.server.upsert", input: { config } }),
    );
  });
  ipcMain.handle(ipcChannels.mcpServerAuthorize, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = mcpServerAuthorizeInputSchema.parse(input);
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({ command: "mcp.server.authorize", input: parsed }),
      undefined,
      5 * 60_000,
    );
  });
  ipcMain.handle(ipcChannels.mcpServerRemove, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = mcpServerRemoveInputSchema.parse(input);
    const servers = mcpServerConfigSchema
      .array()
      .parse(
        await supervisor.request(
          chatCommandEnvelopeSchema.parse({ command: "mcp.servers.list", input: {} }),
        ),
      );
    const server = servers.find(({ id }) => id === parsed.serverId);
    const removed = await supervisor.request(
      chatCommandEnvelopeSchema.parse({ command: "mcp.server.remove", input: parsed }),
    );
    if (server?.transport === "streamable_http" && server.credentialRef) {
      await supervisor.clearCapabilityCredential(server.credentialRef);
    }
    return removed;
  });
  ipcMain.handle(ipcChannels.artifactSave, async (event, input: unknown) => {
    assertTrustedIpcSender(event);
    const parsed = artifactGetInputSchema.parse(input);
    const artifact = artifactSchema.parse(
      await supervisor.request(
        chatCommandEnvelopeSchema.parse({ command: "artifact.get", input: parsed }),
      ),
    );
    const selection = await dialog.showSaveDialog({
      title: "保存成果副本",
      defaultPath: path.join(app.getPath("documents"), artifact.displayName),
    });
    if (selection.canceled || !selection.filePath) return null;
    return await supervisor.request(
      chatCommandEnvelopeSchema.parse({
        command: "artifact.export",
        input: { artifactId: artifact.id, destinationPath: selection.filePath },
      }),
    );
  });
}

function registerAppProtocol(): void {
  const rendererRoot = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  protocol.handle(appProtocol, (request) => {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const assetPath = resolveRendererAssetPath(rendererRoot, request.url);
    if (!assetPath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

function createMainWindow(diagnostics: DiagnosticsService): BrowserWindow {
  const mainWindow = new BrowserWindow(createWindowOptions(path.join(__dirname, "preload.js")));
  let rendererReloadPending = false;
  mainWindows.add(mainWindow);

  mainWindow.once("closed", () => {
    mainWindows.delete(mainWindow);
  });

  mainWindow.on("close", (event) => {
    if (!shouldHideMainWindowOnClose(process.platform, quitRequested)) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.once("ready-to-show", () => {
    performanceBudgets.markDesktopInteractive();
    diagnostics.record({ source: "renderer", level: "info", code: "renderer.interactive" });
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    rendererReloadPending = false;
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    diagnostics.record({
      source: "renderer",
      level: details.reason === "clean-exit" ? "info" : "error",
      code: "renderer.process_gone",
      attributes: { reason: details.reason, exitCode: details.exitCode },
    });
    if (
      quitRequested ||
      rendererReloadPending ||
      !shouldReloadAfterRendererExit(details.reason) ||
      mainWindow.isDestroyed()
    ) {
      return;
    }
    rendererReloadPending = true;
    setTimeout(() => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.reload();
    }, 250);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadURL(`${appProtocol}://renderer/index.html`);
  }

  return mainWindow;
}

let supervisor: AppServiceSupervisor | null = null;
let backgroundTray: Tray | null = null;
let quitRequested = false;
let activeDiagnostics: DiagnosticsService | null = null;
let reopenRequested = false;
let unregisterAutomationPowerReconciliation: (() => void) | null = null;
const mainWindows = new Set<BrowserWindow>();

function showMainWindow(diagnostics: DiagnosticsService): BrowserWindow {
  const window = BrowserWindow.getAllWindows()[0] ?? createMainWindow(diagnostics);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

async function createBackgroundTray(diagnostics: DiagnosticsService): Promise<void> {
  if (!keepsAutomationRuntimeAliveAfterWindowClose(process.platform) || backgroundTray) return;
  let icon = desktopBrand.logoDataUrl
    ? nativeImage.createFromDataURL(desktopBrand.logoDataUrl)
    : nativeImage.createEmpty();
  if (icon.isEmpty()) icon = await app.getFileIcon(process.execPath, { size: "small" });
  backgroundTray = new Tray(icon.resize({ width: 16, height: 16 }));
  backgroundTray.setToolTip(`${desktopBrand.productName} · 自动化后台运行中`);
  backgroundTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "自动化在后台运行", enabled: false },
      { type: "separator" },
      { label: `打开 ${desktopBrand.productName}`, click: () => showMainWindow(diagnostics) },
      {
        label: `退出 ${desktopBrand.productName}（停止自动化）`,
        click: () => {
          quitRequested = true;
          app.quit();
        },
      },
    ]),
  );
  backgroundTray.on("click", () => showMainWindow(diagnostics));
}

app.on("second-instance", () => {
  if (activeDiagnostics) showMainWindow(activeDiagnostics);
  else reopenRequested = true;
});

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  configureApplicationMenu();
  const profileDirectory = app.getPath("userData");
  mkdirSync(profileDirectory, { recursive: true });
  const diagnostics = new DiagnosticsService(
    path.join(profileDirectory, "logs", "diagnostics.jsonl"),
    performanceBudgets,
  );
  activeDiagnostics = diagnostics;
  diagnostics.record({ source: "desktop", level: "info", code: "desktop.started" });
  const device = await loadOrCreateDeviceDescriptor(
    path.join(profileDirectory, "account", "device.json"),
    process.platform,
    process.arch,
  );
  const desktopPlatform = process.platform === "darwin" ? "darwin" : "win32";
  const desktopArch = process.arch === "arm64" ? "arm64" : "x64";
  const updates = new DesktopUpdateService({
    configuration: app.isPackaged
      ? loadPackagedUpdateConfiguration(app.getAppPath())
      : developmentUpdateConfiguration(),
    currentVersion: app.getVersion(),
    platform: desktopPlatform,
    arch: desktopArch,
    cohortId: device.deviceId,
    updater: autoUpdater as unknown as DesktopAutoUpdater,
    fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
  });
  const platformUrl = process.env.OPENERX_PLATFORM_URL;
  const developmentLoopbackPlatform =
    !app.isPackaged && platformUrl?.startsWith("http://127.0.0.1:");
  if (
    platformUrl &&
    !platformUrl.startsWith("https://") &&
    !developmentLoopbackPlatform &&
    !(process.env.OPENERX_E2E === "1" && platformUrl.startsWith("http://127.0.0.1:"))
  ) {
    throw new Error("OPENERX_PLATFORM_URL must use HTTPS outside loopback E2E");
  }
  const accounts = new AccountSessionManager({
    vault: new DeviceCredentialVault(path.join(profileDirectory, "account", "device-session.bin")),
    transport: platformUrl ? new HttpIdentityTransport(platformUrl) : null,
    device,
  });
  const developmentAccountBootstrap =
    developmentLoopbackPlatform && process.env.OPENERX_DEV_AUTO_SIGN_IN === "1"
      ? {
          email: process.env.OPENERX_DEV_EMAIL ?? "desktop-dev@openerx.local",
          code: process.env.OPENERX_DEV_EMAIL_CODE ?? "123456",
        }
      : null;
  await initializeAccountSession(accounts, developmentAccountBootstrap);
  const piHostEntry =
    process.env.OPENERX_E2E === "1" && process.env.OPENERX_E2E_USE_PLATFORM !== "1"
      ? "pi-host-test.js"
      : "pi-host.js";
  const accountState = accounts.state();
  const activeProfileDirectory = accountState.account
    ? path.join(profileDirectory, "accounts", accountState.account.accountId)
    : profileDirectory;
  supervisor = new AppServiceSupervisor(
    activeProfileDirectory,
    piHostEntry,
    accountState.account?.accountId ?? "local-default",
    device.deviceId,
    (directory) =>
      new ElectronToolCapabilityHost(
        directory,
        new ToolCredentialVault(path.join(directory, "credentials", "tool-credentials.bin")),
      ),
    path.join(app.getPath("documents"), desktopBrand.workspaceDirectoryName),
  );
  const remote = new RemoteDesktopController(
    supervisor,
    accounts,
    profileDirectory,
    platformUrl,
    device,
    app.getVersion(),
  );
  const modelSettings = new ModelServiceSettingsStore(
    path.join(profileDirectory, "model-service.json"),
    new ToolCredentialVault(path.join(profileDirectory, "credentials", "model-service.bin")),
  );
  const loginStartup = new DesktopLoginStartupService(app, process.platform, process.execPath);
  supervisor.setAutomationExecutionContextProvider(async (modelRef) => {
    const settings = await modelSettings.state();
    const authorization =
      platformUrl && accounts.state().status === "signed_in"
        ? await accounts.authorization(platformUrl)
        : undefined;
    if (settings.mode === "byok") {
      const byok = await modelSettings.execution(modelRef);
      if (!byok) throw new Error("BYOK_API_KEY_REQUIRED");
      return { ...(authorization ? { authorization } : {}), byok };
    }
    if (!platformUrl) throw new Error("PLATFORM_ENDPOINT_NOT_CONFIGURED");
    if (!authorization) throw new Error("AUTHENTICATION_REQUIRED");
    return { authorization };
  });
  unregisterAutomationPowerReconciliation = registerAutomationPowerReconciliation(
    powerMonitor,
    supervisor,
    {
      onSuspend: (suspendedAt) => {
        diagnostics.record({
          source: "desktop",
          level: "info",
          code: "automation.scheduler.suspended",
          attributes: { suspendedAt },
        });
      },
      onResume: ({ suspendedAt, resumedAt }) => {
        diagnostics.record({
          source: "desktop",
          level: "info",
          code: "automation.scheduler.resume_reconcile_requested",
          attributes: { suspendedAt, resumedAt },
        });
        void recoverVisibleRenderersAfterWake([...mainWindows])
          .then((results) => {
            for (const result of results) {
              if (result.action === "skipped") continue;
              diagnostics.record({
                source: "renderer",
                level: result.action === "reloaded" ? "warning" : "info",
                code:
                  result.action === "reloaded"
                    ? "renderer.wake_reloaded"
                    : "renderer.wake_repainted",
                ...(result.action === "reloaded" ? { attributes: { reason: result.reason } } : {}),
              });
            }
          })
          .catch((error: unknown) => {
            diagnostics.record({
              source: "renderer",
              level: "error",
              code: "renderer.wake_recovery_failed",
              attributes: { reason: error instanceof Error ? error.message : "unknown" },
            });
          });
      },
      onError: (error) => {
        diagnostics.record({
          source: "desktop",
          level: "error",
          code: "automation.scheduler.resume_reconcile_failed",
          attributes: { reason: error instanceof Error ? error.message : "unknown" },
        });
      },
    },
  );
  if (process.env.OPENERX_E2E === "1") {
    Object.assign(globalThis, {
      __openerxCrashAppServiceForTest: () => supervisor?.crashAppServiceForTest(),
    });
  }
  supervisor.onEvent((event) => {
    if (event.type === "service.status" && event.payload.status) {
      const status = event.payload.status;
      if (status === "ready") performanceBudgets.markAppServiceReady();
      diagnostics.record({
        source: "app_service",
        level: status === "unavailable" ? "error" : status === "restarting" ? "warning" : "info",
        code: `service.${status}`,
        ...(event.payload.reason ? { attributes: { reason: event.payload.reason } } : {}),
      });
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.chatEvent, event);
    }
  });
  const notifiedAutomationRuns = new Set<string>();
  supervisor.onAutomationRun((run) => {
    diagnostics.record({
      source: "app_service",
      level:
        run.status === "failed" || run.status === "interrupted"
          ? "error"
          : run.status === "needs_attention"
            ? "warning"
            : "info",
      code: `automation.run.${run.status}`,
      attributes: { automationId: run.automationId, runId: run.id },
    });
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.automationRunEvent, run);
    }
    const content = automationNotificationContent(run);
    const notificationKey = `${run.id}:${run.status}`;
    if (!content || notifiedAutomationRuns.has(notificationKey) || !Notification.isSupported()) {
      return;
    }
    notifiedAutomationRuns.add(notificationKey);
    const notification = new Notification(content);
    notification.on("click", () => {
      const existingWindow = BrowserWindow.getAllWindows()[0];
      const window = existingWindow ?? createMainWindow(diagnostics);
      const navigate = () =>
        window.webContents.send(ipcChannels.automationNavigate, run.automationId);
      if (existingWindow) navigate();
      else window.webContents.once("did-finish-load", navigate);
      window.show();
      window.focus();
    });
    notification.show();
  });
  const notifiedMemoryEvents = new Set<string>();
  supervisor.onAutomaticMemoryCreated((event) => {
    diagnostics.record({
      source: "app_service",
      level: "info",
      code: "memory.automatic.created",
      attributes: {
        eventId: event.eventId,
        jobId: event.jobId,
        conversationId: event.conversationId,
        count: event.memories.length,
      },
    });
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.memoryCreatedEvent, event);
    }
    if (notifiedMemoryEvents.has(event.eventId) || !Notification.isSupported()) return;
    notifiedMemoryEvents.add(event.eventId);
    const notification = new Notification(memoryNotificationContent(event));
    notification.on("click", () => {
      const existingWindow = BrowserWindow.getAllWindows()[0];
      const window = existingWindow ?? createMainWindow(diagnostics);
      const memoryId = event.memories[0]?.id;
      const navigate = () => window.webContents.send(ipcChannels.memoryNavigate, memoryId);
      if (existingWindow) navigate();
      else window.webContents.once("did-finish-load", navigate);
      window.show();
      window.focus();
    });
    notification.show();
  });
  updates.onState((state) => {
    diagnostics.record({
      source: "desktop",
      level: state.status === "error" ? "error" : "info",
      code: `update.${state.status}`,
      ...(state.reason ? { attributes: { reason: state.reason } } : {}),
    });
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.releaseUpdateEvent, state);
    }
  });
  registerAppProtocol();
  registerIpcHandlers(
    supervisor,
    accounts,
    profileDirectory,
    platformUrl,
    platformUrl ? new PlatformAccountClient(platformUrl) : null,
    remote,
    diagnostics,
    updates,
    modelSettings,
    loginStartup,
  );
  await createBackgroundTray(diagnostics);
  void supervisor.start().catch((error: unknown) => {
    diagnostics.record({
      source: "app_service",
      level: "error",
      code: "service.start_failed",
      attributes: { reason: error instanceof Error ? error.message : "unknown" },
    });
  });
  void remote.resume();
  if (!isBackgroundLoginStartup(process.platform, process.argv) || reopenRequested) {
    createMainWindow(diagnostics);
  }
  if (updates.state().status === "idle") void updates.check();

  app.on("activate", () => {
    showMainWindow(diagnostics);
  });
});

app.on("before-quit", () => {
  quitRequested = true;
  activeDiagnostics = null;
  unregisterAutomationPowerReconciliation?.();
  unregisterAutomationPowerReconciliation = null;
  backgroundTray?.destroy();
  backgroundTray = null;
  supervisor?.stop();
});

app.on("window-all-closed", () => {
  if (
    process.platform !== "darwin" &&
    !keepsAutomationRuntimeAliveAfterWindowClose(process.platform)
  ) {
    app.quit();
  }
});
