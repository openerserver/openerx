import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// Attach to an isolated Electron dev instance started with OPENERX_E2E=1.
// Build vite.pi-host-test.config.mts after Forge has initialized its .vite directory.
const endpoint = process.env.OPENERX_E2E_CDP_URL;
if (!endpoint) throw new Error("OPENERX_E2E_CDP_URL_REQUIRED");
const browser = await chromium.connectOverCDP(endpoint);
const page = browser
  .contexts()[0]
  ?.pages()
  .find((candidate) => candidate.url().includes("localhost"));
if (!page) throw new Error("DESKTOP_DEV_RENDERER_NOT_FOUND");
const baseUrl = page.url().split("#")[0];
const screenshotDirectory = process.env.OPENERX_E2E_SCREENSHOT_DIR;
if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true });
page.setDefaultTimeout(30_000);

async function sendNew(text) {
  // Inject a turn through the public IPC bridge so the fixture needs no API credentials.
  const receipt = await page.evaluate(async (text) => {
    const settings = await window.openerx.getModelServiceSettings();
    if (settings.mode !== "hosted") throw new Error("ISOLATED_FAUX_PROFILE_REQUIRED");
    return await window.openerx.sendMessage({
      text,
      modelRef: "platform/e2e-faux",
      idempotencyKey: `terminal-state:${crypto.randomUUID()}`,
    });
  }, text);
  await page.goto(`${baseUrl}#/chat/${receipt.conversationId}`);
  const card = page.locator(".message-assistant").last();
  await card.waitFor();
  return card;
}

async function verifyTerminal(card, status, screenshotName) {
  await page.locator(`.message-assistant[data-message-status="${status}"]`).last().waitFor();
  assert.equal(await card.getAttribute("aria-busy"), null);
  assert.equal(await card.getByRole("button", { name: "停止", exact: true }).count(), 0);
  const overview = card.locator(".assistant-activity-overview");
  await overview.waitFor();
  assert.doesNotMatch(await overview.innerText(), /进行中/);
  await overview.click();
  assert.equal(await card.locator(".thinking").count(), 0);
  assert.equal(await card.locator(".stream-tail").count(), 0);
  await card.hover();
  if (screenshotDirectory) {
    await page.screenshot({ path: path.join(screenshotDirectory, screenshotName) });
  }
}

try {
  for (const partial of [false, true]) {
    const card = await sendNew(
      partial ? "[PI_TEST_TIMEOUT] [PI_TEST_PARTIAL]" : "[PI_TEST_TIMEOUT]",
    );
    await verifyTerminal(card, "failed", partial ? "timeout-partial.png" : "timeout-empty.png");
    assert.equal(await card.getByRole("alert").innerText(), "模型请求超时，请稍后重试。");
    assert.equal(await card.getByRole("button", { name: "重试并新建分支" }).count(), 1);
    if (partial) assert.match(await card.innerText(), /超时前已生成的内容。/);
    console.log(
      partial ? "PASS timeout preserves partial content" : "PASS timeout before any text",
    );
  }

  const active = await sendNew("写 2000 字 [PI_TEST_SLOW]");
  await active.locator(".stream-tail").waitFor();
  assert.equal(await active.getAttribute("aria-busy"), "true");
  // Streaming moves the footer as text arrives; dispatch its normal click handler.
  await active.getByRole("button", { name: "停止", exact: true }).dispatchEvent("click");
  await verifyTerminal(active, "interrupted", "interrupted.png");
  console.log("PASS active generation can be stopped without stale running indicators");

  const completed = await sendNew("法国的首都是哪里？");
  await verifyTerminal(completed, "completed", "completed.png");
  assert.match(await completed.innerText(), /巴黎/);
  console.log("PASS subsequent generation completes normally");
} finally {
  // Disconnect CDP; keep the Forge dev instance available for further renderer work.
  await browser.close();
}
