// @vitest-environment jsdom
import type {
  DesktopBridge,
  DesktopMcpServerSaveInput,
  McpServerConfig,
  McpServerPreset,
} from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServerEditor } from "../src/renderer/McpServerEditor";

afterEach(cleanup);

function setup(
  server?: McpServerConfig,
  existingNames: string[] = [],
  additionalPresets: readonly McpServerPreset[] = [],
) {
  const save = vi.fn(async (input: DesktopMcpServerSaveInput) => input.config);
  window.openerx = { saveMcpServer: save } as unknown as DesktopBridge;
  const onSaved = vi.fn(async () => {});
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <McpServerEditor
        server={server}
        existingNames={existingNames}
        additionalPresets={additionalPresets}
        onSaved={onSaved}
        onClose={vi.fn()}
        errorMessage={(_error, fallback) => fallback}
      />
    </QueryClientProvider>,
  );
  return { save, onSaved, user: userEvent.setup() };
}

describe("MCP editor", () => {
  it("prefills Context7 without saving until the user submits", async () => {
    const { save, user } = setup();
    expect(screen.getAllByRole("button", { name: /^配置 /u })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "配置 Context7" }));
    expect(screen.getByLabelText("MCP URL")).toHaveProperty(
      "value",
      "https://mcp.context7.com/mcp",
    );
    expect(screen.getByLabelText("MCP 认证")).toHaveProperty("value", "none");
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "添加工具" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        config: expect.objectContaining({
          name: "Context7",
          transport: "streamable_http",
          auth: "none",
          enabled: true,
          url: "https://mcp.context7.com/mcp",
          credentialRef: null,
        }),
      }),
    );
  });

  it("requires a GitHub PAT and keeps it outside the public read-only configuration", async () => {
    const { save, user } = setup();
    await user.click(screen.getByRole("button", { name: "配置 GitHub" }));
    await user.click(screen.getByRole("button", { name: "添加工具" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "请填写此服务的 Bearer 令牌。",
    );
    expect(save).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("MCP Bearer Token"), "fixture-personal-token");
    await user.click(screen.getByRole("button", { name: "添加工具" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        config: expect.objectContaining({
          name: "GitHub",
          auth: "bearer",
          url: "https://api.githubcopilot.com/mcp/readonly",
        }),
        bearerToken: "fixture-personal-token",
      }),
    );
  });

  it("clears credentials and custom values when switching presets", async () => {
    const { save, user } = setup();
    await user.click(screen.getByRole("button", { name: "配置 GitHub" }));
    await user.type(screen.getByLabelText("MCP Bearer Token"), "must-not-reuse");
    fireEvent.change(screen.getByLabelText("MCP 请求头"), {
      target: { value: "X-Secret=must-not-reuse" },
    });
    await user.click(screen.getByRole("button", { name: "配置 Context7" }));
    expect(screen.getByLabelText("MCP 请求头")).toHaveProperty("value", "");
    await user.selectOptions(screen.getByLabelText("MCP 认证"), "bearer");
    expect(screen.getByLabelText("MCP Bearer Token")).toHaveProperty("value", "");
    expect(save).not.toHaveBeenCalled();
  });

  it("accepts distributor templates but requires a real service address", async () => {
    const { save, user } = setup(
      undefined,
      [],
      [
        {
          id: "internal",
          name: "内网服务",
          description: "企业工具",
          url: "",
          auth: "bearer",
          hint: "填写企业提供的 MCP 地址和凭据。",
        },
      ],
    );
    await user.click(screen.getByRole("button", { name: "配置 内网服务" }));
    expect(screen.getByLabelText("MCP URL")).toHaveProperty("value", "");
    await user.type(screen.getByLabelText("MCP Bearer Token"), "fixture-internal-token");
    await user.click(screen.getByRole("button", { name: "添加工具" }));
    expect(save).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("MCP URL"), "https://mcp.internal.example/mcp");
    await user.click(screen.getByRole("button", { name: "添加工具" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            url: "https://mcp.internal.example/mcp",
            auth: "bearer",
          }),
          bearerToken: "fixture-internal-token",
        }),
      ),
    );
  });

  it("submits manual parameters and environment variables with an optional working directory", async () => {
    const { save, user } = setup();
    await user.type(screen.getByLabelText("MCP 名称"), "Local server");
    await user.type(screen.getByLabelText("MCP 命令"), "node");
    fireEvent.change(screen.getByLabelText("MCP 参数"), {
      target: { value: "server.js\n/a path/with spaces" },
    });
    fireEvent.change(screen.getByLabelText("MCP 环境变量"), {
      target: { value: "API_KEY=fixture==" },
    });
    await user.click(screen.getByRole("button", { name: "添加工具" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ args: ["server.js", "/a path/with spaces"], cwd: "" }),
          env: { API_KEY: "fixture==" },
        }),
      ),
    );
  });

  it("preserves the server ID, disabled state and tool restrictions while editing", async () => {
    const server: McpServerConfig = {
      id: "66666666-6666-4666-8666-666666666699",
      name: "Old",
      transport: "stdio",
      command: "node",
      args: ["a b"],
      cwd: "",
      enabled: false,
      enabledTools: ["echo"],
      envCredentialRef: "mcp:old",
      envKeys: ["KEY"],
    };
    const { save, user } = setup(server, [server.name]);
    await user.clear(screen.getByLabelText("MCP 名称"));
    await user.type(screen.getByLabelText("MCP 名称"), "New");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        config: {
          id: server.id,
          name: "New",
          transport: "stdio",
          command: "node",
          args: ["a b"],
          cwd: "",
          enabled: false,
          enabledTools: ["echo"],
        },
      }),
    );
  });

  it("validates every import entry and duplicate name before saving", async () => {
    const { save, user } = setup(undefined, ["existing"]);
    await user.click(screen.getByRole("tab", { name: "JSON 导入" }));
    fireEvent.change(screen.getByLabelText("MCP JSON 配置"), {
      target: {
        value: '{"mcpServers":{"ok":{"command":"node"},"bad":{"command":"node","args":"wrong"}}}',
      },
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "导入 0 个服务" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("MCP JSON 配置"), {
      target: { value: '{"mcpServers":{"existing":{"command":"node"}}}' },
    });
    await user.click(screen.getByRole("button", { name: "导入 1 个服务" }));
    expect(await screen.findByText(/已存在/u)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("retries only unfinished services after a partial import failure", async () => {
    const { save, onSaved, user } = setup();
    let fail = true;
    save.mockImplementation(async (input) => {
      if (input.config.name === "second" && fail) {
        fail = false;
        throw new Error("fixture save failure");
      }
      return input.config;
    });
    await user.click(screen.getByRole("tab", { name: "JSON 导入" }));
    fireEvent.change(screen.getByLabelText("MCP JSON 配置"), {
      target: { value: '{"mcpServers":{"first":{"command":"node"},"second":{"command":"node"}}}' },
    });
    await user.click(screen.getByRole("button", { name: "导入 2 个服务" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("已导入 1 个服务"),
    );
    await user.click(screen.getByRole("button", { name: "导入 1 个服务" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.any(Array), true));
    expect(save.mock.calls.map(([input]) => input.config.name)).toEqual([
      "first",
      "second",
      "second",
    ]);
    expect(save.mock.calls[1]?.[0].config.id).toBe(save.mock.calls[2]?.[0].config.id);
  });
});
