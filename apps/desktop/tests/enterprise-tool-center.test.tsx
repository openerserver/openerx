// @vitest-environment jsdom
import type {
  DesktopBridge,
  ToolRuntimeCapability,
  ToolRuntimeReadiness,
} from "@openerx/contracts";
import {
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { ToolCenter } from "../src/renderer/App";

afterEach(() => {
  cleanup();
  setDesktopWorkspaceBridge(null);
});
const capabilities: ToolRuntimeCapability[] = [
  "builtin.compute",
  "builtin.structured_data",
  "skill",
  "file",
  "browser",
  "shell",
  "mcp",
  "web.search",
  "desktop",
  "image.generate",
];
const readiness: ToolRuntimeReadiness[] = capabilities.map((capability) => ({
  capability,
  status:
    capability.startsWith("builtin.") || capability === "skill"
      ? "available"
      : ["file", "browser", "shell"].includes(capability)
        ? "authorization_required"
        : "unavailable",
  reason: null,
  availableToolNames: [],
  checkedAt: new Date().toISOString(),
  details: [`企业任务 ${capability} 使用说明`],
}));
function mount(read = vi.fn().mockResolvedValue(readiness), setup?: () => Promise<unknown>) {
  const unsupported = vi.fn(() => {
    throw new Error("UNSUPPORTED_CONFIG_MUST_NOT_BE_CALLED");
  });
  const bridge = new Proxy({ listToolRuntimeReadiness: read } as unknown as DesktopBridge, {
    get(target, name) {
      if (name === "startWindowsSandboxSetup" && setup) return setup;
      return name === "listToolRuntimeReadiness" ? target.listToolRuntimeReadiness : unsupported;
    },
  });
  setDesktopWorkspaceBridge(bridge);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ToolCenter managed />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { read, unsupported };
}
test("managed shell details offer explicit host initialization without invoking enterprise task execution", async () => {
  const read = vi
    .fn()
    .mockResolvedValue(
      readiness.map((tool) =>
        tool.capability === "shell"
          ? { ...tool, reason: "SHELL_WINDOWS_CODEX_SETUP_REQUIRED" }
          : tool,
      ),
    );
  const setup = vi.fn().mockResolvedValue({ success: true, reason: null, details: [] });
  const f = mount(read, setup);
  const row = (await screen.findByText("终端")).closest("article");
  if (!row) throw new Error("shell tool missing");
  fireEvent.click(within(row).getByRole("button", { name: "查看详情" }));
  expect(setup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "初始化 Windows 沙箱" }));
  await screen.findByText("Windows 沙箱初始化已完成。");
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
  expect(setup).toHaveBeenCalledExactlyOnceWith();
  expect(f.unsupported).not.toHaveBeenCalled();
});
test("managed tool center reads enterprise readiness without querying or exposing personal configuration", async () => {
  const f = mount();
  await screen.findByText("企业任务 file 使用说明");
  expect(screen.queryByText("状态未知")).toBeNull();
  expect(screen.queryByText(/保存失败/)).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect((screen.getByRole("button", { name: "添加工具" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  const row = screen.getByText("文件访问").closest("article");
  if (!row) throw new Error("file tool missing");
  fireEvent.click(within(row).getByRole("button", { name: "查看详情" }));
  expect(screen.getByRole("link", { name: "进入对话设置任务权限" }).getAttribute("href")).toBe(
    "/chat/new",
  );
  expect(f.unsupported).not.toHaveBeenCalled();
});
test("failed enterprise readiness has a readable error and a working retry instead of a save error", async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("NETWORK_ERROR"))
    .mockResolvedValue(readiness);
  const f = mount(read);
  await screen.findByRole("alert");
  expect(screen.queryByText(/保存失败/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "刷新工具状态" }));
  await screen.findByText("企业任务 file 使用说明");
  expect(f.unsupported).not.toHaveBeenCalled();
});

function mountConfiguredEnterprise(providerSettings = true) {
  const searchSettings = {
    providerId: "direct:baidu-json" as const,
    locale: "zh-CN" as const,
    safeSearch: "moderate" as const,
    featureEnabled: true,
    allowProviderFallback: true,
    cacheMode: "turn" as const,
    updatedAt: null,
    providers: [],
  };
  const server = {
    id: "66666666-6666-4666-8666-666666666699",
    name: "企业知识库",
    transport: "streamable_http" as const,
    url: "https://company.test/mcp",
    auth: "oauth" as const,
    credentialRef: "enterprise-mcp-secret",
    enabled: true,
    enabledTools: [],
  };
  const authorization = {
    serverId: server.id,
    status: "authorization_required" as const,
    connected: false,
    connectedAt: null,
    expiresAt: null,
    reason: null,
  };
  const unavailable = vi.fn(() => {
    throw new Error("PERSONAL_CONFIGURATION_MUST_NOT_BE_CALLED");
  });
  const methods = {
    listToolRuntimeReadiness: vi.fn().mockResolvedValue(
      readiness.map((tool) =>
        tool.capability === "desktop"
          ? {
              ...tool,
              status: "authorization_required",
              reason: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
              missingPermissions: ["screen_capture", "accessibility"],
            }
          : tool,
      ),
    ),
    getLocalWebSearchSettings: vi.fn().mockResolvedValue(searchSettings),
    updateLocalWebSearchSettings: vi
      .fn()
      .mockImplementation(async (selection) => ({ ...searchSettings, ...selection })),
    resetLocalWebSearchRuntime: vi.fn().mockResolvedValue(searchSettings),
    listMcpServers: vi.fn().mockResolvedValue([server]),
    listMcpServerAuthorizationStates: vi.fn().mockResolvedValue([authorization]),
    saveMcpServer: vi.fn().mockImplementation(async ({ config }) => config),
    testMcpServer: vi.fn().mockResolvedValue({
      serverId: server.id,
      connected: true,
      checkedAt: new Date().toISOString(),
      error: null,
      tools: [{ name: "lookup", description: "Enterprise lookup", enabled: true }],
    }),
    authorizeMcpServer: vi
      .fn()
      .mockResolvedValue({ ...authorization, status: "authorized", connected: true }),
    removeMcpServer: vi.fn().mockResolvedValue(undefined),
    requestDesktopNativePermission: vi.fn().mockResolvedValue({
      permission: "screen_capture",
      status: "not-determined",
      settingsOpened: true,
    }),
  };
  const bridge = new Proxy(methods, {
    get(target, name) {
      return name in target ? Reflect.get(target, name) : unavailable;
    },
  });
  setDesktopWorkspaceBridge(bridge as unknown as DesktopBridge, undefined, {
    ...enterpriseWorkspaceCapabilities,
    toolProviderSettings: providerSettings,
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ToolCenter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { methods, unavailable, server };
}

test("enterprise provider settings reuse MCP connection, OAuth, toggle and editing through the scoped bridge", async () => {
  const fixture = mountConfiguredEnterprise();
  const row = (await screen.findByText("企业知识库")).closest("article");
  if (!row) throw new Error("enterprise MCP missing");
  expect((screen.getByRole("button", { name: "添加工具" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(within(row).getByRole("checkbox", { name: "启用 企业知识库" }));
  await waitFor(() =>
    expect(fixture.methods.saveMcpServer).toHaveBeenCalledWith({
      config: { ...fixture.server, enabled: false },
    }),
  );
  fireEvent.click(within(row).getByRole("button", { name: "设置" }));
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText("连接成功，发现 1 个工具。")).toBeTruthy();
  expect(fixture.methods.testMcpServer).toHaveBeenCalledWith({ serverId: fixture.server.id });
  fireEvent.click(screen.getByRole("button", { name: "在浏览器中授权" }));
  expect(await screen.findByText("OAuth 授权完成，工具已连接。")).toBeTruthy();
  expect(fixture.methods.authorizeMcpServer).toHaveBeenCalledWith({ serverId: fixture.server.id });
  fireEvent.click(screen.getByRole("button", { name: "编辑配置" }));
  expect((screen.getByLabelText("MCP 名称") as HTMLInputElement).value).toBe("企业知识库");
  fireEvent.change(screen.getByLabelText("MCP 名称"), { target: { value: "企业知识库 2" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(fixture.methods.saveMcpServer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ id: fixture.server.id, name: "企业知识库 2" }),
      }),
    ),
  );
  expect(fixture.unavailable).not.toHaveBeenCalled();
});

test("enterprise search preferences can be saved and reset without exposing global native or personal browser settings", async () => {
  const fixture = mountConfiguredEnterprise();
  await screen.findByText("企业知识库");
  const row = screen.getByText("本地 Web Search").closest("article");
  if (!row) throw new Error("search tool missing");
  fireEvent.click(within(row).getByRole("button", { name: "设置" }));
  fireEvent.change(screen.getByLabelText("Web Search Provider"), {
    target: { value: "direct:bing-html" },
  });
  fireEvent.change(screen.getByLabelText("Web Search SafeSearch"), { target: { value: "strict" } });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  expect(await screen.findByText("搜索设置已保存。")).toBeTruthy();
  expect(fixture.methods.updateLocalWebSearchSettings).toHaveBeenCalledWith({
    providerId: "direct:bing-html",
    locale: "zh-CN",
    safeSearch: "strict",
  });
  fireEvent.click(screen.getByRole("button", { name: "重置搜索服务" }));
  expect(await screen.findByText("已清除缓存并重置搜索服务。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭工具设置" }));
  const browser = screen.getByText("浏览器操作").closest("article");
  if (!browser) throw new Error("browser tool missing");
  fireEvent.click(within(browser).getByRole("button", { name: "查看详情" }));
  expect(screen.queryByLabelText("默认浏览器模式")).toBeNull();
  expect(fixture.unavailable).not.toHaveBeenCalled();
});

test("enterprise desktop details expose system permission requests and readiness refresh", async () => {
  const fixture = mountConfiguredEnterprise();
  await screen.findByText("企业知识库");
  const row = screen.getByText("桌面控制").closest("article");
  if (!row) throw new Error("desktop tool missing");
  fireEvent.click(within(row).getByRole("button", { name: "查看详情" }));
  fireEvent.click(screen.getByRole("button", { name: "打开屏幕录制设置" }));
  await waitFor(() =>
    expect(fixture.methods.requestDesktopNativePermission).toHaveBeenCalledWith({
      permission: "screen_capture",
    }),
  );
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "打开辅助功能设置" }));
  await waitFor(() =>
    expect(fixture.methods.requestDesktopNativePermission).toHaveBeenLastCalledWith({
      permission: "accessibility",
    }),
  );
  const count = fixture.methods.listToolRuntimeReadiness.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "重新检测权限" }));
  await waitFor(() =>
    expect(fixture.methods.listToolRuntimeReadiness.mock.calls.length).toBeGreaterThan(count),
  );
  expect(screen.getByRole("link", { name: "进入对话设置任务权限" })).toBeTruthy();
  expect(fixture.unavailable).not.toHaveBeenCalled();
});

test("an enterprise host can explicitly keep provider configuration disabled", async () => {
  const fixture = mountConfiguredEnterprise(false);
  await screen.findByText("企业任务 file 使用说明");
  expect((screen.getByRole("button", { name: "添加工具" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(fixture.methods.listMcpServers).not.toHaveBeenCalled();
  expect(fixture.methods.getLocalWebSearchSettings).not.toHaveBeenCalled();
  expect(fixture.methods.listMcpServerAuthorizationStates).not.toHaveBeenCalled();
  expect(fixture.unavailable).not.toHaveBeenCalled();
});

test("enterprise MCP add and remove buttons persist via the enterprise bridge", async () => {
  const fixture = mountConfiguredEnterprise();
  await screen.findByText("企业知识库");
  fixture.methods.saveMcpServer.mockImplementation(async ({ config }) => {
    fixture.methods.listMcpServers.mockResolvedValue([fixture.server, config]);
    return config;
  });
  fireEvent.click(screen.getByRole("button", { name: "添加工具" }));
  fireEvent.change(screen.getByLabelText("MCP 名称"), { target: { value: "本机企业工具" } });
  fireEvent.change(screen.getByLabelText("MCP 命令"), { target: { value: "node" } });
  fireEvent.change(screen.getByLabelText("MCP 参数"), {
    target: { value: '["enterprise-tools.js"]' },
  });
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "添加工具" })).getByRole("button", {
      name: "添加工具",
    }),
  );
  await screen.findByText("MCP 配置已保存，可在服务设置中测试连接。");
  expect(fixture.methods.saveMcpServer).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({
        name: "本机企业工具",
        command: "node",
        args: ["enterprise-tools.js"],
      }),
    }),
  );
  const saved = fixture.methods.saveMcpServer.mock.calls[0]?.[0].config;
  fixture.methods.removeMcpServer.mockImplementation(async () => {
    fixture.methods.listMcpServers.mockResolvedValue([fixture.server]);
  });
  fireEvent.click(screen.getByRole("button", { name: "移除工具" }));
  expect(await screen.findByText("已移除 MCP 工具及其本机凭证引用。")).toBeTruthy();
  expect(fixture.methods.removeMcpServer).toHaveBeenCalledWith({ serverId: saved.id });
  await waitFor(() => expect(screen.queryByText("本机企业工具")).toBeNull());
  expect(fixture.unavailable).not.toHaveBeenCalled();
});
