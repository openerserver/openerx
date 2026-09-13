import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-approval-visible-"));
const evidenceDirectory =
  process.env.OPENERX_APPROVAL_EVIDENCE_DIR || path.join(profileDirectory, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const uploadPath = path.join(profileDirectory, "approval-fixture.txt");
writeFileSync(uploadPath, "local approval test", "utf8");
const server = createServer((request, response) => {
  if (request.url === "/download") {
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": 'attachment; filename="result.txt"',
    });
    response.end("local test result");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    '<!doctype html><html><body><input id="name"><input id="upload" type="file"><a id="download" href="/download" download>Download</a></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server unavailable");
const url = `http://127.0.0.1:${address.port}/`;
let application;
try {
  application = await electron.launch({
    args: [path.join(desktopDirectory, ".vite/build/main.js")],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
      OPENERX_BROWSER_COMPUTER_USE_V2: "0",
    },
  });
  const page = await application.firstWindow();
  const mainWindow = await application.browserWindow(page);
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (error) => console.error("APPROVAL_PAGE_ERROR", error));
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
  await page.getByLabel("发送消息").waitFor();
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, uploadPath);
  const [file] = await page.evaluate(() => window.openerx.chooseFiles({}));
  assert.ok(file);
  await page
    .getByLabel("发送消息")
    .fill(`验证审批可见性 [PI_TEST_BROWSER] ${url} FILE_ID=${file.id}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const panel = page.getByRole("region", { name: "待处理的工具授权" });
  try {
    await panel.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    console.error("APPROVAL_UI_STATE", await page.locator("body").innerText());
    throw error;
  }
  console.log("APPROVAL_VISIBLE_WITH_ACTIVITY_COLLAPSED");
  assert.equal(
    await page.locator(".assistant-activity-overview").first().getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(await panel.evaluate((element) => element.matches(":popover-open")), true);
  assert.equal(await panel.evaluate((element) => Boolean(element.closest("details"))), false);
  await page.getByLabel("发送消息").fill("保留未发送的草稿");
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), true);
  await page.getByRole("button", { name: "切换上下文" }).click();
  await page.getByRole("dialog", { name: "当前上下文" }).waitFor();

  async function assertActionsVisible(label) {
    await page.waitForFunction(() => {
      const panel = document.querySelector(".pending-tool-approval");
      const buttons = [...panel.querySelectorAll("button")];
      return buttons.every((button) => {
        const r = button.getBoundingClientRect();
        const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.x >= 0 &&
          r.y >= 0 &&
          r.right <= innerWidth &&
          r.bottom <= innerHeight &&
          target &&
          button.contains(target)
        );
      });
    });
    await page.screenshot({ path: path.join(evidenceDirectory, `${label}.png`) });
  }
  await assertActionsVisible("approval-with-context-open");
  await page
    .getByRole("dialog", { name: "当前上下文" })
    .getByRole("button", { name: "关闭上下文" })
    .click();
  // Long details must scroll without pushing action buttons out of the window.
  await panel.locator(".pending-approval-details > strong").evaluate((element) => {
    element.textContent = "长操作说明，用于验证审批内容滚动与按钮可见性。".repeat(120);
  });
  await mainWindow.evaluate((main) => {
    main.setMinimumSize(480, 400);
    main.setSize(540, 480);
  });
  await page.waitForFunction(() => innerWidth <= 540 && innerHeight <= 480);
  await assertActionsVisible("approval-small-window-long-details");
  await mainWindow.evaluate((main) => main.setSize(1200, 800));
  await page.waitForFunction(() => innerWidth >= 1100);
  await page.getByRole("region", { name: "对话消息" }).evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await assertActionsVisible("approval-while-reading-history");
  await panel.getByRole("button", { name: "完全访问", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  await page
    .locator(".message-assistant[data-message-status='completed']")
    .waitFor({ timeout: 30_000 });
  assert.equal(await page.getByLabel("发送消息").inputValue(), "保留未发送的草稿");
  assert.equal(await page.getByLabel("权限模式", { exact: true }).inputValue(), "full_access");
  const pending = await page.evaluate(() =>
    window.openerx.listPermissionRequests({ status: "pending" }),
  );
  assert.equal(pending.length, 0);
  console.log(
    `APPROVAL_VISIBILITY_OK collapsed context-overlay small-window long-details history-scroll full-access-resume evidence=${evidenceDirectory}`,
  );
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
