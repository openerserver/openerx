import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { chromium } from "playwright";
import { z } from "zod";

// Attach to npm run dev:desktop with an isolated E2E profile; never replace a packaged app.
const endpoint = process.env.OPENERX_MCP_CDP_URL;
if (!endpoint || !["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname)) {
  throw new Error("Set OPENERX_MCP_CDP_URL to the local development Electron debugging endpoint.");
}
const root = path.resolve(import.meta.dirname, "../../..");
const output = path.join(root, "apps/desktop/.vite/mcp-evidence");
const fixturePath = path.join(root, "packages/tool-sdk/tests/fixtures/mcp-stdio-server.mjs");
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const page = browser
  .contexts()[0]
  .pages()
  .find((candidate) => candidate.url().includes("localhost:"));
if (!page) throw new Error("Development renderer not found");
page.setDefaultTimeout(20_000);
const prefix = `MCP 验证 ${Date.now()}`;
const edition = process.env.OPENERX_MCP_EDITION === "uwa" ? "uwa" : "openerx";
const localName = `${prefix} 本机`;
const editedName = `${prefix} 已编辑`;
const httpName = `${prefix} HTTP`;
const disabledName = `${prefix} 停用`;
const server = new McpServer({ name: "openerx-mcp-http-e2e", version: "1.0.0" });
server.registerTool(
  "remote_echo",
  { description: "HTTP headers verified", inputSchema: z.object({}) },
  async () => ({ content: [{ type: "text", text: "ready" }] }),
);
const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
await server.connect(transport);
const http = createServer((request, response) => {
  if (request.headers["x-fixture-key"] !== "fixture-header-secret") {
    response.writeHead(403).end();
    return;
  }
  void transport.handleRequest(request, response);
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const address = http.address();
assert.ok(address && typeof address !== "string");
const row = (name) =>
  page.locator(".tool-library-row").filter({ has: page.getByText(name, { exact: true }) });
const settings = async (name) => {
  await row(name).getByRole("button", { name: "设置", exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
};
const closeSettings = () => page.getByRole("button", { name: "关闭工具设置" }).click();

try {
  await page.goto(`${new URL(page.url()).origin}/#/settings/account?section=tools`);
  await page.getByRole("button", { name: "工具", exact: true }).click();
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "添加工具", exact: true });
  const countBeforePresets = (await page.evaluate(() => window.openerx.listMcpServers())).length;
  assert.equal(
    await editor.getByRole("button", { name: /^配置 /u }).count(),
    edition === "uwa" ? 3 : 2,
  );
  await editor.getByRole("button", { name: "配置 GitHub", exact: true }).click();
  assert.equal(
    await editor.getByLabel("MCP URL", { exact: true }).inputValue(),
    "https://api.githubcopilot.com/mcp/readonly",
  );
  assert.equal(await editor.getByLabel("MCP 认证", { exact: true }).inputValue(), "bearer");
  await editor.getByRole("button", { name: "添加工具", exact: true }).click();
  await editor.getByText("请填写此服务的 Bearer 令牌。", { exact: true }).waitFor();
  await editor.getByLabel("MCP Bearer Token", { exact: true }).fill("preset-only-fixture-token");
  await editor
    .getByLabel("MCP 请求头", { exact: true })
    .fill("X-Secret=preset-only-fixture-secret");
  await editor.getByRole("button", { name: "配置 Context7", exact: true }).click();
  assert.equal(
    await editor.getByLabel("MCP URL", { exact: true }).inputValue(),
    "https://mcp.context7.com/mcp",
  );
  assert.equal(await editor.getByLabel("MCP 认证", { exact: true }).inputValue(), "none");
  assert.equal(await editor.getByLabel("MCP 请求头", { exact: true }).inputValue(), "");
  await editor.getByLabel("MCP 认证", { exact: true }).selectOption("bearer");
  assert.equal(await editor.getByLabel("MCP Bearer Token", { exact: true }).inputValue(), "");
  await editor.getByRole("button", { name: "配置 Context7", exact: true }).click();
  await editor.screenshot({ path: path.join(output, "presets.png") });
  if (edition === "uwa") {
    await editor.getByRole("button", { name: "配置 企业内网服务", exact: true }).click();
    assert.equal(await editor.getByLabel("MCP URL", { exact: true }).inputValue(), "");
    assert.equal(await editor.getByLabel("MCP 认证", { exact: true }).inputValue(), "bearer");
    await editor
      .getByLabel("MCP URL", { exact: true })
      .fill(`http://127.0.0.1:${address.port}/mcp`);
    await editor.screenshot({ path: path.join(output, "intranet-preset.png") });
  }
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.openerx.listMcpServers())).length,
    countBeforePresets,
  );
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  editor = page.getByRole("dialog", { name: "添加工具", exact: true });
  await editor.getByLabel("MCP 名称", { exact: true }).fill(localName);
  await editor.getByLabel("MCP 命令", { exact: true }).fill(process.execPath);
  await editor
    .getByLabel("MCP 参数", { exact: true })
    .fill(JSON.stringify([fixturePath, "argument with spaces"]));
  await editor
    .getByLabel("MCP 环境变量", { exact: true })
    .fill("OPENERX_MCP_FIXTURE_EXTRA_TOOL=environment_ready");
  await editor.screenshot({ path: path.join(output, "manual.png") });
  await editor.getByRole("button", { name: "添加工具", exact: true }).click();
  let detail = page.getByRole("dialog", { name: localName, exact: true });
  await detail.getByRole("button", { name: "测试连接", exact: true }).click();
  await detail.getByText("连接成功，发现 3 个工具。", { exact: true }).waitFor();
  await detail
    .getByText("Environment and arguments received: argument with spaces", { exact: true })
    .waitFor();
  await detail.screenshot({ path: path.join(output, "stdio-connected.png") });
  const first = (await page.evaluate(() => window.openerx.listMcpServers())).find(
    ({ name }) => name === localName,
  );
  assert.ok(first?.envCredentialRef);
  assert.equal("env" in first, false);
  await detail.getByRole("button", { name: "编辑配置", exact: true }).click();
  editor = page.getByRole("dialog", { name: "编辑 MCP 服务", exact: true });
  assert.equal(
    await editor.getByLabel("MCP 参数", { exact: true }).inputValue(),
    JSON.stringify([fixturePath, "argument with spaces"]),
  );
  assert.equal(await editor.getByLabel("MCP 环境变量", { exact: true }).inputValue(), "");
  await editor.getByLabel("MCP 名称", { exact: true }).fill(editedName);
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByRole("dialog", { name: editedName, exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "工具", exact: true }).click();
  await row(editedName).waitFor();
  const edited = (await page.evaluate(() => window.openerx.listMcpServers())).find(
    ({ name }) => name === editedName,
  );
  assert.equal(edited.id, first.id);
  assert.equal(edited.envCredentialRef, first.envCredentialRef);
  await row(editedName).getByRole("checkbox").click();
  await row(editedName).getByText("已停用", { exact: true }).waitFor();
  detail = await settings(editedName);
  assert.equal(
    await detail.getByRole("button", { name: "测试连接", exact: true }).isDisabled(),
    true,
  );
  await closeSettings();
  await row(editedName).getByRole("checkbox").click();
  await row(editedName).locator("input:checked").waitFor();
  detail = await settings(editedName);
  await detail.getByRole("button", { name: "测试连接", exact: true }).click();
  await detail.getByText("连接成功，发现 3 个工具。", { exact: true }).waitFor();
  await closeSettings();

  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  editor = page.getByRole("dialog", { name: "添加工具", exact: true });
  await editor.getByRole("tab", { name: "JSON 导入" }).click();
  await editor.getByLabel("MCP JSON 配置", { exact: true }).fill(
    JSON.stringify(
      {
        mcpServers: {
          [httpName]: {
            type: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: { "X-Fixture-Key": "fixture-header-secret" },
          },
          [disabledName]: { command: process.execPath, args: [fixturePath], disabled: true },
        },
      },
      null,
      2,
    ),
  );
  await editor.getByLabel("待导入 MCP 服务").waitFor();
  await editor.screenshot({ path: path.join(output, "json-import.png") });
  await editor.getByRole("button", { name: "导入 2 个服务", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  detail = await settings(httpName);
  await detail.getByRole("button", { name: "测试连接", exact: true }).click();
  await detail.getByText("连接成功，发现 1 个工具。", { exact: true }).waitFor();
  await detail.getByText("remote_echo", { exact: true }).waitFor();
  await detail.screenshot({ path: path.join(output, "http-connected.png") });
  const stored = (await page.evaluate(() => window.openerx.listMcpServers())).filter(({ name }) =>
    name.startsWith(prefix),
  );
  assert.equal(stored.length, 3);
  assert.ok(stored.find(({ name }) => name === httpName)?.headersCredentialRef);
  assert.equal(JSON.stringify(stored).includes("fixture-header-secret"), false);
  assert.equal(stored.find(({ name }) => name === disabledName)?.enabled, false);
  const readiness = await page.evaluate(() => window.openerx.listToolRuntimeReadiness());
  assert.ok(
    readiness
      .find(({ capability }) => capability === "mcp")
      ?.availableToolNames.some((name) => name.includes("remote_echo")),
  );
  await closeSettings();

  // Exercise failures through the same save/test bridge and verify UI feedback.
  detail = await settings(editedName);
  await detail.getByRole("button", { name: "编辑配置", exact: true }).click();
  editor = page.getByRole("dialog", { name: "编辑 MCP 服务", exact: true });
  await editor.getByLabel("MCP 命令", { exact: true }).fill("/nonexistent/openerx-mcp-fixture");
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  detail = page.getByRole("dialog", { name: editedName, exact: true });
  await detail.getByRole("button", { name: "测试连接", exact: true }).click();
  await detail.getByText(/找不到启动命令或工作目录/u).waitFor();
  await detail.screenshot({ path: path.join(output, "connection-error.png") });
  await detail.getByRole("button", { name: "编辑配置", exact: true }).click();
  editor = page.getByRole("dialog", { name: "编辑 MCP 服务", exact: true });
  await editor.getByLabel("MCP 命令", { exact: true }).fill(process.execPath);
  await editor
    .getByLabel("MCP 参数", { exact: true })
    .fill(JSON.stringify(["-e", "setInterval(() => {}, 1000)"]));
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  detail = page.getByRole("dialog", { name: editedName, exact: true });
  await detail.getByRole("button", { name: "测试连接", exact: true }).click();
  await detail.getByText(/连接超时，请检查服务是否已启动/u).waitFor();
  await detail.screenshot({ path: path.join(output, "connection-timeout.png") });
  await detail.getByRole("button", { name: "移除工具", exact: true }).click();
  await row(editedName).waitFor({ state: "hidden" });
  const result = {
    status: "passed",
    edition,
    checkedAt: new Date().toISOString(),
    transport: ["stdio", "streamable_http"],
    checks: [
      "Context7 and GitHub presets, read-only endpoint, required token and credential reset",
      "preset selection and cancel do not persist a service",
      ...(edition === "uwa"
        ? ["UWA intranet template injected by enterprise extension"]
        : ["only common presets in openerx"]),
      "manual arguments and encrypted environment reach process",
      "edit retains ID and credentials",
      "reload persists config",
      "enable and disable",
      "JSON batch import",
      "encrypted HTTP headers reach server",
      "tools exposed to runtime",
      "actionable connection failure",
      "stalled handshake returns timeout diagnostics through IPC",
      "remove",
    ],
    screenshots: [
      "presets.png",
      ...(edition === "uwa" ? ["intranet-preset.png"] : []),
      "manual.png",
      "stdio-connected.png",
      "json-import.png",
      "http-connected.png",
      "connection-error.png",
      "connection-timeout.png",
    ],
  };
  await writeFile(path.join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log("E2E_MCP_OK", JSON.stringify(result));
} finally {
  const remaining = await page.evaluate(() => window.openerx.listMcpServers()).catch(() => []);
  for (const config of remaining.filter(({ name }) => name.startsWith(prefix))) {
    await page.evaluate((serverId) => window.openerx.removeMcpServer({ serverId }), config.id);
  }
  await page.reload();
  await transport.close();
  http.closeAllConnections();
  await new Promise((resolve) => http.close(resolve));
  await browser.close();
}
