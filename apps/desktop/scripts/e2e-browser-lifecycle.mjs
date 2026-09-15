import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

// Use bundles produced by npm run dev:desktop. All model and page traffic is local.
const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-browser-lifecycle-"));
let scenario = "completed";
let pageUrl;
const server = createServer(async (request, response) => {
  if (request.method !== "POST") {
    if (request.url === "/pending") return;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body><h1>Browser lifecycle fixture</h1></body></html>");
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const opened = body.messages.some((message) => message.role === "tool");
  if (opened && scenario === "failed") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { code: "invalid_api_key", message: "Synthetic fixture failure" } }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const waiting = opened && ["cancelled", "host-disconnected"].includes(scenario);
  const delta = opened
    ? { content: waiting ? "BROWSER_AUTO_CLOSE_WAIT" : "BROWSER_AUTO_CLOSE_OK" }
    : {
        tool_calls: [
          {
            index: 0,
            id: randomUUID(),
            type: "function",
            function: {
              name: "openerx_browser",
              arguments: JSON.stringify({
                action: "open",
                requestedBackend: "managed_chromium",
                url: scenario === "loading-cancelled" ? `${pageUrl}pending` : pageUrl,
              }),
            },
          },
        ],
      };
  response.write(
    `data: ${JSON.stringify({ id: "browser-fixture-response", model: "browser-fixture", choices: [{ index: 0, delta, finish_reason: waiting ? null : opened ? "stop" : "tool_calls" }] })}\n\n`,
  );
  if (!waiting) response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
pageUrl = `http://127.0.0.1:${address.port}/`;
let application;
let page;
let applicationLog = "";
async function waitForBrowserWindow(state) {
  const deadline = Date.now() + 20_000;
  while (true) {
    const windows = await application.evaluate(() => globalThis.__openerxBrowserLifecycleWindows);
    if (windows.length && (state === "created" || windows.every((window) => window.closed)))
      return windows;
    assert.ok(Date.now() < deadline, `${scenario}: browser window never ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
try {
  application = await electron.launch({
    args: [path.join(desktopDirectory, ".vite/build/main.js")],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_USE_PLATFORM: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
      OPENERX_PLATFORM_URL: "",
      OPENERX_DEV_AUTO_SIGN_IN: "0",
    },
  });
  const appendLog = (data) => {
    applicationLog = `${applicationLog}${data}`.slice(-8_000);
  };
  application.process().stdout?.on("data", appendLog);
  application.process().stderr?.on("data", appendLog);
  page = await application.firstWindow();
  await application.evaluate(({ app }) => {
    globalThis.__openerxBrowserLifecycleWindows = [];
    app.on("browser-window-created", (_event, window) => {
      const record = { id: window.id, closed: false };
      globalThis.__openerxBrowserLifecycleWindows.push(record);
      window.once("closed", () => {
        record.closed = true;
      });
    });
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => Boolean(window.openerx));
  await page.evaluate(async (baseUrl) => {
    await window.openerx.updateModelServiceSettings({
      mode: "byok",
      apiKey: "synthetic-browser-lifecycle-key",
      byok: {
        baseUrl,
        modelId: "browser-fixture",
        displayName: "Browser fixture",
        contextWindow: 100_000,
        maxOutputTokens: 1024,
        capabilities: { imageInput: true, functionCalling: true, reasoning: false },
      },
    });
    await window.openerx.updateMemorySettings({
      memoriesEnabled: false,
      useMemories: false,
      generateMemories: false,
      syncMemories: false,
    });
  }, `${pageUrl}v1`);
  for (scenario of ["completed", "failed", "cancelled", "loading-cancelled", "host-disconnected"]) {
    await application.evaluate(() => {
      globalThis.__openerxBrowserLifecycleWindows = [];
    });
    const receipt = await page.evaluate(
      async (idempotencyKey) =>
        window.openerx.sendMessage({
          text: "浏览器窗口生命周期验证",
          modelRef: "platform/byok",
          thinkingLevel: "off",
          idempotencyKey,
        }),
      randomUUID(),
    );
    await page.evaluate((conversationId) => {
      window.location.hash = `/chat/${conversationId}`;
    }, receipt.conversationId);
    await page.getByRole("button", { name: "仅本次允许", exact: true }).last().click();
    await waitForBrowserWindow("created");
    if (["cancelled", "host-disconnected"].includes(scenario))
      await page.getByText("BROWSER_AUTO_CLOSE_WAIT", { exact: true }).waitFor();
    if (scenario === "host-disconnected") {
      await application.evaluate(() => globalThis.__openerxCrashAppServiceForTest());
    } else if (scenario.includes("cancelled")) {
      await page.evaluate(
        async ({ conversationId, assistantMessageId }) =>
          window.openerx.stopGeneration({ conversationId, assistantMessageId }),
        receipt,
      );
    }
    await waitForBrowserWindow("closed");
    assert.equal(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
      `${scenario}: browser window leaked`,
    );
    // A crashed host cannot serve conversation queries; its recovery has separate coverage.
    if (scenario === "host-disconnected") {
      console.log(`BROWSER_LIFECYCLE_OK ${scenario}: owned browser closed automatically`);
      continue;
    }
    await page.waitForFunction(async ({ conversationId, assistantMessageId }) => {
      const snapshot = await window.openerx.getConversation({ conversationId });
      return snapshot.messages.some(
        (message) =>
          message.id === assistantMessageId &&
          ["completed", "failed", "stopped", "interrupted"].includes(message.status),
      );
    }, receipt);
    const message = await page.evaluate(
      async ({ conversationId, assistantMessageId }) =>
        (await window.openerx.getConversation({ conversationId })).messages.find(
          (item) => item.id === assistantMessageId,
        ),
      receipt,
    );
    const expectedStatuses =
      scenario === "completed"
        ? ["completed"]
        : scenario.includes("cancelled")
          ? ["stopped", "interrupted"]
          : ["failed"];
    assert.ok(
      expectedStatuses.includes(message.status),
      `${scenario}: unexpected terminal status ${message.status}`,
    );
    if (scenario === "completed")
      assert.ok(JSON.stringify(message.parts).includes("BROWSER_AUTO_CLOSE_OK"));
    console.log(`BROWSER_LIFECYCLE_OK ${scenario}: owned browser closed automatically`);
  }
} catch (error) {
  console.error(
    "BROWSER_LIFECYCLE_FAILURE",
    await page
      ?.locator("body")
      .innerText()
      .catch(() => ""),
    applicationLog,
  );
  throw error;
} finally {
  await page?.evaluate(() => window.openerx.clearByokApiKey()).catch(() => undefined);
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
