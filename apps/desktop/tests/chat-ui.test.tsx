// @vitest-environment jsdom

import type { ConversationSnapshot, DesktopBridge } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
    requestEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    signOut: vi.fn(),
    revokeDevice: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    getUsage: vi.fn(),
    syncNow: vi.fn(),
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

function renderApp(bridge: DesktopBridge): void {
  Object.defineProperty(window, "openerx", { configurable: true, value: bridge });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/chat/new"]}>
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
});
