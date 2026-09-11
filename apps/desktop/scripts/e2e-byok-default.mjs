import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktopDirectory = path.resolve(import.meta.dirname, "..");
const mainEntry = path.join(desktopDirectory, ".vite", "build", "main.js");
const temporaryRoot = realpathSync(tmpdir());
const profileDirectory = mkdtempSync(path.join(temporaryRoot, "openerx-e2e-byok-default-"));

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

  const state = await page.evaluate(async () => ({
    modelService: await window.openerx.getModelServiceSettings(),
    models: await window.openerx.listModels(),
    localSearch: await window.openerx.getLocalWebSearchSettings(),
  }));
  assert.equal(state.modelService.mode, "byok");
  assert.equal(state.modelService.credentialConfigured, false);
  assert.equal(Object.values(state.modelService.providerCredentials).some(Boolean), false);
  assert.equal(state.modelService.byok?.baseUrl, "https://api.deepseek.com");
  assert.equal(state.modelService.byok?.modelId, "deepseek-v4-flash");
  assert.equal(state.models.length, 13);
  assert.equal(
    state.models.every(({ status }) => status === "unavailable"),
    true,
  );
  assert.equal(
    state.models.some(({ modelRef }) => modelRef === "platform/byok.deepseek.flash"),
    true,
  );
  assert.equal(
    state.models.some(({ modelRef }) => modelRef === "platform/byok.qwen.plus"),
    true,
  );
  assert.equal(state.localSearch.featureEnabled, true);
  assert.equal(state.localSearch.providerId, "direct:baidu-json");

  await page.getByRole("link", { name: "前往设置 → 模型" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "模型与思考菜单" }).count(), 0);
  assert.equal(await page.getByLabel("新任务模型", { exact: true }).count(), 0);
  await page.getByLabel("发送消息").fill("未配置 API 时不能发送");
  assert.equal(await page.getByRole("button", { name: "发送", exact: true }).isDisabled(), true);

  await page.getByRole("link", { name: "前往设置 → 模型" }).click();
  await page.getByLabel("运行模式").waitFor();
  assert.equal(await page.getByLabel("运行模式").inputValue(), "byok");
  await page.getByLabel("DeepSeek API Key").waitFor();
  assert.equal(await page.getByLabel("Base URL").inputValue(), "https://api.deepseek.com");
  assert.equal(await page.getByLabel("模型 ID").inputValue(), "deepseek-v4-flash");

  await page.getByLabel("DeepSeek API Key").fill("synthetic-model-picker-deepseek");
  await page.getByRole("button", { name: "保存全部并启用" }).click();
  await page.getByText("模型 API 已保存 · 已配置 1 个厂商，可在任务中直接切换。").waitFor();
  const configuredModels = await page.evaluate(() => window.openerx.listModels());
  const availableModels = configuredModels.filter(({ status }) => status === "available");
  assert.ok(availableModels.length > 0);
  assert.ok(availableModels.length < configuredModels.length);
  assert.ok(
    availableModels.every(({ modelRef }) => modelRef.startsWith("platform/byok.deepseek.")),
  );
  await page.getByRole("button", { name: "返回应用", exact: true }).click();
  await page.getByRole("button", { name: "模型与思考菜单" }).click();
  const menu = page.getByRole("listbox", { name: "模型与思考", exact: true });
  for (const model of configuredModels) {
    assert.equal(
      await menu
        .getByRole("option")
        .filter({ has: page.getByText(model.displayName, { exact: true }) })
        .count(),
      model.status === "available" ? 1 : 0,
    );
  }
  assert.deepEqual(
    await page
      .getByLabel("新任务模型", { exact: true })
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
    availableModels.map(({ modelRef }) => modelRef),
  );
  await page.keyboard.press("Escape");
  console.log(
    "E2E_BYOK_DEFAULT_OK mode=byok local_search=direct:baidu-json server_required=false model-picker=hidden-unconfigured-only-configured-after-save",
  );
} finally {
  await application?.close();
  const resolvedProfile = path.resolve(profileDirectory);
  if (resolvedProfile.startsWith(`${temporaryRoot}${path.sep}`)) {
    rmSync(resolvedProfile, { recursive: true, force: true });
  } else {
    console.error("E2E_TEMP_PROFILE_BOUNDARY_VIOLATION");
    process.exitCode = 1;
  }
}
