import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// Attach to a fresh deterministic E2E profile started with npm run dev:desktop.
const evidenceDirectory = path.resolve(
  process.argv[2] ?? "/tmp/openerx-desktop-reliability-evidence",
);
const endpoint = process.env.OPENERX_E2E_CDP ?? "http://127.0.0.1:9238";
const inspector = process.env.OPENERX_E2E_INSPECTOR ?? "http://127.0.0.1:9229";
mkdirSync(evidenceDirectory, { recursive: true });
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
  assert.equal(
    await main(
      "process.env.OPENERX_E2E === '1' && Boolean(process.env.OPENERX_E2E_PROFILE_DIR) && process.env.OPENERX_E2E_USE_PLATFORM !== '1'",
    ),
    true,
    "Use an isolated deterministic E2E development process",
  );
  await main(`(() => {
    const { ipcMain } = process.mainModule.require('electron');
    ipcMain.removeHandler('model:catalog:list');
    ipcMain.handle('model:catalog:list', () => [{ modelRef: 'platform/e2e-faux', displayName: 'E2E faux model', version: '1.0.0', capabilities: { textInput: true, imageInput: false, fileInput: false, functionCalling: true, structuredOutput: true }, contextWindow: 128000, maxOutputTokens: 8192, status: 'available', priceRef: 'e2e-faux', priceSummary: 'E2E only', free: true, thinkingLevels: ['off'] }]);
  })()`);
  await page.evaluate(() => {
    localStorage.setItem("openerx.defaultModelRef", "platform/e2e-faux");
    location.hash = "/chat/new";
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const composer = page.getByLabel("发送消息", { exact: true });
  await composer.fill("队列第一条 [PI_TEST_SLOW] 崩溃恢复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='streaming']").waitFor();
  for (const text of ["队列第二条", "队列第三条"]) {
    await composer.fill(text);
    await page.getByRole("button", { name: "加入队列", exact: true }).click();
    await page.locator(".message-user").filter({ hasText: text }).waitFor();
  }
  const conversationId = await page.evaluate(() => location.hash.match(/chat\/([0-9a-f-]+)/u)?.[1]);
  assert.ok(conversationId);
  const snapshot = await page.evaluate(
    (conversationId) => window.openerx.getConversation({ conversationId }),
    conversationId,
  );
  assert.deepEqual(
    snapshot.messages.filter(({ role }) => role === "assistant").map(({ status }) => status),
    ["streaming", "pending", "pending"],
  );
  await page.screenshot({ path: path.join(evidenceDirectory, "01-queued.png") });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".message-assistant[data-message-status='completed']").length === 3,
    undefined,
    { timeout: 60_000 },
  );
  const completed = await page.evaluate(
    (conversationId) => window.openerx.getConversation({ conversationId }),
    conversationId,
  );
  const replies = completed.messages.filter(({ role }) => role === "assistant");
  const replyTexts = replies.map(({ parts }) => parts.map(({ text }) => text).join(""));
  assert.match(replyTexts[1], /第 2 轮回答。当前 Pi 上下文共有 3 条消息/u);
  assert.match(replyTexts[2], /第 3 轮回答。当前 Pi 上下文共有 5 条消息/u);
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(evidenceDirectory, "02-completed.png") });
  const thirdUser = page.locator(".message-user").filter({ hasText: "队列第三条" });
  await thirdUser.getByRole("button", { name: "编辑消息", exact: true }).click();
  const editor = thirdUser.getByRole("textbox", { name: "编辑消息内容", exact: true });
  assert.equal(await editor.inputValue(), "队列第三条");
  const resend = thirdUser.getByRole("button", { name: "发送", exact: true });
  assert.equal(await resend.isEnabled(), true);
  await resend.click();
  await page.waitForFunction(
    async ({ conversationId, previousBranch }) => {
      const value = await window.openerx.getConversation({ conversationId });
      return (
        value.conversation.activeBranchId !== previousBranch &&
        value.messages.at(-1)?.status === "completed"
      );
    },
    { conversationId, previousBranch: completed.conversation.activeBranchId },
  );
  const resent = await page.evaluate(
    (conversationId) => window.openerx.getConversation({ conversationId }),
    conversationId,
  );
  assert.equal(resent.messages.at(-2).parts[0].text, "队列第三条");
  assert.notEqual(resent.messages.at(-1).id, replies[2].id);
  const more = page.getByRole("button", { name: "更多操作", exact: true });
  const menu = page.getByRole("menu", { name: "对话操作", exact: true });
  await more.click();
  await menu.waitFor();
  await composer.click();
  await menu.waitFor({ state: "hidden" });
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  await more.click();
  await menu.waitFor();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(evidenceDirectory, "03-resent.png") });
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  const memorySearch = page.getByLabel("搜索记忆", { exact: true });
  await memorySearch.fill("类");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await memorySearch.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.type("型检查");
  assert.equal(await memorySearch.inputValue(), "类型检查");
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(evidenceDirectory, "04-settings-focus.png") });
  const report = {
    checkedAt: new Date().toISOString(),
    runtime: "npm run dev:desktop",
    provider: "deterministic Pi fixture",
    conversationId,
    queuedStatuses: snapshot.messages
      .filter(({ role }) => role === "assistant")
      .map(({ status }) => status),
    finalStatuses: replies.map(({ status }) => status),
    secondReply: replyTexts[1],
    thirdReply: replyTexts[2],
    originalTextResent: true,
    resendCreatedBranch: resent.conversation.activeBranchId,
    outsideClickDismissedMenu: true,
    escapeDismissedMenu: true,
    settingsSearchKeptFocus: true,
    pageErrors,
  };
  writeFileSync(
    path.join(evidenceDirectory, "result.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket.close();
  await browser.close();
}
