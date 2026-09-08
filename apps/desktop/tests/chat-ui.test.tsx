// @vitest-environment jsdom

import type {
  AutomaticMemoryCreatedEvent,
  BrowserSessionDescriptor,
  ChatEvent,
  ConversationSnapshot,
  DesktopBridge,
  LocalWebSearchSettingsState,
  ModelCatalogEntry,
  PermissionRequest,
  PersonalFile,
  ProjectDetail,
  ProjectSummary,
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
  publisher: "OpenERX",
  scope: "builtin",
  workspaceId: null,
  sourceKind: "built_in",
  sourceLabel: "OpenERX bundled skills",
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

const personalProjectId = "66666666-6666-4666-8666-666666666666";
const projectDirectoryId = "77777777-7777-4777-8777-777777777777";
const projectDirectoryBindingId = "88888888-8888-4888-8888-888888888888";
const projectWorkspaceGrantId = "99999999-9999-4999-8999-999999999999";
const projectDetail: ProjectDetail = {
  project: {
    id: personalProjectId,
    ownerProfileId: "local-default",
    name: "客户交付",
    instructions: "优先使用中文，并在提交前运行测试。",
    pinnedRank: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    revision: 2,
  },
  directories: [
    {
      directory: {
        id: projectDirectoryId,
        ownerProfileId: "local-default",
        projectId: personalProjectId,
        displayName: "delivery-workspace",
        role: "primary",
        desiredAccess: "read_write",
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        revision: 1,
      },
      binding: {
        id: projectDirectoryBindingId,
        ownerProfileId: "local-default",
        projectDirectoryId,
        deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspaceGrantId: projectWorkspaceGrantId,
        lastValidatedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        revokedAt: null,
        revision: 1,
      },
      connectionState: "connected",
    },
  ],
};
const projectSummary: ProjectSummary = {
  ...projectDetail.project,
  conversationCount: 1,
  directoryCount: 1,
  connectedDirectoryCount: 1,
  reconnectRequiredCount: 0,
};

const snapshot: ConversationSnapshot = {
  conversation: {
    id: conversationId,
    ownerProfileId: "local-default",
    projectId: null,
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
    getModelServiceSettings: vi.fn().mockResolvedValue({
      mode: "byok",
      byok: {
        baseUrl: "https://api.deepseek.com",
        modelId: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        capabilities: { imageInput: false, functionCalling: true, reasoning: true },
      },
      credentialConfigured: false,
      providerCredentials: {},
      updatedAt: null,
    }),
    updateModelServiceSettings: vi.fn(),
    testByokConnection: vi.fn(),
    clearByokApiKey: vi.fn(),
    getEnvironment: vi.fn().mockResolvedValue({
      platform: "darwin",
      arch: "arm64",
      appVersion: "2.0.0-alpha.0",
    }),
    getLoginStartupSettings: vi.fn().mockResolvedValue({
      supported: true,
      openAtLogin: false,
      launchesInBackground: true,
    }),
    updateLoginStartupSettings: vi.fn(),
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
      memories: 0,
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
    getMemorySettings: vi.fn().mockResolvedValue({
      ownerProfileId: "local-default",
      memoriesEnabled: true,
      useMemories: true,
      generateMemories: true,
      syncMemories: false,
      disableOnExternalContext: true,
      idleDelayMinutes: 30,
      minRateLimitRemainingPercent: 20,
      updatedAt: timestamp,
      revision: 1,
    }),
    updateMemorySettings: vi.fn(),
    getConversationMemorySettings: vi.fn().mockResolvedValue({
      conversationId,
      ownerProfileId: "local-default",
      useMemories: null,
      generateMemories: null,
      updatedAt: timestamp,
      revision: 1,
    }),
    updateConversationMemorySettings: vi.fn(),
    listMemories: vi.fn().mockResolvedValue([]),
    listMemoryMergeReviews: vi.fn().mockResolvedValue([]),
    resolveMemoryMergeReview: vi.fn(),
    listMemorySources: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn(),
    deleteMemory: vi.fn(),
    clearMemories: vi.fn(),
    deleteCloudData: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([]),
    createAutomation: vi.fn(),
    listAutomations: vi.fn().mockResolvedValue([]),
    getAutomation: vi.fn(),
    updateAutomation: vi.fn(),
    pauseAutomation: vi.fn(),
    resumeAutomation: vi.fn(),
    deleteAutomation: vi.fn(),
    runAutomationNow: vi.fn(),
    listAutomationRuns: vi.fn().mockResolvedValue([]),
    previewAutomationSchedule: vi.fn().mockResolvedValue({ occurrences: [] }),
    onAutomationRun: vi.fn().mockReturnValue(() => undefined),
    onAutomationNavigate: vi.fn().mockReturnValue(() => undefined),
    onAutomaticMemoryCreated: vi.fn().mockReturnValue(() => undefined),
    onMemoryNavigate: vi.fn().mockReturnValue(() => undefined),
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
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    restoreProject: vi.fn(),
    chooseProjectDirectory: vi.fn().mockResolvedValue(null),
    setPrimaryProjectDirectory: vi.fn(),
    disconnectProjectDirectory: vi.fn(),
    removeProjectDirectory: vi.fn(),
    moveConversationToProject: vi.fn(),
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
      allowProviderFallback: true,
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
    getToolPermissionMode: vi.fn().mockImplementation(async ({ conversationId: targetId }) => ({
      conversationId: targetId,
      mode: "ask",
      scopeId: null,
    })),
    setToolPermissionMode: vi
      .fn()
      .mockImplementation(async ({ conversationId: targetId, mode }) => ({
        conversationId: targetId,
        mode,
        scopeId: mode === "full_access" ? "88888888-8888-4888-8888-888888888888" : null,
      })),
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
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
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
    const messageList = screen.getByRole("region", { name: "对话消息" });
    const messageListContent = messageList.querySelector(".message-list-content");
    let scrollHeight = 960;
    const clientHeight = 400;
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      messageList.scrollTop = Math.max(0, Number(top) - clientHeight);
    });
    Object.defineProperty(messageList, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(messageList, "clientHeight", {
      configurable: true,
      value: clientHeight,
    });
    Object.defineProperty(messageList, "scrollTo", { configurable: true, value: scrollTo });
    expect(observe).toHaveBeenCalledWith(messageListContent);

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
    act(() => resizeCallback?.([], {} as ResizeObserver));

    expect(await screen.findByText("第一段第二段")).toBeTruthy();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 960, behavior: "auto" }));

    scrollHeight = 1_200;
    act(() => messageList.dispatchEvent(new Event("scroll")));
    act(() => resizeCallback?.([], {} as ResizeObserver));
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1_200, behavior: "auto" }),
    );

    const followCallCount = scrollTo.mock.calls.length;
    act(() => messageList.dispatchEvent(new Event("scroll")));
    messageList.scrollTop = 600;
    act(() => messageList.dispatchEvent(new Event("scroll")));
    expect(await screen.findByRole("button", { name: /回到最新回复/u })).toBeTruthy();
    scrollHeight = 1_440;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(scrollTo).toHaveBeenCalledTimes(followCallCount);
    expect(bridge.getConversation).toHaveBeenCalledTimes(1);
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders separate model rounds as clearly divided progress updates", async () => {
    const bridge = createBridge();
    const userMessage = snapshot.messages[0];
    const assistant = snapshot.messages[1];
    if (!userMessage || !assistant) throw new Error("CHAT_MULTI_PART_FIXTURE_INVALID");
    vi.mocked(bridge.getConversation).mockResolvedValue({
      ...snapshot,
      messages: [
        userMessage,
        {
          ...assistant,
          status: "streaming",
          parts: [
            { id: crypto.randomUUID(), type: "text", text: "先搜索并整理资料。" },
            { id: crypto.randomUUID(), type: "text", text: "再生成三份交付物。" },
          ],
        },
      ],
    });

    renderApp(bridge, `/chat/${conversationId}`);

    expect(await screen.findByText("先搜索并整理资料。")).toBeTruthy();
    expect(screen.getByText("再生成三份交付物。")).toBeTruthy();
    expect(screen.getByRole("region", { name: "OpenERX 进度更新 1" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "OpenERX 进度更新 2" })).toBeTruthy();
    expect(document.querySelectorAll(".assistant-response-part")).toHaveLength(2);
    expect(screen.queryByText("先搜索并整理资料。再生成三份交付物。")).toBeNull();
    cleanup();
  });

  it("sends through the narrow bridge and renders GFM code and tables", async () => {
    const bridge = createBridge();
    renderApp(bridge);
    expect(document.querySelector(".brand-mark img")).toBeNull();
    expect(document.querySelector(".brand-monogram")?.textContent).toBe("OX");
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

  it("releases the composer when the desktop send bridge stops responding", async () => {
    cleanup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const bridge = createBridge();
      vi.mocked(bridge.sendMessage).mockImplementation(() => new Promise(() => undefined));
      renderApp(bridge);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.type(screen.getByLabelText("发送消息"), "验证发送超时");
      await user.click(screen.getByRole("button", { name: "发送" }));
      expect(screen.getByText("发送中…")).toBeTruthy();

      await act(async () => vi.advanceTimersByTime(12_001));

      expect(await screen.findByText(/请求等待时间过长/u)).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "发送" }).disabled).toBe(false);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("starts every homepage capability showcase with the exact supported prompt", async () => {
    const prompts = [
      "复盘最近一周 A 股行情：哪些板块最受关注，背后的驱动因素是什么？",
      "检查我选择的文件或文件夹，找出问题并给出可验证的改进方案",
      "搜索最新资料，制作一份 AI 工具选型报告，同时生成对比表格、DOCX 和汇报 PPT",
      "计算一家月营收 100 万元、成本 65 万元公司的三种增长情景，并生成可下载的 Excel 分析表",
    ];

    for (const prompt of prompts) {
      cleanup();
      const bridge = createBridge();
      vi.mocked(bridge.listModels).mockResolvedValue([thinkingModel]);
      renderApp(bridge);

      await userEvent.setup().click(await screen.findByRole("button", { name: prompt }));

      await waitFor(() =>
        expect(bridge.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            conversationId: null,
            text: prompt,
            modelRef: thinkingModel.modelRef,
            thinkingLevel: "medium",
          }),
        ),
      );
    }
  });

  it("selects thinking strength for a new task and persists changes for later messages", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listModels).mockResolvedValue([thinkingModel]);
    renderApp(bridge);
    const user = userEvent.setup();

    const newTaskThinking = await screen.findByLabelText("新任务思考强度");
    await waitFor(() => expect(newTaskThinking.querySelector('option[value="off"]')).toBeTruthy());
    await user.selectOptions(newTaskThinking, "off");
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
    const combinedTrigger = screen.getByRole("button", { name: "模型与思考菜单" });
    await userEvent.setup().click(combinedTrigger);
    const combinedMenu = screen.getByRole("listbox", { name: "模型与思考" });
    expect(within(combinedMenu).getByText("模型")).toBeTruthy();
    expect(within(combinedMenu).getByText("思考强度")).toBeTruthy();
    await userEvent.setup().click(within(combinedMenu).getByRole("option", { name: "关闭" }));
    await waitFor(() =>
      expect(conversationBridge.selectConversationThinkingLevel).toHaveBeenCalledWith({
        conversationId,
        thinkingLevel: "off",
      }),
    );
  });

  it("selects the tool permission mode in the composer for new and existing conversations", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listModels).mockResolvedValue([thinkingModel]);
    renderApp(bridge);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("权限模式"), "full_access");
    await user.type(screen.getByLabelText("发送消息"), "直接执行");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "直接执行", permissionMode: "full_access" }),
    );
    cleanup();

    const conversationBridge = createBridge();
    vi.mocked(conversationBridge.getToolPermissionMode).mockResolvedValue({
      conversationId,
      mode: "full_access",
      scopeId: "88888888-8888-4888-8888-888888888888",
    });
    vi.mocked(conversationBridge.setToolPermissionMode).mockImplementation(
      () => new Promise(() => undefined),
    );
    renderApp(conversationBridge, `/chat/${conversationId}`);

    const permissionMode = await screen.findByLabelText("权限模式");
    await waitFor(() => expect((permissionMode as HTMLSelectElement).disabled).toBe(false));
    expect((permissionMode as HTMLSelectElement).value).toBe("full_access");
    await userEvent.setup().selectOptions(permissionMode, "ask");
    await waitFor(() =>
      expect(conversationBridge.setToolPermissionMode).toHaveBeenCalledWith({
        conversationId,
        mode: "ask",
      }),
    );
    expect((permissionMode as HTMLSelectElement).value).toBe("ask");
    await userEvent.setup().type(screen.getByLabelText("发送消息"), "恢复逐次审批");
    await userEvent.setup().click(screen.getByRole("button", { name: "发送" }));
    expect(conversationBridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "恢复逐次审批", permissionMode: "ask" }),
    );
  });

  it("opens the model settings section from the model configuration prompt", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listModels).mockResolvedValue([{ ...thinkingModel, status: "unavailable" }]);
    renderApp(bridge, "/chat/new");

    await userEvent.setup().click(await screen.findByRole("link", { name: "前往设置 → 模型" }));

    expect(await screen.findByLabelText("模型设置")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "模型", level: 1 })).toBeNull();
    expect(screen.getByRole("button", { name: "模型" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByLabelText("运行模式")).toBeTruthy();
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

    await user.click(await screen.findByRole("button", { name: "外观" }));
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

  it("shows memory enabled by default and supports explicit memory management", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.updateMemorySettings).mockResolvedValue({
      ownerProfileId: "local-default",
      memoriesEnabled: false,
      useMemories: true,
      generateMemories: true,
      syncMemories: false,
      disableOnExternalContext: true,
      idleDelayMinutes: 30,
      minRateLimitRemainingPercent: 20,
      updatedAt: timestamp,
      revision: 2,
    });
    vi.mocked(bridge.upsertMemory).mockResolvedValue({
      id: crypto.randomUUID(),
      ownerProfileId: "local-default",
      scope: "personal",
      kind: "preference",
      content: "回答时先给结论。",
      retrievalKeys: ["回答", "结论"],
      canonicalKey: "preference:回答时先给结论。",
      conflictKey: null,
      origin: "explicit",
      confidence: 1,
      status: "active",
      sourceConversationId: null,
      sourceMessageId: null,
      supersedesMemoryId: null,
      expiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    });
    renderApp(bridge, "/settings/account");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "记忆" }));
    expect((await screen.findAllByRole("heading", { name: "长期记忆" })).length).toBeGreaterThan(0);
    const enabled = screen.getByRole("checkbox", { name: /启用长期记忆/ });
    expect((enabled as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /用于回答/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByRole("checkbox", { name: /自动生成记忆/ }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.type(await screen.findByLabelText("内容"), "回答时先给结论。");
    await user.click(screen.getByRole("button", { name: "保存记忆" }));
    await waitFor(() =>
      expect(bridge.upsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "preference",
          content: "回答时先给结论。",
          idempotencyKey: expect.stringMatching(/^memory-ui:/u),
        }),
      ),
    );
    expect(screen.getByText("密钥、口令、验证码、Cookie、私钥", { exact: false })).toBeTruthy();

    await user.click(enabled);
    await waitFor(() =>
      expect(vi.mocked(bridge.updateMemorySettings).mock.calls[0]?.[0]).toEqual({
        memoriesEnabled: false,
      }),
    );
  });

  it("keeps historical semantic memory suggestions behind an explicit review action", async () => {
    cleanup();
    const bridge = createBridge();
    const review = {
      id: "77777777-7777-4777-8777-777777777701",
      ownerProfileId: "local-default",
      kind: "preference" as const,
      relation: "conflict" as const,
      targetMemoryId: "77777777-7777-4777-8777-777777777702",
      targetContent: "用户希望技术方案先给结论。",
      targetRevision: 1,
      proposalMemoryId: "77777777-7777-4777-8777-777777777703",
      proposalRevision: 1,
      proposedContent: "用户希望技术方案最后给结论。",
      proposedRetrievalKeys: ["技术方案", "结论"],
      proposedConflictKey: null,
      confidence: 0.89,
      sourceConversationId: conversationId,
      sourceMessageId: userMessageId,
      status: "pending" as const,
      resultMemoryId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
    };
    vi.mocked(bridge.getMemorySettings).mockResolvedValue({
      ownerProfileId: "local-default",
      memoriesEnabled: true,
      useMemories: true,
      generateMemories: true,
      syncMemories: false,
      disableOnExternalContext: true,
      idleDelayMinutes: 30,
      minRateLimitRemainingPercent: 20,
      updatedAt: timestamp,
      revision: 2,
    });
    vi.mocked(bridge.listMemoryMergeReviews).mockResolvedValue([review]);
    vi.mocked(bridge.resolveMemoryMergeReview).mockResolvedValue({
      ...review,
      status: "accepted",
      resultMemoryId: "77777777-7777-4777-8777-777777777703",
      resolvedAt: timestamp,
    });
    renderApp(bridge, "/settings/account");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "记忆" }));
    expect(await screen.findByText(review.targetContent)).toBeTruthy();
    expect(screen.getByText(review.proposedContent)).toBeTruthy();
    expect(screen.getByText("较新的已有记忆（确认后替代）")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认替代" }));
    await waitFor(() =>
      expect(bridge.resolveMemoryMergeReview).toHaveBeenCalledWith({
        reviewId: review.id,
        resolution: "accept",
        idempotencyKey: expect.stringMatching(/^memory-merge-review:/u),
      }),
    );
  });

  it("notifies about automatic memories and can undo the created batch", async () => {
    cleanup();
    const bridge = createBridge();
    const memory = {
      id: "77777777-7777-4777-8777-777777777778",
      ownerProfileId: "local-default",
      scope: "personal" as const,
      kind: "preference" as const,
      content: "回答时先给结论。",
      retrievalKeys: ["结论"],
      canonicalKey: "preference:回答时先给结论。",
      conflictKey: null,
      origin: "automatic" as const,
      confidence: 0.91,
      status: "active" as const,
      sourceConversationId: conversationId,
      sourceMessageId: userMessageId,
      supersedesMemoryId: "77777777-7777-4777-8777-777777777778",
      expiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    const event: AutomaticMemoryCreatedEvent = {
      eventId: "77777777-7777-4777-8777-777777777779",
      jobId: "77777777-7777-4777-8777-777777777780",
      conversationId,
      memories: [memory],
      createdAt: timestamp,
    };
    let listener: ((event: AutomaticMemoryCreatedEvent) => void) | undefined;
    vi.mocked(bridge.onAutomaticMemoryCreated).mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    vi.mocked(bridge.getMemorySettings).mockResolvedValue({
      ownerProfileId: "local-default",
      memoriesEnabled: true,
      useMemories: true,
      generateMemories: true,
      syncMemories: false,
      disableOnExternalContext: true,
      idleDelayMinutes: 30,
      minRateLimitRemainingPercent: 20,
      updatedAt: timestamp,
      revision: 2,
    });
    vi.mocked(bridge.listMemories).mockResolvedValue([memory]);
    vi.mocked(bridge.listMemorySources).mockResolvedValue([
      {
        memoryId: memory.id,
        ownerProfileId: "local-default",
        conversationId,
        messageId: userMessageId,
        origin: "automatic",
        confidence: 0.91,
        conversationTitle: "记忆来源对话",
        conversationDeletedAt: null,
        createdAt: timestamp,
      },
    ]);
    vi.mocked(bridge.deleteMemory).mockResolvedValue({
      ...memory,
      status: "deleted",
      revision: 2,
    });
    renderApp(bridge);
    const user = userEvent.setup();

    await waitFor(() => expect(listener).toBeTypeOf("function"));
    act(() => listener?.(event));
    expect(await screen.findByText("已生成长期记忆")).toBeTruthy();
    expect(screen.getByText("后台新增 1 条，可随时查看或撤销。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "查看" }));
    expect((await screen.findAllByRole("heading", { name: "长期记忆" })).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.activeElement?.id).toBe(`memory-${memory.id}`));
    await user.click(screen.getByRole("button", { name: "查看来源" }));
    expect(await screen.findByRole("button", { name: "记忆来源对话" })).toBeTruthy();
    expect(screen.getByText("已替代上一版本；删除此条将恢复上一版本。")).toBeTruthy();
    expect(screen.getByRole("button", { name: /撤销替代/u })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() =>
      expect(bridge.deleteMemory).toHaveBeenCalledWith({
        memoryId: memory.id,
        idempotencyKey: `memory-notification-undo:${event.eventId}:${memory.id}`,
      }),
    );
    await waitFor(() => expect(screen.queryByText("已生成长期记忆")).toBeNull());
  });

  it("keeps memory search focused when typing immediately after opening settings", async () => {
    cleanup();
    const animationFrames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => animationFrames.push(callback));
    try {
      const bridge = createBridge();
      renderApp(bridge, "/settings/account");
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "记忆" }));
      const search = await screen.findByLabelText<HTMLInputElement>("搜索记忆");
      await user.type(search, "类");
      // Navigation can finish painting after the user has already started typing.
      act(() => {
        while (animationFrames.length > 0) animationFrames.shift()?.(performance.now());
      });
      expect(document.activeElement).toBe(search);
      await user.keyboard("型检查");

      expect(search.value).toBe("类型检查");
      await waitFor(() =>
        expect(bridge.listMemories).toHaveBeenLastCalledWith({
          status: "active",
          limit: 100,
          query: "类型检查",
        }),
      );
    } finally {
      cleanup();
      requestAnimationFrame.mockRestore();
    }
  });

  it("searches, edits, filters, and clears saved memories by category", async () => {
    cleanup();
    const bridge = createBridge();
    const memory = {
      id: "77777777-7777-4777-8777-777777777777",
      ownerProfileId: "local-default",
      scope: "personal" as const,
      kind: "workflow" as const,
      content: "提交前运行类型检查。",
      retrievalKeys: ["类型检查"],
      canonicalKey: "workflow:类型检查",
      conflictKey: null,
      origin: "explicit" as const,
      confidence: 1,
      status: "active" as const,
      sourceConversationId: null,
      sourceMessageId: null,
      supersedesMemoryId: null,
      expiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    vi.mocked(bridge.getMemorySettings).mockResolvedValue({
      ownerProfileId: "local-default",
      memoriesEnabled: true,
      useMemories: true,
      generateMemories: false,
      syncMemories: false,
      disableOnExternalContext: true,
      idleDelayMinutes: 30,
      minRateLimitRemainingPercent: 20,
      updatedAt: timestamp,
      revision: 2,
    });
    vi.mocked(bridge.listMemories).mockResolvedValue([memory]);
    vi.mocked(bridge.upsertMemory).mockResolvedValue({ ...memory, revision: 2 });
    vi.mocked(bridge.clearMemories).mockResolvedValue({ deleted: 1, clearedAt: timestamp });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp(bridge, "/settings/account");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "记忆" }));
    await user.type(await screen.findByLabelText("搜索记忆"), "类型检查");
    await waitFor(() =>
      expect(bridge.listMemories).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "类型检查" }),
      ),
    );
    await user.selectOptions(screen.getByLabelText("筛选类型"), "workflow");
    await waitFor(() =>
      expect(bridge.listMemories).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "workflow" }),
      ),
    );

    await user.click(await screen.findByRole("button", { name: /编辑记忆/ }));
    const editor = screen.getByLabelText("内容");
    await user.clear(editor);
    await user.type(editor, "提交前运行类型检查和测试。");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(bridge.upsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: memory.id,
          kind: "workflow",
          content: "提交前运行类型检查和测试。",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "删除当前类别" }));
    await waitFor(() =>
      expect(bridge.clearMemories).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "workflow" }),
      ),
    );
    expect(confirm).toHaveBeenCalled();
  });

  it("keeps memory and learning controls out of the composer", async () => {
    cleanup();
    const bridge = createBridge();
    renderApp(bridge, `/chat/${conversationId}`);
    await screen.findByLabelText("发送消息");

    expect(screen.queryByLabelText("当前对话使用记忆")).toBeNull();
    expect(screen.queryByLabelText("当前对话贡献未来记忆")).toBeNull();
    expect(bridge.getConversationMemorySettings).not.toHaveBeenCalled();
    expect(bridge.updateConversationMemorySettings).not.toHaveBeenCalled();
  });

  it("persists the default model setting and uses it for new tasks", async () => {
    cleanup();
    window.localStorage.removeItem("openerx.defaultModelRef");
    const models: ModelCatalogEntry[] = [
      { ...thinkingModel, modelRef: "platform/auto", displayName: "自动选择" },
      { ...thinkingModel, modelRef: "platform/pro", displayName: "专业模型" },
    ];
    const settingsBridge = createBridge();
    vi.mocked(settingsBridge.listModels).mockResolvedValue(models);
    renderApp(settingsBridge, "/settings/account");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "模型" }));
    const defaultModelSelect = await screen.findByLabelText("新任务默认模型");
    await waitFor(() =>
      expect(within(defaultModelSelect).getByRole("option", { name: /专业模型/u })).toBeTruthy(),
    );
    await user.selectOptions(defaultModelSelect, "platform/pro");
    await waitFor(() =>
      expect(window.localStorage.getItem("openerx.defaultModelRef")).toBe("platform/pro"),
    );
    cleanup();

    const chatBridge = createBridge();
    vi.mocked(chatBridge.listModels).mockResolvedValue(models);
    renderApp(chatBridge);
    await user.type(await screen.findByLabelText("发送消息"), "使用默认模型");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(chatBridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ modelRef: "platform/pro", text: "使用默认模型" }),
    );
    window.localStorage.removeItem("openerx.defaultModelRef");
  });

  it("stores and tests API keys for multiple preset model providers", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.updateModelServiceSettings).mockResolvedValue({
      mode: "byok",
      byok: {
        baseUrl: "https://api.example.com/v1",
        modelId: "example-model",
        displayName: "example-model",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        capabilities: { imageInput: false, functionCalling: true, reasoning: false },
      },
      credentialConfigured: true,
      providerCredentials: { deepseek: true, qwen: true },
      updatedAt: timestamp,
    });
    vi.mocked(bridge.testByokConnection).mockResolvedValue({
      ok: true,
      latencyMs: 42,
      reportedModel: "qwen3.7-plus",
    });
    renderApp(bridge, "/settings/account");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "模型" }));
    await user.selectOptions(await screen.findByLabelText("运行模式"), "byok");
    const deepSeekCard = screen.getByRole("article", { name: "DeepSeek 配置" });
    const qwenCard = screen.getByRole("article", { name: "阿里云百炼 · 通义千问 配置" });
    expect(within(deepSeekCard).getByRole("option", { name: "DeepSeek V4 Pro" })).toBeTruthy();
    expect(within(qwenCard).getByRole("option", { name: "Qwen 3.7 Plus" })).toBeTruthy();
    await user.type(screen.getByLabelText("DeepSeek API Key"), "sk-deepseek-secret");
    await user.type(screen.getByLabelText("阿里云百炼 · 通义千问 API Key"), "sk-qwen-secret");
    await user.selectOptions(within(qwenCard).getByLabelText("连接测试模型"), "plus");
    await user.click(within(qwenCard).getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/连接成功 · 42 ms/)).toBeTruthy();
    expect(bridge.testByokConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerApiKeys: { qwen: "sk-qwen-secret" },
        byok: expect.objectContaining({
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          modelId: "qwen3.7-plus",
        }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "保存全部并启用" }));
    expect(bridge.updateModelServiceSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "byok",
        providerApiKeys: {
          deepseek: "sk-deepseek-secret",
          qwen: "sk-qwen-secret",
        },
      }),
    );
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

    await user.click(await screen.findByRole("button", { name: "诊断与数据" }));
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
    await userEvent.setup().click(await screen.findByRole("button", { name: "更新" }));
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
    await waitFor(() =>
      expect(
        (screen.getByLabelText("选择 Skill") as HTMLSelectElement).querySelector(
          `option[value="${skillInstallation.id}"]`,
        ),
      ).toBeTruthy(),
    );
    await user.selectOptions(await screen.findByLabelText("选择 Skill"), skillInstallation.id);
    await user.type(screen.getByLabelText("发送消息"), "生成报告");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(bridge.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ skillInstallationId: skillInstallation.id, text: "生成报告" }),
    );
    cleanup();

    const managementBridge = createBridge();
    const secondSkill = {
      ...skillInstallation,
      id: "66666666-6666-4666-8666-666666666666",
      name: "image-workflow",
      displayName: "图像工作流",
    };
    vi.mocked(managementBridge.listSkills).mockResolvedValue([skillInstallation, secondSkill]);
    renderApp(managementBridge, "/assistants");
    expect(await screen.findByRole("heading", { name: "Skill" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "skill", level: 1 })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();
    expect(screen.getByRole("button", { name: "skill" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("结构化报告")).toBeTruthy();
    expect(screen.getByText("图像工作流")).toBeTruthy();
    expect(screen.getAllByText(/OpenERX 内置 Skill/)).toHaveLength(2);
    expect(screen.getAllByText(/工具：Skill 脚本执行器/)).toHaveLength(2);
    const skillGrid = screen.getByRole("region", { name: "已安装 Skill" });
    const skillCards = skillGrid.querySelectorAll(".skill-card");
    expect(skillCards).toHaveLength(2);
    await userEvent.setup().click(within(skillCards[0] as HTMLElement).getByText("权限与详情"));
    expect(skillCards[0]?.querySelector("details")?.open).toBe(true);
    expect(screen.queryByRole("group", { name: "Skill 调用记录" })).toBeNull();
    expect(screen.queryByText("最近调用")).toBeNull();
    expect(managementBridge.listSkillInvocations).not.toHaveBeenCalled();
  });

  it("distinguishes bundled, signed, and unverified Skill sources", async () => {
    cleanup();
    const bridge = createBridge();
    const signedSkill: SkillInstallation = {
      ...skillInstallation,
      id: "66666666-6666-4666-8666-666666666666",
      name: "signed-workflow",
      displayName: "已签名工作流",
      scope: "personal",
      sourceKind: "archive",
      sourceLabel: "signed-workflow.zip",
      trust: "signed",
    };
    const unverifiedSkill: SkillInstallation = {
      ...skillInstallation,
      id: "77777777-7777-4777-8777-777777777777",
      name: "local-workflow",
      displayName: "本地工作流",
      scope: "personal",
      sourceKind: "local_directory",
      sourceLabel: "local-workflow",
      trust: "unverified",
    };
    vi.mocked(bridge.listSkills).mockResolvedValue([
      skillInstallation,
      signedSkill,
      unverifiedSkill,
    ]);

    renderApp(bridge, "/assistants");

    expect(await screen.findByText("内置", { selector: ".skill-trust" })).toBeTruthy();
    expect(screen.getByText("已验证来源", { selector: ".skill-trust" })).toBeTruthy();
    expect(screen.getByText("未验证来源", { selector: ".skill-trust" })).toBeTruthy();
  });

  it("groups personal files and deliverables by conversation in the library", async () => {
    const bridge = createBridge();
    const personalFileId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const personalFile: PersonalFile = {
      id: personalFileId,
      ownerProfileId: "local-default",
      displayName: "research.pdf",
      format: "pdf",
      mediaType: "application/pdf",
      sizeBytes: 2_048,
      checksumSha256: "d".repeat(64),
      objectRef: `objects/sha256/dd/${"d".repeat(64)}`,
      sourceScopeId: crypto.randomUUID(),
      sourceRelativePath: "research.pdf",
      parseStatus: "ready",
      parseErrorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    const artifact = {
      id: artifactId,
      ownerProfileId: "local-default",
      displayName: "summary.docx",
      format: "docx" as const,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      currentVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      versions: [
        {
          id: crypto.randomUUID(),
          artifactId,
          version: 1,
          sizeBytes: 4_096,
          checksumSha256: "e".repeat(64),
          objectRef: `objects/sha256/ee/${"e".repeat(64)}`,
          sourcePersonalFileId: personalFileId,
          createdAt: timestamp,
        },
      ],
    };
    vi.mocked(bridge.listConversations).mockResolvedValue([
      {
        ...snapshot.conversation,
        lastMessagePreview: "整理调研资料",
        messageCount: 2,
      },
    ]);
    vi.mocked(bridge.listFiles).mockImplementation(async (input) =>
      input?.conversationId === conversationId || input?.conversationId === undefined
        ? [personalFile]
        : [],
    );
    vi.mocked(bridge.listArtifacts).mockImplementation(async (input) =>
      input?.conversationId === conversationId || input?.conversationId === undefined
        ? [artifact]
        : [],
    );

    renderApp(bridge, "/files");

    const group = await screen.findByRole("article", { name: "Markdown 验收" });
    expect(within(group).getByRole("button", { name: /research\.pdf/ })).toBeTruthy();
    expect(within(group).getByRole("button", { name: /summary\.docx/ })).toBeTruthy();
    expect(within(group).getByText("1 个文件 · 1 个成果")).toBeTruthy();
    expect(bridge.listFiles).toHaveBeenCalledWith({ conversationId });
    expect(bridge.listArtifacts).toHaveBeenCalledWith({ conversationId });
    expect(screen.queryByRole("heading", { name: "未关联对话" })).toBeNull();
    expect(group.querySelector(".library-item-list")).toBeTruthy();
    expect(group.querySelector(".library-grid")).toBeNull();
  });

  it("searches conversation files and paginates library groups", async () => {
    cleanup();
    const bridge = createBridge();
    const conversationIds = Array.from(
      { length: 7 },
      (_, index) => `11111111-1111-4111-8${String(index).padStart(3, "0")}-111111111111`,
    );
    const libraryFiles = conversationIds.map(
      (_conversationId, index): PersonalFile => ({
        id: `22222222-2222-4222-8${String(index).padStart(3, "0")}-222222222222`,
        ownerProfileId: "local-default",
        displayName: `budget-${index + 1}.xlsx`,
        format: "xlsx",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 1_024 + index,
        checksumSha256: `${index + 1}`.repeat(64).slice(0, 64),
        objectRef: `objects/sha256/${String(index + 1).padStart(2, "0")}/${`${index + 1}`.repeat(64).slice(0, 64)}`,
        sourceScopeId: null,
        sourceRelativePath: `budget-${index + 1}.xlsx`,
        parseStatus: "ready",
        parseErrorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      }),
    );
    vi.mocked(bridge.listConversations).mockResolvedValue(
      conversationIds.map((id, index) => ({
        ...snapshot.conversation,
        id,
        title: `预算项目 ${index + 1}`,
        revision: index + 1,
        lastMessagePreview: `预算文件 ${index + 1}`,
        messageCount: 2,
      })),
    );
    vi.mocked(bridge.listFiles).mockImplementation(async (input) => {
      if (!input?.conversationId) return libraryFiles;
      const index = conversationIds.indexOf(input.conversationId);
      return index >= 0 && libraryFiles[index] ? [libraryFiles[index]] : [];
    });
    vi.mocked(bridge.listArtifacts).mockResolvedValue([]);

    renderApp(bridge, "/files");
    const user = userEvent.setup();

    expect(await screen.findByText("第 1 / 2 页")).toBeTruthy();
    expect(screen.getByRole("link", { name: "预算项目 1" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "预算项目 7" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("link", { name: "预算项目 7" })).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "搜索文件、成果或对话" }), "budget-2");
    expect(await screen.findByRole("link", { name: "预算项目 2" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "预算项目 7" })).toBeNull();
    expect(screen.queryByLabelText("文件列表分页")).toBeNull();
    expect(screen.getByText("找到 1 个对话 · 1 项")).toBeTruthy();
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
    const fileButton = await screen.findByRole("button", { name: /preview\.html/ });
    await user.click(fileButton);
    const frame = await screen.findByTitle("HTML 隔离预览");
    const libraryPage = frame.closest(".library-page");
    const previewPanel = frame.closest(".content-preview");
    expect(libraryPage?.classList.contains("preview-is-open")).toBe(true);
    expect(previewPanel?.parentElement).toBe(libraryPage);
    expect(libraryPage?.querySelector(":scope > .library-browser-pane")).toBeTruthy();
    expect(fileButton.getAttribute("aria-pressed")).toBe("true");
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
    expect(screen.queryByText("本机模式")).toBeNull();
    expect(bridge.syncNow).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("heading", { name: "搜索对话" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("搜索关键词")));

    await user.keyboard("{Control>},{/Control}");
    expect(await screen.findByLabelText("账户设置")).toBeTruthy();
  });

  it("keeps new chat fixed while navigation and history share one scroll region", async () => {
    cleanup();
    renderApp(createBridge());

    const scrollRegion = screen.getByTestId("sidebar-scroll");
    expect(scrollRegion.contains(screen.getByRole("navigation", { name: "主导航" }))).toBe(true);
    expect(scrollRegion.contains(screen.getByRole("region", { name: "对话历史" }))).toBe(true);
    expect(scrollRegion.contains(screen.getByRole("link", { name: "新对话" }))).toBe(false);
    expect(screen.queryByText("本机模式")).toBeNull();
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

  it("visibly marks the current conversation in history", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listConversations).mockResolvedValue([
      {
        ...snapshot.conversation,
        lastMessagePreview: "生成代码块和表格",
        messageCount: snapshot.messages.length,
      },
      {
        ...snapshot.conversation,
        id: "66666666-6666-4666-8666-666666666666",
        title: "另一个任务",
        lastMessagePreview: "未选中的历史任务",
        messageCount: 1,
      },
    ]);
    renderApp(bridge, `/chat/${conversationId}`);

    const activeHistoryLink = await screen.findByRole("link", { name: /Markdown 验收/ });
    const inactiveHistoryLink = screen.getByRole("link", { name: /另一个任务/ });

    expect(activeHistoryLink.getAttribute("aria-current")).toBe("page");
    expect(activeHistoryLink.classList).toContain("history-item-active");
    expect(inactiveHistoryLink.hasAttribute("aria-current")).toBe(false);
    expect(inactiveHistoryLink.classList).not.toContain("history-item-active");
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

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除对话…" }));
    const confirmedDialog = screen.getByRole("alertdialog", { name: "删除这个对话？" });
    await user.click(
      within(confirmedDialog).getByRole("checkbox", {
        name: /同时删除仅来源于此对话的长期记忆/,
      }),
    );
    await user.click(within(confirmedDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(bridge.deleteConversation).toHaveBeenCalledWith({
        conversationId,
        forgetSourceMemories: true,
      }),
    );
  });

  it("keeps HashRouter section navigation on settings and moves focus to the target", async () => {
    cleanup();
    renderApp(createBridge(), "/settings/account");
    const user = userEvent.setup();

    expect(await screen.findByLabelText("账户设置")).toBeTruthy();
    const settingsWorkspace = document.querySelector(".settings-account-page");
    const mainContent = document.getElementById("main-content");
    const appShell = document.querySelector(".app-shell");
    expect(settingsWorkspace).toBeTruthy();
    expect(appShell?.classList).toContain("settings-is-open");
    expect(mainContent?.classList).toContain("app-main-settings");
    expect(settingsWorkspace?.querySelector(".settings-page-header")).toBeNull();
    expect(settingsWorkspace?.querySelector(".settings-section-nav")).toBeTruthy();
    expect(settingsWorkspace?.querySelector(".settings-section-content")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();
    expect(screen.getByRole("button", { name: "返回应用" })).toBeTruthy();
    const settingsSearch = screen.getByRole("searchbox", { name: "搜索设置" });
    await user.type(settingsSearch, "工具");
    expect(screen.getByRole("button", { name: "工具" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "账户" })).toBeNull();
    await user.clear(settingsSearch);
    expect(screen.queryByLabelText("发送消息")).toBeNull();
    await user.click(screen.getByRole("button", { name: "外观" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("appearance-section"));
    expect(screen.getByLabelText("外观设置")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "外观", level: 1 })).toBeNull();
    expect(screen.getByRole("button", { name: "外观" }).getAttribute("aria-current")).toBe("page");

    await user.click(screen.getByRole("button", { name: "诊断与数据" }));
    const diagnostics = document.getElementById("diagnostics-section") as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(diagnostics));
    expect(screen.getByLabelText("诊断与数据导出")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "返回应用" }));
    expect(await screen.findByLabelText("发送消息")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
  });

  it("nests billing under settings instead of the primary sidebar", async () => {
    cleanup();
    renderApp(createBridge(), "/settings/account");
    const user = userEvent.setup();
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();

    await user.click(await screen.findByRole("button", { name: "费用与账单" }));
    await user.click(await screen.findByRole("link", { name: "查看费用与账单" }));
    expect(await screen.findByRole("heading", { name: "费用与账单" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();
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

  it("edits a user message with a send action instead of exposing branch creation", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.editMessage).mockResolvedValue({
      conversationId,
      branchId,
      userMessageId,
      assistantMessageId,
    });
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    const message = await screen.findByText("生成代码块和表格");
    const card = message.closest<HTMLElement>(".message-user");
    if (!card) throw new Error("User message card missing");

    await user.click(within(card).getByRole("button", { name: "编辑消息" }));
    const editor = within(card).getByRole("textbox", { name: "编辑消息内容" });
    const send = within(card).getByRole("button", { name: "发送" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(card.textContent).not.toContain("新建分支");

    await user.clear(editor);
    await user.type(editor, "修改后的问题");
    await user.click(send);

    expect(bridge.editMessage).toHaveBeenCalledWith({
      conversationId,
      messageId: userMessageId,
      text: "修改后的问题",
      idempotencyKey: expect.stringMatching(/^edit-/u),
    });
    expect(await screen.findByText("已提交修改，正在从这里重新生成回复。")).toBeTruthy();
  });

  it("uses the fixed-workbench hierarchy for completed replies", async () => {
    cleanup();
    const bridge = createBridge();
    const workItem: WorkItem = {
      id: "66666666-6666-4666-8666-666666666666",
      ownerProfileId: "local-default",
      conversationId,
      messageId: assistantMessageId,
      title: "对话轮次",
      status: "completed",
      activeRunId: null,
      createdAt: timestamp,
      updatedAt: "2026-08-25T09:00:08.000Z",
      completedAt: "2026-08-25T09:00:08.000Z",
      revision: 1,
    };
    vi.mocked(bridge.listWorkItems).mockResolvedValue([workItem]);
    renderApp(bridge, `/chat/${conversationId}`);

    expect(await screen.findByText("OpenERX Personal AI")).toBeTruthy();
    const workspace = await screen.findByRole("region", { name: "对话工作区" });
    const rail = await screen.findByRole("complementary", { name: "成果与来源" });
    const activity = workspace.querySelector(".assistant-activity-overview");
    const userMessage = workspace.querySelector(".message-user");
    const assistantMessage = workspace.querySelector(".message-assistant");
    const composer = workspace.querySelector(".composer");
    if (!activity || !userMessage || !assistantMessage || !composer) {
      throw new Error("Expected completed conversation workbench elements");
    }

    expect(activity.textContent).toContain("用时 8s");
    expect(activity.textContent).not.toContain("已完成");
    expect(activity.getAttribute("aria-expanded")).toBe("false");
    expect(assistantMessage.contains(activity)).toBe(true);
    expect(assistantMessage.querySelector(".assistant-conclusion-response")).toBeTruthy();
    expect(assistantMessage.querySelector(".message-actions")).toBeTruthy();
    await userEvent.setup().click(activity as HTMLElement);
    expect(assistantMessage.querySelectorAll(".assistant-response")).toHaveLength(2);
    expect(assistantMessage.querySelector(".assistant-conclusion-response")).toBeTruthy();
    expect(userMessage.querySelector(".message-state-header")).toBeNull();
    expect(assistantMessage.querySelector(".message-state-header")).toBeNull();
    const userContent = userMessage.querySelector(".message-content");
    const userActions = userMessage.querySelector(".message-actions");
    expect(userContent).toBeTruthy();
    expect(userActions?.parentElement).toBe(userMessage);
    expect(userContent?.contains(userActions)).toBe(false);
    expect(
      within(assistantMessage as HTMLElement).getByRole("button", { name: "复制" }),
    ).toBeTruthy();
    expect(
      within(assistantMessage as HTMLElement).getByRole("button", { name: "有帮助" }),
    ).toBeTruthy();
    expect(
      within(assistantMessage as HTMLElement).getByRole("button", { name: "没有帮助" }),
    ).toBeTruthy();
    expect(composer.contains(screen.getByLabelText("后续消息模型"))).toBe(true);
    expect(composer.contains(screen.getByLabelText("后续消息思考强度"))).toBe(true);
    expect(within(rail).getByRole("heading", { name: "输出内容" })).toBeTruthy();
    expect(within(rail).getByRole("heading", { name: "来源" })).toBeTruthy();
    expect(within(rail).getByRole("heading", { name: "本次运行" })).toBeTruthy();
  });

  it("presents real-browser calls as compact activity with an on-demand preview", async () => {
    cleanup();
    const bridge = createBridge();
    const workItemId = "66666666-6666-4666-8666-666666666667";
    const runId = "77777777-7777-4777-8777-777777777778";
    const stepId = "88888888-8888-4888-8888-888888888889";
    const toolCallId = "99999999-9999-4999-8999-999999999990";
    const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
    const rawMarker = "RAW_BROWSER_OBSERVATION_MARKER";
    const browserUrl = "https://www.bing.com/search?q=today";
    const browserInput = {
      idempotencyKey: "browser-open-test",
      operation: "browser_computer_use" as const,
      request: {
        contractVersion: "browser_computer_use_v2" as const,
        action: "open" as const,
        url: browserUrl,
        requestedBackend: "system_default" as const,
      },
    };
    const userMessage = snapshot.messages[0];
    const assistantMessage = snapshot.messages[1];
    if (!userMessage || !assistantMessage) throw new Error("CHAT_BROWSER_FIXTURE_INVALID");
    vi.mocked(bridge.getConversation).mockResolvedValue({
      ...snapshot,
      messages: [
        userMessage,
        {
          ...assistantMessage,
          parts: [
            { id: crypto.randomUUID(), type: "text", text: "我先打开网页核实。" },
            {
              id: crypto.randomUUID(),
              type: "text",
              text: "网页核实完成，下面是结论。",
            },
          ],
        },
      ],
    });
    const workItem: WorkItem = {
      id: workItemId,
      ownerProfileId: "local-default",
      conversationId,
      messageId: assistantMessageId,
      title: "对话轮次",
      status: "completed",
      activeRunId: runId,
      createdAt: timestamp,
      updatedAt: "2026-08-25T09:00:08.000Z",
      completedAt: "2026-08-25T09:00:08.000Z",
      revision: 1,
    };
    const run = {
      id: runId,
      workItemId,
      attempt: 1,
      status: "completed" as const,
      piPackageVersion: "0.84.4",
      piHostContractVersion: 2,
      selectedModelRef: "platform/auto",
      effectiveModelRef: "platform/standard",
      branchId,
      thinkingLevel: "high" as const,
      fallbackReason: null,
      initialToolNames: ["openerx_browser"],
      availableToolNames: ["openerx_browser"],
      skillInstallationIds: [],
      instructionSources: [],
      piSessionRef: `run:${runId}`,
      usageRecords: [],
      cancellationRequestedAt: null,
      lastPiEventSequence: 2,
      retryCount: 0,
      compactionCount: 0,
      errorCode: null,
      createdAt: timestamp,
      startedAt: timestamp,
      completedAt: "2026-08-25T09:00:08.000Z",
      updatedAt: "2026-08-25T09:00:08.000Z",
    };
    const detail: WorkItemDetail = {
      workItem,
      runs: [run],
      run,
      steps: [],
      toolCalls: [
        {
          id: toolCallId,
          runId,
          stepId,
          piCallRef: "browser:1",
          toolName: "openerx_browser",
          source: "openerx",
          status: "completed",
          risk: "L1",
          idempotencyKey: "browser-open-test",
          input: browserInput,
          inputSummary: "在系统默认浏览器中打开网页",
          targetSummary: browserUrl,
          resultSummary: "已在系统默认浏览器中打开专用窗口",
          resultContent: [
            {
              type: "text",
              text: `已在系统默认浏览器中打开专用窗口\n${JSON.stringify({
                marker: rawMarker,
                observation: {
                  sessionId,
                  applicationId: "windows.microsoft-edge",
                  state: "active",
                  title: "今天星期几？ - 搜索",
                  url: browserUrl,
                },
              })}`,
            },
            {
              type: "image",
              mimeType: "image/svg+xml",
              data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString(
                "base64",
              ),
            },
          ],
          errorCode: null,
          startedAt: timestamp,
          completedAt: "2026-08-25T09:00:08.000Z",
          updatedAt: "2026-08-25T09:00:08.000Z",
        },
      ],
      permissions: [],
      items: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          runId,
          sequence: 1,
          piItemRef: "model:1",
          status: "completed",
          content: {
            type: "model",
            modelRef: "platform/standard",
            summary: "准备网页核实",
          },
          startedAt: timestamp,
          completedAt: timestamp,
          errorCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
          runId,
          sequence: 2,
          piItemRef: "browser:1",
          status: "completed",
          content: {
            type: "tool",
            toolCallId,
            toolName: "openerx_browser",
            input: browserInput,
            inputSummary: "在系统默认浏览器中打开网页",
            targetSummary: browserUrl,
          },
          startedAt: timestamp,
          completedAt: "2026-08-25T09:00:08.000Z",
          errorCode: null,
          createdAt: timestamp,
          updatedAt: "2026-08-25T09:00:08.000Z",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
          runId,
          sequence: 3,
          piItemRef: "model:2",
          status: "completed",
          content: {
            type: "model",
            modelRef: "platform/standard",
            summary: "完成网页核实",
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
    vi.mocked(bridge.getWorkItem).mockResolvedValue(detail);
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    const activityOverview = await screen.findByRole("button", { name: /用时 8s/u });
    expect(activityOverview.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("我先打开网页核实。")).toBeNull();
    expect(screen.getByText("网页核实完成，下面是结论。")).toBeTruthy();
    expect(screen.queryByText("在 Microsoft Edge 中打开了网页")).toBeNull();
    await user.click(activityOverview);
    expect(activityOverview.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("我先打开网页核实。")).toBeTruthy();
    expect(screen.getByText("网页核实完成，下面是结论。")).toBeTruthy();

    const action = await screen.findByText("在 Microsoft Edge 中打开了网页");
    const browserActivity = action.closest<HTMLDetailsElement>(".tool-activity-segment");
    if (!browserActivity) throw new Error("Browser activity disclosure missing");
    const firstUpdate = screen.getByRole("region", { name: "OpenERX 进度更新 1" });
    const finalAnswer = screen.getByRole("region", { name: "OpenERX 最终答复" });
    expect(firstUpdate.contains(browserActivity)).toBe(true);
    expect(finalAnswer.contains(browserActivity)).toBe(false);
    expect(
      browserActivity.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(browserActivity.open).toBe(false);
    const technicalDetails = browserActivity.querySelector<HTMLDetailsElement>(
      "details.browser-activity-technical",
    );
    expect(technicalDetails?.open).toBe(false);
    expect(technicalDetails?.textContent).toContain(rawMarker);

    const browserActivitySummary = browserActivity.querySelector<HTMLElement>(":scope > summary");
    if (!browserActivitySummary) throw new Error("Browser activity summary missing");
    await user.click(browserActivitySummary);
    expect(browserActivity.open).toBe(true);

    await user.click(within(browserActivity).getByRole("button", { name: "查看画面" }));
    const preview = await screen.findByRole("complementary", { name: "浏览器画面" });
    expect(
      within(preview).getByRole("img", { name: "今天星期几？ - 搜索的浏览器画面" }),
    ).toBeTruthy();
    expect(within(preview).getByRole("link", { name: "在浏览器中打开" }).getAttribute("href")).toBe(
      browserUrl,
    );
    expect(preview.textContent).not.toContain(rawMarker);

    await user.click(within(preview).getByRole("button", { name: "返回成果与来源" }));
    expect(await screen.findByRole("complementary", { name: "成果与来源" })).toBeTruthy();

    await user.click(activityOverview);
    expect(activityOverview.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("我先打开网页核实。")).toBeNull();
    expect(screen.getByText("网页核实完成，下面是结论。")).toBeTruthy();
  });

  it("previews a current-task deliverable inside the conversation without navigating to files", async () => {
    cleanup();
    const bridge = createBridge();
    const artifactId = "99999999-9999-4999-8999-999999999991";
    vi.mocked(bridge.listArtifacts).mockResolvedValue([
      {
        id: artifactId,
        ownerProfileId: "local-default",
        displayName: "selection-report.docx",
        format: "docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        currentVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        versions: [
          {
            id: "99999999-9999-4999-8999-999999999992",
            artifactId,
            version: 1,
            sizeBytes: 1_024,
            checksumSha256: "d".repeat(64),
            objectRef: `objects/sha256/dd/${"d".repeat(64)}`,
            sourcePersonalFileId: null,
            createdAt: timestamp,
          },
        ],
      },
    ]);
    const surface = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64")}`;
    vi.mocked(bridge.previewArtifact).mockResolvedValue({
      objectKind: "artifact",
      objectId: artifactId,
      displayName: "selection-report.docx",
      format: "docx",
      source: null,
      imageDataUrl: null,
      renderedSurfaces: [
        {
          kind: "page",
          index: 1,
          label: "第 1 页",
          imageDataUrl: surface,
        },
      ],
      parsedText: "report",
      citations: [],
    });
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "预览 selection-report.docx" }));

    expect(await screen.findByRole("complementary", { name: "成果预览" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Markdown 验收" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "selection-report.docx 第 1 页" })).toBeTruthy();
    expect(bridge.previewArtifact).toHaveBeenCalledWith({ artifactId });
    expect(bridge.listArtifacts).toHaveBeenCalledWith({ conversationId });
    expect(screen.queryByRole("heading", { name: "个人文件与成果" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "返回输出内容" }));
    expect(await screen.findByRole("heading", { name: "输出内容" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "预览 selection-report.docx" }));
    expect(await screen.findByRole("complementary", { name: "成果预览" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "输出内容" })).toBeTruthy();
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
      piPackageVersion: "0.84.4",
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

    await user.click(await screen.findByRole("button", { name: /用时/u }));
    const activityLabel = await screen.findByText(/更新了执行计划/u);
    const activity = activityLabel.closest<HTMLDetailsElement>(".tool-activity-segment");
    if (!activity) throw new Error("Tool activity disclosure missing");
    expect(activity.open).toBe(false);
    const activitySummary = activity.querySelector<HTMLElement>(":scope > summary");
    if (!activitySummary) throw new Error("Tool activity summary missing");
    await user.click(activitySummary);
    expect(await screen.findByText("执行计划")).toBeTruthy();
    expect(screen.getByText("文件差异 · src/run.ts")).toBeTruthy();
    expect(screen.getByText("上下文压缩 · threshold")).toBeTruthy();
    expect(screen.queryByText("PRIVATE_RAW_CHAIN_OF_THOUGHT")).toBeNull();
    await user.selectOptions(screen.getByLabelText("选择要回放的 Run"), historicalRunId);
    expect((await screen.findAllByText("历史模型轮次已完成")).length).toBeGreaterThan(0);
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
    renderApp(bridge, "/settings/account?section=tools");
    const user = userEvent.setup();

    const mcpRow = (await screen.findByText("项目知识库")).closest("article");
    if (!mcpRow) throw new Error("MCP tool row missing");
    await user.click(within(mcpRow).getByRole("button", { name: "设置" }));
    expect(await screen.findByText("需要浏览器授权")).toBeTruthy();
    expect(screen.queryByLabelText("MCP OAuth Client Secret")).toBeNull();
    await user.click(screen.getByRole("button", { name: "在浏览器中授权" }));
    await waitFor(() => expect(bridge.authorizeMcpServer).toHaveBeenCalledWith({ serverId }));
    expect(await screen.findByText("OAuth 授权完成，工具已连接。")).toBeTruthy();
    expect(screen.getByText("已授权")).toBeTruthy();
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
    renderApp(bridge, "/settings/account?section=tools");
    const user = userEvent.setup();

    const browserRow = (await screen.findByText("浏览器操作")).closest("article");
    const shellRow = screen.getByText("终端").closest("article");
    const desktopRow = screen.getByText("桌面控制").closest("article");
    if (!browserRow || !shellRow || !desktopRow) throw new Error("tool row missing");
    expect(await within(browserRow).findByText("已启用")).toBeTruthy();
    expect(await within(shellRow).findByText("未配置")).toBeTruthy();
    expect(await within(desktopRow).findByText("部分可用")).toBeTruthy();

    await user.click(within(shellRow).getByRole("button", { name: "设置" }));
    expect(await screen.findByText("需先授权一个可写工作区")).toBeTruthy();
    expect(screen.getByText("阶段：Local Alpha")).toBeTruthy();
    expect(screen.getByText("网络：默认拒绝")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "关闭工具设置" }));

    await user.click(within(desktopRow).getByRole("button", { name: "设置" }));
    expect(await screen.findByText("需在系统设置中允许辅助功能")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "请求辅助功能权限" }));
    await waitFor(() =>
      expect(bridge.requestDesktopNativePermission).toHaveBeenCalledWith({
        permission: "accessibility",
      }),
    );
    expect(await screen.findByText("系统设置已打开；授权后请返回并刷新工具状态。")).toBeTruthy();
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
    renderApp(bridge, "/settings/account?section=tools");
    const user = userEvent.setup();

    const searchRow = (await screen.findByText("本地 Web Search")).closest("article");
    if (!searchRow) throw new Error("local Web Search row missing");
    await user.click(within(searchRow).getByRole("button", { name: "设置" }));
    const panel = await screen.findByRole("dialog", { name: "本地 Web Search" });
    expect(within(panel).getByText("退避中")).toBeTruthy();
    expect(within(panel).getByText(/LOCAL_SEARCH_RATE_LIMITED/u)).toBeTruthy();

    await user.selectOptions(
      within(panel).getByLabelText("Web Search Provider"),
      "direct:bing-html",
    );
    await user.selectOptions(within(panel).getByLabelText("Web Search 结果语言"), "en-US");
    await user.selectOptions(within(panel).getByLabelText("Web Search SafeSearch"), "strict");
    await user.click(within(panel).getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(bridge.updateLocalWebSearchSettings).toHaveBeenCalledWith({
        providerId: "direct:bing-html",
        locale: "en-US",
        safeSearch: "strict",
      }),
    );
    expect(await within(panel).findByText("搜索设置已保存。")).toBeTruthy();

    await user.click(within(panel).getByRole("button", { name: "重置搜索服务" }));
    await waitFor(() => expect(bridge.resetLocalWebSearchRuntime).toHaveBeenCalledWith());
    expect(await within(panel).findByText("已清除缓存并重置搜索服务。")).toBeTruthy();
    expect(within(panel).queryByText("退避中")).toBeNull();
  });

  it("shows browser as a configurable tool without exposing active browser sessions", async () => {
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
    renderApp(bridge, "/settings/account?section=tools");
    expect(await screen.findByText("浏览器操作")).toBeTruthy();
    expect(screen.queryByText("Google Chrome")).toBeNull();
    expect(screen.queryByText("机器默认浏览器")).toBeNull();
    expect(screen.queryByText("独立窗口 · 系统辅助功能")).toBeNull();
    expect(screen.queryByText("com.google.Chrome")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(bridge.listBrowserComputerUseSessions).not.toHaveBeenCalled();
    expect(bridge.pauseBrowserComputerUseSession).not.toHaveBeenCalled();
    expect(bridge.resumeBrowserComputerUseSession).not.toHaveBeenCalled();
  });

  it("filters the tool catalog and opens the MCP add flow without a recent-items section", async () => {
    cleanup();
    const bridge = createBridge();
    renderApp(bridge, "/settings/account?section=tools");
    const user = userEvent.setup();

    expect(await screen.findByLabelText("工具设置")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "工具", level: 1 })).toBeNull();
    expect(screen.queryByRole("link", { name: "工具" })).toBeNull();
    expect(screen.getByRole("button", { name: "工具" })).toBeTruthy();
    expect(screen.queryByText("最近添加")).toBeNull();

    const search = screen.getByRole("searchbox", { name: "搜索工具" });
    await user.type(search, "浏览器");
    expect(screen.getByText("浏览器操作")).toBeTruthy();
    expect(screen.queryByText("本地 Web Search")).toBeNull();

    await user.clear(search);
    await user.click(screen.getByRole("tab", { name: "MCP" }));
    expect(screen.getByText("MCP 服务")).toBeTruthy();
    expect(screen.queryByText("浏览器操作")).toBeNull();

    await user.click(screen.getByRole("button", { name: "添加工具" }));
    expect(await screen.findByRole("dialog", { name: "添加工具" })).toBeTruthy();
    expect(screen.getByLabelText("连接方式")).toBeTruthy();
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

    await user.click(screen.getByRole("button", { name: "返回应用" }));
    await user.click(screen.getByRole("link", { name: /搜索/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("搜索关键词")));
    await user.click(screen.getByRole("link", { name: "新对话" }));
    await user.click(screen.getByRole("button", { name: "显示归档对话" }));
    expect(await screen.findByText("历史 · 含归档")).toBeTruthy();
    expect(screen.getByText("还没有活动或归档对话。")).toBeTruthy();
  });
  it("creates a daily standalone automation from the automation page", async () => {
    const bridge = createBridge();
    vi.mocked(bridge.createAutomation).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ownerProfileId: "local-default",
      name: "每日巡检",
      prompt: "检查项目并运行测试",
      kind: "standalone",
      status: "active",
      schedule: {
        mode: "rrule",
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-30T01:00:00.000Z",
      },
      target: { conversationId: null, branchId: null, workspaceGrantIds: [] },
      execution: {
        modelRef: "platform/auto",
        thinkingLevel: "medium",
        skillInstallationId: null,
        maxConcurrentRuns: 1,
        catchUpPolicy: "skip",
        retryPolicy: "none",
      },
      nextRunAt: "2026-08-30T01:00:00.000Z",
      lastRunAt: null,
      createdAt: "2026-08-29T01:00:00.000Z",
      updatedAt: "2026-08-29T01:00:00.000Z",
      revision: 1,
    });
    renderApp(bridge, "/automations");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "自动化" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建自动化" }));
    await user.type(screen.getByLabelText("名称"), "每日巡检");
    await user.type(screen.getByLabelText("任务描述"), "检查项目并运行测试");
    await user.selectOptions(screen.getByLabelText("休眠期间错过执行"), "latest_once");
    await user.click(screen.getByRole("button", { name: "创建自动化" }));

    await waitFor(() => expect(bridge.createAutomation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bridge.createAutomation).mock.calls[0]?.[0]).toMatchObject({
      name: "每日巡检",
      prompt: "检查项目并运行测试",
      kind: "standalone",
      execution: { modelRef: "platform/byok.deepseek.flash", catchUpPolicy: "latest_once" },
      schedule: { mode: "rrule", expression: "FREQ=DAILY" },
    });
  });

  it("hides the assistant by default and redirects its direct route", async () => {
    cleanup();
    window.localStorage.removeItem("openerx.features.assistantEnabled");
    const bridge = createBridge();
    renderApp(bridge, "/assistant");

    const navigation = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(navigation).queryByRole("link", { name: "助手" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "新对话" }).getAttribute("aria-current")).toBe(
        "page",
      ),
    );
    expect(screen.queryByRole("heading", { name: "你好，我是OpenERX" })).toBeNull();
  });

  it("places the companion assistant below automations and opens its workspace mode", async () => {
    cleanup();
    window.localStorage.setItem("openerx.features.assistantEnabled", "true");
    window.localStorage.removeItem("openerx.assistant.companionEnabled");
    window.localStorage.removeItem("openerx.assistant.importantOnly");
    window.localStorage.removeItem("openerx.assistant.lastSeenAt");
    const bridge = createBridge();
    renderApp(bridge, "/assistant");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "你好，我是OpenERX" })).toBeTruthy();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    const navigationLabels = within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(navigationLabels.slice(-3)).toEqual(["自动化", "助手", "设置"]);
    expect(
      within(navigation).getByRole("link", { name: "助手" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("region", { name: "助手状态说明" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "开启伴随模式" }));
    await user.click(screen.getByRole("button", { name: /开始对话/ }));
    expect(await screen.findByRole("button", { name: "打开助手" })).toBeTruthy();
    expect(window.localStorage.getItem("openerx.assistant.companionEnabled")).toBe("true");
    await user.click(screen.getByRole("button", { name: "打开助手" }));
    await user.click(screen.getByRole("button", { name: "收起伴随模式" }));
    expect(screen.queryByRole("button", { name: "打开助手" })).toBeNull();

    window.localStorage.removeItem("openerx.assistant.companionEnabled");
    window.localStorage.removeItem("openerx.assistant.importantOnly");
    window.localStorage.removeItem("openerx.assistant.lastSeenAt");
    window.localStorage.removeItem("openerx.features.assistantEnabled");
  });

  it("prioritizes current work over terminal results already seen", async () => {
    cleanup();
    window.localStorage.setItem("openerx.features.assistantEnabled", "true");
    window.localStorage.setItem("openerx.assistant.lastSeenAt", new Date().toISOString());
    const bridge = createBridge();
    const runningWorkItem: WorkItem = {
      id: "77777777-7777-4777-8777-777777777777",
      ownerProfileId: "local-default",
      conversationId,
      messageId: assistantMessageId,
      title: "正在整理报告",
      status: "running",
      activeRunId: "88888888-8888-4888-8888-888888888888",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      revision: 1,
    };
    const oldFailedWorkItem: WorkItem = {
      ...runningWorkItem,
      id: "99999999-9999-4999-8999-999999999999",
      title: "很久以前失败的任务",
      status: "failed",
      activeRunId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(bridge.listWorkItems).mockResolvedValue([oldFailedWorkItem, runningWorkItem]);
    renderApp(bridge, "/assistant");

    expect(await screen.findByText("有 1 个任务正在进行，我会继续替你盯住。")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "OpenERX状态" })).getByText("处理中"),
    ).toBeTruthy();

    window.localStorage.removeItem("openerx.assistant.lastSeenAt");
    window.localStorage.removeItem("openerx.features.assistantEnabled");
  });

  it("counts a waiting work item and its permissions as one attention item", async () => {
    cleanup();
    window.localStorage.setItem("openerx.features.assistantEnabled", "true");
    window.localStorage.setItem("openerx.assistant.lastSeenAt", new Date().toISOString());
    const bridge = createBridge();
    const waitingWorkItem: WorkItem = {
      id: "77777777-7777-4777-8777-777777777777",
      ownerProfileId: "local-default",
      conversationId,
      messageId: assistantMessageId,
      title: "等待确认权限",
      status: "waiting_for_permission",
      activeRunId: "88888888-8888-4888-8888-888888888888",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      revision: 1,
    };
    const permissionBase: PermissionRequest = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ownerProfileId: "local-default",
      workItemId: waitingWorkItem.id,
      runId: "88888888-8888-4888-8888-888888888888",
      toolCallId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      capability: "file",
      risk: "L1",
      resourceType: "path",
      resource: "C:/workspace/report.md",
      actions: ["read"],
      reason: "读取工作区报告",
      payloadDigest: "a".repeat(64),
      status: "pending",
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      resolvedAt: null,
      resolution: null,
      scopeId: null,
    };
    vi.mocked(bridge.listWorkItems).mockResolvedValue([waitingWorkItem]);
    vi.mocked(bridge.listAutomations).mockRejectedValue(new Error("automation service offline"));
    vi.mocked(bridge.listPermissionRequests).mockResolvedValue([
      permissionBase,
      {
        ...permissionBase,
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        toolCallId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    ]);
    renderApp(bridge, "/assistant");

    expect(await screen.findByText("有 1 项工作正等你确认。")).toBeTruthy();
    expect(screen.getByText("有些动态暂时无法读取。")).toBeTruthy();
    const attentionMetric = within(screen.getByRole("region", { name: "今日工作脉搏" }))
      .getByText("待你确认")
      .closest("article");
    expect(attentionMetric?.querySelector("strong")?.textContent).toBe("1");

    window.localStorage.removeItem("openerx.assistant.lastSeenAt");
    window.localStorage.removeItem("openerx.features.assistantEnabled");
  });

  it("enables background startup from the automation page", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.updateLoginStartupSettings).mockResolvedValue({
      supported: true,
      openAtLogin: true,
      launchesInBackground: true,
    });
    renderApp(bridge, "/automations");
    const user = userEvent.setup();

    const startup = await screen.findByRole("checkbox", {
      name: "登录 Windows 后自动运行",
    });
    expect((startup as HTMLInputElement).checked).toBe(false);
    await user.click(startup);

    await waitFor(() =>
      expect(bridge.updateLoginStartupSettings).toHaveBeenCalledWith({ openAtLogin: true }),
    );
    expect((startup as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("已开启")).toBeTruthy();
    cleanup();
  });

  it("previews and edits an existing automation with revision locking", async () => {
    const bridge = createBridge();
    const automation = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ownerProfileId: "local-default",
      name: "每日巡检",
      prompt: "检查项目并运行测试",
      kind: "standalone" as const,
      status: "active" as const,
      schedule: {
        mode: "rrule" as const,
        expression: "FREQ=DAILY",
        timezone: "UTC",
        startAt: "2026-08-30T01:00:00.000Z",
      },
      target: { conversationId: null, branchId: null, workspaceGrantIds: [] },
      execution: {
        modelRef: "platform/byok",
        thinkingLevel: "medium" as const,
        skillInstallationId: null,
        maxConcurrentRuns: 1 as const,
        catchUpPolicy: "skip" as const,
        retryPolicy: "none" as const,
      },
      nextRunAt: "2026-08-30T01:00:00.000Z",
      lastRunAt: null,
      createdAt: "2026-08-29T01:00:00.000Z",
      updatedAt: "2026-08-29T01:00:00.000Z",
      revision: 3,
    };
    vi.mocked(bridge.listAutomations).mockResolvedValue([automation]);
    vi.mocked(bridge.previewAutomationSchedule).mockResolvedValue({
      occurrences: ["2026-08-30T01:00:00.000Z", "2026-08-31T01:00:00.000Z"],
    });
    vi.mocked(bridge.updateAutomation).mockResolvedValue({
      ...automation,
      name: "每日安全巡检",
      revision: 4,
    });
    renderApp(bridge, "/automations");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /每日巡检/ }));
    expect(screen.getByText("记录并跳过")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByRole("heading", { name: "编辑自动化" })).toBeTruthy();
    await waitFor(() => expect(bridge.previewAutomationSchedule).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "未来执行时间" })).toBeTruthy();
    const nameInput = screen.getByLabelText("名称");
    await user.clear(nameInput);
    await user.type(nameInput, "每日安全巡检");
    await user.selectOptions(screen.getByLabelText("休眠期间错过执行"), "latest_once");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(bridge.updateAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          automationId: automation.id,
          revision: 3,
          changes: expect.objectContaining({
            name: "每日安全巡检",
            execution: expect.objectContaining({ catchUpPolicy: "latest_once" }),
          }),
        }),
      ),
    );
  });

  it("creates a personal project from the sidebar without requiring a directory", async () => {
    cleanup();
    const bridge = createBridge();
    const createdProject = { ...projectDetail.project, name: "季度规划", instructions: "" };
    vi.mocked(bridge.createProject).mockResolvedValue(createdProject);
    vi.mocked(bridge.getProject).mockResolvedValue({
      project: createdProject,
      directories: [],
    });
    renderApp(bridge);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText("项目名称"), "季度规划");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() =>
      expect(bridge.createProject).toHaveBeenCalledWith({
        operationId: expect.any(String),
        name: "季度规划",
        instructions: "",
      }),
    );
    expect(await screen.findByRole("heading", { name: "季度规划" })).toBeTruthy();
  });

  it("opens a project from the sidebar and starts a project-scoped conversation", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listProjects).mockResolvedValue([projectSummary]);
    vi.mocked(bridge.getProject).mockResolvedValue(projectDetail);
    vi.mocked(bridge.listModels).mockResolvedValue([thinkingModel]);
    vi.mocked(bridge.listConversations).mockResolvedValue([
      {
        ...snapshot.conversation,
        projectId: personalProjectId,
        lastMessagePreview: "已完成第一版",
        messageCount: 2,
      },
    ]);
    renderApp(bridge);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("link", { name: /客户交付/ }));
    expect(await screen.findByRole("heading", { name: "客户交付" })).toBeTruthy();
    expect(screen.getByText("delivery-workspace")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "在此项目中开始对话" }));
    expect(await screen.findByRole("heading", { name: "在这个项目中做什么？" })).toBeTruthy();
    await user.type(screen.getByPlaceholderText("输入你的需求…"), "继续整理交付材料");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: null,
          projectId: personalProjectId,
          text: "继续整理交付材料",
        }),
      ),
    );
  });

  it("archives and restores a project without deleting its local directories", async () => {
    cleanup();
    const bridge = createBridge();
    let current = projectDetail;
    vi.mocked(bridge.getProject).mockImplementation(async () => current);
    vi.mocked(bridge.archiveProject).mockImplementation(async () => {
      current = {
        ...current,
        project: {
          ...current.project,
          archivedAt: "2026-09-04T12:00:00.000Z",
          revision: 3,
        },
      };
      return current.project;
    });
    vi.mocked(bridge.restoreProject).mockImplementation(async () => {
      current = {
        ...current,
        project: { ...current.project, archivedAt: null, revision: 4 },
      };
      return current.project;
    });
    renderApp(bridge, `/projects/${personalProjectId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "项目设置" }));
    await user.selectOptions(screen.getByLabelText("新目录访问权限"), "read_only");
    await user.click(screen.getByRole("button", { name: "添加目录" }));
    await waitFor(() =>
      expect(bridge.chooseProjectDirectory).toHaveBeenCalledWith({
        operationId: expect.any(String),
        projectId: personalProjectId,
        projectDirectoryId: null,
        expectedProjectRevision: 2,
        desiredAccess: "read_only",
      }),
    );
    await user.click(screen.getByRole("button", { name: "归档项目" }));
    await waitFor(() =>
      expect(bridge.archiveProject).toHaveBeenCalledWith({
        operationId: expect.any(String),
        projectId: personalProjectId,
        expectedRevision: 2,
      }),
    );
    expect(await screen.findByText("项目已归档；本机文件没有被删除。")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "恢复项目" }));
    await waitFor(() =>
      expect(bridge.restoreProject).toHaveBeenCalledWith({
        operationId: expect.any(String),
        projectId: personalProjectId,
        expectedRevision: 3,
      }),
    );
  });

  it("previews project permission differences and moves a conversation without rewriting history", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.listProjects).mockResolvedValue([projectSummary]);
    vi.mocked(bridge.getProject).mockResolvedValue(projectDetail);
    vi.mocked(bridge.moveConversationToProject)
      .mockResolvedValueOnce({
        ...snapshot.conversation,
        projectId: personalProjectId,
        revision: 4,
      })
      .mockResolvedValueOnce({
        ...snapshot.conversation,
        projectId: null,
        revision: 5,
      });
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "移动到项目…" }));
    await user.selectOptions(screen.getByLabelText("目标项目"), personalProjectId);

    expect(screen.getByText("只影响下一轮生成；现有消息、成果和已完成运行保持不变。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "下一轮将继承" })).toBeTruthy();
    expect(screen.getByText("delivery-workspace")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认更改" }));

    await waitFor(() =>
      expect(bridge.moveConversationToProject).toHaveBeenNthCalledWith(1, {
        operationId: expect.any(String),
        conversationId,
        projectId: personalProjectId,
        expectedConversationRevision: 3,
      }),
    );
    expect(screen.getByText("生成代码块和表格")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "客户交付" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "更改或移出项目…" }));
    await user.selectOptions(screen.getByLabelText("目标项目"), "");

    expect(screen.getByRole("heading", { name: "下一轮将不再继承" })).toBeTruthy();
    expect(screen.getByText("仅为此对话添加的文件和目录不会被移除。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认更改" }));

    await waitFor(() =>
      expect(bridge.moveConversationToProject).toHaveBeenNthCalledWith(2, {
        operationId: expect.any(String),
        conversationId,
        projectId: null,
        expectedConversationRevision: 4,
      }),
    );
    expect(screen.getByText("生成代码块和表格")).toBeTruthy();
  });

  it("labels project-inherited context separately from conversation-only scopes", async () => {
    cleanup();
    const bridge = createBridge();
    vi.mocked(bridge.getConversation).mockResolvedValue({
      ...snapshot,
      conversation: { ...snapshot.conversation, projectId: personalProjectId },
    });
    vi.mocked(bridge.getProject).mockResolvedValue(projectDetail);
    vi.mocked(bridge.listWorkspaces).mockResolvedValue([
      {
        id: projectWorkspaceGrantId,
        ownerProfileId: "local-default",
        conversationId,
        displayName: "delivery-workspace",
        rootPath: "C:\\delivery-workspace",
        access: "read_write",
        allowNetwork: false,
        expiresAt: null,
        revokedAt: null,
        createdAt: timestamp,
        bindingRole: "primary",
        bindingSource: "project",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ownerProfileId: "local-default",
        conversationId,
        displayName: "private-notes",
        rootPath: "C:\\private-notes",
        access: "read_only",
        allowNetwork: false,
        expiresAt: null,
        revokedAt: null,
        createdAt: timestamp,
        bindingRole: "additional",
        bindingSource: "user_added",
      },
    ]);
    renderApp(bridge, `/chat/${conversationId}`);
    const user = userEvent.setup();

    expect(await screen.findByRole("link", { name: "客户交付" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "切换上下文" }));

    expect(await screen.findByRole("region", { name: "项目上下文来源" })).toBeTruthy();
    expect(screen.getByText("优先使用中文，并在提交前运行测试。")).toBeTruthy();
    expect(screen.getByText(/^来自项目 · 主目录 · 读写 ·/)).toBeTruthy();
    expect(screen.getByText(/^仅此对话 · 附加目录 · 只读 ·/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "撤销 delivery-workspace 工作区" })).toBeNull();
    expect(screen.getByRole("button", { name: "撤销 private-notes 工作区" })).toBeTruthy();
  });
});
