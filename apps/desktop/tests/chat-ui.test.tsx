// @vitest-environment jsdom

import type { ConversationSnapshot, DesktopBridge } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";

const conversationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userMessageId = "33333333-3333-4333-8333-333333333333";
const assistantMessageId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-08-25T09:00:00.000Z";

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
});
