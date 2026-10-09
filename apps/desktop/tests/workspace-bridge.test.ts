// @vitest-environment jsdom
import type { DesktopBridge } from "@openerx/contracts";
import {
  desktopWorkspaceBridge,
  desktopWorkspaceCapabilities,
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";

const original = Object.getOwnPropertyDescriptor(window, "openerx");
afterEach(() => {
  setDesktopWorkspaceBridge(null);
  if (original) Object.defineProperty(window, "openerx", original);
  else Reflect.deleteProperty(window, "openerx");
});
function preload(bridge: Partial<DesktopBridge>) {
  Object.defineProperty(window, "openerx", { configurable: true, value: bridge });
}

describe("workspace bridge registration", () => {
  it("keeps the personal edition on its original preload bridge", async () => {
    const listConversations = vi.fn().mockResolvedValue([]);
    const personal = { listConversations };
    preload(personal);
    expect(desktopWorkspaceBridge()).toBe(personal);
    await desktopWorkspaceBridge().listConversations();
    expect(listConversations).toHaveBeenCalledOnce();
  });
  it("routes the same page's requests and event subscriptions exclusively to its scoped adapter", async () => {
    const personal = { listConversations: vi.fn(), onChatEvent: vi.fn() };
    const remove = vi.fn();
    const scoped = {
      listConversations: vi.fn().mockResolvedValue([]),
      onChatEvent: vi.fn().mockReturnValue(remove),
    };
    preload(personal);
    setDesktopWorkspaceBridge(scoped as unknown as DesktopBridge);
    await desktopWorkspaceBridge().listConversations({ includeArchived: true });
    const unsubscribe = desktopWorkspaceBridge().onChatEvent(vi.fn());
    expect(scoped.listConversations).toHaveBeenCalledWith({ includeArchived: true });
    expect(personal.listConversations).not.toHaveBeenCalled();
    expect(personal.onChatEvent).not.toHaveBeenCalled();
    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
    expect(window.openerx).toBe(personal);
  });
  it("does not fall back to personal data when an enterprise adapter rejects or lacks a method", async () => {
    const personal = {
      listConversations: vi.fn().mockResolvedValue(["personal-secret"]),
      listProjects: vi.fn(),
    };
    const scoped = {
      listConversations: vi.fn().mockRejectedValue(new Error("ENTERPRISE_ACCESS_DENIED")),
    };
    preload(personal);
    setDesktopWorkspaceBridge(scoped as unknown as DesktopBridge);
    await expect(desktopWorkspaceBridge().listConversations()).rejects.toThrow(
      "ENTERPRISE_ACCESS_DENIED",
    );
    expect(() => desktopWorkspaceBridge().listProjects()).toThrow();
    expect(personal.listConversations).not.toHaveBeenCalled();
    expect(personal.listProjects).not.toHaveBeenCalled();
  });
  it("changes scope for subsequent calls without mutating the preload object", async () => {
    const personal = { listConversations: vi.fn() };
    const first = { listConversations: vi.fn().mockResolvedValue([]) };
    const next = { listConversations: vi.fn().mockResolvedValue([]) };
    preload(personal);
    setDesktopWorkspaceBridge(first as unknown as DesktopBridge);
    await desktopWorkspaceBridge().listConversations();
    setDesktopWorkspaceBridge(next as unknown as DesktopBridge);
    await desktopWorkspaceBridge().listConversations();
    expect(first.listConversations).toHaveBeenCalledOnce();
    expect(next.listConversations).toHaveBeenCalledOnce();
    expect(window.openerx).toBe(personal);
    setDesktopWorkspaceBridge(null);
    expect(desktopWorkspaceBridge()).toBe(personal);
  });
});

it("advertises provider editing only through the active host capability contract", () => {
  preload({});
  expect(desktopWorkspaceCapabilities().toolProviderSettings).toBe(true);
  const enabled = {} as DesktopBridge;
  const disabled = {} as DesktopBridge;
  setDesktopWorkspaceBridge(enabled, undefined, enterpriseWorkspaceCapabilities);
  expect(desktopWorkspaceCapabilities()).toMatchObject({
    mode: "enterprise",
    toolProviderSettings: true,
  });
  setDesktopWorkspaceBridge(disabled, undefined, {
    ...enterpriseWorkspaceCapabilities,
    toolProviderSettings: false,
  });
  expect(desktopWorkspaceCapabilities().toolProviderSettings).toBe(false);
  setDesktopWorkspaceBridge(enabled);
  expect(desktopWorkspaceCapabilities().toolProviderSettings).toBe(true);
  setDesktopWorkspaceBridge(null);
  expect(desktopWorkspaceCapabilities().mode).toBe("personal");
});
