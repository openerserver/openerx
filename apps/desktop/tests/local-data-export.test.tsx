// @vitest-environment jsdom
import type { DesktopBridge } from "@openerx/contracts";
import { setDesktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LocalDataExportSettings } from "../src/renderer/LocalDataExportSettings";

afterEach(() => {
  cleanup();
  setDesktopWorkspaceBridge(null);
});
function mount(native: Partial<DesktopBridge>, legacy = true) {
  window.openerx = native as DesktopBridge;
  const workspace = {
    getPersonalDataSummary: vi.fn().mockRejectedValue(new Error("ENTERPRISE_ACCESS_DENIED")),
    exportPersonalData: vi.fn().mockRejectedValue(new Error("ENTERPRISE_ACCESS_DENIED")),
    sendMessage: vi.fn(),
  };
  setDesktopWorkspaceBridge((legacy ? workspace : native) as unknown as DesktopBridge);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LocalDataExportSettings legacy={legacy} />
    </QueryClientProvider>,
  );
  return workspace;
}
const counts = { conversations: 7, messages: 14, files: 2, artifacts: 1, memories: 3 };
test("explicit old-data summary and export use the same native database under an enterprise bridge", async () => {
  const native = {
    getLegacyPersonalDataSummary: vi.fn().mockResolvedValue(counts),
    exportLegacyPersonalData: vi.fn().mockResolvedValue({ fileName: "old-data.zip" }),
    getPersonalDataSummary: vi.fn(() => {
      throw new Error("CURRENT_PERSONAL_PROFILE_FORBIDDEN");
    }),
    exportPersonalData: vi.fn(() => {
      throw new Error("CURRENT_PERSONAL_PROFILE_FORBIDDEN");
    }),
  };
  const workspace = mount(native);
  await screen.findByText(/7 个对话 · 14 条消息/);
  expect(native.exportLegacyPersonalData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "导出旧版数据" }));
  await screen.findByText("旧版数据已保存：old-data.zip");
  expect(native.exportLegacyPersonalData).toHaveBeenCalledOnce();
  expect(native.getPersonalDataSummary).not.toHaveBeenCalled();
  expect(native.exportPersonalData).not.toHaveBeenCalled();
  expect(workspace.getPersonalDataSummary).not.toHaveBeenCalled();
  expect(workspace.exportPersonalData).not.toHaveBeenCalled();
  expect(workspace.sendMessage).not.toHaveBeenCalled();
});
test("failed reads never claim zero data, disable export, and recover on an explicit retry", async () => {
  const native = {
    getLegacyPersonalDataSummary: vi
      .fn()
      .mockRejectedValueOnce(new Error("DISK_UNAVAILABLE"))
      .mockResolvedValue(counts),
    exportLegacyPersonalData: vi.fn(),
  };
  mount(native);
  await screen.findByRole("alert");
  expect(screen.queryByText(/0 个对话/)).toBeNull();
  expect((screen.getByRole("button", { name: "导出旧版数据" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新读取本机数据" }));
  await screen.findByText(/7 个对话/);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(native.exportLegacyPersonalData).not.toHaveBeenCalled();
});
test("personal edition keeps its own data label and does not export without a click", async () => {
  const native = {
    getPersonalDataSummary: vi.fn().mockResolvedValue(counts),
    exportPersonalData: vi.fn(),
  };
  mount(native, false);
  await screen.findByText(/7 个对话/);
  expect(screen.getByRole("button", { name: "导出个人数据" })).toBeDefined();
  expect(native.exportPersonalData).not.toHaveBeenCalled();
});

test("personal export follows the registered owner profile instead of native legacy data", async () => {
  const native = {
    getPersonalDataSummary: vi.fn(() => {
      throw new Error("UNSCOPED_PERSONAL_READ_FORBIDDEN");
    }),
    exportPersonalData: vi.fn(() => {
      throw new Error("UNSCOPED_PERSONAL_EXPORT_FORBIDDEN");
    }),
    getLegacyPersonalDataSummary: vi.fn(() => {
      throw new Error("LEGACY_READ_FORBIDDEN");
    }),
    exportLegacyPersonalData: vi.fn(() => {
      throw new Error("LEGACY_EXPORT_FORBIDDEN");
    }),
  };
  const scoped = {
    getPersonalDataSummary: vi.fn().mockResolvedValue(counts),
    exportPersonalData: vi.fn().mockResolvedValue({ fileName: "current-personal.zip" }),
  };
  window.openerx = native as unknown as DesktopBridge;
  setDesktopWorkspaceBridge(scoped as unknown as DesktopBridge);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LocalDataExportSettings />
    </QueryClientProvider>,
  );
  await screen.findByText(/7 个对话/);
  fireEvent.click(screen.getByRole("button", { name: "导出个人数据" }));
  await screen.findByText("个人数据已保存：current-personal.zip");
  expect(scoped.exportPersonalData).toHaveBeenCalledOnce();
  for (const operation of Object.values(native)) expect(operation).not.toHaveBeenCalled();
});
