import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
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
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, uploadPath);
  const imported = await page.evaluate(async () => await window.openerx.chooseFiles({}));
  assert.equal(imported.length, 1);
  const uploadFileId = imported[0]?.id;
  assert.ok(uploadFileId);
  await page
    .getByLabel("发送消息")
    .fill(`打开隔离网页 [PI_TEST_BROWSER] ${fixtureUrl} FILE_ID=${uploadFileId}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  const firstPermission = page
    .getByText("隔离浏览器操作：open", { exact: true })
    .locator("..")
    .getByRole("button", { name: "仅本次允许" });
  await firstPermission.waitFor();
  const isolatedWindowPromise = application.waitForEvent("window");
  await firstPermission.click();
  const isolatedWindow = await isolatedWindowPromise;
  const isolatedWindowClosed = isolatedWindow.waitForEvent("close");
  await isolatedWindow.waitForLoadState("domcontentloaded");
  assert.equal(new URL(isolatedWindow.url()).origin, new URL(fixtureUrl).origin);
  assert.equal(application.windows().length, 2);

  await page
    .getByText("隔离浏览器操作：type", { exact: true })
    .locator("..")
    .getByRole("button", { name: "仅本次允许" })
    .click();
  await page
    .getByText("隔离浏览器操作：screenshot", { exact: true })
    .locator("..")
    .getByRole("button", { name: "仅本次允许" })
    .click();
  await page
    .getByText("隔离浏览器操作：upload", { exact: true })
    .locator("..")
    .getByRole("button", { name: "仅本次允许" })
    .click();
  await page
    .getByText("隔离浏览器操作：download", { exact: true })
    .locator("..")
    .getByRole("button", { name: "仅本次允许" })
    .click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  await page
    .getByLabel("对话消息")
    .getByText(/独立分区 openerx-isolated-browser-/)
    .waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".tool-call-row").length === 6);
  await page.waitForFunction(
    () => document.querySelectorAll(".tool-call-row > span:last-of-type").length >= 6,
  );
  await isolatedWindowClosed;
  assert.equal(application.windows().length, 1);

  await page.getByRole("link", { name: "任务与工具" }).click();
  await page.getByRole("heading", { name: "任务与工具" }).waitFor();
  await page.getByText("已完成").first().waitFor();
  console.log(
    "E2E_TOOLS_OK permission-isolated-browser-type-screenshot-upload-download-close-projection",
  );
} finally {
  await application?.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true });
}
