// @vitest-environment jsdom

import type { DesktopBridge, ModelCatalogEntry } from "@openerx/contracts";
import { setDesktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../src/renderer/App";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  setDesktopWorkspaceBridge(null);
  vi.restoreAllMocks();
});

function newChatFixture() {
  const model = {
    modelRef: "byok/default",
    displayName: "测试文本模型",
    version: "test",
    capabilities: {
      textInput: true,
      imageInput: false,
      fileInput: false,
      functionCalling: true,
      structuredOutput: false,
    },
    contextWindow: 128000,
    maxOutputTokens: 8192,
    status: "available",
    priceRef: "test",
    priceSummary: "测试",
    free: true,
    thinkingLevels: ["off"],
  } satisfies ModelCatalogEntry;
  const unsubscribe = () => () => undefined;
  const sendMessage = vi.fn().mockRejectedValue(new Error("测试任务未提交"));
  const chooseFiles = vi.fn().mockResolvedValue([]);
  const bridge = {
    listModels: vi.fn().mockResolvedValue([model]),
    getModelServiceSettings: vi.fn().mockResolvedValue({
      mode: "byok",
      hostedAvailable: false,
      byok: { modelId: "default" },
      credentialConfigured: true,
    }),
    listConversations: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getAccountState: vi
      .fn()
      .mockResolvedValue({ status: "signed_out", account: null, session: null, reason: null }),
    onModelsChanged: unsubscribe,
    onChatEvent: unsubscribe,
    onAutomationRun: unsubscribe,
    onAutomationNavigate: unsubscribe,
    onAutomaticMemoryCreated: unsubscribe,
    onMemoryNavigate: unsubscribe,
    sendMessage,
    chooseFiles,
  } as unknown as DesktopBridge;
  setDesktopWorkspaceBridge(bridge);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/chat/new"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, view, sendMessage, chooseFiles };
}

test("puts the editable composer before a collapsed suggestion list and retains every task action", async () => {
  const { view, client, sendMessage } = newChatFixture();
  const summary = await screen.findByText("查看任务示例");
  const disclosure = summary.closest("details");
  if (!disclosure) throw new Error("Task examples must have a disclosure");
  const composer = screen.getByRole("textbox", { name: "发送消息" });
  expect(disclosure.open).toBe(false);
  expect(
    composer.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.change(composer, { target: { value: "我自己的任务草稿" } });
  disclosure.open = true;
  const examples = within(screen.getByRole("region", { name: "常用任务建议" })).getAllByRole(
    "button",
  );
  expect(examples).toHaveLength(4);
  fireEvent.click(
    within(disclosure).getByRole("button", {
      name: "检查我选择的文件或文件夹，找出问题并给出可验证的改进方案",
    }),
  );
  await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      conversationId: null,
      modelRef: "byok/default",
      text: "检查我选择的文件或文件夹，找出问题并给出可验证的改进方案",
    }),
  );
  expect((composer as HTMLTextAreaElement).value).toBe("我自己的任务草稿");
  expect(await screen.findByText("测试任务未提交")).toBeTruthy();
  view.unmount();
  client.clear();
});

test("reports a genuine picker cancellation neutrally without refreshing files or concealing a subsequent error", async () => {
  const { client, chooseFiles } = newChatFixture();
  await screen.findByText("查看任务示例");
  const refresh = vi.spyOn(client, "invalidateQueries");
  const composer = screen.getByRole("textbox", { name: "发送消息" });
  fireEvent.change(composer, { target: { value: "仍在编辑的草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
  expect(await screen.findByText("已取消文件选择。")).toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
  expect((composer as HTMLTextAreaElement).value).toBe("仍在编辑的草稿");
  chooseFiles.mockRejectedValueOnce(new Error("测试授权失效"));
  fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
  expect(await screen.findByText("测试授权失效")).toBeTruthy();
  expect(screen.queryByText("已取消文件选择。")).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  expect((composer as HTMLTextAreaElement).value).toBe("仍在编辑的草稿");
});
