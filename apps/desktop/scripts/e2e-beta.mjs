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
  await page.getByLabel("发送消息").fill(privatePrompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();

  await application.evaluate(() => {
    const crash = globalThis.__openerxCrashAppServiceForTest;
    if (typeof crash !== "function") throw new Error("Crash injection hook missing");
    crash();
  });
  await waitForAppServiceRestart();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "诊断与数据", exact: true }).click();
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
