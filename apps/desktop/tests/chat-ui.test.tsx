// @vitest-environment jsdom

import type { ConversationSnapshot, DesktopBridge, SkillInstallation } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

const snapshot: ConversationSnapshot = {
  conversation: {
    id: conversationId,
    ownerProfileId: "local-default",
    title: "Markdown 验收",
    activeBranchId: branchId,
    selectedModelRef: "pi/default",
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
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 2,
    },
  ],
};

function createBridge(): DesktopBridge {
  return {
    getEnvironment: vi.fn().mockResolvedValue({
      platform: "darwin",
      arch: "arm64",
      appVersion: "2.0.0-alpha.0",
    }),
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
    search: vi.fn().mockResolvedValue([]),
    activateBranch: vi.fn(),
    getChatEvents: vi.fn().mockResolvedValue([]),
    chooseFiles: vi.fn().mockResolvedValue([]),
    chooseDirectory: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    searchFiles: vi.fn().mockResolvedValue([]),
    previewFile: vi.fn(),
    revokeFileScope: vi.fn(),
    attachFile: vi.fn(),
    listArtifacts: vi.fn().mockResolvedValue([]),
    getArtifact: vi.fn(),
    previewArtifact: vi.fn(),
    saveArtifact: vi.fn(),
    listWorkItems: vi.fn().mockResolvedValue([]),
    getWorkItem: vi.fn(),
    listPermissionRequests: vi.fn().mockResolvedValue([]),
    resolvePermission: vi.fn(),
    listCapabilityScopes: vi.fn().mockResolvedValue([]),
    revokeCapabilityScope: vi.fn(),
    listMcpServers: vi.fn().mockResolvedValue([]),
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
