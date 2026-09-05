import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-e2e-"));

async function launch() {
  const application = await electron.launch({
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
  page.on("pageerror", (error) => console.error("E2E_PAGE_ERROR", error));
  return { application, page };
}

let running;
try {
  running = await launch();
  let { application, page } = running;

  const rendererBoundary = await page.evaluate(() => ({
    hasProcess: typeof process !== "undefined",
    hasRequire: typeof require !== "undefined",
    bridgeFrozen: Object.isFrozen(window.openerx),
    bridgeKeys: Object.keys(window.openerx),
  }));
  assert.equal(rendererBoundary.hasProcess, false);
  assert.equal(rendererBoundary.hasRequire, false);
  assert.equal(rendererBoundary.bridgeFrozen, true);
  assert.equal(rendererBoundary.bridgeKeys.includes("ipcRenderer"), false);

  await page.getByLabel("发送消息").fill("法国的首都是哪里？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  try {
    await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  } catch (error) {
    console.error("E2E_CHAT_FIRST_TURN_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  await page.getByLabel("对话消息").getByText("巴黎。", { exact: true }).waitFor();
  const conversationUrl = page.url();
  assert.match(conversationUrl, /#\/chat\/[0-9a-f-]+$/);

  await page.getByLabel("发送消息").fill("继续回答");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='completed']").nth(1).waitFor();
  await page
    .getByLabel("对话消息")
    .getByText(/第 2 轮回答/)
    .waitFor();

  await page.getByLabel("发送消息").fill("写 2000 字 [PI_TEST_SLOW]");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const runningMessage = page.locator(".message-assistant").last();
  await runningMessage.locator(".status-streaming").waitFor();
  await runningMessage.getByRole("button", { name: "停止" }).dispatchEvent("click");
  await page.locator(".message-assistant[data-message-status='interrupted']").last().waitFor();

  const interruptedMessage = page.locator(".message-assistant").last();
  await interruptedMessage.hover();
  await interruptedMessage.getByRole("button", { name: "重新生成" }).click();
  try {
    await page.locator(".message-assistant").last().locator(".status-completed").waitFor();
  } catch (error) {
    console.error("E2E_CHAT_REGENERATE_STATE\n", await page.locator("body").innerText());
    throw error;
  }
  await page.getByLabel("分支").waitFor();

  await page.getByLabel("发送消息").fill("崩溃恢复 2000 字 [PI_TEST_SLOW]");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant").last().locator(".status-streaming").waitFor();
  await application.evaluate(() => {
    const crash = globalThis.__openerxCrashAppServiceForTest;
    if (typeof crash !== "function") throw new Error("Crash injection hook missing");
    crash();
  });
  await page.locator(".sync-state.service-restarting").waitFor();
  await page.locator(".sync-state.service-ready").waitFor();
  await page.reload();
  try {
    const recoveredFailure = page
      .locator(".message-assistant[data-message-status='failed']")
      .last();
    await recoveredFailure.waitFor({ timeout: 60_000 });
    await recoveredFailure.getByText("本次生成没有完成，可以重试并保留当前内容。").waitFor();
  } catch (error) {
    console.error("E2E_CHAT_RECOVERY_STATE\n", await page.locator("body").innerText());
    throw error;
  }

  const firstUserMessage = page.locator(".message-user").first();
  await firstUserMessage.getByRole("button", { name: "编辑消息" }).click();
  await firstUserMessage.locator("textarea").fill("修改后的第一问");
  await firstUserMessage.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-user").first().getByText("修改后的第一问").waitFor();
  await page.locator(".message-assistant[data-message-status='completed']").last().waitFor();

  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByLabel("对话标题").fill("M1 端到端对话");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("heading", { name: "M1 端到端对话" }).waitFor();

  await application.close();
  await new Promise((resolve) => setTimeout(resolve, 750));
  running = await launch();
  ({ application, page } = running);
  await page.getByRole("link", { name: /M1 端到端对话/ }).click();
  await page.getByText("修改后的第一问", { exact: true }).waitFor();

  await page.getByRole("link", { name: "新对话", exact: true }).click();
  await page.waitForURL(/#\/chat\/new$/);
  await page.getByRole("heading", { name: "今天想完成什么？" }).waitFor();
  await page.getByLabel("发送消息").fill("生成一个代码块和表格");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  await page.locator(".markdown-body pre").waitFor();
  await page.locator(".markdown-body table").waitFor();

  await page.getByRole("link", { name: "搜索" }).click();
  await page.waitForURL(/#\/search$/);
  await page.getByLabel("搜索关键词").fill("法国");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page
    .locator(".search-results")
    .getByRole("link", { name: /M1 端到端对话/ })
    .waitFor();

  console.log("E2E_CHAT_OK new-stream-context-stop-crash-branch-restart-markdown-search");
  await application.close();
  running = undefined;
} finally {
  if (running) await running.application.close().catch(() => undefined);
  rmSync(profileDirectory, { recursive: true, force: true });
}
