// @vitest-environment jsdom

import type {
  BrowserSessionDescriptor,
  ChatEvent,
  ConversationSnapshot,
  DesktopBridge,
  LocalWebSearchSettingsState,
  ModelCatalogEntry,
  PersonalFile,
  SkillInstallation,
  WorkItem,
  WorkItemDetail,
} from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";

const conversationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userMessageId = "33333333-3333-4333-8333-333333333333";
const assistantMessageId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-08-25T09:00:00.000Z";
const skillInstallation: SkillInstallation = {
  id: "55555555-5555-4555-8555-555555555555",
  ownerProfileId: "local-default",
  name: "structured-report",
  displayName: "结构化报告",
  description: "把输入整理为结构化报告。",
  version: "1.0.0",
  publisher: "OpenerX",
  scope: "builtin",
  workspaceId: null,
  sourceKind: "built_in",
  sourceLabel: "OpenerX bundled skills",
  checksumSha256: "a".repeat(64),
  trust: "bundled",
  enabled: true,
  autoInvoke: true,
  packageState: "installed",
  permissionDigest: "b".repeat(64),
  approvedPermissionDigest: "b".repeat(64),
  declaredTools: ["openerx_skill_script"],
  declaredMcpServers: [],
  permissions: [],
  platforms: ["darwin", "win32"],
  rollbackVersions: [],
  installedAt: timestamp,
  updatedAt: timestamp,
  lastUsedAt: null,
  revision: 1,
};

const thinkingModel: ModelCatalogEntry = {
  modelRef: "pi/default",
  displayName: "默认推理模型",
  version: "2026-08-26",
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: true,
    structuredOutput: true,
  },
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  status: "available",
  priceRef: "price/test",
  priceSummary: "测试计量",
  free: true,
  thinkingLevels: ["off", "medium"],
};

const snapshot: ConversationSnapshot = {
  conversation: {
    id: conversationId,
    ownerProfileId: "local-default",
    title: "Markdown 验收",
    activeBranchId: branchId,
    selectedModelRef: "pi/default",
    thinkingLevel: "medium",
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    deletedAt: null,
    revision: 3,
  },
  branches: [
    {
      id: branchId,
      conversationId,
      parentBranchId: null,
      forkedFromMessageId: null,
      label: "主分支",
      createdAt: timestamp,
    },
  ],
  messages: [
    {
      id: userMessageId,
      conversationId,
      branchId,
      parentMessageId: null,
      role: "user",
      status: "completed",
      parts: [{ id: crypto.randomUUID(), type: "text", text: "生成代码块和表格" }],
      errorCode: null,
      cancellationRequestedAt: null,
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    },
    {
      id: assistantMessageId,
      conversationId,
      branchId,
      parentMessageId: userMessageId,
      role: "assistant",
      status: "completed",
      parts: [
        {
          id: crypto.randomUUID(),
          type: "text",
          text: "```ts\nconst ready = true;\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| Chat | ready |",
        },
      ],
      errorCode: null,
      cancellationRequestedAt: null,
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 2,
    },
  ],
  attachments: [],
};

function createBridge(): DesktopBridge {
  return {
    getEnvironment: vi.fn().mockResolvedValue({
      platform: "darwin",
      arch: "arm64",
      appVersion: "2.0.0-alpha.0",
    }),
    requestDesktopNativePermission: vi.fn().mockResolvedValue({
      permission: "accessibility",
      status: "authorization_required",
      reason: "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
      settingsOpened: true,
    }),
    listBrowserComputerUseSessions: vi.fn().mockResolvedValue([]),
    pauseBrowserComputerUseSession: vi.fn(),
    resumeBrowserComputerUseSession: vi.fn(),
    getReleaseUpdateState: vi.fn().mockResolvedValue({
      status: "disabled",
      channel: "internal",
      currentVersion: "2.0.0-alpha.0",
      availableVersion: null,
      progressPercentage: null,
      lastCheckedAt: null,
      reason: "UPDATE_NOT_CONFIGURED",
    }),
    checkForReleaseUpdate: vi.fn(),
    installReleaseUpdate: vi.fn(),
    onReleaseUpdateState: vi.fn().mockReturnValue(() => undefined),
    getDiagnosticsPreview: vi.fn().mockResolvedValue({
      generatedAt: timestamp,
      health: "ready",
      eventCount: 3,
      errorCount: 0,
      warningCount: 0,
      restartCount: 0,
      firstEventAt: timestamp,
      lastEventAt: timestamp,
      sources: ["desktop", "app_service", "renderer"],
      performance: [
        { name: "desktop_interactive", value: 420, unit: "ms", budget: 5_000, status: "pass" },
        { name: "app_service_ready", value: 360, unit: "ms", budget: 5_000, status: "pass" },
        { name: "idle_rss", value: 180, unit: "mib", budget: 512, status: "pass" },
      ],
      includes: ["应用版本与运行平台"],
      excludes: ["对话与 Prompt 正文"],
    }),
    exportDiagnostics: vi.fn(),
    getPersonalDataSummary: vi.fn().mockResolvedValue({
      generatedAt: timestamp,
      conversations: 1,
      messages: 2,
      files: 0,
      artifacts: 0,
      workItems: 0,
      skillInstallations: 1,
    }),
    exportPersonalData: vi.fn(),
    getAccountState: vi.fn().mockResolvedValue({
      status: "signed_out",
      account: null,
      session: null,
      reason: null,
    }),
    listDevices: vi.fn().mockResolvedValue([]),
    requestEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    revokeDevice: vi.fn(),
    getRemoteState: vi.fn().mockResolvedValue({
      available: false,
      enabled: false,
      host: null,
      pairings: [],
      reason: "AUTHENTICATION_REQUIRED",
    }),
    setRemoteEnabled: vi.fn(),
    createRemotePairingChallenge: vi.fn(),
    revokeRemotePairing: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    getUsage: vi.fn(),
    getUsageRecords: vi.fn().mockResolvedValue([]),
    getBillingTerms: vi.fn(),
    acceptBillingTerms: vi.fn(),
    getBillingOverview: vi.fn(),
    listCharges: vi.fn().mockResolvedValue([]),
    listLedger: vi.fn().mockResolvedValue([]),
    createRechargeOrder: vi.fn(),
    listRechargeOrders: vi.fn().mockResolvedValue([]),
    listRefunds: vi.fn().mockResolvedValue([]),
    exportBillingStatement: vi.fn(),
    syncNow: vi.fn(),
    listSyncConflicts: vi.fn().mockResolvedValue([]),
    resolveSyncConflict: vi.fn(),
    clearLocalCache: vi.fn(),
    deleteCloudData: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([]),
    getConversation: vi.fn().mockResolvedValue(snapshot),
    sendMessage: vi.fn().mockResolvedValue({
      conversationId,
      branchId,
      userMessageId,
      assistantMessageId,
    }),
    stopGeneration: vi.fn(),
    regenerateMessage: vi.fn(),
    editMessage: vi.fn(),
    renameConversation: vi.fn(),
    setConversationArchived: vi.fn(),
    deleteConversation: vi.fn(),
    selectConversationModel: vi.fn(),
    selectConversationThinkingLevel: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    activateBranch: vi.fn(),
    getChatEvents: vi.fn().mockResolvedValue([]),
    chooseFiles: vi.fn().mockResolvedValue([]),
    chooseDirectory: vi.fn().mockResolvedValue([]),
    chooseWorkspace: vi.fn().mockResolvedValue(null),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    revokeWorkspace: vi.fn(),
    listFiles: vi.fn().mockResolvedValue([]),
    searchFiles: vi.fn().mockResolvedValue([]),
    previewFile: vi.fn(),
    revokeFileScope: vi.fn(),
    attachFile: vi.fn(),
    listArtifacts: vi.fn().mockResolvedValue([]),
    getArtifact: vi.fn(),
    previewArtifact: vi.fn(),
    saveArtifact: vi.fn(),
    listToolRuntimeReadiness: vi.fn().mockResolvedValue([]),
    getLocalWebSearchSettings: vi.fn().mockResolvedValue({
      providerId: "direct:baidu-json",
      locale: "zh-CN",
      safeSearch: "moderate",
      featureEnabled: true,
      allowProviderFallback: false,
      cacheMode: "turn",
      updatedAt: null,
      providers: [
        {
          descriptor: {
            providerId: "direct:baidu-json",
            displayName: "百度 JSON（Local Alpha）",
            transport: "json",
            stability: "unofficial",
            releaseEligible: false,
            requiresDailyProbe: true,
          },
          selected: true,
          status: "available",
          consecutiveThrottleFailures: 0,
          backedOffUntil: null,
          lastErrorCode: null,
          lastFailureAt: null,
          lastSuccessAt: null,
        },
        {
          descriptor: {
            providerId: "direct:bing-html",
            displayName: "Bing HTML（Local Alpha）",
            transport: "html",
            stability: "unofficial",
            releaseEligible: false,
            requiresDailyProbe: true,
          },
          selected: false,
          status: "available",
          consecutiveThrottleFailures: 0,
          backedOffUntil: null,
          lastErrorCode: null,
          lastFailureAt: null,
          lastSuccessAt: null,
        },
      ],
    }),
    updateLocalWebSearchSettings: vi.fn(),
    resetLocalWebSearchRuntime: vi.fn(),
    listWorkItems: vi.fn().mockResolvedValue([]),
    getWorkItem: vi.fn(),
    listPermissionRequests: vi.fn().mockResolvedValue([]),
    resolvePermission: vi.fn(),
    listCapabilityScopes: vi.fn().mockResolvedValue([]),
    revokeCapabilityScope: vi.fn(),
    listMcpServers: vi.fn().mockResolvedValue([]),
    listMcpServerAuthorizationStates: vi.fn().mockResolvedValue([]),
    authorizeMcpServer: vi.fn(),
    saveMcpServer: vi.fn(),
    removeMcpServer: vi.fn(),
    listSkills: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn(),
    chooseAndInstallSkill: vi.fn(),
    chooseAndUpdateSkill: vi.fn(),
    setSkillEnabled: vi.fn(),
    setSkillAutoInvoke: vi.fn(),
    approveSkillPermissions: vi.fn(),
    resetSkillPermissions: vi.fn(),
    rollbackSkill: vi.fn(),
    uninstallSkill: vi.fn(),
    listSkillInvocations: vi.fn().mockResolvedValue([]),
    onChatEvent: vi.fn().mockReturnValue(() => undefined),
  };
}

function renderApp(bridge: DesktopBridge, initialEntry = "/chat/new"): void {
  Object.defineProperty(window, "openerx", { configurable: true, value: bridge });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("M1 chat renderer", () => {
  it("applies model deltas immediately through one Codex-style waterfall response", async () => {
    const bridge = createBridge();
    const userSnapshot = snapshot.messages[0];
    const assistantSnapshot = snapshot.messages[1];
    const assistantPart = assistantSnapshot?.parts[0];
    if (!userSnapshot || !assistantSnapshot || !assistantPart) {
      throw new Error("CHAT_STREAM_FIXTURE_INVALID");
    }
    const streamingMessage = {
      ...assistantSnapshot,
      status: "streaming" as const,
      parts: [{ ...assistantPart, text: "第一段" }],
      revision: 3,
    };
    vi.mocked(bridge.getConversation).mockResolvedValue({
      ...snapshot,
      messages: [userSnapshot, streamingMessage],
    });
    let listener: ((event: ChatEvent) => void) | undefined;
    vi.mocked(bridge.onChatEvent).mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    renderApp(bridge, `/chat/${conversationId}`);

    expect(await screen.findByText("第一段")).toBeTruthy();
    await waitFor(() => expect(listener).toBeTypeOf("function"));
    const assistant = document.querySelector<HTMLElement>(".message-assistant");
    expect(assistant?.getAttribute("aria-busy")).toBe("true");
    expect(assistant?.querySelector(".response-waterfall .stream-tail")).toBeTruthy();

    const event: ChatEvent = {
      eventId: crypto.randomUUID(),
      type: "message.delta",
      conversationId,
      messageId: assistantMessageId,
      sequence: 1,
      occurredAt: timestamp,
      payloadVersion: 1,
      payload: {
        delta: "第二段",
        message: {
          ...streamingMessage,
          parts: [{ ...assistantPart, text: "第一段第二段" }],
          revision: 4,
        },
      },
    };
    act(() => listener?.(event));

    expect(await screen.findByText("第一段第二段")).toBeTruthy();
    expect(bridge.getConversation).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("sends through the narrow bridge and renders GFM code and tables", async () => {
    const bridge = createBridge();
    renderApp(bridge);
    expect(document.querySelector<HTMLImageElement>(".brand-mark img")?.getAttribute("src")).toBe(
      "/assets/china-unicom-logo.png",
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("发送消息"), "生成代码块和表格");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("heading", { name: "Markdown 验收" })).toBeTruthy();
    expect(document.querySelector(".markdown-body pre")).toBeTruthy();
    expect(document.querySelector(".markdown-body table")).toBeTruthy();
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null, text: "生成代码块和表格" }),
    );
  });

  it("selects thinking strength for a new task and persists changes for later messages", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listModels).mockResolvedValue([thinkingModel]);
    renderApp(bridge);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("新任务思考强度"), "off");
    await user.type(screen.getByLabelText("发送消息"), "快速回答");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "快速回答", thinkingLevel: "off" }),
    );
    cleanup();

    const conversationBridge = createBridge();
    vi.mocked(conversationBridge.listModels).mockResolvedValue([thinkingModel]);
    vi.mocked(conversationBridge.selectConversationThinkingLevel).mockResolvedValue({
      ...snapshot.conversation,
      thinkingLevel: "off",
      revision: snapshot.conversation.revision + 1,
    });
    renderApp(conversationBridge, `/chat/${conversationId}`);

    const conversationThinking = await screen.findByLabelText("后续消息思考强度");
    await waitFor(() => expect((conversationThinking as HTMLSelectElement).disabled).toBe(false));
    await userEvent.setup().selectOptions(conversationThinking, "off");
    await waitFor(() =>
      expect(conversationBridge.selectConversationThinkingLevel).toHaveBeenCalledWith({
        conversationId,
        thinkingLevel: "off",
      }),
    );
  });

  it("carries images selected before a new conversation into the first send", async () => {
    cleanup();
    const bridge = createBridge();
    const personalFileId = crypto.randomUUID();
    vi.mocked(bridge.chooseFiles).mockResolvedValue([
      {
        id: personalFileId,
        ownerProfileId: "local-default",
        displayName: "vision.png",
        format: "png",
        mediaType: "image/png",
        sizeBytes: 12,
        checksumSha256: "a".repeat(64),
        objectRef: `objects/sha256/aa/${"a".repeat(64)}`,
        sourceScopeId: crypto.randomUUID(),
        sourceRelativePath: "vision.png",
        parseStatus: "ready",
        parseErrorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      },
    ]);
    vi.mocked(bridge.previewFile).mockResolvedValue({
      objectKind: "personal_file",
      objectId: personalFileId,
      displayName: "vision.png",
      format: "png",
      source: null,
      imageDataUrl: "data:image/png;base64,aW1hZ2U=",
      renderedSurfaces: [],
      parsedText: "",
      citations: [],
    });
    renderApp(bridge);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "添加附件" }));
    expect(await screen.findByText("已选择 1 个附件，将随本条消息发送。")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "vision.png" })).toBeTruthy();
    await user.type(screen.getByLabelText("发送消息"), "解析这张图片");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(bridge.chooseFiles).toHaveBeenCalledWith({ conversationId: null });
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        text: "解析这张图片",
        personalFileIds: [personalFileId],
      }),
    );
  });

  it("keeps an existing-chat image pending until send and supports removing it", async () => {
    cleanup();
    const bridge = createBridge();
    const personalFileId = crypto.randomUUID();
    const file: PersonalFile = {
      id: personalFileId,
      ownerProfileId: "local-default",
      displayName: "existing-chat.png",
      format: "png",
      mediaType: "image/png",
      sizeBytes: 18,
      checksumSha256: "b".repeat(64),
      objectRef: `objects/sha256/bb/${"b".repeat(64)}`,
      sourceScopeId: crypto.randomUUID(),
      sourceRelativePath: "existing-chat.png",
      parseStatus: "ready",
      parseErrorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    vi.mocked(bridge.chooseFiles).mockResolvedValue([file]);
    vi.mocked(bridge.previewFile).mockResolvedValue({
      objectKind: "personal_file",
      objectId: personalFileId,
      displayName: file.displayName,
      format: "png",
      source: null,
      imageDataUrl: "data:image/png;base64,aW1hZ2U=",
      renderedSurfaces: [],
      parsedText: "",
      citations: [],
    });
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "添加附件" }));
    expect(bridge.chooseFiles).toHaveBeenCalledWith({ conversationId: null });
    expect(await screen.findByRole("img", { name: file.displayName })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: `移除附件 ${file.displayName}` }));
    expect(screen.queryByRole("img", { name: file.displayName })).toBeNull();

    await user.click(screen.getByRole("button", { name: "添加附件" }));
    await user.type(screen.getByLabelText("发送消息"), "继续解析图片");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        text: "继续解析图片",
        personalFileIds: [personalFileId],
      }),
    );
  });

  it("renders a sent image on the user message that owns the attachment", async () => {
    cleanup();
    const bridge = createBridge();
    const personalFileId = crypto.randomUUID();
    const file: PersonalFile = {
      id: personalFileId,
      ownerProfileId: "local-default",
      displayName: "sent-image.webp",
      format: "webp",
      mediaType: "image/webp",
      sizeBytes: 24,
      checksumSha256: "c".repeat(64),
      objectRef: `objects/sha256/cc/${"c".repeat(64)}`,
      sourceScopeId: crypto.randomUUID(),
      sourceRelativePath: "sent-image.webp",
      parseStatus: "ready",
      parseErrorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    vi.mocked(bridge.getConversation).mockResolvedValue({
      ...snapshot,
      attachments: [
        {
          id: crypto.randomUUID(),
          conversationId,
          messageId: userMessageId,
          personalFileId,
          createdAt: timestamp,
        },
      ],
    });
    vi.mocked(bridge.listFiles).mockResolvedValue([file]);
    vi.mocked(bridge.previewFile).mockResolvedValue({
      objectKind: "personal_file",
      objectId: personalFileId,
      displayName: file.displayName,
      format: "webp",
      source: null,
      imageDataUrl: "data:image/webp;base64,aW1hZ2U=",
      renderedSurfaces: [],
      parsedText: "",
      citations: [],
    });

    renderApp(bridge, `/chat/${conversationId}`);

    const userText = await screen.findByText("生成代码块和表格");
    const userMessage = userText.closest("article");
    if (!userMessage) throw new Error("USER_MESSAGE_NOT_FOUND");
    expect(await within(userMessage).findByRole("img", { name: file.displayName })).toBeTruthy();
    expect(within(userMessage).getByLabelText("消息附件")).toBeTruthy();
    expect(document.querySelector(".message-assistant img")).toBeNull();
  });

  it("lets users select and persist system, dark and light themes", async () => {
    window.localStorage.removeItem("openerx.theme");
    const bridge = createBridge();
    renderApp(bridge, "/settings/account");
    const user = userEvent.setup();

    expect(await screen.findByRole("radiogroup", { name: "主题" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect((screen.getByRole("radio", { name: /跟随系统/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    await waitFor(() => expect(document.documentElement.dataset.themePreference).toBe("system"));

    await user.click(screen.getByRole("radio", { name: /浅色/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(window.localStorage.getItem("openerx.theme")).toBe("light");

    await user.click(screen.getByRole("radio", { name: /深色/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(window.localStorage.getItem("openerx.theme")).toBe("dark");

    await user.click(screen.getByRole("radio", { name: /跟随系统/ }));
    await waitFor(() => expect(document.documentElement.dataset.themePreference).toBe("system"));
    expect(window.localStorage.getItem("openerx.theme")).toBe("system");

    window.localStorage.removeItem("openerx.theme");
  });

  it("previews diagnostics separately from personal data before export", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.exportDiagnostics).mockResolvedValue({
      kind: "diagnostics",
      fileName: "openerx-diagnostics.json",
      bytes: 512,
      checksumSha256: "a".repeat(64),
      exportedAt: timestamp,
    });
    vi.mocked(bridge.exportPersonalData).mockResolvedValue({
      kind: "personal_data",
      fileName: "openerx-personal-data.zip",
      bytes: 1_024,
      checksumSha256: "b".repeat(64),
      exportedAt: timestamp,
    });
    renderApp(bridge, "/settings/account");
    const user = userEvent.setup();

    expect(await screen.findByText("对话与 Prompt 正文", { exact: false })).toBeTruthy();
    const panel = screen.getByLabelText("诊断与数据导出");
    expect(panel).toBeTruthy();
    if (!panel) throw new Error("Diagnostics panel missing");
    expect(within(panel).getByText("对话与 Prompt 正文", { exact: false })).toBeTruthy();
    expect(
      within(panel).getByText("Token、报价、费用和账单只读取服务端记录", { exact: false }),
    ).toBeTruthy();
    expect(within(panel).getAllByText(/达标/)).toHaveLength(3);
    expect(within(panel).getAllByText(/MiB/)).toHaveLength(2);
    await user.click(within(panel).getByRole("button", { name: "导出脱敏诊断包" }));
    expect(await within(panel).findByText("诊断包已保存：openerx-diagnostics.json")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "导出个人数据" }));
    expect(
      await within(panel).findByText("个人数据已保存：openerx-personal-data.zip"),
    ).toBeTruthy();
  });

  it("shows release updates as signed-package state without exposing a feed URL", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.getReleaseUpdateState).mockResolvedValue({
      status: "downloaded",
      channel: "stable",
      currentVersion: "2.0.0",
      availableVersion: "2.0.1",
      progressPercentage: 100,
      lastCheckedAt: timestamp,
      reason: null,
    });
    vi.mocked(bridge.installReleaseUpdate).mockResolvedValue({
      status: "downloaded",
      channel: "stable",
      currentVersion: "2.0.0",
      availableVersion: "2.0.1",
      progressPercentage: 100,
      lastCheckedAt: timestamp,
      reason: null,
    });
    renderApp(bridge, "/settings/account");
    const panel = await screen.findByLabelText("应用更新");
    expect(await within(panel).findByText("可用版本 2.0.1")).toBeTruthy();
    expect(panel.textContent).not.toContain("https://");
    await userEvent.setup().click(within(panel).getByRole("button", { name: "安装并重启" }));
    expect(bridge.installReleaseUpdate).toHaveBeenCalledOnce();
  });

  it("selects an enabled Skill in the composer and exposes lifecycle metadata", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listSkills).mockResolvedValue([skillInstallation]);
    renderApp(bridge);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("选择 Skill"), skillInstallation.id);
    await user.type(screen.getByLabelText("发送消息"), "生成报告");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ skillInstallationId: skillInstallation.id, text: "生成报告" }),
    );
    cleanup();

    const managementBridge = createBridge();
    vi.mocked(managementBridge.listSkills).mockResolvedValue([skillInstallation]);
    renderApp(managementBridge, "/assistants");
    expect(await screen.findByRole("heading", { name: "助手与 Skill" })).toBeTruthy();
    expect(screen.getByText("结构化报告")).toBeTruthy();
    expect(screen.getByText(/OpenerX 内置 Skill/)).toBeTruthy();
    expect(screen.getByText(/工具：Skill 脚本执行器/)).toBeTruthy();
  });

  it("shows HTML source and an isolated preview without bridge privileges", async () => {
    const bridge = createBridge();
    const personalFileId = crypto.randomUUID();
    const scopeId = crypto.randomUUID();
    vi.mocked(bridge.listFiles).mockResolvedValue([
      {
        id: personalFileId,
        ownerProfileId: "local-default",
        displayName: "preview.html",
        format: "html",
        mediaType: "text/html",
        sizeBytes: 120,
        checksumSha256: "a".repeat(64),
        objectRef: `objects/sha256/aa/${"a".repeat(64)}`,
        sourceScopeId: scopeId,
        sourceRelativePath: "preview.html",
        parseStatus: "ready",
        parseErrorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 2,
      },
    ]);
    vi.mocked(bridge.previewFile).mockResolvedValue({
      objectKind: "personal_file",
      objectId: personalFileId,
      displayName: "preview.html",
      format: "html",
      source: "<h1>isolated</h1><script>window.probe = typeof window.openerx</script>",
      imageDataUrl: null,
      renderedSurfaces: [],
      parsedText: "isolated",
      citations: [],
    });
    renderApp(bridge, "/files");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /preview\.html/ }));
    const frame = await screen.findByTitle("HTML 隔离预览");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("window.openerx");
    await user.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.getByText(/window\.openerx/)).toBeTruthy();
  });

  it("saves the current immutable artifact version through the native bridge", async () => {
    const bridge = createBridge();
    const artifactId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    vi.mocked(bridge.listArtifacts).mockResolvedValue([
      {
        id: artifactId,
        ownerProfileId: "local-default",
        displayName: "report.md",
        format: "markdown",
        mediaType: "text/markdown",
        currentVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        versions: [
          {
            id: versionId,
            artifactId,
            version: 1,
            sizeBytes: 9,
            checksumSha256: "b".repeat(64),
            objectRef: `objects/sha256/bb/${"b".repeat(64)}`,
            sourcePersonalFileId: null,
            createdAt: timestamp,
          },
        ],
      },
    ]);
    vi.mocked(bridge.previewArtifact).mockResolvedValue({
      objectKind: "artifact",
      objectId: artifactId,
      displayName: "report.md",
      format: "markdown",
      source: "# report",
      imageDataUrl: null,
      renderedSurfaces: [],
      parsedText: "# report",
      citations: [],
    });
    vi.mocked(bridge.saveArtifact).mockResolvedValue({
      artifactId,
      fileName: "report.md",
      version: 1,
    });

    renderApp(bridge, "/files");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /report\.md/ }));
    await user.click(screen.getByRole("button", { name: "下载 / 另存" }));
    await waitFor(() => expect(bridge.saveArtifact).toHaveBeenCalledWith({ artifactId }));
    expect(await screen.findByText("已保存 report.md")).toBeTruthy();
  });

  it("renders every Office page, sheet or slide instead of falling back to parsed text", async () => {
    const bridge = createBridge();
    const artifactId = crypto.randomUUID();
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64")}`;
    const png = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
    vi.mocked(bridge.listArtifacts).mockResolvedValue([
      {
        id: artifactId,
        ownerProfileId: "local-default",
        displayName: "slides.pptx",
        format: "pptx",
        mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        currentVersion: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 2,
        versions: [
          {
            id: crypto.randomUUID(),
            artifactId,
            version: 2,
            sizeBytes: 2_048,
            checksumSha256: "c".repeat(64),
            objectRef: `objects/sha256/cc/${"c".repeat(64)}`,
            sourcePersonalFileId: null,
            createdAt: timestamp,
          },
        ],
      },
    ]);
    vi.mocked(bridge.previewArtifact).mockResolvedValue({
      objectKind: "artifact",
      objectId: artifactId,
      displayName: "slides.pptx",
      format: "pptx",
      source: null,
      imageDataUrl: null,
      renderedSurfaces: [
        {
          kind: "slide",
          index: 1,
          label: "幻灯片 1",
          imageDataUrl: svg,
          modelImageDataUrl: png,
        },
        {
          kind: "slide",
          index: 2,
          label: "幻灯片 2",
          imageDataUrl: svg,
          modelImageDataUrl: png,
        },
      ],
      parsedText: "This fallback must stay hidden",
      citations: [],
    });

    renderApp(bridge, "/files");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /slides\.pptx/ }));
    expect(await screen.findByRole("img", { name: "slides.pptx 幻灯片 1" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "slides.pptx 幻灯片 2" })).toBeTruthy();
    expect(screen.queryByText("This fallback must stay hidden")).toBeNull();
  });

  it("exposes M2 device, sync, usage and data boundaries in account settings", async () => {
    const bridge = createBridge();
    const accountId = crypto.randomUUID();
    const currentSessionId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    const accountState = {
      status: "signed_in" as const,
      account: {
        accountId,
        email: "account@example.com",
        displayName: "Account",
        createdAt: timestamp,
      },
      session: {
        sessionId: currentSessionId,
        accountId,
        device: {
          deviceId: crypto.randomUUID(),
          name: "Current Mac",
          platform: "darwin" as const,
          arch: "arm64" as const,
        },
        sessionVersion: 1,
        createdAt: timestamp,
        lastActiveAt: timestamp,
        revokedAt: null,
      },
      reason: null,
    };
    vi.mocked(bridge.getAccountState).mockResolvedValue(accountState);
    vi.mocked(bridge.listDevices).mockResolvedValue([
      accountState.session,
      {
        ...accountState.session,
        sessionId: otherSessionId,
        device: {
          ...accountState.session.device,
          deviceId: crypto.randomUUID(),
          name: "Other Windows",
          platform: "win32",
          arch: "x64",
        },
      },
    ]);
    vi.mocked(bridge.syncNow).mockResolvedValue({
      cursor: "cursor:2",
      pushed: 0,
      pulled: 0,
      pending: 0,
      conflicts: 0,
      syncedAt: timestamp,
    });
    vi.mocked(bridge.getUsage).mockResolvedValue({
      accountId,
      conversationId: null,
      messageId: null,
      records: 1,
      inputTokens: { known: 10, unknownRecords: 0 },
      cachedInputTokens: { known: 2, unknownRecords: 0 },
      outputTokens: { known: 5, unknownRecords: 0 },
      reasoningTokens: { known: 0, unknownRecords: 1 },
      totalTokens: { known: 17, unknownRecords: 0 },
    });
    vi.mocked(bridge.revokeDevice).mockResolvedValue(accountState);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(bridge.clearLocalCache).mockResolvedValue({ clearedAt: timestamp });

    renderApp(bridge, "/settings/account");
    expect(await screen.findByText("Current Mac", { exact: false })).toBeTruthy();
    expect(await screen.findByText("Other Windows", { exact: false })).toBeTruthy();
    expect(await screen.findByText("总计 17")).toBeTruthy();
    expect(await screen.findByText(/待上传 0 · 冲突 0/)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "撤销设备" }));
    expect(bridge.revokeDevice).toHaveBeenCalledWith({ sessionId: otherSessionId });
    await user.click(screen.getByRole("button", { name: "清理本机缓存" }));
    expect(confirm).toHaveBeenCalled();
    expect(bridge.clearLocalCache).toHaveBeenCalled();
  });

  it("renders only server-returned billing state and sends no token or quote inputs", async () => {
    const bridge = createBridge();
    const accountId = crypto.randomUUID();
    vi.mocked(bridge.getAccountState).mockResolvedValue({
      status: "signed_in",
      account: {
        accountId,
        email: "billing@example.com",
        displayName: "Billing Account",
        createdAt: timestamp,
      },
      session: {
        sessionId: crypto.randomUUID(),
        accountId,
        device: {
          deviceId: crypto.randomUUID(),
          name: "Billing Mac",
          platform: "darwin",
          arch: "arm64",
        },
        sessionVersion: 1,
        createdAt: timestamp,
        lastActiveAt: timestamp,
        revokedAt: null,
      },
      reason: null,
    });
    vi.mocked(bridge.getBillingTerms).mockResolvedValue({
      terms: {
        version: "terms-v1",
        effectiveAt: timestamp,
        contentHash: "a".repeat(64),
        summary: "按服务端实际用量结算。",
      },
      acceptance: null,
    });
    vi.mocked(bridge.acceptBillingTerms).mockResolvedValue({
      accountId,
      termsVersion: "terms-v1",
      acceptedAt: timestamp,
    });
    vi.mocked(bridge.getBillingOverview).mockResolvedValue({
      accountId,
      currency: "CNY",
      quotaGrants: [],
      pointGrants: [],
      cash: {
        accountId,
        currency: "CNY",
        postedMinor: 5_000,
        reservedMinor: 0,
        availableMinor: 5_000,
        updatedAt: timestamp,
      },
      quotaAvailableMinor: 1_000,
      pointAvailableMinor: 500,
      totalAvailableMinor: 6_500,
      activeReservationsMinor: 0,
      asOf: timestamp,
    });

    renderApp(bridge, "/settings/billing");

    expect(await screen.findByText("总可用价值")).toBeTruthy();
    expect(await screen.findByText("¥65.00")).toBeTruthy();
    expect(
      await screen.findByText(/Token 计量、费率匹配、报价、资金预留与最终扣费全部由服务端完成/),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "接受当前条款" }));
    expect(bridge.acceptBillingTerms).toHaveBeenCalledWith("terms-v1");
  });

  it("supports the global search shortcut and reversible sidebar collapse", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.syncNow).mockResolvedValue({
      cursor: "cursor:1",
      pushed: 0,
      pulled: 0,
      pending: 0,
      conflicts: 0,
      syncedAt: timestamp,
    });
    renderApp(bridge);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(screen.getByRole("button", { name: "展开侧栏" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "展开侧栏" }));
    const syncButton = screen.getByRole("button", { name: "登录后可同步" });
    expect((syncButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("本机模式")).toBeTruthy();
    expect(bridge.syncNow).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("heading", { name: "搜索对话" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("搜索关键词")));
  });

  it("keeps new chat fixed while navigation and history share one scroll region", async () => {
    cleanup();
    renderApp(createBridge());

    const scrollRegion = screen.getByTestId("sidebar-scroll");
    expect(scrollRegion.contains(screen.getByRole("navigation", { name: "主导航" }))).toBe(true);
    expect(scrollRegion.contains(screen.getByRole("region", { name: "对话历史" }))).toBe(true);
    expect(scrollRegion.contains(screen.getByRole("link", { name: "新对话" }))).toBe(false);
    expect(scrollRegion.contains(await screen.findByText("本机模式"))).toBe(false);
    expect(scrollRegion.contains(await screen.findByRole("link", { name: /未登录/ }))).toBe(false);
  });

  it("moves the active navigation state away from new chat", async () => {
    cleanup();
    renderApp(createBridge());
    const user = userEvent.setup();
    const newChatLink = screen.getByRole("link", { name: "新对话" });
    const searchLink = screen.getByRole("link", { name: /搜索/ });

    expect(newChatLink.classList.contains("active")).toBe(true);
    expect(searchLink.classList.contains("active")).toBe(false);

    await user.click(searchLink);
    expect(await screen.findByRole("heading", { name: "搜索对话" })).toBeTruthy();
    expect(newChatLink.classList.contains("active")).toBe(false);
    expect(searchLink.classList.contains("active")).toBe(true);
  });

  it("keeps destructive conversation actions behind an in-product confirmation", async () => {
    cleanup();
    const bridge = createBridge();
    const nativeConfirm = vi.spyOn(window, "confirm");
    nativeConfirm.mockClear();
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除对话…" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除这个对话？" });
    expect(dialog).toBeTruthy();
    expect(nativeConfirm).not.toHaveBeenCalled();
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.click(cancel);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "更多操作" })),
    );
  });

  it("keeps HashRouter section navigation on settings and moves focus to the target", async () => {
    cleanup();
    renderApp(createBridge(), "/settings/account");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "账户与设备" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "外观" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("appearance-section"));
    expect(screen.getByRole("heading", { name: "账户与设备" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "诊断与数据" }));
    const diagnostics = document.getElementById("diagnostics-section") as HTMLDetailsElement;
    await waitFor(() => expect(document.activeElement).toBe(diagnostics));
    expect(diagnostics.open).toBe(true);
  });

  it("nests billing under settings instead of the primary sidebar", async () => {
    cleanup();
    renderApp(createBridge(), "/settings/account");
    const user = userEvent.setup();
    const mainNavigation = screen.getByRole("navigation", { name: "主导航" });

    expect(within(mainNavigation).queryByRole("link", { name: "费用与账单" })).toBeNull();
    expect(within(mainNavigation).getByRole("link", { name: "设置" }).classList).toContain(
      "active",
    );

    await user.click(await screen.findByRole("link", { name: "查看费用与账单" }));
    expect(await screen.findByRole("heading", { name: "费用与账单" })).toBeTruthy();
    expect(within(mainNavigation).getByRole("link", { name: "设置" }).classList).toContain(
      "active",
    );
  });

  it("focuses and contains the context drawer, maps raw errors, then restores focus", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.chooseFiles).mockRejectedValue(
      new Error('[{"code":"invalid_format","format":"uuid","path":["conversationId"]}]'),
    );
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    const trigger = await screen.findByRole("button", { name: "切换上下文" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "当前上下文" });
    const close = within(dialog).getByRole("button", { name: "关闭上下文" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(document.querySelector(".app-main")?.getAttribute("inert")).not.toBeNull();
    expect(document.querySelector(".sidebar")?.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(bridge.listFiles).toHaveBeenCalledWith({ conversationId }));
    expect(
      await within(dialog).findByText("还没有添加文件。上方选择的内容只会用于当前对话。"),
    ).toBeTruthy();
    expect(within(dialog).queryByText("正在读取文件…")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "选择文件" }));
    expect(
      await within(dialog).findByText("无法完成选择，请关闭面板后重新打开再试。"),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain("invalid_format");

    await user.click(close);
    expect(screen.queryByRole("dialog", { name: "当前上下文" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("grants a workspace with visible access, network, and expiry choices", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.chooseWorkspace).mockImplementation(async (input) => ({
      id: "66666666-6666-4666-8666-666666666666",
      ownerProfileId: "local-default",
      conversationId,
      displayName: "fixture-project",
      rootPath: "/fixture/project",
      access: input.access ?? "read_write",
      allowNetwork: input.allowNetwork ?? false,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      createdAt: timestamp,
    }));
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "切换上下文" }));
    const dialog = await screen.findByRole("dialog", { name: "当前上下文" });
    await user.selectOptions(within(dialog).getByLabelText("有效期"), "24h");
    await user.click(within(dialog).getByLabelText("允许 Shell 网络"));
    await user.click(within(dialog).getByRole("button", { name: "授权工作区" }));

    expect(bridge.chooseWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        access: "read_write",
        allowNetwork: true,
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      }),
    );
    expect(await within(dialog).findByText(/已授权工作区 fixture-project/u)).toBeTruthy();
  });

  it("announces copy, archive and branch-creating regeneration results", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.setConversationArchived).mockResolvedValue({
      ...snapshot.conversation,
      archivedAt: timestamp,
    });
    vi.mocked(bridge.regenerateMessage).mockResolvedValue({
      conversationId,
      branchId,
      userMessageId,
      assistantMessageId,
    });
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    const copyButton = (await screen.findAllByRole("button", { name: "复制" }))[0];
    if (!copyButton) throw new Error("Copy action missing");
    await user.click(copyButton);
    expect(await screen.findByText("消息已复制到剪贴板。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "重新生成到新分支" }));
    expect(bridge.regenerateMessage).toHaveBeenCalled();
    expect(await screen.findByText("已在新分支中重新生成，原回复仍保留。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "归档对话" }));
    expect(screen.queryByRole("menu", { name: "对话操作" })).toBeNull();
    expect(await screen.findByText("对话已归档。")).toBeTruthy();
  });

  it("replays rich Items for the selected historical Run without exposing raw reasoning", async () => {
    cleanup();
    const bridge = createBridge();
    const workItemId = "66666666-6666-4666-8666-666666666666";
    const currentRunId = "77777777-7777-4777-8777-777777777777";
    const historicalRunId = "88888888-8888-4888-8888-888888888888";
    const workItem: WorkItem = {
      id: workItemId,
      ownerProfileId: "local-default",
      conversationId,
      messageId: assistantMessageId,
      title: "对话轮次",
      status: "completed",
      activeRunId: currentRunId,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
      revision: 2,
    };
    const run = (id: string, attempt: number) => ({
      id,
      workItemId,
      attempt,
      status: "completed" as const,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
      selectedModelRef: "platform/auto",
      effectiveModelRef: "platform/standard",
      branchId,
      thinkingLevel: "high" as const,
      fallbackReason: null,
      initialToolNames: ["openerx_update_plan"],
      availableToolNames: ["openerx_update_plan"],
      skillInstallationIds: [],
      instructionSources: [],
      piSessionRef: `run:${id}`,
      usageRecords: [],
      cancellationRequestedAt: null,
      lastPiEventSequence: 8,
      retryCount: 1,
      compactionCount: 1,
      errorCode: null,
      createdAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    const currentRun = run(currentRunId, 2);
    const historicalRun = run(historicalRunId, 1);
    const currentDetail: WorkItemDetail = {
      workItem,
      runs: [currentRun, historicalRun],
      run: currentRun,
      steps: [],
      toolCalls: [],
      permissions: [],
      items: [
        {
          id: "90000000-0000-4000-8000-000000000001",
          runId: currentRunId,
          sequence: 1,
          piItemRef: "reasoning:1:1",
          status: "completed",
          content: {
            type: "reasoning",
            summary: "模型推理已完成；Run 时间线仅保存安全摘要。",
            reasoningTokens: 42,
            contentRedacted: true,
          },
          startedAt: timestamp,
          completedAt: timestamp,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "90000000-0000-4000-8000-000000000002",
          runId: currentRunId,
          sequence: 2,
          piItemRef: "plan:1",
          status: "completed",
          content: {
            type: "plan",
            explanation: "按检查点推进",
            entries: [
              { text: "实现 Run Item", status: "completed" },
              { text: "验证回放", status: "in_progress" },
            ],
          },
          startedAt: timestamp,
          completedAt: timestamp,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "90000000-0000-4000-8000-000000000003",
          runId: currentRunId,
          sequence: 3,
          piItemRef: "diff:1",
          status: "completed",
          content: {
            type: "diff",
            toolCallId: "90000000-0000-4000-8000-000000000010",
            workspaceChangeId: "90000000-0000-4000-8000-000000000011",
            relativePath: "src/run.ts",
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
          startedAt: timestamp,
          completedAt: timestamp,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "90000000-0000-4000-8000-000000000004",
          runId: currentRunId,
          sequence: 4,
          piItemRef: "compaction:1",
          status: "completed",
          content: {
            type: "compaction",
            reason: "threshold",
            tokensBefore: 10_000,
            tokensAfter: 4_000,
          },
          startedAt: timestamp,
          completedAt: timestamp,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
    const historicalDetail: WorkItemDetail = {
      ...currentDetail,
      run: historicalRun,
      items: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          runId: historicalRunId,
          sequence: 1,
          piItemRef: "model:1",
          status: "completed",
          content: {
            type: "model",
            modelRef: "platform/standard",
            summary: "历史模型轮次已完成",
          },
          startedAt: timestamp,
          completedAt: timestamp,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
    vi.mocked(bridge.listWorkItems).mockResolvedValue([workItem]);
    vi.mocked(bridge.getWorkItem).mockImplementation(async ({ runId }) =>
      runId === historicalRunId ? historicalDetail : currentDetail,
    );
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    expect(await screen.findByText("执行计划")).toBeTruthy();
    expect(screen.getByText("文件差异 · src/run.ts")).toBeTruthy();
    expect(screen.getByText("上下文压缩 · threshold")).toBeTruthy();
    expect(screen.queryByText("PRIVATE_RAW_CHAIN_OF_THOUGHT")).toBeNull();
    await user.selectOptions(screen.getByLabelText("选择要回放的 Run"), historicalRunId);
    expect(await screen.findByText("历史模型轮次已完成")).toBeTruthy();
    expect(bridge.getWorkItem).toHaveBeenCalledWith({
      workItemId,
      runId: historicalRunId,
    });
  });

  it("shows persisted MCP OAuth status and starts authorization-code flow without a client secret", async () => {
    cleanup();
    const bridge = createBridge();
    const serverId = "66666666-6666-4666-8666-666666666699";
    vi.mocked(bridge.listMcpServers).mockResolvedValue([
      {
        id: serverId,
        name: "项目知识库",
        transport: "streamable_http",
        url: "https://mcp.example/mcp",
        auth: "oauth",
        credentialRef: `mcp:${serverId}`,
        enabled: true,
        enabledTools: [],
      },
    ]);
    vi.mocked(bridge.listMcpServerAuthorizationStates).mockResolvedValue([
      {
        serverId,
        status: "authorization_required",
        connected: false,
        connectedAt: null,
        expiresAt: null,
        reason: null,
      },
    ]);
    vi.mocked(bridge.authorizeMcpServer).mockResolvedValue({
      serverId,
      status: "authorized",
      connected: true,
      connectedAt: timestamp,
      expiresAt: null,
      reason: null,
    });
    renderApp(bridge, "/tasks");
    const user = userEvent.setup();

    await user.click(await screen.findByText("MCP 服务与高级连接"));
    expect(await screen.findByText("需要浏览器授权")).toBeTruthy();
    expect(screen.queryByLabelText("MCP OAuth Client Secret")).toBeNull();
    await user.click(screen.getByRole("button", { name: "在浏览器中授权" }));
    await waitFor(() => expect(bridge.authorizeMcpServer).toHaveBeenCalledWith({ serverId }));
    expect(await screen.findByText("OAuth 授权完成，MCP 服务已连接。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新授权" })).toBeTruthy();
  });

  it("shows runtime desktop capability status and permission reasons instead of a static catalog", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listToolRuntimeReadiness).mockResolvedValue([
      {
        capability: "browser",
        status: "available",
        reason: null,
        availableToolNames: ["openerx_browser"],
        checkedAt: timestamp,
      },
      {
        capability: "shell",
        status: "authorization_required",
        reason: "WORKSPACE_WRITE_GRANT_REQUIRED",
        availableToolNames: [],
        details: ["阶段：Local Alpha", "网络：默认拒绝"],
        checkedAt: timestamp,
      },
      {
        capability: "desktop",
        status: "degraded",
        reason: "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
        availableToolNames: ["openerx_desktop"],
        checkedAt: timestamp,
      },
    ]);
    renderApp(bridge, "/tasks");
    const user = userEvent.setup();

    await user.click(await screen.findByText("查看能力与运行状态"));
    const browserCard = screen.getByText("隔离浏览器").closest("article");
    const shellCard = screen.getByText("Shell / 代码").closest("article");
    const desktopCard = screen.getByText("桌面控制").closest("article");
    if (!browserCard || !shellCard || !desktopCard) throw new Error("tool card missing");
    expect(within(browserCard).getByText("运行时可用")).toBeTruthy();
    expect(within(shellCard).getByText("需要设置")).toBeTruthy();
    expect(within(shellCard).getByText("需先授权一个可写工作区")).toBeTruthy();
    expect(within(shellCard).getByText("阶段：Local Alpha")).toBeTruthy();
    expect(within(shellCard).getByText("网络：默认拒绝")).toBeTruthy();
    expect(within(desktopCard).getByText("部分可用")).toBeTruthy();
    expect(within(desktopCard).getByText("需在系统设置中允许辅助功能")).toBeTruthy();
    await user.click(within(desktopCard).getByRole("button", { name: "请求辅助功能权限" }));
    await waitFor(() =>
      expect(bridge.requestDesktopNativePermission).toHaveBeenCalledWith({
        permission: "accessibility",
      }),
    );
    expect(await screen.findByText("系统设置已打开；授权后请返回并刷新能力状态。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "刷新能力状态" }));
    await waitFor(() => expect(bridge.listToolRuntimeReadiness).toHaveBeenCalledTimes(3));
  });

  it("keeps local Web Search Provider choice and runtime reset in the trusted tool center", async () => {
    cleanup();
    const bridge = createBridge();
    const initial = await bridge.getLocalWebSearchSettings();
    const backedOff: LocalWebSearchSettingsState = {
      ...initial,
      providers: initial.providers.map((provider) =>
        provider.descriptor.providerId === "direct:bing-html"
          ? {
              ...provider,
              status: "backed_off",
              consecutiveThrottleFailures: 2,
              backedOffUntil: "2026-08-29T03:30:00.000Z",
              lastErrorCode: "LOCAL_SEARCH_RATE_LIMITED",
              lastFailureAt: "2026-08-29T03:00:00.000Z",
            }
          : provider,
      ),
    };
    const updated: LocalWebSearchSettingsState = {
      ...backedOff,
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
      updatedAt: "2026-08-29T03:01:00.000Z",
      providers: backedOff.providers.map((provider) => ({
        ...provider,
        selected: provider.descriptor.providerId === "direct:bing-html",
      })),
    };
    vi.mocked(bridge.getLocalWebSearchSettings).mockClear();
    vi.mocked(bridge.getLocalWebSearchSettings).mockResolvedValue(backedOff);
    vi.mocked(bridge.updateLocalWebSearchSettings).mockResolvedValue(updated);
    vi.mocked(bridge.resetLocalWebSearchRuntime).mockResolvedValue({
      ...updated,
      providers: updated.providers.map((provider) => ({
        ...provider,
        status: "available",
        consecutiveThrottleFailures: 0,
        backedOffUntil: null,
        lastErrorCode: null,
        lastFailureAt: null,
      })),
    });
    renderApp(bridge, "/tasks");
    const user = userEvent.setup();

    const panel = (await screen.findByRole("heading", { name: "本地 Web Search" })).closest(
      "section",
    );
    if (!panel) throw new Error("local Web Search panel missing");
    expect(within(panel).getByText("退避中")).toBeTruthy();
    expect(within(panel).getByText(/LOCAL_SEARCH_RATE_LIMITED/u)).toBeTruthy();
    expect(within(panel).getByText(/不启动浏览器/u)).toBeTruthy();

    await user.selectOptions(
      within(panel).getByLabelText("Web Search Provider"),
      "direct:bing-html",
    );
    await user.selectOptions(within(panel).getByLabelText("Web Search 结果语言"), "en-US");
    await user.selectOptions(within(panel).getByLabelText("Web Search SafeSearch"), "strict");
    await user.click(within(panel).getByRole("button", { name: "保存搜索设置" }));
    await waitFor(() =>
      expect(bridge.updateLocalWebSearchSettings).toHaveBeenCalledWith({
        providerId: "direct:bing-html",
        locale: "en-US",
        safeSearch: "strict",
      }),
    );
    expect(
      await within(panel).findByText("搜索设置已保存；正在运行的对话仍使用启动时冻结的策略。"),
    ).toBeTruthy();

    await user.click(within(panel).getByRole("button", { name: "清缓存并重置退避" }));
    await waitFor(() => expect(bridge.resetLocalWebSearchRuntime).toHaveBeenCalledWith());
    expect(await within(panel).findByText("已清除本轮缓存并重置 Provider 退避状态。")).toBeTruthy();
    expect(within(panel).queryByText("退避中")).toBeNull();
  });

  it("keeps browser takeover controls in the trusted tool center without embedding page data", async () => {
    cleanup();
    const bridge = createBridge();
    const sessionId = "77777777-7777-4777-8777-777777777777";
    let session: BrowserSessionDescriptor = {
      contractVersion: "browser_computer_use_v2",
      sessionId,
      backend: "system_default",
      controlPath: "os_accessibility",
      applicationId: "com.google.Chrome",
      nativeProcessId: 42,
      nativeWindowId: "mac_window_fixture_42",
      surfaceKind: "window",
      surfaceId: "mac_surface_fixture_42",
      ownership: "external_openerx",
      profilePersistence: "browser_owned",
      state: "active",
      capabilities: {
        semanticObserve: true,
        semanticAction: true,
        visualCapture: true,
        coordinateFallback: true,
        controlledUpload: false,
        controlledDownload: false,
        clearProfileData: false,
        closeOwnedWindow: true,
      },
    };
    vi.mocked(bridge.listBrowserComputerUseSessions).mockImplementation(async () => [session]);
    vi.mocked(bridge.pauseBrowserComputerUseSession).mockImplementation(async () => {
      session = { ...session, state: "paused_for_user" };
      return session;
    });
    vi.mocked(bridge.resumeBrowserComputerUseSession).mockImplementation(async () => {
      session = { ...session, state: "active" };
      return session;
    });
    renderApp(bridge, "/tasks");
    const user = userEvent.setup();

    expect(await screen.findByText("Google Chrome")).toBeTruthy();
    expect(screen.getByText("机器默认浏览器")).toBeTruthy();
    expect(screen.getByText("独立窗口 · 系统辅助功能")).toBeTruthy();
    expect(screen.queryByText("com.google.Chrome")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();

    await user.click(screen.getByRole("button", { name: "我来接管" }));
    await waitFor(() =>
      expect(bridge.pauseBrowserComputerUseSession).toHaveBeenCalledWith({ sessionId }),
    );
    expect(await screen.findByText("用户接管中")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "恢复自动操作" }));
    await waitFor(() =>
      expect(bridge.resumeBrowserComputerUseSession).toHaveBeenCalledWith({ sessionId }),
    );
    expect(await screen.findByText("自动操作中")).toBeTruthy();
  });

  it("requires explicit confirmation before revoking Skill permissions and disabling it", async () => {
    cleanup();
    const bridge = createBridge();
    const privilegedSkill: SkillInstallation = {
      ...skillInstallation,
      permissions: [
        {
          capability: "shell",
          actions: ["execute"],
          targets: ["scripts/render.mjs"],
          reason: "Run the bundled deterministic report outline script.",
        },
      ],
    };
    vi.mocked(bridge.listSkills).mockResolvedValue([privilegedSkill]);
    vi.mocked(bridge.resetSkillPermissions).mockResolvedValue({
      ...privilegedSkill,
      enabled: false,
      approvedPermissionDigest: null,
    });
    renderApp(bridge, "/assistants");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "撤销已批准权限…" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "撤销 结构化报告 的权限并停用？",
    });
    expect(dialog.textContent).toContain("这不是恢复默认设置");
    expect(bridge.resetSkillPermissions).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "撤销权限并停用" }));
    await waitFor(() =>
      expect(bridge.resetSkillPermissions).toHaveBeenCalledWith({
        installationId: privilegedSkill.id,
      }),
    );
    expect(
      await screen.findByText("已撤销权限并停用该 Skill；重新审核批准后才能再次启用。"),
    ).toBeTruthy();
  });

  it("shows visible archive and Skill-search empty states and focuses direct search navigation", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listSkills).mockResolvedValue([skillInstallation]);
    renderApp(bridge, "/assistants");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("搜索 Skill"), "不存在的能力");
    expect(await screen.findByText("没有匹配“不存在的能力”的 Skill")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByText("结构化报告")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: /搜索/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("搜索关键词")));
    await user.click(screen.getByRole("link", { name: "新对话" }));
    await user.click(screen.getByRole("button", { name: "显示归档对话" }));
    expect(await screen.findByText("历史 · 含归档")).toBeTruthy();
    expect(screen.getByText("还没有活动或归档对话。")).toBeTruthy();
  });
});
