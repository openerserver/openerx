// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserSettingsPanel } from "../src/renderer/BrowserSettingsPanel";

afterEach(cleanup);
it("manages all-sites, allowed hosts, block rules and disconnect through the trusted bridge", async () => {
  let state = {
    mode: "auto",
    extensionConnected: true,
    authorizedTabs: [],
    extensionDirectory: "/fixture",
    fullCdpEnabled: false,
    sitePolicy: {
      allowAllSites: false,
      allowedHosts: [] as string[],
      blockedHosts: [] as string[],
    },
  };
  const update = vi.fn(
    async (input: { action: string; allowed?: boolean; host?: string; decision?: string }) => {
      state = structuredClone(state);
      if (input.action === "all_sites") state.sitePolicy.allowAllSites = !!input.allowed;
      else if (input.action === "disconnect") state.extensionConnected = false;
      else {
        state.sitePolicy.allowedHosts = input.decision === "allow" ? [input.host!] : [];
        state.sitePolicy.blockedHosts = input.decision === "block" ? [input.host!] : [];
      }
      return state;
    },
  );
  Object.defineProperty(window, "openerx", {
    configurable: true,
    value: {
      getBrowserConnectionState: vi.fn(async () => state),
      listBrowserComputerUseSessions: vi.fn(async () => []),
      updateBrowserPermission: update,
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BrowserSettingsPanel />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText("扩展已连接 · 可使用已有标签页或新建页面");
  expect(screen.getByRole("heading", { name: "网站访问权限" })).toBeTruthy();
  expect(screen.getByText(/已连接的 Chrome 和独立浏览器共用以下规则/)).toBeTruthy();
  await user.click(screen.getByRole("checkbox"));
  await waitFor(() =>
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true),
  );
  await user.type(screen.getByLabelText("网站域名"), "example.com");
  await user.click(screen.getByRole("button", { name: "阻止此网站" }));
  await screen.findByRole("button", { name: "移除 example.com" });
  expect(update).toHaveBeenCalledWith({ action: "site", host: "example.com", decision: "block" });
  await user.click(screen.getByRole("button", { name: "移除 example.com" }));
  await waitFor(() => expect(screen.queryByText("example.com")).toBeNull());
  await user.click(screen.getByRole("button", { name: "断开浏览器并清除配对" }));
  await screen.findByText("扩展尚未连接");
  expect(update).toHaveBeenCalledWith({ action: "disconnect" });
});
it("persists browser selection and prepares a concrete extension setup", async () => {
  const state = {
    mode: "auto",
    extensionConnected: false,
    authorizedTabs: [],
    extensionDirectory: "/fixture/extension",
    fullCdpEnabled: false,
  };
  const bridge = {
    getBrowserConnectionState: vi.fn().mockResolvedValue(state),
    listBrowserComputerUseSessions: vi.fn().mockResolvedValue([]),
    updateBrowserMode: vi.fn(async (mode) => ({ ...state, mode })),
    prepareBrowserExtension: vi.fn().mockResolvedValue({
      extensionDirectory: state.extensionDirectory,
      pairingCode: "http://127.0.0.1:12345#fixture",
    }),
  };
  Object.defineProperty(window, "openerx", { configurable: true, value: bridge });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BrowserSettingsPanel />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await waitFor(() =>
    expect((screen.getByLabelText("默认浏览器模式") as HTMLSelectElement).disabled).toBe(false),
  );
  await user.selectOptions(screen.getByLabelText("默认浏览器模式"), "managed_chromium");
  await screen.findByText("浏览器模式已保存，下次打开时生效。");
  expect(bridge.updateBrowserMode).toHaveBeenCalledWith("managed_chromium");
  await user.click(screen.getByRole("button", { name: "准备 Chrome 扩展" }));
  const input = await screen.findByLabelText("Chrome 配对码");
  expect(input.getAttribute("type")).toBe("password");
  expect((screen.getByLabelText("扩展目录") as HTMLInputElement).value).toBe("/fixture/extension");
});
