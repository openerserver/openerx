// @vitest-environment jsdom
import type { ConversationSnapshot, DesktopBridge, ProjectDetail } from "@openerx/contracts";
import {
  desktopWorkspaceCapabilities,
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { conversationTargetHref } from "../src/renderer/conversation-target";
import { ModalDialog } from "../src/renderer/ModalDialog";
import { ProjectSettings } from "../src/renderer/projects/ProjectSettings";
import {
  settingsSearchTarget,
  settingsSectionSearch,
  settingsSectionUrl,
} from "../src/renderer/settings-navigation";
import { useConversationTarget } from "../src/renderer/use-conversation-target";

afterEach(() => {
  cleanup();
  setDesktopWorkspaceBridge(null);
  vi.restoreAllMocks();
});
test("modal contains keyboard focus, ignores Escape during a save, and restores the opening button", () => {
  function Demo() {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          打开
        </button>
        {open && (
          <ModalDialog
            className="dialog"
            titleId="title"
            pending={pending}
            onClose={() => setOpen(false)}
          >
            <h2 id="title">测试弹窗</h2>
            <input aria-label="名称" data-dialog-initial-focus />
            <button type="button" onClick={() => setPending(true)}>
              保存
            </button>
            <button type="button" onClick={() => setPending(false)}>
              完成
            </button>
          </ModalDialog>
        )}
      </>
    );
  }
  render(<Demo />);
  const trigger = screen.getByText("打开");
  trigger.focus();
  fireEvent.click(trigger);
  const input = screen.getByLabelText("名称"),
    last = screen.getByText("完成");
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByText("保存"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(last);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.closest("[inert]")).toBeNull();
});
test("a nested modal handles Escape before its parent", () => {
  const outer = vi.fn(),
    inner = vi.fn();
  render(
    <ModalDialog className="dialog" titleId="outer" onClose={outer}>
      <h2 id="outer">外层</h2>
      <ModalDialog className="dialog" titleId="inner" onClose={inner}>
        <h2 id="inner">内层</h2>
        <button type="button">完成</button>
      </ModalDialog>
    </ModalDialog>,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(inner).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
});
test("settings aliases carry the nested destination in a refreshable URL", () => {
  for (const [section, query, key, value] of [
    ["extension", "设备", "panel", "devices"],
    ["extension", "手机", "panel", "devices"],
    ["extension", "配对", "panel", "devices"],
    ["extension", "电脑名称", "panel", "devices"],
    ["extension", "密码", "panel", "account"],
    ["enterprise", "Skill", "target", "skills"],
    ["enterprise", "验证器", "target", "security"],
    ["enterprise", "模型", "target", "models"],
  ]) {
    expect(settingsSectionSearch(section!, query!, "unrelated")).toBe(true);
    const params = new URLSearchParams(
      settingsSectionUrl("legacy=1&panel=data", section!, settingsSearchTarget(section!, query!)),
    );
    expect(params.get("section")).toBe(section);
    expect(params.get(key!)).toBe(value);
    expect(params.has("legacy")).toBe(false);
  }
  expect(settingsSectionSearch("enterprise", "不存在", "企业")).toBe(false);
});
function targetFixture(branchConversation = "c") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const original = {
    conversation: { id: "c", activeBranchId: "a" },
    branches: [
      { id: "a", conversationId: "c" },
      { id: "b", conversationId: branchConversation },
    ],
    messages: [],
  } as unknown as ConversationSnapshot;
  const next = {
    ...original,
    conversation: { ...original.conversation, activeBranchId: "b" },
    messages: [{ id: "m", conversationId: "c", branchId: "b" }],
  } as ConversationSnapshot;
  const getConversation = vi.fn().mockResolvedValue(original),
    activateBranch = vi.fn().mockResolvedValue(next);
  const bridge = { getConversation, activateBranch } as unknown as DesktopBridge;
  setDesktopWorkspaceBridge(bridge);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          conversationTargetHref({ conversationId: "c", branchId: "b", messageId: "m" }),
        ]}
      >
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, bridge, getConversation, activateBranch, wrapper, next };
}
test("search target validates branch ownership, activates the hit branch and caches its messages", async () => {
  const f = targetFixture();
  const hook = renderHook(() => useConversationTarget("c", true, ["chat", "conversation", "c"]), {
    wrapper: f.wrapper,
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(f.activateBranch).toHaveBeenCalledWith({ conversationId: "c", branchId: "b" });
  expect(hook.result.current.messageId).toBe("m");
  expect(f.client.getQueryData(["chat", "conversation", "c"])).toEqual(f.next);
});
test("foreign and removed branches cannot change the active task", async () => {
  const f = targetFixture("foreign");
  const hook = renderHook(() => useConversationTarget("c", true, ["chat", "conversation", "c"]), {
    wrapper: f.wrapper,
  });
  await waitFor(() => expect(hook.result.current.error).toContain("不属于此对话"));
  expect(f.activateBranch).not.toHaveBeenCalled();
  expect(hook.result.current.messageId).toBeNull();
});
test("a late target lookup cannot activate a previous account's branch", async () => {
  const f = targetFixture();
  let finish!: (value: unknown) => void;
  f.getConversation.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const hook = renderHook(() => useConversationTarget("c", true, ["chat", "conversation", "c"]), {
    wrapper: f.wrapper,
  });
  const initial = await targetFixture().getConversation();
  setDesktopWorkspaceBridge({} as DesktopBridge);
  finish(initial);
  await waitFor(() => expect(f.getConversation).toHaveBeenCalledOnce());
  expect(f.activateBranch).not.toHaveBeenCalled();
  hook.unmount();
});
test("enterprise project directory controls cannot send unsupported calls while personal controls remain available", async () => {
  const chooseProjectDirectory = vi.fn(),
    bridge = { chooseProjectDirectory } as unknown as DesktopBridge;
  const detail = {
    project: { id: "p", name: "企业项目", instructions: "", pinnedRank: null, revision: 1 },
    directories: [],
  } as unknown as ProjectDetail;
  setDesktopWorkspaceBridge(bridge, undefined, enterpriseWorkspaceCapabilities);
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectSettings detail={detail} onClose={() => {}} />
    </QueryClientProvider>,
  );
  const add = screen.getByRole("button", { name: "添加目录" });
  expect(add).toHaveProperty("disabled", true);
  fireEvent.click(add);
  expect(chooseProjectDirectory).not.toHaveBeenCalled();
  expect(screen.getByText(/企业项目暂不支持绑定/)).toBeTruthy();
  expect(desktopWorkspaceCapabilities().automationRetryPolicies).toEqual(["none"]);
  view.unmount();
  setDesktopWorkspaceBridge({ chooseProjectDirectory } as unknown as DesktopBridge);
  render(
    <QueryClientProvider client={client}>
      <ProjectSettings detail={detail} onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("button", { name: "添加目录" })).toHaveProperty("disabled", false);
});
