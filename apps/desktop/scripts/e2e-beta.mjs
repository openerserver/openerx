import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-beta-e2e-"));
const privatePrompt = "M8 私人导出正文 sk-beta-private-12345678";

let application;
try {
  application = await electron.launch({
    args: [mainEntry],
    cwd: desktopDirectory,
    env: {
      ...process.env,
      OPENERX_E2E: "1",
      OPENERX_E2E_PROFILE_DIR: profileDirectory,
      OPENERX_E2E_EXPORT_DIR: profileDirectory,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByLabel("发送消息").fill(privatePrompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();

  await application.evaluate(() => {
    const crash = globalThis.__openerxCrashAppServiceForTest;
    if (typeof crash !== "function") throw new Error("Crash injection hook missing");
    crash();
  });
  await page.locator(".sync-state.service-restarting").waitFor();
  await page.locator(".sync-state.service-ready").waitFor();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.locator("#diagnostics-section > summary").click();
  await page.getByRole("heading", { name: "诊断与数据" }).waitFor();
  await page.getByText("次服务重启", { exact: false }).waitFor();

  await page.getByRole("button", { name: "导出脱敏诊断包" }).click();
  await page.getByText("诊断包已保存：openerx-diagnostics.json").waitFor();
  await page.getByRole("button", { name: "导出个人数据" }).click();
  await page.getByText("个人数据已保存：openerx-personal-data.zip").waitFor();

  const diagnosticsPath = path.join(profileDirectory, "openerx-diagnostics.json");
  const personalDataPath = path.join(profileDirectory, "openerx-personal-data.zip");
  assert.equal(existsSync(diagnosticsPath), true);
  assert.equal(existsSync(personalDataPath), true);
  const diagnostics = readFileSync(diagnosticsPath, "utf8");
  const personalDataEntry = unzipSync(readFileSync(personalDataPath))["data.json"];
  if (!personalDataEntry) throw new Error("Personal export data.json missing");
  const personalData = strFromU8(personalDataEntry);
  assert.equal(diagnostics.includes(privatePrompt), false);
  assert.equal(diagnostics.includes("sk-beta-private-12345678"), false);
  assert.equal(diagnostics.includes(profileDirectory), false);
  assert.equal(JSON.parse(diagnostics).preview.restartCount >= 1, true);
  assert.equal(personalData.includes(privatePrompt), true);
  assert.equal(personalData.includes('"serverBillingIncluded": false'), true);

  console.log("E2E_BETA_OK preview-redaction-export-recovery-performance");
} finally {
  await application?.close().catch(() => undefined);
  rmSync(profileDirectory, { recursive: true, force: true });
}
