import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-e2e-tools-"));
const uploadPath = path.join(profileDirectory, "upload-fixture.txt");
writeFileSync(uploadPath, "upload fixture", "utf8");
const server = createServer((request, response) => {
  if (request.url === "/download") {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="fixture-download.txt"',
    });
    response.end("download fixture");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(
    '<!doctype html><html><body><label>Name <input id="name"></label><input id="upload" type="file"><a id="download" href="/download" download>Download</a><p id="state">ready</p></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server failed");
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

let application;
try {
  application = await electron.launch({
    args: [desktopDirectory],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_BROWSER_COMPUTER_USE_V2: "0",
      OPENERX_LOCAL_WEB_SEARCH_V2: "1",
      OPENERX_E2E: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
    },
  });
  assert.equal(await application.evaluate(({ app }) => app.getAppPath()), desktopDirectory);
  let page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("model:catalog:list");
    ipcMain.handle("model:catalog:list", () => [
      {
        modelRef: "platform/e2e-faux",
        displayName: "E2E faux model",
        version: "1.0.0",
        capabilities: {
          textInput: true,
          imageInput: false,
          fileInput: false,
          functionCalling: true,
          structuredOutput: true,
        },
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        status: "available",
        priceRef: "e2e-faux",
        priceSummary: "E2E only",
        free: true,
        thinkingLevels: ["off", "medium", "high"],
      },
    ]);
  });
  await page.evaluate(() =>
    window.localStorage.setItem("openerx.defaultModelRef", "platform/e2e-faux"),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, uploadPath);
  const imported = await page.evaluate(async () => await window.openerx.chooseFiles({}));
  assert.equal(imported.length, 1);
  const uploadFileId = imported[0]?.id;
  assert.ok(uploadFileId);
  const isolatedWindowPromise = application.waitForEvent("window");
  let isolatedWindow;
  try {
    [isolatedWindow] = await Promise.all([
      isolatedWindowPromise,
      (async () => {
        await page
          .getByLabel("发送消息")
          .fill(`打开隔离网页 [PI_TEST_BROWSER] ${fixtureUrl} FILE_ID=${uploadFileId}`);
        await page.getByRole("button", { name: "发送", exact: true }).click();
      })(),
    ]);
  } catch (error) {
    console.error("E2E_TOOLS_BROWSER_OPEN_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  const isolatedWindowClosed = isolatedWindow.waitForEvent("close", { timeout: 90_000 });
  await isolatedWindow.waitForLoadState("domcontentloaded");
  assert.equal(new URL(isolatedWindow.url()).origin, new URL(fixtureUrl).origin);
  assert.equal(application.windows().length, 2);

  await page.getByLabel("待处理的工具授权").getByRole("button", { name: "仅本次允许" }).click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  await page
    .getByLabel("对话消息")
    .getByText(/独立分区 openerx-isolated-browser-/)
    .waitFor();
  const activityOverview = page.locator("button.assistant-activity-overview").last();
  if ((await activityOverview.getAttribute("aria-expanded")) !== "true") {
    await activityOverview.click();
  }
  try {
    await page.waitForFunction(() => document.querySelectorAll(".tool-call-row").length === 6);
  } catch (error) {
    console.error("E2E_TOOLS_BROWSER_RESULT_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  assert.equal(await page.getByLabel("工具权限确认").count(), 0);
  await isolatedWindowClosed;
  const remainingWindows = application.windows();
  assert.equal(remainingWindows.length, 1);
  const remainingWindow = remainingWindows[0];
  assert.ok(remainingWindow);
  page = remainingWindow;
  console.log(
    "E2E_BROWSER_APPROVALS_OK automatic=open-type-screenshot-download-close per_call=upload permission_cards=1",
  );

  const completedBeforeDesktop = await page
    .locator(".message-assistant[data-message-status='completed']")
    .count();
  const desktopWindowTitle = `openerx E2E ${path.basename(profileDirectory)}`;
  if (process.platform === "win32") {
    // Capture a stable, test-owned window: the chat's animated progress indicator
    // changes its accessibility revision while the native helper takes a screenshot.
    await application.evaluate(async ({ app, BrowserWindow }, title) => {
      app.setAccessibilitySupportEnabled(true);
      const fixture = new BrowserWindow({
        width: 640,
        height: 480,
        title,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await fixture.loadURL(
        `data:text/html,${encodeURIComponent(`<title>${title}</title><h1>Desktop capture fixture</h1><p>Stable test-owned window</p>`)}`,
      );
    }, desktopWindowTitle);
  }
  await page
    .getByLabel("发送消息")
    .fill(`捕获桌面测试窗口 [PI_TEST_DESKTOP] WINDOW_TITLE=${JSON.stringify(desktopWindowTitle)}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  try {
    if (process.platform === "win32") {
      for (const action of ["list_apps", "attach"]) {
        await page
          .getByLabel("待处理的工具授权")
          .filter({ hasText: `Windows 桌面：${action}` })
          .getByRole("button", { name: "仅本次允许" })
          .click();
      }
    } else {
      await page.getByLabel("待处理的工具授权").getByRole("button", { name: "仅本次允许" }).click();
    }
  } catch (error) {
    console.error("E2E_TOOLS_DESKTOP_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  await page.waitForFunction(
    (minimum) =>
      document.querySelectorAll(".message-assistant[data-message-status='completed']").length >=
      minimum,
    completedBeforeDesktop + 1,
  );
  const desktopAssistantText = await page
    .locator(".message-assistant[data-message-status='completed']")
    .last()
    .innerText();
  assert.match(desktopAssistantText, /桌面窗口捕获完成：已捕获目标应用窗口/u);

  await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("button", { name: "工具" }).click();
  await page.getByRole("heading", { name: "工具" }).waitFor();
  let localSearchRow = page.locator(".tool-library-row").filter({ hasText: "本地 Web Search" });
  await localSearchRow.getByRole("button", { name: "设置" }).click();
  let localSearchPanel = page.getByRole("dialog", { name: "本地 Web Search" });
  await localSearchPanel.getByLabel("Web Search Provider").selectOption("direct:bing-html");
  await localSearchPanel.getByLabel("Web Search 结果语言").selectOption("en-US");
  await localSearchPanel.getByLabel("Web Search SafeSearch").selectOption("strict");
  await localSearchPanel.getByRole("button", { name: "保存设置" }).click();
  await localSearchPanel.getByText("搜索设置已保存。", { exact: true }).waitFor();
  await page.reload();
  try {
    await page.getByRole("button", { name: "工具" }).click();
    await page.getByRole("heading", { name: "工具" }).waitFor();
  } catch (error) {
    console.error("E2E_TOOLS_SETTINGS_RELOAD_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  localSearchRow = page.locator(".tool-library-row").filter({ hasText: "本地 Web Search" });
  await localSearchRow.getByRole("button", { name: "设置" }).click();
  localSearchPanel = page.getByRole("dialog", { name: "本地 Web Search" });
  assert.equal(
    await localSearchPanel.getByLabel("Web Search Provider").inputValue(),
    "direct:bing-html",
  );
  assert.equal(await localSearchPanel.getByLabel("Web Search 结果语言").inputValue(), "en-US");
  assert.equal(await localSearchPanel.getByLabel("Web Search SafeSearch").inputValue(), "strict");
  await localSearchPanel.getByRole("button", { name: "重置搜索服务" }).click();
  await localSearchPanel.getByText("已清除缓存并重置搜索服务。", { exact: true }).waitFor();
  console.log(
    "E2E_LOCAL_WEB_SEARCH_SETTINGS_OK provider=direct:bing-html locale=en-US safe=strict persisted=pass reset=pass",
  );
  await localSearchPanel.getByRole("button", { name: "关闭工具设置" }).click();
  const browserRow = page.locator(".tool-library-row").filter({ hasText: "浏览器操作" });
  await browserRow.getByText("已启用", { exact: true }).waitFor();
  const shellRow = page.locator(".tool-library-row").filter({ hasText: "终端" });
  const desktopRow = page.locator(".tool-library-row").filter({ hasText: "桌面控制" });
  const shellStatus = await shellRow.locator(".tool-library-status").innerText();
  const desktopStatus = await desktopRow.locator(".tool-library-status").innerText();
  assert.ok(["已启用", "部分可用", "未配置", "不可用"].includes(shellStatus));
  assert.ok(["已启用", "部分可用", "未配置", "不可用"].includes(desktopStatus));
  console.log(
    "E2E_TOOLS_OK auto-isolated-browser-open-type-screenshot-download-close-upload-per-call-projection",
  );
  console.log(
    `E2E_DESKTOP_READINESS_OK browser=已启用 shell=${shellStatus} desktop=${desktopStatus} native_window_capture=pass`,
  );
} finally {
  await application?.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
