import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

if (process.platform !== "darwin") throw new Error("BCU_TOOL_CENTER_MACOS_REQUIRED");

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-bcu-tool-center-"));
const outputDirectory = path.resolve(
  process.env.OPENERX_BCU_TOOL_CENTER_OUTPUT ??
    path.join(desktopDirectory, ".vite", "browser-tool-center", "evidence"),
);
const server = createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, max-age=0",
  });
  response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Tool Center live fixture</title></head>
<body><main><h1>System browser remains independent</h1></main></body>
</html>`);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolve();
  });
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("BCU_TOOL_CENTER_SERVER_FAILED");
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

async function allowPendingBrowserRequest(page, action) {
  const reason = page.getByText(`系统浏览器 computer-use 操作：${action}`, { exact: true });
  await reason.waitFor({ timeout: 90_000 });
  const permissionCard = reason.locator("..");
  await permissionCard.getByRole("button", { name: "仅本次允许" }).click();
}

async function browserSessions(page) {
  return await page.evaluate(async () => await window.openerx.listBrowserComputerUseSessions());
}

async function closeBrowserSessionThroughChat(page, sessionId) {
  await page.getByRole("link", { name: "新对话" }).click();
  await page.getByLabel("发送消息").waitFor();
  await page
    .getByLabel("发送消息")
    .fill(`关闭系统浏览器测试窗口 [PI_TEST_BROWSER_COMPUTER_USE_CLOSE] SESSION_ID=${sessionId}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await allowPendingBrowserRequest(page, "close");
  await page.getByText("系统浏览器会话已关闭。", { exact: true }).waitFor({ timeout: 90_000 });
  await page.waitForFunction(
    async () => (await window.openerx.listBrowserComputerUseSessions()).length === 0,
  );
}

let application;
let page;
let sessionId = null;
let closed = false;
let applicationLog = "";
try {
  application = await electron.launch({
    args: [desktopDirectory],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_BROWSER_COMPUTER_USE_V2: "1",
      OPENERX_E2E: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
    },
  });
  const applicationProcess = application.process();
  const appendApplicationLog = (data) => {
    applicationLog = `${applicationLog}${String(data)}`.slice(-20_000);
  };
  applicationProcess.stdout?.on("data", appendApplicationLog);
  applicationProcess.stderr?.on("data", appendApplicationLog);
  const nativeReadiness = await application.evaluate(({ systemPreferences }) => ({
    accessibilityTrusted: systemPreferences.isTrustedAccessibilityClient(false),
    screenCaptureStatus: systemPreferences.getMediaAccessStatus("screen"),
  }));
  console.log(`BCU_TOOL_CENTER_NATIVE_READINESS:${JSON.stringify(nativeReadiness)}`);
  page = await application.firstWindow();
  page.on("pageerror", (error) => console.error("BCU_TOOL_CENTER_PAGE_ERROR", error));
  await page.waitForLoadState("domcontentloaded");
  await page
    .getByLabel("发送消息")
    .fill(`打开系统浏览器测试窗口 [PI_TEST_BROWSER_COMPUTER_USE_OPEN] ${fixtureUrl}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await allowPendingBrowserRequest(page, "open");
  await page.locator(".message-assistant[data-message-status='completed']").last().waitFor({
    timeout: 90_000,
  });
  const openAssistantText = await page
    .locator(".message-assistant[data-message-status='completed']")
    .last()
    .innerText();
  assert.match(openAssistantText, /系统浏览器会话已打开。SESSION_ID=/u);

  await page.waitForFunction(
    async () => (await window.openerx.listBrowserComputerUseSessions()).length === 1,
  );
  const initialSessions = await browserSessions(page);
  const initial = initialSessions[0];
  assert.ok(initial);
  assert.equal(initial.contractVersion, "browser_computer_use_v2");
  assert.equal(initial.backend, "system_default");
  assert.equal(initial.controlPath, "os_accessibility");
  assert.equal(initial.state, "active");
  sessionId = initial.sessionId;

  await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("button", { name: "工具" }).click();
  await page.getByRole("heading", { name: "工具" }).waitFor();
  const browserRow = page.locator(".tool-library-row").filter({ hasText: "浏览器操作" });
  await browserRow.waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  const toolCenterText = await page.locator("section.tool-center-page").innerText();
  assert.doesNotMatch(toolCenterText, /Tool Center live fixture|127\.0\.0\.1|com\.google\.Chrome/u);
  assert.doesNotMatch(toolCenterText, /Google Chrome|机器默认浏览器|独立窗口 · 系统辅助功能/u);

  await page.evaluate(
    async (id) => await window.openerx.pauseBrowserComputerUseSession({ sessionId: id }),
    sessionId,
  );
  const paused = (await browserSessions(page)).find((session) => session.sessionId === sessionId);
  assert.equal(paused?.state, "paused_for_user");

  await page.evaluate(
    async (id) => await window.openerx.resumeBrowserComputerUseSession({ sessionId: id }),
    sessionId,
  );
  const resumed = (await browserSessions(page)).find((session) => session.sessionId === sessionId);
  assert.equal(resumed?.state, "active");

  await closeBrowserSessionThroughChat(page, sessionId);
  closed = true;

  const evidence = {
    contractVersion: initial.contractVersion,
    backend: initial.backend,
    controlPath: initial.controlPath,
    nativeWindowId: initial.nativeWindowId,
    rendererPageDataAbsent: true,
    rendererIframeCount: 0,
    trustedPauseState: paused?.state ?? null,
    trustedResumeState: resumed?.state ?? null,
    closeState: "closed",
  };
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    path.join(outputDirectory, "result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  console.log(`BCU_TOOL_CENTER_OK:${JSON.stringify(evidence)}`);
} catch (error) {
  if (applicationLog.trim()) {
    console.error(`BCU_TOOL_CENTER_APPLICATION_LOG\n${applicationLog.trim()}`);
  }
  throw error;
} finally {
  if (!closed && page) {
    const remaining = await browserSessions(page).catch(() => []);
    const cleanupSessionId = sessionId ?? remaining[0]?.sessionId ?? null;
    if (cleanupSessionId && remaining.some(({ sessionId: id }) => id === cleanupSessionId)) {
      await closeBrowserSessionThroughChat(page, cleanupSessionId).catch((error) => {
        console.error(`BCU_TOOL_CENTER_CLEANUP_FAILED:${cleanupSessionId}`, error);
      });
    }
  }
  await application?.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
