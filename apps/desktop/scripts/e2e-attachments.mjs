import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-attachments-e2e-"));
const xlsPath = path.join(profileDirectory, "销售报表.XLS");
const tsvPath = path.join(profileDirectory, "销售明细.tsv");
const sqlPath = path.join(profileDirectory, "查询.sql");
copyFileSync(
  path.resolve(desktopDirectory, "../../packages/file-service/tests/fixtures/legacy-sales.xls"),
  xlsPath,
);
writeFileSync(tsvPath, "商品\t金额\n女士衬衫\t58.50");
writeFileSync(sqlPath, "select * from sales;");

async function launch() {
  const application = await electron.launch({
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_APPLICATION_NAME: "openerx CX110 D3 XLS_ATTACHMENTS",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (error) => console.error("E2E_ATTACHMENT_PAGE_ERROR", error));
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
        thinkingLevels: ["off"],
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
  await application.evaluate(
    ({ dialog }, paths) => {
      let selection = 0;
      dialog.showOpenDialog = async (options) => {
        globalThis.__attachmentDialogOptions = options;
        selection += 1;
        return selection === 1
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: paths };
      };
    },
    [xlsPath, tsvPath, sqlPath],
  );
  const addAttachment = page.getByRole("button", { name: "添加附件", exact: true });
  assert.match(await addAttachment.getAttribute("title"), /XLS/);
  await addAttachment.click();
  await page.getByText("未新增附件。", { exact: true }).waitFor();
  assert.equal(await page.locator(".attachment-card-composer").count(), 0);
  await addAttachment.click();
  await page.getByText("已选择 3 个附件，将随本条消息发送。", { exact: true }).waitFor();
  assert.equal(await page.locator(".attachment-card-composer").count(), 3);
  await page
    .locator(".attachment-card-composer")
    .getByText("销售报表.XLS", { exact: true })
    .waitFor();
  const dialogOptions = await application.evaluate(() => globalThis.__attachmentDialogOptions);
  assert.ok(dialogOptions.properties.includes("multiSelections"));
  for (const extension of [
    "xls",
    "xlsx",
    "csv",
    "tsv",
    "docx",
    "pptx",
    "pdf",
    "png",
    "markdown",
    "sql",
    "xml",
    "java",
  ]) {
    assert.ok(
      dialogOptions.filters[0].extensions.includes(extension),
      `Picker is missing ${extension}`,
    );
  }
  const files = await page.evaluate(() => window.openerx.listFiles());
  assert.equal(files.length, 3);
  assert.ok(files.every(({ parseStatus }) => parseStatus === "ready"));
  const xls = files.find(({ format }) => format === "xls");
  assert.ok(xls);
  const preview = await page.evaluate(
    (personalFileId) => window.openerx.previewFile({ personalFileId }),
    xls.id,
  );
  assert.match(preview.parsedText, /D2: =B2\*C2 → 58.50/);
  assert.equal(preview.citations.length, 2);
  if (process.env.OPENERX_E2E_SCREENSHOTS_DIR) {
    mkdirSync(process.env.OPENERX_E2E_SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.OPENERX_E2E_SCREENSHOTS_DIR, "xls-attachments-composer.png"),
    });
  }
  await page.getByLabel("发送消息").fill("请读取销售表 [PI_TEST_XLS_ATTACHMENT]");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const answer = "已读取 XLS：女士衬衫，金额 58.50，日期 2026-09-12。";
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  assert.equal(await page.getByLabel("对话消息").getByText(answer, { exact: true }).count(), 1);
  assert.equal(await page.locator(".attachment-card-composer").count(), 0);
  assert.equal(await page.locator(".attachment-card-message").count(), 3);
  const conversationUrl = page.url();
  const conversationId = conversationUrl.split("/").at(-1);
  const attached = await page.evaluate(
    (conversationId) => window.openerx.listFiles({ conversationId }),
    conversationId,
  );
  assert.equal(attached.length, 3);
  await application.close();
  running = null;
  rmSync(xlsPath);
  rmSync(tsvPath);
  rmSync(sqlPath);
  running = await launch();
  ({ application, page } = running);
  await page.goto(conversationUrl);
  await page.getByLabel("对话消息").getByText(answer, { exact: true }).waitFor();
  assert.equal(await page.locator(".attachment-card-message").count(), 3);
  const restored = await page.evaluate(
    (personalFileId) => window.openerx.previewFile({ personalFileId }),
    xls.id,
  );
  assert.equal(restored.parsedText, preview.parsedText);
  assert.deepEqual(restored.citations, preview.citations);
  console.log(
    "E2E_ATTACHMENTS_OK: picker, cancel, mixed XLS/TSV/SQL import, parsed preview, Pi file read, message attachments, restart persistence",
  );
} catch (error) {
  if (running)
    console.error(
      "E2E_ATTACHMENT_STATE",
      await running.page
        .locator("body")
        .innerText()
        .catch(() => "unavailable"),
    );
  throw error;
} finally {
  await running?.application.close();
  rmSync(profileDirectory, { recursive: true, force: true });
}
