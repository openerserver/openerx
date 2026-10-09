// @vitest-environment jsdom
import type { DesktopBridge } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LegacyPersonalData } from "../src/renderer/LegacyPersonalData";

afterEach(cleanup);

test("legacy data is read only after an explicit request and never starts a model run", async () => {
  const bridge = {
    listLegacyConversations: vi.fn().mockResolvedValue([{ id: "old", title: "升级前任务" }]),
    getLegacyConversation: vi.fn().mockResolvedValue({
      conversation: { id: "old", title: "升级前任务" },
      messages: [{ id: "m", role: "user", parts: [{ text: "保留的原始内容" }] }],
    }),
    sendMessage: vi.fn(),
    listConversations: vi.fn(() => {
      throw new Error("CURRENT_PERSONAL_PROFILE_FORBIDDEN");
    }),
    getConversation: vi.fn(() => {
      throw new Error("CURRENT_PERSONAL_PROFILE_FORBIDDEN");
    }),
  };
  window.openerx = bridge as unknown as DesktopBridge;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LegacyPersonalData />
    </QueryClientProvider>,
  );
  expect(bridge.listLegacyConversations).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看旧版记录" }));
  fireEvent.click(await screen.findByRole("button", { name: "升级前任务" }));
  await screen.findByText("保留的原始内容");
  expect(bridge.getLegacyConversation).toHaveBeenCalledWith({ conversationId: "old" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(bridge.sendMessage).not.toHaveBeenCalled();
  expect(bridge.listConversations).not.toHaveBeenCalled();
  expect(bridge.getConversation).not.toHaveBeenCalled();
});
