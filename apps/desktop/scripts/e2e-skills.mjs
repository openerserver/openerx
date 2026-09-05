import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const profileDirectory = mkdtempSync(path.join(tmpdir(), "openerx-e2e-skills-"));
const sourceDirectory = path.join(profileDirectory, "e2e-report-source");
mkdirSync(path.join(sourceDirectory, "agents"), { recursive: true });
mkdirSync(path.join(sourceDirectory, "references"), { recursive: true });
mkdirSync(path.join(sourceDirectory, "scripts"), { recursive: true });
writeFileSync(
  path.join(sourceDirectory, "SKILL.md"),
  `---
name: e2e-report
description: Create the M7 end-to-end verification report.
---

Read references/template.md and run scripts/render.mjs through openerx_skill_script.
`,
);
writeFileSync(path.join(sourceDirectory, "references", "template.md"), "M7 E2E template");
writeFileSync(
  path.join(sourceDirectory, "agents", "openai.yaml"),
  `version: 1.0.0
display_name: E2E report
publisher: OpenERX Test
tools: [openerx_skill_script]
permissions:
  - capability: shell
    actions: [execute]
    targets: [scripts/render.mjs]
    reason: Run the deterministic E2E report script.
platforms: [darwin, win32]
scripts: [scripts/render.mjs]
`,
);
writeFileSync(
  path.join(sourceDirectory, "scripts", "render.mjs"),
  'process.stdout.write(JSON.stringify({ title: process.argv[2], gate: "M7" }));\n',
);

async function approveScriptExecution(page) {
  const permission = page
    .getByLabel("工具权限确认")
    .filter({ hasText: "执行 Skill 脚本：scripts/render.mjs" })
    .last();
  try {
    await permission.getByRole("button", { name: "仅本次允许" }).click();
  } catch (error) {
    console.error("E2E_SKILLS_PERMISSION_STATE", await page.locator("body").innerText());
    throw error;
  }
}

async function waitForAppService(page) {
  await page.waitForFunction(
    async () => {
      try {
        await window.openerx.listSkills();
        return true;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 60_000 },
  );
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
    },
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => console.error("E2E_SKILLS_PAGE_ERROR", error));
  await waitForAppService(page);
  await application.evaluate(({ dialog, ipcMain }, selectedPath) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
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
  }, sourceDirectory);
  await page.evaluate(() =>
    window.localStorage.setItem("openerx.defaultModelRef", "platform/e2e-faux"),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppService(page);

  await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("button", { name: "skill", exact: true }).click();
  await page.getByRole("heading", { name: "Skill", exact: true }).waitFor();
  await page.getByRole("button", { name: "安装 Skill" }).click();
  const card = page.locator(".skill-card").filter({ hasText: "E2E report" });
  await card.waitFor();
  await card.getByText("未验证来源", { exact: true }).waitFor();
  await card.getByText("权限与详情", { exact: true }).click();
  await card.getByText(/OpenERX Test/).waitFor();
  await card.getByRole("button", { name: "审核并批准权限" }).click();
  await card.getByRole("button", { name: "启用 E2E report" }).click();
  await card.getByText("已启用", { exact: true }).waitFor();
  await card.getByRole("button", { name: "自动触发：关" }).click();
  await card.getByRole("button", { name: "自动触发：开" }).waitFor();

  await page.getByRole("button", { name: "返回应用", exact: true }).click();
  await page.waitForURL(/#\/chat\/new$/);
  await page.getByLabel("选择 Skill").selectOption({ label: "E2E report" });
  await page.getByLabel("发送消息").fill("生成验证报告 [PI_TEST_SKILL]");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await approveScriptExecution(page);
  await page.locator(".message-assistant[data-message-status='completed']").waitFor();
  await page
    .getByLabel("对话消息")
    .getByText(/Skill e2e-report 已通过 Pi 渐进加载/)
    .waitFor();

  await page.getByLabel("发送消息").fill("自动生成验证报告 [PI_TEST_SKILL_AUTO]");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await approveScriptExecution(page);
  await page.locator(".message-assistant[data-message-status='completed']").nth(1).waitFor();
  await page
    .getByLabel("对话消息")
    .getByText(/Skill e2e-report 已通过 Pi 渐进加载/)
    .nth(1)
    .waitFor();

  const activity = await page.evaluate(async () => await window.openerx.listSkillInvocations());
  assert.equal(activity.length, 2);
  assert.deepEqual(
    activity.map(({ trigger, status }) => ({ trigger, status })),
    [
      { trigger: "automatic", status: "completed" },
      { trigger: "explicit", status: "completed" },
    ],
  );
  assert.match(activity[0]?.reason ?? "", /Pi loaded SKILL\.md/);
  assert.equal(activity[1]?.reason, "Selected from the composer");
  const bridgeBoundary = await page.evaluate(() => ({
    hasProcess: typeof process !== "undefined",
    hasRequire: typeof require !== "undefined",
  }));
  assert.deepEqual(bridgeBoundary, { hasProcess: false, hasRequire: false });
  console.log("E2E_SKILLS_OK install-approve-enable-explicit-auto-pi-read-broker-script-audit");
} catch (error) {
  const page = application?.windows().at(0);
  if (page) console.error("E2E_SKILLS_PAGE_STATE", await page.locator("body").innerText());
  throw error;
} finally {
  await application?.close().catch(() => undefined);
  rmSync(profileDirectory, { recursive: true, force: true });
}
