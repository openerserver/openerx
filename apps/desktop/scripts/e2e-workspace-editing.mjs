import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

// Attach to `npm run dev:desktop` with a fresh OPENERX_E2E_PROFILE_DIR.
// The deterministic provider exercises real Pi tool calls, IPC, storage, files and React.
const evidenceDirectory = path.resolve(
  process.argv[2] ?? "/tmp/openerx-workspace-editing-evidence",
);
const endpoint = process.env.OPENERX_E2E_CDP ?? "http://127.0.0.1:9238";
const inspector = process.env.OPENERX_E2E_INSPECTOR ?? "http://127.0.0.1:9229";
mkdirSync(evidenceDirectory, { recursive: true });
const workspace = mkdtempSync(path.join(tmpdir(), "openerx-editing-workspace-"));
const targets = await (await fetch(`${inspector}/json/list`)).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let requestId = 0;
async function main(expression) {
  const id = ++requestId;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("INSPECTOR_TIMEOUT")), 10_000);
    const receive = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", receive);
      if (message.error || message.result.exceptionDetails)
        reject(new Error(JSON.stringify(message)));
      else resolve(message.result.result.value);
    };
    socket.addEventListener("message", receive);
  });
  socket.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }),
  );
  return response;
}

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages()[0];
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
try {
  const isolated = await main(
    "process.env.OPENERX_E2E === '1' && Boolean(process.env.OPENERX_E2E_PROFILE_DIR) && process.env.OPENERX_E2E_USE_PLATFORM !== '1'",
  );
  assert.equal(isolated, true, "Use an isolated E2E development process");
  await main(`(() => {
    const { ipcMain, dialog } = process.mainModule.require('electron');
    globalThis.__editingDialogOriginal = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(workspace)}] });
    ipcMain.removeHandler('model:catalog:list');
    ipcMain.handle('model:catalog:list', () => [{ modelRef: 'platform/e2e-faux', displayName: 'E2E faux model', version: '1.0.0', capabilities: { textInput: true, imageInput: false, fileInput: false, functionCalling: true, structuredOutput: true }, contextWindow: 128000, maxOutputTokens: 8192, status: 'available', priceRef: 'e2e-faux', priceSummary: 'E2E only', free: true, thinkingLevels: ['off'] }]);
  })()`);
  await page.evaluate(() => {
    window.localStorage.setItem("openerx.defaultModelRef", "platform/e2e-faux");
    window.location.hash = "/";
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  async function send(text) {
    const previous = await page
      .locator(".message-assistant[data-message-status='completed']")
      .count();
    await page.getByLabel("发送消息", { exact: true }).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".message-assistant[data-message-status='completed']").length >
        count,
      previous,
      { timeout: 60_000 },
    );
  }
  await send("准备文件编辑验证。");
  const conversationId = await page.evaluate(
    () => window.location.hash.match(/chat\/([0-9a-f-]+)/u)?.[1],
  );
  assert.ok(conversationId);
  const grant = await page.evaluate(
    (conversationId) =>
      window.openerx.chooseWorkspace({
        conversationId,
        access: "read_write",
        allowNetwork: false,
        expiresAt: null,
      }),
    conversationId,
  );
  assert.ok(grant);
  await send("修改项目代码 [PI_TEST_WORKSPACE_PATCH]");
  await page.getByText(/EDIT_FIXTURE_OK/u).waitFor();
  const workItems = await page.evaluate(
    (conversationId) => window.openerx.listWorkItems({ conversationId }),
    conversationId,
  );
  const workItem = workItems.find(({ messageId }) => messageId !== null);
  assert.ok(workItem);
  const getDetail = () =>
    page.evaluate((workItemId) => window.openerx.getWorkItem({ workItemId }), workItem.id);
  const detail = await getDetail();
  assert.equal(detail.workspaceEdits.length, 3);
  assert.equal(
    detail.workspaceEdits.every(({ status }) => status === "applied"),
    true,
  );
  const target = path.join(workspace, "example.ts");
  assert.equal(readFileSync(target, "utf8"), "export const value = 3;\n");
  assert.equal(existsSync(path.join(workspace, "obsolete.txt")), false);
  assert.equal(existsSync(path.join(workspace, "old-name.txt")), false);
  assert.equal(readFileSync(path.join(workspace, "docs/renamed.txt"), "utf8"), "rename me\n");
  const edits = page.getByRole("region", { name: "文件修改", exact: true });
  await edits.waitFor();
  await edits.getByText("查看差异", { exact: true }).first().click();
  assert.match(await edits.locator("pre").first().innerText(), /-export const value = 2;/u);
  await page.screenshot({ path: path.join(evidenceDirectory, "01-edits.png") });

  // A later user edit blocks the entire undo and leaves every current file intact.
  writeFileSync(target, "user changed this\n");
  await edits.getByRole("button", { name: "撤销本轮修改" }).click();
  await edits.getByRole("button", { name: "确认撤销" }).click();
  await edits.getByRole("alert").filter({ hasText: "本次未覆盖文件" }).waitFor();
  assert.equal(readFileSync(target, "utf8"), "user changed this\n");
  assert.equal(existsSync(path.join(workspace, "docs/notes.md")), true);
  assert.equal(
    (await getDetail()).workspaceEdits.every(({ status }) => status === "applied"),
    true,
  );
  await page.screenshot({ path: path.join(evidenceDirectory, "02-conflict.png") });
  writeFileSync(target, "export const value = 3;\n");

  await edits.getByRole("button", { name: "撤销修改：example.ts", exact: true }).click();
  await edits.getByRole("button", { name: "确认撤销" }).click();
  await edits.getByRole("status").waitFor();
  assert.equal(readFileSync(target, "utf8"), "export const value = 2;\n");
  await page.evaluate(() => {
    globalThis.__editingServiceStates = [];
    window.openerx.onChatEvent((event) => {
      if (event.type === "service.status")
        globalThis.__editingServiceStates.push(event.payload.status);
    });
  });
  await main("globalThis.__openerxCrashAppServiceForTest()");
  await page.waitForFunction(
    () =>
      globalThis.__editingServiceStates.includes("restarting") &&
      globalThis.__editingServiceStates.includes("ready"),
    undefined,
    { timeout: 30_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await edits.getByText("已撤销", { exact: true }).waitFor();
  assert.equal(
    (await getDetail()).workspaceEdits.filter(({ status }) => status === "reverted").length,
    1,
  );
  await edits.getByRole("button", { name: "撤销本轮修改" }).click();
  await edits.getByRole("button", { name: "确认撤销" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".workspace-edit-reverted").length === 3,
  );
  for (const relativePath of [
    "example.ts",
    "obsolete.txt",
    "old-name.txt",
    "docs/notes.md",
    "docs/renamed.txt",
  ])
    assert.equal(existsSync(path.join(workspace, relativePath)), false);
  await page.screenshot({ path: path.join(evidenceDirectory, "03-undone.png") });
  assert.deepEqual(pageErrors, []);
  const report = {
    checkedAt: new Date().toISOString(),
    runtime: "npm run dev:desktop",
    provider: "deterministic Pi fixture",
    conversationId,
    workspace,
    changeGroups: 3,
    multiFileOperations: ["create", "update", "delete", "rename"],
    conflictPreserved: true,
    singleUndo: true,
    serviceRestartPersistence: true,
    fullRunUndo: true,
    pageErrors,
  };
  writeFileSync(
    path.join(evidenceDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(evidenceDirectory, "failure.png") });
  console.error((await page.locator("body").innerText()).slice(-8_000));
  throw error;
} finally {
  await main(
    "(() => { if (globalThis.__editingDialogOriginal) process.mainModule.require('electron').dialog.showOpenDialog = globalThis.__editingDialogOriginal; delete globalThis.__editingDialogOriginal; })()",
  );
  socket.close();
  await browser.close();
}
