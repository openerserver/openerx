import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-project-e2e-"));
const primaryDirectory = path.join(profileDirectory, "project-primary");
const referenceDirectory = path.join(profileDirectory, "project-reference");
mkdirSync(primaryDirectory);
mkdirSync(referenceDirectory);

async function waitForAppServiceRestart() {
  const diagnosticsPath = path.join(profileDirectory, "logs", "diagnostics.jsonl");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const events = existsSync(diagnosticsPath)
      ? readFileSync(diagnosticsPath, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const restartingIndex = events.findLastIndex(({ code }) => code === "service.restarting");
    if (
      restartingIndex >= 0 &&
      events.slice(restartingIndex + 1).some(({ code }) => code === "service.ready")
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("App Service did not record a completed restart");
}

async function launch() {
  const application = await electron.launch({
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_APPLICATION_NAME: "OpenERX CX110 D3 PRJ11",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (error) => console.error("E2E_PROJECT_PAGE_ERROR", error));
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
  return { application, page };
}

let running;
try {
  running = await launch();
  let { application, page } = running;

  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill("PRJ E2E 交付");
  await page.getByLabel("项目说明（可选）").fill("回答前先核对项目资料，并保留恢复证据。");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("heading", { name: "PRJ E2E 交付" }).waitFor();
  assert.match(page.url(), /#\/projects\/[0-9a-f-]+$/u);
  const projectUrl = page.url();
  const projectToggle = page.getByRole("button", { name: "PRJ E2E 交付", exact: true });
  const sidebarConversations = page.getByRole("region", { name: "PRJ E2E 交付 的对话" });
  await sidebarConversations.getByText("暂无对话", { exact: true }).waitFor();
  await projectToggle.click();
  assert.equal(await projectToggle.getAttribute("aria-expanded"), "false");
  assert.equal(page.url(), projectUrl);
  await projectToggle.press("Enter");
  await sidebarConversations.waitFor();

  await application.evaluate(
    ({ dialog }, selectedDirectories) => {
      let next = 0;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedDirectories[next++]],
      });
    },
    [primaryDirectory, referenceDirectory],
  );
  await page.getByRole("button", { name: "项目设置" }).click();
  await page.getByRole("button", { name: "添加目录" }).click();
  await page.getByText("主目录已连接。", { exact: true }).waitFor();
  await page.getByLabel("新目录访问权限").selectOption("read_only");
  await page.getByRole("button", { name: "添加目录" }).click();
  await page.getByText("附加目录已连接。", { exact: true }).waitFor();

  const referenceRow = page
    .locator(".project-directory-list article")
    .filter({ hasText: "project-reference" });
  await referenceRow.getByRole("button", { name: "设为主目录" }).click();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll(".project-directory-list article")].find((element) =>
      element.textContent?.includes("project-reference"),
    );
    return row?.textContent?.includes("主目录");
  });
  await page.getByRole("button", { name: "关闭项目设置" }).click();

  await page.getByRole("link", { name: "在此项目中开始对话" }).click();
  await page.getByRole("heading", { name: "在这个项目中做什么？" }).waitFor();
  await page.getByLabel("发送消息").fill("法国的首都是哪里？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  await page.getByLabel("对话消息").getByText("巴黎。", { exact: true }).waitFor();
  await page.getByRole("link", { name: "PRJ E2E 交付", exact: true }).waitFor();
  const projectConversation = sidebarConversations.getByRole("link").first();
  await projectConversation.waitFor();
  assert.equal(await projectConversation.getAttribute("aria-current"), "page");
  const history = page.getByRole("region", { name: "对话历史" });
  assert.equal(await history.getByRole("link").count(), 0);
  const conversationUrl = page.url();
  await projectToggle.click();
  assert.equal(page.url(), conversationUrl);
  assert.equal(await history.getByRole("link").count(), 0);
  await projectToggle.click();
  await page.getByRole("link", { name: "在 PRJ E2E 交付 中新建对话" }).click();
  await page.getByRole("heading", { name: "在这个项目中做什么？" }).waitFor();
  await projectConversation.click();
  await page.getByLabel("对话消息").getByText("巴黎。", { exact: true }).waitFor();
  assert.equal(page.url(), conversationUrl);

  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "更改或移出项目…" }).click();
  await page.getByLabel("目标项目").selectOption("");
  await page.getByRole("button", { name: "确认更改" }).click();
  const unassignedConversation = history.getByRole("link", { name: /法国的首都是哪里/u });
  await unassignedConversation.waitFor();
  assert.equal(await sidebarConversations.getByRole("link").count(), 0);
  assert.equal(await unassignedConversation.getAttribute("aria-current"), "page");
  assert.equal(await unassignedConversation.locator("time").count(), 1);
  assert.equal(await unassignedConversation.getAttribute("title"), "法国的首都是哪里？");
  assert.equal((await unassignedConversation.innerText()).includes("巴黎。"), false);
  assert.ok((await unassignedConversation.boundingBox()).height <= 36);
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "移动到项目…" }).click();
  await page.getByLabel("目标项目").selectOption({ label: "PRJ E2E 交付" });
  await page.getByRole("button", { name: "确认更改" }).click();
  await projectConversation.waitFor();
  await unassignedConversation.waitFor({ state: "hidden" });
  assert.equal(await projectConversation.getAttribute("aria-current"), "page");
  if (process.env.OPENERX_E2E_SCREENSHOTS_DIR) {
    mkdirSync(process.env.OPENERX_E2E_SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.OPENERX_E2E_SCREENSHOTS_DIR, "project-sidebar-e2e.png"),
    });
  }

  await page.getByLabel("发送消息").fill("崩溃恢复 2000 字 [PI_TEST_SLOW]");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant").last().locator(".status-streaming").waitFor();
  await application.evaluate(() => {
    const crash = globalThis.__openerxCrashAppServiceForTest;
    if (typeof crash !== "function") throw new Error("Crash injection hook missing");
    crash();
  });
  await waitForAppServiceRestart();
  await page.waitForFunction(async () => {
    try {
      await window.openerx.listProjects({ includeArchived: true });
      return true;
    } catch {
      return false;
    }
  });
  await page.reload();
  await page.locator(".message-assistant[data-message-status='failed']").last().waitFor({
    timeout: 60_000,
  });
  await page.getByRole("link", { name: "PRJ E2E 交付", exact: true }).click();
  await page.getByText("回答前先核对项目资料，并保留恢复证据。", { exact: true }).waitFor();
  await page.getByText("2", { exact: true }).first().waitFor();

  await application.close();
  await new Promise((resolve) => setTimeout(resolve, 750));
  running = await launch();
  ({ application, page } = running);
  await page.getByRole("link", { name: "打开 PRJ E2E 交付 项目概览" }).click();
  await page.getByRole("button", { name: "项目设置" }).click();
  const rows = page.locator(".project-directory-list article");
  assert.equal(await rows.count(), 2);
  assert.match(
    await rows.filter({ hasText: "project-reference" }).innerText(),
    /主目录.*只读.*已连接/su,
  );
  assert.match(
    await rows.filter({ hasText: "project-primary" }).innerText(),
    /附加目录.*可读写.*已连接/su,
  );
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  await page.getByText("项目已归档；本机文件没有被删除。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "恢复项目" }).click();
  await page.getByText("项目已恢复。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭项目设置" }).click();

  await page.getByRole("link", { name: "在 PRJ E2E 交付 中新建对话" }).click();
  await page.getByLabel("发送消息").fill("用于删除验收的临时对话");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  await page.getByRole("link", { name: "打开 PRJ E2E 交付 项目概览" }).click();
  const projectList = page.getByRole("region", { name: "项目对话" });
  const deleteTemporary = projectList.getByRole("button", {
    name: "删除对话：用于删除验收的临时对话",
  });
  await deleteTemporary.click();
  const deleteDialog = page.getByRole("alertdialog", { name: "删除这个对话？" });
  await deleteDialog.getByText("“用于删除验收的临时对话”", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await deleteDialog.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "删除对话：用于删除验收的临时对话",
  );
  assert.equal(
    await page.evaluate(async () => (await window.openerx.listConversations()).length),
    2,
  );
  await deleteTemporary.click();
  if (process.env.OPENERX_E2E_SCREENSHOTS_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.OPENERX_E2E_SCREENSHOTS_DIR,
        "conversation-delete-dialog-e2e.png",
      ),
    });
  }
  await deleteDialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await deleteDialog.waitFor({ state: "hidden" });
  assert.equal(page.url(), projectUrl);
  assert.equal(await page.getByRole("link", { name: /用于删除验收的临时对话/u }).count(), 0);

  const projectThreads = page.getByRole("region", { name: "PRJ E2E 交付 的对话" });
  await projectThreads.getByRole("link").first().click();
  const deleteCurrent = projectThreads.getByRole("button", {
    name: "删除对话：法国的首都是哪里？",
  });
  await deleteCurrent.hover();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
    true,
    "Conversation list controls must not add an outer page scrollbar",
  );
  if (process.env.OPENERX_E2E_SCREENSHOTS_DIR) {
    await page.screenshot({
      path: path.join(process.env.OPENERX_E2E_SCREENSHOTS_DIR, "conversation-list-delete-e2e.png"),
    });
  }
  await deleteCurrent.click();
  await deleteDialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await deleteDialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "还没有项目对话" }).waitFor();
  assert.equal(page.url(), projectUrl);
  assert.equal(await projectThreads.getByRole("link").count(), 0);
  assert.equal(
    await page.evaluate(
      async () => (await window.openerx.listConversations({ includeArchived: true })).length,
    ),
    0,
  );

  console.log(
    "E2E_PROJECTS_OK sidebar-expand-collapse-keyboard-chat-selection-new-chat exclusive-project-history-groups-move-in-out-compact-rows create-two-directories-primary-switch-project-chat-app-service-crash-full-restart-archive-restore list-delete-cancel-focus-overview-current-project-empty",
  );
  await application.close();
  running = undefined;
} finally {
  if (running) await running.application.close().catch(() => undefined);
  rmSync(profileDirectory, { recursive: true, force: true });
}
