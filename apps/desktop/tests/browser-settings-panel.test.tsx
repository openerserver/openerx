// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserSettingsPanel } from "../src/renderer/BrowserSettingsPanel";

afterEach(cleanup);
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
    prepareBrowserExtension: vi
      .fn()
      .mockResolvedValue({
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
